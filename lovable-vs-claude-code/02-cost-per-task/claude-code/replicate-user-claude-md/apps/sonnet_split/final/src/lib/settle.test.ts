import { describe, expect, it } from 'vitest'
import {
  allocate, buildSummary, calculate, checkPayments, emptyBill, loadBill, minTransfers, saveBill, settleUp, type Bill,
} from './split'

const bill = (over: Partial<Bill> = {}): Bill => ({
  ...emptyBill(),
  tipInput: '',
  people: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Cy' }],
  ...over,
})

describe('checkPayments', () => {
  const b = (payers: Bill['payers']) =>
    bill({ payers, items: [{ id: '1', name: 'x', cents: 5000, people: ['a', 'b'] }], taxInput: '10' }) // total 55.00
  const chk = (bb: Bill) => checkPayments(bb, calculate(bb))
  it('accepts payments that add up to the bill total', () => {
    const c = chk(b([{ personId: 'a', amount: '30' }, { personId: 'b', amount: '25.00' }]))
    expect(c.ok).toBe(true)
    expect(c.sumError).toBeUndefined()
  })
  it('explains a shortfall and an overpayment', () => {
    expect(chk(b([{ personId: 'a', amount: '50' }])).sumError).toBe('Payments add up to $50.00, which is $5.00 less than the bill total of $55.00.')
    expect(chk(b([{ personId: 'a', amount: '60' }])).sumError).toBe('Payments add up to $60.00, which is $5.00 more than the bill total of $55.00.')
    expect(chk(b([{ personId: 'a', amount: '50' }])).ok).toBe(false)
  })
  it('flags bad rows', () => {
    const c = chk(b([{ personId: 'a', amount: '-5' }, { personId: 'a', amount: '10' }, { personId: 'zz', amount: '1' }, { personId: 'b', amount: '' }]))
    expect(c.rows[0].error).toMatch(/negative/)
    expect(c.rows[1].error).toMatch(/already listed/)
    expect(c.rows[2].error).toMatch(/Pick who paid/)
    expect(c.rows[3].error).toMatch(/Enter an amount/)
    expect(c.ok).toBe(false)
    expect(c.sumError).toBeUndefined() // row errors come first
  })
  it('is not ok with no payers', () => {
    expect(chk(b([])).ok).toBe(false)
  })
})

type Bal = { id: string; cents: number }
const net = (bals: Bal[], ts: ReturnType<typeof minTransfers>) => {
  const m = new Map(bals.map((x) => [x.id, x.cents]))
  for (const t of ts) { m.set(t.from, m.get(t.from)! + t.cents); m.set(t.to, m.get(t.to)! - t.cents) }
  return [...m.values()]
}
/** independent reference: max number of zero-sum blocks over all set partitions */
function maxZeroBlocks(v: number[]): number {
  if (v.length === 0) return 0
  const [first, ...rest] = v
  let best = 0
  for (let mask = 0; mask < 1 << rest.length; mask++) {
    let s = first
    const left: number[] = []
    rest.forEach((x, i) => (mask & (1 << i) ? (s += x) : left.push(x)))
    if (s === 0) best = Math.max(best, 1 + maxZeroBlocks(left))
  }
  return best
}

describe('minTransfers', () => {
  it('handles trivial cases', () => {
    expect(minTransfers([])).toEqual([])
    expect(minTransfers([{ id: 'a', cents: 0 }, { id: 'b', cents: 0 }])).toEqual([])
    expect(minTransfers([{ id: 'a', cents: 1240 }, { id: 'b', cents: -1240 }])).toEqual([{ from: 'b', to: 'a', cents: 1240 }])
  })
  it('separates independent groups', () => {
    // {a,d} and {b,c,e} settle separately: 3 transfers, not 4
    const bals = [{ id: 'a', cents: 1000 }, { id: 'b', cents: 600 }, { id: 'c', cents: -300 }, { id: 'd', cents: -1000 }, { id: 'e', cents: -300 }]
    const ts = minTransfers(bals)
    expect(ts).toHaveLength(3)
    expect(net(bals, ts).every((x) => x === 0)).toBe(true)
  })
  it('settles everyone exactly and matches an independent minimum for random cases', () => {
    for (let n = 0; n < 300; n++) {
      const k = 2 + Math.floor(Math.random() * 6)
      const vals = Array.from({ length: k - 1 }, () => Math.floor(Math.random() * 21) - 10)
      vals.push(-vals.reduce((a, b) => a + b, 0))
      const bals = vals.map((cents, i) => ({ id: 'p' + i, cents }))
      const ts = minTransfers(bals)
      expect(net(bals, ts).every((x) => x === 0)).toBe(true)
      expect(ts.every((t) => t.cents > 0 && t.from !== t.to)).toBe(true)
      const nz = vals.filter((x) => x !== 0)
      expect(ts.length).toBe(nz.length === 0 ? 0 : nz.length - maxZeroBlocks(nz))
    }
  })
  it('falls back to a valid greedy settle for large groups', () => {
    const vals = Array.from({ length: 24 }, (_, i) => (i % 2 ? -(i * 7 + 3) : i * 7 + 3))
    vals.push(-vals.reduce((a, b) => a + b, 0))
    const bals = vals.map((cents, i) => ({ id: 'p' + i, cents }))
    const ts = minTransfers(bals)
    expect(net(bals, ts).every((x) => x === 0)).toBe(true)
    expect(ts.length).toBeLessThanOrEqual(bals.filter((x) => x.cents).length - 1)
  })
})

describe('settleUp', () => {
  it('writes who pays whom, from payments and shares', () => {
    // Pizza 30 (Ann, Bob) + Wine 20 (Cy): owes 15/15/20. Ann paid all 50.
    const b = bill({
      items: [{ id: '1', name: 'Pizza', cents: 3000, people: ['a', 'b'] }, { id: '2', name: 'Wine', cents: 2000, people: ['c'] }],
      payers: [{ personId: 'a', amount: '50' }],
    })
    const s = settleUp(b, calculate(b))
    expect(s.transfers.map((t) => `${t.fromName} pays ${t.toName} ${t.cents}`).sort()).toEqual(['Bob pays Ann 1500', 'Cy pays Ann 2000'])
  })
  it('multiple payers net out against what they owe', () => {
    const b = bill({
      items: [{ id: '1', name: 'x', cents: 3000, people: ['a', 'b', 'c'] }], // 10 each
      payers: [{ personId: 'a', amount: '20' }, { personId: 'b', amount: '10' }],
    })
    const s = settleUp(b, calculate(b))
    expect(s.transfers).toHaveLength(1)
    expect(s.transfers[0]).toMatchObject({ fromName: 'Cy', toName: 'Ann', cents: 1000 })
  })
  it('is empty when everyone paid their own share, or payments are invalid', () => {
    const items = [{ id: '1', name: 'x', cents: 3000, people: ['a', 'b', 'c'] }]
    const even = bill({ items, payers: ['a', 'b', 'c'].map((personId) => ({ personId, amount: '10' })) })
    const s = settleUp(even, calculate(even))
    expect(s.check.ok).toBe(true)
    expect(s.transfers).toEqual([])
    const bad = bill({ items, payers: [{ personId: 'a', amount: '5' }] })
    expect(settleUp(bad, calculate(bad)).transfers).toEqual([])
  })
  it('random bills: after the transfers everybody has paid exactly their total', () => {
    let checked = 0
    for (let n = 0; n < 300; n++) {
      const people = Array.from({ length: 2 + Math.floor(Math.random() * 6) }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
      const items = Array.from({ length: 1 + Math.floor(Math.random() * 6) }, (_, i) => ({
        id: 'i' + i, name: 'x', cents: 100 + Math.floor(Math.random() * 9999),
        people: [people[0].id, ...people.slice(1).filter(() => Math.random() < 0.5).map((p) => p.id)],
      }))
      const b0 = { ...emptyBill(), people, items, taxInput: '8.25' }
      const r = calculate(b0)
      const payers = people.filter(() => Math.random() < 0.5)
      if (!payers.length) payers.push(people[0])
      const w = allocate(r.total, payers.map(() => 1 + Math.floor(Math.random() * 9)))
      if (w.some((x) => x === 0)) continue
      const bb = { ...b0, payers: payers.map((p, i) => ({ personId: p.id, amount: (w[i] / 100).toFixed(2) })) }
      const s = settleUp(bb, r)
      expect(s.check.ok).toBe(true)
      const bal = r.people.map((p) => ({ id: p.id, cents: (w[payers.findIndex((x) => x.id === p.id)] ?? 0) - p.total }))
      expect(net(bal, s.transfers).every((x) => x === 0)).toBe(true)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })
})

describe('summary and persistence with payers', () => {
  const base = () => bill({
    items: [{ id: '1', name: 'Pizza', cents: 3000, people: ['a', 'b'] }],
    payers: [{ personId: 'a', amount: '30' }],
  })
  it('includes Paid by and Settle up transfers', () => {
    const b = base()
    const s = buildSummary(b, calculate(b))
    expect(s).toContain('Paid by:\n- Ann: $30.00')
    expect(s).toContain('Settle up:\n- Bob pays Ann $15.00')
  })
  it('says why settle up is missing', () => {
    const b = { ...base(), payers: [{ personId: 'a', amount: '10' }] }
    expect(buildSummary(b, calculate(b))).toContain('Settle up: not available. Payments add up to $10.00, which is $20.00 less than the bill total of $30.00.')
    const none = { ...b, payers: [] }
    expect(buildSummary(none, calculate(none))).toContain('Settle up: no payments recorded.')
  })
  it('round-trips payers and tolerates old saves without them', () => {
    const store: Record<string, string> = {}
    const st = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
    const b = base()
    saveBill(b, st)
    expect(loadBill(st).payers).toEqual(b.payers)
    expect(loadBill({ getItem: () => JSON.stringify({ people: [], items: [], tipInput: '15' }) }).payers).toEqual([])
    expect(loadBill({ getItem: () => JSON.stringify({ payers: [{ personId: 1 }, { personId: 'a', amount: '5' }] }) }).payers).toEqual([{ personId: 'a', amount: '5' }])
  })
})
