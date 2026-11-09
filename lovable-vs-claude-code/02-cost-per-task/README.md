# 02 · Cost per task, with testing required

## Question

"Lovable is expensive" and "Claude Code is cheaper" both get said a lot, usually about different amounts of work. With the same prompts and the same testing bar on both sides, what does one task cost in Lovable, in Claude Code at API prices, and in Claude Code on a Claude plan?

## Method

**Five front-end apps, three tasks each, one conversation per app.** A Pomodoro timer, a bill splitter, a Kanban board, Markdown notes and a budget tracker. Each app was built, then given a small edit, then a medium feature, in the same conversation, which is how people use both tools. All prompts are in [tasks.json](tasks.json), verbatim.

| Task type | Definition fixed in advance | Example |
|---|---|---|
| Build | A new app from an empty starter, from a written spec of 11–12 numbered requirements | Kanban: three columns, drag and drop with mouse, touch and a keyboard alternative, a WIP limit of 3, search, a priority filter, overdue highlighting, persistence |
| Small edit | Copy, styling or one default value; no new state or logic | "Rename the Doing column to In progress and strike through titles in Done" |
| Medium feature | A new capability: new state or data model, a new view, its tests | "Add multiple boards: create, rename, delete, switch, move a card between boards, and migrate the existing board without losing cards" |

**The same requirements on both sides:**

- Every build prompt ended with: "Front-end only: no backend, no database, no cloud services, no sign-in. Save data in the browser's localStorage." No database anywhere, because Lovable's and a hand-rolled backend can't be compared like for like.
- Every build and medium prompt ended with: "Before you finish: write automated tests for the logic and run them until they pass, then open the app in a real browser and click through every requirement at desktop (1280px wide) and mobile (375px wide) sizes, fixing anything that's broken. End your reply with a short list of what you tested and how."
- Every small edit ended with: "Before you finish: run the existing tests, then check the change in a real browser at desktop (1280px wide) and mobile (375px wide) sizes. End your reply with a short list of what you checked."

**Claude Code** ([../scripts/run_cc.py](../scripts/run_cc.py)): Sonnet 5.5 and Opus 5.5 at default effort, each app as one session (`--resume` for steps 2 and 3), starting from a Vite + React + TypeScript + Tailwind starter with Playwright installed and set to drive the installed Chrome ([starter/](starter/)). The starter's 3-line `CLAUDE.md` says how to run browser tests and look at screenshots; it doesn't ask for anything the prompt doesn't. Every step was committed, so each step's diff is in `claude-code/apps/<model>_<app>/steps/`, the final source in `final/`, and the full session log in `claude-code/runs/`.

**Lovable** ([../scripts/lov_chain2.sh](../scripts/lov_chain2.sh), [../scripts/lovable_run.mjs](../scripts/lovable_run.mjs)): Build mode, one new project per app, the three prompts sent in order from a logged-in browser. Each turn's credits, time, timeline and reply are in `lovable/<app>_<task>.json`; [lovable/steps.json](lovable/steps.json) has the parsed credits and times.

**Costs:** see the set's [method notes](../README.md#method-notes-that-apply-to-every-experiment). Per-step token counts, tool calls, test runs and screenshots opened are in [claude-code/steps.json](claude-code/steps.json); [summary.json](summary.json) has the means ([../scripts/summarize.py](../scripts/summarize.py)).

## Results

**Means by task type, 5 tasks each** ([range] across the five). "On the plan" = API dollars ÷ 45.3.

| Task | Lovable credits | Lovable $ at $0.25 / $0.30 | Sonnet 5.5, API $ | Opus 5.5, API $ | Sonnet 5.5 on the plan | Opus 5.5 on the plan | Lovable ÷ Opus on the plan |
|---|---|---|---|---|---|---|---|
| Build | 5.02 [3.40–6.70] | $1.26 / $1.51 | $0.61 [0.49–0.87] | $1.65 [1.54–1.85] | $0.013 | $0.036 | 35× |
| Small edit | 1.40 [1.30–1.60] | $0.35 / $0.42 | $0.17 [0.12–0.22] | $0.31 [0.22–0.38] | $0.004 | $0.007 | 51× |
| Medium feature | 5.21 [4.10–6.73] | $1.30 / $1.56 | $0.64 [0.49–0.89] | $1.62 [1.33–1.79] | $0.014 | $0.036 | 36× |

**Every task.** Time is wall-clock; Claude Code's includes five sessions running in parallel on one laptop. Lines changed exclude `package-lock.json`.

| App | Task | Lovable credits | Lovable time | Sonnet $ | Sonnet time | Sonnet lines changed | Opus $ | Opus time | Opus lines changed |
|---|---|---|---|---|---|---|---|---|---|
| Pomodoro timer | Build | 3.40 | 3.1 min | $0.61 | 6.2 min | +700 −4 in 8 files | $1.58 | 8.3 min | +1140 −3 in 13 files |
| Pomodoro timer | Small edit | 1.60 | 85 s | $0.21 | 90 s | +42 −12 in 4 files | $0.34 | 99 s | +36 −10 in 4 files |
| Pomodoro timer | Medium feature | 6.73 | 6.5 min | $0.51 | 3.8 min | +479 −11 in 7 files | $1.64 | 7.3 min | +658 −35 in 10 files |
| Bill splitter | Build | 5.40 | 4.5 min | $0.49 | 3.9 min | +996 −3 in 6 files | $1.54 | 8.9 min | +1442 −4 in 6 files |
| Bill splitter | Small edit | 1.40 | 44 s | $0.14 | 65 s | +23 −3 in 4 files | $0.38 | 2.3 min | +64 −8 in 5 files |
| Bill splitter | Medium feature | 4.30 | 2.2 min | $0.61 | 4.3 min | +623 −1 in 5 files | $1.33 | 6.3 min | +721 −7 in 4 files |
| Kanban board | Build | 6.70 | 9.4 min | $0.87 | 7.8 min | +1035 −3 in 7 files | $1.62 | 7.9 min | +1436 −4 in 10 files |
| Kanban board | Small edit | 1.30 | 88 s | $0.22 | 84 s | +27 −7 in 3 files | $0.29 | 100 s | +27 −6 in 3 files |
| Kanban board | Medium feature | 5.20 | 3.5 min | $0.89 | 5.5 min | +708 −17 in 7 files | $1.69 | 7.4 min | +976 −29 in 5 files |
| Markdown notes | Build | 3.90 | 3.6 min | $0.58 | 4.0 min | +808 −3 in 8 files | $1.85 | 12.2 min | +1728 −4 in 11 files |
| Markdown notes | Small edit | 1.40 | 58 s | $0.12 | 56 s | +71 −10 in 3 files | $0.22 | 84 s | +18 −6 in 2 files |
| Markdown notes | Medium feature | 4.10 | 2.0 min | $0.49 | 3.4 min | +510 −5 in 4 files | $1.67 | 8.5 min | +1029 −11 in 12 files |
| Budget tracker | Build | 5.70 | 4.8 min | $0.49 | 4.9 min | +798 −2 in 6 files | $1.64 | 9.2 min | +1396 −3 in 9 files |
| Budget tracker | Small edit | 1.30 | 49 s | $0.13 | 58 s | +25 −4 in 2 files | $0.33 | 75 s | +45 −14 in 3 files |
| Budget tracker | Medium feature | 5.70 | 4.3 min | $0.69 | 4.3 min | +516 −21 in 4 files | $1.79 | 7.7 min | +962 −31 in 9 files |

**Where Claude Code's tokens go** (mean per task; from `claude-code/steps.json`).

| Model | Task | Output tokens | Cache reads | Cache writes | Uncached input | Tool calls | Browser test runs | Screenshots opened |
|---|---|---|---|---|---|---|---|---|
| Sonnet 5.5 | Build | 28,470 | 717,615 | 44,923 | 1,624 | 24 | 6.0 | 2.6 |
| Sonnet 5.5 | Small edit | 4,487 | 421,768 | 9,113 | 13 | 13 | 1.0 | 2.2 |
| Sonnet 5.5 | Medium feature | 25,318 | 1,251,993 | 33,486 | 28 | 28 | 2.6 | 3.6 |
| Opus 5.5 | Build | 39,812 | 1,277,015 | 74,369 | 1,639 | 40 | 6.4 | 6.0 |
| Opus 5.5 | Small edit | 5,016 | 599,012 | 11,406 | 15 | 14 | 1.6 | 3.4 |
| Opus 5.5 | Medium feature | 35,847 | 2,459,854 | 51,955 | 42 | 41 | 4.2 | 4.6 |

**Testing, both sides.** Every Lovable turn ended with the list of checks it ran, including tests and both screen widths (`lovable/*.json`, `turn_text`). Every Claude Code step ran Playwright and opened screenshots (table above). After the runs I rebuilt each Claude Code app and reran its tests outside the agent ([../scripts/verify_apps.py](../scripts/verify_apps.py), [claude-code/verify.json](claude-code/verify.json)):

| App | Build | Unit tests | Browser tests |
|---|---|---|---|
| Sonnet 5.5, pomodoro timer | passes | 28 passed | 14 passed |
| Sonnet 5.5, bill splitter | passes | 34 passed | 4 passed |
| Sonnet 5.5, kanban board | passes | 33 passed | 31 passed |
| Sonnet 5.5, markdown notes | passes | 31 passed | 6 passed |
| Sonnet 5.5, budget tracker | passes | 34 passed | 4 passed |
| Opus 5.5, pomodoro timer | passes | 34 passed | 42 passed |
| Opus 5.5, bill splitter | passes | 39 passed | 8 passed |
| Opus 5.5, kanban board | passes | 53 passed | 32 passed |
| Opus 5.5, markdown notes | passes | 64 passed | 30 passed |
| Opus 5.5, budget tracker | passes | 41 passed | 4 passed |

## Findings

1. **Lovable costs about what Opus 5.5 costs at API prices.** Build $1.26 vs $1.65, small edit $0.35 vs $0.31, medium feature $1.30 vs $1.62: 0.76–1.12× Opus's API cost. Since Lovable's Build mode is mostly Opus 5.5 ([04](../04-which-model-answers/)), its credit price is close to the API price of the model underneath, not a large markup.
2. **On the $200 Claude plan, the same work costs 35–51× less than in Lovable**: $0.036 per Opus build against $1.26. That gap is the plan's ~45× subsidy over API prices, not anything Claude Code does more cheaply, and it only holds while you use the allowance.
3. **Sonnet 5.5 at API prices costs about half of Lovable** (48–49% on every task type), for the same tests and browser checks.
4. **Both sides did the testing.** Every Lovable turn listed the tests it ran and the two screen widths it checked; every Claude Code step ran browser tests and opened screenshots, and all 10 Claude Code apps build and pass their own tests when rerun (28–64 unit and 4–42 browser tests each).
5. **Most of Claude Code's cost is re-reading the conversation.** Each step resumes the same session, so a small edit read 0.42M (Sonnet) to 0.60M (Opus) cached tokens to write about 4,500–5,000 output tokens. Opus also wrote more for the same spec: 1,140–1,728 added lines per build against Sonnet's 700–1,035.

## Caveats

- **n = 5 per task type.** Lovable's build credits ranged 2× (3.4–6.7 credits) on specs of the same size; one more expensive app moves a mean noticeably.
- **Equal instructions and evidence of testing, not graded output.** Both sides wrote tests and checked in a browser on every task; the apps themselves weren't scored against each other.
- **The cost depends on the session shape.** Claude Code re-reads the whole conversation on every call, so a small edit at the end of a long build session costs several times what it costs in a fresh session ([01](../01-pilot/)). Lovable's credit cost follows the work it chooses to do.
- **Claude Code's own cost figure is lower for Sonnet** (`total_cost_usd` in the logs), because it prices Sonnet's 1-hour cache writes below the documented 2× input. The tables use the documented rate; for Opus the two agree.
- **The permission list** blocked 1–5 shell commands in 18 of the 30 steps (e.g. `sed -i`, `npm pkg set`); the models worked around them. Broader permissions would change the runs slightly.
- **Wall-clock times** include five Claude Code sessions in parallel on one laptop.
- **A first run of the Claude Code side loaded the user-level `CLAUDE.md`** (about 2,500 tokens of personal notes). It's filed unchanged in [claude-code/replicate-user-claude-md/](claude-code/replicate-user-claude-md/). Per task type its costs were 9% lower to 27% higher than the clean run's (the 5-task ranges overlap), and its Lovable-to-plan ratio was 30–47× instead of 35–51×.
