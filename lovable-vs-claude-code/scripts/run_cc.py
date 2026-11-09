# Claude Code side of the Lovable comparison: headless runs on the subscription login (no API key),
# no MCP connectors, user settings not loaded. Each app = build -> small -> medium in one resumed session.
# usage: python run_cc.py [chain-filter-substring ...]
import json, os, shutil, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor

B = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(B, 'tasks.json'), encoding='utf-8'))
CLAUDE = r'<HOME>\.local\bin\claude.exe' if os.path.exists(r'<HOME>\.local\bin\claude.exe') else r'<HOME>\.local\bin\claude'
MODELS = {'sonnet': 'claude-sonnet-5-5', 'opus': 'claude-opus-5-5'}
ALLOWED = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Task',
           'Bash(npm run:*)', 'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(npm test:*)', 'Bash(npm ls:*)',
           'Bash(npx vitest:*)', 'Bash(npx playwright:*)', 'Bash(npx tsc:*)', 'Bash(npx vite:*)', 'Bash(npx oxlint:*)',
           'Bash(node:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(grep:*)',
           'Bash(find:*)', 'Bash(mkdir:*)', 'Bash(cd:*)', 'Bash(git:*)', 'Bash(rm -rf shots:*)']
ENV = {k: v for k, v in os.environ.items() if k != 'ANTHROPIC_API_KEY'}
ENV['ENABLE_CLAUDEAI_MCP_SERVERS'] = 'false'
ENV['PATH'] = r'C:\nvm4w\nodejs;' + ENV.get('PATH', '')
CC = os.environ.get('CCDIR', 'cc')
LOG = os.path.join(B, CC, 'progress.log')
# Keep the user-level ~/.claude/CLAUDE.md (personal notes) out of the runs; the project's own CLAUDE.md still loads.
CLEAN = json.dumps({'claudeMdExcludes': [os.path.expanduser('~/.claude/CLAUDE.md').replace(os.sep, '/')]})
lock = threading.Lock()

def log(msg):
    line = time.strftime('%H:%M:%S ') + msg
    with lock:
        with open(LOG, 'a', encoding='utf-8') as f: f.write(line + '\n')
    print(line, flush=True)

def git(wd, *a):
    return subprocess.run(['git', '-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'core.autocrlf=false', *a],
                          cwd=wd, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout

def claude(wd, model, prompt, out, sid=None):
    cmd = [CLAUDE, '-p', '--model', MODELS[model], '--output-format', 'stream-json', '--verbose',
           '--permission-mode', 'acceptEdits', '--setting-sources', 'project,local',
           '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--settings', CLEAN, '--allowedTools', *ALLOWED]
    if os.environ.get('EFFORT'): cmd += ['--effort', os.environ['EFFORT']]
    if sid: cmd += ['--resume', sid]
    t0 = time.time()
    with open(out, 'w', encoding='utf-8') as f:
        p = subprocess.run(cmd, cwd=wd, input=prompt, stdout=f, stderr=subprocess.STDOUT, text=True, encoding='utf-8', env=ENV, timeout=3600)
    res = None
    for line in open(out, encoding='utf-8', errors='replace'):
        try: d = json.loads(line)
        except Exception: continue
        if d.get('type') == 'result': res = d
    return res, time.time() - t0, p.returncode

def numstat(wd, rev):
    add = dele = files = 0
    for l in git(wd, 'diff', '--numstat', rev, 'HEAD').splitlines():
        a, d, f = l.split('\t', 2)
        if f.endswith('package-lock.json') or a == '-': continue
        add += int(a); dele += int(d); files += 1
    return {'files': files, 'added': add, 'deleted': dele}

def app_chain(model, app):
    name = f'{model}_{app["id"]}'
    wd = os.path.join(B, CC, name)
    port = 5200 + list(MODELS).index(model) * 10 + [a['id'] for a in T['apps']].index(app['id'])
    if os.path.exists(wd): shutil.rmtree(wd)
    shutil.copytree(os.path.join(B, 'base2'), wd)
    for fn in ('vite.config.ts', 'playwright.config.ts', 'CLAUDE.md'):
        p = os.path.join(wd, fn); s = open(p, encoding='utf-8').read().replace('__PORT__', str(port)); open(p, 'w', encoding='utf-8', newline='\n').write(s)
    git(wd, 'add', '-A'); git(wd, 'commit', '-qm', 'starter port')
    prompts = [('build', app['build'] + '\n\n' + T['common_build'] + '\n\n' + T['verify_full']),
               ('small', app['small'] + '\n\n' + T['verify_small']),
               ('medium', app['medium'] + '\n\n' + T['verify_full'])]
    sid, steps = None, []
    for kind, prompt in prompts:
        log(f'{name} {kind} start')
        before = git(wd, 'rev-parse', 'HEAD').strip()
        res, wall, rc = claude(wd, model, prompt, os.path.join(B, CC, f'{name}_{kind}.jsonl'), sid)
        git(wd, 'add', '-A'); git(wd, 'commit', '-qm', kind)
        st = numstat(wd, before)
        sid = (res or {}).get('session_id') or sid
        steps.append({'kind': kind, 'rc': rc, 'wall_s': round(wall), 'diff': st, 'result': res})
        log(f'{name} {kind} done rc={rc} wall={wall:.0f}s cum_cost={(res or {}).get("total_cost_usd")} diff={st} err={(res or {}).get("is_error")}')
        if not res: break
    json.dump(steps, open(os.path.join(B, CC, f'{name}.json'), 'w'), indent=1)

def qa_chain(model):
    name = f'{model}_qa' + (f"_{os.environ['EFFORT']}" if os.environ.get('EFFORT') else '')
    wd = os.path.join(B, CC, name)
    if os.path.exists(wd): shutil.rmtree(wd, ignore_errors=True)
    os.makedirs(wd)
    qa = T['repo_qa']; sid, steps = None, []
    for i, q in enumerate(qa['questions']):
        prompt = (qa['first_prefix'] if i == 0 else qa['next_prefix']) + q
        log(f'{name} q{i+1} start')
        res, wall, rc = claude(wd, model, prompt, os.path.join(B, CC, f'{name}_q{i+1}.jsonl'), sid)
        sid = (res or {}).get('session_id') or sid
        steps.append({'kind': f'q{i+1}', 'rc': rc, 'wall_s': round(wall), 'result': res})
        log(f'{name} q{i+1} done rc={rc} wall={wall:.0f}s cum_cost={(res or {}).get("total_cost_usd")} err={(res or {}).get("is_error")}')
        if not res: break
    json.dump(steps, open(os.path.join(B, CC, f'{name}.json'), 'w'), indent=1)

if __name__ == '__main__':
    os.makedirs(os.path.join(B, CC), exist_ok=True)
    flt = sys.argv[1:]
    jobs = [(app_chain, (m, a), f'{m}_{a["id"]}') for a in T['apps'] for m in MODELS] + [(qa_chain, (m,), f'{m}_qa') for m in MODELS]
    jobs = [j for j in jobs if not flt or any(x in j[2] for x in flt)]
    with ThreadPoolExecutor(int(os.environ.get('WORKERS', '5'))) as ex:
        futs = [ex.submit(f, *a) for f, a, _ in jobs]
        for fu in futs:
            try: fu.result()
            except Exception as e: log(f'CHAIN ERROR {e!r}')
    log('ALL DONE')
