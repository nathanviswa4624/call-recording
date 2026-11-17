# 08 — Security Architecture

## 1. Authentication
* Passwords are hashed with **Argon2id** (`@node-rs/argon2`, m=19 MiB, t=2, p=1, OWASP baseline). Minimum 12 characters, and passwords are checked against a breach list.
* Access JWT (HS512, 15 min) carries `sub, org, roles, perms_v`. The refresh token is opaque (32 random bytes). Only its SHA-256 hash is stored, it rotates on every use, and if an old one is reused the whole family is revoked.
* MFA-ready: there is a `mfa_factors` table (TOTP secret encrypted, WebAuthn later). If a user has MFA, login returns `mfa_required` with a short-lived challenge token.
* Lockout: after 10 failures in 15 minutes, the account is locked for 15 minutes. All attempts are audited.

## 2. Authorization (RBAC)

Permissions (fixed codes, assignable to custom roles):

| Code | Super Admin | Administrator | Supervisor | Agent | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| recordings.view | ✓ | ✓ | ✓ | own/granted | ✓ |
| recordings.download | ✓ | ✓ | ✓ | own/granted | |
| recordings.delete | ✓ | ✓ | | | |
| calls.view | ✓ | ✓ | ✓ | own | ✓ |
| cdr.view | ✓ | ✓ | ✓ | | ✓ |
| reports.view | ✓ | ✓ | ✓ | | ✓ |
| trunks.view / trunks.configure | ✓/✓ | ✓/✓ | | | ✓/ |
| endpoints.view / endpoints.configure | ✓/✓ | ✓/✓ | | | ✓/ |
| routes.view / routes.configure | ✓/✓ | ✓/✓ | | | ✓/ |
| dialplan.configure | ✓ | ✓ | | | |
| config.view | ✓ | ✓ | | | |
| users.manage | ✓ | | | | |
| system.view / system.manage | ✓/✓ | ✓/ | | | |
| cli.access | ✓ | | | | |
| cli.unsafe (reload/restart) | ✓ | | | | |
| audit.view | ✓ | ✓ | | | |

"own/granted" for an agent means calls whose `agent_user_id` is the user, or whose extension is in the user's
`extensions_dir` assignment, or that have an explicit `recording_access_grants` row. This filter is applied in SQL,
not after the query.

## 3. Tenant isolation
See doc 02 §1: a mandatory `organization_id` scope in a Prisma extension, plus PostgreSQL RLS with `SET LOCAL app.org_id`.

## 4. Secrets
* SIP auth passwords, S3 keys, AMI/ARI credentials for extra servers, and TOTP seeds are encrypted with **AES-256-GCM** (`ENCRYPTION_KEY`, 96-bit random IV, key-version prefix `v1:`) before storage. Key rotation re-encrypts by version.
* API serializers never return secret fields. DTOs expose only `hasPassword: boolean`.
* The pino logger has `redact` paths for `password, secret, *.password, authorization, cookie, AMI Secret`. The AMI client never logs `Login` action bodies.
* Backups exclude secrets unless `includeSecrets=true`. In that case the backup is encrypted with a passphrase the user supplies (scrypt → AES-256-GCM), and the passphrase is not stored.
* The `asterisk.ps_auths` plaintext is required by Asterisk. Mitigation: the `asterisk` schema is owned by role `echelons_publisher`, Asterisk's ODBC user `asterisk_ro` has SELECT only, and `echelons_app` has no rights on it. Publishing uses a `SECURITY DEFINER` function, or a separate pooled connection with the publisher role.

## 5. Web hardening
* `@fastify/helmet` with strict CSP (`default-src 'self'`; media-src self blob:), HSTS, frame-ancestors none.
* `@fastify/rate-limit` (Redis store): global 300/min/user, login 5/min, CLI 30/min.
* CSRF: double-submit token for cookie-authenticated routes (refresh/logout). Bearer API calls are not CSRF-prone.
* Inputs are checked by zod at every route, so bad input never reaches Prisma. Raw SQL only uses `Prisma.sql` tagged templates.
* XSS: React escaping. Rendering of untrusted HTML is banned by lint rule. CLI output is rendered as text in `<pre>`.
* Uploads (backup restore) have a size limit, accept only a tar.gz with a schema-validated manifest, and use no path traversal (entries are normalised).

## 6. Asterisk CLI allowlist

The connector holds the allowlist (defence in depth: the backend also checks it). Each command is matched against
anchored regexes. Arguments must match `[A-Za-z0-9_.\-@/]+`. Characters `; | & $ \` > <` and newlines are rejected outright.

| Tier | Commands |
|---|---|
| read (cli.access) | `core show (version|uptime|channels( concise| verbose)?|calls|settings|sysinfo|threads)`, `pjsip show (endpoints|endpoint <n>|aors|aor <n>|auths|contacts|registrations|transports|transport <n>|identifies|identify <n>|qualify <n>|channels|version)`, `pjsip list (endpoints|contacts|aors|auths|transports|identifies|registrations)`, `dialplan show( <ctx>)?`, `module show( like <m>)?`, `sorcery memory cache (show|stats) <n>`, `bridge show (all|<id>)`, `cdr show status`, `cel show status`, `manager show connected`, `ari show apps`, `odbc show( all)?`, `realtime show pgsql status`, `logger show channels` |
| active (cli.unsafe) | `pjsip reload`, `module reload <allowed module>`, `dialplan reload`, `pjsip qualify <n>`, `pjsip send register <n>`, `pjsip send unregister <n>`, `core restart gracefully`, `core restart when convenient` |
| never | `!` shell escapes, `core stop *`, `core restart now`, `module unload`, `database del*`, `originate` (test calls go through ARI only), `system`, anything not listed |

AMI user `echelons` (manager.conf): `read = system,call,agent,user,config,dtmf,reporting,cdr,dialplan`, `write = system,call,originate,reporting,command` (`command` is needed for CLI; the connector enforces the allowlist itself), `permit` = localhost only, plus `eventfilter`s to reduce the event volume.

## 7. Audit
`audit_logs(id, organization_id, user_id, ip, user_agent, action, object_type, object_id, object_label, old_value jsonb, new_value jsonb, result, error, request_id, created_at)`. Secret fields are masked as `"••••"` before old and new values are stored. The table is append-only: the app role has no UPDATE or DELETE on it, which is enforced by a GRANT and a trigger.
