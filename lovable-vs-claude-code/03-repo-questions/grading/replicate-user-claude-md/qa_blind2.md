## Question 1

Give me an architecture overview: which separately deployed parts does Staygreen have, where does each run, and how does one failed website check travel from a probe to an alert email?

### Answer 1A

Staygreen has **eight separately deployed parts**: four processes you host yourself (the Next.js app, the probes, the status renderer, Caddy) and three Cloudflare Workers, all sharing one Supabase Postgres. A failed check reaches an alert email in four handoffs: probe → second probe → the monitor's "home" probe writes an incident → a database trigger queues an alert → the sender Worker emails it through Postmark.

I cloned it to `<BENCH>\repo\staygreen` (commit `e73a0df`). Nothing in your project was touched. Paths below are relative to the repo root.

## The deployed parts

| Part | Where it runs | Code / config |
|---|---|---|
| **Dashboard + API** (Next.js: member UI, REST, MCP) | Netlify by default; any Node 22+ host works | `src/app/`, `netlify.toml`; `docs/deploying.md` "What you need" table |
| **Database** | Supabase Postgres. It holds state, plus the functions and restricted roles each service is allowed to call | `supabase/migrations/` |
| **Probes** (run the checks) | At least two Linux VMs in different regions (the docs suggest DigitalOcean droplets, `tor1`/`sfo3`, with `fra1` optional for the Builder plan), each a systemd service | `probe/main.ts`, `examples/probe/staygreen-probe.service` |
| **Status edge** (renderer) | Node on loopback port 7080, behind Caddy, usually on one of the probe VMs | `edge/main.ts`, `examples/edge/` |
| **Caddy** | Same VM as the edge. It handles TLS and asks the app before issuing a certificate for a customer domain. Cloudflare proxies the status host in front of it | `examples/edge/Caddyfile` |
| **Heartbeat ingest Worker** | Cloudflare Worker reached through Hyperdrive | `ingest/src/index.ts`, `ingest/wrangler.toml` |
| **Alert sender Worker** | Cloudflare Worker on a one-minute cron, plus a Telegram webhook route | `sender/worker.ts`, `examples/sender/wrangler.toml` |
| **Watchdog Worker** | Cloudflare Worker on a one-minute cron, with a Durable Object for its receipts. It alerts an operator Telegram chat when a probe stops flushing | `watchdog/worker.ts`, `examples/watchdog/wrangler.toml` |

Clerk (sign-in, organizations, billing), Postmark (email) and Telegram are outside services (`docs/architecture.md:5-22`).

Each background service connects with its own restricted database login: `probe`, `ingest`, `edge`, `alert_sender` or `watchdog`. Only the app holds the Supabase secret key (`docs/architecture.md:48`, `docs/deploying.md` step 6).

## One failed HTTP check, from probe to inbox

1. **Scheduling.** Every probe ranks the live probes the same way for each monitor (rendezvous hashing). The top-ranked probe is the monitor's **home**, the only one that changes its state. Checks rotate through the ranking (`probe/schedule.ts:1-15`, `ranked`/`nextDue`).

2. **The check.** When the monitor comes due, `Probe.tick` runs `checkHttp` (`probe/runtime.ts:513-532`, `:468-482`).
   - If a failed result doesn't pass the network canary, it is dropped (`:499`). This is how a probe that has lost its own network avoids raising false alarms.

3. **Confirmation from a second location.** HTTP failures need a second opinion (`needsConfirmation`, `probe/state.ts`). The probe asks other live locations in turn with a signed `POST /confirm`, and needs an answer within 30 seconds (`probe/runtime.ts:569-590`, `probe/peer.ts:5-17`).
   - If no other location is live, it re-checks from itself after 20 seconds.
   - If no peer answers, the failure stays "unconfirmed" and counts for nothing.

4. **Hand-off to the home.** The outcome (first result plus confirmation) is applied directly if this probe is the home. Otherwise it goes in an outbox, and once a second the outbox is batched to the home over signed `POST /report` (`probe/runtime.ts:605-638`).

5. **State change and incident.** The home's `Store.apply` runs one transaction (`probe/store.ts:303-407`):
   - It locks the monitor row with `probe_lock_monitor` and checks version and ordering.
   - It runs the pure reducer `step()`. A confirmed failure while not down produces a move to `down` plus an `open_incident` effect (`probe/state.ts`, the `verdict === "fail"` branch).
   - It calls `probe_commit_monitor`, which inserts the `transitions` row, the `check_failures` rows and a new `incidents` row titled "\<name\> is down" (`supabase/migrations/20261023100000_service_monitors.sql:160-185`).

6. **Alert queued in the same transaction.** An `AFTER INSERT` trigger on `incidents` writes an `opened` row to the `alert_events` table. An incident therefore never exists without its pending alert, and a rolled-back one never sends (`supabase/migrations/20261022195510_alerts_email.sql:209-239`).

7. **The sender Worker delivers it.** Each minute the cron calls `runSender` through the `alert_sender` schema (`sender/worker.ts:68-79`, `src/lib/alerts/sender.ts:185-213`):
   - `alert_pending_events` finds the new event.
   - It reads the workspace's members from Clerk; addresses are never stored in the database.
   - `alert_expand` writes one receipt per channel and recipient into `alert_deliveries`.
   - `alert_claim_channels` claims receipts under a 300-second lease.
   - `sendEmail` sends through Postmark with List-Unsubscribe headers (`src/lib/alerts/sender.ts:280-317`).
   - `alert_mark` records the result. A failure retries with backoff, up to 8 tries.
   - If Postmark's answer was lost, the next sender searches Postmark for the receipt before resending, so the email isn't sent twice (`src/lib/alerts/sender.ts:20-45`, `:340-347`).

Recovery takes the same path. Two passes in a row move the monitor out of `down` (`RECOVERED_AFTER = 2`), `probe_commit_monitor` closes the incident, and the same trigger queues a `resolved` event.

## Things to know

- **Out-of-date migration header.** The header of `supabase/migrations/20261022195510_alerts_email.sql:7-9,23-24` says the sender runs "by a Netlify scheduled function" with the server's own key. Migration `20261023110000_alert_sender.sql` (027) replaced that with the `alert_sender` role, and `sender/worker.ts` is the actual runtime. The file says it must never be edited after it is applied, so the old comment is permanent; `docs/architecture.md` is the current description.
- **The dashboard also sends.** It calls the same `runSender` for a single event, for test sends from the dashboard (`src/lib/alerts/server.ts:26`). The Worker cron does the routine delivery.
- **Heartbeat monitors take a different first leg.** The ingest Worker only records pings with `record_heartbeat`. The home probe judges them and goes through the same reducer, incident and alert path, but with no second-location confirmation (`ingest/src/index.ts`, `probe/runtime.ts:36-43`).

### Answer 1B

Staygreen has six parts that are deployed separately, plus the Postgres database they share. The code is cloned at /tmp/staygreen, and nothing in your project was changed.

The separately deployed parts
Part	Code	Where it runs
Dashboard and API (Next.js app, MCP server at /mcp, REST API at /api/v1)	src/app/**	Netlify (netlify.toml: npm run build, the @netlify/plugin-nextjs adapter, rate-limit edge functions in netlify/edge-functions/). It uses Clerk for sign-in and billing.
Probes	probe/*.ts	Long-running Node processes under systemd on regional servers (examples/probe/staygreen-probe.service). Locations are tor1, sfo3 and fra1 (probe/main.ts).
Status renderer (public status pages, badges, widget script)	edge/*.ts	Node under systemd, listening on 127.0.0.1:7080 behind Caddy, with CPU and memory caps "so it can't starve the probe on the same box" (examples/edge/staygreen-edge.service). Cloudflare proxies the status host (docs/architecture.md).
Heartbeat ingest Worker	ingest/src/index.ts	Cloudflare Worker (ingest/wrangler.toml), in.staygreen.io in production. It reaches the database through Hyperdrive and may only call record_heartbeat.
Alert sender Worker	sender/worker.ts	Cloudflare Worker on a one-minute cron. It also takes Telegram's webhook at POST /api/telegram/webhook (examples/sender/wrangler.toml).
Watchdog Worker	watchdog/worker.ts	Cloudflare Worker on a one-minute cron, with a Durable Object that keeps its alert receipts. It messages an operator Telegram chat when a probe goes silent (examples/watchdog/wrangler.toml).
Database	supabase/migrations/*.sql	Supabase Postgres. Most of the business logic lives here as functions.
CLI and local MCP package (not a server)	packages/staygreen/	Runs on the user's machine and only calls the REST API.

Who holds which database access: only the app holds the Supabase secret key. The probes, status renderer and Workers each log in with their own restricted database role that can only run specific functions (docs/architecture.md, "Credentials and boundaries").

How one failed website check becomes an alert email
A probe runs the check. Each monitor has a "home" probe, picked by a ranking in probe/schedule.ts. When the check comes due, checkAndReport runs it (probe/runtime.ts ~L540).
Another location confirms it. If the check fails, confirm() asks the other live probes, one at a time, for a second look using askConfirm. These are HTTP requests signed with a shared secret (header x-staygreen-sig, probe/peer.ts), and they must finish within 30 seconds.
The probe re-checks the failure itself, after about 20 seconds, only when no other location is live or every peer says it can't open the monitor.
If no peer answers, the failure stays unconfirmed, and the state machine "counts it as nothing" (probe/runtime.ts, probe/state.ts header).
The result goes to the home probe. deliver() either applies the result locally, if this probe is the home, or queues it. Queued results are sent to the home once a second (sendOutbox → sendReports, probe/runtime.ts).
The home probe updates the monitor's state. Store.apply locks the monitor row (probe_lock_monitor), runs the state machine and calls probe_commit_monitor in one transaction (probe/store.ts ~L295–410).
Rule: a monitor turns down only when both checks failed, and that change opens an incident (probe/state.ts).
The current SQL version of that function is in supabase/migrations/20261023100000_service_monitors.sql. It writes transitions, inserts into incidents and check_failures, and closes any older incident still open.
The database queues the alert. A trigger named incidents_alert_events runs on every new incident and inserts an alert_events row with kind opened (supabase/migrations/20261022195510_alerts_email.sql ~L238).
The sender Worker picks it up. Its cron runs every minute and calls runSender (sender/worker.ts → src/lib/alerts/sender.ts):
alert_pending_events reads new events.
It looks up the workspace's members and their addresses from Clerk when sending (membersOf).
alert_expand writes one unique receipt per event, channel and recipient.
alert_claim / alert_claim_channels claim receipts with a 300-second lease, so two senders never send the same one.
Postmark sends the email (src/lib/alerts/postmark.ts).
Lost answers are not resent blindly. If Postmark's answer never arrives, the receipt stays claimed. After the lease ends, the sender searches Postmark for that message and sends again only if Postmark doesn't have it (comment block in src/lib/alerts/sender.ts).

When two passing checks in a row bring the monitor back up, the incident closes. The same trigger then queues a resolved event, which sends the all-clear email.

Side paths:

Missed heartbeats (a customer's scheduled job not checking in) don't use step 1. The ingest Worker records pings, and the home probe judges deadlines (probe/runtime.ts header, probe/heartbeat.ts).
Probe health is watched separately. The watchdog only reads flush receipts (probe_flush_with_receipt in probe/store.ts, watchdog_flush_status). It alerts the operator when a probe goes silent, not when a customer's site is down.

### Answer 1C

I cloned the repo to `<BENCH>\sg`. Nothing in your project was changed. The paths below are relative to that clone.

## Separately deployed parts

`docs/architecture.md:3-22` and the hosting table in `docs/deploying.md:9-20` list these parts:

| Part | Code | Where it runs |
|---|---|---|
| **Dashboard + REST/MCP API** (Next.js) | `src/app/`, `src/lib/` | Netlify, configured by `netlify.toml` and `netlify/edge-functions/` (rate limits). Any Node 22+ host also works (`deploying.md:13`) |
| **Database** | `supabase/migrations/*.sql` | Supabase Postgres. Most of the logic lives here as SQL functions and triggers (`deploying.md:14`) |
| **Identity and billing** | `src/lib/alerts/clerk.ts` etc. | Clerk, a hosted service (`deploying.md:15`) |
| **Probes** (check runners) | `probe/` | At least two Linux VMs in different regions, by default DigitalOcean droplets, run as a systemd service (`examples/probe/staygreen-probe.service`, `deploying.md:16`) |
| **Status edge** (public pages, badges, widget) | `edge/` | Runs with Caddy on one of the probe droplets, behind a Cloudflare-proxied hostname (`deploying.md:17`, `examples/edge/`) |
| **Heartbeat ingest Worker** | `ingest/` (`ingest/wrangler.toml`, name `monitoring-ingest`) | Cloudflare Workers + Hyperdrive |
| **Alert sender Worker** | `sender/worker.ts` (`examples/sender/wrangler.toml`, cron `* * * * *`) | Cloudflare Workers + Hyperdrive |
| **Watchdog Worker** | `watchdog/` (`examples/watchdog/wrangler.toml`, cron `* * * * *`) | Cloudflare Workers. It checks that the probes are still running, not customer sites (`architecture.md:36`) |
| **CLI / stdio MCP bridge** | `packages/staygreen/` | Runs on the user's machine and talks only to the API (`architecture.md:44`) |

Each background service logs into the database with its own restricted role. Only the app server holds the Supabase secret key (`architecture.md:30,48`).

## One failed website check, from probe to email

1. **First failure, on probe A.** `checkAndReport` runs the check (`probe/runtime.ts:540-543`). If the result needs confirmation, it calls `confirm(m)` (`runtime.ts:552`).
2. **Confirmation from another region.** `confirm` sends a signed `POST /confirm` to each other live probe in turn until one answers (`runtime.ts:569-589`; the endpoint is in `probe/peer.ts:9,72-86`). Probe A re-checks the site itself after about 20 s only in two cases: no other probe is live, or every peer said it can't run this monitor (`runtime.ts:572-576,587`). If peers simply don't answer, the failure stays unconfirmed and opens no incident (`runtime.ts:588`, `probe/state.ts:111`).
3. **State machine.** A confirmed failure moves the monitor to `down` and adds an `open_incident` effect (`probe/state.ts:17,92,104,128`).
4. **Write to Postgres.** The probe's store writes the transition and the incident in one call to `public.probe_commit_monitor(...)`. The incident timeline then reads "Confirmed from <place>, incident opened" (`probe/store.ts:384-403`). Measurements go up separately via `probe_flush_with_receipt`. Those receipts are what the watchdog reads (`store.ts:284`).
5. **Database trigger queues the alert.** The trigger `incidents_alert_events`, which runs after an insert on `public.incidents`, inserts an `alert_events` row of kind `'opened'` (`supabase/migrations/20261022195510_alerts_email.sql:209-239`). Resolving the incident later queues a `'resolved'` event the same way (lines 224-231).
6. **Sender Worker picks it up.** The cron fires every minute (`examples/sender/wrangler.toml:17`). The Worker connects through Hyperdrive as the `alert_sender` role and calls `runSender` (`sender/worker.ts:14-22,67-71`). `runSender` then:
   - reads pending events with `alert_pending_events` (`src/lib/alerts/sender.ts:198`);
   - fetches the workspace's members from Clerk (`sender/worker.ts:30`);
   - expands the event into one `alert_deliveries` row per recipient with `alert_expand` (`sender.ts:211`; SQL at `20261023120000_alert_channels.sql:132-175`);
   - claims deliveries under a lease with `alert_claim` (SQL at `alert_channels.sql:203`).
7. **Email through Postmark.** `sendEmail` posts the message to Postmark (`sender.ts:302`, `src/lib/alerts/postmark.ts`), and `alert_mark` records the outcome (`sender.ts:217`). Before resending a delivery whose result is unknown, the sender searches Postmark for the delivery id, so the email isn't sent twice (`sender.ts:31-42,344-357`).

Telegram, Slack and webhook alerts take the same route from step 6 onward, with their own claim and prepare functions (`alert_claim_channels`, `alert_prepare_webhook` in `20261023120000_alert_channels.sql`).

## Question 2

When exactly does a website monitor open an incident? How many failed checks, from how many locations, and what makes the incident resolve?

### Answer 2A

Reading Staygreen's rules for opening and closing incidents.

A website monitor opens an incident after two failed checks, from two different locations, within one round: one failing check, plus a failing second look. The incident closes after two passing checks in a row. All the logic is in the step() state machine in probe/state.ts.

When an incident opens
The first check fails at one location. For a website check, needsConfirmation() returns true, so the failure doesn't count on its own (probe/state.ts).
A second location re-checks it straight away. confirm() in probe/runtime.ts asks the other live probes, one at a time, using signed requests from probe/peer.ts. The first one to answer wins, and the whole thing must finish within 30 seconds.
The second look decides what happens:
It fails too: the verdict is "fail". If the monitor isn't already down, it moves to down and open_incident is recorded. The incident's evidence names both locations (evidenceOf, probe/state.ts).
It passes: the verdict is "blip". Nothing changes and no counters move ("Noise ... nothing moves").
No peer answers within 30 seconds: the verdict is "unconfirmed", which is also treated as noise. The one location that can't reach the site never opens an incident.
Exception: the probe re-checks the site itself. This happens only when no other location is live, or every peer says it can't open the monitor's secret headers. The probe waits about 20 seconds (recheckAfterSec ?? 20) and checks again. Two failures from the same location then count (probe/runtime.ts).

So there's no "N failures in a row" counter. A single confirmed round opens the incident. Two separate unconfirmed failures still don't open one.

Other monitor types work differently (same file):

DNS: never asks a second location. It needs two failing checks in a row (DNS_DOWN_AFTER = 2).
SSL: a bad certificate (failure.kind === "cert") goes down at once. A handshake that breaks off still needs confirmation.
Heartbeat: one bad result moves it to down at once. The grace window acts as the confirmation.

Already down: further confirmed failures don't open a second incident (if (s.state !== "down")). They're still saved as check_failures (probe/store.ts).

What makes it resolve
Two passes in a row (RECOVERED_AFTER = 2). Each pass while down adds 1 to passStreak. A confirmed failure in between resets it to 0. A passing check needs no second location.
The monitor's new state is up, or degraded if the last three passes were all slow (DEGRADED_AFTER = 3).
The incident closes in the same transaction as the move out of down. probe_commit_monitor sets resolved_at with the timeline note "Two checks passed, incident closed" (supabase/migrations/20261023100000_service_monitors.sql ~L162–167).
The same rule queues the all-clear alert. The incidents_alert_events trigger fires on the resolved_at update and queues a resolved event for the alert sender (supabase/migrations/20261022195510_alerts_email.sql ~L220–240).
Heartbeats are the exception: they recover on the next good ping, not after two (probe/state.ts header).

Incidents also close in two other ways:

The monitor is edited and the new settings pass a check: "Monitor edited and verified, incident closed" (supabase/migrations/20261023100000_service_monitors.sql ~L66, added in 20261022081211_monitor_edit_closes_incident.sql).
A newer outage opens its own incident while an old one is still open. The old one closes with "A new outage opened its own incident, this one closed" (same file, ~L177–179).

### Answer 2B

**Short answer:** a website (HTTP) monitor opens an incident when **one check fails and an immediate re-check from a different location also fails**. That is two failing checks from two locations, about 30 seconds apart at most. The incident closes after **two passing checks in a row**. It also closes when the monitor's address is edited. The code has no "resolve" button.

## What counts as a failed check

`checkHttp` fails on any of these (`src/checks/http.ts:85-96`, `:230-249`):
- **Network errors:** DNS, connection refused or reset, timeout, TLS failure, or an invalid HTTP response.
- **Wrong status:** the status doesn't match `expect`, which defaults to `2xx`.
- **Missing keyword:** the configured keyword isn't in the response.
- **Failed JSON assertion.**
- **Bot protection:** a bot-protection page counts as a status failure.

The timeout defaults to 15 seconds (`probe/runtime.ts:477`). A slow response is still a pass: three slow passes in a row make the monitor `degraded`, which does not open an incident (`probe/state.ts`, `DEGRADED_AFTER = 3`).

## Opening: one failure, confirmed from a second location

1. **First failure.** The probe whose turn it is gets a failing result. If this probe can't reach its own canaries (the network-health check), it throws the failure away, so a probe that lost its network opens nothing (`probe/runtime.ts:499`).

2. **Second look, straight away.** HTTP failures always need confirmation (`needsConfirmation`, `probe/state.ts`). The probe asks probes **at other locations** in turn, using signed `POST /confirm`, and needs an answer within 30 seconds (`CONFIRM_WITHIN_MS`, `probe/runtime.ts:110`, `:569-590`).
   - Free monitors use their other location.
   - Builder monitors ask a probe on the other continent first and keep the rest as fallbacks (`confirmersFor`, `probe/schedule.ts`).
   - A probe at the same location never confirms (`.filter((p) => p.location !== self.location)`).

3. **The verdict** (`step()`, `probe/state.ts`):

   | First check | Second look | Verdict | Effect |
   |---|---|---|---|
   | fail | fail | `fail` | Moves to `down` and **opens an incident**, unless it is already down |
   | fail | pass | `blip` | Nothing changes |
   | fail | nobody answered within 30 s | `unconfirmed` | Nothing changes |

   A blip or an unconfirmed failure leaves the state untouched, and neither counts toward any streak. One location's noise therefore never opens an incident.

4. **Writing it.** The monitor's home probe commits the result in one transaction. `probe_commit_monitor` inserts the incident titled "\<name\> is down" with evidence from both locations. The timeline reads "Check failed in X", then "Confirmed from Y, incident opened" (`probe/store.ts:386-392`, `supabase/migrations/20261023100000_service_monitors.sql:170-183`). If an older incident is somehow still open, it is closed first and the new outage gets its own row (`:174-179`).

**Exceptions to "two locations":**
- **Only one location is live.** If no other location is live, or every other one answers that it can't open the monitor's secret headers, the probe re-checks **from itself after 20 seconds**. Two failures from the same box then open the incident (`probe/runtime.ts:572-576`, `:587`; `docs/deploying.md` "The smallest installation").
- **Other locations are live but none answers.** That is not treated as "no other location": the failure stays unconfirmed (`probe/runtime.ts:564-568`).
- **A monitor that has never passed.** A confirmed failure moves it from `null` straight to `down` and opens an incident too, because the `fail` branch only checks `s.state !== "down"`.

**How long it takes:** at most one check interval for the failing check to come due, plus up to 30 seconds for confirmation. The 20-second self-re-check applies only in the one-location case.

## Resolving

**1. Two passes in a row (the normal path).** While the monitor is `down`, each pass adds one to `passStreak`. At 2 (`RECOVERED_AFTER = 2`), the monitor moves to `up`, or to `degraded` if the last three passes were slow (`probe/state.ts`). The commit sees a transition out of `down` and closes the incident with the timeline entry "Two checks passed, incident closed" (`supabase/migrations/20261023100000_service_monitors.sql:164-168`).
- **Passes need no confirmation.** Checks rotate through the probes, so the two passes usually come from different locations, but nothing requires that.
- **A confirmed failure** resets `passStreak` to 0.
- **A blip or unconfirmed failure leaves the streak alone.** So pass, then unconfirmed failure, then pass still recovers the monitor (`verdict === "unconfirmed" || "blip"` returns the state unchanged).

**2. Editing the monitor's address.** Changing the target clears the monitor's state and closes its open incident: "Address changed, incident closed" (`supabase/migrations/20261022081211_monitor_edit_closes_incident.sql:97-109`). Service monitors (Stripe, Supabase) close theirs on any verified edit (`supabase/migrations/20261023100000_service_monitors.sql:62-67`).

**What doesn't close an incident:**
- **Pausing.** A paused monitor isn't scheduled, its state is kept, and the store refuses outcomes for it (`probe/store.ts:313-316`, `supabase/migrations/20261021212020_phase1_ack_and_pause.sql`).
- **A manual resolve.** I found none. `resolveIncident` in `src/lib/workspace.ts:141` only looks an incident up, and the incident actions in `src/app/(app)/app/actions.ts:712-750` are about drafts and updates.

When the incident closes, the trigger on `incidents` queues a `resolved` alert. It does so only if an `opened` alert was queued for that incident, and only if the monitor is now `up`, or `degraded` after a `down` incident (`supabase/migrations/20261022195510_alerts_email.sql:224-231`).

### Answer 2C

A website (HTTP) monitor opens an incident on one confirmed failure: two failed checks, normally from two different locations. It does not count a run of failures. The incident resolves after two passing checks in a row. The rules are in the pure state machine `probe/state.ts`, and the database applies them in `probe_commit_monitor`.

## When an incident opens

1. **The first failure from one location triggers a confirmation check right away.** Any failed HTTP check needs confirmation (`needsConfirmation`, `probe/state.ts:70-75`). The probe that saw it asks the other live probes, one at a time, to check the site again (`probe/runtime.ts:552,569-586`). All of this must finish within `CONFIRM_WITHIN_MS` (`runtime.ts:577`).
2. **What the second check decides** (`probe/state.ts:114-131`):
   - **Second location also fails:** the verdict is `"fail"`. The monitor moves to `down` and an `open_incident` effect is emitted at once (`state.ts:116,125-129`). So the incident opens on exactly two failed checks.
   - **Second location passes:** the verdict is `"blip"`. Nothing changes: it doesn't count as a failure and doesn't break a pass streak (`state.ts:14-16,122`).
   - **No second result:** the verdict is `"unconfirmed"` and is also ignored (`state.ts:111-113,117,122`; `runtime.ts:588`). This happens when peers exist but didn't answer in time, for example because they were restarting or rejected the signature.
3. **Fallback when only one location can look.** Sometimes no other probe is live, or every peer said it can't run this monitor. Then the same probe checks again itself after `recheckAfterSec`, 20 s by default (`runtime.ts:572-576,587`). In that case both failures come from one location, and the timeline just says "Incident opened" instead of "Confirmed from X" (`probe/store.ts:387-391`).
4. **In the database.** `probe_commit_monitor` closes any incident still open for that monitor, then inserts a new `incidents` row titled "<name> is down" with severity `down` (`supabase/migrations/20261023100000_service_monitors.sql:170-183`). That insert fires the trigger that queues the `opened` alert (`20261022195510_alerts_email.sql:218-222,237-239`).

Failures while the monitor is already `down` don't open another incident (`state.ts:126`).

## Other monitor types (for contrast)

- **DNS:** no second location. It needs two failing checks in a row (`DNS_DOWN_AFTER = 2`, `state.ts:9-10,65,118`).
- **SSL with an invalid certificate:** down at once. An unreachable handshake is still confirmed from another location (`state.ts:10-11,74`).
- **Heartbeats:** a missed deadline or failure goes down at once (`state.ts:24-28,95-106`).
- **Slow responses** never open an incident. Three slow passes in a row only mark the monitor `degraded` (`state.ts:12-13,63`).

## What resolves it

- **Two passing checks in a row** (`RECOVERED_AFTER = 2`, `state.ts:17-18,64,136-141`). The first pass while down only increments `passStreak`, and the second moves the monitor to `up`. If the last three passes were slow, it moves to `degraded` instead.
  - Any transition out of `down` sets `resolved_at` and adds "Two checks passed, incident closed" to the timeline (`20261023100000_service_monitors.sql:164-168`).
  - The trigger then queues a `resolved` alert. It does so only if the monitor is now `up` (or `degraded` and the incident's severity was `down`), and only if an `opened` alert exists for that incident (`20261022195510_alerts_email.sql:224-231`).
- **Editing the monitor** closes an open incident: "Monitor edited and verified, incident closed" (`20261022081211_monitor_edit_closes_incident.sql:105`; the service-monitor version is `20261023100000_service_monitors.sql:66-67`). A version change also resets the counters (`state.ts:19-20`).
- **A new outage** closes the old open incident, if one is somehow still open, and opens its own (`20261023100000_service_monitors.sql:174-180`).

Pausing doesn't resolve anything. A paused monitor isn't scheduled, and it keeps its state (`state.ts:22`).

## Question 3

What are the limits of each plan (monitors, apps, status pages, check intervals and anything else), and where in the code are they enforced?

### Answer 3A

There are two plans, Free and Builder, plus a private demo plan the owner uses for demo status pages. Every number comes from one table in src/lib/plans.ts. The plan is worked out from the user's Clerk Billing features, and anything Clerk can't confirm falls back to Free.

The limits (src/lib/plans.ts, limits)
Limit	Free	Builder
Apps	1	10
Monitors	50	100
Status pages	1	10
Fastest HTTP/TCP/Supabase check interval	3 min	1 min
Fastest MCP check interval	10 min	5 min
Fastest Stripe check interval	10 min	5 min
Stripe accounts	1	3
Supabase monitors	1	up to the monitor limit
MCP monitors	2	up to the monitor limit
Locations	Toronto, San Francisco	+ Frankfurt
Assertions per HTTP monitor	3	10
Heartbeats	5	50
Assertions per heartbeat	1	5
Monitors per host	5	no number ("fair use"), so the monitor limit
History	30 days	1 year
API and MCP calls per minute	30	120
Feature switches: Builder also holds white_label, private_pages, subscribers, alert_rules, history_1y and notify_teammates (builderSlugs). Each is checked separately.
Demo plan (demoLimits, feature scale_demo): Builder's numbers, raised to 100 apps, 1000 monitors, 500 heartbeats and 100 status pages.
Where each limit is enforced

The app reads the numbers and passes them to database functions, which do the counting and refuse in the same transaction. The plan's numbers live in the app code, not in the database (plans.ts header comment).

Monitors, heartbeats, assertions, per-host limit, minimum interval. Server actions in src/app/(app)/app/actions.ts pass p_max_monitors, p_max_heartbeats, p_max_assertions, p_max_heartbeat_assertions, p_per_host and p_min_interval_sec (~L246–252 for create, ~L361–364 for edit). The SQL raises monitor_limit, heartbeat_limit, assertion_limit, host_limit or interval_not_allowed. These checks date from supabase/migrations/20261021210216_phase1_dashboard.sql and were redefined in later migrations. src/lib/db-errors.ts turns each refusal into a sentence for the user.
Stripe and Supabase monitor counts. p_max_type (actions.ts ~L312) feeds the service_monitor_limit check in supabase/migrations/20261023100000_service_monitors.sql. The same file holds the current monitor_limit and host_limit count queries.
Apps. p_max_apps (actions.ts ~L114) feeds app_limit in 20261022124400_apps_limit_and_logo.sql.
Status pages. p_max_pages (actions.ts ~L833) feeds page_limit.
Custom domains. The same monitor and per-host numbers are passed when a domain is added (actions.ts ~L984).
Demo cloning. It passes all of these limits at once (src/app/(app)/app/clone/[slug]/actions.ts ~L44).
Agent and REST writes. agent_write gets the whole limit set as p_limits, including minInterval (src/lib/agent-service.ts ~L197).
Check interval. New monitors are created at the plan's fastest interval (actions.ts p_interval_sec, agent-service.ts ~L145). On upgrade, src/lib/workspace-plan.ts moves monitors still at Free's 3 minutes down to 1 minute.
Frankfurt (Builder only). Enforced by the probes, not the app. Frankfurt is a Builder-only probe, and eligible() in probe/schedule.ts keeps Free monitors off such probes. The probes learn a workspace's plan from probe_builder_workspaces (migration 20261024090000_workspace_plan.sql).
History. Capped at 30 days without history_1y, 365 with it (src/lib/agent-service.ts ~L52 and ~L276). I only traced this for the agent and API; I didn't trace the dashboard's history screens.
API and MCP calls per minute. Enforced per workspace by deps.budget(..., entitlements.limits.apiPerMin) (src/lib/agent-auth.ts ~L130). There's also a fixed 120-per-minute check on each token or OAuth user at sign-in (L103, L115), regardless of plan.
White label and private pages. Passed as p_white_label and p_private_pages when a status page is saved (actions.ts ~L874, ~L922). The SQL refuses with white_label_required or private_pages_required (worded in db-errors.ts ~L80).
Notify teammates. Gates alert addresses that aren't members' (src/app/(app)/app/alerts/actions.ts ~L117).
Gaps in the code
MCP limits aren't enforced anywhere. mcpMonitors and mcpIntervalMin are only used in plans.ts and the screens that show them. MCP monitors appear not to be on sale yet: type_not_available reads "That kind of monitor isn't available yet." (db-errors.ts).
Email subscribers are turned off. They're marked as deferred beyond launch (src/lib/launch.ts ~L93), so that feature switch currently gates nothing that works.

### Answer 3B

Staygreen has two plans, **Free** and **Builder**. Every number lives in one table, `limits` in `src/lib/plans.ts:73-110`. The server actions read it and pass each number as a `p_max_*` argument to a SQL function. That function locks the workspace row, counts what exists, and raises an exception when a limit would be exceeded.

## The limits (`src/lib/plans.ts:73-110`)

| Limit | Free | Builder |
|---|---|---|
| Apps (one status page each) | 1 | 10 |
| Status pages | 1 | 10 |
| Monitors (automatic ones not counted) | 50 | 100 |
| Heartbeats | 5 | 50 |
| Monitors per host (SSL excluded) | 5 | "fair use", which in practice means the monitor cap |
| HTTP/TCP/Supabase check interval | 3 min | 1 min |
| MCP monitor interval | 10 min | 5 min |
| Stripe poll interval / Stripe accounts | 10 min / 1 | 5 min / 3 |
| Supabase monitors | 1 | "cap", i.e. up to the monitor limit |
| MCP monitors | 2 | "cap" |
| Assertions per HTTP monitor | 3 | 10 |
| Assertions per heartbeat | 1 | 5 |
| Check locations | Toronto and San Francisco (`tor1`, `sfo3`) | adds Frankfurt (`fra1`) |
| History | 30 days | 1 year |
| Agent API (MCP/REST) calls | 30/min | 120/min |

Two limits don't depend on the plan, and the SQL enforces both: DNS checks can't run more often than every 600 s, and SSL checks run exactly every 21,600 s (6 h) (`supabase/migrations/20261022040000_heartbeat_url_sealed.sql:101-105`).

**Feature switches.** Builder also gets seven separate Clerk features: `white_label`, `private_pages`, `subscribers`, `alert_rules`, `history_1y`, `notify_teammates`, and `scale_builder`. Only `scale_builder` selects the Builder numbers; each of the others is a separate on/off switch (`plans.ts:11-19,145-162`, `scripts/clerk/billing.json:200-221`). Pricing: Builder is $9/month, or $7.50/month billed annually (`billing.json:201-202`).

**Hidden and self-hosted variants:**
- A private demo plan (`scale_demo`) raises the counts to 100 apps, 1,000 monitors, 500 heartbeats and 100 pages (`plans.ts:116-117`).
- Self-hosting with `SELF_HOSTED_PLAN=builder` grants every Builder feature at the normal Builder limits (`src/lib/self-hosted-plan.ts:5-10`).

## How the plan is decided

`entitlementsFrom` converts the session's Clerk feature checks into a plan. It fails toward Free: if Clerk can't answer for `scale_builder`, the request is treated as Free and marked `unread` (`plans.ts:3-5,134-161`). The screens read the numbers through `limitsOf` (`plans.ts:121`), but that only shows them. The actual checks happen in the next section.

## Where each limit is enforced

- **Monitors, heartbeats, assertions, per-host count, and HTTP/TCP interval.** `createMonitor` sends `p_max_monitors`, `p_max_heartbeats`, `p_max_assertions`, `p_max_heartbeat_assertions`, `p_per_host` and `p_min_interval_sec` to `create_monitor` (`src/app/(app)/app/actions.ts:229-254`). The SQL then raises:
  - `monitor_limit`, `heartbeat_limit` and `assertion_limit` (`20261022040000_heartbeat_url_sealed.sql:82-99`);
  - `interval_not_allowed` (lines 101-105);
  - `host_limit` (lines 107-113).

  Monitor edits go through the same assertion, interval and host checks (`actions.ts:361-362`; `20261022081211_monitor_edit_closes_incident.sql:69-82`).
- **Stripe and Supabase monitors.** `saveServiceMonitor` passes the monitor cap, a per-type cap (Stripe accounts, or Supabase monitors), and the plan's interval (`actions.ts:307-315`). The SQL raises `monitor_limit` and `service_monitor_limit`, and it accepts only a 300 s or 600 s Stripe interval (`20261023100000_service_monitors.sql:33-34,60`).
- **Apps.** `p_max_apps` is passed at `actions.ts:114`, and the SQL raises `app_limit` (`20261022124400_apps_limit_and_logo.sql:67`). `src/lib/upgrade.ts:86` only decides whether the "add app" button is shown.
- **Status pages.** `p_max_pages` is passed at `actions.ts:833`, and the SQL raises `page_limit` (`20261021210216_phase1_dashboard.sql:420`).
- **Custom domains.** The plan's monitor and per-host limits are passed at `actions.ts:984-985`. Pending domains have their own cap, `pending_domain_limit` (`20261024100000_status_edge_hosts.sql:21`).
- **Cloning a demo page.** All the caps are passed at once (`src/app/(app)/app/clone/[slug]/actions.ts:44`).
- **Agent API rate.** `budget(..., entitlements.limits.apiPerMin)` is applied per workspace (`src/lib/agent-auth.ts:130`). The API tokens themselves are capped by `token_limit` (`20261023150000_agent_surface.sql:66`).
- **Frankfurt location.** The probes enforce this one. A Builder-only probe checks only Builder workspaces' monitors (`eligible`, `probe/schedule.ts:46-47`), and the store learns which workspaces are Builder from `probe_builder_workspaces` (`plans.ts:57-62`).
- **Plan changes.** On an upgrade, existing HTTP, TCP and Supabase monitors still at the Free 180 s interval are moved to 60 s (`src/lib/workspace-plan.ts:8-17`).

**Gaps:**
- A downgrade changes only which probes check the workspace. Already-fast monitors stay fast, and existing monitors above the new caps are kept; the code marks slowing them down as "deferred in BACKLOG" (`workspace-plan.ts:19`). Nothing I read blocks a Free workspace from keeping 100 monitors after a downgrade.
- I didn't trace the gates for each separate feature switch (white label, private pages and the rest). In `plans.ts` they're checked through `holds()` (`plans.ts:164`), but I didn't open their call sites.
- I also didn't confirm where the 30-day / 1-year history limit is applied to queries. `historyLabel` in `plans.ts` is display text.

### Answer 3C

Staygreen has two plans, **Free** and **Builder**. All the numbers live in one table, `limits` in `src/lib/plans.ts:73-110`. The server actions read the caller's limits and pass them as parameters to Postgres functions. Those functions lock the workspace row, count what already exists and refuse the write if it would exceed the limit. The UI shows the same numbers, but the database is the hard stop.

## The limits

From `src/lib/plans.ts:73-110`:

| Limit | Free | Builder | Enforced? |
|---|---|---|---|
| Apps | 1 | 10 | Yes, SQL `create_app` |
| Monitors (all types, excluding auto-created SSL ones) | 50 | 100 | Yes, SQL `create_monitor`, `save_service_monitor` |
| Status pages | 1 | 10 | Yes, SQL `create_status_page` |
| HTTP / TCP check interval (minimum) | 3 min | 1 min | Yes, SQL `create_monitor`, `update_monitor` |
| Heartbeat monitors | 5 | 50 | Yes, SQL `create_monitor` |
| Assertions per monitor | 3 | 10 | Yes, SQL `create_monitor`, `update_monitor` |
| Assertions per heartbeat | 1 | 5 | Yes, same functions |
| Monitors per target host | 5 | "fair use", passed to SQL as the monitor cap (100) | Yes, SQL `host_limit` |
| Supabase monitors | 1 | "cap" (= monitor cap) | Yes, SQL `service_monitor_limit` |
| Stripe accounts | 1 | 3 | Yes, SQL `service_monitor_limit` |
| Stripe poll interval | 10 min | 5 min | Yes, SQL `interval_not_allowed` |
| Locations | Toronto, San Francisco | + Frankfurt | Yes, by the probes |
| API requests / min | 30 | 120 | Yes, `src/lib/agent-auth.ts:130` |
| History | "30 days" | "1 year" | Partly (see below) |
| MCP-server monitors / interval | 2, 10 min | cap, 5 min | **No**, the type isn't built yet |

A private `scale_demo` Clerk feature raises Builder's counts to 100 apps, 1,000 monitors, 500 heartbeats and 100 pages (`src/lib/plans.ts:116-117`). It is the owner's own plan for demo pages and isn't on the pricing table.

**Fixed per-type rules (the same on both plans), in SQL:**
- DNS checks run at least every 10 minutes.
- SSL checks run exactly every 6 hours (`supabase/migrations/20261022040000_heartbeat_url_sealed.sql:101-105`).
- Supabase monitors must use 60 or 180 seconds, matching Builder's or Free's HTTP interval.
- Stripe monitors must use 300 or 600 seconds (`supabase/migrations/20261023100000_service_monitors.sql:46,60`).

**Limits that are not plan-based:**
- 100 active API tokens per workspace (`supabase/migrations/20261023150000_agent_surface.sql:66`).
- 3 pending custom domains per workspace (`supabase/migrations/20261023140000_status_edge.sql:165-166`).

## Feature switches (Builder only)

Each Clerk feature slug is its own on/off switch (`src/lib/plans.ts:11-19`, `:145-162`):

| Feature | Checked where |
|---|---|
| `white_label`, `private_pages` (no "Powered by" mark, members-only pages) | Status-page save passes them to SQL: `src/app/(app)/app/actions.ts:874-875`, `:894-895` |
| `notify_teammates` (alert addresses that aren't members) | `src/app/(app)/app/alerts/actions.ts:122`, `:139` |
| `alert_rules` (routing by severity) | `src/app/(app)/app/alerts/actions.ts:317`, `:322` |
| `history_1y` | Agent/API reads only: `src/lib/agent-service.ts:52`, `:276` clamp to 365 or 30 days |
| `subscribers` | Shown in the plan table as "1,000 per page" and marked "soon" (`src/components/PlanTable.tsx:69`); I found no enforcement |

## How a request gets its limits

1. **Plan lookup.** `src/lib/session.ts:31-50` reads the plan from Clerk's verified session with `has({ feature })`. It never reads it from the database.
   - `scale_builder` decides Free versus Builder.
   - A failed read falls back to Free, marked `UNREAD` so it is never stored.
   - `SELF_HOSTED_PLAN=builder` gives every signed-in user Builder (`src/lib/self-hosted-plan.ts:6`). The env schema refuses that setting on staygreen.io (`src/lib/env-schema.ts:130-134`).
2. **Server actions** pass the numbers to SQL:
   - `create_app` with `p_max_apps` (`src/app/(app)/app/actions.ts:114`).
   - `create_monitor` with monitors, heartbeats, assertions, per-host and minimum interval (`:230-252`).
   - `update_monitor` (`:361-364`).
   - `save_service_monitor` for Stripe and Supabase (`:312-314`).
   - `create_status_page` (`:833`).
   - `verify_page_domain` (`:984-985`).
   - Demo cloning, `clone_demo_page` (`src/app/(app)/app/clone/[slug]/actions.ts:44-46`).
   - The MCP/REST agent surface passes the same limits (`src/lib/agent-service.ts:145`, `:197`).
3. **The SQL functions** refuse over-limit writes:
   - **`create_monitor`** (latest version, `supabase/migrations/20261022040000_heartbeat_url_sealed.sql:58-113`). It refuses with `limits_required` if any limit is missing, then locks the workspace with `select … for update` so two parallel creates can't both pass. It raises `monitor_limit`, `heartbeat_limit`, `assertion_limit`, `interval_not_allowed` and `host_limit`. It also rejects any type other than http, ssl, dns, tcp and heartbeat with `type_not_available`, which is why the MCP limits do nothing yet.
   - **`create_app`** raises `app_limit` (`supabase/migrations/20261022124400_apps_limit_and_logo.sql:52-68`).
   - **`create_status_page`** raises `page_limit` (`supabase/migrations/20261021210216_phase1_dashboard.sql:405-421`).
   - **`save_service_monitor`** raises `monitor_limit` and `service_monitor_limit` (`supabase/migrations/20261023100000_service_monitors.sql:15-48`).
4. **Error messages.** `src/lib/db-errors.ts:56-67` turns those error codes into the "Your plan allows…" text.
5. **Locations.** Frankfurt's probe is Builder-only, and probes have no Clerk session. So the app records the plan on `workspaces.plan` (`supabase/migrations/20261024090000_workspace_plan.sql`). Probes read it with `probe_builder_workspaces` and filter with `eligible()` (`probe/schedule.ts`, `probe/store.ts:214`).

## Gaps in enforcement

- **Downgrades keep what's already there.** The counts only refuse the next item (`supabase/migrations/20261022124400_apps_limit_and_logo.sql:64-65`). A lapsed Builder workspace keeps its 10 apps and its 1-minute monitors. `src/lib/workspace-plan.ts:22` says "slowing monitors remains deferred in BACKLOG": a downgrade only changes which probes may check the workspace. An upgrade moves HTTP, TCP and Supabase monitors from 180 to 60 seconds, but only those still at exactly 180 (`:8-16`).
- **History is mostly a label.** `historyLabel` is display text. The dashboard's `workspace_history` and `monitor_history` take no plan argument (`supabase/migrations/20261022113447_probe_history.sql:199`, `:276`), so the 30-day versus 1-year limit isn't applied there; I didn't trace their fixed window. Only the agent API clamps by `history_1y`. `docs/architecture.md:50` also says retention cleanup isn't implemented, so nothing deletes old data.
- **Some limits are display-only.** `mcpMonitors`, `mcpIntervalMin` and `subscribers` don't reach any enforcement path, beyond the SQL refusing the MCP type altogether. They appear only in plan screens (`src/components/PlanTable.tsx:44`, `:69`).

## Question 4

How does the REST/MCP API authenticate a request that uses an API token, how are tokens stored, and can a read-only token change anything?

### Answer 4A

An API token is checked against a peppered HMAC of its secret, and only that hash is stored. A read-only token can't change any of your monitors, apps, incidents or tokens. Its scope is checked twice, once in the app server and again in the SQL function that does every write. It still has a few side effects, listed at the end.

## Authenticating a token request

`requireAgent` in `src/lib/agent-auth.ts:86-105` handles it:

1. **Format check.** Any `Authorization: Bearer sg_…` header is treated as an API token (`agent-auth.ts:91`). `parseApiToken` requires exactly `sg_<24-hex kid>.<43-char base64url secret>`, and anything else gets a 401 `invalid_token` (`src/lib/api-token-crypto.ts:11-14`, `agent-auth.ts:92-93`).
2. **Lookup by key id.** It loads the `api_tokens` row with that `kid`: `id, workspace_id, hash, scope, name, revoked_at` (`agent-auth.ts:94`).
3. **Secret check.** `matchesApiToken` computes the HMAC of the presented secret and compares it to the stored hash with `timingSafeEqual` (`api-token-crypto.ts:15-18`). The comparison runs even when no row was found, against a zero hash, so both cases fail the same way (`agent-auth.ts:96`). A missing row, a wrong secret and a revoked token all return the same 401 (`agent-auth.ts:97`).
4. **Principal.** The token's workspace becomes the principal's workspace, the token id becomes the `actor`, and the token's stored `scope` (`read` or `write`) is carried along (`agent-auth.ts:98-101`).
5. **Rate limits.** There's an admission budget of 120 per workspace for token requests (`agent-auth.ts:103`). After that comes the plan's own `apiPerMin`: 30 a minute on Free, 120 on Builder (`agent-auth.ts:130`).
6. **Usage stamp.** `last_used_at` is updated at most once a minute, and only while the token isn't revoked (`agent-auth.ts:104`).

OAuth tokens are a separate path: Clerk-verified JWTs, accepted only at `/mcp`, and always given `scope: "write"` subject to the member's role. REST refuses them with "REST requires a workspace API token" (`agent-auth.ts:106-126`). OAuth isn't the question here, but it means "read-only" applies only to API tokens.

## How tokens are stored

- **Generation** (`api-token-crypto.ts:6-10`): `kid` is 12 random bytes in hex. `secret` is 32 random bytes in base64url. The plaintext `sg_<kid>.<secret>` is returned once, and only the hash is stored.
- **Hash** (`api-token-crypto.ts:3-5`): HMAC-SHA256 keyed with the server-side `API_TOKEN_PEPPER`, over `["staygreen/agent/v1", "token", [workspaceId, secret]]`. Two consequences:
  - Because the workspace id is part of the input, a hash only matches for its own workspace.
  - A copy of the database alone isn't enough to verify a guessed secret; the pepper is also needed.
- **Table** (`supabase/migrations/20261023150000_agent_surface.sql:11-12`): `kid`, `hash`, `scope text check (scope in ('read','write'))`, `created_at`, `last_used_at`, `revoked_at`. Revoking sets a timestamp rather than deleting the row.
- **Creation**: only through the dashboard, by a member holding the `tokens:manage` permission (`src/app/(app)/app/agents/actions.ts:11`). The call is `agent_token_create` (`src/lib/api-tokens.ts:30-32`), and it allows at most 100 unrevoked tokens per workspace (`agent_surface.sql:61-67`). No API tool creates tokens.

## Can a read-only token change anything?

**No domain data.** The checks are layered:

- **Scope table.** `read` grants only `monitors:read`. `write` adds `monitors:write` and `incidents:draft` (`src/lib/agent-contract.ts:13-15`).
- **Write tools.** There are exactly four: `provision_app`, `create_monitor`, `pause` and `draft_incident_update` (`agent-contract.ts:85`). Each goes through `write()`, which first calls `requireAgentPermission`, so a read token gets a 403 `insufficient_scope` before any input is processed (`src/lib/agent-service.ts:150-151`, `agent-contract.ts:16-18`).
- **Second check in SQL.** All four tools commit through one function, `agent_write`, which receives the principal's scope and raises `insufficient_scope` (`PT403`) unless it is `'write'` (`agent_surface.sql:117-126`; the call is at `agent-service.ts:196`). The app maps that error back to a 403 (`agent-service.ts:29`).
- **Even a write token can't publish.** `draft_incident_update` returns `published: false` and an approval URL in the dashboard (`agent-service.ts:203`).

**What a read token can still cause:**
- **`scan_app`.** It's available to any principal with `monitors:read` (`agent-service.ts:212-219`). It makes the server send outbound requests to a URL the caller chooses and uses up the scan budget. Nothing is stored in the workspace.
- **Bookkeeping writes.** `last_used_at` and rate-limit budget counters are written on every authenticated call (`agent-auth.ts:103-105,130`).

That conclusion rests on two things I checked: every tool except `scan_app` and the four write tools is a `select` or a read-only RPC (`agent-service.ts:221-270`), and the REST route dispatches into the same `executeAgentTool`. I didn't open `src/app/api/v1/[...operation]/route.ts` line by line to confirm it has no separate write path.

### Answer 4B

Clients send a bearer token of the form `sg_<kid>.<secret>`. The server looks the token up by its `kid`, recomputes a keyed hash of the secret and compares it in constant time. Only that hash is stored, never the token itself. **A read-only token cannot change monitors, apps, pauses or incidents**: the app refuses it, and the database function that performs every agent write refuses it again on its own.

## Authenticating a token request

Both endpoints share one entry point, `requireAgent` in `src/lib/agent-auth.ts:83-138`. REST is `src/app/api/v1/[...operation]/route.ts` and MCP is `src/app/mcp/route.ts`, both through `src/lib/agent-transport.ts`.

1. **Format check.** The header must match `Bearer sg_<24 hex>.<43 base64url>` (`parseApiToken`, `src/lib/api-token-crypto.ts:11-14`). The 24 hex characters are a public key id (`kid`); the rest is the secret. Anything else returns 401.
2. **Lookup by kid.** The server selects `id, workspace_id, hash, scope, name, revoked_at` from `api_tokens` where `kid` matches (`src/lib/agent-auth.ts:91`).
3. **Hash check.** It recomputes `HMAC-SHA256(API_TOKEN_PEPPER, ["staygreen/agent/v1", "token", [workspace_id, secret]])` and compares it with `timingSafeEqual` (`src/lib/api-token-crypto.ts:3-5`, `:15-18`).
   - The comparison runs even when no row was found, against a dummy hash, so a missing kid takes the same path.
   - A wrong hash, a missing row or a non-null `revoked_at` all return the same 401 (`src/lib/agent-auth.ts:93-94`).
4. **Load the workspace.** The token's workspace becomes the principal, with `actor = token id`, `scope` taken from the row and `auth: "api_token"` (`:95-98`).
5. **Rate budgets.** There is a 120-requests-a-minute admission budget per workspace for tokens (`:100`), then the plan's `apiPerMin`: 30 on Free, 120 on Builder (`:129-130`).
6. **Usage stamp.** `last_used_at` is updated at most once a minute (`:101`).

**Where tokens are accepted:**
- REST accepts **only** API tokens. An OAuth token there gets 401: "REST requires a workspace API token" (`:104`).
- MCP accepts either an API token or a Clerk OAuth access token. An OAuth grant always gets `scope: "write"` and also needs a live org membership check (`:103-123`).

**Request hardening** (`src/lib/agent-transport.ts:21-37`):
- Requests are refused if they come from a browser on another origin, using `Sec-Fetch-Site` or `Origin`. Cookies are never consulted.
- JSON bodies are limited to 64 KiB.

## How tokens are stored

- **Table** (`supabase/migrations/20261023150000_agent_surface.sql:5-13`): `api_tokens(id, workspace_id, name, kid unique, hash, scope in ('read','write'), created_at, last_used_at, revoked_at)`. The `hash` column must be 64 hex characters.
- **Hash, not plaintext.** The pepper is `API_TOKEN_PEPPER`, a 32-byte secret on the app server (`src/lib/env-schema.ts:118`). The hash covers the workspace id together with the secret, so a hash copied into another workspace's row would not verify. A database leak alone doesn't reveal usable tokens; you would also need the pepper.
- **Minting** (`src/lib/api-tokens.ts:26-39`, `src/lib/api-token-crypto.ts:6-10`):
  - `kid` is 12 random bytes and the secret is 32 random bytes.
  - The plaintext is returned to the dashboard **once** and never stored. If it is missed, the user must revoke the token and create another (`:34`).
  - Minting needs the `tokens:manage` permission and spends a token-management budget of 10.
  - The database caps a workspace at 100 active tokens (`agent_token_create`, migration `:61-68`).
- **Revocation** sets `revoked_at` (`src/lib/api-tokens.ts:40-46`). Tokens are created and revoked only from the dashboard: the MCP instructions list "tokens" as unavailable (`src/lib/agent-transport.ts:14`).
- **Database access.** The browser roles have no access to the table. RLS is on with no policies, and only `service_role` has grants (migration `:53-59`).

## Can a read-only token change anything?

**Not the workspace's configuration.** There are two independent checks:

1. **In the app.** `AGENT_PERMISSIONS.read` is `["monitors:read"]` only. Write scope adds `monitors:write` and `incidents:draft` (`src/lib/agent-contract.ts:13-18`). The write tools are `provision_app`, `create_monitor`, `pause` and `draft_incident_update` (`:85`). `write()` calls `requireAgentPermission` as its first line, before parsing input or touching the database, and refuses with 403 `insufficient_scope` (`src/lib/agent-service.ts:150-151`).
2. **In the database.** Every agent write goes through `agent_write` (`src/lib/agent-service.ts:196`), and that function enforces scope again:
   - It raises `insufficient_scope` unless `p_scope = 'write'` (migration `:126`).
   - For token actors, it re-reads the token row inside the transaction, requiring `revoked_at is null and scope = 'write'` and holding the row `for share` (`:135-138`).

   So even a bug in the app layer couldn't let a read token write through this path. The re-read also means a token revoked mid-request can't complete a write.

None of the agent tools deletes anything, changes alert channels, touches billing or tokens, or publishes an incident update. Writable tokens can only draft incident updates, which a member publishes in the dashboard (`src/lib/agent-transport.ts:14`).

**What a read-only token's request still does:**
- **Bookkeeping writes:** `last_used_at`, the rate-budget counters, and the `agent_calls` usage log (`src/lib/agent-auth.ts:100-101`, `src/lib/agent-transport.ts:43-60`).
- **`scan_app`:** a read token can run it (`src/lib/agent-service.ts:217-219`). It makes outbound requests to the URL it is given and creates nothing. It is rate-limited by `admitScan` and goes through the same protection that refuses private and unsafe addresses.
- **Self-hosted plan sync:** with `SELF_HOSTED_PLAN=builder`, *every* authenticated agent request, read tokens included, runs `syncWorkspacePlan(..., "builder")` (`src/lib/agent-auth.ts:134-136`). If the stored plan is still Free, this updates `workspaces.plan` and moves HTTP, TCP and Supabase monitors still at 180 seconds to 60 seconds (`src/lib/workspace-plan.ts:8-21`). The caller doesn't control it, and it is the same sync a member's dashboard visit would trigger. But it is a real configuration write that a read-only request can trigger.

### Answer 4C

The REST API and the MCP server check API tokens the same way, in requireAgent (src/lib/agent-auth.ts). Tokens are never stored in readable form. A read-only token can't change anything in the workspace: it's refused once in the app code and again inside the database's write function.

How a request with a token is checked (src/lib/agent-auth.ts, requireAgent)
The header picks the path. Authorization: Bearer sg_… takes the token path. Anything else is treated as a sign-in (OAuth) token, which only /mcp accepts; REST answers "REST requires a workspace API token" (401).
The format is checked. parseApiToken (src/lib/api-token-crypto.ts) only accepts sg_<24 hex characters>.<43 base64url characters>. The first part is a public key ID (kid), the second the secret.
The token row is looked up by its key ID. The query is api_tokens … .eq("kid", token.kid), which returns the row's workspace_id, hash, scope and revoked_at.
The secret is compared. matchesApiToken recomputes the hash and compares it with timingSafeEqual, which doesn't leak timing. It still runs a comparison when no row was found. A missing row, a wrong secret or a revoked token all return the same invalid_token 401, with no hint which one it was.
The token's details are attached to the request. The workspace comes from the token row (workspaces … .eq("id", data.workspace_id)). The actor is the token's own id (tok_…), and the scope is the token's scope.
Rate limits apply.
120 requests per minute per workspace for token sign-ins (admission-token).
The plan's own per-workspace limit (entitlements.limits.apiPerMin: 30 on Free, 120 on Builder).
Both are counted by the agent_budget database function.
Last use is recorded. last_used_at is updated at most once a minute.
How tokens are stored
Creation (newApiToken in src/lib/api-token-crypto.ts): the key ID is 12 random bytes as hex and the secret is 32 random bytes as base64url. The plaintext sg_<kid>.<secret> is returned once and never saved.
What's saved: hash = HMAC-SHA256(API_TOKEN_PEPPER, ["staygreen/agent/v1","token",[workspaceId, secret]]), via agentHash. The pepper is a server-only setting, and the hash is tied to the workspace.
The table is public.api_tokens (supabase/migrations/20261023150000_agent_surface.sql, L5–14). It holds id, workspace_id, name, kid (unique), hash (64 hex characters), scope ('read' or 'write'), created_at, last_used_at and revoked_at.
Access to the table: row-level security is on, and browser roles have no access (L53–59). Only the server's privileged role can read it.
Who can create tokens: mintApiToken (src/lib/api-tokens.ts) requires the tokens:manage permission and allows 10 token actions per minute per member. agent_token_create caps a workspace at 100 active tokens (token_limit).
Revoking sets revoked_at (revokeApiToken). Revoked tokens are refused at step 4.
Can a read-only token change anything?

No. Each scope maps to a set of permissions (AGENT_PERMISSIONS in src/lib/agent-contract.ts):

read → monitors:read only.
write → monitors:read, monitors:write, incidents:draft.

There are two independent barriers:

In the app. Every write tool goes through write() in src/lib/agent-service.ts (~L151), which calls requireAgentPermission first. A read token gets 403 insufficient_scope before any input is parsed.
In the database. agent_write (20261023150000_agent_surface.sql) re-checks independently:
It refuses unless p_scope = 'write' (L126, PT403).
For token callers, it locks the token row and requires revoked_at is null and scope = 'write' (L136). A token revoked mid-request, or one whose scope was lowered, is refused inside the transaction.

Two points to be precise about:

A read token does cause some bookkeeping writes: its last_used_at and the rate-limit counters. These are Staygreen's own records, not workspace data.
The most a write token can do is draft an incident update. Publishing it remains a dashboard action (docs/architecture.md).

## Question 5

I want to add Microsoft Teams as a new alert channel. List every file I would need to change or add and the steps, following the pattern the existing alert channels use.

### Answer 5A

Teams would be easiest to add as a copy of the Discord channel. Discord is set up by pasting a webhook address, which is how Teams incoming webhooks (Workflows) work too. Slack needs its own app sign-in flow and Telegram a chat bot, so neither is a good template.

Below, the files are listed in the order you'd change them, with what each currently says about Discord. Nothing in your project was changed.

1. Database: a new migration

Add supabase/migrations/<timestamp>_teams_channel.sql. Migrations already applied are never edited.

Allowed channel types. Drop and re-add alert_channels_kind_check with 'teams' added. It currently lists ('email','telegram','slack','discord','webhook') (supabase/migrations/20261023120000_alert_channels.sql L4–5).
Event expansion. Replace public.alert_expand so its channel filter includes 'teams'. That filter is c.kind in ('email','telegram','slack','discord','webhook') (same file, L185). Without this change, no receipts are ever created for a Teams channel.
No change needed to alert_channels_built (L6–8). It already requires a sealed credential and a label for every channel type except email and Telegram.
No change needed to alert_claim_channels (L273+). It returns c.kind without filtering by it.
Database types. Regenerate src/lib/database.types.ts if kind appears there as a fixed list of values.
2. Shared types and validation
src/lib/model.ts L217: add "teams" to ChannelKind.
src/lib/alerts/server.ts L33 and L81: add "teams" to the kind type and to the z.enum that reads channel rows.
src/lib/alerts/channel-input.ts:
Add a teamsUrl(value) check next to discordUrl (L15). It should allow only HTTPS on Microsoft's webhook hosts and refuse query strings and other tricks, the same way discordUrl limits itself to discord.com.
Add "teams" to kind: z.enum(["discord","webhook"]) (L24) and to the error message (L30–31).
3. Sending
src/lib/alerts/providers.ts: add teamsText(m: Message) and sendTeams(url, message, doFetch), modelled on discordText and sendDiscord (L29, L58–71).
Map the reply to a SendResult: rejected, retry (Teams' 429 rate limit), sent, or neverLeft from ./outcome.
Read reply bodies only through smallJson, which never copies provider replies into logs.
Mask the message text with mask.
src/lib/alerts/sender.ts:
L12: import sendTeams.
L363: add "teams" to ["slack","discord","webhook"].
L377: add if (d.channel.kind === "teams") return settle(d, await sendTeams(credential.url ?? "", message, deps.channels.fetch));
L272 and L339: include "teams", so a send whose answer was lost is failed or settled as "may have arrived, not sent again". Only email can be asked afterwards whether it arrived.
No change needed in sender/worker.ts or examples/sender/wrangler.toml. The Teams address is sealed with CREDENTIALS_KEY like Discord's. Only the comment at L2 and L38 lists the channels.
4. Dashboard
src/app/(app)/app/alerts/actions.ts:
L7: import teamsUrl.
L223: add "teams" to the list of channels whose test message is queued.
L289: build { url: teamsUrl(v.url)!.href } for Teams; it is then sealed with channelContext like Discord's.
The rest of the add-channel action stays as it is (permission check, spend(member, "alert_confirm") rate limit, insert).
src/app/(app)/app/alerts/ChannelSettings.tsx: add "teams" to the kind state (L18), a "Microsoft Teams" button (L47), and the dialog title, field label and hint text (L54–59).
src/app/(app)/app/alerts/AlertsScreen.tsx: add a description line (L98) and a "Teams message" label in delivery history (L361). Update the comment at L33.
src/components/alerts/ChannelIcon.tsx L4–6: add an icon and kindName.teams = "Microsoft Teams".
5. Public wording and docs
src/components/PlanTable.tsx L51
src/app/(public)/page.tsx L95
scripts/clerk/billing.json L115 (the feature name shown in Clerk Billing)
src/app/(public)/legal/privacy/page.tsx: L168 (what the service receives) and L270 (the webhook address is encrypted and never shown after saving)
docs/deploying.md L26
src/lib/budgets.ts L38 (comment) and src/lib/launch.ts L83 (comment). Add a launch flag in launch.ts if Teams should first show as "soon".
6. Tests

Extend the existing Discord cases:

tests/unit/channels.test.ts: address validation and sendTeams replies.
tests/unit/channel-actions.test.ts: the add-channel action.
tests/unit/alerts.test.ts: how the sender routes a Teams receipt.
tests/integration/channels.test.ts: the database type check and alert_expand.
tests/e2e/channels.auth.spec.ts: adding a Teams channel in the dashboard.
Not checked in the code
Microsoft's side. Which Microsoft hosts the address check should allow, and the exact message format (an Adaptive Card or a simple text post), come from Microsoft's Teams Workflows webhook documentation. Staygreen's code doesn't cover these, and I haven't looked them up.
Threading. If you want "resolved" posts threaded under the opening post, as Slack does with parentProviderId, you'd need a Graph API sign-in flow modelled on connectSlack. That is a much bigger change.

### Answer 5B

Teams fits best as a copy of the **Discord** channel. Both work from a pasted incoming-webhook URL, with no OAuth flow (Slack needs one) and no signing secret (the generic webhook needs one).

I found the full list by searching every place `discord` appears. That gives about 15 non-test files and 4 test files. A new channel kind is listed separately in the database, in two TypeScript types, in the sender, and in several UI pieces, so each of those needs a Teams entry.

## 1. Database: new migration

**Add** `supabase/migrations/<timestamp>_teams_channel.sql`. Don't edit the old migration; each change gets its own forward migration, as `20261023120000_alert_channels.sql` did for Discord.

- Recreate the kind check with `'teams'` added. Today it is `check (kind in ('email','telegram','slack','discord','webhook'))` (`20261023120000_alert_channels.sql:5`).
- Line 8 has a second constraint that requires a sealed credential, a confirmation and a label for every kind except email and Telegram. Teams is then covered automatically.
- Redefine `alert_expand`, which only expands events onto channels whose kind is in that list (`alert_channels.sql:185`). If `teams` isn't added there, no deliveries are ever created for Teams channels.
- No change is needed in `alert_claim` (it is limited to email and Telegram, line 219) or in `alert_claim_channels` (lines 273-298 have no kind filter). `alert_prepare_webhook` belongs to the signed webhook only (line 349).

Then regenerate `src/lib/database.types.ts`, which is generated from the schema.

## 2. Types and input validation

- **`src/lib/model.ts:217`**: add `"teams"` to `ChannelKind`.
- **`src/lib/alerts/server.ts:33,81`**: add it to both the type and the `z.enum` that parses channel rows.
- **`src/lib/alerts/channel-input.ts`**:
  - Add a `teamsUrl(value)` function modelled on `discordUrl` (lines 15-20). It should accept only an HTTPS URL on Microsoft's webhook hosts, with no credentials in the URL.
  - Add `"teams"` to the `kind` enum (line 24) and to the URL check and its error message (lines 30-31).
  - Which hosts to allow is an assumption you need to check against Microsoft's current documentation. Old Office 365 connector URLs (`*.webhook.office.com`) are being retired in favour of Workflows URLs on Azure Logic Apps or Power Platform hosts.

## 3. Sending

- **`src/lib/alerts/providers.ts`**: add `sendTeams(url, message, doFetch)` next to `sendDiscord` (lines 58-78). Keep the same rules:
  - `redirect: "manual"` and a 10 s timeout;
  - a single POST with the text passed through `mask()`;
  - a response body read through `smallJson`, which caps it at 64 KB;
  - 429 maps to `retry`, other 4xx to `rejected`, and anything else to `uncertain`;
  - `neverLeft(e, "manual")` maps to `retry`.

  The body would be an Adaptive Card message. Teams Workflows usually answers `202` with no message id, unlike Discord's `?wait=true`, which returns an `id` (line 72). Check whether the `sent` case of `SendResult` in `src/lib/alerts/outcome.ts` requires a `messageId`. If it does, decide what Teams returns: a null id, or a generated receipt id.
- **`src/lib/alerts/sender.ts`**: add `"teams"` in four places:
  - the import (line 12);
  - the `unknown` outcome, which should fail as possibly sent so it is never resent (line 272);
  - the case where the previous send's result is unknown (line 339);
  - the channel list (line 363), plus one line after Discord's (line 377): `if (d.channel.kind === "teams") return settle(d, await sendTeams(credential.url ?? "", message, deps.channels.fetch));`

  The credential is sealed JSON with the shape `{ url }`, so the parse at lines 365-369 already handles it.
- **`sender/worker.ts`** needs no change: `channels.fetch` and `CREDENTIALS_KEY` are already passed (line 31). Do update the comments in `examples/sender/wrangler.toml:2,38`.

## 4. Creating the channel (dashboard)

- **`src/app/(app)/app/alerts/actions.ts`**:
  - `addWebhookChannel` (lines 276-295) already handles pasted URLs. Extend the credential line to `kind === "teams" ? { url: teamsUrl(v.url)!.href } : …` (line 289), and import `teamsUrl` (line 7).
  - Add `"teams"` to the list of kinds whose test message is queued (line 223).
  - Keep the `spend(member, "alert_confirm")` budget call. Note that the `checkTarget` public-address check runs only for the generic webhook (line 284). With a fixed host allowlist Teams doesn't need it, as Discord doesn't.
- **`src/lib/budgets.ts:38`**: the comment lists the kinds created under that budget; add Teams.

## 5. UI and copy

- `src/app/(app)/app/alerts/ChannelSettings.tsx`: widen the `kind` state union (line 18), add a "Microsoft Teams" button (line 47), and add the modal title, field label and hint text (lines 54-59).
- `src/app/(app)/app/alerts/AlertsScreen.tsx`: add a channel description (line 98) and a provider label in the delivery log (line 361). Update the comment at line 33.
- `src/components/alerts/ChannelIcon.tsx:4,6`: add an icon and `kindName.teams = "Microsoft Teams"`. Both are `Record<ChannelKind, …>`, so TypeScript will flag them if they're missing.
- Marketing and pricing copy: `src/components/PlanTable.tsx:51`, `src/app/(public)/page.tsx:95`, and `scripts/clerk/billing.json:115` (the plan's feature name in Clerk; push it to Clerk if you change it).
- **Privacy page** `src/app/(public)/legal/privacy/page.tsx:168,270`: add Microsoft as a recipient of alert content. Don't skip this one.
- Docs: `docs/deploying.md:26`, and the comment in `src/lib/launch.ts:83` if Teams is launched in stages.

## 6. Tests

Add a Teams case next to each Discord case in:

- `tests/unit/channels.test.ts`: URL validation and `sendTeams` outcomes;
- `tests/unit/channel-actions.test.ts`;
- `tests/integration/channels.test.ts`: the constraint, and that `alert_expand` produces Teams deliveries;
- `tests/e2e/channels.auth.spec.ts`.

## 7. Deploy order

The order follows the deploy docs (`docs/deploying.md:70`):

1. Apply the migration.
2. Deploy the app.
3. Redeploy the sender Worker separately. Pushing app code doesn't update the Workers.

Until the sender is redeployed, Teams deliveries fall through the sender's handled-kind checks without being sent.

### Answer 5C

Model Teams on the **Discord** channel. Both work the same way: the user pastes a webhook URL, the app stores it encrypted, and the sender Worker posts to it. No OAuth app and no new secret are needed, because the URL is sealed with `CREDENTIALS_KEY`, which both the app and the sender already have (`examples/sender/wrangler.toml:38`). Discord's path through the code (`grep -i discord`) is the checklist below.

## 1. Database: a new migration

Add `supabase/migrations/<timestamp>_teams_channel.sql`. Applied migrations are never edited (`docs/deploying.md` step 2), so this must be a new file.

- **Allow the kind.** Drop and re-add `alert_channels_kind_check` with `'teams'` added. It is currently `('email','telegram','slack','discord','webhook')` (`supabase/migrations/20261023120000_alert_channels.sql:4-5`).
- **Re-create `public.alert_expand`.** It has a hard-coded kind list, `c.kind in ('email', 'telegram', 'slack', 'discord', 'webhook')` (`:185`). Without `'teams'` there, no delivery rows are ever created for a Teams channel.
- **No change needed:**
  - `alert_channels_built` already requires `sealed`, `confirmed_at` and `label` for every kind except email and Telegram (`:6-8`).
  - `alert_claim_channels` returns any kind together with its `sealed` credential (`:273-320`).
  - The `alert_sender.*` wrapper functions only forward to the public ones (`supabase/migrations/20261023110000_alert_sender.sql:21-51`).
  - The legacy `alert_claim` is limited to email and Telegram on purpose (`:219`).
- Regenerate `src/lib/database.types.ts` if your type generator turns the check into a union.

## 2. Shared types and validation

- **`src/lib/model.ts:217`**: add `"teams"` to `ChannelKind`. `kindName` and `icons` are typed `Record<ChannelKind, …>`, so the compiler will then flag the UI maps that still need an entry.
- **`src/lib/alerts/channel-input.ts`**:
  - Add a `teamsUrl()` validator next to `discordUrl()` (`:15-21`). Build it on `webhookUrl()`, which already enforces https, port 443, no login and no private addresses.
  - Add `"teams"` to `channelInput.kind` (`:24`) and give it its own error message in `superRefine` (`:29-31`).
- **`src/lib/alerts/server.ts:33`, `:81`**: add `"teams"` to the `ChannelView` kind union and the zod enum. Also check the channel description helper around `:123`.

## 3. Sending

- **`src/lib/alerts/providers.ts`**: add `sendTeams(url, message, doFetch)` modeled on `sendDiscord` (`:66-86`):
  - a 10-second timeout and `redirect: "manual"`;
  - `mask()` the text;
  - read the response through `smallJson()`;
  - map the result to `SendResult`: 429 → `retry`, other 4xx → `rejected`, anything uncertain → `unknown` (never retried blind).
- **`src/lib/alerts/sender.ts`**:
  - Import `sendTeams` (`:12`).
  - Add `"teams"` to the channel list (`:363`).
  - Add a branch next to Discord's: `if (d.channel.kind === "teams") return settle(d, await sendTeams(credential.url ?? "", message, deps.channels.fetch))` (`:377`). The webhook branch below it is for signed webhooks only, so keep Teams out of it.
  - Extend the in-doubt rules that name Slack and Discord to cover Teams: `:272` fails the receipt as possibly sent, and `:339` handles a claim whose lease ran out.
  - If you miss a spot, the fallback at the end of `deliver` fails the receipt with "This kind of channel can't send yet."

## 4. Dashboard

- **`src/app/(app)/app/alerts/actions.ts`**:
  - In `addWebhookChannel` (`:276-295`), store a normalized URL, as Discord does: `v.kind === "discord" ? { url: discordUrl(v.url)!.href } : …` at `:289`. Reuse the existing `alert_confirm` budget.
  - Add `"teams"` to the "queued, goes out within a minute" list for test sends (`:223`). Without it, a test send would take the immediate-delivery path, which only email and Telegram use.
- **`src/app/(app)/app/alerts/ChannelSettings.tsx`**: widen the `kind` state type (`:18`), add a "Microsoft Teams" button (`:47`), and add the modal title, URL label and setup hint (`:54-59`).
- **`src/app/(app)/app/alerts/AlertsScreen.tsx`**: add a channel description (`:98`), the provider-id label in delivery history (`:361`), and update the comment (`:33`).
- **`src/components/alerts/ChannelIcon.tsx:4`, `:6`**: add an icon and a display name.

## 5. Copy and docs that list the channels

- `src/components/PlanTable.tsx:51`. Channels are on both plans, and no plan code needs to change.
- `src/app/(public)/page.tsx:95`
- `src/app/(public)/legal/privacy/page.tsx:168` (what the provider receives) and `:270` (credentials encrypted, never shown again). Microsoft becomes a new data recipient, so this text needs updating.
- `scripts/clerk/billing.json:115`
- `docs/deploying.md:26`, `examples/sender/wrangler.toml:2`, `:38`, and the comment at `src/lib/budgets.ts:38`.

## 6. Tests

Extend the suites that already cover Discord:
- `tests/unit/channels.test.ts`: URL validation and provider result mapping.
- `tests/unit/channel-actions.test.ts`
- `tests/unit/channel-routing-screen.test.ts`
- `tests/integration/channels.test.ts`: checks that the kind is accepted and expanded.
- `tests/e2e/channels.auth.spec.ts`

## 7. Deploy order

Pushing app code doesn't update the Workers (`docs/deploying.md` step 11). Deploy in this order:
1. The migration.
2. The **sender Worker**.
3. The app.

If the app goes first, users can create Teams channels that the old sender fails with "This kind of channel can't send yet."

## Teams-specific decisions to check against Microsoft's current docs

These are from my own knowledge, not the repo:
- **Which URL to accept.** Microsoft has been retiring the Office 365 "Incoming Webhook" connectors in favor of **Workflows** (Power Automate) webhook URLs. Those URLs use different hosts, such as `*.logic.azure.com` or `*.powerplatform.com`, and carry query parameters like `sig` and `api-version`. Two consequences:
  - `discordUrl` rejects any query string (`u.search`), so don't copy that check.
  - `webhookUrl` already accepts an explicit `:443`, which those URLs include.
  - Choose between pinning hosts to Microsoft's domains, as Discord pins to `discord.com`, and accepting any host. Accepting any host means using the DNS-pinned transport and `checkTarget` that the signed webhook uses (`actions.ts:285-287`, `src/lib/alerts/webhook.ts`).
- **No message id.** Workflows typically answers `202 Accepted` with no message id. The sender records `messageId` as the receipt's `providerId` (`sender.ts:255-259`), so `sendTeams` needs a stand-in such as the delivery id. Resolved alerts can't be threaded the way Slack's are (`:372-374`): send them as separate messages, like Discord.
- **Message format.** Workflows expects an Adaptive Card payload, so don't send Discord's `embeds`. Keep the incident and status links at the end when the evidence has to be shortened, as `discordText` does (`providers.ts:28-35`).
