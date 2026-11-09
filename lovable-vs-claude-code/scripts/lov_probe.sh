#!/bin/bash
# Send the fingerprint quiz in Build mode to each finished benchmark project; save each answer.
D=<BENCH>/bench
S=<WORKDIR>/Temp/scripts/lovable_run.mjs
cd <WORKDIR>
for app in timer split notes budget kanban; do
  url=$(grep "^$app " $D/lov/projects.txt | head -1 | cut -d' ' -f2)
  node $S send $url $D/lov/prompts/probe_quiz.txt >/dev/null 2>&1 || { echo "$(date +%H:%M:%S) probe $app SEND FAILED" >> $D/lov/progress.log; continue; }
  w=$(node $S wait $url $D/lov/probe_$app.json 2>&1)
  echo "$(date +%H:%M:%S) probe $app done $w" >> $D/lov/progress.log
done
echo "$(date +%H:%M:%S) PROBES DONE" >> $D/lov/progress.log
