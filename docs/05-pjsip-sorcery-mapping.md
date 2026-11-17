# 05 — PJSIP / Sorcery Object Mapping

## 1. sorcery.conf (installed by `deploy/asterisk/sorcery.conf`)

```ini
[res_pjsip]
endpoint=realtime,ps_endpoints
auth=realtime,ps_auths
aor=realtime,ps_aors
domain_alias=realtime,ps_domain_aliases
contact=realtime,ps_contacts
system=realtime,ps_systems
global=realtime,ps_globals

[res_pjsip_endpoint_identifier_ip]
identify=realtime,ps_endpoint_id_ips

[res_pjsip_outbound_registration]
registration=realtime,ps_registrations
```

With `extconfig.conf` set to `ps_endpoints => odbc,asterisk` (and so on), every object type maps to
ODBC DSN `asterisk`, which points at PostgreSQL database `echelons`, schema `asterisk`.
Caching (`memory_cache` wizard) is configurable per object type from the **Sorcery** page.
When enabled, the publish step runs `sorcery memory cache expire <cache> <object>` (AMI
`SorceryMemoryCacheExpireObject`) for every changed object.

## 2. Object mapping

| UI object | app table | Sorcery type | Realtime table | Notes |
|---|---|---|---|---|
| Endpoint | sip_endpoints | endpoint | ps_endpoints | standard fields are columns; custom options go in `custom_params jsonb` and are spread into columns at publish |
| AOR | sip_aors | aor | ps_aors | static `contact` comes from sip_contacts |
| Auth | sip_auths | auth | ps_auths | `password` is AES-GCM encrypted in app and plaintext in `ps_auths` (Asterisk needs it). The DB role for the `asterisk` schema is separate and the schema is not readable by `echelons_app` except through the publisher function |
| Identify | sip_identifies | identify | ps_endpoint_id_ips | `match`, `srv_lookups`, `match_header`, `match_request_uri` (≥20) |
| Transport | sip_transports | transport | file `pjsip_echelons_transports.conf` | see §4 |
| Registration | sip_registrations | registration | ps_registrations | for PBXs that require Asterisk to register |
| Domain alias | sip_domain_aliases | domain_alias | ps_domain_aliases | |
| Globals | sip_globals | global | ps_globals | singleton `global` |
| Contact (dynamic) | — | contact | ps_contacts | written by Asterisk; read-only in UI |

## 3. SIP trunk = composite

A **SIP Trunk** is not an Asterisk object. TrunkManager expands it into:

```
trunk "AVAYA-PBX" (ip 192.168.51.10:5060/tcp, auth none, ctx from-avaya)
 ├─ endpoint  AVAYA-PBX        transport=transport-tcp, context=from-avaya, aors=AVAYA-PBX,
 │                              disallow=all, allow=ulaw,alaw, direct_media=no, …template
 ├─ aor       AVAYA-PBX        contact=sip:192.168.51.10:5060;transport=tcp, qualify_frequency=60
 ├─ identify  AVAYA-PBX        endpoint=AVAYA-PBX, match=192.168.51.10
 ├─ auth      AVAYA-PBX-auth   (only when auth=userpass; used as auth + outbound_auth)
 └─ registration AVAYA-PBX-reg (only when sip_mode=register)
```

Generated objects keep a `managed_by_trunk_id` back-reference. Editing the trunk regenerates
them, but **field-level overrides** that the admin made directly on the endpoint are kept
(stored in `overrides jsonb`, applied last).

Vendor templates (`trunk_templates`) are rows in the DB, not code. They hold
`{endpoint:{…}, aor:{…}, identify:{…}}` defaults. Seed templates ship for Generic SIP, Avaya,
Cisco, Mitel, Alcatel, NEC, Panasonic, Yeastar, 3CX, FreePBX and Generic IP-PBX. They are
suggestions, and every field can be edited.

## 4. Transports

`res_pjsip` does not support reloading transports at runtime: changes to bind, protocol or TLS
files need an Asterisk restart. Realtime transports also have known limitations. Echelons
therefore compiles transports into `pjsip_echelons_transports.conf`, which is `#include`d from
`pjsip.conf`. Changing a transport marks the server `restart_required=true`, and the UI offers
`core restart gracefully` (super admin only). Changes that only affect `local_net`/`external_*` still need a restart for the same reason.

## 5. Custom parameters

`custom_params` lets an admin set any catalog option that has no dedicated form field. The
validator checks the key against the catalog for the server's version and checks the value
against its type (`bool`, `enum`, `int[min,max]`, `string`, `list`, `codec_list`, `ip_list`).
On publish, these are merged into the row. If the `ps_*` table lacks the column (because the Asterisk
version is older than the schema), the publish fails validation with `UNSUPPORTED_PARAMETER`.

## 6. Import (existing servers, e.g. HotLync)

`/import/discover` runs through the connector:
* `PJSIPShowEndpoints` + `PJSIPShowEndpoint <name>` for each endpoint returns full option dumps (EndpointDetail, AorDetail, AuthDetail (password not returned), IdentifyDetail, TransportDetail).
* `PJSIPShowRegistrationsOutbound`.
* `dialplan show` returns a list of contexts. The parsed extensions are imported as *read-only external contexts* by default.

The admin picks objects in the UI. Imported rows are created as drafts with
`origin=imported`. Objects that came from `pjsip.conf` (wizard `config`) stay in the file until the
admin chooses **Migrate to realtime**. That step comments the object out of the file (with a backup),
publishes it to realtime and reloads, so the object is never defined twice.
