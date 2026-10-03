#!/bin/bash
# Grok Build SuperGrok calibration: 16 text-only workers until the weekly meter is used up or 5 hours pass.
cd "$(dirname "$0")"
export PATH=$HOME/.local/bin:$HOME/.grok/bin:/opt/homebrew/bin:$PATH
DL=$(( $(date +%s) + 5*3600 )); echo "deadline $(date -r $DL)" > run.log
cp ~/.grok/logs/unified.jsonl snap_start_unified.jsonl
tail -n 0 -F ~/.grok/logs/unified.jsonl >> archive_unified.jsonl 2>/dev/null & TAIL=$!
( while [ $(date +%s) -lt $DL ] && [ ! -f DONE ]; do python3 grok_meter.py >> meter_poll.txt 2>&1; sleep 30; done ) & POLL=$!
for w in $(seq 0 15); do W=$w TARGET=100 DEADLINE=$DL python3 grok_text_worker.py > worker_$w.out 2>&1 & sleep 3; done
wait $(jobs -p | grep -v -e $TAIL -e $POLL) 2>/dev/null
for p in $(pgrep -f grok_text_worker.py); do wait $p 2>/dev/null; done
while pgrep -f grok_text_worker.py >/dev/null; do sleep 20; done
echo "workers finished $(date)" >> run.log
python3 grok_meter.py >> meter_poll.txt 2>&1; sleep 60; python3 grok_meter.py >> meter_poll.txt 2>&1
touch DONE; sleep 5; kill $TAIL $POLL 2>/dev/null
cp ~/.grok/logs/unified.jsonl snap_end_unified.jsonl
echo "run finished $(date)" >> run.log
