"""Export the Grok Build Lite run in analyze.py's format (readings.csv + calls.csv).
Calls = union of every copy of the CLI log (size-capped; archive_unified.jsonl follows it with tail -F)."""
import csv, datetime, glob, json, os
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out"); os.makedirs(OUT, exist_ok=True)
T0 = datetime.datetime.fromisoformat(open(os.path.join(HERE, "run_start.txt")).read().strip()).timestamp()
def epoch(v):
    if isinstance(v, (int, float)): return v / 1000 if v > 1e12 else v
    return datetime.datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
iso = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
lines = set()
for f in ["archive_unified.jsonl", "snap_start_unified.jsonl", "snap_end_unified.jsonl", os.path.expanduser("~/.grok/logs/unified.jsonl")]:
    f = os.path.join(HERE, f)
    if os.path.exists(f):
        for l in open(f, encoding="utf-8", errors="replace"):
            if "inference_done" in l: lines.add(l.strip())
calls = []
for l in lines:
    try: d = json.loads(l)
    except Exception: continue
    t = epoch(d["ts"])
    if t < T0: continue
    c = d["ctx"]; p, ca, o, r = c["prompt_tokens"], c["cached_prompt_tokens"], c["completion_tokens"], c.get("reasoning_tokens", 0)
    m = 2 if p >= 200000 else 1
    calls.append((t, p, ca, o, r, m * ((p - ca) * 2 + ca * 0.5 + o * 6) / 1e6))
calls.sort()
rd = []
for l in open(os.path.join(HERE, "meter_poll.txt")):
    t, _, js = l.partition(" ")
    try: c = json.loads(js)
    except Exception: continue
    rd.append((datetime.datetime.strptime(t, "%Y-%m-%dT%H:%M:%S%z").timestamp(), float(c.get("creditUsagePercent") or 0)))
for f in glob.glob(os.path.join(HERE, "grok_text_w*.jsonl")):
    for l in open(f):
        d = json.loads(l)
        if d.get("pct") is not None: rd.append((d["ts"], float(d["pct"])))
rd = sorted(r for r in rd if r[0] >= T0)
with open(os.path.join(OUT, "readings.csv"), "w", newline="") as fh:
    w = csv.writer(fh); w.writerow(["utc", "weekly_pct"]); w.writerows([iso(t), v] for t, v in rd)
with open(os.path.join(OUT, "calls.csv"), "w", newline="") as fh:
    w = csv.writer(fh); w.writerow(["utc", "prompt_tokens", "cached_prompt_tokens", "completion_tokens_incl_reasoning", "reasoning_tokens", "list_cost_usd"])
    w.writerows([iso(c[0])] + list(c[1:5]) + [round(c[5], 6)] for c in calls)
print(len(rd), "readings,", len(calls), "calls, $%.2f" % sum(c[5] for c in calls), "| cached share of prompt %.0f%%" % (100 * sum(c[2] for c in calls) / max(1, sum(c[1] for c in calls))))
