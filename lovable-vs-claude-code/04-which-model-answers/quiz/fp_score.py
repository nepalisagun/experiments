# Score quiz answers against the key; per-model accuracy and per-item discrimination; weekday-catch rate on the note.
import json, os, re, sys, unicodedata, collections
B = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(B, 'probes.json'), encoding='utf-8'))
def norm(s): return re.sub(r'[^a-z0-9 ]', ' ', unicodedata.normalize('NFKD', s.lower()).encode('ascii', 'ignore').decode()).split()
def parse(ans):
    out = {}
    for l in ans.splitlines():
        m = re.match(r'\s*\**(\d+)[.)]\**\s*(.*)', l)
        if m: out[int(m.group(1))] = m.group(2).strip().strip('*')
    return out
def correct(given, gold):
    g, k = norm(given), norm(gold)
    if not g or g == ['unknown']: return None
    key = [w for w in k if len(w) > 2] or k
    surname = key[-1]
    return surname in g or all(w in g for w in key)
CATCH = re.compile(r'thursday|weekday|actually a|falls on|isn.t a tuesday|is not a tuesday|wrong day|double.check|note:', re.I)
def score(ans):
    a = parse(ans); res = []
    for i, (q, gold) in enumerate(P['quiz'], 1):
        x = a.get(i, '')
        res.append(None if correct(x, gold) is None else bool(correct(x, gold)))
    return res
if __name__ == '__main__':
    panel = json.load(open(os.path.join(B, 'fp_quiz_panel.json'), encoding='utf-8'))
    by = collections.defaultdict(list); notes = collections.defaultdict(list)
    for r in panel:
        if r['kind'] == 'quiz': by[r['model']].append(score(r['answer']))
        else: notes[r['model']].append(bool(CATCH.search(r['answer'])))
    for m, runs in by.items():
        flat = [x for run in runs for x in run]
        print(f"{m:20} n={len(runs)} correct={sum(x is True for x in flat)/len(flat):.0%} wrong={sum(x is False for x in flat)/len(flat):.0%} unknown={sum(x is None for x in flat)/len(flat):.0%} per-run={[sum(x is True for x in run) for run in runs]} weekday-caught={sum(notes[m])}/{len(notes[m])}")
    print('\nitem  ' + '  '.join(m.split('-')[1][:6] for m in by))
    for i, (q, gold) in enumerate(P['quiz']):
        cells = []
        for m, runs in by.items():
            v = [run[i] for run in runs]; cells.append(''.join('Y' if x else ('?' if x is None else 'n') for x in v))
        print(f'{i+1:3}  ' + '  '.join(f'{c:6}' for c in cells) + f'  {gold}')
