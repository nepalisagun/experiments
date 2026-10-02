# 05 — Claude Pro ($20/month) · Opus 5.5 · peak vs off-peak

## Question

How much Opus 5.5 API usage does Claude Pro buy, priced at Anthropic's public API rates — per week, and per 5-hour window at peak and off-peak hours?

## Method

- **Plan:** Claude Pro, $20/month, on a fresh account used for nothing else (weekly meter at 0% before the first run). Pro has two limits: a rolling 5-hour window and a weekly one. Both are read.
- **Client:** Claude Code 2.1.287 (auto-update off), `claude -p` with stream-json output, authenticated with a `claude setup-token` OAuth token for the Pro account. Model `claude-opus-5-5`, effort `high`.
- **Workload — identical in both runs.** One unattended session started with `/goal` (Claude Code keeps working until a separate check says the goal is met) in an empty git repo containing only [`SPEC.md`](bench/run-folder/SPEC.md) — a large LinkedIn-class web app with 12 feature areas, a fixed stack and a 90% coverage bar — and a [`CLAUDE.md`](bench/run-folder/CLAUDE.md) asking it to work unattended and parallelize with subagents. The goal cannot be met within one window, so the session runs until the plan refuses. Permissions: edits confined to the run folder, shell limited to `npm`, `npx`, `node`, `git`, `ls`, `mkdir`, `cat`, `sqlite3`. Driver: [`bench/driver.py`](bench/driver.py).
- **Two runs, Friday Oct 2, 2026 (Warsaw time, CEST):**
  - **Peak:** 14:59 → 15:29. Anthropic's peak hours are weekdays 05:00–11:00 PT = 14:00–20:00 Warsaw.
  - **Off-peak:** 20:15 → 20:44, in a fresh 5-hour window (the peak one reset at 19:50).
  Each run stopped when the stream reported `status: rejected` (5-hour window at 100%).
- **Meter:** every `rate_limit_event` in the stream: `unifiedWindows.five_hour.utilization` and `unifiedWindows.seven_day.utilization`, whole percent.
- **Spend:** every assistant message of the run, main thread and subagents, from Claude Code's session logs (`~/.claude/projects/…`), last record per message id. Priced at Anthropic's list price ($ per million tokens):

  | Model | Input | 5m cache write | 1h cache write | Cache read | Output |
  |---|---|---|---|---|---|
  | Opus 5.5 | $4 | $5 | $8 | $0.20 | $20 |

  Export: [`bench/export_run.py`](bench/export_run.py).

## Results

`results/<run>/weekly/` and `results/<run>/five_hour/` hold the same calls against each meter; `analysis.txt` in each.

| Run | Calls (subagent) | Logged API value | 5-hour meter | Weekly meter |
|---|---|---|---|---|
| Peak | 159 (78) | $11.44 | 0 → 100% in 30 min | 0 → 6% |
| Off-peak | 233 (151) | $15.83 | 0 → 100% in 29 min | 6 → 15% |

### Weekly meter → the multiplier

| Run | Full steps | Whole span | Steps | Max floor / min ceiling | Reported |
|---|---|---|---|---|---|
| Peak | 5 | $1.99–2.01 / pt = 43.2×–43.7× | 37.1×–50.9× | do not intersect (39.4× … 46.5×) | 43.5× ± 4.0 |
| Off-peak | 8 | $1.85–1.93 / pt = 40.3×–41.9× | 31.9×–48.7× | do not intersect (37.5× … 44.3×) | 41.1× ± 3.6 |
| **Both runs** | 13 | pooled: $1.93 / pt | | 37.5× … 46.5× | **42.0× ± 4.5** |

The two runs are pooled point-weighted (5 and 8 points) rather than as one span, because the step that bridges them is not usable: responses still streaming when the peak run hit its limit were killed and never logged, so that step is missing roughly $1 of spend.

### 5-hour meter → the size of a window

| Run | Whole span 1% → 100% | One full window |
|---|---|---|
| Peak | $0.11–0.12 / pt | **≈ $11.4–11.9** |
| Off-peak | $0.16 / pt | **≈ $15.8–16.0** |

Per-point brackets are not usable on this meter: a point passed every few seconds, and calls reach the log only when they finish, so most one-point steps contain no completed call. Only the whole span is reported. Both values are slight underestimates (the killed in-flight responses, ~$1 per run).

## Findings

1. **One percent of Pro's week bought ~$1.93 of Opus 5.5 at API prices; a full month ≈ $840 for $20.** That is **42.0× ± 4.5** — about the same multiplier as Max 20x (45.3×, [02](../02-claude-max/)).
2. **Max 20x's week is about 10–11× Pro's, not 20×.** Max 20x: ~$21 per weekly point; Pro: ~$1.93. Anthropic's "20×" describes the 5-hour window.
3. **The off-peak 5-hour window held ~1.37× more usage than the peak one** (≈ $16 vs ≈ $11.6), while the weekly meter charged the same work at about the same rate. Reading: the 5-hour window is smaller at peak; the weekly allowance is not.
4. **One full window costs ~6% of the week at peak and ~9% off-peak** — roughly 11–17 full windows fit in a week.
5. **Per-point value varies with the kind of work** (steps 32×–51×). Stretches heavy in subagent 5-minute cache writes bought less per point; off-peak had more of them (29% of cost vs 21%), which is why its weekly multiplier sits slightly lower.

## Caveats

- Two runs of 30 minutes each, one workload. The workload is not deterministic: the off-peak session used subagents more.
- The account's first `rate_limit_event` reads the meter *before* the first call; the first partial percent is dropped as everywhere in this set.
- A first attempt earlier that afternoon ran on a different account by mistake; it was stopped after 33 calls and is not used.
