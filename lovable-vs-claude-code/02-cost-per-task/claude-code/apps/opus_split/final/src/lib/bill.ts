export type Currency = 'USD' | 'EUR' | 'PLN'
export const CURRENCIES: Currency[] = ['USD', 'EUR', 'PLN']
export const TIP_PRESETS = [10, 15, 18, 20] as const
export const DEFAULT_TIP = 18

export interface Person {
  id: string
  name: string
}

export interface Item {
  id: string
  name: string
  /** Price in integer cents (minor units). */
  priceCents: number
  /** Ids of people who shared this item. */
  sharedBy: string[]
}

export interface Bill {
  people: Person[]
  items: Item[]
  /** Raw text of the tax % field, kept so the field survives reload as typed. */
  taxText: string
  /** Selected preset tip percentage, or null when the custom field is used. */
  tipPreset: number | null
  customTipText: string
  currency: Currency
  /** Who paid the restaurant, and how much (raw text so the field survives reload as typed). */
  payments: Payment[]
}

export interface Payment {
  id: string
  /** '' until a person is chosen. */
  personId: string
  amountText: string
}

export const emptyBill = (): Bill => ({
  people: [],
  items: [],
  taxText: '',
  tipPreset: DEFAULT_TIP,
  customTipText: '',
  currency: 'USD',
  payments: [],
})

export interface PersonBreakdown {
  personId: string
  name: string
  subtotal: number
  tax: number
  tip: number
  total: number
}

export interface BillTotals {
  subtotal: number
  tax: number
  tip: number
  total: number
  perPerson: PersonBreakdown[]
}

/**
 * Split `total` integer cents across `weights` (non-negative integers) proportionally,
 * using the largest-remainder method so the parts always sum exactly to `total`.
 * Ties are broken by position (earlier first). If all weights are zero, everyone gets 0
 * (and `total` must then be 0 for the sum to hold; callers guarantee that).
 */
export function allocate(total: number, weights: number[]): number[] {
  const W = weights.reduce((a, b) => a + b, 0)
  if (W === 0 || weights.length === 0) return weights.map(() => 0)
  const base: number[] = []
  const rems: { i: number; r: number }[] = []
  let assigned = 0
  weights.forEach((w, i) => {
    const num = total * w
    const q = Math.floor(num / W)
    base.push(q)
    rems.push({ i, r: num - q * W })
    assigned += q
  })
  let left = total - assigned
  rems.sort((a, b) => b.r - a.r || a.i - b.i)
  for (let k = 0; left > 0; k++, left--) base[rems[k % rems.length].i] += 1
  return base
}

/** percentage of an integer-cent amount, rounded half-up to whole cents. */
export function percentOf(cents: number, pct: number): number {
  // toFixed guards against float noise like 1234 * 8.875 / 100 = 109.51749999.
  return Math.round(Number(((cents * pct) / 100).toFixed(6)))
}

export function computeTotals(people: Person[], items: Item[], taxPct: number, tipPct: number): BillTotals {
  const idx = new Map(people.map((p, i) => [p.id, i]))
  const subs = people.map(() => 0)
  items.forEach((item, itemIndex) => {
    const sharers = item.sharedBy.filter((id) => idx.has(id))
    if (sharers.length === 0) return
    // Rotate the starting sharer by item index so leftover cents don't always land on the same person.
    const rotated = sharers.map((_, k) => sharers[(k + itemIndex) % sharers.length])
    const parts = allocate(item.priceCents, rotated.map(() => 1))
    rotated.forEach((id, k) => (subs[idx.get(id)!] += parts[k]))
  })
  const subtotal = subs.reduce((a, b) => a + b, 0)
  const tax = subtotal === 0 ? 0 : percentOf(subtotal, taxPct)
  const tip = subtotal === 0 ? 0 : percentOf(subtotal, tipPct)
  const taxes = allocate(tax, subs)
  const tips = allocate(tip, subs)
  const perPerson = people.map((p, i) => ({
    personId: p.id,
    name: p.name,
    subtotal: subs[i],
    tax: taxes[i],
    tip: tips[i],
    total: subs[i] + taxes[i] + tips[i],
  }))
  return { subtotal, tax, tip, total: subtotal + tax + tip, perPerson }
}

// ---------- parsing & validation ----------

export type ParseResult = { ok: true; value: number } | { ok: false; error: string }

const NUMBER_RE = /^\d+(?:[.,]\d+)?$|^[.,]\d+$/

/** Parse a user-typed money amount ("12.5", "12,50") into integer cents. */
export function parseMoney(text: string, label: 'Price' | 'Amount'): ParseResult {
  const t = text.trim().replace(/\s/g, '')
  if (t === '') return { ok: false, error: label === 'Price' ? 'Enter a price.' : 'Enter an amount.' }
  if (t.startsWith('-')) return { ok: false, error: `${label} cannot be negative.` }
  if (!NUMBER_RE.test(t)) return { ok: false, error: `${label} must be a number, e.g. 12.50.` }
  const [whole, frac = ''] = t.replace(',', '.').split('.')
  if (frac.length > 2) return { ok: false, error: `${label} can have at most 2 decimal places.` }
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'))
  if (cents > 100_000_000) return { ok: false, error: `${label} is too large.` }
  return { ok: true, value: cents }
}

export const parsePrice = (text: string) => parseMoney(text, 'Price')

/** Parse a percentage field. Empty means 0. */
export function parsePercent(text: string, label: string, max = 100): ParseResult {
  const t = text.trim().replace(/\s/g, '')
  if (t === '') return { ok: true, value: 0 }
  if (t.startsWith('-')) return { ok: false, error: `${label} cannot be negative.` }
  if (!NUMBER_RE.test(t)) return { ok: false, error: `${label} must be a number, e.g. 8.5.` }
  const v = Number(t.replace(',', '.'))
  if (v > max) return { ok: false, error: `${label} cannot be more than ${max}%.` }
  return { ok: true, value: v }
}

export interface ItemDraft {
  name: string
  priceText: string
  sharedBy: string[]
}

export type ItemErrors = Partial<Record<'name' | 'price' | 'sharedBy', string>>

export function validateItem(draft: ItemDraft): { errors: ItemErrors; priceCents?: number } {
  const errors: ItemErrors = {}
  if (draft.name.trim() === '') errors.name = 'Give the item a name.'
  const price = parsePrice(draft.priceText)
  if (!price.ok) errors.price = price.error
  if (draft.sharedBy.length === 0) errors.sharedBy = 'Pick at least one person who shared this item.'
  return { errors, priceCents: price.ok ? price.value : undefined }
}

export function validatePersonName(name: string, people: Person[], selfId?: string): string | null {
  const n = name.trim()
  if (n === '') return 'Name cannot be empty.'
  if (n.length > 40) return 'Name is too long (max 40 characters).'
  if (people.some((p) => p.id !== selfId && p.name.trim().toLowerCase() === n.toLowerCase()))
    return `"${n}" is already on the list.`
  return null
}

/** Items that would be left with nobody if this person were removed. */
export function itemsOnlySharedBy(personId: string, items: Item[]): Item[] {
  return items.filter((i) => i.sharedBy.length === 1 && i.sharedBy[0] === personId)
}

export function effectiveTipText(bill: Bill): string {
  return bill.tipPreset !== null ? String(bill.tipPreset) : bill.customTipText
}

// ---------- formatting ----------

const LOCALES: Record<Currency, string> = { USD: 'en-US', EUR: 'de-DE', PLN: 'pl-PL' }

export function formatMoney(cents: number, currency: Currency): string {
  return new Intl.NumberFormat(LOCALES[currency], {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(cents / 100)
    .replace(/[  ]/g, ' ')
}

export function formatPercent(pct: number): string {
  return `${Number(pct.toFixed(4))}%`
}

export function buildSummary(bill: Bill, totals: BillTotals, taxPct: number, tipPct: number): string {
  const m = (c: number) => formatMoney(c, bill.currency)
  const lines: string[] = ['Bill summary', '']
  lines.push('Items:')
  if (bill.items.length === 0) lines.push('  (none)')
  const names = new Map(bill.people.map((p) => [p.id, p.name]))
  for (const item of bill.items) {
    const who = item.sharedBy.map((id) => names.get(id)).filter(Boolean).join(', ')
    lines.push(`  ${item.name} — ${m(item.priceCents)} (${who})`)
  }
  lines.push('')
  lines.push(`Subtotal: ${m(totals.subtotal)}`)
  lines.push(`Tax (${formatPercent(taxPct)}): ${m(totals.tax)}`)
  lines.push(`Tip (${formatPercent(tipPct)}): ${m(totals.tip)}`)
  lines.push(`Total: ${m(totals.total)}`)
  lines.push('')
  lines.push('Per person:')
  if (totals.perPerson.length === 0) lines.push('  (nobody)')
  for (const p of totals.perPerson) {
    lines.push(
      `  ${p.name}: ${m(p.total)} (items ${m(p.subtotal)} + tax ${m(p.tax)} + tip ${m(p.tip)})`,
    )
  }

  if (bill.payments.length > 0) {
    const check = validatePayments(bill.payments, bill.people, totals.total, bill.currency)
    lines.push('')
    lines.push('Paid:')
    for (const row of check.rows) {
      const payment = bill.payments.find((p) => p.id === row.id)!
      const name = names.get(payment.personId) ?? '(no one chosen)'
      lines.push(`  ${name}: ${row.cents !== undefined ? m(row.cents) : `"${payment.amountText}" (invalid)`}`)
    }
    lines.push('')
    lines.push('Settle up:')
    if (!check.ok) {
      lines.push(`  (not available: ${check.error ?? 'fix the payment amounts first.'})`)
    } else {
      const transfers = settleUp(balances(totals, check.paidByPerson))
      if (transfers.length === 0) lines.push('  Everyone is even. No transfers needed.')
      for (const t of transfers) lines.push(`  ${transferText(t, names, bill.currency)}`)
    }
  }
  return lines.join('\n')
}

// ---------- who paid & settle up ----------

export interface PaymentRowCheck {
  id: string
  cents?: number
  personError?: string
  amountError?: string
}

export interface PaymentsCheck {
  rows: PaymentRowCheck[]
  /** Sum of the amounts that parsed. */
  paidCents: number
  /** Valid amounts summed per person id. */
  paidByPerson: Map<string, number>
  /** Bill-level problem (e.g. amounts don't add up), null when none. */
  error: string | null
  /** True when there is at least one payer, every row is valid and the sum equals the bill total. */
  ok: boolean
}

export function validatePayments(payments: Payment[], people: Person[], totalCents: number, currency: Currency): PaymentsCheck {
  const names = new Map(people.map((p) => [p.id, p.name]))
  const seen = new Set<string>()
  const paidByPerson = new Map<string, number>()
  let paidCents = 0
  let rowsOk = true
  const rows = payments.map((p): PaymentRowCheck => {
    const row: PaymentRowCheck = { id: p.id }
    if (!names.has(p.personId)) row.personError = 'Choose who paid.'
    else if (seen.has(p.personId)) row.personError = `${names.get(p.personId)} is already listed as a payer.`
    seen.add(p.personId)
    const amount = parseMoney(p.amountText, 'Amount')
    if (!amount.ok) row.amountError = amount.error
    else {
      row.cents = amount.value
      paidCents += amount.value
      if (!row.personError) paidByPerson.set(p.personId, (paidByPerson.get(p.personId) ?? 0) + amount.value)
    }
    if (row.personError || row.amountError) rowsOk = false
    return row
  })

  let error: string | null = null
  if (payments.length > 0 && rowsOk && paidCents !== totalCents) {
    const m = (c: number) => formatMoney(c, currency)
    const diff = totalCents - paidCents
    error =
      diff > 0
        ? `Payments add up to ${m(paidCents)}, but the bill total is ${m(totalCents)}. ${m(diff)} is still unaccounted for.`
        : `Payments add up to ${m(paidCents)}, which is ${m(-diff)} more than the bill total of ${m(totalCents)}.`
  }
  return { rows, paidCents, paidByPerson, error, ok: payments.length > 0 && rowsOk && error === null }
}

export interface Balance {
  personId: string
  /** Positive: is owed money. Negative: owes money. In cents. */
  cents: number
}

export function balances(totals: BillTotals, paidByPerson: Map<string, number>): Balance[] {
  return totals.perPerson.map((p) => ({ personId: p.personId, cents: (paidByPerson.get(p.personId) ?? 0) - p.total }))
}

export interface Transfer {
  from: string
  to: string
  cents: number
}

/** Greedy settle of a set of balances: biggest debtor pays biggest creditor. Uses at most n-1 transfers. */
function greedySettle(group: Balance[]): Transfer[] {
  const debtors = group.filter((b) => b.cents < 0).map((b) => ({ ...b, cents: -b.cents }))
  const creditors = group.filter((b) => b.cents > 0).map((b) => ({ ...b }))
  const out: Transfer[] = []
  const byAmount = (a: Balance, b: Balance) => b.cents - a.cents
  while (debtors.length && creditors.length) {
    debtors.sort(byAmount)
    creditors.sort(byAmount)
    const d = debtors[0]
    const c = creditors[0]
    const amt = Math.min(d.cents, c.cents)
    out.push({ from: d.personId, to: c.personId, cents: amt })
    d.cents -= amt
    c.cents -= amt
    if (d.cents === 0) debtors.shift()
    if (c.cents === 0) creditors.shift()
  }
  return out
}

/** Above this many non-zero balances the exact search gets slow; fall back to greedy (n-1 transfers at most). */
const EXACT_LIMIT = 16

/**
 * Minimum number of transfers that zeroes every balance (balances must sum to 0).
 *
 * With n people who are not already even, the minimum is n − k, where k is the largest number of
 * groups the people can be split into such that each group's balances sum to zero (each group of
 * size s needs exactly s − 1 transfers). We find k exactly with a subset DP, then settle each group
 * greedily.
 */
export function settleUp(all: Balance[]): Transfer[] {
  const nz = all.filter((b) => b.cents !== 0)
  const n = nz.length
  if (n === 0) return []
  if (n > EXACT_LIMIT) return greedySettle(nz)

  const size = 1 << n
  const sum = new Float64Array(size)
  const dp = new Int8Array(size)
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask
    sum[mask] = sum[mask ^ low] + nz[31 - Math.clz32(low)].cents
    let best = 0
    for (let i = 0; i < n; i++) if (mask & (1 << i)) best = Math.max(best, dp[mask ^ (1 << i)])
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0)
  }

  // Walk back from the full set, cutting off a zero-sum group every time we pass a zero-sum mask.
  const groups: number[] = []
  let mask = size - 1
  let groupStart = mask
  while (mask) {
    const target = dp[mask] - (sum[mask] === 0 ? 1 : 0)
    let next = -1
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i) && dp[mask ^ (1 << i)] === target) {
        next = mask ^ (1 << i)
        break
      }
    }
    mask = next
    if (sum[mask] === 0) {
      groups.push(groupStart ^ mask)
      groupStart = mask
    }
  }

  const transfers: Transfer[] = []
  for (const g of groups) transfers.push(...greedySettle(nz.filter((_, i) => g & (1 << i))))
  // Stable, readable order: by payer's position in the original list, then payee's.
  const pos = new Map(all.map((b, i) => [b.personId, i]))
  return transfers.sort((a, b) => pos.get(a.from)! - pos.get(b.from)! || pos.get(a.to)! - pos.get(b.to)!)
}

export function transferText(t: Transfer, names: Map<string, string>, currency: Currency): string {
  return `${names.get(t.from)} pays ${names.get(t.to)} ${formatMoney(t.cents, currency)}`
}

// ---------- persistence ----------

export const STORAGE_KEY = 'bill-splitter:v1'

/** Defensive parse of whatever is in storage; anything malformed falls back to defaults. */
export function deserializeBill(raw: string | null): Bill {
  const fallback = emptyBill()
  if (!raw) return fallback
  try {
    const d = JSON.parse(raw)
    if (!d || typeof d !== 'object') return fallback
    const people: Person[] = Array.isArray(d.people)
      ? d.people
          .filter((p: unknown): p is Person => !!p && typeof (p as Person).id === 'string' && typeof (p as Person).name === 'string')
          .map((p: Person) => ({ id: p.id, name: p.name }))
      : []
    const ids = new Set(people.map((p) => p.id))
    const items: Item[] = Array.isArray(d.items)
      ? d.items
          .filter(
            (i: Item) =>
              i &&
              typeof i.id === 'string' &&
              typeof i.name === 'string' &&
              Number.isInteger(i.priceCents) &&
              i.priceCents >= 0 &&
              Array.isArray(i.sharedBy),
          )
          .map((i: Item) => ({ ...i, sharedBy: i.sharedBy.filter((id) => ids.has(id)) }))
          .filter((i: Item) => i.sharedBy.length > 0)
      : []
    return {
      people,
      items,
      taxText: typeof d.taxText === 'string' ? d.taxText : '',
      // null is a deliberate choice (custom tip or no preset); anything missing/unknown gets the default.
      tipPreset: d.tipPreset === null ? null : TIP_PRESETS.includes(d.tipPreset) ? d.tipPreset : DEFAULT_TIP,
      customTipText: typeof d.customTipText === 'string' ? d.customTipText : '',
      currency: CURRENCIES.includes(d.currency) ? d.currency : 'USD',
      payments: Array.isArray(d.payments)
        ? d.payments
            .filter((p: Payment) => p && typeof p.id === 'string' && typeof p.personId === 'string' && typeof p.amountText === 'string')
            .map((p: Payment) => ({ id: p.id, personId: ids.has(p.personId) ? p.personId : '', amountText: p.amountText }))
        : [],
    }
  } catch {
    return fallback
  }
}
