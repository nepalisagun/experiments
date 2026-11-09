# Per-category means: Lovable credits (at $0.25 and $0.30) vs Claude Code API-equivalent dollars, and the same work on a Claude plan.
# usage: CCDIR=cc2 python summarize.py   (reads <CCDIR>/steps.json from analyze_cc.py and lov_steps.json)
import json, os, statistics as st
B = os.path.dirname(os.path.abspath(__file__))
CC = os.environ.get('CCDIR', 'cc2')
CREDIT, TOPUP = 0.25, 0.30
SUB = 45.3  # Claude Max 20x: API-equivalent dollars per plan dollar (phuryn/experiments/subscription-multipliers)
cc = json.load(open(os.path.join(B, CC, 'steps.json'), encoding='utf-8'))
lov = json.load(open(os.path.join(B, 'lov_steps.json'), encoding='utf-8'))
KINDS = [('build', 'build'), ('small', 'small'), ('medium', 'medium'), ('qa', 'q')]

def lov_vals(kind):
    return [r['credits'] for r in lov if (r['kind'] == kind if kind != 'qa' else str(r['kind']).startswith('q'))]

def cc_rows(model, kind, chain_suffix=''):
    out = []
    for r in cc:
        if r['model'] != model: continue
        if kind == 'qa':
            if r['chain'] != f'{model}_qa{chain_suffix}': continue
        elif r['kind'] != kind or '_qa' in r['chain']: continue
        out.append(r)
    return out

summary = {}
print(f"{'task':8} {'Lovable cr':>10} {'$0.25':>7} {'Sonnet':>7} {'Opus':>7}  {'L/S':>5} {'L/O':>5}  {'S sub':>7} {'O sub':>7}  L/Osub")
for kind, _ in KINDS:
    lv = lov_vals(kind)
    s = cc_rows('sonnet', kind); o = cc_rows('opus', kind)
    sv = [r['cost_est'] for r in s]; ov = [r['cost_est'] for r in o]
    L = st.mean(lv) * CREDIT; S = st.mean(sv); O = st.mean(ov)
    summary[kind] = {'n': [len(lv), len(sv), len(ov)], 'lov_credits': round(st.mean(lv), 2), 'lov_credits_range': [min(lv), max(lv)],
                     'lov_usd': round(L, 3), 'lov_usd_topup': round(st.mean(lv) * TOPUP, 3),
                     'sonnet_api': round(S, 3), 'sonnet_range': [round(min(sv), 2), round(max(sv), 2)], 'opus_api': round(O, 3), 'opus_range': [round(min(ov), 2), round(max(ov), 2)],
                     'sonnet_sub': round(S / SUB, 4), 'opus_sub': round(O / SUB, 4),
                     'sonnet_wall_s': round(st.mean(r['wall_s'] for r in s)), 'opus_wall_s': round(st.mean(r['wall_s'] for r in o)),
                     'lovable_over_opus_sub': round(L / (O / SUB), 1), 'lovable_over_sonnet_sub': round(L / (S / SUB), 1)}
    print(f"{kind:8} {st.mean(lv):10.2f} {L:7.2f} {S:7.2f} {O:7.2f}  {L/S:5.2f} {L/O:5.2f}  {S/SUB:7.3f} {O/SUB:7.3f}  {L/(O/SUB):5.1f}x")
for suf in ('', '_low', '_medium'):
    rows = cc_rows('opus', 'qa', suf)
    if rows:
        summary[f'opus_qa{suf}'] = {'n': len(rows), 'api': round(st.mean(r['cost_est'] for r in rows), 3), 'wall_s': round(st.mean(r['wall_s'] for r in rows)),
                                    'chars': round(st.mean(len(r['reply']) for r in rows)), 'tool_calls': round(st.mean(sum(r['tools'].values()) for r in rows), 1)}
        print(f'opus_qa{suf}', summary[f'opus_qa{suf}'])
rows = cc_rows('sonnet', 'qa')
summary['sonnet_qa'] = {'n': len(rows), 'api': round(st.mean(r['cost_est'] for r in rows), 3), 'wall_s': round(st.mean(r['wall_s'] for r in rows)),
                        'chars': round(st.mean(len(r['reply']) for r in rows)), 'tool_calls': round(st.mean(sum(r['tools'].values()) for r in rows), 1)}
print('sonnet_qa', summary['sonnet_qa'])
tot = {m: round(sum(r['cost_est'] for r in cc if r['model'] == m and (r['chain'] == f'{m}_qa' or '_qa' not in r['chain'])), 2) for m in ('sonnet', 'opus')}
summary['totals_20_tasks'] = {'lovable_credits': round(sum(r['credits'] for r in lov), 2), 'sonnet_api': tot['sonnet'], 'opus_api': tot['opus']}
print('totals', summary['totals_20_tasks'])
json.dump(summary, open(os.path.join(B, CC, 'summary.json'), 'w', encoding='utf-8'), indent=1)
