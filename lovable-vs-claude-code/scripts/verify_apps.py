# Re-run each Claude Code app's build, unit tests and browser tests after the run, outside the agent.
# usage: CCDIR=cc2 python verify_apps.py [app ...]   -> <CCDIR>/verify.json (merged per app)
import json, os, re, subprocess
from concurrent.futures import ThreadPoolExecutor
B = os.path.dirname(os.path.abspath(__file__))
CC = os.environ.get('CCDIR', 'cc2')
ENV = dict(os.environ); ENV['PATH'] = r'C:\nvm4w\nodejs;' + ENV.get('PATH', ''); ENV['CI'] = '1'
NPX = 'npx.cmd' if os.name == 'nt' else 'npx'
NPM = 'npm.cmd' if os.name == 'nt' else 'npm'

def sh(wd, *cmd, timeout=900):
    try:
        p = subprocess.run(list(cmd), cwd=wd, capture_output=True, text=True, encoding='utf-8', errors='replace', env=ENV, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT'

def num(rx, text):
    m = re.findall(rx, text)
    return int(m[-1]) if m else 0

def verify(name):
    wd = os.path.join(B, CC, name)
    out = {'app': name}
    rc, t = sh(wd, NPM, 'run', 'build'); out['build_ok'] = rc == 0
    scripts = json.load(open(os.path.join(wd, 'package.json'), encoding='utf-8')).get('scripts', {})
    has_unit = any(f.endswith(('.test.ts', '.test.tsx')) for r, _, fs in os.walk(os.path.join(wd, 'src')) for f in fs)
    if has_unit:  # the app's own test script when it has one (it scopes vitest away from e2e/), else vitest on src/
        rc, t = sh(wd, NPM, 'test') if 'test' in scripts else sh(wd, NPX, 'vitest', 'run', 'src/')
        line = next((l for l in reversed(t.splitlines()) if l.strip().startswith('Tests ')), '')
        out.update(unit_rc=rc, unit_passed=num(r'(\d+) passed', line), unit_failed=num(r'(\d+) failed', line), unit_cmd='npm test' if 'test' in scripts else 'vitest run src/')
    else:
        out.update(unit_rc=None, unit_passed=0, unit_failed=0)
    rc, t = sh(wd, NPX, 'playwright', 'test', '--reporter=line', timeout=1800)
    out.update(e2e_rc=rc, e2e_passed=num(r'(\d+) passed', t), e2e_failed=num(r'(\d+) failed', t), e2e_tail=t[-400:] if rc else '')
    print(out, flush=True)
    return out

if __name__ == '__main__':
    import sys
    apps = sys.argv[1:] or sorted(d for d in os.listdir(os.path.join(B, CC)) if os.path.isdir(os.path.join(B, CC, d)) and '_qa' not in d)
    with ThreadPoolExecutor(2) as ex:
        res = list(ex.map(verify, apps))
    vf = os.path.join(B, CC, 'verify.json')
    old = [r for r in (json.load(open(vf, encoding='utf-8')) if os.path.exists(vf) else []) if r['app'] not in apps]
    json.dump(sorted(old + res, key=lambda r: r['app']), open(vf, 'w', encoding='utf-8'), indent=1)
