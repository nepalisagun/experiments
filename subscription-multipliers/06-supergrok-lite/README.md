# 06 — SuperGrok Lite ($10/month) · Grok 4.7

## Question

How much Grok API usage does the SuperGrok Lite weekly allowance buy, priced at xAI's public API rates — and how does it compare with SuperGrok ([01](../01-supergrok/))?

## Method

- **Plan:** SuperGrok Lite, $10/month, on a fresh account used for nothing else. xAI's `_x.ai/billing` call reports `"subscription_tier": "SuperGrok Lite"`, a weekly period that started minutes before the run, prepaid balance 0 and on-demand use 0.
- **Client:** Grok Build CLI 1.0.46 (the version used for SuperGrok), driven over ACP with the public [`grok_acp.py`](../../five-models-three-harnesses/harness/grok_acp.py) (copy it next to the scripts). Served model: `grok-4.7-build`, as on SuperGrok.
- **Workload:** the SuperGrok **text-only** workload, unchanged except for the stop conditions: [`bench/grok_text_worker.py`](bench/grok_text_worker.py), every prompt in a fresh session with freshly generated random-word files, alternating the letter-shift and word-frequency prompts. **12 parallel workers** ([`bench/run.sh`](bench/run.sh)), Oct 2, 2026, 21:43 → 22:50 Warsaw time, until xAI refused with `402 Payment Required: Grok Build usage balance exhausted`.
- **Meter:** `creditUsagePercent` from `_x.ai/billing` every 30 s ([`bench/grok_meter.py`](bench/grok_meter.py)) and after every prompt.
- **Spend:** every `shell.turn.inference_done` record in the CLI's log. The log is size-capped, so it was followed with `tail -F` for the whole run and unioned with copies taken at the start and end ([`bench/export_lite.py`](bench/export_lite.py)). Priced at xAI's list price for Grok 4.7: **$2.00 / M input, $0.50 / M cached input, $6.00 / M output**, doubled for prompts ≥200K tokens.

## Results

`results/readings.csv` (180 readings), `results/calls.csv` (421 model calls, **$39.19** at list price, 82% of prompt tokens cached), `results/analysis.txt`.

**Steps are 20 points, not 1.** With 12 workers a point passed every ~30 s — the meter's polling interval — so a 1-point step measures the polling rather than the meter (1-point brackets range from 8× to 67×, listed in `analysis.txt` for reference). Twenty points took 6–17 minutes, comparable to the other plans' steps.

| Step | Floor | Ceiling | Multiplier bracket |
|---|---|---|---|
| 20% → 40% | $0.34 / pt | $0.38 / pt | 14.9× – 16.6× |
| 40% → 60% | $0.38 / pt | $0.39 / pt | 16.5× – 17.0× |
| 60% → 80% | $0.30 / pt | $0.39 / pt | 13.1× – 17.0× |
| 80% → 100% | $0.30 / pt | $0.40 / pt | 12.9× – 17.4× |
| **Whole run 20% → 100%** | **$0.35 / pt** | **$0.37 / pt** | **15.4× – 16.0×** |

Max floor 16.5× just above min ceiling 16.0×; by the set's rule the interval is 15.4×–16.5×: **15.7× ± 0.8**. (Over 1% → 100% the whole-run bracket is 15.4×–15.7×.)

## Findings

1. **One percent of Lite's week bought ~$0.36 of Grok 4.7 at API prices; a full week ≈ $36, a month ≈ $155 for $10.** That is **15.7× ± 0.8**.
2. **SuperGrok's allowance is ~36× Lite's for 3× the price.** On SuperGrok's text-only steps a point was worth $13.4–14.9; here $0.35–0.37. Per dollar, SuperGrok buys ~12× more.
3. The whole allowance went in **67 minutes** with 12 parallel sessions.

## Caveats

- **The SuperGrok account also has X Premium+ ($40/month), which grants SuperGrok-level Grok access, including Grok Build, when the X account is linked.** If xAI stacks the two entitlements, SuperGrok on its own would be worth half of what [01](../01-supergrok/) measured (~93×) — still ~6× Lite's value per dollar. This is being investigated with a SuperGrok-only account.
- One run, one workload (input- and cache-heavy text; the letter-shift prompts again came back shorter than asked).
- A first launch failed on an outdated CLI (1.0.5: `426 Upgrade Required`) before any usage was recorded; the CLI was updated and the run restarted.
