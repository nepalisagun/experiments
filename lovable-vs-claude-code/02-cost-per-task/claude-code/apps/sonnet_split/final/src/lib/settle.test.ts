import { describe, expect, it } from 'vitest'
import { buildSummary, checkPayments, emptyBill, paymentMessage, parsePayment, settlement, transferText, loadBill, type Bill } from './bill'
import { minTransfers } from './settle'

/** Independent brute force: fewest transfers by trying every pairing of the first open debt. */
function bruteMin(b: number[]): number {
  const a = b.filter((x) => x !== 0)
  function go(i: number): number {
    while (i < a.length && a[i] === 0) i++
    if (i === a.length) return 0
    let best = Infinity
    const seen = new Set<number>()
    for (let j = i + 1; j < a.length; j++) {
      if (a[i] * a[j] < 0 && !seen.has(a[j])) {
        seen.add(a[j])
        a[j] += a[i]
        const saved = a[i]
        a[i] = 0
        best = Math.min(best, 1 + go(i + 1))
        a[i] = saved
        a[j] -= saved
      }
    }
    return best
  }
  return go(0)
}

function applies(balances: number[]) {
  const t = minTransfers(balances)
  const after = [...balances]
  for (const x of t) {
    expect(x.cents).toBeGreaterThan(0)
    expect(x.from).not.toBe(x.to)
    after[x.from] += x.cents
    after[x.to] -= x.cents
  }
  expect(after.every((v) => v === 0)).toBe(true)
  return t
}

describe('minTransfers', () => {
  it('handles trivial cases', () => {
    expect(minTransfers([])).toEqual([])
    expect(minTransfers([0, 0, 0])).toEqual([])
    expect(minTransfers([-500, 500])).toEqual([{ from: 0, to: 1, cents: 500 }])
  })
  it('one creditor, many debtors', () => {
    const t = applies([3000, -1000, -1000, -1000])
    expect(t).toHaveLength(3)
  })
  it('finds independent sub-groups (fewer than n-1 transfers)', () => {
    // {+5,-5} and {+7,-3,-4} are separate: 1 + 2 = 3 transfers, not 4
    const t = applies([500, -500, 700, -300, -400])
    expect(t).toHaveLength(3)
  })
  it('matches brute-force minimum on random inputs', () => {
    let seed = 12345
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let n = 0; n < 400; n++) {
      const size = 2 + rnd(6)
      const b = Array.from({ length: size - 1 }, () => rnd(21) - 10)
      b.push(-b.reduce((x, y) => x + y, 0))
      const t = applies(b)
      expect(t.length).toBe(bruteMin(b))
    }
  })
  it('falls back gracefully for large groups', () => {
    const b = Array.from({ length: 25 }, (_, i) => (i === 0 ? 2400 : -100))
    const t = applies(b)
    expect(t).toHaveLength(24)
  })
})

const base = (over: Partial<Bill> = {}): Bill => ({
  ...emptyBill(),
  tip: '0',
  people: [
    { id: 'a', name: 'Anna' },
    { id: 'b', name: 'Ben' },
    { id: 'c', name: 'Cleo' },
  ],
  items: [
    { id: '1', name: 'Pizza', cents: 3000, people: ['a', 'b', 'c'] }, // 10 each
    { id: '2', name: 'Wine', cents: 2480, people: ['a'] }, // Anna +24.80
  ],
  ...over,
})

describe('parsePayment', () => {
  it('parses and words errors as amounts', () => {
    expect(parsePayment('12,40').cents).toBe(1240)
    expect(parsePayment('').error).toBe('Enter the amount paid.')
    expect(parsePayment('-1').error).toBe('Amount cannot be negative.')
    expect(parsePayment('0').error).toMatch(/Amount must be greater than zero/)
  })
})

describe('checkPayments', () => {
  it('reports none / short / over / ok / invalid', () => {
    expect(checkPayments(base()).status).toBe('none')
    expect(checkPayments(base({ payers: [{ personId: 'a', amount: '50' }] }))).toMatchObject({ status: 'short', diff: 480 })
    expect(checkPayments(base({ payers: [{ personId: 'a', amount: '60' }] }))).toMatchObject({ status: 'over', diff: -520 })
    expect(checkPayments(base({ payers: [{ personId: 'a', amount: '54.80' }] })).status).toBe('ok')
    expect(checkPayments(base({ payers: [{ personId: 'a', amount: '-4' }] })).status).toBe('invalid')
  })
  it('messages are clear', () => {
    const c = checkPayments(base({ payers: [{ personId: 'a', amount: '50' }] }))
    expect(paymentMessage(c, 'USD')).toBe('Payments add up to $50.00, but the bill total is $54.80. $4.80 is still unaccounted for.')
    const o = checkPayments(base({ payers: [{ personId: 'a', amount: '60' }] }))
    expect(paymentMessage(o, 'USD')).toContain('$5.20 too much')
  })
  it('multiple payers must sum to total', () => {
    const b = base({
      payers: [
        { personId: 'a', amount: '30' },
        { personId: 'b', amount: '24.80' },
      ],
    })
    expect(checkPayments(b).status).toBe('ok')
  })
})

describe('settlement', () => {
  it('is null until payments match', () => {
    expect(settlement(base())).toBeNull()
    expect(settlement(base({ payers: [{ personId: 'a', amount: '1' }] }))).toBeNull()
  })
  it('single payer: everyone else pays them', () => {
    const t = settlement(base({ payers: [{ personId: 'a', amount: '54.80' }] }))!
    expect(t.map((x) => transferText(x, 'USD'))).toEqual(['Ben pays Anna $10.00', 'Cleo pays Anna $10.00'])
  })
  it('multiple payers net out', () => {
    const t = settlement(
      base({
        payers: [
          { personId: 'b', amount: '44.80' },
          { personId: 'c', amount: '10' },
        ],
      }),
    )!
    // shares: Anna 34.80, Ben 10, Cleo 10; paid: Ben 44.80, Cleo 10 -> Anna owes Ben 34.80
    expect(t.map((x) => transferText(x, 'USD'))).toEqual(['Anna pays Ben $34.80'])
  })
  it('nobody owes when everyone paid their own share', () => {
    const t = settlement(
      base({
        payers: [
          { personId: 'a', amount: '34.80' },
          { personId: 'b', amount: '10' },
          { personId: 'c', amount: '10' },
        ],
      }),
    )!
    expect(t).toEqual([])
  })
  it('rounded cents settle exactly', () => {
    const b = base({
      tax: '7.5',
      tip: '18',
      items: [{ id: '1', name: 'Pizza', cents: 1000, people: ['a', 'b', 'c'] }],
      payers: [{ personId: 'c', amount: '12.55' }], // 10.00 + 0.75 + 1.80 = 12.55
    })
    const t = settlement(b)!
    expect(t.reduce((s, x) => s + x.cents, 0)).toBe(1255 - 418) // Cleo's own share is 4.18ish; others pay the rest
    expect(t.every((x) => x.to.id === 'c')).toBe(true)
  })
  it('formats by currency', () => {
    const t = settlement(base({ currency: 'EUR', payers: [{ personId: 'a', amount: '54,80' }] }))!
    expect(transferText(t[0], 'EUR')).toContain('Ben pays Anna 10,00')
  })
})

describe('summary with settle-up', () => {
  it('includes transfers', () => {
    const s = buildSummary(base({ payers: [{ personId: 'a', amount: '54.80' }] }))
    expect(s).toContain('Paid by:')
    expect(s).toContain('Anna: $54.80')
    expect(s).toContain('Settle up:')
    expect(s).toContain('Ben pays Anna $10.00')
    expect(s).toContain('Cleo pays Anna $10.00')
  })
  it('explains when payments do not match', () => {
    const s = buildSummary(base({ payers: [{ personId: 'a', amount: '10' }] }))
    expect(s).toContain('unaccounted for')
  })
  it('omits the section when no payers', () => {
    expect(buildSummary(base())).not.toContain('Settle up')
  })
})

describe('payers persistence', () => {
  it('keeps valid payers, drops unknown/duplicate', () => {
    const b = base({
      payers: [
        { personId: 'a', amount: '5' },
        { personId: 'a', amount: '6' },
        { personId: 'zzz', amount: '7' },
      ],
    })
    expect(loadBill(JSON.stringify(b)).payers).toEqual([{ personId: 'a', amount: '5' }])
    expect(loadBill('{"payers":"x"}').payers).toEqual([])
  })
})
