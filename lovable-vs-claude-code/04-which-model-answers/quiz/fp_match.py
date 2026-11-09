# Match a quiz answer sheet against the raw-API reference answers of each model (per item: share of that model's samples
# giving the same normalized answer). usage: python fp_match.py [answer-file ...]   (no args: leave-one-out on the panel itself)
import json, os, re, sys, unicodedata, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fp_score import parse
B = os.path.dirname(os.path.abspath(__file__))
F = json.load(open(os.path.join(B, 'probes_final.json'), encoding='utf-8'))
panel = json.load(open(os.path.join(B, 'fp_final_panel.json'), encoding='utf-8'))
def key(s):
    s = re.sub(r'(\d),(\d{3})', r'\1\2', s)
    s = unicodedata.normalize('NFKD', s.lower()).encode('ascii', 'ignore').decode()
    s = re.sub(r'\(.*?\)|\b(lord|sir|metres|meters|m|km|km2|square|kilometres|about|approx|approximately|ca)\b', ' ', s)
    w = re.findall(r'[a-z]+|\d+(?:\.\d+)?', s)
    return w[-1] if w else ''
models = sorted({r['model'] for r in panel})
ref = {m: [parse(r['answer']) for r in panel if r['model'] == m] for m in models}
n = len(F['quiz'])
def sim(sheet, m, skip=None):
    rows = [a for j, a in enumerate(ref[m]) if j != skip]
    tot = 0
    for i in range(1, n + 1):
        k = key(sheet.get(i, ''))
        tot += sum(key(a.get(i, '')) == k for a in rows) / max(len(rows), 1)
    return tot
def report(label, sheet, skip=None):
    print(f"{label:28} " + '  '.join(f"{m.replace('claude-','')}={sim(sheet, m, skip if m == skip_m else None):4.1f}" for m in models) + f"   (max {n})")
if len(sys.argv) > 1:
    for f in sys.argv[1:]:
        txt = open(f, encoding='utf-8').read()
        try: txt = json.load(open(f, encoding='utf-8'))['reply']
        except Exception: pass
        skip_m = None; report(os.path.basename(f), parse(txt))
        print('   answers:', [parse(txt).get(i, '') for i in range(1, n + 1)])
else:
    for skip_m in models:
        for j, sheet in enumerate(ref[skip_m]): report(f'{skip_m} #{j} (left out)', sheet, j)
