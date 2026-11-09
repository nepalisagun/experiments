import { describe, expect, it } from 'vitest'
import {
  allocate,
  computeBreakdown,
  deserializeBill,
  emptyBill,
  formatMoney,
  itemsOnlySharedBy,
  parsePercent,
  parsePrice,
  removePerson,
  validateItem,
  validatePersonName,
  type Bill,
} from './bill'
import { buildSummary } from './summary'

const people = [
  { id: 'a', name: 'Ann' },
  { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Cat' },
]

function bill(partial: Partial<Bill>): Bill {
  return { ...emptyBill(), people, ...partial }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('parsePrice', () => {
  it('parses valid prices into cents', () => {
    expect(parsePrice('12')).toEqual({ ok: true, value: 1200 })
    expect(parsePrice('12.5')).toEqual({ ok: true, value: 1250 })
    expect(parsePrice('12,05')).toEqual({ ok: true, value: 1205 })
    expect(parsePrice(' .99 ')).toEqual({ ok: true, value: 99 })
    expect(parsePrice('0')).toEqual({ ok: true, value: 0 })
    expect(parsePrice('0.1')).toEqual({ ok: true, value: 10 })
  })
  it('rejects negatives, junk, empty and too many decimals', () => {
    expect(parsePrice('-1')).toEqual({ ok: false, error: 'Price cannot be negative.' })
    expect(parsePrice('')).toMatchObject({ ok: false, error: 'Enter a price.' })
    expect(parsePrice('abc')).toMatchObject({ ok: false })
    expect(parsePrice('.')).toMatchObject({ ok: false })
    expect(parsePrice('1e3')).toMatchObject({ ok: false })
    expect(parsePrice('1.234')).toMatchObject({ ok: false, error: 'Price can have at most 2 decimal places.' })
    expect(parsePrice('99999999999')).toMatchObject({ ok: false, error: 'Price is too large.' })
  })
})

describe('parsePercent', () => {
  it('scales by 10^4', () => {
    expect(parsePercent('8.875')).toEqual({ ok: true, value: 88750 })
    expect(parsePercent('')).toEqual({ ok: true, value: 0 })
    expect(parsePercent('100')).toEqual({ ok: true, value: 1_000_000 })
  })
  it('rejects bad input', () => {
    expect(parsePercent('-5', 'Tax')).toEqual({ ok: false, error: 'Tax cannot be negative.' })
    expect(parsePercent('101', 'Tip')).toMatchObject({ ok: false, error: 'Tip cannot be more than 100%.' })
    expect(parsePercent('x')).toMatchObject({ ok: false })
    expect(parsePercent('1.23456')).toMatchObject({ ok: false })
  })
})

describe('validation', () => {
  it('validates person names', () => {
    expect(validatePersonName('  ', people)).toBe('Name cannot be empty.')
    expect(validatePersonName('ann', people)).toBe('There is already someone called "ann".')
    expect(validatePersonName('Ann', people, 'a')).toBeNull() // renaming self
    expect(validatePersonName('Dan', people)).toBeNull()
  })
  it('requires at least one person on an item', () => {
    expect(validateItem({ name: 'Soup', price: '5', sharedBy: [] }, people).errors.sharedBy).toBe(
      'Pick at least one person who shared this item.',
    )
    expect(validateItem({ name: 'Soup', price: '5', sharedBy: ['ghost'] }, people).errors.sharedBy).toBeDefined()
    expect(validateItem({ name: 'Soup', price: '5', sharedBy: [] }, []).errors.sharedBy).toBe('Add at least one person first.')
  })
  it('rejects negative prices and empty names', () => {
    const r = validateItem({ name: '', price: '-3', sharedBy: ['a'] }, people)
    expect(r.errors.name).toBeDefined()
    expect(r.errors.price).toBe('Price cannot be negative.')
  })
  it('accepts a valid item', () => {
    expect(validateItem({ name: 'Soup', price: '5.10', sharedBy: ['a'] }, people)).toEqual({ errors: {}, priceCents: 510 })
  })
})

describe('allocate', () => {
  it('sums exactly to the total', () => {
    expect(allocate(100, [1n, 1n, 1n])).toEqual([34, 33, 33])
    expect(allocate(1, [1n, 1n])).toEqual([1, 0])
    expect(allocate(0, [5n, 3n])).toEqual([0, 0])
    expect(allocate(10, [0n, 0n])).toEqual([5, 5])
    expect(allocate(7, [])).toEqual([])
  })
  it('gives remainders to the largest fractional parts', () => {
    // 10 * 1/6 = 1.67, 10 * 2/6 = 3.33, 10 * 3/6 = 5 -> 2, 3, 5
    expect(allocate(10, [1n, 2n, 3n])).toEqual([2, 3, 5])
  })
  it('is exact for random inputs', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let t = 0; t < 500; t++) {
      const n = 1 + Math.floor(rnd() * 8)
      const w = Array.from({ length: n }, () => BigInt(Math.floor(rnd() * 10000)))
      const total = Math.floor(rnd() * 100000)
      const parts = allocate(total, w)
      expect(sum(parts)).toBe(total)
      parts.forEach((p) => expect(p).toBeGreaterThanOrEqual(0))
    }
  })
})

describe('computeBreakdown', () => {
  it('splits shared items equally and individual items to their owner', () => {
    const b = computeBreakdown(
      bill({
        items: [
          { id: 'i1', name: 'Pizza', priceCents: 3000, sharedBy: ['a', 'b', 'c'] },
          { id: 'i2', name: 'Wine', priceCents: 2000, sharedBy: ['a'] },
        ],
        taxPct: '0',
        tipMode: 'custom',
        customTipPct: '0',
      }),
    )
    expect(b.shares.map((s) => s.subtotal)).toEqual([3000, 1000, 1000])
    expect(b.total).toBe(5000)
  })

  it('applies tax and tip proportionally', () => {
    const b = computeBreakdown(
      bill({
        items: [
          { id: 'i1', name: 'Steak', priceCents: 3000, sharedBy: ['a'] },
          { id: 'i2', name: 'Salad', priceCents: 1000, sharedBy: ['b'] },
        ],
        taxPct: '10',
        tipMode: '20',
      }),
    )
    expect(b.subtotal).toBe(4000)
    expect(b.tax).toBe(400)
    expect(b.tip).toBe(800)
    expect(b.total).toBe(5200)
    expect(b.shares[0]).toMatchObject({ subtotal: 3000, tax: 300, tip: 600, total: 3900 })
    expect(b.shares[1]).toMatchObject({ subtotal: 1000, tax: 100, tip: 200, total: 1300 })
    expect(b.shares[2]).toMatchObject({ subtotal: 0, tax: 0, tip: 0, total: 0 })
  })

  it('uses tip presets and custom tip', () => {
    const items = [{ id: 'i', name: 'X', priceCents: 10000, sharedBy: ['a'] }]
    expect(computeBreakdown(bill({ items, tipMode: '10' })).tip).toBe(1000)
    expect(computeBreakdown(bill({ items, tipMode: '15' })).tip).toBe(1500)
    expect(computeBreakdown(bill({ items, tipMode: '18' })).tip).toBe(1800)
    expect(computeBreakdown(bill({ items, tipMode: '20' })).tip).toBe(2000)
    // the default tip is 18%
    expect(emptyBill().tipMode).toBe('18')
    expect(computeBreakdown({ ...emptyBill(), people, items }).tip).toBe(1800)
    // a bill saved with the old 15% default keeps it
    expect(deserializeBill(JSON.stringify({ ...emptyBill(), tipMode: '15' })).tipMode).toBe('15')
    expect(computeBreakdown(bill({ items, tipMode: 'custom', customTipPct: '17.5' })).tip).toBe(1750)
    // invalid custom tip is treated as 0
    expect(computeBreakdown(bill({ items, tipMode: 'custom', customTipPct: '-3' })).tip).toBe(0)
  })

  it('rounds so per-person totals add up exactly (thirds)', () => {
    const b = computeBreakdown(
      bill({
        items: [{ id: 'i', name: 'Shared', priceCents: 1000, sharedBy: ['a', 'b', 'c'] }],
        taxPct: '8.875',
        tipMode: '15',
      }),
    )
    expect(b.tax).toBe(89) // 88.75 -> 89
    expect(b.tip).toBe(150)
    expect(sum(b.shares.map((s) => s.subtotal))).toBe(b.subtotal)
    expect(sum(b.shares.map((s) => s.tax))).toBe(b.tax)
    expect(sum(b.shares.map((s) => s.tip))).toBe(b.tip)
    expect(sum(b.shares.map((s) => s.total))).toBe(b.total)
    expect(b.total).toBe(1239)
    // nobody differs by more than a cent per column
    const totals = b.shares.map((s) => s.total)
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(3)
  })

  it('totals always reconcile on random bills', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))
    for (let t = 0; t < 300; t++) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 10) }, (_, k) => {
        const sharedBy = many.filter(() => rnd() < 0.5).map((p) => p.id)
        return { id: `i${k}`, name: `I${k}`, priceCents: Math.floor(rnd() * 20000), sharedBy: sharedBy.length ? sharedBy : ['p0'] }
      })
      const b = computeBreakdown({
        ...emptyBill(),
        people: many,
        items,
        taxPct: (rnd() * 25).toFixed(3),
        tipMode: 'custom',
        customTipPct: (rnd() * 30).toFixed(2),
      })
      expect(sum(b.shares.map((s) => s.total))).toBe(b.total)
      expect(sum(b.shares.map((s) => s.subtotal))).toBe(b.subtotal)
      expect(sum(b.shares.map((s) => s.tax))).toBe(b.tax)
      expect(sum(b.shares.map((s) => s.tip))).toBe(b.tip)
      expect(b.subtotal).toBe(sum(items.map((i) => i.priceCents)))
    }
  })

  it('handles no items and no people', () => {
    expect(computeBreakdown(bill({})).shares.every((s) => s.total === 0)).toBe(true)
    expect(computeBreakdown(emptyBill())).toMatchObject({ total: 0, shares: [] })
  })

  it('ignores sharers who no longer exist', () => {
    const b = computeBreakdown(bill({ items: [{ id: 'i', name: 'X', priceCents: 900, sharedBy: ['a', 'ghost'] }] }))
    expect(b.shares[0].subtotal).toBe(900)
  })
})

describe('people removal', () => {
  const b = bill({
    items: [
      { id: 'i1', name: 'Solo', priceCents: 100, sharedBy: ['a'] },
      { id: 'i2', name: 'Shared', priceCents: 200, sharedBy: ['a', 'b'] },
    ],
  })
  it('finds items only that person shared', () => {
    expect(itemsOnlySharedBy(b, 'a').map((i) => i.id)).toEqual(['i1'])
    expect(itemsOnlySharedBy(b, 'b')).toEqual([])
  })
  it('removes the person, their shares, and orphaned items', () => {
    const r = removePerson(b, 'a')
    expect(r.people.map((p) => p.id)).toEqual(['b', 'c'])
    expect(r.items).toEqual([{ id: 'i2', name: 'Shared', priceCents: 200, sharedBy: ['b'] }])
  })
})

describe('formatMoney', () => {
  it('formats per currency', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56')
    expect(formatMoney(123456, 'EUR')).toBe('1.234,56 €')
    expect(formatMoney(123456, 'PLN')).toBe('1234,56 zł')
    expect(formatMoney(5, 'USD')).toBe('$0.05')
  })
})

describe('buildSummary', () => {
  it('produces a plain-text summary', () => {
    const b = bill({
      items: [{ id: 'i', name: 'Pizza', priceCents: 3000, sharedBy: ['a', 'b'] }],
      taxPct: '10',
      tipMode: '20',
    })
    const s = buildSummary(b)
    expect(s).toContain('- Pizza: $30.00 (Ann, Ben)')
    expect(s).toContain('Tax (10%): $3.00')
    expect(s).toContain('Tip (20%): $6.00')
    expect(s).toContain('Total: $39.00')
    expect(s).toContain('- Ann: $19.50 (items $15.00, tax $1.50, tip $3.00)')
    expect(s).toContain('- Cat: $0.00')
  })
})

describe('deserializeBill', () => {
  it('round-trips a bill', () => {
    const b = bill({ items: [{ id: 'i', name: 'X', priceCents: 1, sharedBy: ['a'] }], currency: 'PLN', tipMode: 'custom', customTipPct: '12' })
    expect(deserializeBill(JSON.stringify(b))).toEqual(b)
  })
  it('falls back on garbage', () => {
    expect(deserializeBill(null)).toEqual(emptyBill())
    expect(deserializeBill('not json')).toEqual(emptyBill())
    expect(deserializeBill('42')).toEqual(emptyBill())
    const r = deserializeBill(
      JSON.stringify({ people: [{ id: 'a', name: 'A' }, { bad: 1 }], items: [{ id: 'i', name: 'X', priceCents: -5, sharedBy: ['a'] }], currency: 'GBP', tipMode: '99' }),
    )
    expect(r.people).toEqual([{ id: 'a', name: 'A' }])
    expect(r.items).toEqual([])
    expect(r.currency).toBe('USD')
    expect(r.tipMode).toBe('18')
  })
})
