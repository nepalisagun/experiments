# 03 · Questions about a real repository

## Question

Coding is half the job; the other half is understanding code you didn't write. Asked about a real 604-file repository, what does an answer cost in Lovable and in Claude Code, and how good is it when graded blind against the code? A second question came out of the first round: Lovable's answers were shorter and missed more. Does running Opus 5.5 at a lower effort setting reproduce that?

## Method

**The repository:** [phuryn/staygreen](https://github.com/phuryn/staygreen), an open-source uptime monitor (604 tracked files, 3.3 MB, mostly TypeScript), at commit `e73a0df`.

**The questions**, one conversation, in this order ([../02-cost-per-task/tasks.json](../02-cost-per-task/tasks.json), `repo_qa`):

1. Give me an architecture overview: which separately deployed parts does Staygreen have, where does each run, and how does one failed website check travel from a probe to an alert email?
2. When exactly does a website monitor open an incident? How many failed checks, from how many locations, and what makes the incident resolve?
3. What are the limits of each plan (monitors, apps, status pages, check intervals and anything else), and where in the code are they enforced?
4. How does the REST/MCP API authenticate a request that uses an API token, how are tokens stored, and can a read-only token change anything?
5. I want to add Microsoft Teams as a new alert channel. List every file I would need to change or add and the steps, following the pattern the existing alert channels use.

The first prompt began: "Clone https://github.com/phuryn/staygreen into a temporary folder and answer my questions about it from the code. Don't change any files in this project, and don't add the repository to this project. Cite file paths for the claims you make." Later ones began: "Next question about the same staygreen repository (answer from the code, cite file paths, don't change any files):". Both tools cloned it themselves: Lovable into `/tmp/staygreen` in its sandbox, Claude Code into its working folder.

**Answer sets:**

| Set | Where | Effort |
|---|---|---|
| Lovable | Build mode, a new project | not exposed |
| Sonnet 5.5 | Claude Code, same setup as [02](../02-cost-per-task/) | default |
| Opus 5.5, default | Claude Code | default |
| Opus 5.5, medium | Claude Code, `--effort medium` | medium |
| Opus 5.5, low | Claude Code, `--effort low` | low |

Each set is one session answering all five questions in order (`claude-code/runs/<set>_q<n>.jsonl`, `lovable/qa_q<n>.json`).

**Blind grading** ([grading/](grading/)):

- One grader per question: a fresh Claude Opus 5.5 session that saw all five answers to that question under shuffled labels A–E ([grading/key.json](grading/key.json)) and had the clone at the same commit.
- Answers were flattened to plain text, and every clone path was replaced with `<clone>`, so formatting and paths don't name the tool ([../scripts/make_blind3.py](../scripts/make_blind3.py)). Length and tone still differ.
- The grader's brief is in [grading/rubric.md](grading/rubric.md): open every cited file, verify every concrete claim, write its own reference answer from the code, then score correctness, completeness and usefulness from 0 to 10 and list each error with file:line evidence.
- Each grader's scores and notes: `grading/q<n>_grades.json`, `grading/q<n>_grades.md`.
- An Opus grader may favor Opus-written answers; Lovable's are also mostly Opus ([04](../04-which-model-answers/)), which limits but doesn't remove that bias.

## Results

**Blind grades** (correctness / completeness / usefulness, 0–10; one grader per question saw all five answers). High-severity errors are those the grader marked as something a developer would act on.

| Answer set | Q1 | Q2 | Q3 | Q4 | Q5 | Mean correctness | Mean completeness | Mean usefulness | High-severity errors |
|---|---|---|---|---|---|---|---|---|---|
| Lovable | 9/8/8 | 7/7/7 | 9/7/7 | 9/7/7 | 8/7/7 | 8.4 | 7.2 | 7.2 | 0 |
| Sonnet 5.5 | 9/6/6 | 8/7/8 | 9/6/7 | 9/8/8 | 9/8/8 | 8.8 | 7.0 | 7.4 | 0 |
| Opus 5.5, default | 9/9/9 | 9/9/9 | 9/9/10 | 9/8/9 | 9/9/9 | 9.0 | 8.8 | 9.2 | 0 |
| Opus 5.5, medium | 9/10/10 | 7/8/8 | 8/9/9 | 9/9/9 | 9/9/10 | 8.4 | 9.0 | 9.2 | 0 |
| Opus 5.5, low | 8/7/7 | 8/7/7 | 9/7/7 | 5/6/5 | 8/8/8 | 7.6 | 7.0 | 6.8 | 1 |

**Cost, time and size per answer.** Lovable: credits from each message's menu, $0.25 a credit, and "Used N tools" from its timeline: 8, not shown, 5, 4 and 4 tools for Q1–Q5. Claude Code: API-equivalent dollars and its tool calls.

| Question | Lovable | Sonnet 5.5 | Opus 5.5, default effort | Opus 5.5, medium | Opus 5.5, low |
|---|---|---|---|---|---|
| Q1 | 1.90 cr = $0.47, 62 s, 5,142 chars | $0.41, 61 s, 5,719 chars, 14 tool calls | $0.83, 81 s, 6,360 chars, 19 tool calls | $0.80, 79 s, 7,220 chars, 13 tool calls | $0.39, 61 s, 4,613 chars, 8 tool calls |
| Q2 | 1.60 cr = $0.40, 20 s, 3,527 chars | $0.17, 37 s, 4,752 chars, 8 tool calls | $0.35, 54 s, 4,894 chars, 10 tool calls | $0.17, 34 s, 5,006 chars, 2 tool calls | $0.15, 32 s, 3,557 chars, 3 tool calls |
| Q3 | 3.00 cr = $0.75, 54 s, 4,436 chars | $0.36, 90 s, 6,187 chars, 15 tool calls | $0.87, 94 s, 7,381 chars, 17 tool calls | $0.58, 76 s, 6,009 chars, 10 tool calls | $0.23, 54 s, 4,869 chars, 3 tool calls |
| Q4 | 2.70 cr = $0.68, 35 s, 3,958 chars | $0.25, 44 s, 5,677 chars, 11 tool calls | $0.67, 73 s, 5,541 chars, 16 tool calls | $0.38, 50 s, 6,721 chars, 5 tool calls | $0.27, 62 s, 4,582 chars, 5 tool calls |
| Q5 | 2.90 cr = $0.72, 43 s, 5,033 chars | $0.46, 84 s, 8,306 chars, 18 tool calls | $0.71, 86 s, 6,781 chars, 13 tool calls | $0.52, 73 s, 6,991 chars, 7 tool calls | $0.32, 81 s, 6,180 chars, 5 tool calls |
| **Mean** | 2.42 cr = $0.60, 43 s, 4,419 chars | $0.33, 63 s, 6,128 chars, 13.2 tool calls | $0.68, 78 s, 6,191 chars, 15.0 tool calls | $0.49, 62 s, 6,389 chars, 7.4 tool calls | $0.27, 58 s, 4,760 chars, 4.8 tool calls |

**Per answer on the $200 plan** (API ÷ 45.3): Sonnet 5.5 $0.007, Opus 5.5 $0.015, against Lovable's $0.60: 40× more for Lovable than Opus on the plan.

## Findings

1. **Same model, less work per answer.** Lovable's answers graded 7.2 for usefulness; Opus 5.5 at default effort 9.2, at low effort 6.8. Lovable used 4–8 tools per answer by its own counter; Opus at low effort 3–8, at default 10–19. Lovable's answers averaged 4,419 characters, Opus at low effort 4,760, at default 6,191.
2. **The gap is completeness, not correctness.** Lovable's correctness was 8.4 against Opus's 9.0, with no high-severity errors; completeness was 7.2 against 8.8. It said true things and left things out.
3. **One trap separated default effort from everything else.** On Q2, four of five answers (Lovable, Sonnet, Opus at low and at medium effort) said that editing a website monitor closes its open incident. That close only exists for Stripe and Supabase monitors; a website monitor's incident closes on edit only when its address changes. Only Opus at default effort got it right.
4. **Medium effort kept the quality at lower cost.** Opus at medium effort graded 9.2 for usefulness, the same as default, at $0.49 per answer instead of $0.68.
5. **Lovable charges about default-effort prices for answers graded like low effort.** $0.60 per answer in Lovable, $0.68 for Opus at default effort and $0.27 at low effort, at API prices. Whether Lovable sets a low effort level or instructs the model to keep turns short can't be told apart from outside.
6. **Sonnet 5.5 at default effort graded 7.4**, about the same as Lovable, at $0.33 per answer.

## Caveats

- **n = 5 questions, one grader per question.** Differences under about one point are noise.
- **The grader is a model.** It checked claims against the code, and its notes give file:line evidence for every error, so a disagreement can be checked. It is still one judge, and it's from the same family as most of the answerers.
- **Blinding is partial.** Lengths differ, and Lovable's replies start with a one-line status sentence.
- **Lovable's effort setting isn't exposed**, so the effort comparison shows what Opus looks like at each setting, not what Lovable uses.
- **Earlier grading rounds** (with the first Claude Code run, which loaded the user-level `CLAUDE.md`) are filed in [grading/replicate-user-claude-md/](grading/replicate-user-claude-md/). In those rounds Lovable also graded below Opus at default effort, and Opus at low effort graded close to Lovable.
