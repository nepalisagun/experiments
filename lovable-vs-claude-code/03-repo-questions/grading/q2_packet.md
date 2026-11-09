# Question 2

When exactly does a website monitor open an incident? How many failed checks, from how many locations, and what makes the incident resolve?

## Answer 2A

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

## Answer 2B

Short answer: an incident opens on the first failed check that a second location confirms: two failed checks from two different locations, in one round. It closes after two passing checks in a row, or when someone changes the monitor's address. Paths are relative to the clone at <clone>, and no files were changed.

What counts as a failed check

checkHttp marks a check as failed in any of these cases:
the status doesn't match the expected one (default 2xx);
the response looks like a bot-protection page;
the keyword is missing from the response;
a JSON assertion fails or the body can't be read as JSON;
the request fails at the network level (src/checks/http.ts:77-80,230-249).

The default timeout is 15 s (probe/runtime.ts:477). A slow response still counts as a pass with a slow flag, so it never opens an incident (http.ts:251-253).

When an incident opens

The first failure is never counted alone. HTTP failures always need confirmation (probe/state.ts:70-75). Only one location's network failures are dropped beforehand: if the probe's own canary says it is cut off, the failure is discarded before confirmation (probe/runtime.ts:496-499).
A second location re-checks immediately. The checking probe asks the other live locations one after another, with 30 s in total for any of them to answer (probe/runtime.ts:110,569-590). The re-check skips the queue of ordinary checks (runtime.ts:439-454).
The state machine judges the pair (probe/state.ts:114-131):
   first fails, second fails → fail. If the monitor isn't already down, it becomes down and an open_incident effect is emitted;
   first fails, second passes → blip. Nothing changes and no streak is affected;
   first fails, no other location answers → unconfirmed. Nothing changes;
   the monitor is already down → the failure is recorded, but no second incident opens.
The incident is written in the database. probe_commit_monitor inserts an incident titled "<name> is down", with evidence from both locations. Any stale open incident for that monitor is closed first (supabase/migrations/20261023100000_service_monitors.sql:170-183, state.ts:77-86).

So the threshold is 2 failed checks from 2 locations. There is no "N failures in a row" setting, because the confirmation is the threshold.

Three exceptions:
Only one probe live: when no other location is live, or every other location replies that it can't open this monitor's secret headers, the probe re-checks the site itself after 20 s. That makes it 2 failures from 1 location (runtime.ts:572-576,587, docs/deploying.md:32). If other locations are live but just don't answer, the failure stays unconfirmed.
A new monitor with no state yet can open an incident on its very first confirmed failure, because the check is "not down" (state.ts:126).
Other monitor types differ: DNS needs two failures in a row with no second location, an invalid SSL certificate is down at once, and a heartbeat is down at once (state.ts:7-11,118).

How it resolves

Normal recovery: while the monitor is down, each passing check (from any location) adds to a pass streak. On the second pass in a row (RECOVERED_AFTER = 2), it becomes up, or degraded if the last three passes were slow (state.ts:64,136-141). That down → … transition sets resolved_at and adds "Two checks passed, incident closed" to the timeline (service_monitors.sql:164-168).
  A confirmed failure resets the streak (state.ts:130). An unconfirmed failure or a blip leaves the streak alone, so it neither breaks nor extends a recovery (state.ts:14-16,122).
Address change: changing a website monitor's target clears its state and closes the open incident ("Address changed, incident closed"). The next confirmed failure opens a fresh incident (supabase/migrations/20261022081211_monitor_edit_closes_incident.sql:92-108).
Replaced by a new outage: an incident that was somehow still open is closed when a new one opens (service_monitors.sql:174-180).

There is no manual close. I found no code in src/ that sets resolved_at. The "Resolved" option on the incident page is a status-page note state (src/app/(app)/app/incidents/[id]/IncidentScreen.tsx:21-23, src/lib/page-input.ts:9), and it doesn't close the incident. Pausing a monitor keeps its state (state.ts:22), and no pause function closes incidents, so an incident stays open while its monitor is paused.

A recovery email ("resolved" alert) goes out only if the monitor recovered and an "opened" alert was sent for that incident. Closing an incident because the address changed sends none (supabase/migrations/20261022195510_alerts_email.sql:200-231).

## Answer 2C

An HTTP monitor opens an incident after two failed checks from two different locations: the scheduled check fails, and an immediate re-check from a second region fails too. It resolves after two passing checks in a row. All of these rules live in probe/state.ts.

When an incident opens

A scheduled check fails. For an HTTP or TCP monitor, one failure never counts by itself. needsConfirmation() returns true for every failed check type except DNS, heartbeats and an invalid SSL certificate (probe/state.ts:68-73).
A second location re-checks right away. confirm() in probe/runtime.ts:569-590 asks the peer probes one after another with a signed /confirm request. It has a total of 30 seconds (CONFIRM_WITHIN_MS = 30_000, probe/runtime.ts:110) and takes the first peer that answers.
   If no other probe is live, or every peer declines, the same probe re-checks after 20 seconds (recheckAfterSec ?? 20, runtime.ts:573).
   If live peers exist but none answers in time, the outcome has no confirming check.
The two results give a verdict (probe/state.ts:114-118):
   Both failed → fail. If the monitor isn't already down, it moves to down and an open_incident effect is emitted (state.ts:124-130).
   The second location passed → blip. Nothing changes: the pass and failure counters stay as they were (state.ts:122).
   No second result → unconfirmed. Also nothing changes, so an incident never opens on an unconfirmed failure.
One more filter applies first. A probe whose canaries show its own network is down discards its failed checks before they reach this logic (probe/runtime.ts:499).

So there is no "N failures in a window" rule. One confirmed round of two failures, normally from two locations, opens the incident immediately. Repeated blips never add up to an incident.

The database then writes the incident inside probe_commit_monitor. It inserts an incidents row titled "<name> is down" with severity down, and the evidence records both failing locations (supabase/migrations/20261023100000_service_monitors.sql:169-182, state.ts:77-86). If an older incident for the same monitor is somehow still open, it is closed first, so each outage gets its own row.

Other check types differ:
DNS has no second location; it needs two failing checks in a row instead (DNS_DOWN_AFTER = 2).
An invalid SSL certificate goes down at once. A handshake that couldn't connect still needs confirmation.
Heartbeats go down on the first missed deadline, /fail ping, false assertion or stuck run (state.ts:96-107).

What resolves it

Two passing checks in a row while the monitor is down (RECOVERED_AFTER = 2, state.ts:63,135-141). The monitor then moves to up, or to degraded if the last three passes were all slower than the slow threshold.
A blip or unconfirmed failure between those passes doesn't reset the streak. A confirmed failure does (state.ts:122,129).
When the monitor leaves down, the SQL sets resolved_at on the open incident and adds "Two checks passed, incident closed" to its timeline (service_monitors.sql:163-167). That update fires the trigger that queues the "resolved" alert (supabase/migrations/20261022195510_alerts_email.sql:224-231).
Heartbeats recover on the next good ping instead of two passes (state.ts:98-101).
Editing a monitor and verifying the new version also closes its incident ("Monitor edited and verified, incident closed", service_monitors.sql:66).

## Answer 2D

A website (HTTP) monitor opens an incident on one failed check that a second location also fails. It closes after two passing checks in a row.

What opens an incident

The rules are in probe/state.ts, in the header comment and in step().

Failed checks needed: two, but they are the same round, not two rounds in a row. A probe runs the check. If it fails, the probe re-checks at once from another location (probe/runtime.ts:552, needsConfirmation). If that second check also fails, the verdict is fail. step() then moves the monitor to down and emits open_incident (state.ts:116, state.ts:125-131).
Locations needed: two different ones.
  confirmersFor in probe/schedule.ts:72 excludes probes at the same location as the one that saw the failure.
  The incident's evidence lists both locations (evidenceOf, state.ts:84).
  The peer re-checks from its own memory of the monitor config, and only if it holds the same monitor version (confirmHere, runtime.ts:596).
  Per schedule.ts:66-71, the Free plan confirms from its other location. Builder prefers a probe on the other continent and falls back to the rest.
Time limit: the second look must answer within 30 seconds (CONFIRM_WITHIN_MS, runtime.ts:110). Peers are asked in turn until one answers (runtime.ts:579-586).
What counts as a failed HTTP check (src/checks/http.ts):
  a status that doesn't match the expected one (line 231);
  a missing keyword (line 232);
  a failed assertion or a non-JSON body (lines 246-249);
  a bot-protection page (line 230);
  more than 5 redirects, or a redirect to a non-HTTP address (lines 207-211);
  an address refused as private (line 191).

  A slow response is not a failure. It only feeds degraded.

Cases where no incident opens

The second location passes (a "blip"). Nothing moves, and the failure counts toward neither streak (state.ts:116, state.ts:122).
No other location answers within 30 seconds, but others are live. The result is "unconfirmed" and nothing moves. The code comment says an incident "opens only on a confirmed failure" (state.ts:111, runtime.ts:588).
Every other location answers "cannot". This happens when a peer can't decrypt the monitor's secret headers. The probe then re-checks from itself, which can confirm. A peer that simply doesn't answer is not treated as "cannot".
No other location is live. The same probe re-checks itself after a pause of 20 seconds by default (recheckAfterSec ?? 20, runtime.ts:573), and two failures from that one location are enough. docs/deploying.md ("The smallest installation") warns that a target only that machine can't reach will then read as down.
Already down. A further confirmed failure opens nothing new. open_incident is only emitted when s.state !== "down" (state.ts:126).

Variations by monitor type

DNS: no second location. It needs two failing checks in a row (DNS_DOWN_AFTER = 2, state.ts:65 and state.ts:118).
SSL: an invalid certificate is down at once. An unreachable one is still confirmed (state.ts:70-75).
Heartbeat: no confirmation. A missed deadline, a /fail, a false assertion or a stuck run is down at once (state.ts:95-106).

What resolves the incident

Two passes in a row (RECOVERED_AFTER = 2, state.ts:64). The first pass while down only raises passStreak (state.ts:136-138). The second pass moves the monitor to up, or to degraded if the slow streak is at 3 or more.
How the incident closes: the transition effect with from = 'down' sets resolved_at and adds the timeline entry "Two checks passed, incident closed" (supabase/migrations/20261023100000_service_monitors.sql:164-168). This happens in the same locked transaction as the state change.
Failures that don't reset recovery: a failure that isn't confirmed counts toward neither streak and breaks neither (state.ts:14-16). A lone location that can't reach the target therefore can't hold an incident open.
Heartbeats recover on the next good ping, not after two (state.ts:98-100).
Other closes:
  Editing a monitor closes its open incident with "Monitor edited and verified, incident closed" (service_monitors.sql:66).
  If a new outage opens while an older incident is still open, the old one is closed with "A new outage opened its own incident, this one closed" (service_monitors.sql:174-180).

What I didn't check

I did not check how often a down monitor is re-polled, so I can't say how long recovery takes in wall-clock time. I also did not check whether a version change mid-incident resets the counters. The state.ts header says it does, in SQL.

## Answer 2E

When a website (HTTP) monitor opens and closes an incident

In short: an HTTP monitor opens an incident after one round of checking in which two checks fail, the first and a second from a different location within 30 seconds. It doesn't count failures over time. The incident closes after two passing checks in a row. A monitor that is down and keeps failing doesn't open another incident. Editing the monitor also closes its open incident.

What opens an incident

The decision is made in the pure reducer step() (probe/state.ts:88-131). The probe that is the monitor's "home" applies it under a row lock (probe/store.ts:303-405).

First failed check. A probe runs the check (probe/runtime.ts:456-509). The failure counts only if the probe's network canary accepts it. If the probe looks cut off from the network, the result is dropped as if the check never happened (probe/runtime.ts:499, probe/canary.ts:76-80).

Second check, from somewhere else. For HTTP, every failure needs confirmation (needsConfirmation, probe/state.ts:70-75). The probe asks live probes at other locations to check again right away: same location is excluded (probe/schedule.ts:72-80). It asks them one at a time over signed /confirm requests and stops at the first answer, all within CONFIRM_WITHIN_MS = 30_000 (probe/runtime.ts:110, 569-590). Builder plans ask probes on the other continent first.

How that one round is judged (probe/state.ts:114-122):

First check; Second check; Verdict; Effect
pass; —; pass; —
fail; pass; blip; nothing changes, counters stay as they were
fail; none answered in 30 s; unconfirmed; nothing changes
fail; fail; fail; goes down, incident opens

   On a fail, if the monitor wasn't already down, the reducer emits transition → down and open_incident (probe/state.ts:125-131). The evidence names both locations. The timeline reads "Check failed in X" and then "Confirmed from Y, incident opened" (probe/store.ts:384-390).

   So it takes 2 failed checks from 2 different locations, and both come from the same scheduled check. Failures don't add up across rounds. An unconfirmed failure or a blip "counts toward neither streak and breaks neither" (probe/state.ts:14-16).

The row is written. probe_commit_monitor inserts the incidents row with the title "<name> is down" (supabase/migrations/20261023100000_service_monitors.sql:170-183). If an older incident is somehow still open, it is closed first, so each outage gets its own row.

Exceptions to the two-location rule:
Only one probe location is live. The probe checks again from itself after recheckAfterSec (default 20 s), and that counts as the confirmation. The same happens when every peer answers "cannot" because it can't decrypt the monitor's secret headers (probe/runtime.ts:572-576, 587). That gives 2 failures from 1 location (see also docs/deploying.md:32).
Peers are live but none answers within 30 s. The failure stays unconfirmed and opens nothing (probe/runtime.ts:588-589).
Other monitor types:
  SSL monitors go down after a single check when the certificate itself is invalid (failure.kind === "cert"). A handshake failure still needs confirmation.
  DNS needs 2 failing checks in a row instead of a second location, since every location asks the same public resolvers (probe/state.ts:7-11, 118).
  Heartbeats go down on a single verdict (probe/state.ts:95-107).

What resolves it

Two passes in a row. While a monitor is down, each pass increments passStreak. At RECOVERED_AFTER = 2 it moves to up, or to degraded if the last three passes were all slow (probe/state.ts:64, 136-141). The SQL then sets resolved_at on the open incident and adds the timeline entry "Two checks passed, incident closed" (supabase/migrations/20261023100000_service_monitors.sql:163-167). This resolution triggers the "resolved" alert event (supabase/migrations/20261022195510_alerts_email.sql:225-231).
  A confirmed failure resets passStreak to 0 (probe/state.ts:130).
  A blip or an unconfirmed failure does not reset it.
  Passes don't need confirmation: one passing first check is enough (probe/state.ts:115).
Editing the monitor. The current update_monitor clears the monitor's state and closes any open incident with "Monitor edited and verified, incident closed" (supabase/migrations/20261023100000_service_monitors.sql:62-66). This was introduced in 20261022081211_monitor_edit_closes_incident.sql.
A new outage. If open_incident runs while an incident is still open, the old one is closed with "A new outage opened its own incident, this one closed" (supabase/migrations/20261023100000_service_monitors.sql:174-180).

Pausing doesn't resolve anything. A paused monitor isn't scheduled, and its state is kept (probe/state.ts:22; probe/runtime.ts:251).
