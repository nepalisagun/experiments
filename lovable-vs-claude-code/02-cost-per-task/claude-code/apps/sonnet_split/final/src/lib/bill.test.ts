import { describe, expect, it } from 'vitest'
import { allocate, buildSummary, calculate, emptyBill, formatMoney, loadBill, parsePercent, parsePrice, type Bill } from './bill'

const mk = (over: Partial<Bill> = {}): Bill => ({
  ...emptyBill(),
  tip: '0',
  people: [
    { id: 'a', name: 'Ann' },
    { id: 'b', name: 'Bob' },
    { id: 'c', name: 'Cy' },
  ],
  ...over,
})

describe('parsePrice', () => {
  it('parses valid values', () => {
    expect(parsePrice('12.50').cents).toBe(1250)
    expect(parsePrice('12,5').cents).toBe(1250)
    expect(parsePrice('7').cents).toBe(700)
    expect(parsePrice('.99').cents).toBe(99)
    expect(parsePrice('0.1').cents).toBe(10)
  })
  it('rejects bad values', () => {
    expect(parsePrice('-3').error).toMatch(/negative/)
    expect(parsePrice('').error).toBeTruthy()
    expect(parsePrice('abc').error).toBeTruthy()
    expect(parsePrice('.').error).toBeTruthy()
    expect(parsePrice('1.234').error).toMatch(/2 decimal/)
    expect(parsePrice('0').error).toMatch(/greater than zero/)
  })
})

describe('parsePercent', () => {
  it('parses', () => {
    expect(parsePercent('8.25', 'Tax').bp).toBe(825)
    expect(parsePercent('', 'Tax').bp).toBe(0)
  })
  it('rejects', () => {
    expect(parsePercent('-1', 'Tax').error).toMatch(/negative/)
    expect(parsePercent('101', 'Tip').error).toMatch(/100/)
    expect(parsePercent('x', 'Tip').error).toBeTruthy()
  })
})

describe('allocate', () => {
  it('sums exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(0, [1, 2])).toEqual([0, 0])
    expect(allocate(5, [0, 0])).toEqual([0, 0])
  })
  it('sums exactly for random inputs', () => {
    for (let n = 0; n < 500; n++) {
      const w = Array.from({ length: 1 + (n % 7) }, (_, i) => ((n * 31 + i * 17) % 1000) + 1)
      const total = (n * 7919) % 100000
      expect(allocate(total, w).reduce((a, b) => a + b, 0)).toBe(total)
    }
  })
})

describe('calculate', () => {
  it('splits shared items evenly with cent rounding', () => {
    const bill = mk({ items: [{ id: '1', name: 'Pizza', cents: 1000, people: ['a', 'b', 'c'] }] })
    const t = calculate(bill)
    expect(t.shares.map((s) => s.subtotal)).toEqual([334, 333, 333])
    expect(t.total).toBe(1000)
  })
  it('applies tax and tip proportionally', () => {
    const bill = mk({
      tax: '10',
      tip: '20',
      items: [
        { id: '1', name: 'Steak', cents: 3000, people: ['a'] },
        { id: '2', name: 'Salad', cents: 1000, people: ['b'] },
      ],
    })
    const t = calculate(bill)
    expect(t.subtotal).toBe(4000)
    expect(t.tax).toBe(400)
    expect(t.tip).toBe(800)
    expect(t.shares[0]).toMatchObject({ subtotal: 3000, tax: 300, tip: 600, total: 3900 })
    expect(t.shares[1]).toMatchObject({ subtotal: 1000, tax: 100, tip: 200, total: 1300 })
    expect(t.shares[2].total).toBe(0)
    expect(t.total).toBe(5200)
  })
  it('person totals always add up to bill total', () => {
    for (let n = 0; n < 300; n++) {
      const items = Array.from({ length: 1 + (n % 5) }, (_, i) => ({
        id: String(i),
        name: 'x',
        cents: ((n + 3) * (i + 7) * 37) % 9000 + 1,
        people: ['a', 'b', 'c'].filter((_, k) => ((n >> k) + i) % 3 !== 0 || k === i % 3),
      }))
      const bill = mk({ items, tax: String((n % 130) / 7), tip: String((n % 90) / 3) })
      const t = calculate(bill)
      expect(t.shares.reduce((a, s) => a + s.total, 0)).toBe(t.total)
      expect(t.shares.reduce((a, s) => a + s.tax, 0)).toBe(t.tax)
      expect(t.shares.reduce((a, s) => a + s.tip, 0)).toBe(t.tip)
      expect(t.total).toBe(t.subtotal + t.tax + t.tip)
    }
  })
  it('ignores items with no valid people', () => {
    const t = calculate(mk({ items: [{ id: '1', name: 'Ghost', cents: 500, people: ['zzz'] }] }))
    expect(t.total).toBe(0)
  })
  it('handles no people / no items', () => {
    expect(calculate(emptyBill()).total).toBe(0)
  })
})

describe('formatMoney', () => {
  it('formats by currency', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56')
    expect(formatMoney(1250, 'EUR')).toContain('12,50')
    expect(formatMoney(1250, 'EUR')).toContain('€')
    expect(formatMoney(1250, 'PLN')).toContain('zł')
  })
})

describe('buildSummary', () => {
  it('contains names and totals', () => {
    const s = buildSummary(mk({ tax: '10', items: [{ id: '1', name: 'A', cents: 1000, people: ['a'] }] }))
    expect(s).toContain('Ann: $11.00')
    expect(s).toContain('Total: $11.00')
  })
})

describe('default tip', () => {
  it('is 18% for a new bill and when saved data lacks a tip', () => {
    expect(emptyBill().tip).toBe('18')
    expect(loadBill('{}').tip).toBe('18')
  })
})

describe('loadBill', () => {
  it('round-trips and survives garbage', () => {
    const b = mk({ tax: '5', currency: 'PLN', items: [{ id: '1', name: 'A', cents: 100, people: ['a', 'gone'] }] })
    const r = loadBill(JSON.stringify(b))
    expect(r.currency).toBe('PLN')
    expect(r.items[0].people).toEqual(['a'])
    expect(loadBill('not json')).toEqual(emptyBill())
    expect(loadBill(null)).toEqual(emptyBill())
    expect(loadBill('{"people":5,"currency":"XXX"}').currency).toBe('USD')
  })
})
