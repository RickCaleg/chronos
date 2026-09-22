# Chronos web

A browser version of Chronos, built from the same code as the desktop app.
**All data stays in the visitor's browser** (SQLite compiled to WebAssembly,
stored in the browser's private file system, OPFS). The server only serves
static files. It never receives, stores, or sees anyone's time entries, and
every visitor has their own separate data.

## What's different from the desktop app

| | Desktop | Web |
|---|---|---|
| Timer, projects, tags, grouping, command palette, shortcuts inside the app | ✓ | ✓ |
| JSON backup, CSV export/import, Clockify import | ✓ | ✓ (browser download / file picker) |
| Tray, global shortcut, start with the system | ✓ | — (the tab title shows `●` while a timer runs) |
| Automatic backups to a folder | ✓ | — (export a backup by hand) |
| Self-updater | ✓ | — (a reload picks up whatever the server serves) |
| ProofHub integration | ✓ | ✓ (the browser calls ProofHub directly) |
| Omarchy theme, `chronos-cli` | ✓ | — |

Things to know:

- Data belongs to **one browser on one device**. Another browser or computer
  starts empty. Move data between them, or between desktop and web, with
  **Settings → Data → Export/Import backup (JSON)**. The format is the same.
- **Clearing the site's data erases everything.** Chronos asks the browser to
  keep its storage persistent, but a backup is the only real safety net.
- Only **one tab** can use Chronos at a time. A second tab shows a message
  instead of risking conflicting writes.
- With ProofHub connected, the browser talks to `<subdomain>.proofhub.com`
  directly; the Chronos server never sees the API key or the hours sent. The
  key is stored encrypted in that browser, so each browser connects once.
- It needs **HTTPS** (or `localhost`): browsers only allow this storage on
  secure connections. Over plain `http://<ip>` it shows "This browser can't run Chronos".
- Private/incognito windows may refuse or discard the storage.

## Deploying on Ubuntu Server with Docker

### 1. Install Docker

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in afterwards
```

### 2. Get the deploy files

Only `compose.yaml` and `.env.example` are needed to run the prebuilt image:

```sh
git clone https://github.com/RickCaleg/chronos.git
cd chronos
cp .env.example .env
```

### 3. Choose how it's reached

Edit `.env` and set `CHRONOS_ADDRESS`:

- **Public domain** (DNS record pointing at the server, ports 80 and 443 open):
  `CHRONOS_ADDRESS=chronos.example.com`. Caddy gets and renews a Let's Encrypt
  certificate by itself.
- **LAN only, by IP**: `CHRONOS_ADDRESS=192.168.0.10`. Caddy issues a
  certificate from its own internal CA. Browsers warn until you trust it:
  export it with
  `docker compose cp chronos:/data/caddy/pki/authorities/local/root.crt .`
  and import `root.crt` on each device.
- **Cloudflare Tunnel** (domain on Cloudflare, no open ports, works with a
  dynamic IP): see [Cloudflare Tunnel](#cloudflare-tunnel) below.
- **Behind an existing reverse proxy** (nginx, Traefik, another Caddy) that
  already does HTTPS: `CHRONOS_ADDRESS=:80` and `CHRONOS_HTTP_PORT=8080`, then
  proxy to `http://127.0.0.1:8080`.

### 4. Start it

```sh
docker compose pull
docker compose up -d
```

If the image isn't published (or the GHCR package is private), build it on the
server instead: `docker compose up -d --build`.

### Cloudflare Tunnel

`cloudflared` opens an outbound connection to Cloudflare, which serves the site
over HTTPS on your domain and forwards requests through it. Nothing on the
router needs to change, and the server's IP can change freely. The domain's
DNS must be managed by Cloudflare.

1. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a
   tunnel → Cloudflared**, give it a name, and copy the token (the long string
   after `--token` in the install command shown; don't run that command).
2. In the tunnel, add a **Public hostname**: subdomain `chronos`, your domain,
   service type **HTTP**, URL **`chronos:80`** (the compose service name).
3. In `.env`:
   ```sh
   CHRONOS_ADDRESS=:80
   CHRONOS_HTTP_PORT=127.0.0.1:8080
   CHRONOS_HTTPS_PORT=127.0.0.1:8443
   COMPOSE_PROFILES=tunnel
   CLOUDFLARE_TUNNEL_TOKEN=<token>
   ```
   and `chmod 600 .env`, since the token grants control of the tunnel.
4. `docker compose up -d --build`, then `docker compose logs cloudflared`
   should show `Registered tunnel connection`.
5. In the Cloudflare dashboard for the domain:
   - Turn off anything that injects scripts into pages, which the
     Content-Security-Policy would block: **Rocket Loader** (Speed →
     Optimization), **Email Address Obfuscation** (Scrape Shield), and
     automatic Web Analytics injection.
   - Turn on **Always Use HTTPS** (SSL/TLS → Edge Certificates). Caddy also
     redirects plain-HTTP visitors, but Cloudflare does it without a round
     trip to your server.
   - Add a **Cache Rule**: hostname equals your Chronos hostname *and* URI
     path starts with `/assets/` → Eligible for cache. Cloudflare doesn't
     cache `.wasm` files by default, so without it the 420 KB SQLite module
     comes from your connection on every first visit.
6. Optional: **Zero Trust → Access → Applications** can put a login (e.g. an
   email code) in front of the hostname, so only you can open it.

### Updating

```sh
docker compose pull && docker compose up -d
```

Or, when building from the repo: `git pull && docker compose up -d --build`.
Pin a version with `CHRONOS_VERSION=0.5.12` in `.env`; roll back by setting
the previous one and running the same command. Users get the new version on
their next page load, and their data isn't touched.

### Logs

```sh
docker compose logs -f chronos
```

### Backing up the server

There's nothing to back up: the server holds no user data. The only state is
the `caddy_data` volume (TLS certificates and, in IP mode, the internal CA).
Losing it just means new certificates. In IP mode, devices then need the new
`root.crt`.

## Running it locally (Docker or Podman)

Without Node or Rust on the machine, only a container engine. With Podman the
commands are the same with `podman` in place of `docker`:

```sh
docker build -t chronos-web:local .
docker run -d --name chronos-web -p 8080:80 chronos-web:local
# open http://localhost:8080
```

```sh
docker stop chronos-web                # stop
docker start chronos-web               # start again (data in the browser is kept)
docker logs chronos-web                # Caddy logs
docker rm -f chronos-web               # remove the container
```

After changing the code, rebuild and recreate it:

```sh
docker build -t chronos-web:local . && docker rm -f chronos-web && \
  docker run -d --name chronos-web -p 8080:80 chronos-web:local
```

The data lives in the browser under the site's origin, `http://localhost:8080`.
It survives rebuilding and recreating the container, but it's tied to that
host and port: `http://127.0.0.1:8080` or another port starts empty.

## Smoke test

`docker/smoke-test.mjs` drives headless Chromium through the main flows
against a running deployment: the app loads, a timer starts and stops, the
entry survives a reload, a second tab is blocked, and a JSON backup exports
and imports again. It also fails on any browser console error, which is how a
too-strict Content-Security-Policy would show up. It uses a fresh browser
profile, so it never touches real data.

With the container running on port 8080, and without installing anything
locally:

```sh
docker run --rm --network host -v "$PWD/docker":/t:ro -w /tmp \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  sh -c "npm i -s playwright@1.55.0 >/dev/null 2>&1 && cp /t/smoke-test.mjs . && CHRONOS_URL=http://localhost:8080/ node smoke-test.mjs"
```

(Podman: add `:Z` to the volume, `-v "$PWD/docker":/t:ro,Z`.) Point
`CHRONOS_URL` at the real server to check a deployment.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "This browser can't run Chronos" | Not a secure origin: the page was opened over `http://` on something other than `localhost`. Use one of the HTTPS modes above. It also shows in some private windows, and on old browsers without OPFS. |
| "Chronos is already open in another tab" | Another tab (or window) of the same site holds the database. Close it and reload. |
| Certificate warning in IP mode | Expected until each device trusts Caddy's `root.crt` (see step 3). |
| Domain mode: no certificate | DNS must point at the server and ports 80 and 443 must be reachable from the internet. Check `docker compose logs chronos`. |
| Tunnel: `Error 1033` / hostname doesn't load | `cloudflared` isn't connected: check `docker compose logs cloudflared` and the token in `.env`. |
| Tunnel: `Bad gateway` (502) | The public hostname's URL must be `http://chronos:80`, not `localhost`. |
| ProofHub: "network error: Failed to fetch" | The subdomain doesn't exist (check the part before `.proofhub.com`), or something blocks `*.proofhub.com` (an ad blocker, or a CSP changed in `docker/Caddyfile`). |
| Tunnel: console CSP errors, blank page | A Cloudflare feature injects scripts: turn off Rocket Loader, Email Obfuscation and Web Analytics injection. |
| Caddy exits with `read-only file system` | The container runs read-only and needs its `/data` and `/config` volumes, as `compose.yaml` mounts them. When running it by hand with `--read-only`, add `-v chronos_data:/data -v chronos_config:/config`. |
| `address already in use` on start | Another service uses port 80/443. Stop it, or use `CHRONOS_HTTP_PORT`/`CHRONOS_HTTPS_PORT` behind that service. |
| Data disappeared | The browser's site data was cleared, or a different address/port/browser is in use (each is separate storage). Restore from a JSON backup. |
| New version not showing | Reload the page. `index.html` is never cached, so a reload always gets what the server serves. |

## Security checklist

The server never holds anyone's data, but it serves the code that runs next
to that data. Whoever can change what it serves can read every visitor's
entries and ProofHub API key. So the things to protect are the ones that
decide what gets served:

- **The server**: SSH with keys only (`PasswordAuthentication no` in
  `/etc/ssh/sshd_config`), and automatic security updates
  (`sudo apt install unattended-upgrades`). With Cloudflare Tunnel no port
  needs to be open to the internet; the compose ports are bound to
  `127.0.0.1`. (Docker bypasses `ufw` for published ports, which is why
  binding to localhost matters.)
- **The GitHub account** the server pulls and builds from: two-factor authentication.
- **The Cloudflare account**: two-factor authentication. It can change
  responses, and route the tunnel to other machines on your network.
- Optional: **Cloudflare Access** (Zero Trust → Access → Applications) to
  allow only your email, so the app isn't publicly reachable at all.

## Publishing the image

`.github/workflows/web-image.yml` builds `ghcr.io/<owner>/chronos-web` for
amd64 and arm64 on every `v*` tag (the same tag that triggers the desktop
release), tagged with the version and `latest`. It can also be run by hand from
the Actions tab.

The first push creates the package as **private**. Either make it public
(GitHub → Packages → chronos-web → Package settings → Change visibility), or
log in on the server with a token that has `read:packages`:
`docker login ghcr.io -u <user>`.

## Development

```sh
npm install
npm run dev:web       # http://localhost:5173
npm run build:web     # output in dist-web/
```

To test the production image locally: `docker compose up --build` with
`CHRONOS_ADDRESS=:80` and `CHRONOS_HTTP_PORT=8080`, then open
`http://localhost:8080` (localhost counts as a secure origin).

## How it's put together

- `src/platform/types.ts` is the interface between the UI and its host.
  `src/platform/tauri.ts` implements it with Tauri APIs, and
  `src/platform/web/` with browser APIs. `vite.config.ts` points the
  `@platform` import at one or the other (`--mode web`). Capabilities a host
  lacks are `null`, and the UI hides their controls.
- `src/platform/web/db.worker.ts` runs SQLite in a Web Worker on the
  `opfs-sahpool` VFS, and applies `src/platform/web/migrations.ts`, a copy of
  the desktop migrations in `src-tauri/src/lib.rs`.
- `src/platform/web/proofhub/` is the ProofHub integration for the browser:
  a TypeScript port of `proofhub-plugin/src/main.rs` plus encrypted credential
  storage. See [`proofhub-integration.md` §14](proofhub-integration.md#14-web-version).
- `docker/Caddyfile` serves `dist-web/` with a strict Content-Security-Policy,
  HSTS, COOP/CORP, a year of caching for hashed assets, and no caching for
  everything else. A missing `/assets/` file is a 404 (never `index.html`,
  which would then be cached for a year under a script's URL). Visitors that
  Cloudflare or another proxy marks as plain HTTP (`X-Forwarded-Proto: http`)
  are redirected to HTTPS. Its `default_sni` makes IP mode work: clients send
  no SNI to an IP, and inside the container the local address isn't the
  host's IP.
- `compose.yaml` runs both containers with a read-only filesystem, no Linux
  capabilities (Caddy keeps only the one to bind ports 80/443) and
  `no-new-privileges`. Caddy writes only to its two volumes.
- `docker/smoke-test.mjs` is the end-to-end check described above.

| File | Role |
|---|---|
| `Dockerfile` | Builds `dist-web/` with Node, then copies it into a Caddy image |
| `compose.yaml` + `.env.example` | Server deployment; `.env` is git-ignored |
| `docker/Caddyfile` | Static serving, HTTPS, security headers, caching |
| `.github/workflows/web-image.yml` | Publishes the image to GHCR on each `v*` tag |
| `.github/workflows/ci.yml` | Builds both versions and blocks Tauri imports outside `src/platform/tauri.ts` |

### Rules that keep both versions working

- Components and stores never import `@tauri-apps/*`. Anything native goes
  through `@platform`. CI fails otherwise.
- A new desktop migration in `src-tauri/src/lib.rs` must be appended to
  `src/platform/web/migrations.ts` too, in the same order. Never edit an
  existing one in either place (the desktop app checksums applied migrations).
- A new native feature gets a nullable member in `Platform`, so TypeScript
  forces both implementations to decide what to do with it.
- A new user-facing string in either build goes in both `en.json` and `pt-BR.json`.
- A change to the ProofHub plugin (`proofhub-plugin/src/main.rs`) must be
  mirrored in `src/platform/web/proofhub/api.ts`, and vice versa.

### Release checklist

1. `npm run build`, `npm run build:web` and `cargo check --workspace` pass (CI runs them too).
2. Build the image, run it, and run the smoke test against it.
3. Tag `vX.Y.Z` and push the tag. The desktop release and the web image are built from the same tag.
4. On the server: `docker compose pull && docker compose up -d` (or pin `CHRONOS_VERSION`).
5. Run the smoke test against the server's URL.
