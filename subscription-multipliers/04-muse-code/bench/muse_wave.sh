# waves of W parallel turns (one adapter process each); stop at +5 weekly from first reading
TAG=$1; W=${2:-4}; OUTF=muse_img_$TAG.out; start=""; i=${3:-0}
while [ $i -lt 400 ]; do
  for j in $(seq 1 $W); do MUSE_TAG=$TAG MUSE_I=$i python muse_turn.py 2>&1 | grep -E "turn|error|Error" >> $OUTF & i=$((i+1)); sleep 3; done
  wait
  taskkill //F //FI "IMAGENAME eq muse-bin*" >/dev/null 2>&1
  w=$(grep -o "weekly=[0-9]*" $OUTF | tail -1 | cut -d= -f2)
  [ -z "$start" ] && start=$w
  [ -n "$w" ] && [ -n "$start" ] && [ $((w-start)) -ge 5 ] && break
done
echo "done $TAG $start -> $w" >> $OUTF
