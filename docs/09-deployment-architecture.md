# 09 — Deployment Architecture

Target: **Ubuntu 24.04 LTS**. The single-host deployment is shown below. For multiple hosts, the connector runs on each
Asterisk host, and the app, PostgreSQL and Redis run on the app host.

```
┌──────────────────────────── Ubuntu 24.04 ─────────────────────────────┐
│ nginx :443 (TLS, HTTP/2)                                              │
│   /            → echelons-web.service      (Next.js, 127.0.0.1:3000)  │
│   /api, /api/ws→ echelons-backend.service  (Fastify, 127.0.0.1:4000)  │
│ echelons-worker.service    (BullMQ workers, same codebase)            │
│ echelons-connector.service (127.0.0.1:4100, runs as user 'asterisk'   │
│                             group, reads spool, writes 2 conf files)  │
│ asterisk.service (22.x from source or distro 20.x)                    │
│ postgresql@16-main  (db echelons; schemas app, asterisk)              │
│ redis-server        (127.0.0.1, requirepass)                          │
│ unixODBC + odbc-postgresql (Asterisk realtime + CDR)                  │
│ ffmpeg (transcode/waveform)                                            │
└───────────────────────────────────────────────────────────────────────┘
```

## Users & permissions
| User | Purpose | Access |
|---|---|---|
| `echelons` | backend, worker, web | `/opt/echelons`, `/etc/echelons/echelons.env` (0640 root:echelons), read on recordings (group `asterisk`) |
| `asterisk` | Asterisk + connector | `/etc/asterisk/extensions_echelons.conf`, `pjsip_echelons_transports.conf` (0640) |

## Files
```
/opt/echelons/                 release (symlink current → releases/<ver>)
/etc/echelons/echelons.env     secrets (never in git)
/etc/systemd/system/echelons-*.service
/etc/nginx/sites-available/echelons.conf
/var/backups/echelons/         config backups (0700)
```

## Install
`deploy/scripts/install.sh` is idempotent and does the following:
1. apt: postgresql-16, redis, nginx, unixodbc, odbc-postgresql, ffmpeg, nodejs 22 (NodeSource), certbot.
2. Creates DB roles `echelons_app`, `echelons_publisher` and `asterisk_ro`, plus DB `echelons` and schemas `app` and `asterisk`.
3. Loads `deploy/asterisk/sql/asterisk_realtime.sql` (ps_* + cdr + cel tables matching Asterisk's alembic schema for the installed major version).
4. Installs `/etc/odbc.ini`, `res_odbc.conf`, `extconfig.conf`, `sorcery.conf`, `cdr_adaptive_odbc.conf`, `cel_odbc.conf` and the `manager.conf`/`ari.conf` users with generated passwords, and adds the `#include` lines to `extensions.conf`/`pjsip.conf` (existing files are backed up first and never overwritten).
5. Generates `/etc/echelons/echelons.env` with random secrets.
6. `pnpm install --frozen-lockfile && pnpm build`, then `prisma migrate deploy`, then the SQL migrations, then seed (permissions, roles, call types, templates).
7. Enables the systemd units and nginx, and requests a certificate with certbot (or uses the provided certificate).
8. Prints the first-run wizard URL. The wizard creates the administrator account and stays locked after it is finished.

## Hardening checklist
* UFW: allow 443/tcp and SIP/RTP only from the PBX subnets (5060-5061, 10000-20000/udp). AMI, ARI, the connector, PostgreSQL and Redis listen on loopback only.
* systemd: `NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths` limited to what each service needs, and `PrivateTmp`.
* Backups: nightly `pg_dump` (custom format) plus the `/etc/asterisk` tar, rotated over 14 days. Recordings follow the retention policy and are backed up separately (S3 replication or NAS snapshots).
* Upgrades: `releases/<ver>`, `prisma migrate deploy`, a symlink flip, `systemctl restart`. Rollback is a flip of the symlink.
