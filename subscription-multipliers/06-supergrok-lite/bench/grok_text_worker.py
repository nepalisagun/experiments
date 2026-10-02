"""Grok meter calibration, TEXT ONLY: every prompt gets freshly generated random-word files (never seen before,
so nothing can be cached across prompts) and a fresh session. Alternates an output-heavy task (letter shift)
and an input-heavy task (word frequencies over five files). Stops when the meter is TARGET points above its start."""
import json, os, random, sys, time
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grok_acp import GrokAcpRunner
HERE = os.path.dirname(os.path.abspath(__file__))
W = int(os.environ.get("W", "0")); TARGET = float(os.environ.get("TARGET", "3"))
OUT = os.path.join(HERE, f"grok_text_w{W}.jsonl")
DATA = os.path.join(HERE, "grok_text_data", f"w{W}"); os.makedirs(DATA, exist_ok=True)
VOCAB = [l.strip() for l in open(os.path.join(HERE, "vocab.txt"), encoding="utf-8") if l.strip()]  # 6,000 common identifiers/words taken from the Python standard library sources
rng = random.Random(f"{W}-{time.time_ns()}")

def make_file(tag, words=8000):
    path = os.path.join(DATA, f"{tag}.txt")
    lines, line = [], []
    for _ in range(words):
        line.append(rng.choice(VOCAB))
        if len(line) >= 14: lines.append(" ".join(line).capitalize() + "."); line = []
    open(path, "w", encoding="utf-8").write("\n".join(lines))
    return path

def billing(r):
    try: c = (r.request("_x.ai/billing", {}, timeout=60) or {}).get("config") or {}
    except Exception: return None
    return float(c.get("creditUsagePercent") or 0)  # the field is absent at 0%

r = GrokAcpRunner(cwd=DATA, effort="xhigh", model="grok-4.6", mode="read", log=lambda m: None, always_approve=True)
r.start()
r.request("initialize", {"protocolVersion": 1, "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True}}, timeout=120)
start = float(os.environ.get("START", "0")) or billing(r); pct = billing(r); i = int(os.environ.get("I0", "0"))
open(OUT, "a").write(json.dumps({"ts": time.time(), "event": "start", "pct": start}) + "\n")
DEADLINE = float(os.environ.get("DEADLINE", "0")) or float("inf"); errs = 0
STOP = os.path.join(HERE, "STOP")
while (pct is None or start is None or pct - start < TARGET) and (pct or 0) < 99.5 and errs < 5         and time.time() < DEADLINE and not os.path.exists(STOP):
    stamp = f"{W}-{i}-{int(time.time())}"
    if i % 2 == 0:
        f = make_file(f"shift-{stamp}")
        text = (f"Read the file {f} in full. Then output its ENTIRE text with every letter replaced by the next letter of the alphabet "
                "(a->b, b->c, ..., z->a; same for capitals), keeping spaces, punctuation and line breaks unchanged. "
                "Output only the transformed text, all of it, nothing else. Do not create or modify any files.")
    else:
        fs = [make_file(f"freq-{stamp}-{k}") for k in range(5)]
        text = ("Read each of these five files completely, every line. Then report the 40 most frequent words across all of them "
                "with exact counts, and for each file its total word count. Do not create or modify any files.\n" + "\n".join(fs))
    sid = r.request("session/new", {"cwd": DATA, "mcpServers": []}, timeout=120).get("sessionId")
    t0 = time.time()
    try:
        res = r.request("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": text}]}, timeout=3600)
    except Exception as e:
        print("prompt error", repr(e)[:200]); res = {}; errs += 1; time.sleep(30)
    else:
        errs = 0
    meta = (res or {}).get("_meta") or {}; u = meta.get("usage") or {}
    pct = billing(r)
    open(OUT, "a").write(json.dumps({"ts": time.time(), "i": i, "kind": "shift" if i % 2 == 0 else "freq", "secs": round(time.time() - t0),
                                     "model": meta.get("modelId"), "pct": pct, "usage": u}) + "\n")
    print(f"{time.strftime('%H:%M:%S')} w{W} p{i} {'shift' if i % 2 == 0 else 'freq'} in={u.get('inputTokens')} cached={u.get('cachedReadTokens')} out={u.get('outputTokens')} meter={pct}")
    i += 1
print("done", start, "->", pct)
r.close()
