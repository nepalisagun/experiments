# Q5 grades: adding Microsoft Teams as an alert channel

## Reference answer (from the code at e73a0df)

- **What to copy: Discord.** A channel is one pasted webhook URL, sealed into `alert_channels.sealed`, created by `addWebhookChannel`, and delivered by the sender Worker's channels branch. A send whose answer was lost is never retried.
- **New migration** (never edit an applied one: `docs/deploying.md:61`):
  - Drop and re-add `alert_channels_kind_check` with `'teams'` (`supabase/migrations/20261023120000_alert_channels.sql:4-5`).
  - Re-create `public.alert_expand` (`:132-201`) with `'teams'` in the incident-branch list (`:185`).
  - Trap: the test-event branch (`:155-166`) has no kind filter. If you forget this change, "Send test" still works but real incidents silently create no Teams receipts.
  - No change needed:
    - `alert_channels_built` (`:6-8`)
    - `alert_claim_channels` and its wrapper (`:273-369`)
    - the legacy `alert_claim`, which stays email/Telegram only (`:219`)
    - `database.types.ts`, which types `kind` as `string`
  - No later migration redefines `alert_expand`.
- **Validation:** add `teamsUrl()` built on `webhookUrl()` (`src/lib/alerts/channel-input.ts:5-13`), like `discordUrl` (`:15-21`). Add `"teams"` to the enum (`:24`) and the superRefine message (`:30-31`). There is no secret.
- **Provider:** add `sendTeams` modelled on `sendDiscord` (`src/lib/alerts/providers.ts:58-78`).
  - Re-validate the URL at send time. Use `redirect: "manual"`, a 10 s timeout and one POST. Mask the text and cap its length while keeping the footer (`:26-35`). Read the reply with `smallJson`.
  - Map the reply: 429 → retry, 4xx → rejected, anything else → `uncertain` (unknown), and a request `neverLeft(e,"manual")` proves never left → retry (`outcome.ts:10-24`).
  - Trap: `sent` needs a `messageId` (`outcome.ts:11`), and the database refuses a sent row without `provider_id` (`20261022195510_alerts_email.sql:152,447-448`). Teams webhooks reply 202 with no id, so don't copy Discord's `?wait=true` and id check (`providers.ts:61,72`).
- **Sender** (`src/lib/alerts/sender.ts`):
  - Import (`:12`), add to the list (`:363`), dispatch after `:377`.
  - Add Teams to the unknown → fail branch (`:272`) and the in-doubt branch (`:339`). Without these, an unknown result is left claimed and re-sent once its lease expires.
  - `claimedDto` kind is `z.string()` (`:115`). `sender/worker.ts:31` needs no change: `CREDENTIALS_KEY` and `fetch` are already passed.
- **Dashboard action** (`src/app/(app)/app/alerts/actions.ts`): import (`:7`), test-queue list (`:223`), credential (`:289`). `addWebhookChannel` (`:276-295`) already enforces `channels:manage` and the `alert_confirm` budget. Its DNS check runs only for `webhook` (`:284-287`).
- **Types and UI:**
  - `src/lib/model.ts:217`
  - `src/lib/alerts/server.ts:33,81`: without this, the overview parse throws and the Alerts screen breaks.
  - `ChannelSettings.tsx:18,47,54-59`
  - `AlertsScreen.tsx:98,361`: without line 98, a Teams channel falls through to the email wording; the comment at `:33` also lists channels.
  - `ChannelIcon.tsx:4,6`
- **Copy and docs:**
  - `PlanTable.tsx:51`
  - `(public)/page.tsx:95`
  - `privacy/page.tsx:168,270`
  - `scripts/clerk/billing.json:115`
  - `docs/deploying.md:26`
  - `examples/sender/wrangler.toml:2,38` (comments)
  - comments in `budgets.ts:38` and `launch.ts:83`
- **Tests:**
  - `tests/unit/channels.test.ts`: validation `:49-53`, provider `:77-107`, sender `it.each` at `:111`, `receipt()` URL at `:21`
  - `tests/unit/channel-actions.test.ts:41`
  - `tests/integration/channels.test.ts:41`
  - `tests/e2e/channels.auth.spec.ts:27-28`
- **Deploy order:** migration, then the sender Worker, then the app (`docs/deploying.md:61,70`). If you skip the Worker, the old sender fails Teams receipts with "This kind of channel can't send yet." (`sender.ts:387`).

## A: correctness 8, completeness 7, usefulness 7

**Strengths:**
- The most exhaustive file list: `billing.json`, both privacy lines, every comment, the e2e spec.
- Line numbers are almost all accurate.

**Errors:**
- It tells the developer to make `teamsUrl` "refuse query strings … the same way discordUrl". Workflows URLs (which the answer names) carry their signature in the query string, so this rule would reject every one of them.
- It points the sender-routing tests at `tests/unit/alerts.test.ts`, which holds no channel-routing tests. Those are in `channels.test.ts`.
- Its SendResult mapping leaves out `unknown`.

**Gaps:**
- It misses the most important Teams trap: no message id on a 202, while the database requires `provider_id` on sent rows.
- It gives no deploy order.
- It skips the send-time conventions: re-validate the URL, `redirect: "manual"`, the timeout.

## B: correctness 9, completeness 9, usefulness 10

**Strengths:**
- The most actionable answer, and correct on every substantive point.
- The provider contract is right, including `smallJson`'s 64 KiB cap and `detail` in our own words.
- It catches the `provider_id` trap with the right constraint.
- It is the only answer that states `alert_expand`'s effect precisely ("routed incidents never create a Teams receipt").
- It covers `billing.json`, both privacy lines and the wrangler comments, with a correct, explained deploy order.
- It flags the Workflows/Adaptive Card change from outside the repo.

**Errors (minor):**
- Two line numbers are off by one.
- "Every migration header" overstates it: only about 20 of 36 carry the line.
- It calls both ChannelIcon maps Records; only `kindName` is.
- One citation is slightly off (`deploying.md:80` should be `:70`).

**Gaps:** the sender-level `it.each` test and a few channel-list comments.

## C: correctness 8, completeness 8, usefulness 8

**Strengths:**
- A thorough, accurate file list, with good test pointers: the `receipt()` helper and the integration constraint.
- A correct rollout order.

**Errors:**
- Its explanation of why the order matters gets the control flow wrong. The current sender never reaches the generic-webhook path for `teams`. It fails with "This kind of channel can't send yet." at `:387`.
- It overstates `alert_expand`'s effect, since test alerts still get receipts.
- Two small type-description slips.

**Gaps:**
- It misses the messageId/`provider_id` trap, the main way a straight copy of `sendDiscord` breaks for Teams.
- It omits `billing.json`.

## D: correctness 9, completeness 9, usefulness 9

**Strengths:**
- Precise, well-cited answer with accurate migration line ranges (`:132-201`, `:286-314`).
- It catches the `provider_id` trap with the right constraint and explains why `server.ts` matters (the overview parse).
- It notes that recoveries can't be threaded.
- It gives a correct deploy order and an outside-repo caveat.

**Errors (minor):**
- It overstates `alert_expand`'s effect.
- Its fallback "use the signed-webhook path instead" is loose: that path needs a signing secret and posts Staygreen's own JSON. Only the DNS check and the pinned transport are reusable.

**Gaps:**
- Privacy line 270.
- The import edits are only implied.

## E: correctness 9, completeness 8, usefulness 8

**Strengths:**
- Careful and honest about what it didn't check.
- Accurate line references throughout.
- It correctly says only `kindName` is a Record.
- It points to the `it.each` test at `:111` that needs Teams.
- It covers the messageId requirement and warns against copying Discord's id check.
- Its notes on the transport and retry schedule are useful.

**Errors (minor):**
- It says `tests/integration/alerts.test.ts:223` tests the kind constraint. It tests the credential (`built`) constraint.
- It overstates `alert_expand`'s effect.
- "Treating 202 as accepted" would still need an id.

**Gaps:**
- `billing.json`, privacy line 270 and the e2e spec.
- It left the wrangler lines unread.
