// Who paid, balances, and settle-up transfers. All money is integer cents.
import { formatMoney, parsePrice, type Bill, type Breakdown, type Currency } from './bill'

export interface Transfer {
  from: string // person id
  to: string // person id
  cents: number
}

export interface PaymentCheck {
  /** Per payment row (same order as bill.payments): an error message, if any. */
  rowErrors: (string | undefined)[]
  /** Sum of the valid amounts. */
  paidCents: number
  /** Set when amounts are valid but don't add up to the bill total. */
  sumError?: string
  /** paidCents - total; negative means short. Only meaningful when every row is valid. */
  difference: number
  /** True when there is at least one payer, every row is valid, and the sum equals the total. */
  ok: boolean
}

/** Validates the payments against the bill total. */
export function checkPayments(bill: Bill, totalCents: number): PaymentCheck {
  const seen = new Set<string>()
  let paidCents = 0
  const rowErrors = bill.payments.map((p) => {
    if (!bill.people.some((x) => x.id === p.personId)) return 'Pick who paid.'
    if (seen.has(p.personId)) return 'This person is already listed as a payer.'
    seen.add(p.personId)
    const r = parsePrice(p.amount)
    if (!r.ok) return r.error === 'Enter a price.' ? 'Enter the amount paid.' : r.error.replace('Price', 'Amount')
    paidCents += r.value
    return undefined
  })
  const allValid = rowErrors.every((e) => e === undefined)
  const difference = paidCents - totalCents
  let sumError: string | undefined
  if (allValid && bill.payments.length > 0 && difference !== 0) {
    const m = (c: number) => formatMoney(c, bill.currency)
    sumError =
      `Payments add up to ${m(paidCents)}, but the bill total is ${m(totalCents)}. ` +
      (difference < 0 ? `${m(-difference)} is still unpaid.` : `That's ${m(difference)} too much.`)
  }
  return { rowErrors, paidCents, sumError, difference, ok: allValid && bill.payments.length > 0 && difference === 0 }
}

/** Net balance per person: what they paid minus what they owe. Positive = is owed money. */
export function computeBalances(bill: Bill, b: Breakdown): Map<string, number> {
  const bal = new Map<string, number>(b.shares.map((s) => [s.personId, -s.total]))
  for (const p of bill.payments) {
    const r = parsePrice(p.amount)
    if (r.ok && bal.has(p.personId)) bal.set(p.personId, bal.get(p.personId)! + r.value)
  }
  return bal
}

/** Above this many non-zero balances the exact search gets slow, so a greedy match is used. */
export const EXACT_LIMIT = 16

/**
 * Returns the fewest transfers that bring every balance to zero.
 *
 * The minimum number of transfers is (people with a non-zero balance) minus
 * (the largest number of groups they can be split into where each group's
 * balances sum to zero), because a zero-sum group of k people can always be
 * settled with k - 1 transfers and never with fewer. The grouping is found
 * exactly with a dynamic program over subsets; each group is then settled by
 * repeatedly matching its largest debtor with its largest creditor.
 * `order` (person ids) makes tie-breaks deterministic.
 */
export function minTransfers(balances: Map<string, number>, order: string[] = [...balances.keys()]): Transfer[] {
  const ids = order.filter((id) => (balances.get(id) ?? 0) !== 0)
  const sum = ids.reduce((a, id) => a + balances.get(id)!, 0)
  if (sum !== 0) throw new Error(`Balances must sum to zero (got ${sum}).`)
  if (ids.length === 0) return []

  const groups = ids.length <= EXACT_LIMIT ? zeroSumGroups(ids.map((id) => balances.get(id)!)).map((g) => g.map((i) => ids[i])) : [ids]
  const out: Transfer[] = []
  for (const g of groups) out.push(...greedySettle(g, balances, order))
  return out
}

/** Partitions indexes into the maximum number of zero-sum groups. */
function zeroSumGroups(vals: number[]): number[][] {
  const n = vals.length
  const full = (1 << n) - 1
  const sums = new Float64Array(1 << n)
  const dp = new Int8Array(1 << n)
  const pick = new Int8Array(1 << n)
  for (let mask = 1; mask <= full; mask++) {
    const low = 31 - Math.clz32(mask & -mask)
    sums[mask] = sums[mask & (mask - 1)] + vals[low]
    let best = -1
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i) && dp[mask ^ (1 << i)] > best) {
        best = dp[mask ^ (1 << i)]
        pick[mask] = i
      }
    }
    dp[mask] = best + (sums[mask] === 0 ? 1 : 0)
  }
  // Walk back from the full set; every zero-sum prefix closes a group.
  const groups: number[][] = []
  let cur: number[] = []
  for (let mask = full; mask; ) {
    const i = pick[mask]
    cur.push(i)
    mask ^= 1 << i
    if (sums[mask] === 0) {
      groups.push(cur.sort((a, b) => a - b))
      cur = []
    }
  }
  return groups.reverse()
}

function greedySettle(group: string[], balances: Map<string, number>, order: string[]): Transfer[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  const bal = new Map(group.map((id) => [id, balances.get(id)!]))
  const out: Transfer[] = []
  for (;;) {
    let debtor: string | undefined
    let creditor: string | undefined
    for (const id of group) {
      const v = bal.get(id)!
      const better = (cur: string | undefined, sign: 1 | -1) =>
        cur === undefined || sign * v > sign * bal.get(cur)! || (v === bal.get(cur)! && rank.get(id)! < rank.get(cur)!)
      if (v < 0 && better(debtor, -1)) debtor = id
      if (v > 0 && better(creditor, 1)) creditor = id
    }
    if (!debtor || !creditor) return out
    const cents = Math.min(-bal.get(debtor)!, bal.get(creditor)!)
    out.push({ from: debtor, to: creditor, cents })
    bal.set(debtor, bal.get(debtor)! + cents)
    bal.set(creditor, bal.get(creditor)! - cents)
  }
}

export type Settlement =
  | { status: 'no-payers' }
  | { status: 'invalid'; check: PaymentCheck }
  | { status: 'ok'; transfers: Transfer[] }

export function computeSettlement(bill: Bill, b: Breakdown): Settlement {
  if (bill.payments.length === 0) return { status: 'no-payers' }
  const check = checkPayments(bill, b.total)
  if (!check.ok) return { status: 'invalid', check }
  return {
    status: 'ok',
    transfers: minTransfers(
      computeBalances(bill, b),
      bill.people.map((p) => p.id),
    ),
  }
}

export function formatTransfer(t: Transfer, bill: Bill, currency: Currency = bill.currency): string {
  const name = (id: string) => bill.people.find((p) => p.id === id)?.name ?? '?'
  return `${name(t.from)} pays ${name(t.to)} ${formatMoney(t.cents, currency)}`
}
