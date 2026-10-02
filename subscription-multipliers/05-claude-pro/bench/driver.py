"""Burn one Claude Pro 5-hour window with a /goal session; log every stream event with wall-clock time.
usage: python3 driver.py <run_dir> <deadline_epoch>
Stops when the 5-hour window is exhausted (rate limit rejected / utilization >= 1.0) or at the deadline."""
import json, os, signal, subprocess, sys, time
RUN, DEADLINE = os.path.abspath(sys.argv[1]), float(sys.argv[2])
MODEL, EFFORT = "claude-opus-5-5", "high"
GOAL = ("/goal Every numbered feature and sub-item in SPEC.md is implemented end to end; npm test passes with >=90% line "
        "coverage; npm run lint and npm run typecheck pass; REPORT.md maps every spec item to the tests that prove it.")
# No permission bypass: edits are confined to the run folder (acceptEdits) and Bash is limited to the build toolchain.
ALLOWED = ["Read", "Edit", "Write", "Glob", "Grep", "Task", "TodoWrite", "Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)",
           "Bash(git:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cat:*)", "Bash(sqlite3:*)"]
EV, LOG = os.path.join(RUN, "_events.jsonl"), os.path.join(RUN, "_driver.log")
def log(m):
    open(LOG, "a").write(time.strftime("%Y-%m-%d %H:%M:%S ") + m + "\n")
sid, done, launches = None, False, 0
while not done and time.time() < DEADLINE:
    cmd = ["claude", "-p", GOAL if sid is None else "Continue toward the goal.", "--output-format", "stream-json", "--verbose",
           "--model", MODEL, "--effort", EFFORT, "--permission-mode", "acceptEdits", "--allowedTools", *ALLOWED]
    if sid: cmd += ["--resume", sid]
    launches += 1; log(f"launch {launches} sid={sid}")
    p = subprocess.Popen(cmd, cwd=RUN, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         text=True, start_new_session=True)
    for line in p.stdout:
        now = time.time()
        try: d = json.loads(line)
        except Exception: d = {"type": "_raw", "text": line.rstrip()[:2000]}
        d["_ts"] = now
        open(EV, "a").write(json.dumps(d) + "\n")
        sid = d.get("session_id") or sid
        if d.get("type") == "rate_limit_event":
            i = d.get("rate_limit_info") or {}
            u = ((i.get("unifiedWindows") or {}).get("five_hour") or {}).get("utilization")
            if i.get("status") == "rejected" or (u is not None and u >= 1.0):
                log(f"window exhausted: status={i.get('status')} u5h={u}"); done = True
        if d.get("type") == "result" and "limit" in str(d.get("result", "")).lower():
            log("result mentions limit: " + str(d.get("result"))[:300]); done = True
        if done or now >= DEADLINE:
            if not done: log("deadline reached")
            os.killpg(p.pid, signal.SIGTERM); break
    p.wait(); log(f"exit {p.returncode}")
    if not done: time.sleep(5)
log("driver finished")
