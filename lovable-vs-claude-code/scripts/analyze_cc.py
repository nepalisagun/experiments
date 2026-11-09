# Per-step tokens and API-equivalent cost for the Claude Code runs (subscription login, so cost is an estimate from tokens).
# modelUsage in a resumed session's result is cumulative, so each step's figures are the difference from the previous step.
import json, os, glob, re, collections
B = os.path.dirname(os.path.abspath(__file__))
# $/MTok input, output, cache read: claude-api skill model table (Sonnet 5.5 $2/$10, cache read $0.20; Opus 5.5 $4/$20/$0.20; Haiku 5.5 $0.10/$0.50/$0.01).
# Cache writes: 1.25x input (5-minute), 2x input (1-hour).
P = {'claude-opus-5-5': (4, 20, .20), 'claude-sonnet-5-5': (2, 10, .20), 'claude-haiku-5-5': (.10, .50, .01)}
KEYS = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationEphemeral5mInputTokens', 'cacheCreationEphemeral1hInputTokens', 'cacheCreationInputTokens', 'costUSD']

def cost(m, u):
    i, o, cr = P[m]
    w5 = u.get('cacheCreationEphemeral5mInputTokens', 0); w1 = u.get('cacheCreationEphemeral1hInputTokens', 0)
    if not (w5 or w1): w5 = u.get('cacheCreationInputTokens', 0)
    return (u['inputTokens'] * i + u['outputTokens'] * o + u['cacheReadInputTokens'] * cr + w5 * i * 1.25 + w1 * i * 2) / 1e6

def tools_of(jsonl):
    c = collections.Counter(); notes = collections.Counter(); denied = 0
    for l in open(jsonl, encoding='utf-8', errors='replace'):
        try: d = json.loads(l)
        except Exception: continue
        if d.get('type') == 'assistant':
            for x in d['message'].get('content', []):
                if x.get('type') != 'tool_use': continue
                c[x['name']] += 1
                s = json.dumps(x['input'])
                if x['name'] == 'Bash':
                    if 'playwright' in s: notes['playwright_runs'] += 1
                    if 'vitest' in s or 'npm test' in s or 'npm run test' in s: notes['unit_test_runs'] += 1
                    if 'npm run build' in s or 'tsc' in s: notes['build_or_typecheck'] += 1
                if x['name'] == 'Read' and '.png' in s: notes['screenshots_viewed'] += 1
        if d.get('type') == 'result': denied = len(d.get('permission_denials') or [])
    return dict(c), dict(notes), denied

CC = os.environ.get('CCDIR', 'cc')  # cc = first rerun (user CLAUDE.md loaded), cc2 = clean rerun

if __name__ == '__main__':
  rows = []
  for f in sorted(glob.glob(os.path.join(B, CC, '*_*.json'))):
    chain = os.path.basename(f)[:-5]
    steps = json.load(open(f))
    prev = collections.defaultdict(lambda: collections.Counter())
    for s in steps:
        r = s.get('result') or {}
        mu = r.get('modelUsage') or {}
        step_cost = 0; tok = collections.Counter(); reported = 0
        for m, u in mu.items():
            d = {k: (u.get(k, 0) or 0) - prev[m][k] for k in KEYS}
            if d['inputTokens'] < 0 or d['outputTokens'] < 0: d = {k: u.get(k, 0) or 0 for k in KEYS}  # not cumulative after all
            step_cost += cost(m, d) if m in P else 0
            reported += d['costUSD']
            for k in KEYS[:-1]: tok[k] += d[k]
            prev[m] = collections.Counter({k: u.get(k, 0) or 0 for k in KEYS})
        model, kind = chain.split('_')[0], s['kind']
        tools, notes, denied = tools_of(os.path.join(B, CC, f"{chain}_{kind}.jsonl"))
        rows.append({'chain': chain, 'model': model, 'kind': kind, 'wall_s': s['wall_s'], 'api_ms': r.get('duration_api_ms'), 'turns': r.get('num_turns'),
                     'cost_est': round(step_cost, 4), 'cost_reported': round(reported, 4), 'tokens': dict(tok), 'diff': s.get('diff'),
                     'is_error': r.get('is_error'), 'denied': denied, 'tools': tools, 'checks': notes, 'reply': r.get('result') or ''})
  json.dump(rows, open(os.path.join(B, CC, 'steps.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
  for r in rows:
      t = r['tokens']
      print(f"{r['chain']:16} {r['kind']:6} ${r['cost_est']:.3f} (rep ${r['cost_reported']:.3f}) {r['wall_s']:5}s out={t.get('outputTokens',0):6} cr={t.get('cacheReadInputTokens',0):8} diff={r['diff']} denied={r['denied']} checks={r['checks']} err={r['is_error']}")
