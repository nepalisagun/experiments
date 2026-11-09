# Blind grading packets for the clean repo-question runs: one packet per question, five answers under shuffled labels.
# Claude Code answers are Markdown; Lovable's were captured as page text. Both are flattened to plain text and the
# clone location is replaced by <clone>, so neither formatting nor a temp path names the tool. Length and tone still differ.
import json, os, random, re
B = os.path.dirname(os.path.abspath(__file__))
G = os.path.join(B, 'grading'); os.makedirs(G, exist_ok=True)
T = json.load(open(os.path.join(B, 'tasks.json'), encoding='utf-8'))
QS = T['repo_qa']['questions']
SETS = {
    'lovable': [json.load(open(os.path.join(B, 'lov', f'qa_q{i}.json'), encoding='utf-8'))['reply'] for i in range(1, 6)],
    'sonnet': None, 'opus_default': None, 'opus_low': None, 'opus_medium': None,
}
for k, f in (('sonnet', 'sonnet_qa'), ('opus_default', 'opus_qa'), ('opus_low', 'opus_qa_low'), ('opus_medium', 'opus_qa_medium')):
    steps = json.load(open(os.path.join(B, 'cc2', f + '.json'), encoding='utf-8'))
    SETS[k] = [(s.get('result') or {}).get('result') or '' for s in steps]

SEP = '[' + chr(92) * 2 + '/]'  # a backslash or a slash
ABS = re.compile('(?:[A-Za-z]:' + SEP + '|/tmp/|/[a-z]/Users/|<BENCH>)' + '[^' + chr(92) + 's`' + "'" + '"()<>]*')
CUT = re.compile(SEP + '(?:sg-clone' + SEP + 'staygreen|repo' + SEP + 'staygreen|staygreen|sg|repo)(?=' + SEP + '|$)')

def mask(m):
    tok = m.group(0)
    end = re.search('[.,;:]+$', tok)
    tail = end.group(0) if end else ''
    tok = tok[:len(tok) - len(tail)]
    c = CUT.search(tok)
    if c: return '<clone>' + tok[c.end():] + tail
    return ('<clone>' if ('scratchpad' in tok or tok.startswith('/tmp')) else tok) + tail

def plain(t):
    out = []
    for line in t.replace('\r', '').split('\n'):
        s = line.rstrip()
        if re.fullmatch(r'\s*```.*', s) or re.fullmatch(r'\s*-{3,}\s*', s): continue
        if re.fullmatch(r'\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*', s): continue
        if s.lstrip().startswith('|'):
            s = '; '.join(c.strip() for c in s.strip().strip('|').split('|'))
        s = re.sub(r'^\s*#{1,6}\s+', '', s)
        s = re.sub(r'^(\s*)(?:[-*+]|\d+[.)])\s+', r'\1', s)
        s = s.replace('**', '').replace('__', '').replace('`', '')
        out.append(s)
    t = '\n'.join(out)
    t = ABS.sub(mask, t)
    t = t.replace('the scratchpad folder', 'a temporary folder')  # Claude Code's name for its temp folder would name the tool
    return re.sub(r'\n{3,}', '\n\n', t).strip()

rng = random.Random(20261109)
key = {}
for qi, q in enumerate(QS, 1):
    names = list(SETS); rng.shuffle(names)
    parts = [f'# Question {qi}\n\n{q}\n']
    for lab, n in zip('ABCDE', names):
        key[f'q{qi}{lab}'] = n
        parts.append(f'## Answer {qi}{lab}\n\n{plain(SETS[n][qi - 1])}\n')
    open(os.path.join(G, f'q{qi}_packet.md'), 'w', encoding='utf-8', newline='\n').write('\n'.join(parts))
json.dump(key, open(os.path.join(G, 'key.json'), 'w', encoding='utf-8'), indent=1)
print({k: len(v) for k, v in SETS.items()}, 'packets written')
