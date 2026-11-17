#!/usr/bin/env bash
# Echelons Call Recording Platform — installer for Ubuntu 24.04 LTS (docs/09).
# Idempotent: safe to re-run. Never overwrites existing Asterisk config files;
# it backs them up and appends include lines only when missing.
#
# Usage: sudo ./deploy/scripts/install.sh --domain recording.example.com [--skip-asterisk-config] [--no-certbot]
set -euo pipefail

DOMAIN=""
SKIP_AST=0
CERTBOT=1
SRC_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_ROOT=/opt/echelons
REL="$APP_ROOT/releases/$(date +%Y%m%d%H%M%S)"
ETC=/etc/echelons
AST_ETC=/etc/asterisk
SPOOL=/var/spool/asterisk/recording

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --skip-asterisk-config) SKIP_AST=1; shift ;;
    --no-certbot) CERTBOT=0; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
[[ -n "$DOMAIN" ]] || { echo "--domain is required"; exit 2; }
. /etc/os-release
[[ "$ID" == "ubuntu" && "$VERSION_ID" == "24.04" ]] || echo "WARNING: tested on Ubuntu 24.04, found $PRETTY_NAME"

log() { echo -e "\e[1;34m==>\e[0m $*"; }
rand() { openssl rand -base64 "$1" | tr -d '\n'; }
rand_hex() { openssl rand -hex "$1"; }

log "Installing packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg postgresql postgresql-contrib redis-server nginx \
  unixodbc odbc-postgresql ffmpeg openssl jq >/dev/null
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
corepack enable >/dev/null 2>&1 || npm i -g pnpm >/dev/null
[[ $CERTBOT -eq 1 ]] && apt-get install -y -qq certbot python3-certbot-nginx >/dev/null

log "System users and directories"
id echelons >/dev/null 2>&1 || useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin echelons
getent group asterisk >/dev/null || groupadd --system asterisk
usermod -aG asterisk echelons
install -d -m 0750 -o root -g echelons "$ETC"
install -d -m 0700 -o echelons -g echelons /var/backups/echelons
install -d -m 2770 -o asterisk -g asterisk "$SPOOL"

# ---------------------------------------------------------------- secrets
ENV_FILE="$ETC/echelons.env"
CONN_ENV="$ETC/connector.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Generating secrets"
  DB_APP_PW=$(rand_hex 24); DB_PUB_PW=$(rand_hex 24); DB_RT_PW=$(rand_hex 24)
  AMI_PW=$(rand_hex 24); ARI_PW=$(rand_hex 24); CONN_TOKEN=$(rand_hex 32); REDIS_PW=$(rand_hex 24)
  cat > "$ENV_FILE" <<EOF
PRODUCT_NAME="Echelons Call Recording Platform"
PRODUCT_SHORT_NAME="Echelons"
DATABASE_URL=postgresql://echelons_app:${DB_APP_PW}@127.0.0.1:5432/echelons?schema=app
PUBLISHER_DATABASE_URL=postgresql://echelons_publisher:${DB_PUB_PW}@127.0.0.1:5432/echelons?schema=app
BACKEND_HOST=127.0.0.1
BACKEND_PORT=4000
PUBLIC_BASE_URL=https://${DOMAIN}
JWT_SECRET=$(rand 64)
ENCRYPTION_KEY=$(rand 32)
CONNECTOR_URL=http://127.0.0.1:4100
CONNECTOR_TOKEN=${CONN_TOKEN}
RECORDING_BASE_PATH=${SPOOL}
REDIS_URL=redis://:${REDIS_PW}@127.0.0.1:6379
LOG_LEVEL=info
# installer-internal (used for ODBC + AMI provisioning)
_DB_RT_PW=${DB_RT_PW}
_DB_PUB_PW=${DB_PUB_PW}
_DB_APP_PW=${DB_APP_PW}
_REDIS_PW=${REDIS_PW}
EOF
  cat > "$CONN_ENV" <<EOF
CONNECTOR_HOST=127.0.0.1
CONNECTOR_PORT=4100
CONNECTOR_TOKEN=${CONN_TOKEN}
ASTERISK_HOST=127.0.0.1
ASTERISK_AMI_PORT=5038
ASTERISK_AMI_USERNAME=echelons
ASTERISK_AMI_PASSWORD=${AMI_PW}
ASTERISK_ARI_URL=http://127.0.0.1:8088/ari
ASTERISK_ARI_USERNAME=echelons
ASTERISK_ARI_PASSWORD=${ARI_PW}
ASTERISK_CONFIG_DIR=${AST_ETC}
RECORDING_BASE_PATH=${SPOOL}
LOG_LEVEL=info
EOF
  chown root:echelons "$ENV_FILE"; chmod 0640 "$ENV_FILE"
  chown root:asterisk "$CONN_ENV"; chmod 0640 "$CONN_ENV"
fi
set -a; . "$ENV_FILE"; . "$CONN_ENV"; set +a

# ---------------------------------------------------------------- redis
log "Configuring Redis"
sed -i "s/^#\? *requirepass .*/requirepass ${_REDIS_PW}/" /etc/redis/redis.conf
sed -i 's/^bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
systemctl restart redis-server

# ---------------------------------------------------------------- postgres
log "Configuring PostgreSQL roles, database and schemas"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='echelons_app') THEN CREATE ROLE echelons_app LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='echelons_publisher') THEN CREATE ROLE echelons_publisher LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='asterisk_rt') THEN CREATE ROLE asterisk_rt LOGIN; END IF;
END \$\$;
ALTER ROLE echelons_app PASSWORD '${_DB_APP_PW}';
ALTER ROLE echelons_publisher PASSWORD '${_DB_PUB_PW}';
ALTER ROLE asterisk_rt PASSWORD '${_DB_RT_PW}';
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='echelons'" | grep -q 1 || sudo -u postgres createdb -O echelons_app echelons
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d echelons <<SQL
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION echelons_app;
CREATE SCHEMA IF NOT EXISTS asterisk AUTHORIZATION echelons_publisher;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d echelons -c "SET ROLE echelons_publisher" -f "$SRC_DIR/deploy/asterisk/sql/asterisk_realtime.sql"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d echelons <<'SQL'
-- Asterisk (asterisk_rt): read PJSIP config, write contacts (registrations) and CDR/CEL.
GRANT USAGE ON SCHEMA asterisk TO asterisk_rt;
GRANT SELECT ON ALL TABLES IN SCHEMA asterisk TO asterisk_rt;
GRANT INSERT, UPDATE, DELETE ON asterisk.ps_contacts TO asterisk_rt;
GRANT INSERT ON asterisk.cdr, asterisk.cel TO asterisk_rt;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA asterisk TO asterisk_rt;
-- Backend app role: read CDR/CEL for ingestion; NO access to ps_auths plaintext.
GRANT USAGE ON SCHEMA asterisk TO echelons_app;
GRANT SELECT ON asterisk.cdr, asterisk.cel TO echelons_app;
-- Publisher role reads app drafts.
GRANT USAGE ON SCHEMA app TO echelons_publisher;
ALTER DEFAULT PRIVILEGES FOR ROLE echelons_app IN SCHEMA app GRANT SELECT, UPDATE ON TABLES TO echelons_publisher;
SQL

# ---------------------------------------------------------------- asterisk
if [[ $SKIP_AST -eq 0 ]]; then
  log "Configuring Asterisk integration (existing files are backed up, never replaced)"
  [[ -d "$AST_ETC" ]] || { echo "Asterisk not installed ($AST_ETC missing). Install Asterisk 20/22 first or use --skip-asterisk-config."; exit 1; }
  BK="$AST_ETC/echelons-backup-$(date +%Y%m%d%H%M%S)"; mkdir -p "$BK"
  for f in sorcery.conf extconfig.conf res_odbc.conf cdr_adaptive_odbc.conf cel_odbc.conf; do
    if [[ -f "$AST_ETC/$f" ]] && ! cmp -s "$AST_ETC/$f" "$SRC_DIR/deploy/asterisk/$f"; then
      cp -a "$AST_ETC/$f" "$BK/"
      echo "  NOTE: $f exists and differs — saved to $BK. Review and merge deploy/asterisk/$f manually."
    elif [[ ! -f "$AST_ETC/$f" ]]; then
      install -m 0640 -o asterisk -g asterisk "$SRC_DIR/deploy/asterisk/$f" "$AST_ETC/$f"
    fi
  done
  sed "s/^Password    = .*/Password    = ${_DB_RT_PW}/" "$SRC_DIR/deploy/asterisk/odbc.ini.example" > /etc/odbc.ini
  chown root:asterisk /etc/odbc.ini; chmod 0640 /etc/odbc.ini
  for pair in "extensions.conf:extensions_echelons.conf" "pjsip.conf:pjsip_echelons_transports.conf"; do
    host="${pair%%:*}"; inc="${pair##*:}"
    touch "$AST_ETC/$inc"; chown asterisk:asterisk "$AST_ETC/$inc"; chmod 0640 "$AST_ETC/$inc"
    if ! grep -q "^#include $inc" "$AST_ETC/$host" 2>/dev/null; then
      [[ -f "$AST_ETC/$host" ]] && cp -a "$AST_ETC/$host" "$BK/"
      printf '\n; added by Echelons installer\n#include %s\n' "$inc" >> "$AST_ETC/$host"
    fi
  done
  if ! grep -q '^\[echelons\]' "$AST_ETC/manager.conf" 2>/dev/null; then
    cp -a "$AST_ETC/manager.conf" "$BK/" 2>/dev/null || true
    sed -n '/^\[echelons\]/,$p' "$SRC_DIR/deploy/asterisk/manager.conf.snippet" | sed "s/^secret = .*/secret = ${ASTERISK_AMI_PASSWORD}/" >> "$AST_ETC/manager.conf"
    echo "  NOTE: ensure [general] in manager.conf has enabled=yes and bindaddr=127.0.0.1"
  fi
  if ! grep -q '^\[echelons\]' "$AST_ETC/ari.conf" 2>/dev/null; then
    cp -a "$AST_ETC/ari.conf" "$BK/" 2>/dev/null || true
    sed -n '/^\[echelons\]/,$p' "$SRC_DIR/deploy/asterisk/ari.conf.snippet" | sed "s/^password = .*/password = ${ASTERISK_ARI_PASSWORD}/" >> "$AST_ETC/ari.conf"
  fi
  if grep -qE '^\s*load\s*=>\s*chan_sip' "$AST_ETC/modules.conf" 2>/dev/null; then
    echo "  WARNING: chan_sip is loaded in modules.conf; the platform uses PJSIP only."
  fi
  echo "  Asterisk config backup: $BK"
fi

# ---------------------------------------------------------------- build & deploy
log "Building release in $REL"
install -d -o echelons -g echelons "$APP_ROOT/releases"
rsync -a --delete --exclude node_modules --exclude .git --exclude '.env*' "$SRC_DIR/" "$REL/"
chown -R echelons:echelons "$REL"
sudo -u echelons -H bash -c "cd '$REL' && pnpm install --frozen-lockfile && pnpm -r build"
log "Database migrations + seed"
sudo -u echelons -H bash -c "set -a; . '$ENV_FILE'; set +a; cd '$REL/apps/backend' && npx prisma migrate deploy && node scripts/apply-sql.mjs && npx tsx prisma/seed.ts"
ln -sfn "$REL" "$APP_ROOT/current"

log "systemd services"
install -m 0644 "$SRC_DIR"/deploy/systemd/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now echelons-connector echelons-backend echelons-worker echelons-web

log "nginx"
sed "s/recording.example.com/${DOMAIN}/g" "$SRC_DIR/deploy/nginx/echelons.conf" > /etc/nginx/sites-available/echelons.conf
ln -sfn /etc/nginx/sites-available/echelons.conf /etc/nginx/sites-enabled/echelons.conf
rm -f /etc/nginx/sites-enabled/default
if [[ $CERTBOT -eq 1 && ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  # Temporary HTTP-only config so certbot can answer the challenge.
  systemctl stop nginx || true
  certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
fi
nginx -t && systemctl reload nginx

log "Done."
echo "  1. Reload Asterisk modules:  asterisk -rx 'module reload res_odbc.so' && asterisk -rx 'core reload'"
echo "  2. First-run setup: POST https://${DOMAIN}/api/setup/test, then /api/setup/complete (see README)."
echo "  3. Verify:  deploy/scripts/lab-verify.sh"
