export type Currency = 'USD' | 'EUR' | 'PLN'
export const CURRENCIES: Currency[] = ['USD', 'EUR', 'PLN']

export interface Person { id: string; name: string }
export interface Item { id: string; name: string; cents: number; people: string[] }

/** Someone who paid part of the bill. `amount` is the raw text typed by the user. */
export interface Payer { personId: string; amount: string }

export interface Bill {
  people: Person[]
  items: Item[]
  payers: Payer[]
  taxInput: string
  tipInput: string
  currency: Currency
}

export const DEFAULT_TIP = '18'

export const emptyBill = (): Bill => ({ people: [], items: [], payers: [], taxInput: '', tipInput: DEFAULT_TIP, currency: 'USD' })

/** Split `total` cents over `weights` so the parts sum exactly to `total` (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (weights.length === 0) return []
  if (sum === 0) {
    // no basis: split evenly
    return allocate(total, weights.map(() => 1))
  }
  const base = weights.map((w) => Math.floor((total * w) / sum))
  const rem = weights.map((w, i) => ({ i, r: (total * w) % sum }))
  let left = total - base.reduce((a, b) => a + b, 0)
  rem.sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of rem) {
    if (left <= 0) break
    base[i]++
    left--
  }
  return base
}

const NUM = /^(\d+\.?\d*|\.\d+)$/

/** Parse a money string ("12.50" or "12,5") to cents. `label` names the field in messages. */
function parseMoney(raw: string, label: string, emptyMsg: string): { cents?: number; error?: string } {
  const s = raw.trim().replace(',', '.')
  if (s === '') return { error: emptyMsg }
  if (s.startsWith('-')) return { error: `${label} cannot be negative.` }
  if (!NUM.test(s)) return { error: `${label} must be a number, e.g. 12.50.` }
  if (/\.\d{3,}/.test(s)) return { error: `${label} can have at most 2 decimal places.` }
  const [w, f = ''] = s.split('.')
  const cents = Number(w || '0') * 100 + Number(f.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > 10_000_000_000) return { error: `${label} is too large.` }
  if (cents === 0) return { error: `${label} must be greater than zero.` }
  return { cents }
}

export const parsePrice = (raw: string) => parseMoney(raw, 'Price', 'Enter a price.')
export const parseAmount = (raw: string) => parseMoney(raw, 'Amount', 'Enter an amount.')

/** Parse a percentage field. Empty means 0. */
export function parsePercent(raw: string, label: string): { pct: number; error?: string } {
  const s = raw.trim().replace(',', '.')
  if (s === '') return { pct: 0 }
  if (s.startsWith('-')) return { pct: 0, error: `${label} cannot be negative.` }
  if (!NUM.test(s)) return { pct: 0, error: `${label} must be a number, e.g. 8.5.` }
  const pct = Number(s)
  if (pct > 100) return { pct: 0, error: `${label} cannot be more than 100%.` }
  return { pct }
}

export interface PersonResult {
  id: string
  name: string
  subtotal: number
  tax: number
  tip: number
  total: number
}

export interface Result {
  people: PersonResult[]
  subtotal: number
  tax: number
  tip: number
  total: number
  unassigned: Item[]
  taxError?: string
  tipError?: string
}

export const displayName = (p: Person, idx: number) => p.name.trim() || `Person ${idx + 1}`

export function calculate(bill: Bill): Result {
  const { people, items } = bill
  const ids = new Set(people.map((p) => p.id))
  const subs = new Map(people.map((p) => [p.id, 0]))
  const unassigned: Item[] = []
  for (const item of items) {
    const sharers = item.people.filter((id) => ids.has(id))
    if (sharers.length === 0) { unassigned.push(item); continue }
    allocate(item.cents, sharers.map(() => 1)).forEach((c, i) => subs.set(sharers[i], subs.get(sharers[i])! + c))
  }
  const subtotals = people.map((p) => subs.get(p.id)!)
  const subtotal = subtotals.reduce((a, b) => a + b, 0)
  const taxP = parsePercent(bill.taxInput, 'Tax')
  const tipP = parsePercent(bill.tipInput, 'Tip')
  const tax = Math.round((subtotal * taxP.pct) / 100)
  const tip = Math.round((subtotal * tipP.pct) / 100)
  const taxes = subtotal ? allocate(tax, subtotals) : subtotals.map(() => 0)
  const tips = subtotal ? allocate(tip, subtotals) : subtotals.map(() => 0)
  const rows = people.map((p, i) => ({
    id: p.id,
    name: displayName(p, i),
    subtotal: subtotals[i],
    tax: taxes[i],
    tip: tips[i],
    total: subtotals[i] + taxes[i] + tips[i],
  }))
  return { people: rows, subtotal, tax, tip, total: subtotal + tax + tip, unassigned, taxError: taxP.error, tipError: tipP.error }
}

const LOCALES: Record<Currency, string> = { USD: 'en-US', EUR: 'de-DE', PLN: 'pl-PL' }

export function formatMoney(cents: number, currency: Currency): string {
  return new Intl.NumberFormat(LOCALES[currency], { style: 'currency', currency }).format(cents / 100)
}

export interface PayerRow { error?: string; cents: number }

export interface PaymentCheck {
  rows: PayerRow[]
  paid: number
  total: number
  /** Set when every row is valid but the payments do not add up to the bill total. */
  sumError?: string
  /** True when payers exist, every row is valid and the payments equal the bill total. */
  ok: boolean
}

export function checkPayments(bill: Bill, r: Result): PaymentCheck {
  const seen = new Set<string>()
  const rows = bill.payers.map((p): PayerRow => {
    if (!bill.people.some((x) => x.id === p.personId)) return { error: 'Pick who paid.', cents: 0 }
    if (seen.has(p.personId)) return { error: 'This person is already listed as a payer.', cents: 0 }
    seen.add(p.personId)
    const a = parseAmount(p.amount)
    return a.error ? { error: a.error, cents: 0 } : { cents: a.cents! }
  })
  const paid = rows.reduce((s, x) => s + x.cents, 0)
  const total = r.total
  const rowsOk = rows.every((x) => !x.error)
  let sumError: string | undefined
  if (rows.length && rowsOk && total > 0 && paid !== total) {
    const m = (c: number) => formatMoney(c, bill.currency)
    sumError = paid < total
      ? `Payments add up to ${m(paid)}, which is ${m(total - paid)} less than the bill total of ${m(total)}.`
      : `Payments add up to ${m(paid)}, which is ${m(paid - total)} more than the bill total of ${m(total)}.`
  }
  return { rows, paid, total, sumError, ok: rows.length > 0 && rowsOk && total > 0 && paid === total }
}

export interface Transfer { from: string; to: string; cents: number }

const MAX_EXACT = 16

/** Split people with non-zero balances into the largest number of groups that each sum to zero. */
function bestPartition(nz: { id: string; cents: number }[]): { id: string; cents: number }[][] {
  const n = nz.length
  const size = 1 << n
  const sum = new Float64Array(size)
  const dp = new Int16Array(size)
  const pred = new Int8Array(size).fill(-1)
  for (let mask = 1; mask < size; mask++) {
    const low = 31 - Math.clz32(mask & -mask)
    sum[mask] = sum[mask & (mask - 1)] + nz[low].cents
    let best = -1
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue
      const v = dp[mask ^ (1 << i)]
      if (v > best) { best = v; pred[mask] = i }
    }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0)
  }
  const order: number[] = []
  for (let mask = size - 1; mask; mask ^= 1 << pred[mask]) order.push(pred[mask])
  order.reverse()
  const groups: { id: string; cents: number }[][] = []
  let cur: { id: string; cents: number }[] = []
  let run = 0
  for (const i of order) {
    cur.push(nz[i]); run += nz[i].cents
    if (run === 0) { groups.push(cur); cur = [] }
  }
  return groups
}

/** Pay off one group greedily (largest debtor to largest creditor). A zero-sum group of k people needs at most k-1 transfers. */
function settleGroup(group: { id: string; cents: number }[]): Transfer[] {
  const cr = group.filter((g) => g.cents > 0).map((g) => ({ ...g }))
  const db = group.filter((g) => g.cents < 0).map((g) => ({ ...g }))
  const out: Transfer[] = []
  while (cr.length && db.length) {
    cr.sort((a, b) => b.cents - a.cents)
    db.sort((a, b) => a.cents - b.cents)
    const c = cr[0], d = db[0]
    const amt = Math.min(c.cents, -d.cents)
    out.push({ from: d.id, to: c.id, cents: amt })
    c.cents -= amt; d.cents += amt
    if (c.cents === 0) cr.shift()
    if (d.cents === 0) db.shift()
  }
  return out
}

/**
 * Fewest transfers that settle `balances` (positive = is owed, negative = owes; must sum to zero).
 * Minimising transfers means finding the most zero-sum subgroups (NP-hard in general), so up to
 * 16 people with a non-zero balance are solved exactly by bitmask DP; beyond that it falls back to
 * a greedy settle, which is correct but may use a few more transfers than the minimum.
 */
export function minTransfers(balances: { id: string; cents: number }[]): Transfer[] {
  const nz = balances.filter((b) => b.cents !== 0)
  if (nz.length === 0) return []
  const groups = nz.length <= MAX_EXACT ? bestPartition(nz) : [nz]
  return groups.flatMap(settleGroup)
}

export interface SettleUp {
  check: PaymentCheck
  transfers: (Transfer & { fromName: string; toName: string })[]
}

export function settleUp(bill: Bill, r: Result): SettleUp {
  const check = checkPayments(bill, r)
  if (!check.ok) return { check, transfers: [] }
  const paid = new Map<string, number>()
  bill.payers.forEach((p, i) => paid.set(p.personId, (paid.get(p.personId) ?? 0) + check.rows[i].cents))
  const balances = r.people.map((p) => ({ id: p.id, cents: (paid.get(p.id) ?? 0) - p.total }))
  const name = (id: string) => r.people.find((p) => p.id === id)!.name
  const transfers = minTransfers(balances).map((t) => ({ ...t, fromName: name(t.from), toName: name(t.to) }))
  return { check, transfers }
}

export function buildSummary(bill: Bill, r: Result): string {
  const m = (c: number) => formatMoney(c, bill.currency)
  const lines = ['Bill summary', '']
  lines.push('Items:')
  for (const it of bill.items) {
    const names = it.people.map((id) => r.people.find((p) => p.id === id)?.name).filter(Boolean).join(', ')
    lines.push(`- ${it.name}: ${m(it.cents)} (${names || 'nobody'})`)
  }
  if (!bill.items.length) lines.push('- (none)')
  lines.push('', `Subtotal: ${m(r.subtotal)}`)
  lines.push(`Tax (${bill.taxInput.trim() || 0}%): ${m(r.tax)}`)
  lines.push(`Tip (${bill.tipInput.trim() || 0}%): ${m(r.tip)}`)
  lines.push(`Total: ${m(r.total)}`, '', 'Per person:')
  for (const p of r.people) {
    lines.push(`- ${p.name}: ${m(p.total)} (items ${m(p.subtotal)}, tax ${m(p.tax)}, tip ${m(p.tip)})`)
  }
  if (!r.people.length) lines.push('- (nobody)')

  const s = settleUp(bill, r)
  lines.push('')
  if (s.check.ok) {
    lines.push('Paid by:')
    bill.payers.forEach((p, i) => lines.push(`- ${r.people.find((x) => x.id === p.personId)!.name}: ${m(s.check.rows[i].cents)}`))
    lines.push('', 'Settle up:')
    if (s.transfers.length) for (const t of s.transfers) lines.push(`- ${t.fromName} pays ${t.toName} ${m(t.cents)}`)
    else lines.push('- All square, no transfers needed.')
  } else if (!bill.payers.length) {
    lines.push('Settle up: no payments recorded.')
  } else {
    lines.push(`Settle up: not available. ${s.check.sumError ?? 'Fix the payment amounts first.'}`)
  }
  return lines.join('\n')
}

const KEY = 'bill-splitter:v1'

export function loadBill(storage: Pick<Storage, 'getItem'> = localStorage): Bill {
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return emptyBill()
    const d = JSON.parse(raw)
    const people: Person[] = Array.isArray(d.people)
      ? d.people.filter((p: Person) => p && typeof p.id === 'string' && typeof p.name === 'string').map((p: Person) => ({ id: p.id, name: p.name }))
      : []
    const items: Item[] = Array.isArray(d.items)
      ? d.items
          .filter((i: Item) => i && typeof i.id === 'string' && typeof i.name === 'string' && Number.isSafeInteger(i.cents) && i.cents > 0 && Array.isArray(i.people))
          .map((i: Item) => ({ id: i.id, name: i.name, cents: i.cents, people: i.people.filter((x) => typeof x === 'string') }))
      : []
    const payers: Payer[] = Array.isArray(d.payers)
      ? d.payers
          .filter((p: Payer) => p && typeof p.personId === 'string' && typeof p.amount === 'string')
          .map((p: Payer) => ({ personId: p.personId, amount: p.amount }))
      : []
    return {
      people,
      items,
      payers,
      taxInput: typeof d.taxInput === 'string' ? d.taxInput : '',
      tipInput: typeof d.tipInput === 'string' ? d.tipInput : DEFAULT_TIP,
      currency: CURRENCIES.includes(d.currency) ? d.currency : 'USD',
    }
  } catch {
    return emptyBill()
  }
}

export function saveBill(bill: Bill, storage: Pick<Storage, 'setItem'> = localStorage) {
  try { storage.setItem(KEY, JSON.stringify(bill)) } catch { /* storage full or blocked */ }
}
