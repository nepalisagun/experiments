// Pure bill-splitting logic. All money is handled as integer cents.

export type Currency = 'USD' | 'EUR' | 'PLN'
export const CURRENCIES: Currency[] = ['USD', 'EUR', 'PLN']
export const TIP_PRESETS = ['10', '15', '18', '20'] as const
export type TipMode = (typeof TIP_PRESETS)[number] | 'custom'

export interface Person {
  id: string
  name: string
}

export interface Item {
  id: string
  name: string
  priceCents: number
  sharedBy: string[] // person ids
}

/** One person's payment towards the bill. */
export interface Payment {
  id: string
  personId: string
  amount: string // raw user input, e.g. "40.50"
}

export interface Bill {
  people: Person[]
  items: Item[]
  payments: Payment[]
  taxPct: string // raw user input, e.g. "8.875"
  tipMode: TipMode
  customTipPct: string // raw user input
  currency: Currency
}

export const emptyBill = (): Bill => ({
  people: [],
  items: [],
  payments: [],
  taxPct: '0',
  tipMode: '18',
  customTipPct: '',
  currency: 'USD',
})

// ---------- parsing & validation ----------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Parses a price such as "12", "12.5", "12,50" into integer cents. */
export function parsePrice(input: string): ParseResult<number> {
  const s = input.trim().replace(',', '.')
  if (s === '') return { ok: false, error: 'Enter a price.' }
  if (s.startsWith('-')) return { ok: false, error: 'Price cannot be negative.' }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return { ok: false, error: 'Price must be a number, e.g. 12.50.' }
  const [whole, frac = ''] = s.split('.')
  if (frac.length > 2) return { ok: false, error: 'Price can have at most 2 decimal places.' }
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) return { ok: false, error: 'Price is too large.' }
  return { ok: true, value: cents }
}

const PCT_DECIMALS = 4
const PCT_SCALE = 10 ** PCT_DECIMALS

/**
 * Parses a percentage such as "8.875" into an integer scaled by 10^4
 * (so 8.875% -> 88750). Empty input counts as 0.
 */
export function parsePercent(input: string, label = 'Percentage'): ParseResult<number> {
  const s = input.trim().replace(',', '.')
  if (s === '') return { ok: true, value: 0 }
  if (s.startsWith('-')) return { ok: false, error: `${label} cannot be negative.` }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return { ok: false, error: `${label} must be a number, e.g. 8.5.` }
  const [whole, frac = ''] = s.split('.')
  if (frac.length > PCT_DECIMALS) return { ok: false, error: `${label} can have at most ${PCT_DECIMALS} decimal places.` }
  const scaled = Number(whole || '0') * PCT_SCALE + Number(frac.padEnd(PCT_DECIMALS, '0'))
  if (scaled > 100 * PCT_SCALE) return { ok: false, error: `${label} cannot be more than 100%.` }
  return { ok: true, value: scaled }
}

export function validatePersonName(name: string, people: Person[], selfId?: string): string | null {
  const n = name.trim()
  if (!n) return 'Name cannot be empty.'
  if (n.length > 40) return 'Name must be 40 characters or fewer.'
  const dup = people.some((p) => p.id !== selfId && p.name.trim().toLowerCase() === n.toLowerCase())
  if (dup) return `There is already someone called "${n}".`
  return null
}

export interface ItemDraft {
  name: string
  price: string
  sharedBy: string[]
}

export type ItemErrors = Partial<Record<'name' | 'price' | 'sharedBy', string>>

export function validateItem(draft: ItemDraft, people: Person[]): { errors: ItemErrors; priceCents?: number } {
  const errors: ItemErrors = {}
  if (!draft.name.trim()) errors.name = 'Give the item a name.'
  else if (draft.name.trim().length > 60) errors.name = 'Item name must be 60 characters or fewer.'
  const price = parsePrice(draft.price)
  if (!price.ok) errors.price = price.error
  const valid = draft.sharedBy.filter((id) => people.some((p) => p.id === id))
  if (people.length === 0) errors.sharedBy = 'Add at least one person first.'
  else if (valid.length === 0) errors.sharedBy = 'Pick at least one person who shared this item.'
  return { errors, priceCents: price.ok ? price.value : undefined }
}

// ---------- allocation ----------

/**
 * Splits `total` (integer cents) across `weights` proportionally so the parts
 * are integers summing exactly to `total`. Uses the largest-remainder method;
 * ties go to the earlier index. Weights are BigInt so the math is exact.
 * If all weights are zero, the total is split as evenly as possible.
 */
export function allocate(total: number, weights: bigint[]): number[] {
  const n = weights.length
  if (n === 0) return []
  let W = weights.reduce((a, b) => a + b, 0n)
  let w = weights
  if (W === 0n) {
    w = weights.map(() => 1n)
    W = BigInt(n)
  }
  const T = BigInt(total)
  const base = w.map((wi) => (T * wi) / W)
  const rem = w.map((wi, i) => ({ i, r: T * wi - base[i] * W }))
  let left = T - base.reduce((a, b) => a + b, 0n)
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))
  for (let k = 0; left > 0n; k++, left--) base[rem[k % n].i] += 1n
  return base.map(Number)
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))
const lcm = (a: bigint, b: bigint) => (a / gcd(a, b)) * b

/** Rounds num/den to the nearest integer, halves away from zero (inputs are non-negative). */
function divRound(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n)
}

// ---------- computing the breakdown ----------

export interface PersonShare {
  personId: string
  name: string
  items: { itemId: string; name: string; sharedWith: number }[]
  subtotal: number
  tax: number
  tip: number
  total: number
}

export interface Breakdown {
  shares: PersonShare[]
  subtotal: number
  tax: number
  tip: number
  total: number
  taxPctScaled: number
  tipPctScaled: number
}

export function tipPercentInput(bill: Bill): string {
  return bill.tipMode === 'custom' ? bill.customTipPct : bill.tipMode
}

/**
 * Computes everyone's share. Each item is split equally among the people who
 * shared it. Tax and tip are computed on the bill subtotal, rounded to the
 * cent, and then divided in proportion to each person's exact (unrounded)
 * share of the items. Every column is allocated with the largest-remainder
 * method, so per-person values always add up exactly to the bill totals.
 * Invalid percentages are treated as 0.
 */
export function computeBreakdown(bill: Bill): Breakdown {
  const people = bill.people
  const ids = new Set(people.map((p) => p.id))
  const items = bill.items
    .map((it) => ({ ...it, sharedBy: it.sharedBy.filter((id) => ids.has(id)) }))
    .filter((it) => it.sharedBy.length > 0 && it.priceCents >= 0)

  // Exact per-person subtotal as numerator over a common denominator L.
  const L = items.reduce((acc, it) => lcm(acc, BigInt(it.sharedBy.length)), 1n)
  const exact = new Map<string, bigint>(people.map((p) => [p.id, 0n]))
  for (const it of items) {
    const per = (BigInt(it.priceCents) * L) / BigInt(it.sharedBy.length)
    for (const id of it.sharedBy) exact.set(id, exact.get(id)! + per)
  }
  const weights = people.map((p) => exact.get(p.id)!)

  const subtotal = items.reduce((a, it) => a + it.priceCents, 0)
  const taxP = parsePercent(bill.taxPct)
  const tipP = parsePercent(tipPercentInput(bill))
  const taxPctScaled = taxP.ok ? taxP.value : 0
  const tipPctScaled = tipP.ok ? tipP.value : 0
  const den = BigInt(100 * PCT_SCALE)
  const tax = Number(divRound(BigInt(subtotal) * BigInt(taxPctScaled), den))
  const tip = Number(divRound(BigInt(subtotal) * BigInt(tipPctScaled), den))

  // With no items, nobody owes anything (allocate() would otherwise split evenly).
  const hasWeight = weights.some((w) => w > 0n)
  const zeros = people.map(() => 0)
  const subs = hasWeight ? allocate(subtotal, weights) : zeros
  const taxes = hasWeight ? allocate(tax, weights) : zeros
  const tips = hasWeight ? allocate(tip, weights) : zeros

  const shares: PersonShare[] = people.map((p, i) => ({
    personId: p.id,
    name: p.name,
    items: items
      .filter((it) => it.sharedBy.includes(p.id))
      .map((it) => ({ itemId: it.id, name: it.name, sharedWith: it.sharedBy.length })),
    subtotal: subs[i],
    tax: taxes[i],
    tip: tips[i],
    total: subs[i] + taxes[i] + tips[i],
  }))

  return { shares, subtotal, tax, tip, total: subtotal + tax + tip, taxPctScaled, tipPctScaled }
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

export function formatPercent(scaled: number): string {
  return `${(scaled / PCT_SCALE).toFixed(PCT_DECIMALS).replace(/\.?0+$/, '')}%`
}

// ---------- persistence ----------

export const STORAGE_KEY = 'bill-splitter:v1'

const isStr = (v: unknown): v is string => typeof v === 'string'

/** Reads a stored bill, discarding anything malformed. */
export function deserializeBill(raw: string | null): Bill {
  const fallback = emptyBill()
  if (!raw) return fallback
  try {
    const d = JSON.parse(raw)
    if (!d || typeof d !== 'object') return fallback
    const people: Person[] = Array.isArray(d.people)
      ? d.people.filter((p: any) => p && isStr(p.id) && isStr(p.name)).map((p: any) => ({ id: p.id, name: p.name }))
      : []
    const ids = new Set(people.map((p) => p.id))
    const items: Item[] = Array.isArray(d.items)
      ? d.items
          .filter(
            (it: any) =>
              it && isStr(it.id) && isStr(it.name) && Number.isSafeInteger(it.priceCents) && it.priceCents >= 0 && Array.isArray(it.sharedBy),
          )
          .map((it: any) => ({
            id: it.id,
            name: it.name,
            priceCents: it.priceCents,
            sharedBy: it.sharedBy.filter((id: unknown) => isStr(id) && ids.has(id)),
          }))
          .filter((it: Item) => it.sharedBy.length > 0)
      : []
    const payments: Payment[] = Array.isArray(d.payments)
      ? d.payments
          .filter((p: any) => p && isStr(p.id) && isStr(p.personId) && ids.has(p.personId) && isStr(p.amount))
          .map((p: any) => ({ id: p.id, personId: p.personId, amount: p.amount }))
      : []
    return {
      people,
      items,
      payments,
      taxPct: isStr(d.taxPct) ? d.taxPct : fallback.taxPct,
      tipMode: [...TIP_PRESETS, 'custom'].includes(d.tipMode) ? d.tipMode : fallback.tipMode,
      customTipPct: isStr(d.customTipPct) ? d.customTipPct : '',
      currency: CURRENCIES.includes(d.currency) ? d.currency : fallback.currency,
    }
  } catch {
    return fallback
  }
}

/** Removes a person, their item shares, any item left with nobody, and their payment. */
export function removePerson(bill: Bill, personId: string): Bill {
  return {
    ...bill,
    people: bill.people.filter((p) => p.id !== personId),
    payments: bill.payments.filter((p) => p.personId !== personId),
    items: bill.items
      .map((it) => ({ ...it, sharedBy: it.sharedBy.filter((id) => id !== personId) }))
      .filter((it) => it.sharedBy.length > 0),
  }
}

/** Items that would be deleted if this person were removed (they are the only sharer). */
export function itemsOnlySharedBy(bill: Bill, personId: string): Item[] {
  return bill.items.filter((it) => it.sharedBy.length === 1 && it.sharedBy[0] === personId)
}
