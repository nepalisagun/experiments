for i in $(seq 1 480); do python grok_meter.py 2>/dev/null | grep -o '^[^ ]* {"creditUsagePercent": [0-9.]*' >> grok_poll2.txt; sleep 25; done
