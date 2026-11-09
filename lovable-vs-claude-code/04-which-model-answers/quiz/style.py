# Style markers in the final replies: Lovable (lov/*.json 'reply') vs Claude Code Sonnet/Opus (cc_steps.json 'reply').
import json, os, re, glob, collections
B = os.path.dirname(os.path.abspath(__file__))
def markers(t):
    words = max(len(re.findall(r"\w+", t)), 1)
    return {
        'words': words,
        'em_dash_per_1k': 1000 * t.count('—') / words,
        'curly_apos': t.count('’'), 'straight_apos': len(re.findall(r"\w'\w", t)),
        'bold_leadins': len(re.findall(r'^\s*[-*]\s+\*\*[^*]+\*\*', t, re.M)),
        'bullets': len(re.findall(r'^\s*[-*]\s+', t, re.M)),
        'headers': len(re.findall(r'^#+\s', t, re.M)),
        'not_checked_line': bool(re.search(r"(not checked|didn't check|haven't (checked|tested|opened)|wasn't able|couldn't)", t, re.I)),
        'offer_at_end': bool(re.search(r'(let me know|want me to|would you like|happy to|shall I)[^.\n]*[.?!]?\s*$', t.strip()[-300:], re.I)),
    }
groups = collections.defaultdict(list)
for f in glob.glob(os.path.join(B, 'lov', '*_*.json')):
    k = os.path.basename(f)[:-5]
    if k.startswith('probe'): continue
    r = json.load(open(f, encoding='utf-8')).get('reply', '')
    r = re.sub(r'^.*?\nDetails\n(Previewing\n)?', '', r, count=1, flags=re.S)  # drop Lovable's title/Details chrome
    groups['lovable'].append((k, r))
if os.path.exists(os.path.join(B, 'cc_steps.json')):
    for s in json.load(open(os.path.join(B, 'cc_steps.json'))):
        groups[s['model']].append((s['chain'] + '_' + s['kind'], s['reply']))
for g, items in groups.items():
    ms = [markers(r) for _, r in items if r]
    if not ms: continue
    agg = lambda k: sum(m[k] for m in ms)
    print(f"{g:8} n={len(ms):2} words/reply={agg('words')/len(ms):5.0f} em-dash/1k={1000*sum(m['em_dash_per_1k']*m['words']/1000 for m in ms)/agg('words'):4.1f} "
          f"curly'={agg('curly_apos'):3} straight'={agg('straight_apos'):3} bold-leadin bullets={agg('bold_leadins'):3}/{agg('bullets'):3} headers={agg('headers'):3} "
          f"says-what-wasn't-checked={sum(m['not_checked_line'] for m in ms)}/{len(ms)} ends-with-offer={sum(m['offer_at_end'] for m in ms)}/{len(ms)}")
