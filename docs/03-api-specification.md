# 03 — REST API Specification

Base path `/api`. JSON only. Authentication is a short-lived JWT access token (15 min) sent as
`Authorization: Bearer`, plus a rotating refresh token in an `HttpOnly; Secure; SameSite=Strict`
cookie scoped to `/api/auth`. State-changing requests made with the cookie also need the
`X-CSRF-Token` header (double-submit). Every response carries `X-Request-Id`.

An OpenAPI 3.1 document is generated from the zod route schemas at `GET /api/docs/openapi.json`, and
Swagger UI is served at `/api/docs` (admin only in production).

## Conventions

* **Pagination.** `?limit=50&cursor=<opaque>` returns `{ items, nextCursor }`. Calls and recordings use keyset cursors.
* **Errors.** `{ error: { code, message, details?, requestId } }`. Codes: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `ASTERISK_UNAVAILABLE`, `CONFIG_APPLY_FAILED`, `UNSUPPORTED_PARAMETER`, `RATE_LIMITED`.
* **Config mutations** return `202 { jobId }` when `?apply=true`. Otherwise they save as draft and return `200`. Job progress is pushed over WebSocket on `config.job.<id>`.
* **Permission** is shown per endpoint (see doc 08 for the matrix).

## Endpoints

### Auth & users
| Method | Path | Permission |
|---|---|---|
| POST | /auth/login | public (rate limited 5/min/IP+user) |
| POST | /auth/refresh | refresh cookie |
| POST | /auth/logout | authenticated |
| GET | /auth/me | authenticated |
| POST | /auth/mfa/enroll, /auth/mfa/verify | authenticated |
| GET/POST | /users | users.manage |
| GET/PATCH/DELETE | /users/:id | users.manage |
| GET/POST/PATCH | /roles, /roles/:id | users.manage |
| GET | /permissions | users.manage |

### PBX & trunks
| Method | Path | Permission |
|---|---|---|
| GET/POST | /pbxs | trunks.view / trunks.configure |
| GET/PATCH/DELETE | /pbxs/:id | trunks.view / trunks.configure |
| POST | /pbxs/wizard | trunks.configure (atomic 10-step PBX wizard) |
| GET/POST | /pbxs/:id/trunks | trunks.view / trunks.configure |
| GET/PATCH/DELETE | /trunks/:id | trunks.configure |
| POST | /trunks/:id/test | trunks.configure (DNS/TCP/UDP/OPTIONS/endpoint/test call) |
| GET | /trunk-templates · POST/PATCH | trunks.view / trunks.configure |
| POST | /trunk-templates/:id/render | trunks.configure (preview generated PJSIP objects) |

### PJSIP / Sorcery
| Method | Path | Permission |
|---|---|---|
| CRUD | /pjsip/endpoints, /pjsip/aors, /pjsip/auths, /pjsip/identifies, /pjsip/transports, /pjsip/registrations, /pjsip/domain-aliases | endpoints.configure |
| GET/PUT | /pjsip/globals | endpoints.configure |
| GET | /pjsip/catalog?object=endpoint&server=:id | endpoints.view (version-filtered options) |
| GET | /pjsip/contacts | endpoints.view (live, from connector) |
| GET | /sorcery | system.manage (object→wizard mapping + health) |
| PUT | /sorcery/:objectType | system.manage |

### Routing & dialplan
| Method | Path | Permission |
|---|---|---|
| CRUD | /routes | routes.configure |
| CRUD | /route-patterns | routes.configure |
| POST | /route-patterns/test `{number, pbxId?, direction?}` | routes.view (dry-run matcher) |
| GET | /route-patterns/:id/stats?from&to | reports.view |
| CRUD | /call-types | routes.configure |
| CRUD | /classification-rules · POST /classification-rules/test | routes.configure |
| CRUD | /dialplans (contexts), /dialplans/:ctx/extensions | dialplan.configure |
| GET | /dialplans/compiled?server=:id | dialplan.configure (preview of generated file) |
| CRUD | /recording-policies | routes.configure |

### Configuration pipeline
| Method | Path | Permission |
|---|---|---|
| GET | /config/pending | any configure perm |
| POST | /config/apply `{serverId, scope?}` | any configure perm |
| GET | /config/jobs/:id | any configure perm |
| GET | /config/versions · /config/versions/:id · /config/versions/:a/diff/:b | config.view |
| POST | /config/versions/:id/rollback | system.manage |
| GET | /import/discover?server=:id | system.manage |
| POST | /import/apply `{objects:[...]}` | system.manage |
| GET/POST | /backups · GET /backups/:id/download · POST /backups/:id/restore | system.manage |

### Calls, CDR, recordings
| Method | Path | Permission |
|---|---|---|
| GET | /calls?from&to&caller&destination&extension&pbxId&trunkId&routeId&routePatternId&callTypeId&direction&minDuration&maxDuration&status&agent&department&queue&campaign&recordingId&uniqueId&hasRecording&cursor&limit&sort | calls.view (agents are limited to granted calls) |
| GET | /calls/live | calls.view |
| GET | /calls/:id · /calls/:id/flow · /calls/:id/events · /calls/:id/sip | calls.view |
| GET | /cdr?… · /cdr/:id | cdr.view |
| GET | /recordings?… (same filters as /calls) | recordings.view |
| GET | /recordings/:id | recordings.view + access check |
| GET | /recordings/:id/stream?channel=mixed\|caller\|callee | recordings.view + access, supports `Range` |
| GET | /recordings/:id/download?format=wav\|mp3 | recordings.download |
| GET | /recordings/:id/waveform | recordings.view (cached peaks JSON) |
| POST | /recordings/:id/signed-url | recordings.download (S3 presigned, ≤ 5 min) |
| DELETE | /recordings/:id | recordings.delete |
| POST/DELETE | /recordings/:id/tags, /recordings/:id/notes | recordings.view |

### Reports & export
| Method | Path | Permission |
|---|---|---|
| GET | /reports/dashboard?date | reports.view |
| GET | /reports/calls · /reports/agents · /reports/pbx · /reports/routes · /reports/call-types | reports.view |
| POST | /exports `{report, filters, format: csv\|xlsx\|pdf}` → job | reports.view |
| GET | /exports/:id/download | reports.view |

### Storage & retention
| Method | Path | Permission |
|---|---|---|
| CRUD | /storage | system.manage |
| POST | /storage/:id/test | system.manage |
| GET | /storage/stats | recordings.view |
| CRUD | /retention | system.manage |
| POST | /retention/run `{dryRun:true}` | system.manage |
| GET | /retention/runs/:id | system.manage |

### Asterisk & monitoring
| Method | Path | Permission |
|---|---|---|
| GET | /asterisk/servers · POST · PATCH | system.manage |
| GET | /asterisk/status?server | system.view |
| GET | /asterisk/modules · /asterisk/logs?lines&level | system.view |
| POST | /asterisk/reload `{module?}` · /asterisk/restart `{mode:'gracefully'\|'when convenient'}` | system.manage |
| GET | /asterisk/cli/commands (allowlist) | cli.access |
| POST | /asterisk/cli `{serverId, command}` | cli.access |
| GET | /troubleshoot/:serverId/{sip,asterisk,network,recording} | system.view |
| GET | /audit?… | audit.view |
| GET/PUT | /settings | system.manage |
| GET/POST | /setup/* | first-run only (disabled after completion) |

## WebSocket (`/api/ws`, Socket.IO)

Authenticated by the access token in the handshake. Each socket joins rooms
`org:<id>` and `site:<id>`. Server → client events:

| Event | Payload |
|---|---|
| `call.started` / `call.updated` / `call.ended` | live call summary (caller, destination, pbx, route, duration, recording state) |
| `recording.started` / `recording.stopped` / `recording.ready` | recording ID + call linkage |
| `endpoint.status` | endpoint, state (Reachable / Unreachable / Unknown), RTT |
| `registration.status` | outbound registration state |
| `asterisk.status` | server ID, connected, version, uptime |
| `config.job` | job ID, step, status, message |

## Increment 2 additions (required by the web UI)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | /recordings/:id/media-token `{purpose: stream\|download, channel}` | recordings.view (+ recordings.download for downloads) | Returns a 5-minute HMAC-signed URL bound to user + recording + channel + purpose. `<audio>` cannot send Bearer headers and a JWT must never appear in a URL. On every request the stream/download endpoint re-loads the user's current permissions and re-runs the access check. |
| GET | /recordings/:id/stream?channel&t= · /recordings/:id/download?format&t= | as above | Accepts either Bearer or a media token `t`. Supports Range (206/416). For S3 downloads with a token, the endpoint redirects to a presigned URL. |
| GET | /sites | authenticated | Sites the caller may access |
| GET/POST | /recording-policies | routes.view / routes.configure | |
| GET | /system/health | authenticated | DB + connector/AMI/ARI health per server (HEALTHY/WARNING/CRITICAL/UNKNOWN) |
| PUT | /auth/password `{currentPassword, newPassword}` | authenticated | Policy enforced; revokes all refresh tokens |
| GET | /auth/me | authenticated | Now also returns organization, username, email, extensions, department, mfaEnabled |
| GET | /calls/live | calls.view | Live calls from every connector (`/v1/live`) plus per-server errors. No synthetic data. |
| GET/POST/PUT/DELETE | /dialplans[?serverId] · /dialplans/:id | dialplan.configure (GET also routes.view) | Custom context CRUD. Compile-checked on save; apps limited to `ALLOWED_APPLICATIONS`. |
| PUT/DELETE | /classification-rules/:id | routes.configure | |
| GET | /reports/trunks · /reports/extensions | reports.view | New report kinds |
| POST | /route-patterns/test | routes.view | Response now includes `prefix`, `stripDigits`, `prepend`, `callType` and the resolved `recordingPolicy` (pattern → route → PBX → org default, same as the dialplan compiler) |
| GET | /audit?ip= | audit.view | New IP filter |

WebSocket: the backend now subscribes to each connector's `/v1/events` SSE stream (`modules/realtime/bridge.ts`) and re-emits events only to the owning organization's Socket.IO room.
