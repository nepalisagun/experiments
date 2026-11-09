import { minTransfers } from './settle'

export type Currency = 'USD' | 'EUR' | 'PLN'
export const CURRENCIES: Currency[] = ['USD', 'EUR', 'PLN']

export interface Person {
  id: string
  name: string
}
export interface Item {
  id: string
  name: string
  cents: number
  people: string[]
}
export interface Payer {
  personId: string
  amount: string // money as typed
}
export interface Bill {
  people: Person[]
  items: Item[]
  payers: Payer[]
  tax: string // percent, as typed
  tip: string // percent, as typed
  currency: Currency
}

export const DEFAULT_TIP = '18'
export const emptyBill = (): Bill => ({ people: [], items: [], payers: [], tax: '0', tip: DEFAULT_TIP, currency: 'USD' })

/** Parse a money string into integer cents. Accepts "12", "12.5", "12,50". */
export function parsePrice(raw: string): { cents?: number; error?: string } {
  const s = raw.trim()
  if (s === '') return { error: 'Enter a price.' }
  if (s.startsWith('-')) return { error: 'Price cannot be negative.' }
  if (!/^\d*[.,]?\d*$/.test(s) || !/\d/.test(s)) return { error: 'Price must be a number, e.g. 12.50.' }
  const [whole, frac = ''] = s.replace(',', '.').split('.')
  if (frac.length > 2) return { error: 'Price can have at most 2 decimal places.' }
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) return { error: 'Price is too large.' }
  if (cents === 0) return { error: 'Price must be greater than zero.' }
  return { cents }
}

/** Parse a percentage string into basis points (1% = 100). */
export function parsePercent(raw: string, label: string): { bp?: number; error?: string } {
  const s = raw.trim().replace(',', '.')
  if (s === '') return { bp: 0 }
  if (s.startsWith('-')) return { error: `${label} cannot be negative.` }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return { error: `${label} must be a number, e.g. 8.5.` }
  const n = Number(s)
  if (n > 100) return { error: `${label} cannot be more than 100%.` }
  return { bp: Math.round(n * 100) }
}

/**
 * Split `total` cents across `weights` proportionally using the largest-remainder
 * method, so the parts are integers that sum exactly to `total`.
 * Ties go to the earlier index (deterministic).
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (weights.length === 0) return []
  if (sum === 0) return weights.map(() => 0)
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

export interface PersonShare {
  person: Person
  subtotal: number
  tax: number
  tip: number
  total: number
}
export interface Totals {
  shares: PersonShare[]
  subtotal: number
  tax: number
  tip: number
  total: number
}

export function calculate(bill: Bill): Totals {
  const ids = bill.people.map((p) => p.id)
  const subtotals = ids.map(() => 0)
  let subtotal = 0
  for (const item of bill.items) {
    const idxs = item.people.map((id) => ids.indexOf(id)).filter((i) => i >= 0)
    if (idxs.length === 0) continue // invalid item: ignored until fixed
    const parts = allocate(item.cents, idxs.map(() => 1))
    idxs.forEach((pi, k) => (subtotals[pi] += parts[k]))
    subtotal += item.cents
  }
  const taxBp = parsePercent(bill.tax, 'Tax').bp ?? 0
  const tipBp = parsePercent(bill.tip, 'Tip').bp ?? 0
  const tax = Math.round((subtotal * taxBp) / 10000)
  const tip = Math.round((subtotal * tipBp) / 10000)
  const taxParts = allocate(tax, subtotals)
  const tipParts = allocate(tip, subtotals)
  const shares = bill.people.map((person, i) => ({
    person,
    subtotal: subtotals[i],
    tax: taxParts[i],
    tip: tipParts[i],
    total: subtotals[i] + taxParts[i] + tipParts[i],
  }))
  return { shares, subtotal, tax, tip, total: subtotal + tax + tip }
}

const LOCALES: Record<Currency, string> = { USD: 'en-US', EUR: 'de-DE', PLN: 'pl-PL' }

export function formatMoney(cents: number, currency: Currency): string {
  return new Intl.NumberFormat(LOCALES[currency], { style: 'currency', currency }).format(cents / 100)
}

/** Parse a payer's amount; same rules as a price but worded as an "amount". */
export function parsePayment(raw: string): { cents?: number; error?: string } {
  const r = parsePrice(raw)
  if (!r.error) return r
  return { error: r.error.replace('Enter a price.', 'Enter the amount paid.').replace(/Price/g, 'Amount') }
}

export interface PaymentCheck {
  /** none: nobody recorded; invalid: some row has a bad amount; short/over: sum differs from total; ok: matches */
  status: 'none' | 'invalid' | 'short' | 'over' | 'ok'
  paid: number
  total: number
  /** total - paid (positive when short) */
  diff: number
  rowErrors: (string | undefined)[]
}

export function checkPayments(bill: Bill, totals: Totals = calculate(bill)): PaymentCheck {
  const parsed = bill.payers.map((p) => parsePayment(p.amount))
  const rowErrors = parsed.map((p) => p.error)
  const paid = parsed.reduce((a, p) => a + (p.cents ?? 0), 0)
  const total = totals.total
  const diff = total - paid
  let status: PaymentCheck['status']
  if (bill.payers.length === 0) status = 'none'
  else if (rowErrors.some(Boolean)) status = 'invalid'
  else status = diff === 0 ? 'ok' : diff > 0 ? 'short' : 'over'
  return { status, paid, total, diff, rowErrors }
}

export function paymentMessage(check: PaymentCheck, currency: Currency): string {
  const m = (c: number) => formatMoney(c, currency)
  switch (check.status) {
    case 'none':
      return 'Add who paid to see how to settle up.'
    case 'invalid':
      return 'Fix the amounts above to see how to settle up.'
    case 'short':
      return `Payments add up to ${m(check.paid)}, but the bill total is ${m(check.total)}. ${m(check.diff)} is still unaccounted for.`
    case 'over':
      return `Payments add up to ${m(check.paid)}, but the bill total is ${m(check.total)}. That is ${m(-check.diff)} too much.`
    case 'ok':
      return `Payments add up to the bill total (${m(check.total)}).`
  }
}

export interface NamedTransfer {
  from: Person
  to: Person
  cents: number
}

/** Minimum transfers that settle the bill, or null when the payments don't match the total. */
export function settlement(bill: Bill, totals: Totals = calculate(bill)): NamedTransfer[] | null {
  const check = checkPayments(bill, totals)
  if (check.status !== 'ok') return null
  const paid = new Map<string, number>()
  bill.payers.forEach((p) => {
    const cents = parsePayment(p.amount).cents ?? 0
    paid.set(p.personId, (paid.get(p.personId) ?? 0) + cents)
  })
  const balances = totals.shares.map((s) => (paid.get(s.person.id) ?? 0) - s.total)
  return minTransfers(balances).map((t) => ({
    from: totals.shares[t.from].person,
    to: totals.shares[t.to].person,
    cents: t.cents,
  }))
}

export const transferText = (t: NamedTransfer, currency: Currency) =>
  `${t.from.name} pays ${t.to.name} ${formatMoney(t.cents, currency)}`

export function buildSummary(bill: Bill): string {
  const t = calculate(bill)
  const m = (c: number) => formatMoney(c, bill.currency)
  const lines = ['Bill summary', '']
  for (const s of t.shares) {
    lines.push(`${s.person.name}: ${m(s.total)} (items ${m(s.subtotal)}, tax ${m(s.tax)}, tip ${m(s.tip)})`)
  }
  lines.push('', `Subtotal: ${m(t.subtotal)}`, `Tax (${bill.tax || 0}%): ${m(t.tax)}`, `Tip (${bill.tip || 0}%): ${m(t.tip)}`, `Total: ${m(t.total)}`)

  const check = checkPayments(bill, t)
  if (check.status !== 'none') {
    lines.push('', 'Paid by:')
    for (const p of bill.payers) {
      const name = bill.people.find((x) => x.id === p.personId)?.name ?? '?'
      const cents = parsePayment(p.amount).cents
      lines.push(`${name}: ${cents === undefined ? p.amount : m(cents)}`)
    }
    lines.push('', 'Settle up:')
    const transfers = settlement(bill, t)
    if (!transfers) lines.push(paymentMessage(check, bill.currency))
    else if (transfers.length === 0) lines.push('Everyone is even. No transfers needed.')
    else for (const tr of transfers) lines.push(transferText(tr, bill.currency))
  }
  return lines.join('\n')
}

/** Restore a bill from untrusted JSON (localStorage); falls back to empty on anything odd. */
export function loadBill(json: string | null): Bill {
  const bill = emptyBill()
  if (!json) return bill
  try {
    const d = JSON.parse(json)
    if (!d || typeof d !== 'object') return bill
    const people: Person[] = Array.isArray(d.people)
      ? d.people.filter((p: Person) => p && typeof p.id === 'string' && typeof p.name === 'string')
      : []
    const ids = new Set(people.map((p) => p.id))
    const items: Item[] = Array.isArray(d.items)
      ? d.items
          .filter(
            (i: Item) =>
              i && typeof i.id === 'string' && typeof i.name === 'string' && Number.isSafeInteger(i.cents) && i.cents > 0 && Array.isArray(i.people),
          )
          .map((i: Item) => ({ id: i.id, name: i.name, cents: i.cents, people: i.people.filter((p) => ids.has(p)) }))
      : []
    const seen = new Set<string>()
    const payers: Payer[] = Array.isArray(d.payers)
      ? d.payers.filter((p: Payer) => {
          const ok = p && typeof p.personId === 'string' && typeof p.amount === 'string' && ids.has(p.personId) && !seen.has(p.personId)
          if (ok) seen.add(p.personId)
          return ok
        })
      : []
    return {
      people,
      items,
      payers,
      tax: typeof d.tax === 'string' ? d.tax : '0',
      tip: typeof d.tip === 'string' ? d.tip : DEFAULT_TIP,
      currency: CURRENCIES.includes(d.currency) ? d.currency : 'USD',
    }
  } catch {
    return bill
  }
}
