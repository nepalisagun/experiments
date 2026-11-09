#!/bin/bash
# usage: run_cc.sh <workdir> <model> <promptfile> <outjson> [session-id-to-resume]
# Edits auto-accepted inside the scratch app; Bash limited to build/test/install commands.
set -u
export PATH="/c/nvm4w/nodejs:$PATH"
export ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' <WORKDIR>/.env | cut -d= -f2- | tr -d '\"\r')"
cd "$1"
R=""; [ -n "${5:-}" ] && R="--resume $5"
claude -p "$(cat "$3")" --model "$2" --output-format json --permission-mode acceptEdits --setting-sources project,local \
  --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Bash(npm run build)" "Bash(npx tsc:*)" "Bash(npm install:*)" "Bash(npm i:*)" "Bash(npx vitest:*)" "Bash(npm test:*)" "Bash(npm run test:*)" \
  $R > "$4" 2> "$4.err"
python -c "import json,sys; d=json.load(open(sys.argv[1])); print(sys.argv[1].split('/')[-1], 'cost', d.get('total_cost_usd'), 'turns', d.get('num_turns'), 'ms', d.get('duration_ms'), 'sid', d.get('session_id')); print(json.dumps(d.get('modelUsage') or d.get('usage'))[:700]); print((d.get('result') or '')[:700])" "$4"
