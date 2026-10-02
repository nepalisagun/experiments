# 01 — SuperGrok ($30/month) · Grok 4.7

## Question

How much Grok API usage does the SuperGrok weekly allowance buy, priced at xAI's public API rates?

## Method

- **Plan:** SuperGrok, $30/month. The CLI's billing call reports one weekly period (`USAGE_PERIOD_TYPE_WEEKLY`) and `isUnifiedBillingUser: true` — the allowance is shared with grok.com. Other Grok use was paused, except one interactive session on the same machine during the text run (26 calls, $0.37), which is in the log and priced in.
- **Client:** Grok Build CLI 1.0.44 → 1.0.46 (it updated itself), driven over ACP (`grok agent --reasoning-effort xhigh -m grok-4.6 stdio`, via the public [`grok_acp.py`](../../five-models-three-harnesses/harness/grok_acp.py)). The session reported `grok-4.7` as the served model (the CLI's default; the `-m` flag is inert on this path).
- **Meter:** the ACP extension method `_x.ai/billing` returns `config.creditUsagePercent` without running a model turn. [`bench/grok_meter.py`](bench/grok_meter.py) calls it; [`bench/grok_poll.sh`](bench/grok_poll.sh) did so every ~30 s, and every worker also read it after every prompt.
- **Two workloads, run on the same day, 5 parallel workers each, every prompt in a fresh session:**
  1. **Images** (meter 25% → 27%), [`bench/grok_worker.py`](bench/grok_worker.py): detailed descriptions of 20 local images per prompt (~400 personal screenshots and photos; not published). Prompt, verbatim:
     ```
     Open and look at each of these image files one by one with your file-reading tool (view the actual image, do not guess from the filename). For each, write a detailed description: everything visible, all text in it transcribed verbatim, layout, colours. Read-only: do not modify or create any files.
     <20 image paths>
     ```
  2. **Text only** (meter 27% → 29%), [`bench/grok_text_worker.py`](bench/grok_text_worker.py): every prompt gets **freshly generated random-word files** that no model has seen before, so nothing can be served from cache across prompts. Alternating an output-heavy task (rewrite an ~8,000-word file shifting every letter to the next one) and an input-heavy task (read five ~8,000-word files and report word frequencies). Prompts verbatim in the script.
- **Spend:** every `shell.turn.inference_done` record in the CLI's log (`~/.grok/logs/unified.jsonl`): prompt, cached-prompt and completion tokens per model call (completion includes reasoning). The CLI's log is size-capped and drops its oldest lines, so copies were taken during the runs; `calls.csv` is their union. Priced at xAI's list price for Grok 4.7: **$2.00 / M input, $0.50 / M cached input, $6.00 / M output**, doubled for prompts ≥200K tokens.

## Results

`results/readings.csv` (646 meter readings), `results/calls.csv` (1,694 model calls, $68.86 at list price), `results/analysis.txt`:

| Step | Workload | Floor | Ceiling | Multiplier bracket |
|---|---|---|---|---|
| 25% → 26% | images | $11.68 | $12.35 | 169.3× – 179.0× |
| 26% → 27% | images | $11.09 | $12.16 | 160.7× – 176.3× |
| 27% → 28% | mixed: end of the image run, idle afternoon, start of the text run | $12.75 | $14.51 | 184.8× – 210.3× |
| 28% → 29% | text only | $13.37 | $14.86 | 193.8× – 215.4× |
| Whole run 25% → 29% | both | $12.77 / pt | $12.92 / pt | 185.1× – 187.3× |

The step brackets do **not** intersect: image points and text points cost measurably different amounts.

**Reported: 186× ± 10.** The whole-run average is 186×; because the per-step brackets do not intersect (image points and text points cost different amounts), the uncertainty is widened by the set's single rule to cover max floor … min ceiling, 176×–194×. (An earlier version reported 190× ± 21 from a separate workload-range rule; every row now uses the same rule.)

## Findings

1. **One percent of SuperGrok's week bought $11–15 of Grok 4.7 at API prices; a full month of allowance ≈ $5,600 for $30.** That is 186× ± 10.
2. **Text work stretched the plan further than image work** (≈195–215× vs ≈161–179× per point). The text prompts were ~93% cached input; cached tokens are cheap on the API ($0.50 / M) but appear to cost the meter even less, so cache-heavy work gets more API-equivalent value per percent. The same direction showed up on Claude (see 02).

## Caveats

- **This account also has X Premium+ ($40/month), which includes SuperGrok.** xAI's billing call reports a single tier, `"subscription_tier": "SuperGrok"`, and an unchanged prepaid balance throughout, but it does not say whether the X Premium+ entitlement adds to the allowance. If the two stack, SuperGrok alone would be ~93×; if the allowance is X Premium+'s, the price basis would be $40 (140×); paid for both, $70 (80×). Under investigation with a SuperGrok-only account. For comparison, SuperGrok Lite on a clean account measured 15.7× ([06](../06-supergrok-lite/)).

- **The 27% → 28% step crosses an idle afternoon** in which one other session ran ($3.85, logged) and the CLI's log has a 38-minute hole (11:50–12:28 local) not covered by any copy. Any usage hidden there would raise that step further, not lower it.
- **A historical inconsistency remains unexplained.** The meter read 18% on Sep 30 23:16 UTC with only ~$13 of logged Grok usage since Sep 29; at these rates 18% is ~$230. The difference is either Grok usage off this machine (grok.com, X and other devices share the allowance) between Sep 27 and Sep 29, or a meter that is not proportional to API dollars at that point. It cannot be checked from here.
- The CLI also prints its own per-prompt cost (`costUsdTicks`). It comes to exactly one third of list price and is not what an API user pays, so it is not used.
- The letter-shift prompts did not produce full-length outputs (Grok shortened them), so the text workload ended up input- and cache-heavy rather than output-heavy.
