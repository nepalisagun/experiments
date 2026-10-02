# 03 — ChatGPT $100 plan (Codex) · GPT-6.1 Sol

## Question

How much GPT-6.1 Sol API usage does the $100 ChatGPT plan's Codex allowance buy, priced at OpenAI's public API rates?

## Method

- **Plan:** ChatGPT $100/month plan (Codex reports `plan_type: prolite`). Codex reports a single 7-day window on this plan (no 5-hour window) and no extra credits.
- **Client:** Codex CLI 0.159.0, [`bench/sub_test.py`](bench/sub_test.py) with `codex`:
  ```
  codex exec --json --skip-git-repo-check -s read-only -m gpt-6.1-sol -c model_reasoning_effort=high <task>
  ```
  6 workers in parallel, each in its own throwaway copy of a mid-size TypeScript codebase, alternating the same two read-only tasks as experiment 02.
- **Meter:** every `token_count` event in Codex's session logs (`~/.codex/sessions/`) carries `rate_limits.primary.used_percent` with a timestamp.
- **Spend:** the same events carry cumulative `total_token_usage` per session; per-call usage is the difference between consecutive events. Priced at OpenAI's **Standard** list price for GPT-6.1 Sol: **$2.00 / M input, $0.10 / M cached input, $10.00 / M output** (reasoning tokens are output). No request reached the long-context tier: Codex caps this model's context at 258,400 tokens.

## Results

`results/readings.csv` (324 readings), `results/calls.csv` (329 calls, $10.80 at list price), `results/analysis.txt`:

| Step | Floor | Ceiling | Multiplier bracket |
|---|---|---|---|
| 8% → 9% | $2.33 | $2.39 | 10.1× – 10.4× |
| 9% → 10% | $2.35 | $2.40 | 10.2× – 10.4× |
| 10% → 11% | $2.41 | $2.46 | 10.5× – 10.7× |
| 11% → 12% | $2.24 | $2.29 | 9.7× – 9.9× |
| **Whole run 8% → 12%** | **$2.35 / pt** | **$2.36 / pt** | **10.22× – 10.28× → 10.25× ± 0.3** |

Consistency check: the step brackets do **not** all intersect (highest floor 10.5×, lowest ceiling 9.9×), so individual points are worth slightly different amounts. The uncertainty above is on the run's average.

## Findings

1. **One percent of the week bought ~$2.35 of GPT-6.1 Sol at API prices; a full month ≈ $1,025 for $100.** That is 10.25× on average.
2. **Single points vary by about ±5%** (9.7–10.7×). A separate week of mixed use on the same account measured 10.7–10.8× over 19 full steps, consistent with that spread.

## Other ChatGPT plans (derived)

Only the $100 plan was measured. OpenAI describes the Codex allowance as proportional to price: Plus ($20) 1×, Pro $100 5×, Pro $200 10×. Taking that at face value, every tier has the same multiplier:

| Plan | Price | Allowance | Multiplier |
|---|---|---|---|
| $100 plan (measured) | $100 | 5× | 10.25× ± 0.3 |
| $200 plan (derived) | $200 | 10× | 10.25 × 10/5 × 100/200 = **10.25× ± 0.3** |
| Plus (derived) | $20 | 1× | 10.25 × 1/5 × 100/20 = **10.25× ± 0.3** |

These rows are only as good as the stated allowance ratios; they were not measured.

## Caveats

- OpenAI lists cache writes for this model at $2.50 / M; Codex's logs don't separate cache writes from ordinary input, so they are priced at $2.00. If anything this understates the multiplier slightly.
- OpenAI's Batch/Flex tier is half price ($1.00 / $0.05 / $5.00). Interactive Codex use corresponds to Standard, which is what is used.
- One run, one workload, 4 full steps.
