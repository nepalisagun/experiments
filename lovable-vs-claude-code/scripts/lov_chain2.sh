#!/bin/bash
# Lovable side: one project per chain, Build mode, steps in order. Stops the chain on any failure.
# usage: lov_chain.sh <chain> <step,step,...> [existing-project-url]
#   chain timer|split|kanban|notes|budget -> steps build,small,medium ; chain qa -> steps q1,...,q5
set -u
S=<WORKDIR>/Temp/scripts/lovable_run.mjs
D=<BENCH>/bench/lov
chain=$1; steps=$2; url=${3:-}
cd <WORKDIR>
log(){ echo "$(date +%H:%M:%S) $*" >> $D/progress.log; echo "$(date +%H:%M:%S) $*"; }
for st in ${steps//,/ }; do
  pf=$D/prompts/${chain}_${st}.txt
  if [ -z "$url" ]; then
    out=$(node $S new $pf 2>&1) || { log "$chain $st NEW FAILED $out"; exit 1; }
    url=$(echo "$out" | tail -1 | python -c "import json,sys;print(json.loads(sys.stdin.read())['url'])") || { log "$chain $st NO URL $out"; exit 1; }
    echo "$chain $url" >> $D/projects.txt
  else
    out=$(node $S send $url $pf 2>&1) || { log "$chain $st SEND FAILED $out"; exit 1; }
  fi
  log "$chain $st sent $url"
  w=$(node $S wait $url $D/${chain}_${st}.json 2>&1) || { log "$chain $st WAIT FAILED $w"; exit 1; }
  log "$chain $st done $w"
  echo "$w" | grep -qE '[|] [0-9]+([.][0-9]+)? [|] Details' || { log "$chain $st NO CREDITS NUMBER IN HEADER - stopping"; exit 1; }
done
log "$chain CHAIN DONE"
