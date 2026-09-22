// Browser port of the ProofHub plugin (proofhub-plugin/src/main.rs): the same
// actions, payloads and response shapes, so the UI and sync code work
// unchanged. ProofHub's API allows cross-origin requests from any origin, so
// the browser calls it directly; nothing goes through the Chronos server.
// Behavioural notes (why exists-checks, 200-with-failure bodies, ...) live in
// the Rust original and docs/proofhub-integration.md.

/** `/alltodo`'s maximum (and default) page size. */
const TASK_PAGE_SIZE = 100;
const RATE_LIMIT_RETRIES = 3;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export class ProofHubError {
  constructor(
    readonly status: number | null,
    readonly message: string,
  ) {}
}

interface Client {
  subdomain: string;
  apiKey: string;
}

function stringifyId(value: Json): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** A count ProofHub may send as a number or a numeric string. */
function asNumber(value: Json): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** Tolerates a bare array or one nested under one of `keys`. */
function extractList(body: Json, keys: string[]): Json[] {
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function normalizeItem(item: Json) {
  return { id: stringifyId(item?.id), title: typeof item?.title === "string" ? item.title : "" };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Encodes one path/query value, so an id can never change the request's path or query. */
const seg = (value: unknown) => encodeURIComponent(String(value));

async function send(client: Client, method: string, path: string, body?: Json): Promise<Json> {
  const url = `https://${client.subdomain}.proofhub.com/api/v3${path}`;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      // Content-Type on every request, bodyless ones included: ProofHub
      // rejects a DELETE without it. The browser supplies the User-Agent.
      response = await fetch(url, {
        method,
        headers: { "X-API-KEY": client.apiKey, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch (err) {
      throw new ProofHubError(null, `network error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      // Retry-After is usually not readable cross-origin, hence the default.
      const wait = Number(response.headers.get("retry-after")) || 10;
      await sleep(Math.min(wait, 15) * 1000);
      continue;
    }
    return handleResponse(response);
  }
}

async function handleResponse(response: Response): Promise<Json> {
  const text = await response.text().catch(() => "");
  let body: Json = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  // Some failures (e.g. a bad API key) come back as HTTP 200 with
  // `{"success": false}` or `{"status": false}` in the body.
  const bodySaysFailure = body?.success === false || body?.status === false;
  if (response.ok && !bodySaysFailure) return body;
  const message = typeof body?.message === "string" ? body.message : `ProofHub returned HTTP ${response.status}`;
  throw new ProofHubError(response.status, message);
}

const get = (client: Client, path: string) => send(client, "GET", path);

/** `GET .../time/{id}` for a missing id returns the whole listing, not a 404. */
async function timeEntryExists(client: Client, collection: string, timeId: string): Promise<boolean> {
  const body = await get(client, `${collection}/${seg(timeId)}`);
  return stringifyId(body?.id) === timeId;
}

function timeEntryBody(p: Json): Json {
  const body: Json = {
    project: p.projectId,
    timesheet_id: p.timesheetId,
    logged_hours: p.loggedHours,
    logged_mins: p.loggedMins,
    date: p.date,
    status: p.status,
    description: p.description,
  };
  if (p.listId && p.taskId) {
    body.list_id = p.listId;
    body.task_id = p.taskId;
  }
  return body;
}

export async function dispatch(action: string, p: Json, client: Client): Promise<Json> {
  switch (action) {
    case "test-connection":
      await get(client, "/projects");
      return null;

    case "list-projects":
      return extractList(await get(client, "/projects"), ["projects"]).map(normalizeItem);

    case "list-timesheets":
      return extractList(await get(client, `/projects/${seg(p.projectId)}/timesheets`), ["timesheets"]).map(normalizeItem);

    case "find-task": {
      for (const completed of ["false", "true"]) {
        for (let start = 0; ; start += TASK_PAGE_SIZE) {
          const body = await get(
            client,
            `/alltodo?projects=${seg(p.projectId)}&completed=${completed}&start=${start}&limit=${TASK_PAGE_SIZE}`,
          );
          const page = extractList(body, ["tasks"]);
          const task = page.find((t) => stringifyId(t?.ticket) === p.ticket);
          if (task) return { id: stringifyId(task.id), listId: stringifyId(task.list?.id) };
          if (page.length < TASK_PAGE_SIZE) break;
        }
      }
      return null;
    }

    case "upsert-entry": {
      const collection = `/projects/${seg(p.projectId)}/timesheets/${seg(p.timesheetId)}/time`;
      const body = timeEntryBody(p);
      const existing = p.timeId && (await timeEntryExists(client, collection, p.timeId)) ? (p.timeId as string) : null;
      let id: string;
      let raw: Json;
      if (existing) {
        raw = await send(client, "PUT", `${collection}/${seg(existing)}`, body);
        id = existing;
      } else {
        raw = await send(client, "POST", collection, body);
        id = stringifyId(raw?.id);
      }
      if (!id) throw new ProofHubError(null, "ProofHub accepted the time entry but didn't return its id.");
      return { id, raw };
    }

    case "check-entries": {
      const listings = new Map<string, Map<string, Json>>();
      const results = [];
      for (const entry of p.entries as { projectId: string; timesheetId: string; timeId: string }[]) {
        const collection = `/projects/${seg(entry.projectId)}/timesheets/${seg(entry.timesheetId)}/time`;
        if (!listings.has(collection)) {
          const items = extractList(await get(client, collection), ["time_entries"]);
          listings.set(collection, new Map(items.map((item) => [stringifyId(item?.id), item])));
        }
        let found = listings.get(collection)!.get(entry.timeId) ?? null;
        if (!found) {
          const body = await get(client, `${collection}/${seg(entry.timeId)}`);
          found = stringifyId(body?.id) === entry.timeId ? body : null;
        }
        results.push({
          projectId: entry.projectId,
          timesheetId: entry.timesheetId,
          timeId: entry.timeId,
          exists: found !== null,
          loggedHours: found ? asNumber(found.logged_hours) : null,
          loggedMins: found ? asNumber(found.logged_mins) : null,
          date: typeof found?.date === "string" ? found.date.slice(0, 10) : null,
        });
      }
      return results;
    }

    case "list-entries": {
      const body = await get(client, `/projects/${seg(p.projectId)}/timesheets/${seg(p.timesheetId)}/time`);
      return extractList(body, ["time_entries"])
        .filter((item) => item?.by_me !== false)
        .filter((item) => typeof item?.date === "string" && item.date.slice(0, 10) >= p.since)
        .map((item) => ({
          projectId: p.projectId,
          timesheetId: p.timesheetId,
          timeId: stringifyId(item.id),
          date: item.date.slice(0, 10),
          loggedHours: asNumber(item.logged_hours),
          loggedMins: asNumber(item.logged_mins),
          description: typeof item.description === "string" ? item.description : "",
          taskId: item.task?.id !== undefined ? stringifyId(item.task.id) : null,
        }));
    }

    case "delete-entry": {
      const collection = `/projects/${seg(p.projectId)}/timesheets/${seg(p.timesheetId)}/time`;
      if (await timeEntryExists(client, collection, p.timeId)) {
        await send(client, "DELETE", `${collection}/${seg(p.timeId)}`);
      }
      return null;
    }

    default:
      throw new ProofHubError(null, `invalid request: unknown action "${action}"`);
  }
}
