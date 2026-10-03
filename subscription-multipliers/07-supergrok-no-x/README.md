# 07 — SuperGrok ($30/month), no X account linked · Grok 4.7

## Question

[01](../01-supergrok/) measured SuperGrok at 186× on an account that also has X Premium+ ($40/month) linked, which grants SuperGrok-level Grok access. [06](../06-supergrok-lite/) measured SuperGrok Lite at 15.7×. Is SuperGrok on its own really ~12× better per dollar than Lite, or does the linked X Premium+ explain the gap?

## Method

- **Plan:** the SuperGrok Lite account from [06](../06-supergrok-lite/), upgraded to SuperGrok ($30/month) on Oct 3, 2026. No X account linked. xAI's `_x.ai/billing` reports `"subscription_tier": "SuperGrok"`. The upgrade reset the weekly meter to 0% (it had ended the Lite run at 100%) but kept the same week: Oct 2 19:37 → Oct 9 19:37 UTC. The upgrade was charged pro rata ($29.12 for the remaining SuperGrok time, −$9.71 for unused Lite time).
- **Client and workload:** identical to [06](../06-supergrok-lite/) — Grok Build CLI 1.0.46 over ACP, `grok-4.7-build`, SuperGrok's text-only workload with fresh random-word files and a fresh session per prompt — with **16 parallel workers** ([`bench/run.sh`](bench/run.sh); the worker, meter and export scripts are those in [06/bench](../06-supergrok-lite/bench/)). Oct 3, 2026, 19:38 → 20:26 Warsaw time, until the meter reached 100%; xAI then returned `402 Payment Required`.
- **Meter and spend:** as in 06 — `creditUsagePercent` every 30 s and after every prompt; every `inference_done` record from the followed CLI log, priced at **$2.00 / M input, $0.50 / M cached input, $6.00 / M output**.

## Results

`results/readings.csv` (241 readings), `results/calls.csv` (1,432 model calls; **$125.57** up to the first 100% reading, 86% of prompt tokens cached; 43 calls worth $13.22 finished after it and fall outside every step), `results/analysis.txt`.

As on Lite, a point passed every ~30 s, so steps are 20 points (4–11 minutes each):

| Step | Floor | Ceiling | Multiplier bracket |
|---|---|---|---|
| 20% → 40% | $1.26 / pt | $1.31 / pt | 18.3× – 19.0× |
| 40% → 60% | $1.24 / pt | $1.42 / pt | 18.0× – 20.6× |
| 60% → 80% | $0.97 / pt | $1.26 / pt | 14.1× – 18.3× |
| 80% → 100% | $1.13 / pt | $1.31 / pt | 16.3× – 19.1× |
| **Whole run 20% → 100%** | **$1.23 / pt** | **$1.25 / pt** | **17.8× – 18.1×** |

By the set's rule: **18.0× ± 0.3** (over 1% → 100% the whole-run bracket is 18.0×–18.2×).

## Findings

1. **One percent of a clean SuperGrok week bought ~$1.24 of Grok 4.7 at API prices; a week ≈ $124, a month ≈ $540 for $30.** That is **18.0× ± 0.3**.
2. **On its own, SuperGrok is worth about what Lite is per dollar.** Its weekly allowance is ~3.5× Lite's ($124 vs $36) for 3× the price.
3. **The account in [01](../01-supergrok/) got ~10× this allowance** (~$12.9 per point vs ~$1.24) on the same workload, model and CLI. That account has X Premium+ linked. Priced at what it pays for both subscriptions, $70/month, it is **80×**; against the SuperGrok price alone, 186×.

## Caveats

- **The week began with a mid-week upgrade.** xAI pro-rated the price by time (97.1% of the month remained). If it pro-rated this week's allowance the same way (~87% of the week remained), a full clean week would be worth ~20.7×. Either way it is far from 186×.
- The linked X Premium+ is the visible difference between the two accounts, but nothing here proves it is the cause; the two accounts also differ in age and history.
- One run, one workload.
