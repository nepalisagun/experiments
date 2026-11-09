# Raw-API reference panel for the tier fingerprint: obscure-fact quiz + wrong-weekday note, several samples per model.
import json, os, re, sys, concurrent.futures as cf
import anthropic
B = os.path.dirname(os.path.abspath(__file__))
env = dict(l.split('=', 1) for l in open(r'<WORKDIR>\.env', encoding='utf-8').read().splitlines() if '=' in l and not l.lstrip().startswith('#'))
client = anthropic.Anthropic(api_key=env['ANTHROPIC_API_KEY'].strip().strip('"').strip("'"))
P = json.load(open(os.path.join(B, os.environ.get('PROBES', 'probes.json')), encoding='utf-8'))
quiz = P['quiz_intro'] + '\n\n' + '\n'.join(f'{i+1}. {q}' for i, (q, a) in enumerate(P['quiz']))
0 if os.environ.get('PROBES') else open(os.path.join(B, 'lov', 'prompts', 'probe_quiz.txt'), 'w', encoding='utf-8', newline='\n').write(quiz)
0 if os.environ.get('PROBES') else open(os.path.join(B, 'lov', 'prompts', 'probe_note.txt'), 'w', encoding='utf-8', newline='\n').write(P['note'] + "\n\nDon't change any files.")
MODELS = sys.argv[1].split(',') if len(sys.argv) > 1 else ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']
N = int(os.environ.get('N', '3'))
def ask(m, kind, k):
    text = quiz if kind == 'quiz' else P['note']
    try:
        r = client.messages.create(model=m, max_tokens=8000, messages=[{'role': 'user', 'content': text}])
        return {'model': m, 'kind': kind, 'k': k, 'answer': ''.join(b.text for b in r.content if b.type == 'text'), 'usage': r.usage.model_dump()}
    except Exception as e:
        return {'model': m, 'kind': kind, 'k': k, 'answer': f'ERROR {e}'}
jobs = [(m, kind, k) for m in MODELS for kind in os.environ.get('KINDS', 'quiz,note').split(',') for k in range(N)]
with cf.ThreadPoolExecutor(8) as ex: res = list(ex.map(lambda a: ask(*a), jobs))
out = os.path.join(B, os.environ.get('OUT', 'fp_quiz_panel.json'))
old = json.load(open(out, encoding='utf-8')) if os.path.exists(out) else []
json.dump(old + res, open(out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('done', len(res), 'errors', sum(r['answer'].startswith('ERROR') for r in res))
