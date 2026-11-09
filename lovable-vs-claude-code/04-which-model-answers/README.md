# 04 · Which model answers in Lovable

## Question

Lovable doesn't say which model writes your code in Build mode. Builders guess at "Claude Sonnet", "Opus plus GPT for the hard parts" or "whatever is cheapest". Which Claude tier actually answers, and does it change between turns?

## Method

**Why a knowledge quiz.** Sonnet 5.5 and Opus 5.5 share a June 2026 knowledge cutoff, so recent events can't tell them apart. The documented gap between them is depth of knowledge: Artificial Analysis's AA-Omniscience benchmark has Opus 5.5 right 66% of the time and Sonnet 5.5 54%. A system prompt can change a model's style, but not what it knows. So the fingerprint is a set of obscure facts where the two models give different answers, often both wrong in their own specific way.

**Building the quiz (raw API, no system prompt, default sampling):**

1. **v1, 40 questions** ([quiz/probes_v1.json](quiz/probes_v1.json), panel in [quiz/fp_quiz_panel_v1.json](quiz/fp_quiz_panel_v1.json)). Too easy: Sonnet and Opus both near 100%. Filed as a failed design.
2. **v2, 40 harder questions plus a 45-question pool** ([quiz/probes.json](quiz/probes.json), [quiz/probes_pool.json](quiz/probes_pool.json)): 85 candidates on Polish and European institutions, architects, mountain heights and lake areas. Sonnet 5.5, Opus 5.5, Fable 5.1 and Haiku 5.5 each answered 3 times ([quiz/fp_quiz_v2_panel.json](quiz/fp_quiz_v2_panel.json), [quiz/fp_pool_panel.json](quiz/fp_pool_panel.json)).
3. **Final quiz: the 16 items where the models' answers differ** ([quiz/probes_final.json](quiz/probes_final.json)), re-asked 3 times per model ([quiz/fp_final_panel.json](quiz/fp_final_panel.json)). The prompt, verbatim:

   > Quick quiz from memory. Don't search the web, don't look anything up and don't use any tools or change any files. Answer every question with your best guess, even when unsure, in at most 6 words. Never answer "unknown". Reply with a numbered list and nothing else.

**Scoring** ([quiz/fp_match.py](quiz/fp_match.py)). For each item, a sheet scores the share of a model's 3 reference runs that gave the same normalized answer (`21.87 square kilometres` and `21.87 km²` match; `1,266` and `1266` match). Sum over 16 items, so 16 means "answered exactly like this model every time". Correctness plays no part: matching a model's specific wrong number is the stronger signal.

**Validation, leave one out:** every held-out API run matched its own model best (12 of 12).

| Held-out run | vs Opus 5.5 | vs Sonnet 5.5 | vs Fable 5.1 | vs Haiku 5.5 |
|---|---|---|---|---|
| Opus 5.5 (3 runs) | **15.0 / 15.0 / 14.0** | 8.0 / 8.0 / 7.7 | 13.0 / 13.0 / 12.0 | 4.3 / 4.3 / 4.0 |
| Sonnet 5.5 (3 runs) | 7.3 / 7.7 / 8.7 | **13.0 / 13.0 / 13.0** | 10.0 / 11.0 / 12.0 | 5.3 / 5.7 / 6.0 |
| Fable 5.1 (3 runs) | 12.7 / 12.7 / 12.7 | 11.0 / 11.0 / 11.0 | **16.0 / 16.0 / 16.0** | 6.3 / 6.3 / 6.3 |
| Haiku 5.5 (3 runs) | 5.0 / 3.0 / 4.7 | 5.3 / 6.0 / 5.7 | 7.0 / 5.0 / 7.0 | **8.5 / 8.0 / 8.5** |

**The items that separate Opus from Sonnet** (reference answers, 3 runs each):

| Item | Opus 5.5 | Sonnet 5.5 | Fable 5.1 |
|---|---|---|---|
| Elevation of Łysica | **614 m** ×3 | 612 m ×3 | 612 m ×3 |
| Elevation of Radziejowa | **1,266 m** ×3 | 1,262 m ×3 | 1,262 m ×3 |
| First President of the European Investment Bank | Pietro Campilli ×3 | Pierre Wigny ×2, Campilli ×1 | Pietro Campilli ×3 |
| First President of the Polish Constitutional Tribunal | Alfons Klafkowski ×3 | three different names | Alfons Klafkowski ×3 |
| First President of the Estonian Academy of Sciences | Karl Schlossmann ×3 | Jüri Uluots ×2, Jaan Tõnisson ×1 | Karl Schlossmann ×3 |
| First President of the Polish Academy of Sciences | Jan Dembowski ×3 | Tadeusz Kotarbiński ×3 | Jan Dembowski ×3 |
| Area of Wigry lake | 21.9 / 21.9 / 21.2 km² | 21.7 km² ×3 | 21.7 km² ×3 |
| Architect of the Bank of Poland, Bielańska St. | Leon Benois ×3 | Stefan Szyller ×3 | Leon Benois ×3 |

614 m and 1,266 m are given by Opus 5.5 and by no other model on the panel.

**In Lovable** ([scripts/lov_probe.sh](../scripts/lov_probe.sh), [scripts/lov_xquiz.sh](../scripts/lov_xquiz.sh)), Build mode, one paid account:

- **Quiz-only turns:** the same prompt sent once in each of the 5 app projects from [02](../02-cost-per-task/), after their three coding tasks ([lovable/probe_*.json](lovable/)).
- **Coding turns:** to see which model writes code, the quiz was appended to 4 real coding tasks: 2 small edits and 2 medium features ([lovable/prompts/](lovable/prompts/)). The task came first; the quiz asked for the answers "at the very end of your final reply … from memory".
- Each answer sheet is in `lovable/*_sheet.txt`, the full turn in the matching `.json`.

## Results

| Lovable turn | Credits | vs Opus 5.5 | vs Sonnet 5.5 | vs Fable 5.1 | vs Haiku 5.5 | Best match | Gave 614 m / 1,266 m |
|---|---|---|---|---|---|---|---|
| timer, quiz only | 0.40 | **14.7** | 8.0 | 13.0 | 4.3 | Opus 5.5 | yes / yes |
| split, quiz only | 0.40 | **14.7** | 8.0 | 13.0 | 4.3 | Opus 5.5 | yes / yes |
| kanban, quiz only | 0.70 | **14.3** | 8.0 | 12.0 | 4.3 | Opus 5.5 | yes / yes |
| budget, quiz only | 0.60 | **14.0** | 7.3 | 12.0 | 5.0 | Opus 5.5 | yes / yes |
| notes, quiz only | 0.40 | 10.7 | 9.3 | **12.0** | 5.7 | none clearly | no / no |
| split, small edit + quiz | 2.30 | **14.7** | 8.0 | 13.0 | 4.3 | Opus 5.5 | yes / yes |
| timer, medium feature + quiz | 3.00 | **14.7** | 8.0 | 13.0 | 4.3 | Opus 5.5 | yes / yes |
| budget, medium feature + quiz | 4.10 | **14.0** | 7.3 | 12.0 | 5.0 | Opus 5.5 | yes / yes |
| notes, small edit + quiz | 0.90 | 9.0 | 7.7 | 9.0 | 5.0 | none clearly | no / yes |

Quiz-only turns took 8–15 seconds. Their credits come from each message's "More options" menu, read after the run ([lovable/probe_credits.md](lovable/probe_credits.md)): an answer-only turn has no Details panel, so the `hdr` field saved in four of the five `probe_*.json` files is the previous turn's header, not the quiz's.

**Writing style across the 20 benchmark turns** ([02](../02-cost-per-task/) and [03](../03-repo-questions/)): 19 used straight apostrophes, as every Claude model does in these runs. One, the timer's medium feature (the most expensive turn of the benchmark, 6.73 credits, 6.5 min), used curly apostrophes and a clipped register typical of GPT models: "Added Stats, lasting session history, and CSV export; verified both screen sizes."

**Chat mode** (from [01](../01-pilot/)): it said "I am running on Gemini 2.5 Flash", and its knowledge ended in December 2024.

**A tell that didn't work:** a planning note with a wrong weekday ("Tuesday 12 November 2026", a Thursday), the second prompt in `quiz/probes*.json`. Sonnet and Opus flagged it in every run, Haiku never did, so it separates Haiku but not the two tiers that matter here.

## Findings

1. **Lovable's Build mode is mostly Opus 5.5.** 7 of 9 Build turns matched Opus 5.5 best, at 14.0–14.7 of 16, the same range as Opus's own held-out runs (14–15) and far from Sonnet 5.5 (7.3–8.0). All 7 gave both of the numbers only Opus gives (614 m and 1,266 m).
2. **It's Opus while it writes code, too.** The three coding turns in the Opus projects returned the same answer sheets as those projects' quiz-only turns, at 2.30–4.10 credits each.
3. **Routing looks per project.** The notes project never matched any reference model well (9–10.7 of 16) and gave names no reference model gave ("Mario Campolongo", "Leon Jankowski"), on both its turns. It knows the deep items that Opus and Fable know, gave one of the two Opus-only numbers on one turn and neither on the other. The model behind it is unidentified.
4. **GPT shows up rarely.** 1 of 20 benchmark turns carried a GPT-like style signal, the costliest one. Lovable says publicly that it routes different parts of a build to different models; this is consistent with that, and too thin to call a share.
5. **"Sonnet" is the wrong guess for Build mode.** No Build turn matched Sonnet 5.5 best.

## Caveats

- **n = 9 Build turns on one account, one day.** Routing can change with load, plan or project, and Lovable can change it any time.
- **The reference panel is the raw API with no system prompt.** Lovable's own system prompt and settings can shift style and confidence, but the verdicts rest on knowledge items, including two numbers only Opus gave.
- **Only four reference models.** A model outside the panel (another vendor's, or a Claude version not tested) can't be named, which is why the notes project stays "unidentified".
- **The GPT signal is style, not knowledge**, so it's weaker evidence than the quiz. The quiz wasn't attached to that turn.
- **Effort level can't be read from the quiz.** Experiment [03](../03-repo-questions/) looks at that from a different angle.
