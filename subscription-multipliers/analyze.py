"""Subscription multipliers from meter readings + per-call token logs.

Inputs per run folder: readings.csv (utc, weekly_pct) and calls.csv (utc, ..., list_cost_usd).
Method:
  * Only FULL tick-to-tick steps count; the first partial percent before the first tick and the
    tail after the last tick are dropped (a run starts somewhere inside a percent).
  * A tick happens between the last reading at the old value (lo) and the first reading at the
    new value (hi). For a step from tick k to tick k+1:
        floor   = spend(hi_k  .. lo_k+1)   (certainly inside the step)
        ceiling = spend(lo_k  .. hi_k+1)   (certainly covers the step)
    divided by the points between the ticks. The same is computed for the whole span.
  * If every point is worth the same, the true value lies inside every bracket:
        [max(all floors), min(all ceilings)]  = the measurement-uncertainty interval.
    If max floor > min ceiling the brackets do not intersect: per-point value is not constant
    and the spread of steps is reported instead.
  * Multiplier = $/point x 100 points x (30.4375 / 7) weeks per month / monthly price.
Readings from parallel processes can arrive out of order; they are made monotone (a reading
lower than one already seen is a stale observation and is dropped).
usage: python analyze.py <run_folder> <monthly_price_usd> [cost_column]
"""
import bisect, csv, datetime, sys

def ts(s): return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def load(folder, cost_col="list_cost_usd"):
    rd = sorted((ts(r["utc"]), float(r["weekly_pct"])) for r in csv.DictReader(open(f"{folder}/readings.csv")))
    mono, mx = [], -1.0
    for t, v in rd:
        if v >= mx: mono.append((t, v)); mx = v
    calls = sorted((ts(r["utc"]), float(r[cost_col])) for r in csv.DictReader(open(f"{folder}/calls.csv")))
    return mono, calls

def brackets(readings, calls):
    t = [c[0] for c in calls]; cum = [0.0]
    for c in calls: cum.append(cum[-1] + c[1])
    spend = lambda a, b: cum[bisect.bisect_right(t, b)] - cum[bisect.bisect_right(t, a)]
    ticks = [(a[0], b[0], b[1]) for a, b in zip(readings, readings[1:]) if b[1] != a[1]]
    steps = []
    for (lo0, hi0, v0), (lo1, hi1, v1) in zip(ticks, ticks[1:]):
        pts = v1 - v0
        steps.append(dict(start_utc=datetime.datetime.fromtimestamp(hi0, datetime.UTC).isoformat(timespec="seconds"),
                          from_pct=v0, to_pct=v1, floor=spend(hi0, lo1) / pts, ceiling=spend(lo0, hi1) / pts))
    span = None
    if len(ticks) >= 2:
        pts = ticks[-1][2] - ticks[0][2]
        span = dict(from_pct=ticks[0][2], to_pct=ticks[-1][2],
                    floor=spend(ticks[0][1], ticks[-1][0]) / pts, ceiling=spend(ticks[0][0], ticks[-1][1]) / pts)
    return steps, span

if __name__ == "__main__":
    folder, price = sys.argv[1], float(sys.argv[2])
    col = sys.argv[3] if len(sys.argv) > 3 else "list_cost_usd"
    k = 100 * 30.4375 / 7 / price
    readings, calls = load(folder, col)
    steps, span = brackets(readings, calls)
    print(f"{folder}: {len(readings)} readings, {len(calls)} calls, {len(steps)} full steps")
    for s in steps:
        print(f"  step {s['from_pct']:g}->{s['to_pct']:g}% from {s['start_utc']}: ${s['floor']:.2f}-${s['ceiling']:.2f}/pt = {s['floor']*k:.1f}x-{s['ceiling']*k:.1f}x")
    if span:
        print(f"  span {span['from_pct']:g}->{span['to_pct']:g}%: ${span['floor']:.2f}-${span['ceiling']:.2f}/pt = {span['floor']*k:.1f}x-{span['ceiling']*k:.1f}x")
        lo = max([s["floor"] for s in steps] + [span["floor"]]); hi = min([s["ceiling"] for s in steps] + [span["ceiling"]])
        if lo <= hi: print(f"  max floor / min ceiling: {lo*k:.1f}x - {hi*k:.1f}x  (brackets intersect)")
        else: print(f"  max floor {lo*k:.1f}x > min ceiling {hi*k:.1f}x: brackets do NOT intersect, per-point value not constant;"
                    f" steps span {min(s['floor'] for s in steps)*k:.1f}x-{max(s['ceiling'] for s in steps)*k:.1f}x")
