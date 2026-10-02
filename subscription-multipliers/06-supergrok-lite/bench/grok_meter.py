import json, os, sys, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grok_acp import GrokAcpRunner
CWD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "empty")
r = GrokAcpRunner(cwd=CWD, effort="high", model="grok-4.6", mode="read", log=lambda m: None, always_approve=True)
try:
    r.start()
    r.request("initialize", {"protocolVersion": 1, "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True}}, timeout=60)
    b = r.request("_x.ai/billing", {}, timeout=60)
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), json.dumps((b or {}).get("config", b))[:800])
finally:
    r.close()
