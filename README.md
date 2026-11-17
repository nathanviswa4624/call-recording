# Echelons Call Recording Platform

Enterprise call recording, SIP trunk management, Asterisk (PJSIP + Sorcery) management and CDR analytics.
Any SIP-trunk-capable PBX (Avaya, Mitel, Cisco, Alcatel, …) connects to Asterisk. Asterisk records with
MixMonitor, and the platform manages configuration end to end: **Web UI → Backend → Configuration DB → Sorcery realtime → Asterisk**.

> The product name is configuration (`PRODUCT_NAME`), so the platform can be white-labelled.

## Repository layout

```
docs/                 Design documents (read these first)
packages/shared/      Pure domain logic: route-pattern engine, call classifier, PJSIP catalog
                      + validator, trunk composer, dialplan compiler, CLI allowlist, RBAC
apps/backend/         Fastify API, configuration pipeline, CDR ingestion, workers, Prisma schema
apps/connector/       Asterisk connector (AMI, managed config files, probes, live events)
apps/web/             Next.js 15 web UI (App Router, Tailwind 4, TanStack Query)
deploy/               Asterisk configs, generated realtime SQL, nginx, systemd, install + lab scripts
```

## Design documents

| # | Document |
|---|----------|
| 01 | [Architecture](docs/01-architecture.md) |
| 02 | [Database ERD](docs/02-database-erd.md) |
| 03 | [API specification](docs/03-api-specification.md) |
| 04 | [Asterisk integration](docs/04-asterisk-integration.md) |
| 05 | [PJSIP / Sorcery mapping](docs/05-pjsip-sorcery-mapping.md) |
| 06 | [Call flow](docs/06-call-flow.md) |
| 07 | [Recording architecture](docs/07-recording-architecture.md) |
| 08 | [Security architecture](docs/08-security-architecture.md) |
| 09 | [Deployment](docs/09-deployment-architecture.md) |

## Development

```bash
pnpm install
pnpm --filter @echelons/shared build
pnpm db:generate
pnpm test          # shared + backend + connector unit tests
pnpm typecheck
```

Backend: `cp .env.example apps/backend/.env`, fill in the values, then run `pnpm db:migrate`, `pnpm --filter @echelons/backend seed` and `pnpm dev:backend`.
Connector (on the Asterisk host): set `CONNECTOR_*` / `ASTERISK_*`, then run `pnpm dev:connector`.

When you change the PJSIP catalog, regenerate the realtime DDL:
`pnpm --filter @echelons/shared build && node deploy/scripts/gen-realtime-sql.mjs`.

## Production install (Ubuntu 24.04)

```bash
sudo ./deploy/scripts/install.sh --domain recording.example.com
# then complete first-run setup:
curl -X POST https://recording.example.com/api/setup/test
curl -X POST https://recording.example.com/api/setup/complete -H 'content-type: application/json' -d @setup.json
API=https://recording.example.com USER=admin PASS='…' ./deploy/scripts/lab-verify.sh
```

The installer never overwrites existing Asterisk files. It backs them up, adds `#include` lines, and tells you
which files need a manual merge, so existing servers (for example HotLync) keep their current configuration.

## Web UI (apps/web)

```bash
pnpm --filter @echelons/web dev          # http://localhost:3000, proxies /api to BACKEND_URL (default http://127.0.0.1:4000)
pnpm --filter @echelons/web test         # component + logic tests (Vitest, Testing Library)
pnpm --filter @echelons/web build        # production build; "standalone" server output on Linux
```

* The access token is kept **in memory only**. The session is restored from the HttpOnly refresh cookie, with a double-submit CSRF header.
* Audio plays through short-lived signed media URLs (`POST /recordings/:id/media-token`). Recordings are never served from a static path.
* Permission checks in the UI only hide actions. The backend enforces every permission.
* On Windows dev machines the standalone output is opt-in (`FORCE_STANDALONE=1`), because pnpm's symlinks need Developer Mode. Production builds on Ubuntu produce `.next/standalone/apps/web/server.js`, as `echelons-web.service` expects.
* Branding: `NEXT_PUBLIC_PRODUCT_NAME` (build time).

## Implementation status

| Area | Status |
|---|---|
| Architecture, design docs, Prisma schema, RLS, auth, RBAC, audit, connector, PJSIP/Sorcery publishing, dialplan compiler, routing, classification, CDR ingest, recordings, versioning/rollback, deployment | ✅ Increment 1 |
| Web UI: login, setup wizard, dashboard, PBX wizard, trunks + test, PJSIP CRUD (catalog-driven), routes / patterns / tester / dialplan / classification, call history / missed / details / call flow, recordings + player, live calls, Asterisk status / SIP / CLI, config versions / diff / rollback, users / roles / audit, reports + CSV export, profile / password | ✅ Increment 2 |
| TOTP MFA verification (the UI handles `mfaRequired` but cannot verify codes) | ⏳ |
| CEL import, MP3 transcoding, waveform generation (the player shows waveforms once `recordings.waveform` is populated) | ⏳ |
| Excel/PDF export, downloadable config backups, import of existing Asterisk config, Asterisk log viewer, system settings page | ⏳ shown as "Planned" in the sidebar |
| Validation against a real Asterisk 20/22 lab (`deploy/scripts/lab-verify.sh`) | ⏳ not yet run |
