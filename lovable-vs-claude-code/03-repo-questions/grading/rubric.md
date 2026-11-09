# Grader brief (round 3, used verbatim for each of the five graders)

You are grading five answers to one question about the open-source repository phuryn/staygreen. A clone at commit `e73a0df` ("Staygreen phase4-2026-11-08.1") is at `{CLONE}`. The answers are labelled A–E in random order. They come from different AI coding tools and settings; you are not told which is which, and you should not try to guess. Formatting was flattened to plain text for all five, and every clone location was replaced with `<clone>`, so ignore formatting and paths.

Read the question and all five answers in `{PACKET}`. Then check the answers against the code: open every file an answer cites and verify each concrete claim (names, numbers, thresholds, file locations, control flow). Look up anything an answer asserts without citing. Build your own picture of the correct, complete answer from the code before you score.

Score each answer from 0 to 10 on three axes:

- **Correctness**: how much of what it says is true in the code. Deduct by severity: a wrong claim a developer would act on (wrong threshold, wrong file to change, wrong security property) costs more than a wrong detail.
- **Completeness**: how much of what the question asks, and what the code shows matters, it covers.
- **Usefulness**: how well a developer new to the repo could act on it: right files, right order, the non-obvious traps.

Score each answer on its own against the code, not against the others; use the full scale. Length is not a virtue in itself: a short, correct, complete answer can score 10.

Write two files:

1. `{OUT}.json`: a JSON object keyed by answer label, each with `correctness`, `completeness`, `usefulness` (integers 0–10), `errors` (a list of `{"claim": "...", "truth": "...", "evidence": "path:line", "severity": "high|medium|low"}`), and `omissions` (a list of short strings: important things the code shows that the answer misses).
2. `{OUT}.md`: a short note: your own reference answer in a few bullets with file:line evidence, then one paragraph per answer explaining its scores.

Don't modify the repository.
