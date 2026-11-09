## Question 1

Give me an architecture overview: which separately deployed parts does Staygreen have, where does each run, and how does one failed website check travel from a probe to an alert email?

### Answer 1A

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

### Answer 1B

I read the code in a shallow clone at `<BENCH>\sg-clone\staygreen`. Nothing was added to or changed in your project. I read the files cited below and did not run anything. Paths are relative to the repo root.

## Separately deployed parts

`docs/architecture.md:3` and `docs/deploying.md:3` describe it as several independently deployed services that share one Postgres database. Pushing app code does not update the others (`docs/deploying.md:70`).

| Part | Code | Where it runs |
|---|---|---|
| Dashboard and API (Next.js: UI, server actions, REST/MCP) | `src/app/**` | Netlify (`netlify.toml`, `netlify/edge-functions/`), or any Node 22+ host (`docs/deploying.md:13`) |
| Database | `supabase/migrations/*.sql` | Supabase Postgres. The migrations also define the restricted roles `probe`, `ingest`, `edge`, `alert_sender` and `watchdog` (`docs/deploying.md:65`). |
| Sign-in and billing | n/a | Clerk (hosted) |
| **Probes** (check runners) | `probe/main.ts`, `probe/runtime.ts` | Linux VMs in at least two regions, each a systemd service (`examples/probe/staygreen-probe.service`). The docs suggest two DigitalOcean droplets (`docs/deploying.md:16`). |
| **Heartbeat ingest** | `ingest/src/handler.ts`, `ingest/wrangler.toml` | Cloudflare Worker, reaching the database through an uncached Hyperdrive binding |
| **Alert sender** | `sender/worker.ts`, `examples/sender/wrangler.toml` | Cloudflare Worker with a one-minute cron plus `POST /api/telegram/webhook` |
| **Watchdog** | `watchdog/worker.ts`, `examples/watchdog/wrangler.toml` | Cloudflare Worker with a minute cron and a Durable Object that holds alert receipts |
| **Status edge** | `edge/main.ts` | A Node renderer on a probe droplet (loopback port 7080), behind Caddy and a Cloudflare-proxied status host (`docs/deploying.md:17,69`) |
| CLI / MCP bridge | `packages/staygreen/` | npm package that calls the API (`docs/architecture.md:44`) |

Each service connects to the database with its own restricted login. Only the app server holds the Supabase secret key (`docs/architecture.md:48`).

## A failed check, from probe to alert email

1. **Scheduling.** Each probe loads monitors from the database and ranks the live probes per monitor. The top-ranked probe is the monitor's "home" (`probe/runtime.ts:246-267`). A timer wheel starts the check when it falls due (`runtime.ts:513-532`).

2. **First check.** `runCheck` runs the HTTP, TCP, SSL, DNS, Stripe or Supabase check (`runtime.ts:456-495`). A failure is dropped if the probe's own network "canary" says it is isolated (`runtime.ts:499`).

3. **Confirmation.** A failure needs a second look (`probe/state.ts:70`). The probe asks the next live location, via an HMAC-signed peer request, to re-check within 30 s (`runtime.ts:569-590`, `probe/peer.ts:24`). If no other location is live, it re-checks from itself after 20 s. If other locations are live but none answers, the failure stays unconfirmed and counts as nothing.

4. **Report to the home.** If this probe is not the home, it queues the report and sends it to the home once a second (`runtime.ts:605-638`). The home calls `Store.apply`.

5. **State machine in the database.** `Store.apply` (`probe/store.ts:303-415`) locks the monitor row (`probe_lock_monitor`) and runs the pure reducer `step()` (`probe/state.ts:88`). A confirmed failure moves the state to `down` and emits `open_incident` (`state.ts:125-131`). Heartbeats take the same path through `judgeHeartbeat`. A missed deadline is down at once, with no second location (`state.ts:95-107`).

6. **Commit.** `probe_commit_monitor` writes the new state and a row in `public.incidents` (`supabase/migrations/20261023100000_service_monitors.sql:170-183`). This happens in one transaction through a bounded `probe_*` function, with no table grants for the probe login (`store.ts:14-17`).

7. **Outbox event.** A trigger on `incidents` inserts an `alert_events` row of kind `opened` in the same transaction (`20261022195510_alerts_email.sql:209-239`). An incident therefore never exists without its pending alert. A unique index on `(incident_id, kind)` makes it once-only (line 120).

8. **Sender picks it up.** The sender Worker runs every minute (`examples/sender/wrangler.toml`, `crons = ["* * * * *"]`). `runSender` (`src/lib/alerts/sender.ts:185`) does the following:
   - It reads pending events with `alert_pending_events` (`sender.ts:198`).
   - For channels addressed to workspace members, it reads the member list from Clerk (`sender.ts:202-210`, `sender/worker.ts:30`).
   - It calls `alert_expand`, which writes one `alert_deliveries` receipt per event, channel and recipient. Unconfirmed, unsubscribed or excluded channels get none (`20261022195510_alerts_email.sql:284-353`).

9. **Claim and send.** `alert_claim` hands each receipt to one sender at a time, using `for update skip locked` and a 300 s lease (`sender.ts:23-24,47`). `deliverEmail` (`sender.ts:280-317`) resolves the member's address from Clerk and composes the message. It then calls `sendEmail`, which posts to Postmark at `https://api.postmarkapp.com` (`src/lib/alerts/postmark.ts:22`), adding List-Unsubscribe headers. Telegram, Slack, Discord and webhook channels use the same receipt mechanism.

10. **Settle.** The receipt is marked `sent`, retried or failed with `alert_mark`. A definite refusal goes back to `pending` with a backoff of 30 s up to 1 h, and gives up after 8 attempts (`sender.ts:49-53`). An email whose outcome is unknown is not blindly re-sent: after the lease, the next sender asks Postmark's message search for the receipt id first (`sender.ts:344-358`).

When the monitor later recovers (two passes in a row, `state.ts:64`), the same trigger writes a `resolved` event. It is only delivered to channels that received the `opened` alert (`20261022195510_alerts_email.sql:224-231,342-345`).

## Cross-checks

- **Watchdog:** It does not take part in this path. It reads `watchdog_flush_status` to see whether probes stopped flushing, and alerts an operator Telegram chat if they did (`watchdog/worker.ts:20-33`). A dead fleet is reported there rather than by the sender.
- **Status pages:** They read the same database separately through the edge renderer, not through the alert path.
- **Not checked:** I did not read `src/app/**`, so I haven't checked how the app creates monitors and alert channels. I also did not verify the deployment or the Caddy and Cloudflare setup, so those rest on `docs/deploying.md` and `docs/architecture.md`.

### Answer 1C

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

An HTTP/website monitor opens an incident on one confirmed failure: a failed check from one location plus a failed re-check from a different location. It resolves after two passing checks in a row. These are fixed constants, and I found no per-monitor setting for either number.

## When it opens

The rules are in `probe/state.ts`, which holds the reducer `step()`. It is pure code, and the database row supplies the state it steps (`probe/store.ts:303-415`).

- **Failed checks needed:** 2, and they are not consecutive scheduled checks. A failed first check is re-checked immediately. The first failed check is the "first" result, and the incident opens only if the re-check also fails (`state.ts:114-131`). The re-check follows the first failure by up to 30 s (`probe/runtime.ts:110,569-590`).
- **Locations needed:** 2 different ones. `confirmersFor` filters out every probe whose `location` equals the checking probe's own (`probe/schedule.ts:72-80`). The confirmer is asked via a signed peer request, and the first location that answers is used (`runtime.ts:579-586`). The incident's evidence lists both locations, and the timeline reads "Check failed in X / Confirmed from Y, incident opened" (`store.ts:386-392`).
- **A single-probe fleet:** If no other location is live, the probe re-checks from itself after 20 s (`runtime.ts:573,576`). A failure also counts from itself if every other location replies "declined", meaning it can't open the monitor's secret headers (`runtime.ts:587`). `docs/deploying.md:32` describes this as the smallest-install behaviour.
- **What counts as a failure for HTTP:** The check fails on any of these (`src/checks/http.ts:230-249`):
  - bot-protection page
  - status not matching `expect` (default `2xx`, `runtime.ts:473`)
  - missing keyword
  - failed assertion
  - connect, DNS, TLS or protocol error
  - timeout (default 15 s, `runtime.ts:477`)
  
  A slow response does not fail the check. It only sets `slow`, which feeds the separate `degraded` state (`http.ts:251-253`, `state.ts:12`, `DEGRADED_AFTER = 3` at `state.ts:63`).

What does not open an incident (`state.ts:121-122`):

- **Blip:** The first check failed but the second location passed. Nothing changes, and no streak is touched.
- **Unconfirmed:** The first check failed and no second location could look or answered within 30 s. This counts as nothing (`runtime.ts:587-589`).
- **Isolated probe:** A failure is discarded if the probe's own network canary says it is isolated (`runtime.ts:499`).
- **Already down:** The state is already `down`, so no second incident opens (`state.ts:126`). The failure is still recorded in `check_failures`.

The first-ever check works the same way. A monitor with no state (null) whose first check fails and is confirmed goes straight to `down` and opens an incident (`state.ts:126-128`).

The incident row is written in `probe_commit_monitor` (`supabase/migrations/20261023100000_service_monitors.sql:170-183`). Its title is `"<monitor name> is down"` and its severity is `down`. If an older incident is somehow still open for that monitor, it is closed first with "A new outage opened its own incident, this one closed" (lines 174-180).

## What resolves it

- **Normal recovery:** Two passing checks in a row (`RECOVERED_AFTER = 2`, `state.ts:64,136-141`).
  - `passStreak` counts passes while `down`. It is stored on the monitor row (`probe_pass_streak`, `store.ts:331-334`), so it survives a probe switching home.
  - The first pass only increments the counter.
  - Passes are counted from the first check's result (`o.first.ok`) at whichever location ran it. No second location is needed.
  - A failure that doesn't count, either an unconfirmed one or one the second location passed, does not reset the pass streak (`state.ts:122`).
  - A confirmed failure in between returns the monitor to `down` with `passStreak: 0` (`state.ts:130`).
- **What the database does:** The `down → up/degraded` transition closes the incident in the same transaction. It sets `resolved_at` and appends the timeline entry "Two checks passed, incident closed" (`20261023100000_service_monitors.sql:164-168`).
- **Resolved email:** The `resolved_at` change fires the trigger that inserts the `resolved` alert event (`20261022195510_alerts_email.sql:224-231`). It is skipped if the monitor isn't back to `up`, or is `degraded` only when the incident's severity was `down`.
- **Other ways it closes:**
  - Editing the monitor (`supabase/migrations/20261022081211_monitor_edit_closes_incident.sql:105-107`).
  - Another outage opening on the same monitor (the SQL above).

  An edit closes the incident without a recovery transition, so the alert trigger's `v_state` check decides whether a `resolved` email goes out. I did not trace that case further. I also didn't check whether pausing closes the incident. I found no `resolved_at` update in the pause migration.

## Different types

These rules are for HTTP, which is what a website monitor is (`runtime.ts:468`). Other types differ (`state.ts:3-28,70-75,118`):

- **DNS:** No second location. It needs 2 failing checks in a row (`DNS_DOWN_AFTER = 2`).
- **SSL:** A bad certificate opens at once. A handshake that breaks off is confirmed like HTTP.
- **Heartbeat:** One missed deadline or `/fail` opens at once. It resolves on the next good ping.

### Answer 2C

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

## Question 3

What are the limits of each plan (monitors, apps, status pages, check intervals and anything else), and where in the code are they enforced?

### Answer 3A

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

### Answer 3B

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

### Answer 3C

Staygreen has two plans, Free and Builder. Every number lives in one table, `limits` in `src/lib/plans.ts:72-111`. Both the UI and the database function that refuses over-limit writes take their numbers from it (`plans.ts:7-8`).

## The numbers (`src/lib/plans.ts:72-111`)

| Limit | Free | Builder |
|---|---|---|
| Apps | 1 | 10 |
| Monitors (workspace total, excluding auto-created ones) | 50 | 100 |
| Status pages | 1 | 10 |
| HTTP/TCP minimum interval | 3 min | 1 min |
| Monitors per host (SSL excluded) | 5 | "fair use" |
| Heartbeat monitors | 5 | 50 |
| Assertions per monitor | 3 | 10 |
| Assertions per heartbeat | 1 | 5 |
| Check locations | Toronto (`tor1`), San Francisco (`sfo3`) | adds Frankfurt (`fra1`) |
| Stripe monitors / poll interval | 1 account / 10 min | 3 accounts / 5 min |
| Supabase-project monitors | 1 | "cap" (total monitor limit) |
| MCP-server monitors / interval | 2 / 10 min | "cap" / 5 min |
| History | 30 days | 1 year |
| Agent API budget | 30 per min | 120 per min |

"Fair use" and "cap" are resolved to the workspace's monitor limit when sent to the database (`actions.ts:251,312`, `src/lib/agent-service.ts:197`). Builder's per-host limit is therefore effectively 100.

Other intervals are fixed in SQL rather than set by the plan:
- **SSL:** exactly 21600 s (6 h).
- **DNS:** at least 600 s.
- **Supabase:** 60 or 180 s.
- **Stripe:** 300 or 600 s.

These checks are in `supabase/migrations/20261022040000_heartbeat_url_sealed.sql:101-105` and `20261023100000_service_monitors.sql:46,60`.

## Builder-only feature switches (`plans.ts:12-20,159-167`)

These are separate Clerk Billing features. Each can be held independently of the others:
- `scale_builder` sets the plan and the numbers above.
- `white_label` removes the Staygreen mark.
- `private_pages` gives members-only pages.
- `subscribers` gives email subscribers (1,000 per page, per `src/components/PlanTable.tsx:69`).
- `alert_rules` gives routing by severity, alert timing and maintenance windows.
- `history_1y` gives one year of history.
- `notify_teammates` lets people without an account receive alerts.

## Where each limit is enforced

There are two layers. The server action reads the plan and passes the numbers as RPC arguments. The Postgres function then refuses the write. The numbers are arguments, so the SQL checks only what it is handed. A missing number raises `limits_required` instead of being read as "no limit" (for example `20261022040000_heartbeat_url_sealed.sql:60-63`).

- **Monitors, heartbeats, assertions, interval and per-host:**
  - The server action `src/app/(app)/app/actions.ts:229-254` passes `L.monitors`, `L.heartbeats`, `L.assertions`, `L.heartbeatAssertions`, `L.perHost` and `p_min_interval_sec`.
  - `create_monitor` (latest version `20261022040000_heartbeat_url_sealed.sql:82-113`) refuses with `monitor_limit`, `heartbeat_limit`, `assertion_limit`, `interval_not_allowed` and `host_limit`. It takes a workspace row lock first (line 65), so concurrent creates can't overshoot.
  - Edits go through `actions.ts:346-364` and `update_monitor` (`20261022081211_monitor_edit_closes_incident.sql:68-82`), which re-check assertions, interval and per-host.
- **Apps:** `actions.ts:114` passes `p_max_apps`. `create_app` raises `app_limit` (`20261022124400_apps_limit_and_logo.sql:67`).
- **Status pages:** `actions.ts:833` passes `p_max_pages`. `create_status_page` raises `page_limit` (`20261021210216_phase1_dashboard.sql:419`).
- **Stripe and Supabase monitors:**
  - `actions.ts:312` passes `p_max_type`: `stripeAccounts` for Stripe, otherwise the Supabase cap.
  - `save_service_monitor` raises `monitor_limit` and `service_monitor_limit` (`20261023100000_service_monitors.sql:33-34`). It also does the per-host check (line 48).
- **Agent/MCP/CLI writes:** `src/lib/agent-service.ts:197` sends the same numbers to `agent_write` as `p_limits`, so this path is capped too. The rate budget is applied at `src/lib/agent-auth.ts:130`.
- **Demo-page cloning:** `src/app/(app)/app/clone/[slug]/actions.ts:44-46` passes the limits to `clone_demo_page`.
- **Locations:**
  - No plan table is checked at write time.
  - It is enforced when probes pick work. `eligible()` (`probe/schedule.ts:46-48`) gives a Builder-only probe, such as `fra1`, only monitors of Builder workspaces (`m.builder`).
  - A probe learns a workspace's plan from `probe_builder_workspaces` (`probe/store.ts:212-220`). This is the plan the workspace's members last showed with a verified session.
  - Per `docs/deploying.md:24`, `fra1` refuses to start without `PROBE_BUILDER_ONLY=true`.
- **History:** `agent-service.ts:52,276` caps queries at 365 days with `history_1y`, otherwise 30. Pages store `history_days` (`actions.ts:872,919`).
- **Feature switches:** server actions check `holds(entitlements, slug)`. Examples are `alerts/actions.ts:122` (teammates) and `:317` (severity routing). `actions.ts:874-875` passes `p_white_label` and `p_private_pages` when saving a page. The UI also locks the controls (`ChannelSettings.tsx:88`).

## Notes

- **Interval:** The monitor-create action always sets the interval to the plan minimum unless the type has a fixed one: `p_interval_sec: row.fixedIntervalSec ?? minInterval` (`actions.ts:240`). I found no place where a user picks a slower HTTP interval. A Free HTTP monitor runs every 3 min, a Builder one every 1 min.
- **MCP monitors:** `mcpMonitors` and `mcpIntervalMin` are in the table, but `create_monitor` refuses type `mcp` with `type_not_available`, and `save_service_monitor` accepts only `stripe` and `supabase`. I found no code path that creates an MCP monitor, so no enforcement exists to cite.
- **Plan resolution:**
  - `entitlementsFrom` (`plans.ts:144-157`) yields Builder only if Clerk reports `scale_builder`. A failed or missing read gives Free (the `UNREAD` fallback).
  - `SELF_HOSTED_PLAN=builder` makes every workspace Builder at its ordinary limits (`src/lib/self-hosted-plan.ts`). The env schema refuses it on staygreen.io domains (`src/lib/env-schema.ts:130-134`).
  - A `scale_demo` feature raises the counts to 100 apps, 1000 monitors, 500 heartbeats and 100 pages (`plans.ts:117-118`).
  - A dev-only plan override exists in `src/lib/session.ts:51-89`.
- **Not checked:** I did not read the rate-limit rules in `netlify/edge-functions/` or the Clerk plan setup. I also did not check whether the numbers on the pricing or landing pages match the table. They read from it through `PlanTable.tsx`.

## Question 4

How does the REST/MCP API authenticate a request that uses an API token, how are tokens stored, and can a read-only token change anything?

### Answer 4A

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

### Answer 4B

I've traced the whole token path. I'm now writing it up.

## How a request with an API token is authenticated

Both the REST and MCP routes call `requireAgent` in `src/lib/agent-auth.ts:84-138`.

- **Routes:**
  - REST is `src/app/api/v1/[...operation]/route.ts`, which calls `restRequest`.
  - MCP is `src/app/mcp/route.ts`.
  - Both are in `src/lib/agent-transport.ts`.
- **Token format:** `sg_<24 hex kid>.<43 char base64url secret>`. The regex is in `parseApiToken` (`src/lib/api-token-crypto.ts:12-15`).
  - A header that starts with `Bearer sg_` but doesn't match that shape gets 401 `invalid_token`.
- **Origin and content type:**
  - After authentication, `assertAgentOrigin` runs (`agent-transport.ts:26-31`). It rejects a request whose `Sec-Fetch-Site` isn't `same-origin`. If that header is absent, it rejects one whose `Origin` isn't the app's origin.
  - Native clients that send neither header pass. Cookies are never consulted.
  - REST accepts only POST with `application/json` (`agent-transport.ts:115,33`).
  - MCP is POST-only too (`agent-transport.ts:74`).
- **Lookup and check (`agent-auth.ts:91-99`):**
  1. It selects the `api_tokens` row by `kid`.
  2. It recomputes HMAC-SHA256 over `[workspaceId, secret]` with the server's `API_TOKEN_PEPPER`.
  3. It compares in constant time with `timingSafeEqual`. A missing row compares against an all-zero hash, so the timing is the same.
  4. It rejects a revoked token (`revoked_at !== null`).
  5. A database error gives 503 rather than a pass.
- **Principal:** The workspace is the token's own, and `scope` is the token's stored `read` or `write` (`agent-auth.ts:101`).
- **Limits applied after authentication:**
  - A 120-per-minute admission budget keyed by workspace (`agent-auth.ts:103`).
  - A plan-based budget of 30 per min on Free and 120 on Builder (`agent-auth.ts:130`).
  - A `last_used_at` update, at most once a minute (`agent-auth.ts:105`).
- **OAuth:** On `/mcp` only, a non-`sg_` bearer is verified as a Clerk OAuth JWT (`agent-auth.ts:107-125`).
  - The audience must be the app's `/mcp` resource.
  - Workspace membership is re-checked live.
  - OAuth principals are always given `scope: "write"` (`agent-auth.ts:125`).
  - On REST (`oauth=false`) a non-token bearer is refused (`agent-auth.ts:108`).

## How tokens are stored

- **Table:** `public.api_tokens` has `id`, `workspace_id`, `name`, `kid` (unique), `hash`, `scope` (`read` or `write`, enforced by a check constraint), `created_at`, `last_used_at` and `revoked_at` (`supabase/migrations/20261023150000_agent_surface.sql:5-13`).
- **No plaintext secret:** Only the hash is stored. `hash` must match `^[0-9a-f]{64}$`. It is an HMAC-SHA256 of the secret, keyed with `API_TOKEN_PEPPER` and bound to the workspace id (`api-token-crypto.ts:7-11`).
  - The plaintext `sg_...` string is returned once at creation (`src/lib/api-tokens.ts:39`).
  - A leaked database copy can't be used to authenticate without the pepper.
- **Access:** RLS is on. All grants are revoked from `public`, `anon` and `authenticated`, and only `service_role` (the app server) gets access (`20261023150000_agent_surface.sql:53,58-59`).
- **Creation (`api-tokens.ts:27-43`):**
  - It requires the `tokens:manage` permission and spends a budget of 10 per minute.
  - The `agent_token_create` function caps a workspace at 100 active tokens (`20261023150000_agent_surface.sql:66`).
  - The id is derived from a client-supplied `request_id`, so a retry doesn't mint a second token.
- **Revocation:** It sets `revoked_at`. The write path re-checks that the token is still valid with `for share`, so revocation takes effect even for a request already admitted (`20261023150000_agent_surface.sql:135-137`).
- **Listing:** The settings screen reads only `id,name,kid,scope,...`, never the hash, and only for users with `tokens:manage` (`api-tokens.ts:11,16-21`).
- **Minting through the API:** There is no token-management tool among the agent tools (`writeTools` is only `provision_app`, `create_monitor`, `pause` and `draft_incident_update`, `agent-contract.ts:85`). A token can't create or revoke tokens.

## Can a read-only token change anything?

It can't change monitors, apps, incidents or other workspace data. There are two enforcement layers, and a few small side effects remain.

- **Permission check:** `AGENT_PERMISSIONS.read` is only `["monitors:read"]` (`agent-contract.ts:13-15`). `write` adds `monitors:write` and `incidents:draft`.
  - `write()` in `src/lib/agent-service.ts:150-151` calls `requireAgentPermission`. It needs `incidents:draft` for `draft_incident_update` and `monitors:write` for everything else. A read token gets 403 `insufficient_scope`, before input parsing and before any database call.
- **Database check:**
  - Every write goes through the `agent_write` function. It raises `PT403 insufficient_scope` unless `p_scope` is `'write'` (`20261023150000_agent_surface.sql:127`).
  - For a token actor it also requires that the token row exists, is not revoked and has `scope = 'write'` (line 136). So even if the application check were bypassed, a read token's id would not pass.
- **Writes are limited to four tools:** `agent_requests.tool` is constrained to those four (line 26). The REST route accepts only known tool names and POST (`agent-transport.ts:113-115`).

A read token can still cause these side effects:

- **`last_used_at` update:** Each request updates the token's own `last_used_at` (`agent-auth.ts:105`).
- **Rate-limit counters:** It increments `agent_budgets` counters.
- **Call logging:** Calls are logged in `agent_calls`, best effort (`agent-transport.ts:51`).
- **`scan_app`:** This tool needs only `monitors:read` (`agent-service.ts:213,217`). It is read-scoped but does outbound work. It calls `admitScan`, which spends a scan budget, then `runScan`, which scans a user-supplied URL. I did not read `scan.ts` or `scan-admission.ts`, so I haven't checked what it writes or fetches. The scan input has its own contract in `src/lib/scan-contract.ts`.

## Caveats

- **Scope is chosen at minting:** A `write` token can create and pause monitors and draft incident updates. Publishing an incident update stays a dashboard action (`docs/architecture.md:44`).
- **OAuth is full write by design:** OAuth sessions get `write` (`agent-auth.ts:125`), so a read-only credential exists only as an API token.
- **Not read:** I did not trace the dashboard's own authorization (`src/lib/authz.ts`) beyond the permission names.

### Answer 4C

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

## Question 5

I want to add Microsoft Teams as a new alert channel. List every file I would need to change or add and the steps, following the pattern the existing alert channels use.

### Answer 5A

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

### Answer 5B

I'm done reading. Discord is the closest existing pattern: a pasted webhook URL, encrypted at rest and sent with a plain `fetch`. I'm writing up the Teams steps from it.

Everything below comes from tracing where `discord` appears (about 20 non-test files). Slack follows the same path but adds OAuth, which Teams doesn't need. I haven't changed anything.

## Steps

**1. Database migration (new file).** Add `supabase/migrations/<timestamp>_teams_channel.sql`. The latest existing one is `20261028220000_demo_clone_branding.sql`, so use a later timestamp. Never edit applied migrations (`docs/deploying.md:61`). It needs to do two things:
- Drop and recreate `alert_channels_kind_check` to add `'teams'`. The current list is `('email','telegram','slack','discord','webhook')` (`20261023120000_alert_channels.sql:4-5`).
- Recreate `public.alert_expand` with `'teams'` added to the `c.kind in (...)` list. The current line is `20261023120000_alert_channels.sql:185`. Without this, a Teams channel never gets delivery receipts, because `alert_expand` filters channels by kind.

The alert_channels_built constraint (line 8) already requires `sealed`, `confirmed_at` and `label` for every kind except email and telegram, so Teams needs no change there. `alert_claim_channels` passes `kind` and `sealed` through without filtering by kind (lines 296-314), so it needs no change either. Copy the whole `alert_expand` function body from its latest definition. Use `20261023120000_alert_channels.sql` (the `alert_expand` at about line 140-200). The older copy in `20261022195510_alerts_email.sql` is superseded.

**2. URL validation and input schema: `src/lib/alerts/channel-input.ts`.**
- Add `teamsUrl(value)`, modelled on `discordUrl` (lines 15-21). It calls `webhookUrl` first, which enforces https, no credentials, port 443 and a public host. Then it pins the allowed hostnames and path shape for Teams webhooks, and rejects any query string if Teams doesn't use one.
- The exact Teams hostnames and path format are not in the repo. I'm going from memory that Teams now uses Power Automate/Workflows webhook URLs, and that the old Office 365 connector URLs are being retired. Check Microsoft's current documentation before writing the regex.
- Change `channelInput.kind` from `z.enum(["discord","webhook"])` to include `"teams"` (line 24). Extend the `superRefine` branches (lines 30-33) so Teams gets its own validator and error message.

**3. Provider sender: `src/lib/alerts/providers.ts`.** Add `sendTeams(url, message, doFetch)`, modelled on `sendDiscord` (lines 52-69):
- Use `redirect: "manual"`, a 10 s `AbortSignal.timeout`, and `mask()` on the text through the existing `text()` helper.
- Build Teams' payload, which will probably be an Adaptive Card. Teams has its own size limit, so follow `discordText`'s approach of keeping the footer links whole when shortening.
- Return the `SendResult` kinds from `src/lib/alerts/outcome.ts`: 429 gives `retry` with `retryAfterSec`, other 4xx give `rejected`, 5xx or an unreadable answer gives `unknown` (never retried blindly), and `neverLeft(e, "manual")` gives `retry`.
- Needs a decision: `sent` requires a `messageId` string (`outcome.ts`). Discord's and Slack's come from the provider's reply. I believe Teams webhooks don't return a message id, so you would need to build one, for example from the delivery id. Verify this against the real response. This also affects `sender.ts`'s Postmark-style reconciliation, which only applies to email.

**4. Sender dispatch: `src/lib/alerts/sender.ts`.**
- Line 363: add `"teams"` to `["slack", "discord", "webhook"].includes(d.channel.kind)`.
- After the Discord branch (line 377), add a Teams branch. It checks `credential.url`, then `messageFor(...)`, then `settle(d, await sendTeams(credential.url, message, deps.channels.fetch))`.
- Lines 271-273 (the `unknown` case) and line 339 (the `inDoubt` case): add Teams, alongside Slack and Discord, to the "didn't confirm, so it wasn't sent again" handling. Otherwise an uncertain Teams send falls through to the email branch and is retried (`sender.ts:274`). Slack and Discord fail closed there.
- No change is needed in `sender/worker.ts`. It already passes `channels: { key, fetch, webhook }` to `runSender` (`worker.ts:31`), so the existing decryption key covers Teams.

**5. Dashboard server action: `src/app/(app)/app/alerts/actions.ts`.**
- Line 7: import `teamsUrl`.
- `addWebhookChannel` (lines 277-298): build the credential at line 289, which currently picks between Discord and webhook. Add a Teams branch, `{ url: teamsUrl(v.url)!.href }`. The credential is sealed with `seal(..., channelContext(workspace, id))` and stored with `confirmed_at: now`.
- Line 223 (test send): add `"teams"` to `["slack", "discord", "webhook"]`. Otherwise "send test" tries `deliverNow`, the inline email/Telegram path, instead of queueing for the Worker.
- Setup attempts are rate-limited by the existing `alert_confirm` budget (`src/lib/budgets.ts:37-41`). Update its comment to mention Teams. No code change is needed.
- Teams webhooks use a normal public host, and `webhookUrl` already rejects private and local addresses. Discord skips the DNS check (`actions.ts:283-286` only runs `checkTarget` for `webhook`), so Teams can follow Discord. Add the check if you want one.

**6. Types and routing for the UI.**
- `src/lib/model.ts:217`: add `"teams"` to `ChannelKind`.
- `src/lib/alerts/server.ts`: add `"teams"` to the type union at line 33 and the Zod enum at line 81.
- `src/components/alerts/ChannelIcon.tsx:4,6`: add an icon and a display name in `icons` and `kindName`. Both are typed by `ChannelKind`, so TypeScript will flag them.

**7. Screens.**
- `src/app/(app)/app/alerts/ChannelSettings.tsx`: the `kind` state type (line 18), a "Teams" button next to Discord (line 47), and the modal title, field label and hint text, which are keyed on `kind === "discord"` (lines 54-59). Replace those ternaries with a small map once there are three kinds.
- `src/app/(app)/app/alerts/AlertsScreen.tsx`: the description line for a Teams channel (near line 98), the delivery label at line 361 ("Teams message"), and the comment at line 33.

**8. Copy and docs.** These are not functionally needed, but they list the channels:
- `src/components/PlanTable.tsx:51`
- `src/app/(public)/page.tsx:95`
- `src/app/(public)/legal/privacy/page.tsx:168,270`. The privacy page says which providers receive data and that webhook URLs are encrypted, so Teams must be added to both statements.
- `docs/deploying.md:26`, `examples/sender/wrangler.toml:2,38`
- `scripts/clerk/billing.json:115`. This is the billing feature description. Check whether it must match the Clerk plan before changing it.
- `src/lib/launch.ts:83`, which has a stage comment.

**9. Tests.** Discord has coverage in:
- `tests/unit/channels.test.ts` (URL validation, `sendDiscord`, truncation, retry mapping)
- `tests/unit/channel-actions.test.ts`
- `tests/integration/channels.test.ts`
- `tests/e2e/channels.auth.spec.ts`

Add Teams equivalents for `teamsUrl`, `sendTeams` and the action. Add one for the SQL kind check, ideally a Teams channel getting a delivery receipt in the integration suite.

## What you do not need

- **No new environment variable or secret.** Teams uses the existing `CREDENTIALS_KEY` on both the app and the sender, as Discord does.
- **No new table.** Slack needs `slack_installs` only because of OAuth.
- **No Worker config change.** The sender cron already claims and delivers any kind returned by `alert_claim_channels`.
- **No probe or edge change.** Alerts leave through the sender only.

## Rollout order

Apply the migration before deploying the app, then deploy the sender Worker, and deploy the app last, since pushing app code doesn't update Workers (`docs/deploying.md:70`). The migration's header says the old claim API stays additive for old Workers (`20261023120000_alert_channels.sql:1-2`). If the app ships first, someone can create a Teams channel that the old sender can't deliver. The old sender fails any unknown kind with "This kind of channel can't send yet." (`sender.ts:387`).

## Not verified

I did not read the e2e or integration tests in detail. I did not check Teams' current webhook URL format, response body or payload limits against Microsoft's documentation. Those are the parts to verify first, since they decide the shapes of `teamsUrl` and `sendTeams`.

### Answer 5C

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
