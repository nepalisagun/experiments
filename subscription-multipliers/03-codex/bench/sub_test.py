"""Dedicated subscription-meter test: N parallel workers loop read-only tasks until the weekly meter rises TARGET points.
usage: sub_test.py codex|claude N TARGET"""
import glob, json, os, subprocess, sys, threading, time
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
LAB, N, TARGET = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r"<THROWAWAY-REPO-COPIES>"
LOG = os.path.join(HERE, f"sub_{LAB}_meter.jsonl")
TASKS = [
    "Do a thorough bug hunt across this whole repository: read every file under src/, adapters/ and test/ in full, then report every real defect with file, line and a quoted snippet. Do not modify any files.",
    "Read src/ in this repository, then write complete developer documentation for it as your reply: at least 15,000 words, covering every module, every exported function, the data flow, and a worked example per feature. Write it all in your reply; do not create or modify files.",
]
stop = threading.Event()
CODEX = r"<CODEX-EXE>"

def cmd(i, task):
    if LAB == "codex":
        exe = CODEX if os.path.exists(CODEX) else "codex.cmd"
        return [exe, "exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=high", task]
    return ["claude", "-p", task, "--model", "claude-opus-5-5", "--output-format", "stream-json", "--verbose",
            "--allowedTools", "Read,Glob,Grep", "--disallowedTools", "Edit,Write,Bash,NotebookEdit"]

def worker(w):
    cwd = os.path.join(ROOT, f"c{w}"); k = w
    while not stop.is_set():
        out = open(os.path.join(HERE, f"sub_{LAB}_w{w}.jsonl"), "a", encoding="utf-8")
        p = subprocess.Popen(cmd(w, TASKS[k % 2]), cwd=cwd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        while p.poll() is None:
            if stop.is_set(): p.kill(); break
            time.sleep(2)
        out.close(); k += 1

def codex_meter():
    best = None
    for f in sorted(glob.glob(os.path.expanduser("~/.codex/sessions/2026/10/0*/*.jsonl")), key=os.path.getmtime)[-30:]:
        for l in open(f, encoding="utf-8", errors="replace"):
            if '"used_percent"' in l:
                d = json.loads(l); pr = d["payload"]["rate_limits"]["primary"]
                if best is None or d["timestamp"] > best[0]: best = (d["timestamp"], pr["used_percent"])
    return best

def claude_meter():
    best = None
    for f in glob.glob(os.path.join(HERE, f"sub_{LAB}_w*.jsonl")):
        for l in open(f, encoding="utf-8", errors="replace"):
            if "unifiedWindows" in l:
                try: v = json.loads(l)["rate_limit_info"]["unifiedWindows"]["seven_day"]["utilization"] * 100
                except Exception: continue
                best = v if best is None else max(best, v)
    return (None, best)

meter = codex_meter if LAB == "codex" else claude_meter
start = None
ths = [threading.Thread(target=worker, args=(w,), daemon=True) for w in range(1, N + 1)]
for t in ths: t.start(); time.sleep(3)
while True:
    time.sleep(20)
    m = meter(); v = m[1] if m else None
    open(LOG, "a").write(json.dumps({"ts": time.time(), "reading": m}) + "\n")
    if v is None: continue
    if start is None: start = v; print("start", v, time.strftime("%H:%M:%S"))
    if v - start >= TARGET:
        print("target reached", start, "->", v, time.strftime("%H:%M:%S")); stop.set(); break
for t in ths: t.join(timeout=60)
print("done")
