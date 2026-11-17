#!/usr/bin/env bash
# End-to-end check against a REAL Asterisk server (docs/04 §8).
#   PBX objects → apply → Asterisk loaded them → dialplan present → test call → CDR → API
# Usage: API=https://recording.example.com USER=admin PASS='...' ./deploy/scripts/lab-verify.sh
set -euo pipefail
API="${API:?set API}"; USER="${USER:?set USER}"; PASS="${PASS:?set PASS}"
J='-H content-type:application/json'
ok() { echo -e "\e[32mOK\e[0m   $*"; }
fail() { echo -e "\e[31mFAIL\e[0m $*"; exit 1; }

TOKEN=$(curl -fsS $J -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" "$API/api/auth/login" | jq -r .accessToken) || fail "login"
A="Authorization: Bearer $TOKEN"; ok "login"

SERVER=$(curl -fsS -H "$A" "$API/api/asterisk/servers" | jq -r '.[0].id'); [[ "$SERVER" != null ]] || fail "no Asterisk server registered"
STATUS=$(curl -fsS -H "$A" "$API/api/asterisk/status?serverId=$SERVER")
[[ $(jq -r .connected <<<"$STATUS") == true ]] || fail "connector/AMI not connected: $STATUS"
ok "AMI connected — $(jq -r .version <<<"$STATUS")"

SITE=$(curl -fsS -H "$A" "$API/api/pbxs" | jq -r '.[0].site.id // empty')
if [[ -z "$SITE" ]]; then SITE=$(curl -fsS -H "$A" "$API/api/auth/me" >/dev/null; echo ""); fi

# Transport + lab PBX + trunk (loopback peer so no real PBX is required)
curl -fsS -H "$A" $J -d "{\"serverId\":\"$SERVER\",\"name\":\"lab-udp\",\"protocol\":\"udp\",\"bindAddress\":\"127.0.0.1\",\"bindPort\":15060}" "$API/api/pjsip/transports" >/dev/null || true
PBX=$(curl -sS -H "$A" "$API/api/pbxs" | jq -r '.[] | select(.code=="LAB") | .id')
if [[ -z "$PBX" ]]; then
  [[ -n "$SITE" ]] || SITE=$(curl -fsS -H "$A" "$API/api/asterisk/servers" | jq -r '.[0].siteId')
  PBX=$(curl -fsS -H "$A" $J -d "{\"siteId\":\"$SITE\",\"serverId\":\"$SERVER\",\"name\":\"Lab PBX\",\"code\":\"LAB\",\"vendor\":\"Generic\",\"host\":\"127.0.0.1\",\"inboundContext\":\"from-lab\"}" "$API/api/pbxs" | jq -r .id)
fi
TRUNK=$(curl -sS -H "$A" "$API/api/pbxs/$PBX/trunks" | jq -r '.[0].id // empty')
if [[ -z "$TRUNK" ]]; then
  TRUNK=$(curl -fsS -H "$A" $J -d '{"name":"LAB-TRUNK","host":"127.0.0.1","port":15061,"protocol":"udp","transportName":"lab-udp","authMode":"IP","sipMode":"PEER","inboundContext":"from-lab","qualifyFrequency":0}' "$API/api/pbxs/$PBX/trunks" | jq -r .id)
fi
ok "lab PBX/trunk present"

RES=$(curl -fsS -H "$A" $J -d "{\"serverId\":\"$SERVER\",\"summary\":\"lab-verify\"}" "$API/api/config/apply")
case $(jq -r .status <<<"$RES") in
  APPLIED|NO_CHANGES) ok "configuration applied (v$(jq -r .version <<<"$RES"))" ;;
  *) echo "$RES" | jq .; fail "apply failed" ;;
esac

OUT=$(curl -fsS -H "$A" $J -d "{\"serverId\":\"$SERVER\",\"command\":\"pjsip show endpoint LAB-TRUNK\"}" "$API/api/asterisk/cli" | jq -r .output)
grep -q "LAB-TRUNK" <<<"$OUT" && ok "Asterisk loaded endpoint LAB-TRUNK from realtime" || fail "endpoint not visible in Asterisk: $OUT"

OUT=$(curl -fsS -H "$A" $J -d "{\"serverId\":\"$SERVER\",\"command\":\"dialplan show from-lab\"}" "$API/api/asterisk/cli" | jq -r .output)
grep -q "from-lab" <<<"$OUT" && ok "generated dialplan context from-lab loaded" || fail "dialplan context missing"

echo "Lab verification passed. Place a call from a PBX into a configured route and check /api/calls for the CDR + recording."
