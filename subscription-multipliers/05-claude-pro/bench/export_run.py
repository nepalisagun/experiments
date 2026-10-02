"""Export one Pro run: readings (5-hour and weekly meter) + priced calls, in analyze.py's format.
usage: python3 export_run.py <run_name> <out_dir>"""
import csv, datetime, glob, json, os, sys
RUN, OUT = sys.argv[1], sys.argv[2]
P = {"fable-5-1": (10, 12.5, 20, 0.25, 50), "opus-5-5": (4, 5, 8, 0.20, 20), "sonnet-5": (2, 2.5, 4, 0.2, 10), "haiku-4": (1, 1.25, 2, 0.1, 5)}
def rate(m):
    m = m.replace("claude-", "")
    for k in sorted(P, key=len, reverse=True):
        if m.startswith(k): return P[k]
    raise SystemExit("no price for " + m)
iso = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
os.makedirs(OUT + "/five_hour", exist_ok=True); os.makedirs(OUT + "/weekly", exist_ok=True)
rd = []
for l in open(os.path.expanduser(f"~/sub-test/runs/{RUN}/_events.jsonl")):
    d = json.loads(l)
    if d.get("type") == "rate_limit_event":
        w = d["rate_limit_info"].get("unifiedWindows") or {}
        rd.append((d["_ts"], round(w["five_hour"]["utilization"] * 100), round(w["seven_day"]["utilization"] * 100), d["rate_limit_info"].get("status")))
msgs = {}
for f in glob.glob(os.path.expanduser("~/.claude/projects/") + os.path.expanduser(f"~/sub-test/runs/{RUN}").replace("/", "-") + "/**/*.jsonl", recursive=True):
    for l in open(f):
        d = json.loads(l); m = d.get("message")
        if d.get("type") == "assistant" and isinstance(m, dict) and m.get("usage") and str(m.get("id", "")).startswith("msg_"):
            t = datetime.datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00")).timestamp()
            msgs[m["id"]] = (t, m["model"], m["usage"], "subagents" in f)  # last record per message = final usage
calls = []
for mid, (t, mo, u, sub) in sorted(msgs.items(), key=lambda kv: kv[1][0]):
    r = rate(mo); cc = u.get("cache_creation") or {}
    w5, w1 = cc.get("ephemeral_5m_input_tokens", 0), cc.get("ephemeral_1h_input_tokens", 0)
    if not cc: w5 = u.get("cache_creation_input_tokens", 0)
    i, cr, o = u.get("input_tokens", 0), u.get("cache_read_input_tokens", 0), u.get("output_tokens", 0)
    calls.append([iso(t), mo, "subagent" if sub else "main", i, w5, w1, cr, o, round((i * r[0] + w5 * r[1] + w1 * r[2] + cr * r[3] + o * r[4]) / 1e6, 6)])
hdr = ["utc", "model", "thread", "input_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens", "cache_read_tokens", "output_tokens", "list_cost_usd"]
for sub, col in (("five_hour", 1), ("weekly", 2)):
    with open(f"{OUT}/{sub}/readings.csv", "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["utc", "weekly_pct", "status"])  # column name kept for analyze.py
        for r in rd: w.writerow([iso(r[0]), r[col], r[3]])
    with open(f"{OUT}/{sub}/calls.csv", "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(hdr); w.writerows(calls)
print(len(rd), "readings,", len(calls), "calls, $%.2f" % sum(c[-1] for c in calls),
      "| models", sorted({c[1] for c in calls}), "| subagent calls", sum(c[2] == "subagent" for c in calls))
