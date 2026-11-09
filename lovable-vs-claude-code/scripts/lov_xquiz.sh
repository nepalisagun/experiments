#!/bin/bash
D=<BENCH>/bench
u(){ grep "^$1 " $D/lov/projects.txt | head -1 | cut -d' ' -f2; }
bash $D/lov_chain2.sh notes xsmall $(u notes)
bash $D/lov_chain2.sh split xsmall $(u split)
bash $D/lov_chain2.sh timer xmedium $(u timer)
bash $D/lov_chain2.sh budget xmedium $(u budget)
echo "$(date +%H:%M:%S) XQUIZ DONE" >> $D/lov/progress.log
