# QA grades, round 2 (blind)

Graded against a fresh clone of phuryn/staygreen at commit `e73a0df` ("phase4-2026-11-08.1"). I opened every cited file and checked each concrete claim. Scores: correctness 0-10 (confirmed errors, weighted by severity), completeness 0-10 (against what the code shows), usefulness 0-10 (for an engineer acting on it). The labels are blind. Grades are in `qa_grades2.json` next to this file.

## Scores

| Answer | Correct | Complete | Useful |
|---|---|---|---|
| q1A | 9 | 9 | 9 |
| q1B | 10 | 8 | 8 |
| q1C | 7 | 7 | 7 |
| q2A | 7 | 7 | 7 |
| q2B | 10 | 9 | 9 |
| q2C | 7 | 8 | 8 |
| q3A | 8 | 8 | 8 |
| q3B | 10 | 7 | 8 |
| q3C | 9 | 10 | 9 |
| q4A | 9 | 8 | 9 |
| q4B | 9 | 10 | 10 |
| q4C | 8 | 7 | 7 |
| q5A | 8 | 8 | 8 |
| q5B | 9 | 9 | 9 |
| q5C | 9 | 10 | 9 |

## Q1: Architecture and a failed check's path to email

**What the code shows.**

Deployed parts:
- Next.js app on Netlify, or any Node 22+ host (`docs/deploying.md:13`).
- Supabase Postgres.
- Two or more probe VMs under systemd (`examples/probe/staygreen-probe.service`).
- Status renderer on `127.0.0.1:7080` behind Caddy on a probe box, with CPU and memory caps (`examples/edge/staygreen-edge.service:4-7,21-23`). Cloudflare proxies the status host.
- Three Cloudflare Workers, each with its own Hyperdrive and restricted role: ingest `monitoring-ingest` (`ingest/wrangler.toml:2`), sender (cron `* * * * *` plus `/api/telegram/webhook`, `examples/sender/wrangler.toml:14-17`), and watchdog (cron plus a Durable Object).
- A CLI and stdio MCP bridge that runs on the user's machine.

The path of one failed check:
1. **Home and schedule.** Rendezvous ranking picks the home probe (`probe/schedule.ts:1-15,51-56`).
2. **Check.** `tick` calls `checkAndReport`, which calls `runCheck` and `checkHttp` (`probe/runtime.ts:513-552`).
3. **Canary.** A failure from a probe that can't reach its canaries is dropped (`:499`).
4. **Confirmation.** `confirm` asks `confirmersFor` peers in order: other locations only, Builder prefers the other continent (`schedule.ts:72-80`). Each is a signed `POST /confirm` (`peer.ts:5-17,72-89`) within a 30 s budget (`runtime.ts:110,577`).
   - The probe re-checks itself after 20 s when no other location is live or every peer answered 409 (`:572-576,587`).
   - Otherwise the failure stays unconfirmed (`:588`).
5. **Hand-off.** `deliver` applies the outcome directly when this probe is home. Otherwise it goes in the outbox, sent once a second over `POST /report` (`runtime.ts:181,605-638`).
6. **Commit.** `Store.apply` locks the row with `probe_lock_monitor`, applies the version and ordering fences, runs `step`, then calls `probe_commit_monitor` (`store.ts:303-415`). That function inserts the transition, failures and incident (`service_monitors.sql:123-189`).
7. **Queue.** The `incidents_alert_events` trigger fires AFTER INSERT OR UPDATE OF `resolved_at` and adds an `opened` row to `alert_events` (`alerts_email.sql:209-239`).
8. **Send.** The sender Worker calls `runSender` with `deps.channels` (`sender/worker.ts:31,71`):
   - `alert_pending_events`, then Clerk members, then `alert_expand`.
   - `alert_claim_channels` with a 300 s lease (`sender.ts:392`).
   - `sendEmail` to Postmark with List-Unsubscribe headers (`:280-317`), then `alert_mark`.
   - Retries back off, up to 8 tries.
   - A send whose answer was lost is reconciled through Postmark's message search (`:335-358`).

**q1A** is the most complete and precise. Every line reference I checked matches. It adds two useful extras:
- The stale header in migration 023, which says "Netlify scheduled function" and "server's own key" (`alerts_email.sql:7-8,24-25`). Migration 027 adds the `alert_sender` role.
- `deliverNow` on the dashboard (`server.ts:25-27`).

Its only slips are wording ("Worker reached through Hyperdrive"). It also omits the "all peers declined" re-check case.

**q1B** has no factual errors I could confirm. It covers the home hand-off, the confirmation rules, the trigger and reconciliation, plus side paths (heartbeats, watchdog receipts). It leaves out the canary and retry details, and its references are approximate.

**q1C** has the right part list but three flow errors:
1. It says the sender claims with `alert_claim`. The Worker uses `alert_claim_channels` for every kind; `alert_claim` is the legacy email/Telegram claim that only the app's `deliverNow` uses (`standalone.ts:32-42`, `alert_channels.sql:1-2,219`).
2. It then describes `alert_claim_channels` as the special route for Telegram, Slack and webhooks, which is backwards.
3. It skips the home-probe hand-off entirely. It says "the probe's store writes", but for most monitors the observing probe is not the one that writes.

## Q2: When an incident opens and resolves

**What the code shows.**

Opening:
- A failed HTTP check always needs confirmation (`state.ts:70-75`).
- The second look decides (`:114-131`):
  - Second failure: verdict `fail`, a move to `down` and `open_incident`, unless the monitor is already down.
  - Second pass: `blip`.
  - No answer: `unconfirmed`. Both noise cases return the state unchanged, with no streak effect (`:122`).
- A monitor that has never passed (state `null`) also goes straight to down.
- The confirmation rules are the same as in Q1: canary, same-location exclusion, Builder continent preference, 30 s budget, 20 s self re-check.

Resolving:
- `RECOVERED_AFTER = 2` passes in a row while down. A confirmed failure resets the count; noise doesn't. The monitor moves to `degraded` if `slowStreak >= 3` (`:136-141`).
- `probe_commit_monitor` closes the incident on any transition from `down`, with "Two checks passed, incident closed" (`service_monitors.sql:164-168`).

Other closures:
- **Address change.** For HTTP, only a target change closes the incident, with "Address changed, incident closed" (`20261022081211...sql:103-107`).
- **Service monitor edit.** Any verified edit of a Stripe or Supabase monitor closes it, with "Monitor edited and verified..." (`service_monitors.sql:62-67`).
- **New outage.** A new outage closes a stale open incident (`:174-180`).

Not closures:
- No manual resolve exists. I found no `resolved_at` write in `src/`.
- A pause doesn't close anything.

Alerts: a `resolved` alert goes out only if an `opened` alert exists and the monitor is `up`, or `degraded` after a `down` incident (`alerts_email.sql:224-231`).

**q2B** matches all of this and is the best answer:
- The verdict table.
- The canary and continent rules.
- The never-passed case, the self re-check exception, and timing.
- That noise doesn't break the pass streak.
- The address-edit text, the service-monitor variant, pause, and the absence of a manual resolve.
- The resolved-alert conditions.

I confirmed no errors.

**q2A** has the core right, but its edit closure is wrong for website monitors. It quotes the service-monitor text "Monitor edited and verified", says HTTP edits close after "the new settings pass a check", and claims migration 081211 added the text. 081211 closes the incident only on an address change, with different text.

**q2C** has precise `state.ts` references, but two errors:
1. It says the self re-check timeline reads "Incident opened". It reads "Confirmed from <same city>, incident opened", because `evidenceOf` keeps the confirm location (`state.ts:84`, `store.ts:387-390`).
2. It makes the same edit-closure mistake as A, citing 081211:105, which says "Address changed".

It also never states the 30 s value.

## Q3: Plan limits and where they're enforced

**What the code shows.**

- **The numbers.** The `limits` table (`plans.ts:73-110`) plus demo limits (`:116-117`). Builder numbers follow `scale_builder`; the other six slugs are independent switches (`:145-162`). An unread plan fails to Free.
- **Enforcement path.** The app passes the numbers to SQL, which locks the workspace row and counts.

| Check | Called from | SQL |
|---|---|---|
| `create_monitor` | `actions.ts:229-254` | `heartbeat_url_sealed.sql:59-113` |
| `update_monitor` | `actions.ts:354-364` | `081211:37-84` |
| `save_service_monitor` | `actions.ts:307-315` | `service_monitors.sql:9-61` |
| `create_app` | `actions.ts:114` | `apps_limit_and_logo.sql:39-68` |
| `create_status_page` | `actions.ts:833` | `phase1_dashboard.sql:391-421` |
| `verify_page_domain` | `actions.ts:984-985` | |
| `clone_demo_page` | `clone/[slug]/actions.ts:44-46` | |
| `agent_write` | `agent-service.ts:196-197` | |

- **Fixed per-type rules.** DNS >= 600 s and SSL = 21600 s (`heartbeat_url_sealed.sql:101-105`). Supabase uses 60 or 180 s, Stripe 300 or 600 s (`service_monitors.sql:46,60`).
- **Caps that don't depend on the plan.** 100 active API tokens, 3 pending custom domains.
- **Agent API rate.** `apiPerMin` per workspace (`agent-auth.ts:130`).
- **Frankfurt.** Gated by `eligible` and `probe_builder_workspaces`.
- **History.** Only the agent API clamps by `history_1y` (`agent-service.ts:52,276`). The dashboard's `workspace_history` and `monitor_history` take no plan argument.
- **Display-only.** The MCP limits (create refuses the type) and subscribers (`launch.ts:93`).
- **Downgrades.** Existing items over the new caps are kept (`workspace-plan.ts:19`).

**q3C** is the most complete answer. It has every limit, the enforcement path, fixed and non-plan rules, a feature-switch table with call sites, the history gap and the downgrade gap. Two small faults:
- It marks the plan-based Stripe interval as enforced by SQL. SQL accepts 300 for any plan; the plan difference comes from the app always passing the plan's value.
- One line reference is off (`workspace-plan.ts:19`, not `:22`).

**q3B** has no errors I could confirm, and good references for monitors, services, apps, pages, domains, tokens, Frankfurt and the downgrade gap. It is less complete:
- It says it didn't trace the feature switches or history.
- Its table lists the MCP limits without saying they aren't enforced.

**q3A** has a correct table and catches the MCP and subscribers gaps. Three inaccuracies:
1. It says the 120/min admission budget applies to each token. It is keyed on the workspace (`agent-auth.ts:103`).
2. It says limits are passed "when a domain is added". They're passed at verification.
3. It says `service_monitors.sql` holds "the current monitor_limit and host_limit" checks. That's true only for Stripe and Supabase.

It misses the fixed per-type rules, the non-plan caps, SELF_HOSTED_PLAN and the downgrade gap.

## Q4: API token authentication, storage, read-only scope

**What the code shows.**

Authentication, in `requireAgent` (`agent-auth.ts:86-138`):
1. A header matching `Bearer sg_` takes the token path. `parseApiToken` requires `sg_<24hex>.<43 b64url>` (`api-token-crypto.ts:11-14`).
2. The row is selected by `kid`.
3. `matchesApiToken` compares HMACs with `timingSafeEqual`, against a zero hash when no row was found. Missing, wrong and revoked tokens all get the same 401.
4. The admission budget is 120 per workspace (`:103`).
5. `last_used_at` is touched at most once a minute.
6. The plan's `apiPerMin` budget applies (`:130`).
7. With SELF_HOSTED_PLAN set, `syncWorkspacePlan` runs (`:134-136`).

OAuth is accepted only at `/mcp` and always gets scope `write`.

Storage:
- The hash is HMAC-SHA256 with the pepper over `["staygreen/agent/v1","token",[workspaceId, secret]]`.
- The table has check constraints, RLS on, browser roles revoked, and grants for `service_role` only (`agent_surface.sql:5-13,53-59`).
- The plaintext is shown once. Minting requires `tokens:manage` and a budget of 10, and the database caps a workspace at 100 active tokens. Revocation sets `revoked_at`.

Read-only scope:
- `AGENT_PERMISSIONS.read` is `monitors:read` only.
- `write()` checks scope first (`agent-service.ts:151`).
- `agent_write` checks `p_scope` (`agent_surface.sql:126`) and re-reads the token row FOR SHARE (`:135-137`).
- REST dispatches into the same `executeAgentTool` (`agent-transport.ts:110-118`).

Side effects of read-token calls:
- `last_used_at`, budget counters and the `agent_calls` log.
- `scan_app`, which makes outbound requests.
- The self-hosted plan sync.

One nuance all three get slightly wrong: `executeAgentTool` zod-parses the input (`:214`) before the scope check in `write()`. Nothing reaches the database first, so this is minor.

**q4B** is the most complete and the only one to find the SELF_HOSTED_PLAN sync, a real configuration write a read token can trigger. It also covers the `agent_calls` log, the transport hardening, RLS and the in-transaction re-check. Its `agent-auth.ts` references drift by about 3 lines.

**q4A** is precise, with exact references throughout. It is correct on dummy-hash comparison, the workspace-bound hash and `scan_app`. It misses the SQL token-row re-check, RLS, the `agent_calls` log and the self-hosted sync. It flagged the REST route as unverified; I confirmed it dispatches into the same `executeAgentTool`.

**q4C** gets the core right but:
- It says "The most a write token can do is draft an incident update". Write tokens can also provision apps, create monitors and pause.
- It misses `scan_app`, `agent_calls` and the self-hosted sync.
- It has few line references.

## Q5: Adding Microsoft Teams as an alert channel

**What the code shows.** `grep -i discord` finds 18 non-test files and 4 test files:
- `alert_channels.sql:5,185`
- `model.ts:217`
- `alerts/server.ts:33,81`
- `channel-input.ts:15-31`
- `providers.ts:58-78`
- `sender.ts:12,272,339,363,377`
- `alerts/actions.ts:7,223,289`
- `ChannelSettings.tsx:18,47,54-59`
- `AlertsScreen.tsx:33,98,361`
- `ChannelIcon.tsx:4,6`
- `PlanTable.tsx:51`
- `(public)/page.tsx:95`
- `privacy/page.tsx:168,270`
- `billing.json:115`
- `deploying.md:26`
- `budgets.ts:38`
- `launch.ts:83`
- `examples/sender/wrangler.toml:2,38`
- Tests: `tests/unit/channels.test.ts`, `tests/unit/channel-actions.test.ts`, `tests/integration/channels.test.ts`, `tests/e2e/channels.auth.spec.ts`.

`database.types.ts` has no kind union. `SendResult.sent` requires a `messageId` (`outcome.ts:11`). An unhandled kind is failed with "This kind of channel can't send yet." (`sender.ts:387`), so the sender Worker must deploy before the app exposes the kind.

All three answers find the full file list with accurate references and pick Discord as the template.

**q5C** has the best Teams-specific guidance:
- Workflows URLs carry query parameters, so `discordUrl`'s `u.search` refusal must not be copied.
- The missing message id.
- Adaptive Cards.
- The correct deploy order: sender before app.

Two small faults: its `sendDiscord` reference is off (`:66-86`, not `:58-78`), and it lists a test file with no Discord case.

**q5B** is equally thorough on files and raises the message-id question. Its deploy order puts the app before the sender, citing `deploying.md:70`, which doesn't say that. In that gap, Teams receipts are failed rather than delayed.

**q5A** has precise file and line references. It tells the reader to make `teamsUrl` refuse query strings, which would reject real Workflows URLs, and it lists `tests/unit/alerts.test.ts`, which has no Discord case. It misses the deploy order and the message-id problem.

## Claims I couldn't verify against the repo

- Microsoft Teams Workflows behaviour: 202 with no body, Adaptive Card payloads, hosts such as `*.logic.azure.com` and `*.powerplatform.com`, the retirement of `*.webhook.office.com`, and query parameters like `sig` and `api-version`. This is outside the repo. I graded B and C's caveats as sound and A's query-string rule as a likely break; that judgement is from my own knowledge, not the code.
- q4B says `scan_app` "goes through the same protection that refuses private and unsafe addresses". I didn't open `runScan`'s internals; `architecture.md:34` states the policy.
- Netlify's adapter pin and Clerk Billing's live configuration. I checked only the repo files that the answers cite.
