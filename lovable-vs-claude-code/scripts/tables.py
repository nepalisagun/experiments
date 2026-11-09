# Markdown tables for the experiment READMEs, straight from the data files.
# usage: CCDIR=cc2 python tables.py > tables.md
import json, os, statistics as st
B = os.path.dirname(os.path.abspath(__file__))
CC = os.environ.get('CCDIR', 'cc2')
CREDIT, TOPUP, SUB = 0.25, 0.30, 45.3
steps = json.load(open(os.path.join(B, CC, 'steps.json'), encoding='utf-8'))
lov = json.load(open(os.path.join(B, 'lov_steps.json'), encoding='utf-8'))
T = json.load(open(os.path.join(B, 'tasks.json'), encoding='utf-8'))
APPS = [a['id'] for a in T['apps']]
NAMES = {'timer': 'Pomodoro timer', 'split': 'Bill splitter', 'kanban': 'Kanban board', 'notes': 'Markdown notes', 'budget': 'Budget tracker'}
KIND = {'build': 'Build', 'small': 'Small edit', 'medium': 'Medium feature'}
def L(app, kind): return next(r for r in lov if r['app'] == app and r['kind'] == kind)
def C(model, app, kind): return next(r for r in steps if r['chain'] == f'{model}_{app}' and r['kind'] == kind)
def mins(s): return f'{s/60:.1f} min' if s >= 120 else f'{round(s)} s'
def rng(v, f='{:.2f}'): return f'{f.format(min(v))}–{f.format(max(v))}'

print('### Means by task type (5 tasks each)\n')
print('| Task | Lovable credits | Lovable $ at $0.25 / $0.30 | Sonnet 5.5, API $ | Opus 5.5, API $ | Sonnet 5.5 on the plan | Opus 5.5 on the plan | Lovable ÷ Opus on the plan |')
print('|---|---|---|---|---|---|---|---|')
for k in ('build', 'small', 'medium'):
    lc = [L(a, k)['credits'] for a in APPS]; s = [C('sonnet', a, k)['cost_est'] for a in APPS]; o = [C('opus', a, k)['cost_est'] for a in APPS]
    lm = st.mean(lc)
    print(f'| {KIND[k]} | {lm:.2f} [{rng(lc)}] | ${lm*CREDIT:.2f} / ${lm*TOPUP:.2f} | ${st.mean(s):.2f} [{rng(s)}] | ${st.mean(o):.2f} [{rng(o)}] | ${st.mean(s)/SUB:.3f} | ${st.mean(o)/SUB:.3f} | {lm*CREDIT/(st.mean(o)/SUB):.0f}× |')

print('\n### Every task\n')
print('| App | Task | Lovable credits | Lovable time | Sonnet $ | Sonnet time | Sonnet lines changed | Opus $ | Opus time | Opus lines changed |')
print('|---|---|---|---|---|---|---|---|---|---|')
for a in APPS:
    for k in ('build', 'small', 'medium'):
        l, s, o = L(a, k), C('sonnet', a, k), C('opus', a, k)
        ln = lambda r: f"+{r['diff']['added']} −{r['diff']['deleted']} in {r['diff']['files']} files"
        print(f"| {NAMES[a]} | {KIND[k]} | {l['credits']:.2f} | {mins(l['time_s'])} | ${s['cost_est']:.2f} | {mins(s['wall_s'])} | {ln(s)} | ${o['cost_est']:.2f} | {mins(o['wall_s'])} | {ln(o)} |")

print('\n### Where Claude Code\'s tokens go (mean per task)\n')
print('| Model | Task | Output tokens | Cache reads | Cache writes | Uncached input | Tool calls | Browser test runs | Screenshots opened |')
print('|---|---|---|---|---|---|---|---|---|')
for m in ('sonnet', 'opus'):
    for k in ('build', 'small', 'medium'):
        rs = [C(m, a, k) for a in APPS]
        t = lambda key: st.mean(r['tokens'].get(key, 0) for r in rs)
        w = st.mean(r['tokens'].get('cacheCreationEphemeral1hInputTokens', 0) + r['tokens'].get('cacheCreationEphemeral5mInputTokens', 0) for r in rs)
        print(f"| {m.title()} 5.5 | {KIND[k]} | {t('outputTokens'):,.0f} | {t('cacheReadInputTokens'):,.0f} | {w:,.0f} | {t('inputTokens'):,.0f} | {st.mean(sum(r['tools'].values()) for r in rs):.0f} | {st.mean(r['checks'].get('playwright_runs', 0) for r in rs):.1f} | {st.mean(r['checks'].get('screenshots_viewed', 0) for r in rs):.1f} |")

vf = os.path.join(B, CC, 'verify.json')
if os.path.exists(vf):
    print('\n### Re-run after the session, outside the agent\n')
    print('| App | Build | Unit tests | Browser tests |')
    print('|---|---|---|---|')
    for r in sorted(json.load(open(vf, encoding='utf-8')), key=lambda r: (r['app'].split('_')[0] != 'sonnet', APPS.index(r['app'].split('_')[1]))):
        m, a = r['app'].split('_')
        u = f"{r['unit_passed']} passed" + (f", {r['unit_failed']} failed" if r['unit_failed'] else '') if r['unit_rc'] is not None else 'none written'
        e = f"{r['e2e_passed']} passed" + (f", {r['e2e_failed']} failed" if r['e2e_failed'] else '')
        print(f"| {m.title()} 5.5, {NAMES[a].lower()} | {'passes' if r['build_ok'] else 'FAILS'} | {u} | {e} |")

print('\n### Repo questions: cost and size per question\n')
qa = {n: [r for r in steps if r['chain'] == n] for n in ('sonnet_qa', 'opus_qa', 'opus_qa_low', 'opus_qa_medium')}
lq = [r for r in lov if r['app'] == 'qa']
lovq = [json.load(open(os.path.join(B, 'lov', f'qa_q{i}.json'), encoding='utf-8')) for i in range(1, 6)]
print('| Question | Lovable | Sonnet 5.5 | Opus 5.5, default effort | Opus 5.5, medium | Opus 5.5, low |')
print('|---|---|---|---|---|---|')
for i in range(5):
    cells = [f"{lq[i]['credits']:.2f} cr = ${lq[i]['credits']*CREDIT:.2f}, {mins(lq[i]['time_s'])}, {len(lovq[i]['reply']):,} chars"]
    for n in ('sonnet_qa', 'opus_qa', 'opus_qa_medium', 'opus_qa_low'):
        r = qa[n][i] if len(qa[n]) > i else None
        cells.append(f"${r['cost_est']:.2f}, {mins(r['wall_s'])}, {len(r['reply']):,} chars, {sum(r['tools'].values())} tool calls" if r else '–')
    print(f'| Q{i+1} | ' + ' | '.join(cells) + ' |')
cells = [f"{st.mean(r['credits'] for r in lq):.2f} cr = ${st.mean(r['credits'] for r in lq)*CREDIT:.2f}, {mins(st.mean(r['time_s'] for r in lq))}, {st.mean(len(x['reply']) for x in lovq):,.0f} chars"]
for n in ('sonnet_qa', 'opus_qa', 'opus_qa_medium', 'opus_qa_low'):
    rs = qa[n]
    cells.append(f"${st.mean(r['cost_est'] for r in rs):.2f}, {mins(st.mean(r['wall_s'] for r in rs))}, {st.mean(len(r['reply']) for r in rs):,.0f} chars, {st.mean(sum(r['tools'].values()) for r in rs):.1f} tool calls" if rs else '–')
print('| **Mean** | ' + ' | '.join(cells) + ' |')

gk = os.path.join(B, 'grading', 'key.json')
if os.path.exists(gk) and all(os.path.exists(os.path.join(B, 'grading', f'q{i}_grades.json')) for i in range(1, 6)):
    key = json.load(open(gk, encoding='utf-8'))
    sets = ['lovable', 'sonnet', 'opus_default', 'opus_medium', 'opus_low']
    label = {'lovable': 'Lovable', 'sonnet': 'Sonnet 5.5', 'opus_default': 'Opus 5.5, default', 'opus_medium': 'Opus 5.5, medium', 'opus_low': 'Opus 5.5, low'}
    sc = {s: {'c': [], 'k': [], 'u': [], 'hi': 0} for s in sets}
    rows = {s: [] for s in sets}
    for i in range(1, 6):
        g = json.load(open(os.path.join(B, 'grading', f'q{i}_grades.json'), encoding='utf-8'))
        for lab, v in g.items():
            s = key[f'q{i}{lab}']
            sc[s]['c'].append(v['correctness']); sc[s]['k'].append(v['completeness']); sc[s]['u'].append(v['usefulness'])
            sc[s]['hi'] += sum(1 for e in v.get('errors', []) if e.get('severity') == 'high')
            rows[s].append(f"{v['correctness']}/{v['completeness']}/{v['usefulness']}")
    print('\n### Blind grades (correctness / completeness / usefulness, 0–10)\n')
    print('| Answer set | Q1 | Q2 | Q3 | Q4 | Q5 | Mean correctness | Mean completeness | Mean usefulness | High-severity errors |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for s in sets:
        print(f"| {label[s]} | " + ' | '.join(rows[s]) + f" | {st.mean(sc[s]['c']):.1f} | {st.mean(sc[s]['k']):.1f} | {st.mean(sc[s]['u']):.1f} | {sc[s]['hi']} |")
    json.dump({s: {'correctness': round(st.mean(sc[s]['c']), 2), 'completeness': round(st.mean(sc[s]['k']), 2), 'usefulness': round(st.mean(sc[s]['u']), 2), 'high_errors': sc[s]['hi']} for s in sets},
              open(os.path.join(B, 'grading', 'means.json'), 'w', encoding='utf-8'), indent=1)
