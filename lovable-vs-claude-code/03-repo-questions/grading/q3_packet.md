# Question 3

What are the limits of each plan (monitors, apps, status pages, check intervals and anything else), and where in the code are they enforced?

## Answer 3A

Staygreen has two sold plans, Free and Builder, plus a private "demo" variant of Builder. All the numbers live in one table, limits in src/lib/plans.ts:73-110. Paths are relative to the clone at <clone>, and no files were changed.

The limits

Limit; Free; Builder; Enforced?
Apps; 1; 10; Yes
Monitors (automatic ones don't count); 50; 100; Yes
Status pages; 1; 10; Yes
Shortest HTTP/TCP interval; 3 min; 1 min; Yes
Heartbeat monitors; 5; 50; Yes
Assertions per HTTP monitor; 3; 10; Yes
Assertions per heartbeat; 1; 5; Yes
Monitors per host; 5; "fair use", passed to SQL as the monitor cap (100); Yes
Check locations; Toronto, San Francisco; adds Frankfurt; Yes, by the probes
Stripe monitors / poll interval; 1 / 10 min; 3 / 5 min; Yes, but the interval only in the server action (see below)
Supabase monitors; 1; up to the monitor cap; Yes
MCP server monitors / interval; 2 / 10 min; up to the cap / 5 min; No. Display only: the MCP monitor type can't be created yet
History; 30 days; 1 year; Only in the agent API (see below)
API / MCP calls per minute; 30; 120; Yes

The demo plan is Builder with higher counts: 100 apps, 1,000 monitors, 500 heartbeats and 100 status pages (plans.ts:116-117).

Builder also includes on/off features, each a separate Clerk feature (plans.ts:11-19,166-174):
white_label: remove the "Powered by Staygreen" mark;
private_pages: members-only pages, hidden from search engines;
alert_rules: route incidents and warnings to different channels;
notify_teammates: alert people who have no account;
history_1y: one year of history;
subscribers: email subscribers.

Limits that apply to every plan:
intervals fixed by monitor type: DNS at least every 10 min, SSL every 6 h (supabase/migrations/20261022040000_heartbeat_url_sealed.sql:101-105);
at most 3 unverified custom domains (supabase/migrations/20261023140000_status_edge.sql:165);
at most 100 API tokens (supabase/migrations/20261023150000_agent_surface.sql:66);
at most 50 components per status page (supabase/migrations/20261021210216_phase1_dashboard.sql:471);
a pause lasts at most 30 days (supabase/migrations/20261021212020_phase1_ack_and_pause.sql:40).

Where the plan comes from

Clerk session. entitlementsFrom turns Clerk's has({ feature }) answers into a plan. Holding scale_builder means Builder numbers; anything missing, misspelled or erroring falls back to Free (src/lib/plans.ts:145-162). With SELF_HOSTED_PLAN=builder, every workspace gets Builder without Clerk Billing (docs/deploying.md:63).
Copy in the database. The plan is also written to workspaces.plan (supabase/migrations/20261024090000_workspace_plan.sql:1-6, src/lib/workspace-plan.ts). Only the probes read this copy; what a member may do always comes from the session.

Where each limit is enforced

The server action passes the session's numbers to a SQL function. The SQL function locks the workspace row, counts, and refuses (plans.ts:6-7). The SQL functions have no plan table of their own: they refuse when a limit is missing (limits_required), but trust the numbers the app sends.

Monitors:
  createMonitor sends the monitor, heartbeat, assertion, per-host and interval limits (src/app/(app)/app/actions.ts:229-252).
  create_monitor turns them into monitor_limit, heartbeat_limit, assertion_limit, interval_not_allowed and host_limit errors (supabase/migrations/20261022040000_heartbeat_url_sealed.sql:82-113). Only http, ssl, dns, tcp and heartbeat types are accepted, which is why MCP monitors can't be created (heartbeat_url_sealed.sql:72-74).
  Edits recheck assertions, interval and per-host through update_monitor (actions.ts:346-363, supabase/migrations/20261022081211_monitor_edit_closes_incident.sql:69-82).
Stripe and Supabase monitors: saveServiceMonitor sends the type cap and the interval (actions.ts:307-315). save_service_monitor enforces the total cap and per-type cap (supabase/migrations/20261023100000_service_monitors.sql:33-34). It only checks that the interval is one of the allowed values (Supabase 60 or 180 s, Stripe 300 or 600 s), not which plan may use which (service_monitors.sql:46,60). So the plan's interval for these types is enforced only because the action computes it.
Apps: p_max_apps (actions.ts:114) is checked in create_app, which refuses with app_limit (supabase/migrations/20261022124400_apps_limit_and_logo.sql:65-68).
Status pages: p_max_pages (actions.ts:833) is checked in create_status_page, which refuses with page_limit (phase1_dashboard.sql:418-421).
Demo cloning sends all the same limits (src/app/(app)/app/clone/[slug]/actions.ts:44-46).
The agent API (src/lib/agent-service.ts:145,197) and custom-domain claims (actions.ts:984-985) pass the same limits.
Locations:
  Probes read Builder workspaces through probe_builder_workspaces (workspace_plan.sql:9-14).
  A Builder-only probe (Frankfurt) takes only those workspaces' monitors (probe/schedule.ts:46-47).
  A Builder-only probe refuses to start without PROBE_BUILDER_ONLY=true (docs/deploying.md:24).
API rate: each call spends from a per-workspace budget of apiPerMin (src/lib/agent-auth.ts:130). The SQL side refuses any limit above 120 (agent_surface.sql:77).
History: the agent API caps windows at 30 days, or 365 with history_1y (agent-service.ts:52,276). For the dashboard, historyLabel only appears in on-screen text (IncidentsScreen.tsx:33, SettingsScreen.tsx:118). I didn't find a plan-based cutoff in the snapshot queries, but I didn't trace them exhaustively.
Features:
  white_label and private_pages are checked in save_status_page (white_label_required, private_pages_required, phase1_dashboard.sql:462-470), with the action sending them at actions.ts:874-875. Making a page members-only is checked in save_status_page_access (status_edge.sql:140-143).
  alert_rules is checked in the action (src/app/(app)/app/alerts/actions.ts:317) and in set_alert_routing (supabase/migrations/20261023120000_alert_channels.sql:69).
  notify_teammates is checked at alerts/actions.ts:122,139.
  subscribers is marked "Coming soon" (src/components/PlanTable.tsx:69).
Error messages: refusals become plan-aware text in src/lib/db-errors.ts:56-75. Screens check the limits too (src/lib/upgrade.ts:86, PlanTable.tsx), but those checks are only for display.

What happens on upgrade and downgrade

Upgrade: HTTP, TCP and Supabase monitors still at the Free 3-minute interval move to 1 minute (src/lib/workspace-plan.ts:8-18).
Downgrade: nothing is removed or slowed down.
  Apps, pages and monitors above the new limit stay; the limit only blocks the next one (apps_limit_and_logo.sql:63-64).
  Monitors keep their 1-minute interval; the code leaves this as backlog (workspace-plan.ts:19).
  Private pages stay private (status_edge.sql:141).
  Frankfurt stops checking the workspace once workspaces.plan turns to free.

## Answer 3B

Staygreen has two plans, Free and Builder, defined once in src/lib/plans.ts:69-108. Server actions read the plan's numbers from the member's session and pass them to Postgres functions, and those functions refuse when a count would exceed them. The browser never decides a limit.

The limits (src/lib/plans.ts)

Limit; Free; Builder
Apps; 1; 10
Status pages; 1; 10
Monitors (total); 50; 100
Heartbeat monitors; 5; 50
HTTP/TCP check interval; 3 min; 1 min
MCP monitor interval; 10 min; 5 min
Stripe poll interval; 10 min; 5 min
Stripe accounts; 1; 3
Supabase monitors; 1; up to the total monitor limit
MCP monitors; 2; up to the total monitor limit
Assertions per monitor; 3; 10
Assertions per heartbeat; 1; 5
Monitors on one host; 5; "fair use" (no number below the monitor limit)
Check locations; Toronto, San Francisco; adds Frankfurt
History; 30 days; 1 year
API/MCP requests per minute; 30; 120

Some limits don't depend on the plan: SSL checks run every few hours and DNS every few minutes (the SSL_INTERVAL_SEC and DNS_INTERVAL_SEC values cited in src/app/(public)/bot/page.tsx:94). The database also requires any interval to be between 60 and 86,400 seconds (supabase/migrations/20261021210216_phase1_dashboard.sql:76).

Builder also includes on/off features that aren't numbers: white_label, private_pages, subscribers, alert_rules, history_1y and notify_teammates (plans.ts:11-19).

Two other cases change the numbers:
Private demo plan (scale_demo): 100 apps, 1,000 monitors, 500 heartbeats and 100 status pages (plans.ts:116-117).
Self-hosting: setting SELF_HOSTED_PLAN=builder gives every workspace Builder's limits (src/lib/self-hosted-plan.ts:6). The app refuses this setting on staygreen.io domains (src/lib/env-schema.ts:130-134).

How the plan is decided

entitlementsFrom() reads the plan from Clerk Billing feature flags (plans.ts:148-166). Any error falls back to Free, and an unread result is marked so it is never saved as the workspace's plan (src/lib/session.ts, which returns UNREAD).
syncWorkspacePlan() saves the plan on the workspace row, so the probes can route by it (src/lib/workspace-plan.ts). On an upgrade, it moves existing HTTP, TCP and Supabase monitors from the 3-minute to the 1-minute interval. A downgrade doesn't slow monitors back down; the code notes that as deferred.

Where each limit is enforced

Monitor count, heartbeats, assertions and per-host: createMonitor in src/app/(app)/app/actions.ts:229-251 passes these values to the create_monitor SQL function. That function raises monitor_limit when the count is reached (supabase/migrations/20261021210216_phase1_dashboard.sql:308-309, redefined in later migrations). Editing a monitor passes the assertion limits again (actions.ts:346-363).
Check interval: the server sets it from the plan rather than taking a value from the form: p_interval_sec: row.fixedIntervalSec ?? L.httpIntervalMin * 60 (actions.ts:230,240).
Stripe and Supabase monitors: save_service_monitor gets p_max_type (Stripe accounts or Supabase monitors), the total limit, the per-host limit and the plan's poll interval (actions.ts:309-315).
Apps: p_max_apps (actions.ts:114).
Status pages: p_max_pages (actions.ts:833), checked in SQL with v_count >= p_max_pages (phase1_dashboard.sql:398-420).
Custom-domain monitors: p_max_monitors and p_max_per_host (actions.ts:984-985).
Cloning a demo page: all the count limits plus the interval are passed at once (src/app/(app)/app/clone/[slug]/actions.ts:44-46).
Agent and API operations: src/lib/agent-service.ts:197 sends the same limits to SQL as p_limits.
API rate: deps.budget(..., entitlements.limits.apiPerMin) (src/lib/agent-auth.ts:130). Netlify also adds IP-level POST rate rules (netlify/edge-functions/*.ts).
History window: reads are capped at 30 days without history_1y (src/lib/agent-service.ts:52,276).
Frankfurt (Builder-only location): enforced in the probes, not the app. eligible() drops Builder-only probes for non-Builder monitors (probe/schedule.ts:46-47), using the plan stored on the workspace (probe_builder_workspaces, probe/store.ts:214).
Error messages: SQL refusals such as monitor_limit are turned into plan-aware text in src/lib/db-errors.ts.

Two of these numbers have no enforcement that I could find:
MCP monitors: I found no use of mcpMonitors or mcpIntervalMin outside plans.ts, the plan table and pricing copy, so in this code they appear only as displayed numbers.
History label: "30 days" / "1 year" is display text; the actual cap is the history_1y check above.

## Answer 3C

Staygreen plan limits and where they're enforced

There are two plans, free and builder. All the numbers are in one table, limits, in src/lib/plans.ts:73-110. The server actions pass those numbers into SQL functions, which lock the workspace row, count what already exists, and refuse the request. The screens only show the numbers. Two other details from that file:
A hidden demo plan (scale_demo) copies Builder but raises the counts to 100 apps, 1,000 monitors, 500 heartbeats and 100 pages (src/lib/plans.ts:116-117).
If Clerk can't be read, the workspace gets Free's limits (src/lib/plans.ts:5, 147-161).

The numbers (src/lib/plans.ts:73-110)

Limit; Free; Builder
Apps; 1; 10
Status pages; 1; 10
Monitors, not counting auto-added SSL monitors; 50; 100
HTTP/TCP check interval; 3 min; 1 min
Heartbeat monitors; 5; 50
Assertions per monitor; 3; 10
Assertions per heartbeat; 1; 5
Monitors on one host; 5; "fair use", which in practice means the monitor cap
Stripe accounts / poll interval; 1 / 10 min; 3 / 5 min
Supabase monitors; 1; "cap", meaning the monitor cap
MCP-server monitors / interval; 2 / 10 min; cap / 5 min
Probe locations; tor1, sfo3; adds fra1 (Frankfurt)
API/MCP calls per minute; 30; 120
History; 30 days; 1 year

Builder also turns on separate feature switches (src/lib/plans.ts:11-19): white_label, private_pages, subscribers, alert_rules, history_1y and notify_teammates.

Some limits are fixed by type and don't depend on the plan. SSL checks run every 6 hours and DNS checks at least every 10 minutes (supabase/migrations/20261022040000_heartbeat_url_sealed.sql:101-103).

Where each limit is enforced

The plan comes from Clerk features through entitlementsFrom (src/lib/session.ts:44). With SELF_HOSTED_PLAN=builder, every workspace gets Builder's limits instead (src/lib/session.ts:32, src/lib/self-hosted-plan.ts).

Counts and intervals, checked in SQL. The server actions pass the numbers as p_max_* parameters:

Limit; Server code that passes it; SQL that refuses it
Apps; src/app/(app)/app/actions.ts:114; app_limit, supabase/migrations/20261022124400_apps_limit_and_logo.sql:64-67. A workspace already over the limit keeps its apps; only new ones are refused
Monitors, heartbeats, assertions, per-host, minimum interval; create_monitor call at src/app/(app)/app/actions.ts:229-252; edit at :345-364; monitor_limit, heartbeat_limit, assertion_limit, interval_not_allowed, host_limit in supabase/migrations/20261022040000_heartbeat_url_sealed.sql:82-112. Edits use update_monitor, supabase/migrations/20261022081211_monitor_edit_closes_incident.sql:69-82
Stripe and Supabase monitors; src/app/(app)/app/actions.ts:307-314. Stripe sends p_max_type = stripeAccounts; the interval comes from stripePollMin or httpIntervalMin; monitor_limit and service_monitor_limit. Interval sets: Supabase (60, 180), Stripe (300, 600). Also host_limit. All in supabase/migrations/20261023100000_service_monitors.sql:33-60
Status pages; src/app/(app)/app/actions.ts:833; page_limit, supabase/migrations/20261021210216_phase1_dashboard.sql:418-420
Demo clone (apps, pages, monitors, assertions, per-host, interval); src/app/(app)/app/clone/[slug]/actions.ts:38-46; supabase/migrations/20261028090000_demo_clone.sql
Agent/REST monitor creation; src/lib/agent-service.ts:135-145, 195-197, which passes the whole L object as p_limits; supabase/migrations/20261023150000_agent_surface.sql

Locations. These are enforced by probe scheduling, not by SQL. A Builder-only probe such as fra1 takes only Builder workspaces' monitors (probe/schedule.ts:46-48). The plan used is the one the workspace last stored (supabase/migrations/20261024090000_workspace_plan.sql, read by probe_builder_workspaces in probe/store.ts:214).

API rate. apiPerMin is charged per workspace on every MCP/REST call (src/lib/agent-auth.ts:130), using the Postgres spend_budget counter (src/lib/budgets.ts:1-4).

Feature switches, checked in server actions:
white_label and private_pages: src/app/(app)/app/actions.ts:874-895
notify_teammates: src/app/(app)/app/alerts/actions.ts:122, 139
alert_rules, for routing by severity: src/app/(app)/app/alerts/actions.ts:317-322

History. The only enforcement I found caps agent/API history queries at 30 days without history_1y (src/lib/agent-service.ts:52, 276). The dashboard screens only show the label (IncidentsScreen.tsx:33). I found no code that deletes data older than the plan's retention window, and docs/architecture.md:50 says retention cleanup isn't implemented.

Limits that apply to every plan

These are hard-coded in SQL or in budget constants:
100 active API tokens per workspace: token_limit, supabase/migrations/20261023150000_agent_surface.sql:66.
3 unverified custom domains pending at once, and they expire after 7 days: pending_domain_limit, supabase/migrations/20261023140000_status_edge.sql:162-166.
"Test monitor" budget: 20 per member every 10 minutes and 100 per workspace per hour (src/lib/budgets.ts:12-15). Test alerts: 10 per member every 10 minutes and 30 per workspace per hour (:31-34).
POST requests on Netlify: 120 per minute per IP for members (netlify/edge-functions/member-rate.ts:5) and 30 per minute for public routes (netlify/edge-functions/public-rate.ts:6).

What is only on the pricing table

I found no server-side enforcement for these:
mcpMonitors and mcpIntervalMin are only shown in src/components/PlanTable.tsx:44. MCP monitoring is marked "soon".
subscribers (1,000 per page) is only shown, and is turned off in src/lib/launch.ts:93.
historyLabel is display text, enforced only for agent queries as described above.

## Answer 3D

Used 5 tools

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

## Answer 3E

Staygreen has two plans, Free and Builder, defined once in src/lib/plans.ts. The server action reads the limits from the member's session and passes them into the database functions as parameters. Those functions do the counting and refuse inside the transaction.

Limits per plan

These are the limits table at src/lib/plans.ts:73-110.

Limit; Free; Builder
Apps; 1; 10
Status pages; 1; 10
Monitors per workspace; 50; 100
Heartbeat monitors; 5; 50
Shortest HTTP/TCP check interval; 3 min; 1 min
Shortest Stripe poll interval; 10 min; 5 min
Stripe accounts; 1; 3
Supabase monitors; 1; up to the monitor cap
MCP monitors; 2; up to the cap
Shortest MCP interval; 10 min; 5 min
Assertions per monitor; 3; 10
Assertions per heartbeat; 1; 5
Monitors per host; 5; "fair use" (treated as the monitor cap)
Check locations; tor1 Toronto, sfo3 San Francisco; those two plus fra1 Frankfurt
History; 30 days; 1 year
API requests per minute; 30; 120

The monitor cap does not count automatic monitors (where ... not auto), for example the HTTPS-linked SSL monitor. This is in supabase/migrations/20261022040000_heartbeat_url_sealed.sql:82.

Builder also switches on features that are not numeric limits (builderSlugs, plans.ts:11-19): white-label, members-only pages, email subscribers, alert rules and maintenance windows, 1-year history, and notify-only teammates. Each one is its own Clerk feature, and only scale_builder decides the plan (entitlementsFrom, plans.ts:147-162).

A private scale_demo feature raises Builder to 100 apps, 1000 monitors, 500 heartbeats and 100 status pages (plans.ts:116-117).

Where each limit is enforced

Plan resolution. entitlementsFrom in plans.ts:147 turns Clerk feature checks into a plan and its limits. It fails toward Free: a failed read can only lower a limit (header comment, plans.ts:4-5; UNREAD at line 141). Server actions get the result as member.entitlements.limits.

Apps.
addApp passes p_max_apps to the create_app function (src/app/(app)/app/actions.ts:109-115).
The function locks the workspace and counts apps, raising app_limit when the count is at or over the cap (supabase/migrations/20261022124400_apps_limit_and_logo.sql:58-68).
A workspace already over the cap, for example after a lapsed Builder plan, keeps its apps and just can't add another (comment at line 63).

Status pages. actions.ts:833 passes p_max_pages, and the SQL raises page_limit (20261021210216_phase1_dashboard.sql:418-420).

Monitors, heartbeats, assertions, intervals, per-host.
createMonitor passes p_max_monitors, p_max_heartbeats, p_max_assertions, p_max_heartbeat_assertions, p_per_host and p_min_interval_sec to create_monitor (actions.ts:229-253).
The SQL raises monitor_limit, heartbeat_limit, assertion_limit, interval_not_allowed and host_limit (20261022040000_heartbeat_url_sealed.sql:82-113).
Editing re-checks assertions, interval and host in update_monitor (updateMonitor, actions.ts:345-347; 20261022081211_monitor_edit_closes_incident.sql:69-82).

Fixed interval rules in SQL, regardless of plan (heartbeat_url_sealed.sql:101-103):
DNS checks must be at least 600 seconds apart.
SSL checks must be exactly 21600 seconds (6 hours).
HTTP and TCP checks must be at least the plan's minimum.

Stripe and Supabase monitors.
saveServiceMonitor calls save_service_monitor with the monitor cap, a per-type cap and a poll interval (actions.ts:307-315).
The SQL raises monitor_limit and service_monitor_limit (20261023100000_service_monitors.sql:33-34).
The allowed intervals are hard-coded: Supabase monitors use 60 or 180 seconds, and Stripe monitors use 300 or 600 seconds (lines 46 and 60). stripePollMin feeds the p_interval_sec the app sends.

Locations. I did not trace this end to end. The Builder-only probe takes only Builder workspaces' monitors (eligible() in probe/schedule.ts:46-48). It knows the plan from a store table, probe_builder_workspaces, per the comment at plans.ts:57-62. Confirmation prefers the other continent for Builder (confirmersFor, schedule.ts:72). docs/deploying.md step 4 says a workspace's stored plan follows on its next request from a member or an agent.

History window.
The agent API caps the window at 365 days with history_1y, else 30 days (src/lib/agent-service.ts:51-52).
The dashboard only displays historyLabel (for example IncidentsScreen.tsx:33).
I did not find retention cleanup. docs/architecture.md says it is not implemented merely by deploying.

API rate. src/lib/agent-auth.ts:130 applies entitlements.limits.apiPerMin as a per-workspace budget.

Error messages. src/lib/db-errors.ts turns each database refusal (monitor_limit, app_limit and so on) into a sentence with the plan's numbers in it.

Things to know

Enforcement is in SQL, but the numbers come from the app. The functions take the caps as parameters and refuse when count >= cap. The database trusts whatever the app server sends, which is acceptable because only the app server holds the secret key (docs/architecture.md, "Credentials and boundaries"). Most of the limits are enforced inside the create_* and save_* functions with the workspace row locked.
Self-hosting: SELF_HOSTED_PLAN=builder gives every workspace Builder limits without Clerk Billing (src/lib/env-schema.ts:69, docs/deploying.md step 4). The env schema refuses it on staygreen.io hosts (env-schema.ts:130-134). To change the numbers, edit limits.builder in plans.ts.
MCP monitors: mcpMonitors and mcpIntervalMin are defined, but I found no enforcement of them in src. agent-service.ts:180 says "MCP server monitors are Coming soon", and db-errors.ts says that kind of monitor isn't available yet.
Not checked: I did not read the update paths for the status page cap or the agent-API create paths (agent-service.ts:135 and :195) line by line. They read the same limits.
