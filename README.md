# experiments

Scripts, raw logs, and results from experiments behind [Product Compass](https://www.productcompass.pm) posts. When a post claims a number, the receipt lives here.

Run by [Pawel Huryn](https://x.com/PawelHuryn). Everything is reproducible: each experiment ships the exact script, the unedited log, and a README with method, sample size, and caveats.

## Experiment sets

One line each — the full story (method, every wave, caveats) is in each set's own README. Newest at the top.

| Set | One-line result | Date | Source post |
|---|---|---|---|
| [subscription-multipliers/](subscription-multipliers/) | **How much API usage does an AI subscription buy?** Each plan's weekly meter burned on purpose and every call priced at public API rates: **SuperGrok 171× its price, Claude Max 45×, ChatGPT's $100 plan (Codex) 10.25×, Muse Code 9.3× (standard)**; Muse's contributor model is 114× against standard API pricing but 5.8× against its own. Uncertainty from tick-to-tick floor/ceiling brackets on the usage meter. | Oct 1, 2026 | — |
| [jev-decisions-api/](jev-decisions-api/) | **Is TypeSafe's Jev decision model actually cheaper and better?** Its own showcase task (invoice classification), hardened to 50 documents with 32 built so the surface cue lies: **Jev 50/50 at $0.025 per 1,000 decisions — and Claude Haiku 4.5 also 50/50, two self-hostable open models at 48/50 for 1.2–1.25x, and Opus 5 at 115x one answer behind.** The circulating "hundreds of times cheaper" figures are a property of the denominator. Strip the written definitions out and every one of Jev's errors lands below 0.80 confidence, so a 0.80 auto-approve cut passes nothing wrong; but give it a house rule it was never told and it is wrong 19 times in 24, **15 of those above 0.90 confidence**. | Sep 19, 2026 | — |
| [ai-slop-bench/](ai-slop-bench/) | **Which model writes the most AI slop?** 12 models, 3 bare-prompt writing tasks, 108 texts, every pair judged blind in both orders by 4 judge models with vendor recusal: **Fable 5.1 picked as the AI text 14% of the time, Gemini 3.8 Flash 77%**; 1,647 judgments, 30% discarded as order flips; the judges never picked a human post over a model's (0 of 355). Every text and every raw judge response is in the folder. | Sep 7, 2026 | [X](https://x.com/PawelHuryn/status/2096885584153186390) |
| [stealth-ox-alpha-fingerprint/](stealth-ox-alpha-fingerprint/) | OpenRouter's free `stealth/ox-alpha` slug unmasked from the wire, no benchmark — tokenizer, six special-token deltas, model card and recovered system prompt all match Z.ai's GLM. **It is GLM-5.3-Flash.** | Aug 24, 2026 | — |
| [qwen-3.8-max-day-one/](qwen-3.8-max-day-one/) | Alibaba's Qwen3.8-Max on launch day, on the 105-bug rig: **19/105** at high — mid-field, but it fixed one plant no other model has. Plus a five-attempt access gauntlet. | Aug 3, 2026 | [X](https://x.com/i/status/2084345741812580853) |
| [small-question-latency-cost/](small-question-latency-cost/) | What a small, tool-free question costs on Opus 5 vs GPT-5.6 Luna, cold call vs warm session: **~90x cost gap cold, ~43x in session**, driven by the prompt-cache write. | Aug 2, 2026 | — |
| [bug-hunt-bench/](bug-hunt-bench/) → **own repo: [phuryn/bug-hunt-bench](https://github.com/phuryn/bug-hunt-bench)** | **105 planted bugs across two real repos** (a ~28K-line TS VS Code extension + a ~60K-line React/Supabase LMS); frontier coding models find-and-fix, one round each in their native CLI, graded blind against withheld keys. Live board: [bughunt.productcompass.pm](https://bughunt.productcompass.pm). Since Sep 5, 2026 the receipts and the wave-by-wave findings live in [phuryn/bug-hunt-bench/results](https://github.com/phuryn/bug-hunt-bench/tree/main/results); the folder here is a pointer. | Jul 19 – Sep 5, 2026 | [post](https://x.com/PawelHuryn/status/2078834615519731832) · [Jul 31](https://x.com/PawelHuryn/status/2083279026299588816) · [Aug 1](https://x.com/PawelHuryn/status/2083465617697333411) · [Aug 12](https://x.com/PawelHuryn/status/2087600689337835811) · [Aug 24](https://x.com/PawelHuryn/status/2091979928288002164) |
| [claude-code-system-prompt-shrink/](claude-code-system-prompt-shrink/) | Anthropic's Claude Code system prompt, April vs July 2026: the "80% smaller" claim decomposed — **69–81%** depending on how you count — and it's frontier-only. | Jul 21, 2026 | — |
| [kimi-k3-day-one/](kimi-k3-day-one/) | Kimi K3 (largest open-weight model to date) on launch day through the 8-task battery, plus the capacity experiment: a throttle arriving as HTTP 200 killed the longest chains until the pool cooled. | Jul 16–18, 2026 | [X](https://x.com/i/status/2078039188834783367) |
| [five-models-three-harnesses/](five-models-three-harnesses/) | Five frontier coding models, each in its own native CLI, 8 agentic tasks: **no generalist** — every model owned a different axis. Plus the grok token-accounting defect (reports fill, not bill). | Jul 10, 2026 | [post](https://x.com/PawelHuryn/status/2075473856957940186) |
| [fable-5-effort-recheck/](fable-5-effort-recheck/) | What `--effort` buys on Fable 5: a cost lever on normal work (quality flat), but it crosses a capability threshold at `xhigh` on a genuinely hard bug. 210 graded runs. | Jul 3, 2026 | [X](https://x.com/i/status/2073012400542888201) |
| [fugu-ultra-vs-frontier/](fugu-ultra-vs-frontier/) | Sakana's fugu-ultra "multi-agent conductor" vs the frontier: catches no more bugs than GPT-5.5 at ~4x the price, plus the conductor's hidden ~12x token tax. | Jun 24, 2026 | [X](https://x.com/i/status/2069706922027073839) |
| [frontier-vs-open-audit/](frontier-vs-open-audit/) | Open-weights (GLM-5.2) vs closed frontier (Opus 4.8, GPT-5.5) on a 21-bug audit: effort is a lever on the closed models, a no-op on the open one. | Jun 17, 2026 | [X](https://x.com/PawelHuryn/status/2067324156174065677) |
| [fable-5-day-4/](fable-5-day-4/) | Fable 5 day-4 retest at n=20/cell: which launch-week claims held, flipped, or moved — plus audit economics and nesting cost. | Jun 12, 2026 | [X](https://x.com/PawelHuryn/status/2064979937543549362) |
| [fable-5-speed-depth/](fable-5-speed-depth/) | Fable 5 launch week: effort dial, speed vs Opus 4.8, time-to-first-token, subagent depth, recursive workflows, nesting cost. | Jun 11, 2026 | [Guide](https://www.productcompass.pm/p/claude-fable-5-guide) |
| [managed-vs-local-agents/](managed-vs-local-agents/) | Managed agent runtimes vs running the loop yourself across Google / Anthropic / OpenAI: local is cheaper on all three, but "managed" charges for three different things. 108-run comparison. | Jun 1, 2026 | [Product Compass](https://www.productcompass.pm) |
| [silicon-gambit-chess/](silicon-gambit-chess/) ↗ | LLMs play full chess games via an n8n-orchestrated API — an invalid move is instant loss. Live board: [chess.productcompass.pm](https://chess.productcompass.pm/). | Dec 2025 – Feb 2026 | — |

New sets land as new top-level folders; a few are hosted apps whose code lives in their own repo (marked ↗) with a pointer folder here. A set is one theme, not a whole model, so a model can have several sets.

## Anonymization

Published files reference a private content repo through placeholders (`<WORKDIR>`, `SESSION-PROJECT-SLUG`, `<HOME>`). The exact replacement rules are checked in as code, not described in prose: [.claude/hooks/anonymize-rules.json](.claude/hooks/anonymize-rules.json), applied by [.claude/hooks/anonymize.py](.claude/hooks/anonymize.py) — also wired as a PostToolUse hook in [.claude/settings.json](.claude/settings.json), so sessions working inside this repo scrub anything they write with the same rules. Nothing else is edited: numbers, timestamps, verdicts, and model-written lines are as produced.

## Reading order

1. This root README lists the sets and their dates.
2. Each set's README has a one-line headline result per experiment, plus shared method notes and caveats.
3. Each experiment folder has the full story: question, method, results, findings, caveats.
4. The logs are raw. If a number in a post and a log disagree, the log wins and I want to know: [@PawelHuryn](https://x.com/PawelHuryn).

## License

MIT. Use anything; a link back is appreciated.
