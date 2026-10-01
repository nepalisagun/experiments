# 04 — Muse Code High Usage ($15/month) · Spark 1.3 standard and contributor

## Question

How much Muse Spark API usage does the Muse Code High Usage weekly allowance buy, for each of the plan's two models, priced at Meta's public API rates?

## Method

- **Plan:** Muse Code High Usage, $15/month. Two windows: a rolling 5-hour window and a weekly one; the weekly one is measured.
- **Two models.** Muse Code offers `muse-spark-1.3-contributor` (the default; its catalog entry reads *"Your content, including inter-session messages, may be used for product improvement."*) and `muse-spark-1.3`. They were measured one after the other, never at the same time, because they share the meter.
- **Client:** Muse Code 1.4.1 (it updated itself to 1.4.2 during the run), driven over ACP through a small ACP↔MSP bridge on top of `muse serve`, one bridge process per turn ([`bench/muse_turn.py`](bench/muse_turn.py), waves of 8 parallel turns by [`bench/muse_wave.sh`](bench/muse_wave.sh)), approval mode *allow all*, working in a throwaway copy of a mid-size TypeScript codebase.
- **Meter:** MSP `usage/read` after each turn and the `usage/changed` notification: `weekly.usedPercent` and `window.usedPercent` (5-hour), stamped with the host's `observedAtMs`.
- **Spend:** every `model_completed` record in Muse's session logs (input incl. cached, cached, output incl. reasoning). Priced at Meta's first-party API list price for the model that served the call:

  | Model | Input | Cached input | Output |
  |---|---|---|---|
  | `muse-spark-1.3` | $1.25 | $0.15 | $4.25 |
  | `muse-spark-1.3-contributor` | $0.10 | $0.002 | $0.20 |

- **Workload.** Standard: 5 points of 8-parallel waves alternating the repository bug hunt and the 15,000-word documentation prompt (verbatim in `muse_turn.py`), 10:47–10:56 UTC. Contributor ran in three phases: one long bug-hunt session, then single turns describing 20 images each, then the same 8-parallel waves as standard.

## Results

### Standard — `results/standard/` (38 readings, 133 calls, $2.14)

| Step | Floor | Ceiling | Multiplier bracket |
|---|---|---|---|
| 14% → 15% | $0.00 | $0.32 | 0.0× – 9.3× |
| 15% → 16% | $0.11 | $0.49 | 3.2× – 14.2× |
| 16% → 17% | $0.23 | $0.67 | 6.7× – 19.4× |
| 17% → 18% | $0.23 | $0.50 | 6.5× – 14.5× |
| 18% → 19% | $0.31 | $0.33 | 8.9× – 9.7× |
| **Whole run 14% → 19%** | **$0.31 / pt** | **$0.33 / pt** | **8.9× – 9.6× → 9.3× ± 0.4** |
| Max floor … min ceiling (consistency check) | | | 8.9× – 9.3× (intersect) |

### Contributor — `results/contributor/` (175 readings, 1,178 calls; $1.57 at contributor price, $30.75 at standard price)

| Step | vs contributor API price | vs standard API price |
|---|---|---|
| 6% → 7% | 2.3× – 10.7× | 39× – 212× |
| 7% → 8% | 4.5× – 5.0× | 77× – 88× |
| 8% → 9% | 4.0× – 4.5× | 73× – 81× |
| 9% → 11% | 1.0× – 9.1× | 16× – 193× |
| 11% → 12% | 2.7× – 18.8× | 44× – 396× |
| 12% → 13% | 4.3× – 4.7× | 79× – 86× |
| **Whole run 6% → 13%** | **5.2× – 6.4× → 5.8× ± 0.6** | **102× – 126× → 114× ± 12** |

Consistency check: the contributor brackets do **not** all intersect. The three cleanly read steps (4.0–5.0× at contributor price) sit below the whole-run bracket, so points varied; the uncertainty above is on the run's average.

## Findings

1. **Standard: one percent of the week bought ~$0.32 of Spark 1.3 at API prices; a month ≈ $140 for $15.** That is 9.3× ± 0.4.
2. **Contributor comes with two discounts that pull in opposite directions.**
   - *Plan discount:* a percent of the week buys **~12× more tokens** on contributor than on standard (valued at the same standard price: $3.51–4.35 vs $0.31–0.33 per point).
   - *API discount:* Meta also sells contributor tokens **~20× cheaper** on its API (for this run's token mix: $30.75 at standard price vs $1.57 at contributor price).
   - Result: **114×** against what the same work costs on the private-data API; **5.8×** against contributor's own API price. If you are willing to share your data, paying per token for contributor is the better deal; if you are not, contributor is not an option on the API at standard price, and standard on the plan is 9.3×.
3. **The 5-hour window is the real limit on standard.** It rose 22 points while the weekly rose 6: a full 5-hour window was worth ~$10 of standard API usage. On contributor it was ~$5–6 at contributor price.

## Caveats

- **Contributor's range is wide because the run mixed three different workloads**, and at contributor prices cached tokens ($0.002) are 50× cheaper than uncached ($0.10), so the dollar value of a point swings with how much context is re-read. Standard was one homogeneous phase and came out tight. A repeat of contributor with standard's exact workload would make the two directly comparable.
- Muse turns finished fast (often 2–5 model calls for "read the whole repository"), so the workload is lighter than its prompt suggests. Every call that did happen is logged and priced.
- Contributor prices come from Meta's first-party endpoint as listed on OpenRouter; secondary reports quote the same figures from Meta's pricing page.
- Readings from 8 parallel sessions arrive out of order; stale (lower) readings are dropped.
