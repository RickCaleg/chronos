// End-to-end check of a running Chronos web deployment in headless Chromium.
// Usage (see docs/WEB.md, "Smoke test"):
//   CHRONOS_URL=http://localhost:8080/ node docker/smoke-test.mjs
// It creates one entry in a fresh browser profile; nothing touches real users' data.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const URL = process.env.CHRONOS_URL ?? "http://localhost:8080/";
const errors = [];
const step = (msg) => console.log(`ok - ${msg}`);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ locale: "en-US", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL);
  const input = page.getByPlaceholder(/working on/);
  await input.waitFor({ timeout: 15000 });
  step("app loaded (database opened)");

  await input.fill("#1234 web smoke test");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForTimeout(1500);
  if ((await page.title()) !== "● Chronos") throw new Error(`unexpected title while running: ${await page.title()}`);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  step("timer started and stopped");

  await page.reload();
  await page.getByText("web smoke test").first().waitFor({ timeout: 10000 });
  step("entry persisted across reload");

  // Typing into the field while the timer runs: the text must reach the entry
  // as typed, spaces included (rebuilding it from task+description ate them).
  const typed = "#99 typed while running";
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
  await input.click();
  await input.pressSequentially(typed, { delay: 30 });

  // The running entry's note, edited in the timer bar (it has no row yet).
  await page.getByRole("button", { name: "Add a note" }).first().click();
  await page.getByRole("textbox", { name: "Note" }).pressSequentially("note while running", { delay: 20 });
  await page.keyboard.press("Control+Enter");
  await page.getByRole("button", { name: "Stop", exact: true }).waitFor({ timeout: 5000 });
  step("note written while the timer runs, without stopping it");

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByText("typed while running").first().waitFor({ timeout: 10000 });
  step("description typed while the timer runs is saved");

  const page2 = await ctx.newPage();
  await page2.goto(URL);
  await page2.getByText("already open in another tab").waitFor({ timeout: 10000 });
  await page2.close();
  step("second tab blocked");

  await page.keyboard.press("Alt+3");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Export full backup/ }).click(),
  ]);
  const backupPath = await download.path();
  const backup = JSON.parse(readFileSync(backupPath, "utf8"));
  const entry = backup.timeEntries?.find((e) => e.taskNumber === "#1234");
  const running = backup.timeEntries?.find((e) => e.taskNumber === "#99");
  if (running?.description !== "typed while running" || running?.note !== "note while running") {
    throw new Error(`what was typed while running was mangled: ${JSON.stringify(running)}`);
  }
  if (backup.timeEntries?.length !== 2 || entry.taskNumber !== "#1234" || entry.description !== "web smoke test") {
    throw new Error(`unexpected backup content: ${JSON.stringify(backup.timeEntries)}`);
  }
  step("JSON backup exported");

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /Import backup \(JSON\)/ }).click(),
  ]);
  await chooser.setFiles(backupPath);
  await page.getByText("Import completed").waitFor({ timeout: 10000 });
  step("JSON backup imported");

  if (errors.length) throw new Error(`browser errors:\n${errors.join("\n")}`);
  console.log("all checks passed");
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
