# Question 5

I want to add Microsoft Teams as a new alert channel. List every file I would need to change or add and the steps, following the pattern the existing alert channels use.

## Answer 5A

Used 4 tools

Teams would be easiest to add as a copy of the Discord channel. Discord is set up by pasting a webhook address, which is how Teams incoming webhooks (Workflows) work too. Slack needs its own app sign-in flow and Telegram a chat bot, so neither is a good template.

Below, the files are listed in the order you'd change them, with what each currently says about Discord. Nothing in your project was changed.

Database: a new migration

Add supabase/migrations/<timestamp>_teams_channel.sql. Migrations already applied are never edited.

Allowed channel types. Drop and re-add alert_channels_kind_check with 'teams' added. It currently lists ('email','telegram','slack','discord','webhook') (supabase/migrations/20261023120000_alert_channels.sql L4–5).
Event expansion. Replace public.alert_expand so its channel filter includes 'teams'. That filter is c.kind in ('email','telegram','slack','discord','webhook') (same file, L185). Without this change, no receipts are ever created for a Teams channel.
No change needed to alert_channels_built (L6–8). It already requires a sealed credential and a label for every channel type except email and Telegram.
No change needed to alert_claim_channels (L273+). It returns c.kind without filtering by it.
Database types. Regenerate src/lib/database.types.ts if kind appears there as a fixed list of values.
Shared types and validation
src/lib/model.ts L217: add "teams" to ChannelKind.
src/lib/alerts/server.ts L33 and L81: add "teams" to the kind type and to the z.enum that reads channel rows.
src/lib/alerts/channel-input.ts:
Add a teamsUrl(value) check next to discordUrl (L15). It should allow only HTTPS on Microsoft's webhook hosts and refuse query strings and other tricks, the same way discordUrl limits itself to discord.com.
Add "teams" to kind: z.enum(["discord","webhook"]) (L24) and to the error message (L30–31).
Sending
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
Dashboard
src/app/(app)/app/alerts/actions.ts:
L7: import teamsUrl.
L223: add "teams" to the list of channels whose test message is queued.
L289: build { url: teamsUrl(v.url)!.href } for Teams; it is then sealed with channelContext like Discord's.
The rest of the add-channel action stays as it is (permission check, spend(member, "alert_confirm") rate limit, insert).
src/app/(app)/app/alerts/ChannelSettings.tsx: add "teams" to the kind state (L18), a "Microsoft Teams" button (L47), and the dialog title, field label and hint text (L54–59).
src/app/(app)/app/alerts/AlertsScreen.tsx: add a description line (L98) and a "Teams message" label in delivery history (L361). Update the comment at L33.
src/components/alerts/ChannelIcon.tsx L4–6: add an icon and kindName.teams = "Microsoft Teams".
Public wording and docs
src/components/PlanTable.tsx L51
src/app/(public)/page.tsx L95
scripts/clerk/billing.json L115 (the feature name shown in Clerk Billing)
src/app/(public)/legal/privacy/page.tsx: L168 (what the service receives) and L270 (the webhook address is encrypted and never shown after saving)
docs/deploying.md L26
src/lib/budgets.ts L38 (comment) and src/lib/launch.ts L83 (comment). Add a launch flag in launch.ts if Teams should first show as "soon".
Tests

Extend the existing Discord cases:

tests/unit/channels.test.ts: address validation and sendTeams replies.
tests/unit/channel-actions.test.ts: the add-channel action.
tests/unit/alerts.test.ts: how the sender routes a Teams receipt.
tests/integration/channels.test.ts: the database type check and alert_expand.
tests/e2e/channels.auth.spec.ts: adding a Teams channel in the dashboard.
Not checked in the code
Microsoft's side. Which Microsoft hosts the address check should allow, and the exact message format (an Adaptive Card or a simple text post), come from Microsoft's Teams Workflows webhook documentation. Staygreen's code doesn't cover these, and I haven't looked them up.
Threading. If you want "resolved" posts threaded under the opening post, as Slack does with parentProviderId, you'd need a Graph API sign-in flow modelled on connectSlack. That is a much bigger change.

## Answer 5B

Adding Microsoft Teams as an alert channel

Pattern to copy: Discord. Like Discord, a Teams channel would be a single webhook URL stored encrypted as the credential. It is created with a form on the Alerts screen, delivered by the sender Worker's generic slack/discord/webhook branch, and never retried when the provider's answer is uncertain. Email and Telegram are older special cases, and Slack needs an OAuth app, so none of those three is a good model.

Database: new migration

Add supabase/migrations/<timestamp>_teams_channel.sql. Don't edit an applied migration (docs/deploying.md:61; every migration header says "never edited after it is applied"). Use the same additive pattern as supabase/migrations/20261023120000_alert_channels.sql:

Kind check (copy lines 4-5):
  drop alert_channels_kind_check
  re-add it with ('email','telegram','slack','discord','webhook','teams')
Fan-out: recreate public.alert_expand with 'teams' added to its kind list (20261023120000_alert_channels.sql:185). Otherwise routed incidents never create a Teams receipt.
No change needed:
  alert_channels_built (lines 7-8) already requires sealed, confirmed_at and label for every kind other than email or Telegram.
  alert_claim_channels (lines 273-340) doesn't filter by kind, so it will hand out Teams receipts.
  The old alert_claim (line 219) is limited to email and Telegram on purpose. Leave it alone.
  The alert_sender.* wrappers (lines 356+) only delegate, so the sender role needs no new grant.

Check whether any later migration redefines alert_expand, and base your copy on the newest definition. Then add a case to tests/integration/channels.test.ts, which covers the Discord rows today.

Validation of the credential

Change src/lib/alerts/channel-input.ts:
Add a teamsUrl(value) function modelled on discordUrl (lines 16-22). It should build on webhookUrl(), which already enforces HTTPS on port 443, no login or fragment, and no private or local host (lines 5-14). On top of that, it should allow only Microsoft's webhook hosts and path shape.
Add "teams" to channelInput.kind (line 25). Give it its own error message in superRefine. Teams uses no signing secret, so treat it like Discord rather than webhook.

The provider call

Change src/lib/alerts/providers.ts. Add sendTeams(url, message, doFetch) next to sendDiscord (lines 58-78) and keep its contract:

Request:
  redirect: "manual" and AbortSignal.timeout(10_000)
  exactly one POST, with no chunked sends
  text built from text(message), which is masked. Shorten it the way discordText keeps the link footer (lines 27-35).
Response:
  Read it with smallJson, which caps it at 64 KiB.
  Map it to SendResult (src/lib/alerts/outcome.ts:10-14):
    429 → retry
    4xx → rejected
    5xx or unclear → unknown
    neverLeft(e, "manual") → retry
  Write detail in your own words and never copy the provider's response body into it (outcome.ts:8).
The sent case needs a messageId. The database requires provider_id on a sent row (supabase/migrations/20261022195510_alerts_email.sql:152). If Teams answers without an id, as Workflows webhooks typically do with a bare 202, use a stable value such as a request-id header from the response, or the delivery id.

Sender dispatch

Change src/lib/alerts/sender.ts:
Line 12: import sendTeams.
Line 363: add "teams" to ["slack", "discord", "webhook"].
After line 377: add if (d.channel.kind === "teams") return settle(d, await sendTeams(credential.url ?? "", message, deps.channels.fetch));
Line 272, the unknown result: add Teams to the Slack/Discord "may have arrived, not sent again" failure.
Line 339, in-doubt claims: add Teams to the same branch.

sender/worker.ts needs no change. deps.channels already carries CREDENTIALS_KEY and fetch (lines 31-32).

Dashboard action

Change src/app/(app)/app/alerts/actions.ts:
Line 7: import teamsUrl.
Line 289: credential for Teams: { url: teamsUrl(v.url)!.href }. It is sealed with channelContext(workspace, id) as the other kinds are.
Line 223, the test-send message: add "teams" to the queued kinds.

Channel creation already goes through begin("channels:manage") and the shared alert_confirm budget (src/lib/budgets.ts:36-40), so those need nothing new.

Types and UI

File; Change
src/lib/model.ts:217; add "teams" to ChannelKind
src/lib/alerts/server.ts:33, 81; add "teams" to the ChannelView kind union and its z.enum
src/components/alerts/ChannelIcon.tsx:4, 6; add an icon and kindName.teams = "Microsoft Teams". These are Record<ChannelKind, …>, so typecheck fails until both are added
src/app/(app)/app/alerts/ChannelSettings.tsx:18, 47, 54-59; widen the kind state, add a "Microsoft Teams" button, and set the modal title, URL label and hint
src/app/(app)/app/alerts/AlertsScreen.tsx:98, 361; channel description line and the "Teams message" provider-id label

Product copy and legal text

These are text-only, but the code expects them to stay in step with what is live (src/lib/launch.ts:83-86):
src/app/(public)/page.tsx:95 and src/components/PlanTable.tsx:51: the channel lists.
src/app/(public)/legal/privacy/page.tsx:168, 270: say that Teams receives the alert messages, and that its webhook URL is encrypted and deleted with the channel.
scripts/clerk/billing.json:115: the plan feature name.
docs/deploying.md:26 and the comments in examples/sender/wrangler.toml:2, 38.

Tests

Extend the existing Discord cases:
tests/unit/channels.test.ts: URL validation, plus sendTeams status mapping for 200/202, 429, 4xx, 5xx and network errors. It already imports discordUrl and sendDiscord (lines 5-6, 15, 50).
tests/unit/channel-actions.test.ts: create a Teams channel.
tests/e2e/channels.auth.spec.ts: the UI flow.
tests/integration/channels.test.ts: covered in step 1.

Run npm run typecheck and npm run test:unit. Integration tests need a disposable database (docs/deploying.md:80).

Deploying it

Order matters, because each part is deployed separately (docs/deploying.md:70):
Apply the migration with supabase db push.
Redeploy the sender Worker from sender/worker.ts, so it can deliver teams.
Deploy the app last, so members can't create a channel the sender doesn't recognise yet.

Probes, ingest, the edge and the watchdog are unaffected.

From outside the repo: Microsoft has been retiring Office 365 "Incoming Webhook" connectors in favour of Workflows (Power Automate) webhook URLs. Those use different hosts and payloads; Workflows expects an Adaptive Card. Check Microsoft's current documentation before you fix the host allowlist in teamsUrl and the request body in sendTeams.

## Answer 5C

Model Teams on the Discord channel. Discord is the closest existing pattern: you paste an incoming-webhook URL, it's stored encrypted, and the sender Worker posts to it. Slack needs an OAuth app, and the generic webhook adds HMAC signing and a retry budget, so neither fits as well. I found the full list by searching for every place discord appears; the line numbers are where Discord is wired in today.

Database: a new migration (don't edit applied ones)

Add supabase/migrations/<timestamp>_teams_channel.sql. docs/deploying.md step 2 says applied migrations must not be edited.

Allow the new kind. Drop and re-add alert_channels_kind_check with 'teams' in the list. The current definition is at supabase/migrations/20261023120000_alert_channels.sql:4-5.
The alert_channels_built constraint (:6-8) needs no change: any kind other than email or Telegram must already have a sealed credential, a label and a confirmation time.
Redefine public.alert_expand so c.kind in (...) includes 'teams' (:185). Without this, no deliveries are ever created for Teams channels.
Check the claim functions. alert_claim_channels and its alert_sender. wrapper (:273-360) don't filter by kind; only the legacy alert_claim (:219) does, and that one stays email/Telegram. No change there.
Then run supabase db push, and update src/lib/database.types.ts if you regenerate types.

Shared types

src/lib/model.ts:217: add "teams" to ChannelKind.
src/lib/alerts/server.ts:33,81: add "teams" to the kind union and to the zod enum used when reading channels and deliveries for the dashboard.

Validating the URL

src/lib/alerts/channel-input.ts
Add teamsUrl(value) next to discordUrl() (:15-21). Start from webhookUrl(), which already enforces HTTPS on port 443, no credentials or fragment, and no private IPs. Then pin it to the Teams webhook hostnames and path shape you intend to support: a Power Automate workflow URL or a legacy *.webhook.office.com URL. Validation errors must never echo the URL back (:4).
Extend the channelInput kind enum to ["discord", "webhook", "teams"] (:24). Add the matching superRefine branch and an error message (:29-31).

Sending the message

src/lib/alerts/providers.ts: add sendTeams(url, message, doFetch) following sendDiscord() (:58-77).
Re-validate the URL with teamsUrl.
Build a Teams payload from the shared Message, as discordText() does (:29), and truncate it to the Teams size limit.
Map responses to SendResult:
  429 → retry, using any wait time Teams sends back;
  other 4xx → rejected, with an "add the channel again" detail;
  anything else that's unclear → uncertain("Teams");
  a request that never left → retry, using the existing neverLeft() check.

src/lib/alerts/sender.ts
:12: import sendTeams.
:363: add "teams" to ["slack", "discord", "webhook"] so the sealed credential gets opened.
After :377: add if (d.channel.kind === "teams") return settle(d, await sendTeams(credential.url ?? "", message, deps.channels.fetch));.
:272 and :339: treat teams like Slack and Discord when a send wasn't confirmed. Teams can't be asked afterwards whether a message arrived, so it should be marked failed or unknown rather than sent again.

sender/worker.ts needs no change. The Worker already passes channels (fetch plus CREDENTIALS_KEY) to runSender.

Dashboard: adding the channel

src/app/(app)/app/alerts/actions.ts
:7: import teamsUrl.
:289: store { url: teamsUrl(v.url)!.href } for teams. It's encrypted with channelContext(workspaceId, id) in addWebhookChannel() (:276-296), which already requires channels:manage and charges the alert_confirm budget.
:223: add "teams" to the kinds whose test message is "queued", not sent immediately.

src/app/(app)/app/alerts/ChannelSettings.tsx
:18: widen the state type to include "teams".
:47: add a "Microsoft Teams" button.
:54-59: add the modal title, field label and a hint on how to get the Teams webhook URL. Teams doesn't use the signing secret field.

src/app/(app)/app/alerts/AlertsScreen.tsx
:98: add a channel description.
:361: add a "Teams message" provider label.
:33: update the comment.

src/components/alerts/ChannelIcon.tsx:4,6: add an icon and kindName.teams = "Microsoft Teams". These are typed Record<ChannelKind, …>, so TypeScript will flag them once model.ts changes.

Copy, legal and docs

src/components/PlanTable.tsx:51: the plan-table row text.
src/app/(public)/page.tsx:95: the landing-page list.
src/app/(public)/legal/privacy/page.tsx:168,270: add Microsoft as a recipient of alert content.
src/lib/launch.ts:83 and src/lib/budgets.ts:38: comments mentioning the channel list, plus any launch flag if you want to gate the rollout.
examples/sender/wrangler.toml:2,38 and docs/deploying.md: mention Teams. No new secret is needed, because CREDENTIALS_KEY already opens these credentials.

Tests

Follow the existing Discord cases:
tests/unit/channels.test.ts: URL validation and sender dispatch. The receipt() helper at :18-21 builds a sealed credential for each kind.
tests/unit/channel-actions.test.ts: the add-channel action.
tests/integration/channels.test.ts: the kind constraint and alert_expand creating Teams deliveries. This needs a disposable database.
tests/e2e/channels.auth.spec.ts: the connect flow in the UI.

Rollout order

Apply the migration.
Deploy the sender Worker with the new dispatch branch.
Deploy the app with the UI.

That order matches the note at the top of migration 20261023120000_alert_channels.sql that older dashboards and senders keep working. It also means no Teams channel can be created before a sender exists that can deliver it. If the app ships first, Teams deliveries are claimed, but the current sender gets to the generic-webhook path and fails them with "The webhook needs to be added again", because a Teams credential has no secret.

## Answer 5D

To add Microsoft Teams, copy the Discord channel. Discord is the closest existing channel: the member pastes an incoming-webhook URL, it is encrypted ("sealed") into alert_channels.sealed, and the sender Worker posts to it with no OAuth step. The changes cover one SQL migration, about five files in src/lib, three dashboard files, tests and copy. Paths are relative to the clone at <clone>, and nothing in the repo was changed.

Database: a new migration

Add supabase/migrations/<timestamp>_teams_channel.sql. The project rule is never to edit applied migrations, only to add new ones (docs/deploying.md:61). In it:

Allow the new kind. Drop and re-add alert_channels_kind_check with 'teams' added, the way migration 028 did (supabase/migrations/20261023120000_alert_channels.sql:4-5).
Store the credential like other channels. No change is needed: alert_channels_built already requires sealed, confirmed_at and label for every kind other than email and Telegram (alert_channels.sql:6-8).
Re-create public.alert_expand in full, with 'teams' added to its hard-coded kind list. Without this, no Teams receipt is ever created. The current definition only creates receipts for ('email','telegram','slack','discord','webhook') (alert_channels.sql:132-201, list at line 185).
Nothing else. alert_claim_channels doesn't filter by kind and already returns sealed (alert_channels.sql:286-314). The legacy alert_claim is email/Telegram only and stays that way (alert_channels.sql:219). The alert_sender wrappers and grants are unchanged.

Core library

File; Change
src/lib/alerts/channel-input.ts; Add teamsUrl() next to discordUrl(). It builds on webhookUrl() (HTTPS, port 443, no login, no private hosts) and allowlists the Microsoft hosts and path shape, as discordUrl does for discord.com (:15-21). Add "teams" to channelInput.kind and its error message (:23-34).
src/lib/alerts/providers.ts; Add sendTeams(url, message, doFetch) modeled on sendDiscord (:58-78). Re-validate the URL; use redirect: "manual" and a 10 s timeout; build the body from masked text with a length cap that keeps the link footer, as discordText does (:26-35). Map responses to SendResult: 429 → retry, 4xx → rejected, anything uncertain → unknown, and neverLeft → retry.
src/lib/alerts/sender.ts; Add "teams" to the channel list in deliver (:363). Dispatch it like Discord (:377): settle(d, await sendTeams(credential.url ?? "", message, deps.channels.fetch)). Treat it like Slack/Discord in two places: when the provider never answered (:272, fail rather than send blind) and when a claim's lease expired (:339).
src/lib/alerts/server.ts; Add "teams" to the ChannelView.kind union (:33) and the zod enum (:81). Otherwise the dashboard snapshot fails to parse a Teams row.
src/lib/model.ts; Add "teams" to ChannelKind (:217).

Two things are specific to Teams:
A sent receipt needs a provider id. The database requires provider_id to be non-null when a receipt is sent (supabase/migrations/20261022195510_alerts_email.sql:152). Discord returns a message id (providers.ts:72). If the Teams endpoint returns only 202 with no body, sendTeams must supply a stable id, such as a request-id header or the delivery id.
Recoveries can't be threaded. Slack posts a recovery as a reply in the opening message's thread (sender.ts:374-375). Teams webhooks can't, so recoveries go out as separate messages, as Discord's do.

No change is needed in sender/worker.ts. It already passes a fetch and CREDENTIALS_KEY to the channels (sender/worker.ts:31), and the encrypted credential is opened generically (sender.ts:364-369).

Dashboard

File; Change
src/app/(app)/app/alerts/actions.ts; In addWebhookChannel (:276-295), normalize the URL with teamsUrl(v.url)!.href (:289). Seal it with channelContext exactly as before. Add "teams" to the kinds whose test alert is queued rather than sent at once (:223).
src/app/(app)/app/alerts/ChannelSettings.tsx; Add "teams" to the kind state (:18), a "Microsoft Teams" button (:47), and the dialog title, field label and hint (:54-59).
src/app/(app)/app/alerts/AlertsScreen.tsx; Add a channel description (:98) and a receipt label such as "Teams message" (:361).
src/components/alerts/ChannelIcon.tsx; Add teams to icons and kindName (:4,6). This is a typed Record<ChannelKind, …>, so it won't compile after the model.ts change until you do.

Tests

tests/unit/channels.test.ts: URL validation, as in "allows only the provider's exact webhook path and host" (:47-52); the send body, masking and length cap (pattern at :77-101); and 429/uncertain mapping (:103).
tests/unit/channel-actions.test.ts: the add-channel action for Teams.
tests/integration/channels.test.ts: the database refuses unknown kinds, and alert_expand creates Teams receipts.
tests/e2e/channels.auth.spec.ts: the dialog flow.

Copy and docs that list the channels

src/app/(public)/page.tsx:95 and src/components/PlanTable.tsx:51
src/app/(public)/legal/privacy/page.tsx:168: Microsoft becomes a recipient of alert content.
scripts/clerk/billing.json:115
docs/deploying.md:26 and examples/sender/wrangler.toml:2,38
Optionally src/lib/launch.ts:83-86, if you want Teams hidden until it's switched on.

Deploy order

Each part is updated separately (docs/deploying.md:70):
Apply the migration with supabase db push.
Redeploy the sender Worker. The Worker imports src/lib/alerts/sender.ts and providers.ts, so it needs the new code.
Deploy the app.

Doing it in this order means a Teams channel can't be saved before its receipts can be created and sent.

Check outside the repo: which Teams URL format to accept. Microsoft has been replacing Office 365 connector webhooks with Power Automate "Workflows" webhooks, which use different hosts and expect an Adaptive Card body. Confirm the current hosts, path pattern, payload and response before writing teamsUrl() and sendTeams(). If the hosts can't be pinned to a fixed allowlist the way Discord's can, use the signed-webhook path instead. It checks that the hostname resolves only to public addresses (actions.ts:284-287), and sends through pinnedWebhookTransport (src/lib/alerts/webhook.ts), which connects only to the checked address, verifies TLS and never follows redirects (tests/unit/channels.test.ts:164-169).

## Answer 5E

Microsoft Teams would follow the Discord channel's pattern: a pasted webhook URL, stored encrypted, and posted by the sender Worker. Slack needs OAuth and the signed webhook needs a signing secret and its own retry schedule, so neither is the closest model. I only read the code, so the Teams-specific points below that come from my own knowledge are marked as such.

Files to change or add

#; File; Change
1; new supabase/migrations/<timestamp>_alert_channel_teams.sql; Add 'teams' to the kind constraint and to the expansion function's kind list.
2; src/lib/alerts/channel-input.ts; Add a teamsUrl() validator and add "teams" to channelInput.
3; src/lib/alerts/providers.ts; Add sendTeams().
4; src/lib/alerts/sender.ts; Dispatch to sendTeams and widen the kind checks.
5; src/lib/model.ts; Add "teams" to ChannelKind.
6; src/lib/alerts/server.ts; Add "teams" to ChannelView.kind and to the zod enum.
7; src/app/(app)/app/alerts/actions.ts; Build the Teams credential, widen the test-send check.
8; src/app/(app)/app/alerts/ChannelSettings.tsx; Add a Teams button and modal text.
9; src/components/alerts/ChannelIcon.tsx; Add the Teams icon and name.
10; src/app/(app)/app/alerts/AlertsScreen.tsx; Add a channel description and a delivery label.
11; Copy and docs; PlanTable.tsx, src/app/(public)/page.tsx, the privacy page, docs/deploying.md, and the stale comment in src/lib/launch.ts.
12; Tests; tests/unit/channels.test.ts, channel-actions.test.ts, tests/integration/channels.test.ts.

Steps

Migration.
   Take the Discord line at supabase/migrations/20261023120000_alert_channels.sql:4-5, which drops and re-adds alert_channels_kind_check. In a new migration, re-add it with 'teams' included.
   Do not edit the applied migration. docs/deploying.md step 2 says never to edit applied migrations.
   The expansion function that creates delivery rows filters c.kind in ('email','telegram','slack','discord','webhook') (20261023120000_alert_channels.sql:185). Re-create that function with 'teams' added, or Teams channels will get no deliveries. The claim functions don't list kinds, so they need no change.
   No new table is needed, because the credential goes in the existing sealed column. The check at line 8 already requires sealed, confirmed_at and label for every kind except email and Telegram.

Validator. In channel-input.ts, add teamsUrl(value) beside discordUrl (lines 15-21). Build it on webhookUrl(), which already requires HTTPS, port 443, no credentials or fragment, and a public host.
   Allowlist the hostnames that Teams webhooks actually use, as discordUrl does for discord.com, instead of accepting any public host.
   Which hosts are valid is Microsoft's side, not the repo's. Check their current webhook documentation. My understanding is that Teams Workflows URLs live on Microsoft-owned Azure and Power Platform domains, and that the older Office 365 connector webhooks are being retired.
   Add "teams" to the kind enum and to the superRefine branch (lines 24 and 30-31) with its own error message.

Sender function. In providers.ts, copy sendDiscord (lines 58-78). The conventions to keep are:
   Re-validate the stored URL at send time and return rejected with code 400 if it is invalid.
   Use redirect: "manual" and AbortSignal.timeout(10_000).
   Return retry on 429 with retryAfterSec.
   Return rejected on other 4xx responses.
   Return unknown on 5xx or any error where the request may have left, and retry only when neverLeft(e, "manual") proves it did not leave.
   Build the body from the same Message, masked through mask, as text() does.
   Message id: SendResult.sent requires a messageId string (src/lib/alerts/outcome.ts:11). Discord supplies one with ?wait=true. As far as I know, Teams webhooks answer 202 with no message id. That is from my knowledge, not the repo, so verify it. If it holds, you need a deliberate choice, such as using the delivery id as the provider id, or treating 202 as accepted. Don't copy Discord's check for an id in the response (providers.ts:72).

Dispatch in sender.ts. There are four places:
   Line 363: add "teams" to ["slack","discord","webhook"].
   After line 377: add if (d.channel.kind === "teams") return settle(d, await sendTeams(credential.url ?? "", message, deps.channels.fetch));.
   Line 272: the unknown case. Discord and Slack fail with "didn't confirm it. It may have arrived, so it wasn't sent again." Add Teams to that branch so an uncertain send is never blindly resent.
   Line 339: the stale-claim case. Add Teams here too, so a Teams claim older than its lease settles as unknown instead of resending.
   Update the import on line 12. The credential schema at lines 365-368 already accepts a url field.

Type unions.
   src/lib/model.ts:217.
   src/lib/alerts/server.ts:33.
   src/lib/alerts/server.ts:81. This zod enum parses the database overview, so a stored Teams channel would fail to load without it.
   src/lib/database.types.ts may need a matching change if it types kind narrowly. I did not check.

Server action. In actions.ts, addWebhookChannel handles Discord and the webhook kind.
   Line 289 builds the credential. Add a teams branch that stores { url: teamsUrl(v.url)!.href }.
   Teams needs no DNS check. The checkTarget call at lines 284-287 only runs for the generic webhook, and a host allowlist covers the Teams case as it does Discord.
   Line 223: add "teams" so a test alert is queued for the next sender run rather than sent inline.
   The existing alert_confirm budget (src/lib/budgets.ts:37-43) already covers channel creation.
   Import teamsUrl.

UI.
   ChannelSettings.tsx:18: widen useState<"discord" | "webhook" | null>.
   Add a button next to line 47.
   Update the modal title and the label and hint text at lines 54-59 (they are Discord ternaries today). Line 34 and line 38 already pass the kind through.
   ChannelIcon.tsx:4 and :6: add the icon and the kindName entry. kindName is typed Record<ChannelKind, string>, so TypeScript will flag it if you forget.
   AlertsScreen.tsx: add a description line beside line 98 (for example "Alerts post through this Teams channel's webhook.") and a label at line 361.

Copy and docs.
   src/components/PlanTable.tsx:51.
   The landing page at src/app/(public)/page.tsx:95.
   The privacy page at src/app/(public)/legal/privacy/page.tsx:168. It names Slack and Discord as data recipients, so Teams should be named too.
   docs/deploying.md mentions Discord once.
   examples/sender/wrangler.toml mentions Discord twice. I did not read those lines, so check whether they are comments or settings.

Tests.
   tests/unit/channels.test.ts has it.each(["slack","discord"]) for the never-resend-uncertain case (line 111). Add Teams there.
   tests/unit/channel-actions.test.ts and tests/integration/channels.test.ts (line 41, for (const kind of ["slack","discord","webhook"])) need cases for the new kind.
   tests/integration/alerts.test.ts:223 covers the kind constraint.

Deploying.
    Apply the new migration with supabase db push (docs/deploying.md step 2).
    Redeploy the sender Worker separately. The deploy doc says pushing app code does not update Workers (step 11).
    The sender imports from src/lib/alerts/*, so the Worker and the Next app both need the new code before a Teams channel is created.

Notes

Transport: Discord and Slack go through plain fetch (deps.channels.fetch). Only the generic webhook uses the pinned-DNS transport (pinnedWebhookTransport, sender/worker.ts:31). A host allowlist plus redirect: "manual" is the equivalent protection for a fixed provider.
Retries: the signed webhook has its own retry schedule (later() in sender.ts:239-246). You don't need it for Teams. Slack and Discord use the ordinary retryAfterSec path.
Grants: no new database roles or grants are needed.
