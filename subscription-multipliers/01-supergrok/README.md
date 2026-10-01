# 01 — SuperGrok ($30/month) · Grok 4.7

## Question

How much Grok API usage does the SuperGrok weekly allowance buy, priced at xAI's public API rates?

## Method

- **Plan:** SuperGrok, $30/month. The CLI's billing call reports one weekly period (`USAGE_PERIOD_TYPE_WEEKLY`) and `isUnifiedBillingUser: true` — the allowance is shared with grok.com. Other Grok use was paused for the run.
- **Client:** Grok Build CLI 1.0.44, driven over ACP (`grok agent --reasoning-effort xhigh -m grok-4.6 stdio`, via the public [`grok_acp.py`](../../five-models-three-harnesses/harness/grok_acp.py)). The session itself reported `grok-4.7` as the served model (the CLI's default; the `-m` flag is inert on this path). The CLI updated itself to 1.0.46 during the run.
- **Meter:** the ACP extension method `_x.ai/billing` returns `config.creditUsagePercent` without running a model turn. [`bench/grok_meter.py`](bench/grok_meter.py) calls it; [`bench/grok_poll.sh`](bench/grok_poll.sh) did so every ~30 s, and each worker also read it after every prompt.
- **Workload:** [`bench/grok_worker.py`](bench/grok_worker.py), 5 workers in parallel, each prompt a fresh session (so context is not reused between prompts) asking for detailed descriptions of 20 local images (~400 personal screenshots and photos; not published). Prompt, verbatim:

  ```
  Open and look at each of these image files one by one with your file-reading tool (view the actual image, do not guess from the filename). For each, write a detailed description: everything visible, all text in it transcribed verbatim, layout, colours. Read-only: do not modify or create any files.
  <20 image paths>
  ```
- **Spend:** every `shell.turn.inference_done` record in the CLI's log (`~/.grok/logs/unified.jsonl`): prompt, cached-prompt and completion tokens per model call (completion includes reasoning tokens). Priced at xAI's list price for Grok 4.7: **$2.00 / M input, $0.50 / M cached input, $6.00 / M output**, doubled for prompts ≥200K tokens (no call reached that).

## Results

`results/readings.csv` (301 meter readings), `results/calls.csv` (969 model calls, $32.59 at list price), `results/analysis.txt`:

| Step | Floor | Ceiling | Multiplier bracket |
|---|---|---|---|
| 25% → 26% | $11.68 | $12.35 | 169.3× – 179.0× |
| 26% → 27% | $11.09 | $12.16 | 160.7× – 176.3× |
| Whole run 25% → 27% | $11.60 / pt | $12.04 / pt | 168.2× – 174.5× |
| **Max floor … min ceiling** | | | **169.3× – 174.5× → 172× ± 3** |

## Findings

1. **One percent of SuperGrok's week bought ~$11.90 of Grok 4.7 at API prices; a full month of allowance ≈ $5,150 for $30.** That is 172× ± 3.
2. **Grok's meter was the most linear of the plans measured.** Both full steps and the whole run agree inside a 5-point band.

## Caveats

- **Only 2 full steps are reproducible from the published log.** The CLI rewrote its log when it self-updated mid-run, which deleted the calls behind the earlier part of the test. Two earlier measurements made from that log before it was lost were consistent — one step at 177–181×, and a 3-point stretch of text-only repository work at ≈169× — but they cannot be re-checked here, so they are not in the table.
- The allowance is shared with grok.com; any unlogged use during the run would make the plan look less generous, not more.
- The CLI also prints its own per-prompt cost (`costUsdTicks`). It comes to exactly one third of list price and is not what an API user pays, so it is not used.
- One run, image-description work at xhigh. Other workloads may meter differently.
