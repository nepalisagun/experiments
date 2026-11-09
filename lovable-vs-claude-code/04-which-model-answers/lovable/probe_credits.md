# Credits for the five quiz-only turns

Read from the "More options" menu of the last message in each project, right after the quiz turns finished (`scripts/lovable_menu.mjs`). Verbatim menu text, project IDs removed:

| Project | Menu text |
|---|---|
| timer | Worked for 15s · Credits used 0.40 |
| split | Worked for 13s · Credits used 0.40 |
| notes | Worked for 14s · Credits used 0.40 |
| budget | Worked for 8s · Credits used 0.60 |
| kanban | Worked for 10s · Credits used 0.70 |

An answer-only turn has no Details panel, so `wait` in `scripts/lovable_run.mjs` (at that time) fell back to the last Details button on the page: the `hdr` saved in `probe_timer.json`, `probe_split.json`, `probe_budget.json` and `probe_kanban.json` is the header of the previous coding turn. The files are left as recorded. The menu fallback in `lovable_run.mjs` was added after this.
