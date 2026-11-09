# Question 1

Give me an architecture overview: which separately deployed parts does Staygreen have, where does each run, and how does one failed website check travel from a probe to an alert email?

## Answer 1A

Staygreen has six separately deployed parts that never call each other directly; they hand work off through the Postgres database. Paths below are relative to the clone at <clone>. I changed nothing in your project.

The deployed parts and where they run

Part; Code; Where it runs
Dashboard / API / MCP (Next.js); src/app/...; Netlify (netlify.toml), or any Node 22+ host
Database; supabase/migrations/; Supabase Postgres. Each service has its own restricted login (probe, ingest, edge, alert_sender, watchdog)
Probes (run the checks); probe/main.ts, probe/runtime.ts; At least two Linux VMs in different regions, as a systemd service (examples/probe/staygreen-probe.service). Default is DigitalOcean droplets in tor1/sfo3, plus an optional fra1 for Builder-plan workspaces
Status edge (public status pages, badges, widget); edge/main.ts; Node on one of the probe droplets, listening on port 7080 behind Caddy, with Cloudflare in front (examples/edge/)
Heartbeat ingest Worker; ingest/src/index.ts, ingest/wrangler.toml; Cloudflare Workers, reaching the DB through Hyperdrive
Alert sender Worker; sender/worker.ts, examples/sender/wrangler.toml; Cloudflare Workers on a cron that runs every minute (* * * * *), plus a Telegram webhook route
Watchdog Worker (watches the probes themselves); watchdog/worker.ts, examples/watchdog/wrangler.toml; Cloudflare Workers with a per-minute cron and a SQLite Durable Object called Watchdog

Sign-in and organizations come from Clerk; email goes through Postmark and chat through Telegram. The table and setup steps are in docs/deploying.md, and the diagram is in docs/architecture.md.

How one failed check becomes an alert email

The scheduled check fails. A probe's timer wheel runs a check it owns (probe/schedule.ts, probe/runtime.ts), using the check code in src/checks/* (for example http.ts).
The probe tests its own network. Before accepting a failure, it asks its canary checks whether this machine's own network is the problem. If the probe looks isolated, it drops the failure (probe/runtime.ts:499, probe/canary.ts).
A second location confirms. The probe sends a signed POST /confirm to a peer probe in another region, which re-checks the target and answers within 30 seconds (probe/runtime.ts:552, probe/peer.ts:9,113). With only one probe, it re-checks from itself 20 seconds later instead (docs/deploying.md, "smallest installation").
The probe decides on a verdict. probe/state.ts:114-122 turns the two results into pass, blip, fail or unconfirmed. Only a failure confirmed by both checks counts toward opening an incident; a blip or unconfirmed result changes nothing.
The result is written in one transaction. probe/store.ts:308-407 locks the monitor (probe_lock_monitor) and calls probe_commit_monitor. That SQL function updates the monitor's state and inserts the incident row (supabase/migrations/20261023100000_service_monitors.sql:123,181).
A database trigger queues the alert. The trigger incidents_alert_events on incidents inserts an alert_events row of kind 'opened' in that same transaction (supabase/migrations/20261022195510_alerts_email.sql:209-239). That table is the outbox the sender reads from.
The sender Worker sends the email. Its cron handler (sender/worker.ts:67) runs runSender (src/lib/alerts/sender.ts), which:
   reads unsent events with alert_pending_events;
   looks up workspace members in Clerk if the members' channel is involved;
   creates one delivery row per recipient with alert_expand;
   claims deliveries under a time-limited lease with alert_claim;
   sends through Postmark (src/lib/alerts/postmark.ts, sender.ts:302);
   records the outcome with alert_mark.

   If an old claim might already have gone out, it searches Postmark for that message before sending again, so an email isn't sent twice (sender.ts:337-354).

When the monitor recovers and the incident's resolved_at is set, the same trigger queues a 'resolved' event, and the sender delivers it the same way.

The watchdog is a separate path. It reads the probes' flush receipts (probe_flush_with_receipt in probe/store.ts:284) and sends Telegram alerts to the operator when the probes stop reporting. It does not take part in customer alerts (docs/architecture.md).

## Answer 1B

Staygreen has seven separately deployed parts plus three hosted services (Supabase Postgres, Clerk, Postmark). The parts share no runtime; they coordinate through Postgres, and each one connects with its own restricted database login (docs/architecture.md:30, :48). I cloned it to <clone>. All paths below are relative to that folder, and I changed nothing.

Deployed parts

Part; Code; Where it runs
Dashboard / API / MCP (Next.js); src/app/, src/lib/; Netlify (any Node 22+ host works), with POST rate limits in netlify/edge-functions/ (docs/deploying.md:13, netlify.toml)
Probes (Node process); probe/main.ts, probe/runtime.ts; DigitalOcean droplets in at least two regions (tor1, sfo3, optionally fra1, which only checks Builder-plan monitors), run as a systemd service (docs/deploying.md:16,24, examples/probe/staygreen-probe.service, probe/main.ts:9-18)
Status edge (renderer + Caddy); edge/main.ts, widget/client.ts; Usually on one of the probe droplets, listening on loopback port 7080 behind Caddy, with Cloudflare proxying the status host (docs/deploying.md:17,69, examples/edge/Caddyfile)
Heartbeat ingest Worker; ingest/src/index.ts, ingest/wrangler.toml; Cloudflare Workers, through Hyperdrive (docs/deploying.md:67)
Alert sender Worker; sender/worker.ts; Cloudflare Workers, on a once-a-minute cron and a Telegram webhook (examples/sender/wrangler.toml:14-17)
Watchdog Worker; watchdog/worker.ts, watchdog/check.ts; Cloudflare Workers with a Durable Object. It reads probe flush receipts and alerts the operator (docs/deploying.md:68, supabase/migrations/20261023090000_probe_flush_watchdog.sql)
CLI / stdio MCP package; packages/staygreen/; On the user's machine, published to npm. It only calls the API and never touches the database (docs/architecture.md:44)

The database schema, roles and grants are defined in supabase/migrations/ and applied with supabase db push. Each part is updated separately; pushing app code does not update the probes, Workers or edge (docs/deploying.md:61,70).

Probes ──check──▶ target            Probe ⇄ Probe (signed HTTP, port 7070)
  │ probe_commit_monitor
  ▼
Postgres: monitors → incidents ──trigger──▶ alert_events ──▶ alert_deliveries
                                                               ▲
                     Sender Worker (cron, each minute) ────────┘ ──▶ Postmark ──▶ email

One failed check, from probe to email

The check is scheduled. Every probe loads monitors every 30 s and puts them on a timer wheel. Monitors are spread over the live probes by a ranking, and the first probe in the ranking is that monitor's "home" (probe/runtime.ts:183,246-267). When a check is due, tick() calls runCheck, which runs checkHttp for a website monitor (probe/runtime.ts:456-482, src/checks/http.ts).

Local network check. Before a failure can count, a "canary" confirms the probe's own network is healthy. If the probe looks cut off, the failure is dropped (probe/runtime.ts:496-499, probe/canary.ts).

A second location confirms. HTTP failures need confirmation (probe/state.ts:70-75). The probe sends a signed request to the next live probe in the ranking, which re-checks the site from its own location. It has 30 s to answer (probe/runtime.ts:569-590, probe/peer.ts). If no other location is live, the probe re-checks the site itself after 20 s. If other locations are live but none answers, the failure stays "unconfirmed" and counts for nothing.

The result goes to the home probe. If this probe is the monitor's home, it applies the result directly. Otherwise the result waits in an outbox and is sent to the home in a batch once a second (probe/runtime.ts:605-638).

The home updates the state. Store.apply opens a transaction and locks the monitor row with probe_lock_monitor. It rejects stale or duplicate reports, then runs the shared state machine (probe/store.ts:303-353). A confirmed failure while the monitor is not already down produces a transition to down and an open_incident effect. A failure the second location didn't see is treated as noise and changes nothing (probe/state.ts:114-130).

The incident is written. The home calls probe_commit_monitor (probe/store.ts:403). This database function updates the monitor, records the transition and failures, and inserts an incidents row titled "<name> is down" (supabase/migrations/20261023100000_service_monitors.sql:123-187).

A trigger queues the alert. An after insert trigger on incidents inserts an alert_events row of kind opened, in the same transaction. A unique index allows only one per incident (supabase/migrations/20261022195510_alerts_email.sql:99-120,209-239).

The sender picks it up within a minute. The sender Worker's cron runs runSender (sender/worker.ts:67-77, src/lib/alerts/sender.ts:185). It:
   reads pending events with alert_pending_events (sender.ts:198);
   fetches the workspace members' email addresses from Clerk, but only when the event goes to the members' channel (sender/worker.ts:30);
   calls alert_expand, which writes one alert_deliveries receipt per channel and recipient before anything is sent (sender.ts:211, alerts_email.sql:127-153,284);
   claims receipts with a 300 s lease through alert_claim_channels / alert_claim (sender.ts:392).

The email is sent. sendEmail posts to Postmark (src/lib/alerts/postmark.ts, sender.ts:302), then alert_mark records the receipt as sent or schedules a retry. Retries back off from 30 s to 1 h, with at most 8 attempts (sender.ts:47-53). If Postmark never answered, the email is not sent again blindly: the next run searches Postmark for that receipt id first (sender.ts:26-33,340-347).

Recovery takes the same path in reverse. Two passing checks in a row move the monitor out of down and close the incident (state.ts:17-18, service_monitors.sql:164-168). The same trigger then queues a resolved event, but only for channels that received the opened alert (alerts_email.sql:224-231,280-283).

## Answer 1C

I cloned the repo to <clone>, outside your project, and changed nothing.

Staygreen architecture

The separately deployed parts

docs/deploying.md:3 describes it as "a dashboard, a database, sign-in, check runners in at least two regions, a status edge and three small Workers." The table at docs/deploying.md:11-22 and the diagram in docs/architecture.md:5-22 say where each one runs:

Part; Code; Where it runs; DB access
Dashboard / API / MCP (Next.js); src/app/, src/lib/; Netlify (netlify.toml, netlify/edge-functions/*-rate.ts) or any Node 22+ host; The only part holding the Supabase secret key (docs/architecture.md:48)
Database; supabase/migrations/*.sql; Supabase Postgres; Holds tables, the functions that change state, and a restricted role for each service (docs/deploying.md:65)
Identity / billing; —; Clerk, a hosted service; —
Probes (check runners); probe/main.ts, probe/runtime.ts; Linux VMs, e.g. DigitalOcean droplets in at least two regions, run as a systemd service (examples/probe/staygreen-probe.service). Peers talk to each other on port 7070 (examples/probe/probe.env.example:32-35); Direct pg connection with the probe role (probe/store.ts)
Status edge (public status renderer); edge/main.ts; Usually on one of the probe droplets, on loopback port 7080 (edge/main.ts:88). Caddy sits in front of it and Cloudflare proxies it (examples/edge/Caddyfile); edge role. It polls the database and also does LISTEN status_edge_changed (edge/main.ts:55,90)
Heartbeat ingest Worker; ingest/src/index.ts, ingest/src/handler.ts; Cloudflare Worker on the heartbeat host (ingest/wrangler.toml); Hyperdrive with the ingest role
Alert sender Worker; sender/worker.ts; Cloudflare Worker with a cron that fires every minute, plus a Telegram webhook at /api/telegram/webhook (examples/sender/wrangler.toml); Hyperdrive with the alert_sender role (supabase/migrations/20261023110000_alert_sender.sql)
Watchdog Worker; watchdog/worker.ts, watchdog/check.ts; Cloudflare Worker with a cron every minute and a Durable Object for alert receipts (examples/watchdog/wrangler.toml); Hyperdrive with the watchdog role, which can only call watchdog_flush_status

Two more pieces ship separately but aren't services:
The browser widget (widget/client.ts), served by the edge as w.js.
The npm CLI / stdio MCP bridge (packages/staygreen/). It calls the API and never touches the database (docs/architecture.md:44).

How one failed website check becomes an alert email

The check runs on a probe. Each probe ranks the live probes for every monitor, and the first one in that ranking is the monitor's "home" (probe/runtime.ts:246-267). When a monitor's slot comes up on the timer wheel, tick() calls checkAndReport, then runCheck, then checkHttp (probe/runtime.ts:513-562, :468-482).

A local network check comes first. If the probe's own canaries say the probe itself is cut off from the network, the failure is thrown away (probe/runtime.ts:499, probe/canary.ts).

A second location confirms the failure. needsConfirmation (probe/state.ts:70-75) applies to HTTP failures. confirm() sends a signed POST /confirm to the other live probes one at a time, with a 30-second budget (probe/runtime.ts:569-590). Requests are signed with an HMAC in the x-staygreen-sig header (probe/peer.ts:6-33). If no other location is live, the probe re-checks from itself after 20 seconds. If peers exist but none answers in time, the failure stays unconfirmed.

The result goes to the monitor's home. If this probe is the home, it applies the result directly. Otherwise the result is queued and sent once a second as a batched, signed POST /report (probe/runtime.ts:605-638).

The home steps the state machine under a row lock. PgStore.apply opens a transaction, runs probe_lock_monitor, and checks the version, ordering and replay guards. It then calls step() (probe/store.ts:303-405). In step(), a failure confirmed from a second location gives the verdict "fail". That produces a transition → down, an open_incident with evidence, and record_failure effects (probe/state.ts:88-131). Everything is committed with probe_commit_monitor(...).

Postgres creates the incident and its alert event in the same transaction. probe_commit_monitor inserts into public.incidents (supabase/migrations/20261023100000_service_monitors.sql:170-183, the latest version of the function). An AFTER INSERT trigger on incidents adds an 'opened' row to the alert_events outbox (supabase/migrations/20261022195510_alerts_email.sql:209-239). An incident therefore always has its pending alert, and if the transaction rolls back, nothing is sent (same file, lines 5-7).

The sender Worker picks it up within a minute. On each cron run, sender/worker.ts connects through Hyperdrive and calls runSender (sender/worker.ts:65-74). Inside runSender (src/lib/alerts/sender.ts):
   alert_pending_events lists events that haven't been expanded yet (line 198).
   For the workspace's members channel, it reads member addresses from Clerk at send time; they are never stored (src/lib/alerts/clerk.ts; migration header lines 13-15).
   alert_expand turns each event into one alert_deliveries receipt per channel and recipient. Receipts are unique per (event, channel, recipient) (line 211; 20261022195510_alerts_email.sql:127-148).
   alert_claim / alert_claim_channels takes receipts under a lease (line 392).

The email goes out through Postmark. composeOpened builds the message with the subject "<app>: <monitor> is down" (src/lib/alerts/compose.ts:134-140). sendEmail posts it to api.postmarkapp.com (src/lib/alerts/postmark.ts:22,77; called from sender.ts:302). alert_mark then records the result as sent, failed, skipped, or pending for a retry. If a claim may already have reached Postmark, findSent checks Postmark first so the email isn't sent twice (sender.ts:345).

Recovery follows the same path. After two passes in a row the monitor transitions out of down (probe/state.ts:136-141), and the SQL sets resolved_at on the incident. The trigger then adds a 'resolved' event, and the sender sends that email the same way.

Watchdog: it isn't part of this path. It reads only the probes' flush receipts and sends a Telegram message to an operator when an expected probe goes silent (watchdog/check.ts; docs/architecture.md:36). It tells you the monitoring has stalled, not that a customer's site is down.

Out-of-date comment: the header of 20261022195510_alerts_email.sql (lines 7-8) still says the sender runs "by a Netlify scheduled function." The later migration 20261023110000_alert_sender.sql, sender/worker.ts and docs/deploying.md:68 all describe a Cloudflare Worker with its own alert_sender role, so that comment is stale.

## Answer 1D

Used 8 tools

Staygreen has six parts that are deployed separately, plus the Postgres database they share. The code is cloned at <clone>, and nothing in your project was changed.

The separately deployed parts
Part	Code	Where it runs
Dashboard and API (Next.js app, MCP server at /mcp, REST API at /api/v1)	src/app/	Netlify (netlify.toml: npm run build, the @netlify/plugin-nextjs adapter, rate-limit edge functions in netlify/edge-functions/). It uses Clerk for sign-in and billing.
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

## Answer 1E

Staygreen is deployed as several separate parts. I read the docs, the probe, sender and ingest code, and the migrations. I did not run anything or follow every code path end to end. Where I rely on a comment or doc rather than the code itself, I say so.

Separately deployed parts

docs/deploying.md ("What you need") says the system is a dashboard, a database, sign-in, check runners in at least two regions, a status edge and three small Workers.

Part; Where it runs; Code
Dashboard and API (Next.js app: UI, REST at /api/v1, MCP at /mcp); Netlify, or any Node 22+ host; src/app/, netlify.toml, netlify/edge-functions/
Database; Supabase Postgres. The schema, roles and database functions live in the migrations.; supabase/migrations/
Sign-in and billing; Clerk (hosted); docs/architecture.md
Probes (check runners); Supervised Node processes on VMs in at least two regions, e.g. DigitalOcean droplets. A third, Builder-only location is fra1.; probe/, examples/probe/
Status edge (public status renderer); A Node process on loopback port 7080 behind Caddy, on a probe droplet. Cloudflare proxies the status host.; edge/, examples/edge/
Heartbeat ingest Worker; Cloudflare Worker, reaching the database through Hyperdrive; ingest/
Alert sender Worker; Cloudflare Worker with a minute cron plus the Telegram webhook, via Hyperdrive; sender/worker.ts, examples/sender/wrangler.toml
Watchdog Worker; Cloudflare Worker, independent of the probe fleet; docs/deploying.md step 9. watchdog/worker.ts is referenced there; I didn't open it.
CLI and stdio MCP bridge; npm package that calls the API. It is not a database client.; packages/staygreen/

Each service connects with its own restricted database login: probe, ingest, edge, alert_sender or watchdog (docs/deploying.md step 6). Only the app server holds the Supabase secret key (docs/architecture.md, "Credentials and boundaries").

One failed check, from probe to alert email

Scheduling. Each probe registers itself, and a timer wheel schedules the monitors it is eligible for (probe/runtime.ts, probe/schedule.ts). It runs the check using src/checks/*.
Confirmation. A failed check is not trusted on its own.
   needsConfirmation triggers confirm(m) in probe/runtime.ts (about line 552). That calls confirmersFor(...) to pick other probes and sends a signed POST /confirm to a peer (probe/peer.ts).
   The peer re-checks the monitor from its own location.
   The comment at probe/runtime.ts:109 says a failure is confirmed from a second location within 30 seconds. probe/state.ts classifies the outcome as pass, blip, unconfirmed or fail. A blip or unconfirmed failure changes nothing (state.ts:122).
   With no peers, the lone probe re-checks itself 20 seconds later (docs/deploying.md, "The smallest installation").
State machine. step() in probe/state.ts turns a confirmed failure into effects: record_failure, transition to down, and open_incident. The monitor leaves down only after two passes in a row (state.ts:17).
Write to Postgres. The probe's store (probe/store.ts) sends these effects as one call to a database function. probe_commit_monitor (supabase/migrations/20261023100000_service_monitors.sql:123) handles regular monitors, and probe_commit_heartbeat handles heartbeats (store.ts:261).
   Measurements go separately, in rollup batches roughly every 30 seconds through probe_flush_with_receipt (store.ts:277, runtime.ts:184). Those flushes also refresh the receipts the watchdog reads.
Outbox. The header of 20261022195510_alerts_email.sql says an incident never exists without its pending alert, because each event goes to an outbox table, alert_events. A unique index on (incident_id, kind) (line 120) makes each event happen once. I did not read the commit function body to confirm the insert happens inside it.
Fan-out. alert_events rows are expanded into one alert_deliveries row per channel and recipient (20261023120000_alert_channels.sql, lines 139–198).
Sender Worker. A minute cron (examples/sender/wrangler.toml: crons = ["* * * * *"]) runs scheduled() in sender/worker.ts:67.
   It calls runSender with batch: 1 (src/lib/alerts/sender.ts:185).
   runSender claims a delivery through the alert_claim or alert_claim_channels function, with a lease so only one sender holds it (sender.ts:391).
   It looks up workspace members from Clerk (deps.members, worker.ts:30).
   It sends the email through Postmark with sendEmail (sender.ts:302, src/lib/alerts/postmark.ts).
   It marks the delivery sent. If a claim has outlived its lease, it asks Postmark whether the email already went out (findSent, sender.ts:344). That is how retries avoid duplicate emails.

A recovery is the same path, with a resolved event instead of an opened one.

Failures of the monitoring itself

The watchdog (separate Worker) reads probe flush receipts. If they stop, it sends operator alerts through Telegram, with its own durable receipts (docs/architecture.md, "Checks and incidents" and "Alerts and public status"). Missed-heartbeat monitors take a different route in. Customer cron jobs ping the ingest Worker, which records the ping. The probes then judge whether it was missed (judgeHeartbeat, store.ts:234).

I cloned the repo into a temporary folder <clone>. This project has no changes and the repo is not added to it.
