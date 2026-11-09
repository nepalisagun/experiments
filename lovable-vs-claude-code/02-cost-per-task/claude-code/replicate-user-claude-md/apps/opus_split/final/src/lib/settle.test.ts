import { describe, expect, it } from 'vitest'
import { computeBreakdown, deserializeBill, emptyBill, removePerson, type Bill, type Payment } from './bill'
import { checkPayments, computeBalances, computeSettlement, EXACT_LIMIT, formatTransfer, minTransfers, type Transfer } from './settle'
import { buildSummary } from './summary'

const people = [
  { id: 'a', name: 'Anna' },
  { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Cat' },
  { id: 'd', name: 'Dan' },
]

let pid = 0
const pay = (personId: string, amount: string): Payment => ({ id: `pay${pid++}`, personId, amount })

/** Anna 30, Ben 20, Cat 10 in items; no tax; no tip. Total 60. */
function dinner(payments: Payment[], extra: Partial<Bill> = {}): Bill {
  return {
    ...emptyBill(),
    people: people.slice(0, 3),
    items: [
      { id: 'i1', name: 'Steak', priceCents: 3000, sharedBy: ['a'] },
      { id: 'i2', name: 'Pasta', priceCents: 2000, sharedBy: ['b'] },
      { id: 'i3', name: 'Soup', priceCents: 1000, sharedBy: ['c'] },
    ],
    tipMode: 'custom',
    customTipPct: '0',
    payments,
    ...extra,
  }
}

const map = (o: Record<string, number>) => new Map(Object.entries(o))

/** Applies transfers and returns the balances left over. */
function apply(balances: Map<string, number>, ts: Transfer[]) {
  const b = new Map(balances)
  for (const t of ts) {
    expect(t.cents).toBeGreaterThan(0)
    expect(t.from).not.toBe(t.to)
    b.set(t.from, b.get(t.from)! + t.cents)
    b.set(t.to, b.get(t.to)! - t.cents)
  }
  return b
}

/** Independent brute force: fewest transfers = n - max number of zero-sum blocks over all set partitions. */
function bruteMin(vals: number[]): number {
  const nz = vals.filter((v) => v !== 0)
  let best = 0
  const rec = (i: number, blocks: number[]) => {
    if (i === nz.length) {
      best = Math.max(best, blocks.filter((s) => s === 0).length)
      return
    }
    for (let k = 0; k < blocks.length; k++) {
      blocks[k] += nz[i]
      rec(i + 1, blocks)
      blocks[k] -= nz[i]
    }
    blocks.push(nz[i])
    rec(i + 1, blocks)
    blocks.pop()
  }
  rec(0, [])
  return nz.length - best
}

describe('checkPayments', () => {
  it('accepts payments that add up to the total', () => {
    const b = dinner([pay('a', '40'), pay('b', '20.00')])
    expect(checkPayments(b, 6000)).toMatchObject({ ok: true, paidCents: 6000, difference: 0, rowErrors: [undefined, undefined] })
  })
  it('explains when payments are short or over', () => {
    const short = checkPayments(dinner([pay('a', '50')]), 6000)
    expect(short.ok).toBe(false)
    expect(short.sumError).toBe('Payments add up to $50.00, but the bill total is $60.00. $10.00 is still unpaid.')
    const over = checkPayments(dinner([pay('a', '50'), pay('b', '12.5')]), 6000)
    expect(over.sumError).toBe("Payments add up to $62.50, but the bill total is $60.00. That's $2.50 too much.")
  })
  it('formats the message in the selected currency', () => {
    const r = checkPayments(dinner([pay('a', '50')], { currency: 'EUR' }), 6000)
    expect(r.sumError).toContain('50,00 €')
  })
  it('flags bad amounts, missing and duplicate payers per row', () => {
    const r = checkPayments(dinner([pay('a', '-5'), pay('b', ''), pay('c', '1.234'), pay('a', '10'), pay('', '3')]), 6000)
    expect(r.rowErrors).toEqual([
      'Amount cannot be negative.',
      'Enter the amount paid.',
      'Amount can have at most 2 decimal places.',
      'This person is already listed as a payer.',
      'Pick who paid.',
    ])
    expect(r.ok).toBe(false)
    expect(r.sumError).toBeUndefined() // fix the rows first
    expect(checkPayments(dinner([pay('a', 'x')]), 6000).rowErrors).toEqual(['Amount must be a number, e.g. 12.50.'])
  })
  it('is not ok with no payers', () => {
    expect(checkPayments(dinner([]), 6000).ok).toBe(false)
  })
})

describe('minTransfers', () => {
  it('returns nothing when everyone is even', () => {
    expect(minTransfers(map({ a: 0, b: 0 }))).toEqual([])
    expect(minTransfers(new Map())).toEqual([])
  })
  it('one payer: everyone else pays them', () => {
    expect(minTransfers(map({ a: 3000, b: -2000, c: -1000 }))).toEqual([
      { from: 'b', to: 'a', cents: 2000 },
      { from: 'c', to: 'a', cents: 1000 },
    ])
  })
  it('finds zero-sum pairs that greedy largest-first would miss', () => {
    // Greedy largest-first: d(-7) -> a(+6), then d(-1)->b... gives 4 transfers.
    // Optimal pairs a/c and b/d: 2 transfers.
    const bal = map({ a: 600, b: 500, c: -600, d: -500 })
    const ts = minTransfers(bal)
    expect(ts).toHaveLength(2)
    expect([...apply(bal, ts).values()].every((v) => v === 0)).toBe(true)

    const tricky = map({ a: 400, b: 300, c: 300, d: -700, e: -300 })
    expect(minTransfers(tricky)).toHaveLength(3)
  })
  it('rejects balances that do not sum to zero', () => {
    expect(() => minTransfers(map({ a: 1, b: 0 }))).toThrow()
  })
  it('settles everyone and is minimal on random inputs (checked by brute force)', () => {
    let seed = 99
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let t = 0; t < 400; t++) {
      const n = 2 + Math.floor(rnd() * 6) // 2..7 people
      // small values make zero-sum subsets common, which is the hard case
      const vals = Array.from({ length: n - 1 }, () => Math.floor(rnd() * 11) - 5)
      vals.push(-vals.reduce((a, b) => a + b, 0))
      const bal = new Map(vals.map((v, i) => [`p${i}`, v]))
      const ts = minTransfers(bal)
      expect([...apply(bal, ts).values()].every((v) => v === 0)).toBe(true)
      expect(ts.length).toBe(bruteMin(vals))
    }
  })
  it('falls back to a valid (greedy) plan for very large groups', () => {
    const n = EXACT_LIMIT + 4
    const vals = Array.from({ length: n }, (_, i) => (i % 2 ? -(i + 1) * 100 : (i + 2) * 100))
    vals[n - 1] -= vals.reduce((a, b) => a + b, 0)
    const bal = new Map(vals.map((v, i) => [`p${i}`, v]))
    const ts = minTransfers(bal)
    expect([...apply(bal, ts).values()].every((v) => v === 0)).toBe(true)
    expect(ts.length).toBeLessThanOrEqual(n - 1)
  })
})

describe('computeSettlement', () => {
  it('uses each person total including tax and tip', () => {
    // Total 60 + 10% tax = 66. Anna owes 33, Ben 22, Cat 11. Ben paid it all.
    const b = dinner([pay('b', '66')], { taxPct: '10' })
    const bd = computeBreakdown(b)
    expect(bd.total).toBe(6600)
    const s = computeSettlement(b, bd)
    expect(s).toEqual({
      status: 'ok',
      transfers: [
        { from: 'a', to: 'b', cents: 3300 },
        { from: 'c', to: 'b', cents: 1100 },
      ],
    })
    if (s.status === 'ok') expect(s.transfers.map((t) => formatTransfer(t, b))).toEqual(['Anna pays Ben $33.00', 'Cat pays Ben $11.00'])
  })
  it('handles several payers', () => {
    // Anna paid 40 (owes 30: +10), Cat paid 20 (owes 10: +10), Ben owes 20.
    const b = dinner([pay('a', '40'), pay('c', '20')])
    const s = computeSettlement(b, computeBreakdown(b))
    expect(s).toEqual({
      status: 'ok',
      transfers: [
        { from: 'b', to: 'a', cents: 1000 },
        { from: 'b', to: 'c', cents: 1000 },
      ],
    })
  })
  it('needs no transfers when everyone paid their share', () => {
    const b = dinner([pay('a', '30'), pay('b', '20'), pay('c', '10')])
    expect(computeSettlement(b, computeBreakdown(b))).toEqual({ status: 'ok', transfers: [] })
  })
  it('reports no payers and invalid payments', () => {
    expect(computeSettlement(dinner([]), computeBreakdown(dinner([]))).status).toBe('no-payers')
    const bad = dinner([pay('a', '10')])
    expect(computeSettlement(bad, computeBreakdown(bad)).status).toBe('invalid')
  })
  it('balances always reconcile on rounded bills', () => {
    // 3-way split of 10.00 at 8.875% tax and 18% tip; Dan (no items) paid it all.
    const b: Bill = {
      ...emptyBill(),
      people,
      items: [{ id: 'x', name: 'Shared', priceCents: 1000, sharedBy: ['a', 'b', 'c'] }],
      taxPct: '8.875',
      payments: [],
    }
    const bd = computeBreakdown(b)
    b.payments = [pay('d', (bd.total / 100).toFixed(2))]
    const bal = computeBalances(b, bd)
    expect([...bal.values()].reduce((x, y) => x + y, 0)).toBe(0)
    const s = computeSettlement(b, bd)
    expect(s.status).toBe('ok')
    if (s.status === 'ok') {
      expect(s.transfers).toHaveLength(3)
      expect(s.transfers.every((t) => t.to === 'd')).toBe(true)
      expect(s.transfers.reduce((x, t) => x + t.cents, 0)).toBe(bd.total)
    }
  })
})

describe('payments in the bill model', () => {
  it('removing a person removes their payment', () => {
    const b = dinner([pay('a', '40'), pay('b', '20')])
    expect(removePerson(b, 'a').payments.map((p) => p.personId)).toEqual(['b'])
  })
  it('round-trips payments and drops ones for unknown people', () => {
    const b = dinner([pay('a', '60')])
    expect(deserializeBill(JSON.stringify(b))).toEqual(b)
    const r = deserializeBill(JSON.stringify({ ...b, payments: [pay('ghost', '1'), { id: 1 }, pay('a', '2')] }))
    expect(r.payments.map((p) => p.personId)).toEqual(['a'])
    // bills saved before payments existed still load
    const { payments: _omit, ...old } = b
    expect(deserializeBill(JSON.stringify(old)).payments).toEqual([])
  })
})

describe('summary with settle-up', () => {
  it('lists payers and transfers', () => {
    const b = dinner([pay('b', '60')])
    const s = buildSummary(b)
    expect(s).toContain('Paid by:\n- Ben: $60.00')
    expect(s).toContain('Settle up:\n- Anna pays Ben $30.00\n- Cat pays Ben $10.00')
  })
  it('says when nobody owes anything', () => {
    expect(buildSummary(dinner([pay('a', '30'), pay('b', '20'), pay('c', '10')]))).toContain('Settle up:\n- Everyone is even. No transfers needed.')
  })
  it('explains when payments do not add up', () => {
    expect(buildSummary(dinner([pay('a', '50')]))).toContain(
      'Settle up:\n- Not available: Payments add up to $50.00, but the bill total is $60.00. $10.00 is still unpaid.',
    )
  })
  it('omits the payment sections when nobody is recorded as paying', () => {
    const s = buildSummary(dinner([]))
    expect(s).not.toContain('Paid by')
    expect(s).not.toContain('Settle up')
  })
})
