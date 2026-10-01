"""Grok meter calibration, image-heavy: 20 images per prompt, fresh session each prompt (no cache carry-over).
Stops at +5 meter points (hard stop +10). Logs xAI costUsdTicks, tokens and meter after every prompt."""
import json, os, sys, time
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
sys.path.insert(0, r"<REPO>\five-models-three-harnesses\harness")
from grok_acp import GrokAcpRunner
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "grok_images_w%s.jsonl" % os.environ.get("OFF","0"))
IMGS = [l.strip() for l in open(os.path.join(HERE, "grok_images.txt"), encoding="utf-8") if l.strip()]
CWD = r"<IMAGE-DIR>"
BATCH = 20
def billing(r):
    return ((r.request("_x.ai/billing", {}, timeout=60) or {}).get("config") or {}).get("creditUsagePercent")
def log(rec): open(OUT, "a", encoding="utf-8").write(json.dumps(rec) + "\n")
r = GrokAcpRunner(cwd=CWD, effort="xhigh", model="grok-4.6", mode="read", log=lambda m: None, always_approve=True)
r.start()
r.request("initialize", {"protocolVersion": 1, "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True}}, timeout=120)
start = billing(r); print("start", start, time.strftime("%H:%M:%S")); log({"ts": time.time(), "event": "start", "pct": start})
spent = 0.0; i = 0; pct = start
while pct is None or start is None or pct - start < 5:
    k = ((i + int(os.environ.get("OFF","0"))) * BATCH) % len(IMGS); batch = IMGS[k:k + BATCH]
    text = ("Open and look at each of these image files one by one with your file-reading tool (view the actual image, do not guess from the filename). "
            "For each, write a detailed description: everything visible, all text in it transcribed verbatim, layout, colours. Read-only: do not modify or create any files.\n"
            + "\n".join(batch))
    sid = r.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=120).get("sessionId")
    t0 = time.time()
    try:
        res = r.request("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": text}]}, timeout=3600)
    except Exception as e:
        print("prompt error", repr(e)[:300]); res = {}
    meta = (res or {}).get("_meta") or {}; u = meta.get("usage") or {}
    cost = (u.get("costUsdTicks") or 0) / 1e10; spent += cost
    pct = billing(r)
    log({"ts": time.time(), "i": i, "secs": round(time.time() - t0), "model": meta.get("modelId"), "cost": cost, "spent": spent, "pct": pct, "usage": u})
    print(f"{time.strftime('%H:%M:%S')} p{i} imgs{k}-{k+len(batch)} {meta.get('modelId')} in={u.get('inputTokens')} cached={u.get('cachedReadTokens')} out={u.get('outputTokens')} xai=${cost:.2f} total=${spent:.2f} meter={pct}")
    i += 1
    if pct is not None and start is not None and pct - start >= 10: break
print("done", start, "->", pct, f"${spent:.2f}")
r.close()
