import { describe, expect, it } from 'vitest'
import {
  allocate,
  buildSummary,
  computeTotals,
  deserializeBill,
  emptyBill,
  formatMoney,
  itemsOnlySharedBy,
  parsePercent,
  parsePrice,
  percentOf,
  validateItem,
  validatePersonName,
  TIP_PRESETS,
  balances,
  settleUp,
  transferText,
  validatePayments,
  type Balance,
  type Transfer,
  type Bill,
  type Item,
  type Person,
} from './bill'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const people: Person[] = [
  { id: 'a', name: 'Ann' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Cat' },
]

describe('allocate', () => {
  it('splits evenly when possible', () => {
    expect(allocate(900, [1, 1, 1])).toEqual([300, 300, 300])
  })
  it('distributes leftover cents and always sums to total', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333])
    expect(sum(allocate(1001, [1, 1, 1]))).toBe(1001)
  })
  it('is proportional to weights', () => {
    expect(allocate(100, [3, 1])).toEqual([75, 25])
    expect(allocate(10, [0, 5])).toEqual([0, 10])
  })
  it('returns zeros when all weights are zero', () => {
    expect(allocate(0, [0, 0])).toEqual([0, 0])
  })
  it('sums exactly for many random cases', () => {
    for (let n = 0; n < 2000; n++) {
      const k = 1 + Math.floor(Math.random() * 8)
      const weights = Array.from({ length: k }, () => Math.floor(Math.random() * 10000))
      if (sum(weights) === 0) weights[0] = 1
      const total = Math.floor(Math.random() * 100000)
      const parts = allocate(total, weights)
      expect(sum(parts)).toBe(total)
      parts.forEach((p, i) => {
        const exact = (total * weights[i]) / sum(weights)
        expect(Math.abs(p - exact)).toBeLessThan(1)
      })
    }
  })
})

describe('percentOf', () => {
  it('rounds half up and avoids float noise', () => {
    expect(percentOf(1000, 8.875)).toBe(89) // 88.75 -> 89
    expect(percentOf(1234, 8.875)).toBe(110) // 109.5175 -> 110
    expect(percentOf(1000, 0)).toBe(0)
    expect(percentOf(250, 15)).toBe(38) // 37.5 -> 38
  })
})

describe('computeTotals', () => {
  it('splits shared items and applies tax/tip proportionally', () => {
    const items: Item[] = [
      { id: '1', name: 'Pizza', priceCents: 3000, sharedBy: ['a', 'b', 'c'] },
      { id: '2', name: 'Wine', priceCents: 2000, sharedBy: ['a'] },
    ]
    const t = computeTotals(people, items, 10, 20)
    expect(t.subtotal).toBe(5000)
    expect(t.tax).toBe(500)
    expect(t.tip).toBe(1000)
    expect(t.total).toBe(6500)
    const ann = t.perPerson[0]
    expect(ann).toMatchObject({ subtotal: 3000, tax: 300, tip: 600, total: 3900 })
    expect(t.perPerson[1]).toMatchObject({ subtotal: 1000, tax: 100, tip: 200, total: 1300 })
  })

  it('per-person totals add up exactly to the bill total with awkward numbers', () => {
    const items: Item[] = [
      { id: '1', name: 'X', priceCents: 1000, sharedBy: ['a', 'b', 'c'] },
      { id: '2', name: 'Y', priceCents: 1, sharedBy: ['b', 'c'] },
      { id: '3', name: 'Z', priceCents: 777, sharedBy: ['a', 'c'] },
    ]
    const t = computeTotals(people, items, 8.875, 17.3)
    expect(sum(t.perPerson.map((p) => p.total))).toBe(t.total)
    expect(sum(t.perPerson.map((p) => p.subtotal))).toBe(t.subtotal)
    expect(sum(t.perPerson.map((p) => p.tax))).toBe(t.tax)
    expect(sum(t.perPerson.map((p) => p.tip))).toBe(t.tip)
    expect(t.total).toBe(t.subtotal + t.tax + t.tip)
  })

  it('fuzz: totals always reconcile', () => {
    for (let n = 0; n < 500; n++) {
      const items: Item[] = Array.from({ length: 1 + Math.floor(Math.random() * 6) }, (_, i) => {
        const sharedBy = people.filter(() => Math.random() < 0.6).map((p) => p.id)
        return { id: String(i), name: 'i', priceCents: Math.floor(Math.random() * 10000), sharedBy: sharedBy.length ? sharedBy : ['a'] }
      })
      const t = computeTotals(people, items, Math.round(Math.random() * 2500) / 100, Math.round(Math.random() * 3000) / 100)
      expect(sum(t.perPerson.map((p) => p.total))).toBe(t.total)
      expect(t.subtotal).toBe(sum(items.map((i) => i.priceCents)))
    }
  })

  it('people without items owe nothing; empty bill is zero', () => {
    const t = computeTotals(people, [{ id: '1', name: 'X', priceCents: 500, sharedBy: ['a'] }], 10, 10)
    expect(t.perPerson[2]).toMatchObject({ subtotal: 0, tax: 0, tip: 0, total: 0 })
    expect(computeTotals(people, [], 10, 10).total).toBe(0)
  })

  it('ignores sharers that no longer exist', () => {
    const t = computeTotals(people, [{ id: '1', name: 'X', priceCents: 1000, sharedBy: ['a', 'ghost'] }], 0, 0)
    expect(t.perPerson[0].subtotal).toBe(1000)
  })

  it('spreads leftover cents across different people for different items', () => {
    const items: Item[] = [
      { id: '1', name: 'X', priceCents: 100, sharedBy: ['a', 'b', 'c'] },
      { id: '2', name: 'Y', priceCents: 100, sharedBy: ['a', 'b', 'c'] },
    ]
    const subs = computeTotals(people, items, 0, 0).perPerson.map((p) => p.subtotal)
    expect(sum(subs)).toBe(200)
    expect(Math.max(...subs) - Math.min(...subs)).toBeLessThanOrEqual(1)
  })
})

describe('parsing & validation', () => {
  it('parses prices', () => {
    expect(parsePrice('12.5')).toEqual({ ok: true, value: 1250 })
    expect(parsePrice('12,50')).toEqual({ ok: true, value: 1250 })
    expect(parsePrice(' 7 ')).toEqual({ ok: true, value: 700 })
    expect(parsePrice('.99')).toEqual({ ok: true, value: 99 })
    expect(parsePrice('0')).toEqual({ ok: true, value: 0 })
  })
  it('rejects bad prices with clear messages', () => {
    expect(parsePrice('-5')).toEqual({ ok: false, error: 'Price cannot be negative.' })
    expect(parsePrice('')).toMatchObject({ ok: false, error: 'Enter a price.' })
    expect(parsePrice('abc')).toMatchObject({ ok: false })
    expect(parsePrice('1.234')).toMatchObject({ ok: false, error: expect.stringContaining('2 decimal') })
    expect(parsePrice('1e3')).toMatchObject({ ok: false })
  })
  it('parses percentages', () => {
    expect(parsePercent('', 'Tax')).toEqual({ ok: true, value: 0 })
    expect(parsePercent('8,875', 'Tax')).toEqual({ ok: true, value: 8.875 })
    expect(parsePercent('-1', 'Tax')).toEqual({ ok: false, error: 'Tax cannot be negative.' })
    expect(parsePercent('101', 'Tip')).toMatchObject({ ok: false })
    expect(parsePercent('x', 'Tip')).toMatchObject({ ok: false })
  })
  it('validates items', () => {
    expect(validateItem({ name: 'A', priceText: '3', sharedBy: ['a'] })).toEqual({ errors: {}, priceCents: 300 })
    const { errors } = validateItem({ name: ' ', priceText: '-1', sharedBy: [] })
    expect(errors.name).toBeTruthy()
    expect(errors.price).toBe('Price cannot be negative.')
    expect(errors.sharedBy).toMatch(/at least one person/)
  })
  it('validates person names', () => {
    expect(validatePersonName('Dan', people)).toBeNull()
    expect(validatePersonName('  ', people)).toMatch(/empty/)
    expect(validatePersonName('ann', people)).toMatch(/already/)
    expect(validatePersonName('Ann', people, 'a')).toBeNull() // renaming to own name is fine
  })
  it('finds items only shared by one person', () => {
    const items: Item[] = [
      { id: '1', name: 'X', priceCents: 1, sharedBy: ['a'] },
      { id: '2', name: 'Y', priceCents: 1, sharedBy: ['a', 'b'] },
    ]
    expect(itemsOnlySharedBy('a', items).map((i) => i.id)).toEqual(['1'])
    expect(itemsOnlySharedBy('b', items)).toEqual([])
  })
})

describe('formatting', () => {
  it('formats per currency', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56')
    expect(formatMoney(123456, 'EUR')).toBe('1.234,56 €')
    // Polish convention: 4-digit amounts are not grouped, 5+ digits are.
    expect(formatMoney(123456, 'PLN')).toBe('1234,56 zł')
    expect(formatMoney(1234567, 'PLN')).toBe('12 345,67 zł')
    expect(formatMoney(5, 'USD')).toBe('$0.05')
  })
  it('builds a plain-text summary', () => {
    const bill: Bill = {
      ...emptyBill(),
      people: people.slice(0, 2),
      items: [{ id: '1', name: 'Pizza', priceCents: 2000, sharedBy: ['a', 'b'] }],
    }
    const t = computeTotals(bill.people, bill.items, 10, 15)
    const s = buildSummary(bill, t, 10, 15)
    expect(s).toContain('Pizza — $20.00 (Ann, Bob)')
    expect(s).toContain('Tax (10%): $2.00')
    expect(s).toContain('Tip (15%): $3.00')
    expect(s).toContain('Total: $25.00')
    expect(s).toContain('Ann: $12.50 (items $10.00 + tax $1.00 + tip $1.50)')
  })
})

describe('validatePayments', () => {
  const pay = (personId: string, amountText: string, id = personId + amountText) => ({ id, personId, amountText })

  it('accepts payments that add up exactly', () => {
    const r = validatePayments([pay('a', '40'), pay('b', '25,50')], people, 6550, 'USD')
    expect(r.ok).toBe(true)
    expect(r.error).toBeNull()
    expect(r.paidCents).toBe(6550)
    expect(r.paidByPerson.get('b')).toBe(2550)
  })
  it('explains when payments fall short or overshoot', () => {
    const short = validatePayments([pay('a', '40')], people, 6550, 'USD')
    expect(short.ok).toBe(false)
    expect(short.error).toBe('Payments add up to $40.00, but the bill total is $65.50. $25.50 is still unaccounted for.')
    const over = validatePayments([pay('a', '70')], people, 6550, 'EUR')
    expect(over.error).toBe('Payments add up to 70,00 €, which is 4,50 € more than the bill total of 65,50 €.')
  })
  it('flags bad rows and does not add a total error on top', () => {
    const r = validatePayments([pay('', '10'), pay('a', '-3'), pay('b', ''), pay('b', '5', 'dup')], people, 1000, 'USD')
    expect(r.rows[0].personError).toBe('Choose who paid.')
    expect(r.rows[1].amountError).toBe('Amount cannot be negative.')
    expect(r.rows[2].amountError).toBe('Enter an amount.')
    expect(r.rows[3].personError).toBe('Bob is already listed as a payer.')
    expect(r.ok).toBe(false)
    expect(r.error).toBeNull()
  })
  it('is not ok with no payers', () => {
    expect(validatePayments([], people, 0, 'USD')).toMatchObject({ ok: false, error: null })
  })
})

/** Independent oracle: classic backtracking search for the minimum number of transfers. */
function bruteMinTransfers(bal: number[]): number {
  const b = bal.filter((x) => x !== 0)
  const dfs = (start: number): number => {
    while (start < b.length && b[start] === 0) start++
    if (start === b.length) return 0
    let best = Infinity
    for (let i = start + 1; i < b.length; i++) {
      if (b[i] * b[start] < 0) {
        b[i] += b[start]
        best = Math.min(best, 1 + dfs(start + 1))
        b[i] -= b[start]
      }
    }
    return best
  }
  return dfs(0)
}

function applyTransfers(bal: Balance[], ts: Transfer[]) {
  const m = new Map(bal.map((b) => [b.personId, b.cents]))
  for (const t of ts) {
    expect(t.cents).toBeGreaterThan(0)
    expect(t.from).not.toBe(t.to)
    m.set(t.from, m.get(t.from)! + t.cents)
    m.set(t.to, m.get(t.to)! - t.cents)
  }
  return [...m.values()]
}

describe('settleUp', () => {
  it('one payer: everyone else pays them', () => {
    const t = computeTotals(people, [{ id: '1', name: 'X', priceCents: 3000, sharedBy: ['a', 'b', 'c'] }], 0, 0)
    const ts = settleUp(balances(t, new Map([['a', 3000]])))
    expect(ts).toEqual([
      { from: 'b', to: 'a', cents: 1000 },
      { from: 'c', to: 'a', cents: 1000 },
    ])
  })
  it('no transfers when everyone paid their own share', () => {
    expect(settleUp([{ personId: 'a', cents: 0 }, { personId: 'b', cents: 0 }])).toEqual([])
  })
  it('beats the greedy approach when a smaller grouping exists', () => {
    // {A+5, E-5} and {B+3, C+3, D-6}: 3 transfers. Biggest-debtor-pays-biggest-creditor would take 4.
    const bal: Balance[] = [
      { personId: 'A', cents: 500 },
      { personId: 'B', cents: 300 },
      { personId: 'C', cents: 300 },
      { personId: 'D', cents: -600 },
      { personId: 'E', cents: -500 },
    ]
    const ts = settleUp(bal)
    expect(ts).toHaveLength(3)
    expect(ts).toEqual(
      expect.arrayContaining([
        { from: 'E', to: 'A', cents: 500 },
        { from: 'D', to: 'B', cents: 300 },
        { from: 'D', to: 'C', cents: 300 },
      ]),
    )
  })
  it('fuzz: always settles everyone with the minimum number of transfers', () => {
    for (let n = 0; n < 400; n++) {
      const k = 2 + Math.floor(Math.random() * 6)
      // small values make zero-sum subgroups common, which is where minimality matters
      const vals = Array.from({ length: k - 1 }, () => (Math.floor(Math.random() * 9) - 4) * 100)
      vals.push(-vals.reduce((a, b) => a + b, 0))
      const bal = vals.map((cents, i) => ({ personId: `p${i}`, cents }))
      const ts = settleUp(bal)
      expect(applyTransfers(bal, ts).every((v) => v === 0)).toBe(true)
      expect(ts.length).toBe(bruteMinTransfers(vals))
    }
  })
  it('falls back to greedy (still correct) for very large groups', () => {
    const vals = Array.from({ length: 30 }, (_, i) => (i % 2 ? -1 : 1) * (100 + i))
    vals.push(-vals.reduce((a, b) => a + b, 0))
    const bal = vals.map((cents, i) => ({ personId: `p${i}`, cents }))
    const ts = settleUp(bal)
    expect(applyTransfers(bal, ts).every((v) => v === 0)).toBe(true)
    expect(ts.length).toBeLessThan(bal.length)
  })
  it('formats a transfer as "X pays Y amount"', () => {
    const names = new Map([['a', 'Anna'], ['b', 'Ben']])
    expect(transferText({ from: 'a', to: 'b', cents: 1240 }, names, 'USD')).toBe('Anna pays Ben $12.40')
    expect(transferText({ from: 'a', to: 'b', cents: 1240 }, names, 'PLN')).toBe('Anna pays Ben 12,40 zł')
  })
  it('end to end: per-person totals, payments and balances reconcile', () => {
    const items: Item[] = [
      { id: '1', name: 'X', priceCents: 1000, sharedBy: ['a', 'b', 'c'] },
      { id: '2', name: 'Y', priceCents: 777, sharedBy: ['b'] },
    ]
    const t = computeTotals(people, items, 8.875, 18)
    const check = validatePayments(
      [
        { id: '1', personId: 'a', amountText: '15' },
        { id: '2', personId: 'c', amountText: ((t.total - 1500) / 100).toFixed(2) },
      ],
      people,
      t.total,
      'USD',
    )
    expect(check.ok).toBe(true)
    const bal = balances(t, check.paidByPerson)
    expect(bal.reduce((s, b) => s + b.cents, 0)).toBe(0)
    expect(applyTransfers(bal, settleUp(bal)).every((v) => v === 0)).toBe(true)
  })
})

describe('summary with payments', () => {
  it('lists payers and settle-up transfers', () => {
    const bill: Bill = {
      ...emptyBill(),
      people: [
        { id: 'a', name: 'Anna' },
        { id: 'b', name: 'Ben' },
      ],
      items: [{ id: '1', name: 'Pizza', priceCents: 2480, sharedBy: ['a', 'b'] }],
      tipPreset: null,
      payments: [{ id: 'p', personId: 'b', amountText: '24.80' }],
    }
    const t = computeTotals(bill.people, bill.items, 0, 0)
    const s = buildSummary(bill, t, 0, 0)
    expect(s).toContain('Paid:\n  Ben: $24.80')
    expect(s).toContain('Settle up:\n  Anna pays Ben $12.40')
  })
  it('says when settle-up is not available yet', () => {
    const bill: Bill = {
      ...emptyBill(),
      people: [{ id: 'a', name: 'Anna' }],
      items: [{ id: '1', name: 'Pizza', priceCents: 1000, sharedBy: ['a'] }],
      payments: [{ id: 'p', personId: 'a', amountText: '5' }],
    }
    const s = buildSummary(bill, computeTotals(bill.people, bill.items, 0, 0), 0, 0)
    expect(s).toContain('Settle up:\n  (not available: Payments add up to $5.00')
  })
  it('omits the payment sections when no payers are recorded', () => {
    const bill: Bill = { ...emptyBill(), people: [{ id: 'a', name: 'Anna' }] }
    expect(buildSummary(bill, computeTotals(bill.people, [], 0, 0), 0, 0)).not.toContain('Settle up')
  })
})

describe('deserializeBill', () => {
  it('keeps payments and clears payers that no longer exist', () => {
    const raw = JSON.stringify({
      people: [{ id: 'a', name: 'Ann' }],
      payments: [
        { id: '1', personId: 'a', amountText: '10' },
        { id: '2', personId: 'ghost', amountText: '5' },
        { id: 3, personId: 'a', amountText: '1' },
      ],
    })
    expect(deserializeBill(raw).payments).toEqual([
      { id: '1', personId: 'a', amountText: '10' },
      { id: '2', personId: '', amountText: '5' },
    ])
  })
  it('round-trips', () => {
    const bill: Bill = {
      people,
      items: [{ id: '1', name: 'X', priceCents: 100, sharedBy: ['a'] }],
      taxText: '8',
      tipPreset: 15,
      customTipText: '',
      currency: 'PLN',
      payments: [{ id: 'p1', personId: 'b', amountText: '1,00' }],
    }
    expect(deserializeBill(JSON.stringify(bill))).toEqual(bill)
  })
  it('falls back on garbage', () => {
    expect(deserializeBill(null)).toEqual(emptyBill())
    expect(deserializeBill('{not json')).toEqual(emptyBill())
    expect(deserializeBill('{"currency":"GBP","tipPreset":99,"people":"x"}')).toEqual(emptyBill())
  })
  it('defaults the tip to the 18% preset, but keeps a deliberate custom/none choice', () => {
    expect(emptyBill().tipPreset).toBe(18)
    expect(TIP_PRESETS).toEqual([10, 15, 18, 20])
    expect(deserializeBill('{}').tipPreset).toBe(18)
    expect(deserializeBill('{"tipPreset":18}').tipPreset).toBe(18)
    expect(deserializeBill('{"tipPreset":10}').tipPreset).toBe(10)
    expect(deserializeBill('{"tipPreset":null,"customTipText":"12"}')).toMatchObject({ tipPreset: null, customTipText: '12' })
  })
  it('drops invalid items and dangling sharers', () => {
    const raw = JSON.stringify({
      people: [{ id: 'a', name: 'Ann' }],
      items: [
        { id: '1', name: 'ok', priceCents: 100, sharedBy: ['a', 'zz'] },
        { id: '2', name: 'neg', priceCents: -1, sharedBy: ['a'] },
        { id: '3', name: 'orphan', priceCents: 1, sharedBy: ['zz'] },
      ],
    })
    const b = deserializeBill(raw)
    expect(b.items).toEqual([{ id: '1', name: 'ok', priceCents: 100, sharedBy: ['a'] }])
  })
})
