import { describe, expect, it } from 'vitest'
import { allocate, buildSummary, calculate, emptyBill, formatMoney, loadBill, parsePercent, parsePrice, saveBill, type Bill } from './split'

const bill = (over: Partial<Bill> = {}): Bill => ({
  ...emptyBill(),
  tipInput: '', // these tests assume no tip unless they set one
  people: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Cy' }],
  ...over,
})

describe('default tip', () => {
  it('is 18% on a fresh bill and when stored data lacks a tip', () => {
    expect(emptyBill().tipInput).toBe('18')
    expect(loadBill({ getItem: () => null }).tipInput).toBe('18')
    expect(loadBill({ getItem: () => JSON.stringify({ people: [], items: [] }) }).tipInput).toBe('18')
  })
  it('keeps an explicit "no tip" saved by the user', () => {
    expect(loadBill({ getItem: () => JSON.stringify({ tipInput: '' }) }).tipInput).toBe('')
  })
  it('applies 18% to a fresh bill', () => {
    const r = calculate({ ...emptyBill(), people: [{ id: 'a', name: 'A' }], items: [{ id: '1', name: 'x', cents: 5000, people: ['a'] }] })
    expect(r.tip).toBe(900)
  })
})

describe('allocate', () => {
  it('sums exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(0, [1, 2])).toEqual([0, 0])
    expect(allocate(5, [0, 0])).toEqual([3, 2])
  })
  it('sums exactly for random inputs', () => {
    for (let n = 0; n < 500; n++) {
      const total = Math.floor(Math.random() * 100000)
      const w = Array.from({ length: 1 + Math.floor(Math.random() * 8) }, () => Math.floor(Math.random() * 5000))
      const out = allocate(total, w)
      expect(out.reduce((a, b) => a + b, 0)).toBe(total)
      expect(out.every((x) => x >= 0)).toBe(true)
    }
  })
})

describe('parsePrice', () => {
  it('parses', () => {
    expect(parsePrice('12.50').cents).toBe(1250)
    expect(parsePrice('12,5').cents).toBe(1250)
    expect(parsePrice('7').cents).toBe(700)
    expect(parsePrice('.99').cents).toBe(99)
    expect(parsePrice('0.07').cents).toBe(7)
  })
  it('rejects', () => {
    expect(parsePrice('-3').error).toMatch(/negative/)
    expect(parsePrice('').error).toBeTruthy()
    expect(parsePrice('abc').error).toBeTruthy()
    expect(parsePrice('1.234').error).toMatch(/2 decimal/)
    expect(parsePrice('0').error).toBeTruthy()
  })
})

describe('parsePercent', () => {
  it('handles empty, valid, invalid', () => {
    expect(parsePercent('', 'Tax').pct).toBe(0)
    expect(parsePercent('8.25', 'Tax').pct).toBe(8.25)
    expect(parsePercent('-1', 'Tax').error).toMatch(/negative/)
    expect(parsePercent('x', 'Tip').error).toBeTruthy()
    expect(parsePercent('101', 'Tip').error).toBeTruthy()
  })
})

describe('calculate', () => {
  it('splits shared items, tax and tip proportionally', () => {
    const r = calculate(bill({
      items: [
        { id: '1', name: 'Pizza', cents: 3000, people: ['a', 'b'] },
        { id: '2', name: 'Wine', cents: 2000, people: ['c'] },
      ],
      taxInput: '10', tipInput: '20',
    }))
    expect(r.subtotal).toBe(5000)
    expect(r.tax).toBe(500)
    expect(r.tip).toBe(1000)
    expect(r.people.map((p) => p.subtotal)).toEqual([1500, 1500, 2000])
    expect(r.people.map((p) => p.tax)).toEqual([150, 150, 200])
    expect(r.people.map((p) => p.tip)).toEqual([300, 300, 400])
    expect(r.total).toBe(6500)
  })
  it('per-person totals always add up to the bill total', () => {
    for (let n = 0; n < 300; n++) {
      const people = Array.from({ length: 1 + Math.floor(Math.random() * 7) }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
      const items = Array.from({ length: Math.floor(Math.random() * 10) }, (_, i) => ({
        id: 'i' + i, name: 'x', cents: 1 + Math.floor(Math.random() * 9999),
        people: people.filter(() => Math.random() < 0.5).map((p) => p.id),
      }))
      const b = { ...emptyBill(), people, items, taxInput: String(Math.random() * 25), tipInput: String(Math.random() * 30) }
      const r = calculate(b)
      expect(r.people.reduce((s, p) => s + p.total, 0)).toBe(r.total)
      expect(r.people.reduce((s, p) => s + p.tax, 0)).toBe(r.tax)
      expect(r.people.reduce((s, p) => s + p.tip, 0)).toBe(r.tip)
      expect(r.people.reduce((s, p) => s + p.subtotal, 0)).toBe(r.subtotal)
      expect(r.total).toBe(r.subtotal + r.tax + r.tip)
    }
  })
  it('handles one-cent thirds', () => {
    const r = calculate(bill({ items: [{ id: '1', name: 'x', cents: 100, people: ['a', 'b', 'c'] }] }))
    expect(r.people.map((p) => p.total)).toEqual([34, 33, 33])
  })
  it('reports items nobody shares and excludes them', () => {
    const r = calculate(bill({ items: [{ id: '1', name: 'x', cents: 100, people: ['gone'] }] }))
    expect(r.unassigned).toHaveLength(1)
    expect(r.total).toBe(0)
  })
  it('works with no people / no items', () => {
    expect(calculate(emptyBill()).total).toBe(0)
    expect(calculate(bill()).people.every((p) => p.total === 0)).toBe(true)
  })
})

describe('formatting and summary', () => {
  it('formats per currency', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56')
    expect(formatMoney(1250, 'EUR')).toMatch(/^12,50\s€$/)
    expect(formatMoney(1250, 'PLN')).toMatch(/^12,50\szł$/)
  })
  it('builds a plain-text summary', () => {
    const b = bill({ items: [{ id: '1', name: 'Pizza', cents: 3000, people: ['a', 'b'] }], taxInput: '10' })
    const s = buildSummary(b, calculate(b))
    expect(s).toContain('Pizza: $30.00 (Ann, Bob)')
    expect(s).toContain('Total: $33.00')
    expect(s).toContain('- Ann: $16.50')
  })
})

describe('persistence', () => {
  it('round-trips', () => {
    const store: Record<string, string> = {}
    const st = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
    const b = bill({ currency: 'PLN', taxInput: '8', items: [{ id: '1', name: 'x', cents: 5, people: ['a'] }] })
    saveBill(b, st)
    expect(loadBill(st)).toEqual(b)
  })
  it('survives corrupt data', () => {
    expect(loadBill({ getItem: () => '{nope' })).toEqual(emptyBill())
    const l = loadBill({ getItem: () => JSON.stringify({ people: 5, items: [{ id: 1 }], currency: 'XXX' }) })
    expect(l).toEqual(emptyBill())
  })
})
