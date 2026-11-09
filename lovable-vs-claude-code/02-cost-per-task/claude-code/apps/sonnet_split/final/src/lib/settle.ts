export interface Transfer {
  /** index of the person who pays */
  from: number
  /** index of the person who receives */
  to: number
  cents: number
}

/** Above this many people with a non-zero balance we fall back to a greedy match (at most n-1 transfers). */
const EXACT_LIMIT = 16

/**
 * Minimum list of transfers that brings every balance to zero.
 * balances[i] > 0: person i is owed money (paid more than their share);
 * balances[i] < 0: person i owes money. Balances must sum to 0.
 *
 * Splits the people into the largest possible number of independent groups that
 * each net to zero (exact subset DP); a group of k people needs k-1 transfers,
 * so more groups means fewer transfers.
 */
export function minTransfers(balances: number[]): Transfer[] {
  const idx = balances.map((_, i) => i).filter((i) => balances[i] !== 0)
  if (idx.length === 0) return []
  const m = idx.length
  let groups: number[][]
  if (m > EXACT_LIMIT) {
    groups = [idx]
  } else {
    const size = 1 << m
    const sum = Array.from({ length: size }, () => 0)
    for (let mask = 1; mask < size; mask++) {
      const low = 31 - Math.clz32(mask & -mask)
      sum[mask] = sum[mask & (mask - 1)] + balances[idx[low]]
    }
    // dp[mask] = max number of zero-sum groups obtainable by ordering the members of mask
    const dp = Array.from({ length: size }, () => 0)
    for (let mask = 1; mask < size; mask++) {
      let best = 0
      for (let i = 0; i < m; i++) if (mask & (1 << i)) best = Math.max(best, dp[mask ^ (1 << i)])
      dp[mask] = best + (sum[mask] === 0 ? 1 : 0)
    }
    // Rebuild one optimal ordering, then cut it wherever the running sum hits zero.
    const order: number[] = []
    let mask = size - 1
    while (mask) {
      const want = dp[mask] - (sum[mask] === 0 ? 1 : 0)
      for (let i = 0; i < m; i++) {
        if (mask & (1 << i) && dp[mask ^ (1 << i)] === want) {
          order.push(i)
          mask ^= 1 << i
          break
        }
      }
    }
    order.reverse()
    groups = []
    let cur: number[] = []
    let run = 0
    for (const i of order) {
      cur.push(idx[i])
      run += balances[idx[i]]
      if (run === 0) {
        groups.push(cur)
        cur = []
      }
    }
  }

  const out: Transfer[] = []
  for (const g of groups) {
    const debtors = g.filter((i) => balances[i] < 0).map((i) => ({ i, left: -balances[i] }))
    const creditors = g.filter((i) => balances[i] > 0).map((i) => ({ i, left: balances[i] }))
    debtors.sort((a, b) => b.left - a.left || a.i - b.i)
    creditors.sort((a, b) => b.left - a.left || a.i - b.i)
    let d = 0
    let c = 0
    while (d < debtors.length && c < creditors.length) {
      const amt = Math.min(debtors[d].left, creditors[c].left)
      out.push({ from: debtors[d].i, to: creditors[c].i, cents: amt })
      debtors[d].left -= amt
      creditors[c].left -= amt
      if (debtors[d].left === 0) d++
      if (creditors[c].left === 0) c++
    }
  }
  return out
}
