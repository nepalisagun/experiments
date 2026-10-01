"""Export sanitized readings.csv / calls.csv per run (no paths, prompts, file names or session ids)."""
import csv, datetime, glob, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); PUB = os.path.join(HERE, "pub")
U = lambda t: datetime.datetime.fromtimestamp(t, datetime.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
iso = lambda s: datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def write(run, readings, calls, call_fields):
    d = os.path.join(PUB, run); os.makedirs(d, exist_ok=True)
    with open(f"{d}/readings.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["utc", "weekly_pct"] + (["window_5h_pct"] if readings and len(readings[0]) > 2 else []))
        for r in sorted(readings): w.writerow([U(r[0]), *r[1:]])
    with open(f"{d}/calls.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["utc"] + call_fields + ["list_cost_usd"])
        for c in sorted(calls): w.writerow([U(c[0]), *c[1:-1], f"{c[-1]:.6f}"])
    print(run, len(readings), "readings", len(calls), "calls", f"${sum(c[-1] for c in calls):.2f}")

def grok():
    calls = []
    for l in open(os.path.join(HERE, "grok_unified_snapshot.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        if d.get("msg") == "shell.turn.inference_done":
            c = d["ctx"]; p, ca, o, r = c["prompt_tokens"], c["cached_prompt_tokens"], c["completion_tokens"], c["reasoning_tokens"]
            m = 2 if p >= 200000 else 1
            calls.append((iso(d["ts"]), p, ca, o, r, m * ((p - ca) * 2 + ca * 0.5 + o * 6) / 1e6))
    t0 = min(c[0] for c in calls)
    rd = []
    for l in open(os.path.join(HERE, "grok_poll2.txt")):
        t, _, v = l.partition(' {"creditUsagePercent": ')
        if v.strip(): rd.append((datetime.datetime.strptime(t, "%Y-%m-%dT%H:%M:%S%z").timestamp(), float(v)))
    for f in glob.glob(os.path.join(HERE, "grok_images*.jsonl")):
        for l in open(f):
            d = json.loads(l)
            if d.get("pct") is not None: rd.append((d["ts"], d["pct"]))
    rd = [r for r in rd if r[0] >= t0]  # only readings inside the period the call log covers
    write("grok-supergrok", rd, calls, ["prompt_tokens", "cached_prompt_tokens", "completion_tokens_incl_reasoning", "reasoning_tokens"])

def muse():
    calls = []
    for f in glob.glob(os.path.expanduser("~/.local/share/muse/sessions/2026/10/01/*/**/*.jsonl"), recursive=True):
        for l in open(f, encoding="utf-8", errors="replace"):
            m = re.search(r'"recorded_at":(\d+).*?"model_completed","usage":\{"input_tokens":(\d+),"output_tokens":(\d+),"cached_tokens":(\d+),"cache_write_tokens":\d+,"cache_read_tokens":\d+,"reasoning_tokens":(\d+)\}.*?"model":"([^"]+)"', l)
            if m:
                t = int(m.group(1)) / 1e6; i, o, c, r = map(int, m.group(2, 3, 4, 5))
                R = {'muse-spark-1.3': (1.25, 0.15, 4.25), 'muse-spark-1.3-contributor': (0.10, 0.002, 0.20)}[m.group(6)]
                calls.append((t, m.group(6), i, c, o, r, ((i - c) * R[0] + c * R[1] + o * R[2]) / 1e6))
    rd = []
    for f in glob.glob(os.path.join(HERE, "muse_*.jsonl")):
        for l in open(f):
            d = json.loads(l); u = d.get("usage") if d.get("event") == "subscription_usage" else d.get("sub")
            if u and (u.get("weekly") or {}).get("usedPercent") is not None:
                rd.append((u["observedAtMs"] / 1000, u["weekly"]["usedPercent"], u["window"]["usedPercent"]))
    rd = sorted(set(rd))
    cut = min(c[0] for c in calls if c[1] == "muse-spark-1.3" and c[0] > iso("2026-10-01T08:40:00Z"))
    start = iso("2026-10-01T07:54:00Z")
    fields = ["model", "input_tokens_incl_cached", "cached_tokens", "output_tokens_incl_reasoning", "reasoning_tokens"]
    write("muse-contributor", [r for r in rd if start <= r[0] < cut], [c for c in calls if start <= c[0] < cut], fields)
    write("muse-standard", [r for r in rd if r[0] >= cut - 5], [c for c in calls if c[0] >= cut - 5], fields)


def codex(start="2026-10-01T11:09:00Z"):
    t0 = iso(start); rd = []; calls = []
    for f in glob.glob(os.path.expanduser("~/.codex/sessions/2026/10/01/*.jsonl")):
        model = None; prev = None
        for l in open(f, encoding="utf-8", errors="replace"):
            if '"turn_context"' in l and model is None:
                try: model = json.loads(l)["payload"].get("model")
                except Exception: pass
            if '"token_count"' not in l: continue
            d = json.loads(l); p = d["payload"]; t = iso(d["timestamp"])
            if t < t0: 
                if p.get("info"): prev = p["info"]["total_token_usage"]
                continue
            pr = ((p.get("rate_limits") or {}).get("primary") or {})
            if pr.get("used_percent") is not None: rd.append((t, pr["used_percent"]))
            if p.get("info"):
                u = p["info"]["total_token_usage"]; b = prev or {}
                di = {k: u.get(k, 0) - b.get(k, 0) for k in ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens")}
                prev = u
                if di["input_tokens"] or di["output_tokens"]:
                    R = {"gpt-6.1-sol": (2.0, 0.10, 10.0)}.get(model)
                    if R is None: print("UNPRICED model", model); continue
                    calls.append((t, model, di["input_tokens"], di["cached_input_tokens"], di["output_tokens"], di["reasoning_output_tokens"],
                                  ((di["input_tokens"] - di["cached_input_tokens"]) * R[0] + di["cached_input_tokens"] * R[1] + di["output_tokens"] * R[2]) / 1e6))
    write("codex-pro-lite", rd, calls, ["model", "input_tokens_incl_cached", "cached_input_tokens", "output_tokens_incl_reasoning", "reasoning_output_tokens"])

def claude(start="2026-10-01T11:50:00Z", end="2026-10-01T12:10:00Z"):
    P = {"fable-5-1": (10, 12.5, 20, 0.25, 50), "opus-5-5": (4, 5, 8, 0.20, 20), "sonnet-5": (2, 2.5, 4, 0.2, 10), "haiku-4": (1, 1.25, 2, 0.1, 5)}
    def rate(m):
        m = m.replace("claude-", "")
        for k in sorted(P, key=len, reverse=True):
            if m.startswith(k): return P[k]
    t0, t1 = iso(start), iso(end); rd = []; msgs = {}
    files = glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True) + glob.glob(os.path.join(HERE, "sub_claude_w*.jsonl"))
    for f in files:
        last = None
        for l in open(f, encoding="utf-8", errors="replace"):
            if '"usage"' not in l and "unifiedWindows" not in l and '"timestamp"' not in l: continue
            try: d = json.loads(l)
            except Exception: continue
            if d.get("timestamp"): last = iso(d["timestamp"])
            if d.get("type") == "rate_limit_event" and last and t0 <= last <= t1 and "sub_claude_w" in f:
                w = d["rate_limit_info"].get("unifiedWindows") or {}
                if "seven_day" in w: rd.append((last, round(w["seven_day"]["utilization"] * 100), round(w["five_hour"]["utilization"] * 100)))
            m = d.get("message")
            if d.get("type") == "assistant" and isinstance(m, dict) and m.get("usage") and str(m.get("id", "")).startswith("msg_") and d.get("timestamp"):
                t = iso(d["timestamp"])
                if t0 <= t <= t1: msgs[m["id"]] = (t, m["model"], m["usage"])
    calls = []
    for t, mo, u in msgs.values():
        r = rate(mo); cc = u.get("cache_creation") or {}
        w5, w1 = cc.get("ephemeral_5m_input_tokens", 0), cc.get("ephemeral_1h_input_tokens", 0)
        if not cc: w5 = u.get("cache_creation_input_tokens", 0)
        calls.append((t, mo, u.get("input_tokens", 0), w5, w1, u.get("cache_read_input_tokens", 0), u.get("output_tokens", 0),
                      (u.get("input_tokens", 0) * r[0] + w5 * r[1] + w1 * r[2] + u.get("cache_read_input_tokens", 0) * r[3] + u.get("output_tokens", 0) * r[4]) / 1e6))
    write("claude-max-20x", rd, calls, ["model", "input_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens", "cache_read_tokens", "output_tokens"])

if __name__ == "__main__":
    for job in sys.argv[1:]: globals()[job]()
