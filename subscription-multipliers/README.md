# subscription-multipliers

How much API usage does an AI coding subscription actually buy? For each plan we burned a slice of the weekly allowance on purpose, logged every model call, and priced those calls at the vendor's **public API list price**. The multiplier is what a full month of the allowance would cost on the API, divided by the subscription price.

![Subscription multipliers: Muse contributor 114x vs standard API price, SuperGrok + X Premium+ 80x, Claude Max 20x 45.3x, Claude Pro 42.0x, SuperGrok 18.0x, SuperGrok Lite 15.7x, ChatGPT $100 plan 10.25x, Muse standard 9.3x, Muse contributor 5.8x vs its own API price](subscription-multipliers.png)

| Subscription · model | Price / month | Multiplier | Uncertainty |
|---|---|---|---|
| [Muse Code Power Usage · Spark 1.3 contributor · Muse Code CLI — vs standard API price, *derived, not measured*](04-muse-code/#other-muse-code-plans-derived) | $50 | *137×* | ± 39 |
| [Muse Code High Usage · Spark 1.3 contributor · Muse Code CLI — vs standard API price](04-muse-code/) | $15 | **114×** | ± 33 |
| [SuperGrok + X Premium+ · Grok 4.7 · Grok Build CLI — X account linked; 186× vs the SuperGrok price alone](01-supergrok/) | $70 | **80×** | ± 4 |
| [Claude Max 20x · Opus 5.5 · Claude Code](02-claude-max/) | $200 | **45.3×** | ± 1.0 |
| [Claude Pro · Opus 5.5 · Claude Code — two runs, peak and off-peak hours](05-claude-pro/) | $20 | **42.0×** | ± 4.5 |
| [SuperGrok · Grok 4.7 · Grok Build CLI — no X account linked](07-supergrok-no-x/) | $30 | **18.0×** | ± 0.3 |
| [SuperGrok Lite · Grok 4.7 · Grok Build CLI](06-supergrok-lite/) | $10 | **15.7×** | ± 0.8 |
| [Muse Code Power Usage · Spark 1.3 standard · Muse Code CLI — *derived, not measured*](04-muse-code/#other-muse-code-plans-derived) | $50 | *11.1×* | ± 0.5 |
| [ChatGPT $100 plan · GPT-6.1 Sol · Codex CLI](03-codex/) | $100 | **10.25×** | ± 0.3 |
| [ChatGPT $200 plan · GPT-6.1 Sol · Codex CLI — *derived, not measured*](03-codex/#other-chatgpt-plans-derived) | $200 | *10.25×* | ± 0.3 |
| [Muse Code High Usage · Spark 1.3 standard · Muse Code CLI](04-muse-code/) | $15 | **9.3×** | ± 0.4 |
| [Muse Code High Usage · Spark 1.3 contributor · Muse Code CLI — vs its own API price](04-muse-code/) | $15 | **5.8×** | ± 1.3 |

Measured Oct 1–3, 2026, each plan on its own, with other usage of that plan paused (Claude Pro, SuperGrok Lite and the no-X SuperGrok on fresh accounts used for nothing else).

**Uncertainty** follows one rule for every row (method step 5): the bracket on the run's average, widened wherever individual percent points certainly differed from each other. Each folder lists every step.

**SuperGrok's value depends on the account, not just the plan.** On a fresh account with no X account linked, SuperGrok is worth 18.0× — about what Lite is per dollar (15.7×; ~3.5× Lite's weekly allowance for 3× the price). On an account with X Premium+ ($40/month, which grants SuperGrok-level Grok access) linked, the same plan, workload, model and CLI got ~10× that allowance: 80× against the $70 the account pays for both, 186× against the SuperGrok price alone ([07](07-supergrok-no-x/), [01](01-supergrok/)). On Claude, Max 20x's weekly allowance is ~10–11× Pro's for 10× the price (the "20×" describes the 5-hour window).

**Peak hours shrink Claude's 5-hour window, not its week.** On Pro, the same work filled a 5-hour window at ≈ $11.6 of API value at peak (weekdays 14:00–20:00 CEST) and ≈ $16 off-peak, while the weekly meter charged it at about the same rate ([05](05-claude-pro/)).

**Other Claude plans are not derived.** Anthropic defines Max 5x and Max 20x as 5× and 20× Pro's *per-session* (5-hour) allowance and publishes no weekly ratio. OpenAI says its Codex allowance scales with price (Plus 1×, Pro $100 5×, Pro $200 10×), so every ChatGPT tier comes out at the measured 10.25×. **Muse Code Power Usage is derived the same way:** Muse describes Everyday Usage ($5) as the base allowance, High Usage ($15) as 5× and Power Usage ($50) as 20×, so Power gets 4× High Usage's allowance for 3.33× the price: High Usage × 1.2 (11.1× standard, 137× contributor vs standard API price, 7.0× contributor vs its own API price).

**Contributor has two discounts that pull in opposite directions.** A Muse Code percent buys ~12× more contributor tokens than standard tokens, and Meta's API also sells contributor tokens ~20× cheaper ($0.10 / $0.002 / $0.20 per million vs $1.25 / $0.15 / $4.25). Against the private-data API price the plan is worth 114×; against contributor's own API price, 5.8×. Details in [04-muse-code](04-muse-code/).

## Experiments

| # | Plan | What was run | Headline |
|---|---|---|---|
| [01](01-supergrok/) | SuperGrok ($30) on an account with X Premium+ ($40) linked | Grok Build CLI, Grok 4.7 at xhigh, 5 parallel sessions: images, then never-seen random text; weekly meter read every ~30 s | **80× ± 4** at the $70 paid for both (**186× ± 10** vs the SuperGrok price alone); a percent of the week is worth $11–15 of API usage |
| [02](02-claude-max/) | Claude Max 20x ($200) | Claude Code `-p`, Opus 5.5, 6 parallel read-only sessions | **45.3× ± 1.0**; long historical sessions (Sep 28–30) came out at ~62× — not in the table because the meter may have changed since |
| [03](03-codex/) | ChatGPT $100 plan | Codex CLI, GPT-6.1 Sol at high, 6 parallel read-only sessions | **10.25× ± 0.3** |
| [04](04-muse-code/) | Muse Code High Usage ($15) | Muse Code, Spark 1.3 standard and contributor, up to 8 parallel sessions | standard **9.3× ± 0.4**; contributor **5.8× ± 1.3** vs its own API price, **114× ± 33** vs standard's |
| [05](05-claude-pro/) | Claude Pro ($20) | Claude Code `-p "/goal …"`, Opus 5.5, one unattended build session with subagents on a fixed spec, run to the 5-hour limit at peak and again off-peak | **42.0× ± 4.5** weekly; one 5-hour window ≈ $11.6 at peak, ≈ $16 off-peak |
| [06](06-supergrok-lite/) | SuperGrok Lite ($10) | SuperGrok's text-only workload, 12 parallel sessions, run to the weekly limit (67 min) | **15.7× ± 0.8**; a full week ≈ $36 of API usage |
| [07](07-supergrok-no-x/) | SuperGrok ($30), no X account linked | The 06 account upgraded to SuperGrok; same workload, 16 parallel sessions, run to the weekly limit (48 min) | **18.0× ± 0.3**; a week ≈ $124 of API usage — ~1/10 of the X-linked account's |

## Shared method

1. **Meter.** Each vendor exposes the weekly allowance as a percentage. We read it from the vendor's own client with a timestamp: Claude Code's `rate_limit_event` (`seven_day.utilization`), Codex's `rate_limits.primary.used_percent` in its session log, Grok's `_x.ai/billing` → `creditUsagePercent`, Muse's MSP `usage/read` → `weekly.usedPercent`. All are whole percentages.
2. **Spend.** Every model call made on that plan during the run, from the client's own logs, priced at the vendor's public API list price for the model that served it (tables in each folder). Calls from any other session of the same plan on the same machine are included.
3. **Only full steps count.** A run starts somewhere inside a percent (at 7.4%, say), so the stretch before the first tick and after the last tick is dropped. Between two ticks lies exactly one point.
4. **Floor and ceiling per step.** A tick happened between the last reading at the old value and the first reading at the new one. For the step between tick k and tick k+1:
   - floor = spend from the first reading after tick k to the last reading before tick k+1 (certainly inside the step),
   - ceiling = spend from the last reading before tick k to the first reading after tick k+1 (certainly covers it).
   The same is computed once for the whole run (first tick to last tick).
5. **Uncertainty — one rule for every row.** The reported value is the midpoint of the whole-run bracket (the run's average value per point). Then the per-step brackets are compared:
   - if max(floor) ≤ min(ceiling), every point is consistent with one value, and the uncertainty is the whole-run bracket;
   - if max(floor) > min(ceiling), points certainly differed — one was worth at most the min ceiling, another at least the max floor — so the interval is widened to cover that range.
   The ± is the larger distance from the reported value to either end. Where a point passes faster than the meter is read (SuperGrok Lite and the no-X SuperGrok: ~30 s per point, meter read every 30 s), steps are counted in blocks of several points (`--step`), because a one-point step would measure the polling, not the meter.
6. **Multiplier** = $ per point × 100 × (30.4375 / 7 weeks per month) ÷ monthly price.

Readings from parallel sessions can arrive out of order; a reading lower than one already seen is a stale observation and is dropped. Everything above is [`analyze.py`](analyze.py) — run `python analyze.py <experiment>/results <price>` on any folder to reproduce its numbers. [`extract_logs.py`](extract_logs.py) is how the CSVs were cut from each client's local logs.

## Caveats that apply to the whole set

- **A multiplier assumes you can use the whole week.** Claude and Muse also have a 5-hour window. On Muse standard it binds hard: a full 5-hour window was worth only ~$10 of API usage. On Claude Pro a window was worth ≈ $11.6 at peak and ≈ $16 off-peak, about 6–9% of the week.
- **Workload moves the number.** Vendors don't meter exactly in API dollars. On Claude, the same plan measured 45× on short parallel sessions (60% of API cost was 5-minute cache writes) and ~62× on long historical sessions from Sep 28–30 (78% cache reads). The historical figure is not in the table because it predates the dedicated runs and the meter may have changed since. Read each multiplier as "for this kind of work".
- **Usage off the machine is invisible.** Claude's and Grok's meters are shared with their web apps and other devices; those were paused for the runs, but a stray use would make a plan look *less* generous, never more.
- **One run per plan (two for Claude Pro), a few steps each.** The brackets say how tight each measurement is; they don't say the vendor won't change its meter next week.
- **List price is what an API user would pay**, so internal per-call cost fields some clients print (Grok's is one third of list) are not used.
