# 02 — Claude Max 20x ($200/month) · Opus 5.5

## Question

How much Claude API usage does the Max 20x weekly allowance buy, priced at Anthropic's public API rates?

## Method

- **Plan:** Claude Max 20x, $200/month. Two windows: 5-hour and 7-day; the 7-day one is measured.
- **Client:** Claude Code `-p` (headless), [`bench/sub_test.py`](bench/sub_test.py) with `claude`:
  ```
  claude -p <task> --model claude-opus-5-5 --output-format stream-json --verbose --allowedTools Read,Glob,Grep --disallowedTools Edit,Write,Bash,NotebookEdit
  ```
  6 workers in parallel, each in its own throwaway copy of a mid-size TypeScript codebase, alternating two read-only tasks (verbatim in the script): a full-repository bug hunt and a 15,000-word documentation write-up. Claude Code delegated part of the reading to its Explore subagent, which ran on Sonnet 5.
- **Meter:** the `rate_limit_event` records Claude Code writes into its stream-json output (`unifiedWindows.seven_day.utilization`, 0.01 = 1%), dated by the neighbouring timestamped line.
- **Spend:** every assistant message in the run's streams **and in every other Claude Code session on the machine during the run** (two other interactive sessions, 37 calls), deduplicated by message id. Priced at Anthropic's list price, with 5-minute and 1-hour cache writes priced separately:

  | Model | Input | 5m cache write | 1h cache write | Cache read | Output |
  |---|---|---|---|---|---|
  | Opus 5.5 | $4 | $5 | $8 | $0.20 | $20 |
  | Sonnet 5 / 5.5 | $2 | $2.50 | $4 | $0.20 | $10 |

## Results

`results/readings.csv` (111 readings), `results/calls.csv` (1,403 calls, $104.91 at list price), `results/analysis.txt`. The test took 3.5 minutes: 6 Opus sessions with subagents moved the weekly meter 5 points and the 5-hour window from 2% to 20%.

| Step | Floor | Ceiling | Multiplier bracket |
|---|---|---|---|
| 6% → 7% | $19.47 | $21.57 | 42.3× – 46.9× |
| 7% → 8% | $16.59 | $21.54 | 36.1× – 46.8× |
| 8% → 9% | $20.58 | $25.75 | 44.7× – 56.0× |
| 9% → 10% | $19.38 | $21.96 | 42.1× – 47.7× |
| Whole run 6% → 10% | $20.41 / pt | $21.29 / pt | 44.4× – 46.3× |
| **Max floor … min ceiling** | | | **44.7× – 46.3× → 45.5× ± 0.8** |

Cost composition at list price: 5-minute cache writes 60%, cache reads 36%, 1-hour cache writes 4%, output 1%, uncached input <1%.

## Findings

1. **One percent of the Max 20x week bought ~$21 of Opus 5.5 at API prices; a full month ≈ $9,100 for $200.** That is 45.5× ± 0.8.
2. **The number depends on the kind of work.** The same account measured over a week of long interactive sessions, mostly Sonnet 5.5, came out at ~62× (28 full steps, 61.6–61.8× over the whole span). There, 78% of the API cost was cache reads and 18% 1-hour cache writes. That data comes from private sessions and is not published here. Read together, Anthropic's meter appears to charge cache reads at less than their API weight: long sessions that mostly re-read cached context get more out of the plan than many short parallel sessions that keep writing new cache.

## Caveats

- 4 full steps over 3.5 minutes; the steps agree, but this is one run of one workload.
- Usage from claude.ai, the desktop app or other devices shares the meter and is not visible here. It was paused; if any slipped in, the true multiplier is higher.
- `claude -p` uses 5-minute cache writes, interactive sessions mostly 1-hour ones. That alone shifts the API-dollar weight of the same work.
- The 5-hour window rose 18 points while the weekly rose 5. Burning a full week at this pace would hit the 5-hour limit repeatedly; the weekly figure assumes you spread usage out.
