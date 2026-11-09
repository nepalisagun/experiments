# Staygreen Q&A grading (15 answers, 5 questions)

Codebase: fresh clone of phuryn/staygreen at commit `e73a0df` (scratchpad `sg/`). Every claim below was checked by opening the cited file; line numbers are from that clone. Scores are 0-10: correctness (confirmed errors penalised by severity), completeness (against what the code shows), usefulness (for an engineer who must act on it).

## Score table

| Answer | Correctness | Completeness | Usefulness |
|---|---|---|---|
| 1A | 9 | 7 | 7 |
| 1B | 9 | 9 | 9 |
| 1C | 8 | 9 | 9 |
| 2A | 7 | 7 | 7 |
| 2B | 8 | 9 | 8 |
| 2C | 10 | 10 | 9 |
| 3A | 9 | 10 | 10 |
| 3B | 8 | 7 | 7 |
| 3C | 8 | 8 | 8 |
| 4A | 8 | 7 | 7 |
| 4B | 9 | 9 | 9 |
| 4C | 9 | 10 | 10 |
| 5A | 9 | 10 | 10 |
| 5B | 9 | 10 | 9 |
| 5C | 8 | 8 | 7 |

---

## Question 1: architecture and the path of one failed check

### Ground truth from the code

Separately deployed parts:
- **App** (Next.js dashboard, server actions, REST `/api/v1`, MCP `/mcp`): Netlify by default with two POST rate-limit edge functions (`netlify/edge-functions/member-rate.ts`, `public-rate.ts`), or any Node 22+ host (`docs/deploying.md:13`). Only it holds the Supabase secret key (`docs/architecture.md:48`).
- **Database**: Supabase Postgres; migrations define tables, functions and the restricted roles `probe`, `ingest`, `edge`, `alert_sender`, `watchdog` (`docs/deploying.md:61,65`).
- **Probes**: Node under systemd (`examples/probe/staygreen-probe.service`) on Linux VMs, docs suggest two DigitalOcean droplets (`docs/deploying.md:16`); locations `tor1 | sfo3 | fra1` (`probe/env.ts:10`, `probe/main.ts:11`), `fra1` must be Builder-only (`probe/env.ts:18`).
- **Status edge**: Node renderer on `127.0.0.1:7080` behind Caddy on a probe droplet, CPU/memory capped so it can't starve the probe (`examples/edge/staygreen-edge.service:1-25`); Caddy does TLS and on-demand certs via the app's `/api/edge/ask` (`examples/edge/Caddyfile:6-8`); Cloudflare proxies the status host (`docs/architecture.md:42`).
- **Three Cloudflare Workers** via their own uncached Hyperdrive: heartbeat ingest (`ingest/src/index.ts`, only `record_heartbeat`, `in.staygreen.io` per the header comment at line 4), alert sender (`sender/worker.ts`, cron `* * * * *` plus `POST /api/telegram/webhook`, `examples/sender/wrangler.toml:1-17`), watchdog (`watchdog/worker.ts`, minute cron, Durable Object receipts, reads `watchdog_flush_status`, messages an operator Telegram chat).
- CLI/stdio MCP package `packages/staygreen/` is a client, not a server. External: Clerk, Postmark, Telegram.

Failed-check flow:
1. Every probe ranks live, eligible probes per monitor by rendezvous hashing; rank 0 is the home; checks rotate through the ranking (`probe/schedule.ts:1-15,46-64`; `probe/runtime.ts:246-267`).
2. `tick` → `checkAndReport` → `runCheck` (`runtime.ts:513-562,456-509`). A failure is dropped if the network canary says the box is isolated (`runtime.ts:499`, `probe/canary.ts:76`).
3. `needsConfirmation` (`state.ts:70-75`) → `confirm()` asks other-location probes in ranking order (Builder: other continent first, `schedule.ts:72-80`) via HMAC-signed `POST /confirm` (`x-staygreen-sig`, `peer.ts:5-26`), all within 30 s (`runtime.ts:110,569-590`). Self re-check after 20 s only if no other location is live or all declined; live-but-silent peers → unconfirmed.
4. `deliver()` applies at home or queues; outbox flushed every 1 s via signed `POST /report` (`runtime.ts:181,605-638`).
5. `Store.apply` (`store.ts:303-415`): `probe_lock_monitor`, version/ordering fences, pure `step()`, `probe_commit_monitor` in one transaction. Confirmed fail → `down` + `open_incident`.
6. `probe_commit_monitor` (`20261023100000_service_monitors.sql:123-...`) writes the transition, closes any stale open incident, inserts the incident `"<name> is down"`, records `check_failures` (`:156-189`).
7. `AFTER INSERT OR UPDATE OF resolved_at` trigger `incidents_alert_events` inserts an `opened` `alert_events` row in the same transaction; unique `(incident_id, kind)` (`20261022195510_alerts_email.sql:120,209-239`).
8. Sender Worker cron → `runSender` through the `alert_sender` schema (`sender/worker.ts:22,67-77`): `alert_pending_events` → Clerk members → `alert_expand` (current def `20261023120000_alert_channels.sql:132-201`) → `alert_claim_channels` (`:273+`, 300 s lease, `skip locked`) → `deliverEmail` → Postmark with List-Unsubscribe (`src/lib/alerts/sender.ts:280-317`) → `alert_mark`; backoff 30 s..1 h, 8 attempts (`sender.ts:47-53`); lost answers reconciled via Postmark search after the lease (`sender.ts:336-358`).
9. Recovery: 2 passes → `down`→`up` closes the incident; trigger queues `resolved` only if the monitor is `up` (or `degraded` for a `down` incident) and an `opened` event exists (`alerts_email.sql:224-231`).

### 1A — C9 / Comp7 / U7
Confirmed errors:
- Presents a paraphrase as a quote: the edge unit says "The limits keep it from starving the probe on the same box", not "so it can't starve the probe on the same box" (`examples/edge/staygreen-edge.service:7`). Trivial.

Everything else checked out (locations in `probe/main.ts:11`; `checkAndReport` ~L540; 30 s and 20 s; `x-staygreen-sig`; `sendOutbox → sendReports` once a second; `Store.apply` ~L295-410; trigger ~L238; 300 s lease; Postmark search reconciliation; watchdog reads flush receipts).

Could not verify: "in.staygreen.io in production" exists only as a code comment (`ingest/src/index.ts:4`); `ingest/wrangler.toml` has `in.example.com`.

Missed: canary drop of failures from an isolated probe (`runtime.ts:499`); retry/backoff/`alert_mark` and the 8-attempt cap; that the trigger runs in the same transaction (an incident never exists without its alert); `resolved` alerts only go to channels that got `opened`; Caddy/on-demand TLS as its own moving part; the `alert_sender` restricted schema; almost no line citations, so harder to act on.

### 1B — C9 / Comp9 / U9
Confirmed errors (both minor citation staleness):
- Cites `alert_expand` at `20261022195510_alerts_email.sql:284-353`; that definition is superseded by `20261023120000_alert_channels.sql:132-201` (adds channel kinds and routing). The behaviour described still holds.
- Says `alert_claim` claims the receipts; the Worker (which passes `channels`) calls `alert_claim_channels` (`sender.ts:392`); the legacy `alert_claim` only claims email/Telegram (`alert_channels.sql:219`).

Verified: all docs line cites (`deploying.md:13,16,17,65,69,70`, `architecture.md:44,48`), `runtime.ts:246-267, 456-495, 499, 513-532, 569-590, 605-638`, `peer.ts:24`, `store.ts:14-17, 303-415`, `state.ts:64,70,88,95-107,125-131`, `service_monitors.sql:170-183`, `alerts_email.sql:120, 209-239, 224-231, 342-345`, `sender.ts:47-53, 185, 198, 202-210, 280-317, 344-358`, `postmark.ts:22`, `worker.ts:30`, watchdog `worker.ts:20-33`.

Could not verify: Caddy/Cloudflare deployment specifics (docs only; the answer says so).

Missed: the dashboard's inline `deliverNow` path (`src/lib/alerts/server.ts:25-27`); the stale "Netlify scheduled function" header in `alerts_email.sql:7-9`.

### 1C — C8 / Comp9 / U9
Confirmed errors:
- Headline arithmetic is inconsistent: "eight separately deployed parts: four processes you host yourself ... and three Cloudflare Workers, all sharing one Supabase Postgres" is 4 + 3 = 7; the table's eighth row is the database, which the sentence treats as separate. It also counts the Next.js app as "host yourself" while its own table says Netlify by default. Low to moderate: it muddles the headline answer.

Verified: rendezvous ranking and rotation (`schedule.ts:1-15`), `Probe.tick`/`checkHttp` (`runtime.ts:513-532, 468-482`), canary at `:499`, `POST /confirm` and `POST /report` (`peer.ts:5-17`), `store.ts:303-407`, incident title and inserts (`service_monitors.sql:160-185`), trigger (`alerts_email.sql:209-239`), `alert_sender` schema (`sender/worker.ts:22`), `alert_claim_channels` with 300 s lease, 8 tries, Postmark reconciliation (`sender.ts:20-45, 340-347`). The "Things to know" are real: `alerts_email.sql:7-9,23-25` still says Netlify scheduled function and server key, replaced by `20261023110000_alert_sender.sql` (027); `deliverNow` calls `runSender` for one event (`server.ts:26`); heartbeats skip confirmation (`runtime.ts:36-43`).

Missed: `resolved` alerts go only to channels that received `opened`; outbox flush cadence detail is present; little else.

---

## Question 2: when a website monitor opens and resolves an incident

### Ground truth from the code
- **Opens** on one confirmed round: first HTTP check fails at location A (dropped if the canary reads the box as isolated, `runtime.ts:499`), `needsConfirmation` is true for HTTP (`state.ts:70-75`), `confirm()` asks probes at **other locations** in ranking order (Builder prefers the other continent, `schedule.ts:72-80`) within one 30 s budget (`runtime.ts:110,569-590`). Second look fails → verdict `fail` → `down` + `open_incident` unless already `down` (`state.ts:116,125-131`). Second look passes → `blip`; nobody answers → `unconfirmed`; both change nothing and touch no streak (`state.ts:114-122`). Self re-check after 20 s only when no other location is live or every one declined (`runtime.ts:572-576,587`). So: 2 failing checks, 2 locations normally, at most ~30 s apart. No configurable count.
- What fails an HTTP check: bot-protection page, status not matching `expect` (default 2xx), missing keyword, failed/unparseable JSON assertion, network/DNS/TLS/protocol error, timeout default 15 s (`src/checks/http.ts:84-97, 225-253`; `runtime.ts:474,477`). Slow is still a pass (→ `degraded` after 3).
- Incident row: `"<name> is down"`, severity `down`, timeline "Check failed in X / Confirmed from Y, incident opened" (`store.ts:386-392`, `service_monitors.sql:181-183`). A stale open incident is closed first ("A new outage opened its own incident, this one closed", `:177-180`).
- **Resolves** after `RECOVERED_AFTER = 2` passes in a row while down (`state.ts:64,136-141`); `passStreak` is stored on the row (`store.ts:331-334`); a confirmed failure resets it (`:130`), noise does not. The `down→` transition closes the incident: "Two checks passed, incident closed" (`service_monitors.sql:164-168`). The trigger queues `resolved` only if state is `up` (or `degraded` with a `down` incident) and an `opened` event exists (`alerts_email.sql:224-231`).
- Other closures: HTTP/TCP/SSL/DNS **address change** only ("Address changed, incident closed", `20261022081211_monitor_edit_closes_incident.sql:103-108`); Stripe/Supabase edits via `save_service_monitor` ("Monitor edited and verified, incident closed", `service_monitors.sql:62-67`); a new outage closing a stale one. No manual resolve (every `resolved_at` writer is listed by grep); pause doesn't close (`store.ts:313-316`).

### 2A — C7 / Comp7 / U7
Confirmed errors:
- "The monitor is edited and the new settings pass a check: 'Monitor edited and verified, incident closed' (`service_monitors.sql` ~L66, added in `20261022081211_monitor_edit_closes_incident.sql`)". Wrong for a website monitor. That text is in `save_service_monitor`, which only handles `stripe`/`supabase` (`service_monitors.sql:24,62-67`), and the SQL closes on the edit itself, not after a passing check. The website-monitor rule in `081211` closes only when the **address** changes, with "Address changed, incident closed" (`:103-108`). Moderate: it misstates one of the two closure paths the question asks about.

Verified: two failures from two locations, 30 s, "blip"/"unconfirmed" as noise, 20 s self re-check with `recheckAfterSec ?? 20`, `evidenceOf` naming both locations, DNS/SSL/heartbeat differences, already-down still records `check_failures`, `RECOVERED_AFTER`, reset to 0, "Two checks passed" at ~L162-167, new-outage closure at ~L177-179, heartbeats recover on next good ping.

Missed: what counts as a failed HTTP check (timeout, status, keyword, assertions, bot page); the canary drop; the conditions on the `resolved` alert (state up/degraded and prior `opened`); that blip/unconfirmed do not reset `passStreak` (only implied); no manual resolve, pause doesn't close. Opens with filler ("Reading Staygreen's rules...").

### 2B — C8 / Comp9 / U8
Confirmed errors (minor):
- Lists "Editing the monitor (`081211:105-107`)" as closing the incident without saying it only happens when the target/address changes (`:103`); a rename or interval edit leaves the incident open. It also omits the separate service-monitor edit path.
- "Unconfirmed: ... no second location could look or answered within 30 s" contradicts its own correct statement above: when no other location can look (none live, or all declined) the probe re-checks itself rather than leaving it unconfirmed (`runtime.ts:576,587`).
- The resolved-email condition is garbled ("skipped if the monitor isn't back to `up`, or is `degraded` only when ...") and omits the requirement that an `opened` event exists (`alerts_email.sql:226-227`).

Verified: `confirmersFor` same-location filter (`schedule.ts:72-80`), first-answering location (`runtime.ts:579-586`), timeline text (`store.ts:386-392`), HTTP failure list (`http.ts:230-249`), defaults 2xx/15 s (`runtime.ts:474,477`), slow (`http.ts:251-253`), `state.ts:63,64,121-122,126-131,136-141`, `passStreak` on the row (`store.ts:331-334`), incident title/severity and stale-closure (`service_monitors.sql:170-183`). It honestly flags what it did not trace (pause, edit-triggered resolved email).

Missed: no manual resolve exists; Builder's other-continent preference.

### 2C — C10 / Comp10 / U9
Confirmed errors: none found.

Verified: failure list (`http.ts:85-96, 230-249`), 15 s timeout, slow → degraded, canary drop (`runtime.ts:499`), `CONFIRM_WITHIN_MS` (`:110`), Free vs Builder confirmer order and the same-location filter (`schedule.ts:72-80`), verdict table (`state.ts:114-131`), timeline and SQL lines, the 20 s self-check conditions including "all declined" (`runtime.ts:572-576,587`), live-but-silent peers stay unconfirmed (`:564-568`), null→down first check, recovery rules including "pass, unconfirmed, pass still recovers" (`state.ts:122`), address-change closure (`081211:97-109`) vs service-monitor verified edit (`service_monitors.sql:62-67`), pause doesn't close (`store.ts:313-316`), no manual resolve (`workspace.ts:141` is a lookup), resolved-alert conditions including the prior `opened` (`alerts_email.sql:224-231`).

Missed: minor. It doesn't say that further confirmed failures while already down are still written to `check_failures`.

---

## Question 3: plan limits and where they are enforced

### Ground truth from the code
- Table `limits` in `src/lib/plans.ts:73-110`: Free/Builder apps 1/10, monitors 50/100 (non-auto), status pages 1/10, HTTP/TCP/Supabase interval 3/1 min, MCP interval 10/5, Stripe poll 10/5 min, Stripe accounts 1/3, Supabase 1/cap, MCP 2/cap, locations tor1+sfo3 / +fra1, assertions 3/10, heartbeats 5/50, heartbeat assertions 1/5, per-host 5/"fair use", history label 30 days/1 year, API 30/120 per minute. `scale_demo` → 100 apps, 1000 monitors, 500 heartbeats, 100 pages (`:116-117`). Feature slugs are separate switches (`:11-19,147-164`).
- Plan resolution: dashboard from Clerk's verified session `has({feature})`, failures → `UNREAD` Free (`src/lib/session.ts:31-48`); API from Clerk billing subscription (`src/lib/api-entitlements.ts`); `SELF_HOSTED_PLAN=builder` (`self-hosted-plan.ts:5-10`), refused on staygreen.io (`env-schema.ts:130-134`); dev cookie override (`session.ts:51-89`).
- Enforcement: actions pass numbers as RPC args; SQL takes a workspace lock, counts and refuses: `create_monitor` (`20261022040000_heartbeat_url_sealed.sql:60-113`), `update_monitor` (`081211:37-84`), `save_service_monitor` (`service_monitors.sql:18-60`, interval set membership only: 60/180, 300/600), `create_app` (`apps_limit_and_logo.sql:54-68`), `create_status_page` (`phase1_dashboard.sql:409-421`), `verify_page_domain` (`status_edge.sql:175-196`, creates a DNS monitor), `clone_demo_page`, `agent_write` with `p_limits` (`agent_surface.sql:129-131`). The create action always sets the interval to the plan minimum (`actions.ts:240`). Locations via `eligible()` + `probe_builder_workspaces`. API budget via `agent_budget` (`agent-auth.ts:130`). Feature gates: `white_label`/`private_pages` in SQL (`phase1_dashboard.sql:466-469`), `notify_teammates` (action + SQL `teammates_required`), `alert_rules` (action + SQL `alert_rules_required`, `alert_channels.sql:71`), `history_1y` only in the agent API (`agent-service.ts:52,276`).
- Gaps: MCP limits and `subscribers` unenforced (MCP type refused, `subscribers: false` in `launch.ts:93`); downgrades keep existing items and intervals (`apps_limit_and_logo.sql:63-65`, `workspace-plan.ts:19`); status-page history is 30/90 regardless of plan (`phase1_dashboard.sql:181`). Non-plan limits: 100 active tokens (`agent_surface.sql:66`), 3 pending domains (`status_edge.sql:165-166`), fixed DNS ≥600 s and SSL = 21600 s.

### 3A — C9 / Comp10 / U10
Confirmed errors (minor):
- Marks "Stripe poll interval 10/5 min — Yes, SQL `interval_not_allowed`". The SQL accepts 300 **or** 600 for any plan (`service_monitors.sql:60`); the plan value is chosen by the action (`actions.ts:314`). The effect holds (nothing else lets a user choose), but the SQL does not enforce the plan.
- Cites `workspace-plan.ts:22` for the "slowing monitors remains deferred" comment; it is line 19. Trivial.

Verified: every number; `plans.ts:73-110, 116-117, 11-19, 145-162`; actions `:114, 230-252, 312-314, 361-364, 833, 874-875, 894-895, 984-985`; clone `:44-46`; agent-service `:52, 145, 197, 276`; agent-auth `:130`; SQL refusal codes and lines; `db-errors.ts`; tokens 100 and pending domains 3; downgrade comment in `apps_limit_and_logo.sql:63-65`; upgrade interval move (`workspace-plan.ts:8-16`); `workspace_history`/`monitor_history` take no plan argument; `architecture.md:50` on retention.

Missed: that the API path reads the plan from Clerk's billing API (`api-entitlements.ts`) rather than the session; SQL-side `alert_rules_required` and `teammates_required`; status-page history fixed at 30/90.

### 3B — C8 / Comp7 / U7
Confirmed errors:
- "There's also a fixed 120-per-minute check on each token or OAuth user at sign-in (L103, L115)". For tokens the admission budget is keyed by **workspace** (`agentHash("admission-token", data.workspace_id, ...)`, `agent-auth.ts:103`), not per token. Minor.
- "Custom domains. The same monitor and per-host numbers are passed when a domain is added (actions.ts ~L984)". They are passed when a domain is **verified**, because verification creates a DNS monitor (`status_edge.sql:187-193`); adding (`reserve_page_domain`) takes no plan numbers. Minor.

Verified: all table numbers, demo limits, feature slugs, `p_max_*` lines, `type_not_available` wording, `launch.ts` ~L93 subscribers deferred, `white_label_required`/`private_pages_required`, `eligible()`/`probe_builder_workspaces`, interval set to plan minimum and the upgrade move.

Missed: fixed per-type intervals (DNS ≥10 min, SSL 6 h, Supabase 60/180, Stripe 300/600); downgrade behaviour (existing items and 1-minute monitors kept); where `alert_rules` is enforced; non-plan limits (100 tokens, 3 pending domains); that the dashboard's history isn't plan-limited (it admits it didn't trace); the latest `create_monitor` definition isn't cited ("redefined in later migrations").

### 3C — C8 / Comp8 / U8
Confirmed errors (minor):
- Feature list says `alert_rules` "gives routing by severity, alert timing and maintenance windows" and `subscribers` "gives email subscribers (1,000 per page)" as if live. Alert timing and maintenance windows are off (`launch.ts:87-88`), and `subscribers` is deferred (`launch.ts:93`) with no enforcement anywhere. This overstates what Builder actually gets.
- Several line cites drift by 3-5 lines (`plans.ts:12-20,159-167` → 11-19, 164-174; `entitlementsFrom` at `144-157` → 147-162; `plans.ts:117-118` → 116-117). Trivial.

Verified: numbers; fair-use/cap resolution (`actions.ts:251,312`, `agent-service.ts:197`); fixed SQL intervals; `limits_required` (`heartbeat_url_sealed.sql:60-63`) and lock (`:65`); `update_monitor` re-checks (`081211:68-82`); app/page/service SQL lines; per-host in `save_service_monitor` (`:48`); `eligible()` (`schedule.ts:46-48`), `store.ts:212-220`, `deploying.md:24`; `actions.ts:240` always using the plan minimum (a good catch); MCP not creatable; `session.ts:51-89` dev override; env-schema refusal.

Missed: downgrade gaps; non-plan limits (tokens, pending domains); that the dashboard's history is not plan-limited (page `history_days` is 30/90 for everyone, `phase1_dashboard.sql:181`); Supabase interval following the HTTP plan minimum.

---

## Question 4: API token authentication, storage, read-only scope

### Ground truth from the code
- `requireAgent` (`src/lib/agent-auth.ts:86-138`) for both REST (`restRequest`) and MCP (`mcpRequest`) in `src/lib/agent-transport.ts`. `Bearer sg_` → `parseApiToken` regex `sg_<24 hex>.<43 base64url>` (`api-token-crypto.ts:11-14`) → select by `kid` (`agent-auth.ts:94`), DB error → 503 → `matchesApiToken` = HMAC-SHA256(`API_TOKEN_PEPPER`, `["staygreen/agent/v1","token",[workspaceId,secret]]`) compared with `timingSafeEqual`, an all-zero hash when no row (`api-token-crypto.ts:3-5,15-18`) → missing/wrong/revoked all 401 `invalid_token` (`agent-auth.ts:96-97`) → principal with the token's workspace, `actor = tok_…`, stored scope (`:98-101`) → 120/min admission budget keyed by workspace (`:103`) → `last_used_at` at most once a minute (`:104`). Non-`sg_` bearer: refused on REST (`:107`); on MCP verified as Clerk OAuth JWT with `/mcp` audience, live membership, always `scope: "write"` (`:108-126`). Then the plan budget 30/120 (`:129-130`), and with `SELF_HOSTED_PLAN=builder` `syncWorkspacePlan` (`:134-136`). Origin check after auth (`agent-transport.ts:26-31,73,112`), JSON only, 64 KiB, POST only.
- Storage: `public.api_tokens` (id, workspace_id, name, kid unique `^[0-9a-f]{24}$`, hash `^[0-9a-f]{64}$`, scope read/write, created_at, last_used_at, revoked_at), RLS on, grants only to `service_role` (`agent_surface.sql:5-13,53-59`). Plaintext returned once (`api-tokens.ts:38`); minting needs `tokens:manage`, a 10/min budget per member, `tok_` id from `request_id`, cap 100 active (`api-tokens.ts:26-39`, `agent_surface.sql:61-68`). Revoke sets `revoked_at` (`api-tokens.ts:40-46`). No token tools on the agent surface (`agent-transport.ts:14`).
- Read-only: `AGENT_PERMISSIONS.read = ["monitors:read"]` (`agent-contract.ts:13-15`); write tools are `provision_app`, `create_monitor`, `pause`, `draft_incident_update` (`:85`); `write()` calls `requireAgentPermission` first (`agent-service.ts:150-151`); `agent_write` refuses `p_scope <> 'write'` (`agent_surface.sql:126`) and re-checks the token row `revoked_at is null and scope='write' for share` (`:135-137`). Side effects of a read token: `last_used_at`, `agent_budgets`, best-effort `agent_calls` log, `scan_app` outbound scans (`agent-service.ts:217-219`), and in self-hosted mode a real `workspaces.plan` + monitor interval write (`workspace-plan.ts:6-21`).
- Note for all three: `executeAgentTool` parses the input with Zod (`agent-service.ts:214`) **before** calling `write()`, so the scope refusal does not come "before any input is parsed"; a malformed write from a read token gets 400, a well-formed one 403.

### 4A — C8 / Comp7 / U7
Confirmed errors:
- "A read token gets 403 insufficient_scope before any input is parsed". Input is parsed at `agent-service.ts:214` before `write()` runs. Minor.
- "The most a write token can do is draft an incident update." Misleading: write tokens can also `provision_app`, `create_monitor` and `pause` (`agent-contract.ts:85`). If it means "for incidents", it doesn't say so. Minor to moderate.

Verified: header routing and REST 401 text, regex shape, kid lookup and selected columns, `timingSafeEqual` with comparison on no row, same 401, actor = token id, the two budgets via `agent_budget`, `last_used_at` once a minute, `newApiToken` byte sizes, the hash formula, table columns, RLS/grants (`L53-59`), `tokens:manage` + 10/min, cap 100, `AGENT_PERMISSIONS`, `agent_write` L126/L136 and the mid-request revocation point.

Missed: `scan_app` is callable by read tokens and makes outbound requests; the `agent_calls` usage log; the origin/content-type/body-size hardening; the self-hosted plan-sync write; the list of write tools; that OAuth principals always get `write`.

### 4B — C9 / Comp9 / U9
Confirmed errors (minor):
- "A read token gets 403 insufficient_scope, before input parsing". Same issue (`agent-service.ts:214`).
- Cites `agent_surface.sql:127` for the `p_scope` check; it is line 126. Trivial.

Verified: routes and `agent-transport.ts` (origin check `:26-31`, POST/JSON `:115,33`, MCP POST `:74`), regex, lookup `:91-99` (actual 94-97), dummy all-zero hash, 503 on DB error, admission `:103`, plan budget `:130`, `last_used_at` `:104-105`, OAuth audience, live membership and `scope: "write"` `:125-126`, table and constraints, RLS/grants, plaintext once (`api-tokens.ts:38`), `tokens:manage` and 10/min, 100 cap, id from `request_id` (`:31`), `for share` revocation, listing never selects the hash (`:11,20-21`), `writeTools`, `agent_requests.tool` constraint (`:26`), side effects including `agent_calls` and `scan_app` (it honestly says it didn't read `scan.ts`).

Missed: the `SELF_HOSTED_PLAN=builder` sync, which is a real configuration write a read-only request can trigger (`agent-auth.ts:134-136`, `workspace-plan.ts:14-20`).

### 4C — C9 / Comp10 / U10
Confirmed errors (minor):
- "`write()` calls `requireAgentPermission` as its first line, before parsing input". True inside `write()`, but `executeAgentTool` already parsed the input (`agent-service.ts:214`). Minor.
- Several `agent-auth.ts` line cites are about 3 lines early (lookup `:91` → 94; 401 `:93-94` → 96-97; admission `:100` → 103; `last_used_at` `:101` → 104; REST refusal `:104` → 107). The content cited is right.

Verified: `api-token-crypto.ts:3-5,15-18`, the dummy hash, `API_TOKEN_PEPPER` as a 32-byte secret (`env-schema.ts:118`), a hash bound to the workspace, minting sizes and the "revoke and create another" message (`api-tokens.ts:34`), 100 cap (`agent_surface.sql:61-68`), revocation (`api-tokens.ts:40-46`), "tokens" unavailable in `MCP_INSTRUCTIONS` (`agent-transport.ts:14`), RLS/grants, `agent-contract.ts:13-18,85`, `agent_write` checks (`:126,135-138`), side effects including `agent_calls` (`agent-transport.ts:41-64`), `scan_app` (guarded fetch in `scan.ts:17,58,66`; `admitScan`), and the self-hosted `syncWorkspacePlan` write moving 180 s monitors to 60 s (`workspace-plan.ts:8-21`), which is a real finding.

Missed: nothing material. ("creates nothing" for `scan_app` ignores the scan-budget row, which is trivial.)

---

## Question 5: adding Microsoft Teams as an alert channel

### Ground truth from the code
Discord is the right template (pasted URL, sealed with `CREDENTIALS_KEY`, plain fetch from the sender Worker). The touch points, each confirmed:
- New migration: re-add `alert_channels_kind_check` (`20261023120000_alert_channels.sql:4-5`) and re-create `public.alert_expand` with `'teams'` in `c.kind in (...)` (`:185`; function `:132-201`). No change: `alert_channels_built` (`:6-8`), `alert_claim_channels` (`:273-330`, returns `kind` + `sealed` unfiltered), `alert_sender.alert_claim_channels` wrapper (`:356`); the legacy `alert_claim` deliberately claims only email/Telegram (`:219`). `database.types.ts` has no channel-kind union (no change needed).
- `src/lib/model.ts:217` `ChannelKind`; `src/lib/alerts/server.ts:33,81`.
- `src/lib/alerts/channel-input.ts`: `teamsUrl` next to `discordUrl` (`:15-21`), built on `webhookUrl` (`:5-13`); `channelInput.kind` (`:24`), `superRefine` (`:29-34`).
- `src/lib/alerts/providers.ts`: `sendTeams` modelled on `sendDiscord` (`:58-78`), `discordText` (`:29-35`); `SendResult` `sent` requires `messageId` (`outcome.ts:11`).
- `src/lib/alerts/sender.ts`: import (`:12`), kind list (`:363`), dispatch branch (`:377`), in-doubt handling (`:272`, `:339`), fallback "This kind of channel can't send yet." (`:387`). `sender/worker.ts:31` already passes `channels` (no change).
- `src/app/(app)/app/alerts/actions.ts`: import (`:7`), test-send queue list (`:223`), credential branch in `addWebhookChannel` (`:289`); `checkTarget` only runs for `webhook` (`:284-287`).
- UI: `ChannelSettings.tsx:18,47,54-59`; `AlertsScreen.tsx:33,98,361`; `ChannelIcon.tsx:4,6`.
- Copy/docs: `PlanTable.tsx:51`, `(public)/page.tsx:95`, `legal/privacy/page.tsx:168,270`, `scripts/clerk/billing.json:115`, `docs/deploying.md:26`, `examples/sender/wrangler.toml:2,38`, `budgets.ts:38` and `launch.ts:83` comments.
- Tests that mention Discord: `tests/unit/channels.test.ts`, `tests/unit/channel-actions.test.ts`, `tests/integration/channels.test.ts`, `tests/e2e/channels.auth.spec.ts` (not `channel-routing-screen.test.ts` or `alerts.test.ts`).
- Deploy order: migration, then sender Worker, then app (`docs/deploying.md:70`), or an old sender fails Teams receipts at `sender.ts:387`.

### 5A — C9 / Comp10 / U10
Confirmed errors (minor):
- Cites `sendDiscord` at `providers.ts:66-86`; it is `58-78`.
- Lists `tests/unit/channel-routing-screen.test.ts` among "the suites that already cover Discord"; that file never mentions Discord.

Verified: `CREDENTIALS_KEY` on both (`wrangler.toml:38`), all migration points and the "no change" list including `alert_sender.sql:21-51` wrappers and legacy `alert_claim` at `:219`, `channel-input.ts` lines, `server.ts:33,81` and the label helper (~`:121-125`), every `sender.ts` line, the `:387` fallback, `actions.ts:223,276-295,289`, all UI and copy lines, `budgets.ts:38`, deploy order, `messageId` → `providerId` (`sender.ts:255-259`), Slack threading (`:372-374`), `discordUrl` rejecting `u.search` (`channel-input.ts:17`), `webhookUrl` allowing explicit `:443` (`:9`), `checkTarget`/pinned transport for any-host URLs (`actions.ts:284-287`, `webhook.ts`).

Could not verify (outside the repo, flagged by the answer as its own knowledge): Workflows hosts (`*.logic.azure.com`, `*.powerplatform.com`), `sig`/`api-version` query parameters, `202 Accepted` with no id, Adaptive Card payload. These match Microsoft's published Workflows webhook format as I know it.

Missed: the `launch.ts:83` comment (trivial).

### 5B — C9 / Comp10 / U9
Confirmed errors (minor):
- Cites `sendDiscord` at `providers.ts:52-69`; it is `58-78`.
- "Otherwise an uncertain Teams send falls through to the email branch and is retried (`sender.ts:274`)". Loosely worded: `:274` is the generic log/`inDoubt` path (leave claimed), and the blind resend happens later at `:336-363` when the lease expires. The consequence (double send risk) is right.

Verified: latest migration `20261028220000_demo_clone_branding.sql`, `deploying.md:61`, kind check and `alert_expand` lines (`:4-5,185`, function ~`:140-200`), superseded copy in `alerts_email.sql`, `alert_channels_built` (`:8`), `alert_claim_channels` passthrough (`:296-314`), `channel-input.ts` lines, `outcome.ts` `messageId` requirement and `neverLeft(e,"manual")`, every `sender.ts` line, `worker.ts:31`, `actions.ts:7,223,277-298,289,283-286`, `budgets.ts:37-41`, `model.ts:217`, `server.ts:33,81`, `ChannelIcon.tsx:4,6`, UI lines, copy lines incl. `launch.ts:83`, tests (all four mention Discord), "what you do not need", rollout order and `alert_channels.sql:1-2`, `sender.ts:387`.

Could not verify: Teams URL format and response (the answer says so and hedges correctly).

Missed: less concrete than 5A on the Workflows URL shape (query parameters, `:443`), so the `teamsUrl` design is left open.

### 5C — C8 / Comp8 / U7
Confirmed errors:
- Instructs `teamsUrl` to "refuse query strings and other tricks, the same way `discordUrl` limits itself to discord.com". `discordUrl` does reject any query (`channel-input.ts:17`), but Teams Workflows webhook URLs carry required query parameters (`api-version`, `sp`, `sv`, `sig`), so this rule would reject every valid Teams URL. This is an external fact, not in the repo, but it is stated as a design instruction without a hedge. Moderate.
- Lists `tests/unit/alerts.test.ts` under "Extend the existing Discord cases"; that file contains no Discord case. Minor.

Verified: migration points (`L4-5`, `L185`, `L6-8`, `L273+`), `database.types.ts` conditional, `model.ts L217`, `server.ts L33/L81`, `channel-input.ts L15/L24/L30-31`, `providers.ts L29, L58-71`, `smallJson`/`mask`/`neverLeft`, all `sender.ts` lines, no change to `worker.ts`/`wrangler.toml` beyond comments `L2/L38`, `actions.ts L7/L223/L289`, UI and copy lines, `budgets.ts L38`, `launch.ts L83`, Slack `parentProviderId` threading.

Could not verify: Microsoft hosts and payload format (acknowledged).

Missed: deploy order (migration → sender Worker → app; otherwise `sender.ts:387` fails Teams receipts); the `messageId` problem: `sent` requires an id (`outcome.ts:11`), and a `sendDiscord`-style success check (`providers.ts:72`) would turn every id-less Teams reply into `unknown` and fail the receipt; the SSRF/host-pinning decision (`actions.ts:284-287`).

---

## Cross-answer notes
- Q4: all three repeat the same small inaccuracy ("refused before input is parsed"); `executeAgentTool` parses first (`agent-service.ts:214`). Only 4C found the self-hosted plan-sync write that a read token can trigger.
- Q2: only 2C gets both edit-closure paths right (address change for website monitors, any verified edit for Stripe/Supabase) and confirms there is no manual resolve.
- Q3: only 3A covers downgrade behaviour, non-plan limits and the history gap; 3C has the best single insight (`actions.ts:240`, interval always the plan minimum).
- Q5: 5A and 5B both flag the id-less Teams reply versus `SendResult.sent.messageId`; 5C misses it and gives URL advice that would break real Teams URLs.
