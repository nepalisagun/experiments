"""Minimal ACP client for an ACP<->MSP bridge over `muse serve`: captures the forwarded MSP subscription usage (`_muse/subscription_usage`) after each turn."""
import json, os, subprocess, sys, threading, time, queue
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
EXT = r"<ACP-MSP-BRIDGE>"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "muse_images_%s.jsonl" % os.environ.get("MUSE_TAG","x"))
CWD = r"<THROWAWAY-REPO-COPY>"
env = dict(os.environ, TBH_CREDENTIAL_BACKEND="file",
           MUSE_CODE_EXECUTABLE=os.path.join(os.environ["LOCALAPPDATA"], "Programs", "muse", "muse.cmd"),
           GROK_MUSE_POSTURE=json.dumps({"mode": "yolo", "shellSandbox": True}))
p = subprocess.Popen(["node", os.path.join(EXT, "main.mjs")], cwd=CWD, env=env,
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(OUT + ".stderr", "a"), text=True, encoding="utf-8", bufsize=1)
pending = {}; nid = [0]; usage_events = queue.Queue(); last_update = {}
def log(rec): open(OUT, "a", encoding="utf-8").write(json.dumps(rec) + "\n")
def reader():
    for line in p.stdout:
        try: m = json.loads(line)
        except Exception: continue
        if "id" in m and ("result" in m or "error" in m) and m["id"] in pending:
            pending.pop(m["id"]).put(m); continue
        meth = m.get("method")
        if meth == "_muse/subscription_usage":
            u = (m.get("params") or {}).get("usage"); usage_events.put(u); log({"ts": time.time(), "event": "subscription_usage", "usage": u})
        elif meth == "session/update":
            upd = (m.get("params") or {}).get("update") or {}
            if upd.get("sessionUpdate") in ("usage_update",) or "usage" in json.dumps(upd)[:2000]:
                last_update["u"] = upd
        if "id" in m and meth:  # server request: approve / ack
            res = {}
            if meth == "session/request_permission":
                opts = (m.get("params") or {}).get("options") or []
                pick = next((o for o in opts if "allow" in (o.get("kind") or "")), opts[0] if opts else None)
                res = {"outcome": {"outcome": "selected", "optionId": pick["optionId"]}} if pick else {"outcome": {"outcome": "cancelled"}}
            p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": res}) + "\n"); p.stdin.flush()
threading.Thread(target=reader, daemon=True).start()
def req(method, params, timeout=600):
    nid[0] += 1; q = queue.Queue(); pending[nid[0]] = q
    p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": nid[0], "method": method, "params": params}) + "\n"); p.stdin.flush()
    m = q.get(timeout=timeout)
    if "error" in m: raise RuntimeError(f"{method}: {m['error']}")
    return m["result"]
IMGS = [l.strip() for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "grok_images.txt"), encoding="utf-8") if l.strip()]
BATCH = 20
TEXT = ("Do a thorough bug hunt across this whole repository: read every file under src/, adapters/ and test/ in full (no skimming, every line), then report every real defect you find with file, line and a quoted snippet. Do not modify any files.")
LONG = ("Read src/ in this repository, then write complete developer documentation for it as your reply: at least 15,000 words, covering every module, every exported function with its parameters and behaviour, the data flow between modules, and a worked example for each major feature. Write it all out in full in your reply; do not create or modify files, and do not summarise or abbreviate.")
PROMPT = ("Open and look at each of these image files one by one with your file-reading tool (view the actual image, do not guess from the filename). "
          "For each, write a detailed description: everything visible, all text in it transcribed verbatim, layout, colours. Read-only: do not modify, move or create any files.")
print("init", json.dumps(req("initialize", {"protocolVersion": 1, "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False}}, 120))[:200])
i = int(os.environ.get("MUSE_I", "0"))
if True:
    sid = req("session/new", {"cwd": CWD, "mcpServers": []}, 180)["sessionId"]
    if os.environ.get("MUSE_MODEL"):
        req("session/set_model", {"sessionId": sid, "modelId": os.environ["MUSE_MODEL"]}, 120)
    k = (i * BATCH) % len(IMGS); batch = IMGS[k:k + BATCH]
    t0 = time.time()
    try: res = req("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": (TEXT if i % 2 == 0 else LONG)}]}, 7200)
    except Exception as e: print("prompt error", repr(e)[:300]); res = {}
    time.sleep(3)
    u = None
    while not usage_events.empty(): u = usage_events.get()
    w = (u or {}).get("weekly") or {}; win = (u or {}).get("window") or {}
    log({"ts": time.time(), "i": i, "sid": sid, "model": os.environ.get("MUSE_MODEL", "contributor"), "secs": round(time.time() - t0), "stop": (res or {}).get("stopReason"), "sub": u})
    print(f"{time.strftime('%H:%M:%S')} turn{i} imgs{k} weekly={w.get('usedPercent')} window={win.get('usedPercent')} secs={round(time.time()-t0)} stop={(res or {}).get('stopReason')}")
p.stdin.close(); p.terminate()
