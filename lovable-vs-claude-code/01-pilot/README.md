# 01 · Pilot: one task per size, nobody required to test

## Question

A first, cheap look: what does one build, one small edit and one medium feature cost in Lovable against Claude Code, and which model family answers in each Lovable mode?

## Method

- **Tasks:** a habit tracker, built and then changed twice in one conversation. The three prompts, verbatim, are in [claude-code/p1.txt](claude-code/p1.txt), [p2.txt](claude-code/p2.txt) and [p3.txt](claude-code/p3.txt). Lovable got the same text.
- **Claude Code:** `claude -p` on an API key, Sonnet 5.5 and Opus 5.5, a Vite + React + TypeScript starter, the second and third prompt resumed in the same session ([claude-code/run_cc.sh](claude-code/run_cc.sh)). Cost is Claude Code's own `total_cost_usd`, per step as the difference from the previous step. Raw results: `claude-code/*_[123].json`, summarized in [claude_code_runs.json](claude_code_runs.json).
- **Lovable:** Build mode, one new project; credits read by hand from each turn's Details header. These page captures were not saved, so the Lovable credit figures below are hand-recorded.
- **Nobody was told to test.** This is the main difference from experiment [02](../02-cost-per-task/).
- **Which model, first pass:** 4 knowledge prompts ([prompts.json](prompts.json)) sent to Lovable's Build and Chat modes ([lov_build_models.json](lov_build_models.json), `lov_chat_*.json`) and to a panel of 19 models over their APIs ([panel.json](panel.json): 13 Claude, Gemini and GPT models; [panel2.json](panel2.json): 6 smaller Gemini and GPT models).

## Results

| Task | Lovable credits | Lovable $ at $0.25/credit | Claude Code, Sonnet 5.5 (API) | Claude Code, Opus 5.5 (API) |
|---|---|---|---|---|
| Build | 0.80 | $0.20 | $0.22 (21 s) | $0.66 (70 s) |
| Small edit | 0.50 | $0.13 | $0.03 (9 s) | $0.05 (13 s) |
| Medium feature | 2.50 | $0.63 | $0.12 (43 s) | $0.46 (92 s) |
| A knowledge question, Build mode | 0.40–0.50 | $0.10–0.13 | | |
| A knowledge question, Chat mode | 0 | $0 | | |

n = 1 per cell.

What each side did with no testing requirement:
- Sonnet ignored the starter and wrote a single `index.html`, then said "I haven't opened it in a browser or tested it."
- Opus used the starter and wrote tests, but its permission list didn't let it run them.
- Neither opened a browser.

**Which model:**
- **Chat mode** answered "I am running on Gemini 2.5 Flash (identified as gemini-2.5-flash), and I was trained and built by Google", put its knowledge cutoff at December 2024, and listed Claude 3.5 and o1 as the newest models it knew. That matches the Gemini Flash-class models in the panel.
- **Build mode** gave the same newest-model list, in the same order and with the same months, as Sonnet 5.5, Opus 5.5 and Haiku 5.5 on the panel ("Claude Opus 4.5: about November 2025 / Claude Haiku 4.5: October 2025 / Claude Sonnet 4.5: September 2025", then GPT-5.1, GPT-5, gpt-oss). Sonnet 5 and Opus 4.8 on the panel gave different lists. That points to a Claude 5.x model, not to a tier.
- One Build turn, the medium feature, read like GPT (curly apostrophes, clipped summary).

## Findings

1. **Without a testing requirement the comparison isn't fair.** The three sides did visibly different amounts of verification, so the cost gap is partly a work gap. Experiment [02](../02-cost-per-task/) fixes this by requiring tests and a browser check from everyone.
2. **Chat mode is a Gemini Flash-class model; Build mode is Claude 5.x.** Which Claude tier is answered in [04](../04-which-model-answers/).
3. **Short sessions are cheap in Claude Code.** A small edit cost 3–5 cents on the API; in [02](../02-cost-per-task/), where each step resumes a long session with tests and screenshots in it, the same kind of edit costs about 6× more.

## Caveats

- n = 1 per cell. Superseded by [02](../02-cost-per-task/) for every cost claim.
- Claude Code ran on an API key here, not a subscription, and on a narrower permission list than in 02.
- The Lovable credit numbers in this pilot were recorded by hand, without saved page captures.
- "Knowledge cutoff" answers are self-reports; they place a model family, not a version.
