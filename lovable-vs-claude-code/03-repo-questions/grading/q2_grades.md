# Q2 grades: when a website monitor opens and resolves an incident

Commit `e73a0df`. Scores are correctness / completeness / usefulness.

| Answer | C | Cm | U |
|---|---|---|---|
| A | 7 | 7 | 7 |
| B | 9 | 9 | 9 |
| C | 8 | 7 | 7 |
| D | 8 | 7 | 8 |
| E | 7 | 8 | 8 |

## Reference answer (from the code)

**What counts as a failure**
- A failed HTTP check is one of these: a status mismatch (default `2xx`), a bot-protection page, a missing keyword, a failed assertion or a body that isn't JSON, a network error or timeout (default 15 s), too many or bad redirects, or a private address (`src/checks/http.ts:189-196,207-211,230-249`; `probe/runtime.ts:477`). A slow answer is a pass with `slow` set (`http.ts:251-253`).
- If the probe's canary reads the box as isolated, the failure is dropped before anything else happens (`probe/runtime.ts:499`, `probe/canary.ts:76-80`).

**When an incident opens**
- Every failed HTTP check needs confirmation (`probe/state.ts:70-75`). `confirm()` asks probes at *other locations*, in turn. Same-location probes are excluded, and the Builder plan asks the other continent first (`probe/schedule.ts:72-80`). Each request is HMAC-signed (`/confirm`), the whole round has 30 s in total (`runtime.ts:110,569-590`), and the first answer wins.
- The verdicts (`state.ts:114-131`):
  - both checks fail: `fail`. If the monitor isn't already `down` (a `null` state counts), it transitions to `down` and emits `open_incident`.
  - the second check passes: `blip`, and nothing changes.
  - no answer from a live peer: `unconfirmed`, and nothing changes.
- So the rule is 2 failed checks from 2 locations in one round. There is no N-in-a-row counter.
- The exception: when no other location is live, or every peer answers 409 (can't open the secret headers), the probe re-checks the site itself after `recheckAfterSec ?? 20` s. That is 2 failures from 1 location (`runtime.ts:572-576,587`; `docs/deploying.md:32`).
- The home probe steps the reducer under a row lock (`probe/store.ts:303-353`). `probe_commit_monitor` then closes any stale open incident and inserts `"<name> is down"` with evidence and the timeline entries "Check failed in X" / "Confirmed from Y" (`service_monitors.sql:170-183`; `store.ts:386-391`).
- A monitor that is already down records the failure but opens no new incident (`state.ts:126`).
- Other types differ: DNS needs 2 in a row, an invalid SSL certificate is down at once, and a heartbeat is down at once (`state.ts:65,70-75,95-107,118`).

**What resolves it**
- Two passes in a row while down (`RECOVERED_AFTER = 2`, `state.ts:64,136-141`). Passes need no confirmation. A confirmed failure resets `passStreak`; a blip or an unconfirmed failure neither breaks nor extends it (`state.ts:14-16,122,130`).
- The transition out of `down` sets `resolved_at` with "Two checks passed, incident closed" (`service_monitors.sql:164-168`). The `incidents_alert_events` trigger queues a `resolved` alert only if the monitor is now up (or degraded for a `down` incident) and an `opened` event exists (`alerts_email.sql:224-231`).
- Other closes for a website monitor:
  - An address change in `update_monitor` closes the incident with "Address changed, incident closed" and sends no recovery alert (`20261022081211_monitor_edit_closes_incident.sql:92-108`).
  - A new outage replaces a stale incident (`service_monitors.sql:177-180`).
- "Monitor edited and verified, incident closed" is `save_service_monitor`, for Stripe and Supabase only (`service_monitors.sql:24,62-67`).
- Any edit or pause/resume resets the streaks through a trigger (`probe_row_state.sql:19-40`). Pausing never closes an incident, and there is no manual close: the "Resolved" option on an incident is a note state.

## Per answer

**A (7/7/7).** The core is right:
- two failures from two locations in one round;
- blip and unconfirmed are noise;
- the self re-check exception;
- the DNS, SSL and heartbeat variants;
- two passes to recover, in the same transaction, with the alert trigger and the new-outage close.

It loses points on the edit path. It says an edited monitor closes its incident with "Monitor edited and verified", but that text only fires for Stripe and Supabase monitors, and A also credits it to the wrong migration. A developer would wrongly believe that any verified edit closes a website incident. It omits the canary veto, what counts as an HTTP failure, the same-location exclusion, the real address-change close and the alert's conditions. Its citations are approximate ("~L"), which makes it less actionable.

**B (9/9/9).** This is the most complete and accurate answer. It covers:
- the HTTP failure definition, the 15 s timeout, and slow counting as a pass;
- the canary veto and the urgent confirm queue;
- the full verdict table and the DB insert;
- the exceptions, including "peers live but silent stays unconfirmed";
- a brand-new monitor opening an incident on its first confirmed failure;
- the streak rules;
- the correct HTTP edit path ("Address changed, incident closed", no recovery alert);
- the new-outage close, and the fact that there is no manual close (the "Resolved" option is a note state);
- that pause doesn't close an incident, and the alert conditions.

Only small nits: one misplaced citation for network failures, and "opened alert was sent" where the code checks that the event exists. It leaves out the same-location exclusion and the counter reset on version changes.

**C (8/7/7).** It is accurate on the confirm mechanics (30 s, the 20 s self re-check, declines), the verdicts, the canary veto, the DB insert, the streak rules and the resolved trigger. It makes the same edit-close mistake as A in one line. It also says "no other probe is live" where the code means no other location, and two line numbers are off by one or two. It is thinner than the others: no HTTP failure definition, no address-change close, no pause, no alert conditions.

**D (8/7/8).** It is detailed and well cited:
- confirmers exclude the same location;
- Free vs Builder routing;
- the version match in `confirmHere`;
- "a silent peer is not a decline";
- the `deploying.md` warning;
- already-down behaviour;
- the type variants and recovery mechanics.

It is honest about what it didn't check. It makes the same edit-close mistake. Its list of HTTP failures omits network errors and timeouts, the commonest failure, and one redirect citation is off. It misses the canary veto, the resolved alert and the address-change close. The counter reset it flagged as unchecked does exist.

**E (7/8/8).** This is a strong and precise answer:
- the home probe applying the outcome under a row lock;
- the canary veto, with `canary.ts`;
- same-location exclusion and continent preference;
- a clear verdict table;
- the exact timeline strings;
- the exceptions, the type variants and the streak rules;
- the resolved trigger, and that pause doesn't resolve.

But it puts the edit-close claim in its headline summary. In the body it attributes the "Monitor edited and verified" close to `update_monitor`, citing lines that belong to `save_service_monitor`, and it names the wrong migration as the origin. That is a wrong statement about which function does what on the website-monitor path. It misses the actual address-change close, the HTTP failure definition and the alert conditions.
