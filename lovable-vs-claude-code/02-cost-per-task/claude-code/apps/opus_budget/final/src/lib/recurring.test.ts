import { describe, expect, it } from 'vitest'
import { type AppData, type Transaction, defaultData, forMonth, monthOf, parseStored, totals } from './budget.ts'
import { daysInMonth, isActiveIn, materialize, occurrenceDate, occurrencesFrom, saveTransaction, stopRule } from './recurring.ts'

let n = 0
const id = () => `id${++n}`

const rent = { type: 'expense' as const, amountCents: 120000, categoryId: 'housing', date: '2026-01-31', note: 'Rent' }

function withRent(): AppData {
  const r = saveTransaction(defaultData(), rent, { editingId: null, repeat: true }, id)
  if (!r.ok) throw new Error(r.error)
  return r.data
}

const dates = (d: AppData, ruleId?: string) =>
  d.transactions
    .filter((t) => (ruleId ? t.recurringId === ruleId : true))
    .map((t) => t.date)
    .sort()

describe('dates', () => {
  it('knows month lengths incl. leap years', () => {
    expect(daysInMonth('2026-01')).toBe(31)
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-04')).toBe(30)
    expect(daysInMonth('2026-12')).toBe(31)
  })

  it('clamps the day to the last day of short months', () => {
    expect(occurrenceDate('2026-02', 31)).toBe('2026-02-28')
    expect(occurrenceDate('2028-02', 31)).toBe('2028-02-29')
    expect(occurrenceDate('2026-04', 31)).toBe('2026-04-30')
    expect(occurrenceDate('2026-05', 31)).toBe('2026-05-31')
    expect(occurrenceDate('2026-02', 29)).toBe('2026-02-28')
    expect(occurrenceDate('2026-02', 15)).toBe('2026-02-15')
  })
})

describe('creating a repeating transaction', () => {
  it('creates a rule and its first occurrence', () => {
    const d = withRent()
    expect(d.recurring).toHaveLength(1)
    const rule = d.recurring[0]
    expect(rule).toMatchObject({ dayOfMonth: 31, startMonth: '2026-01', endMonth: null, generatedThrough: '2026-01', amountCents: 120000 })
    expect(d.transactions).toHaveLength(1)
    expect(d.transactions[0].recurringId).toBe(rule.id)
  })

  it('a one-off stays a one-off', () => {
    const r = saveTransaction(defaultData(), rent, { editingId: null, repeat: false }, id)
    if (!r.ok) throw new Error()
    expect(r.data.recurring).toHaveLength(0)
    expect(r.data.transactions[0].recurringId).toBeUndefined()
  })
})

describe('materialize', () => {
  it('fills every month up to the opened one, on the same (clamped) day', () => {
    const d = materialize(withRent(), '2026-05', id)
    expect(dates(d)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
    expect(d.recurring[0].generatedThrough).toBe('2026-05')
    expect(d.transactions.every((t) => t.amountCents === 120000 && t.note === 'Rent' && t.categoryId === 'housing')).toBe(true)
  })

  it('handles leap-year February', () => {
    const r = saveTransaction(defaultData(), { ...rent, date: '2027-12-30' }, { editingId: null, repeat: true }, id)
    if (!r.ok) throw new Error()
    expect(dates(materialize(r.data, '2028-03', id))).toEqual(['2027-12-30', '2028-01-30', '2028-02-29', '2028-03-30'])
  })

  it('never duplicates when the same or an earlier month is opened again', () => {
    const once = materialize(withRent(), '2026-03', id)
    expect(materialize(once, '2026-03', id)).toBe(once) // same object: no change at all
    expect(materialize(once, '2026-02', id)).toBe(once)
    expect(materialize(once, '2026-01', id)).toBe(once)
    const later = materialize(once, '2026-04', id)
    expect(dates(later)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(forMonth(materialize(later, '2026-04', id).transactions, '2026-03')).toHaveLength(1)
  })

  it('does nothing before the start month', () => {
    const d = withRent()
    expect(materialize(d, '2025-12', id)).toBe(d)
  })

  it('does not bring back an occurrence the user deleted', () => {
    const d = materialize(withRent(), '2026-03', id)
    const feb = d.transactions.find((t) => t.date === '2026-02-28')!
    const without = { ...d, transactions: d.transactions.filter((t) => t.id !== feb.id) }
    expect(dates(materialize(without, '2026-03', id))).toEqual(['2026-01-31', '2026-03-31'])
    expect(dates(materialize(without, '2026-04', id))).toEqual(['2026-01-31', '2026-03-31', '2026-04-30'])
  })

  it('leaves non-recurring transactions alone and counts occurrences in totals', () => {
    let d = withRent()
    const r = saveTransaction(d, { type: 'income', amountCents: 300000, categoryId: 'other', date: '2026-02-01', note: 'Salary' }, { editingId: null, repeat: false }, id)
    if (!r.ok) throw new Error()
    d = materialize(r.data, '2026-02', id)
    expect(totals(forMonth(d.transactions, '2026-02'))).toEqual({ income: 300000, expenses: 120000, balance: 180000 })
    expect(forMonth(d.transactions, '2026-03')).toHaveLength(0)
  })
})

describe('stopRule', () => {
  it('stops from a chosen month on and keeps earlier months unchanged', () => {
    const d = materialize(withRent(), '2026-06', id)
    const ruleId = d.recurring[0].id
    const before = d.transactions.filter((t) => monthOf(t.date) < '2026-04')
    const stopped = stopRule(d, ruleId, '2026-04')
    expect(dates(stopped)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(stopped.transactions.filter((t) => monthOf(t.date) < '2026-04')).toEqual(before)
    expect(stopped.recurring[0].endMonth).toBe('2026-04')
    expect(isActiveIn(stopped.recurring[0], '2026-03')).toBe(true)
    expect(isActiveIn(stopped.recurring[0], '2026-04')).toBe(false)
    // Opening later months doesn't regenerate
    expect(dates(materialize(stopped, '2027-01', id))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('stopping from a month not yet generated prevents it ever appearing', () => {
    const d = materialize(withRent(), '2026-02', id)
    const stopped = stopRule(d, d.recurring[0].id, '2026-05')
    expect(dates(materialize(stopped, '2026-12', id))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('stopping again from an earlier month moves the end earlier, never later', () => {
    const d = materialize(withRent(), '2026-06', id)
    const ruleId = d.recurring[0].id
    const a = stopRule(d, ruleId, '2026-05')
    expect(stopRule(a, ruleId, '2026-03').recurring[0].endMonth).toBe('2026-03')
    expect(stopRule(a, ruleId, '2026-06').recurring[0].endMonth).toBe('2026-05')
  })

  it('stopping from the first month removes the rule and all its occurrences', () => {
    const d = materialize(withRent(), '2026-03', id)
    const stopped = stopRule(d, d.recurring[0].id, '2026-01')
    expect(stopped.recurring).toHaveLength(0)
    expect(stopped.transactions).toHaveLength(0)
  })

  it('counts what will be removed', () => {
    const d = materialize(withRent(), '2026-06', id)
    expect(occurrencesFrom(d, d.recurring[0].id, '2026-04')).toHaveLength(3)
  })

  it('ignores unknown rules', () => {
    const d = withRent()
    expect(stopRule(d, 'nope', '2026-01')).toBe(d)
  })
})

describe('editing', () => {
  const find = (d: AppData, date: string) => d.transactions.find((t) => t.date === date) as Transaction

  it('turns an existing one-off into a repeating transaction', () => {
    const r1 = saveTransaction(defaultData(), { ...rent, date: '2026-03-15' }, { editingId: null, repeat: false }, id)
    if (!r1.ok) throw new Error()
    const tx = r1.data.transactions[0]
    const r2 = saveTransaction(r1.data, { ...rent, date: '2026-03-15' }, { editingId: tx.id, repeat: true }, id)
    if (!r2.ok) throw new Error()
    expect(r2.data.transactions).toHaveLength(1)
    expect(r2.data.transactions[0].id).toBe(tx.id)
    expect(r2.data.recurring[0]).toMatchObject({ startMonth: '2026-03', dayOfMonth: 15 })
    expect(dates(materialize(r2.data, '2026-05', id))).toEqual(['2026-03-15', '2026-04-15', '2026-05-15'])
  })

  it('editing an occurrence updates it and later months, not earlier ones', () => {
    const d = materialize(withRent(), '2026-05', id)
    const mar = find(d, '2026-03-31')
    const r = saveTransaction(d, { ...rent, amountCents: 130000, date: '2026-03-15', note: 'Rent (new)' }, { editingId: mar.id, repeat: true }, id)
    if (!r.ok) throw new Error()
    const byMonth = (m: string) => forMonth(r.data.transactions, m)[0]
    expect(byMonth('2026-01')).toMatchObject({ amountCents: 120000, date: '2026-01-31', note: 'Rent' })
    expect(byMonth('2026-02')).toMatchObject({ amountCents: 120000, date: '2026-02-28', note: 'Rent' })
    expect(byMonth('2026-03')).toMatchObject({ amountCents: 130000, date: '2026-03-15', note: 'Rent (new)' })
    expect(byMonth('2026-04')).toMatchObject({ amountCents: 130000, date: '2026-04-15', note: 'Rent (new)' })
    expect(byMonth('2026-05')).toMatchObject({ amountCents: 130000, date: '2026-05-15' })
    // New months use the new template
    expect(forMonth(materialize(r.data, '2026-06', id).transactions, '2026-06')[0]).toMatchObject({ amountCents: 130000, date: '2026-06-15' })
    expect(r.data.transactions).toHaveLength(5)
  })

  it('refuses to move a repeating occurrence to a different month', () => {
    const d = materialize(withRent(), '2026-02', id)
    const r = saveTransaction(d, { ...rent, date: '2026-03-01' }, { editingId: find(d, '2026-02-28').id, repeat: true }, id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('date')
  })

  it('unticking repeat keeps this one as a one-off and stops the rule from this month on', () => {
    const d = materialize(withRent(), '2026-05', id)
    const mar = find(d, '2026-03-31')
    const r = saveTransaction(d, { ...rent, date: '2026-03-31', note: 'Last rent' }, { editingId: mar.id, repeat: false }, id)
    if (!r.ok) throw new Error()
    expect(dates(r.data)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    const kept = find(r.data, '2026-03-31')
    expect(kept.recurringId).toBeUndefined()
    expect(kept.note).toBe('Last rent')
    expect(r.data.recurring[0].endMonth).toBe('2026-03')
    expect(dates(materialize(r.data, '2026-09', id))).toHaveLength(3)
  })

  it('unticking repeat on the first occurrence removes the rule but keeps the transaction', () => {
    const d = materialize(withRent(), '2026-03', id)
    const jan = find(d, '2026-01-31')
    const r = saveTransaction(d, { ...rent }, { editingId: jan.id, repeat: false }, id)
    if (!r.ok) throw new Error()
    expect(r.data.recurring).toHaveLength(0)
    expect(r.data.transactions).toHaveLength(1)
    expect(r.data.transactions[0].recurringId).toBeUndefined()
  })
})

describe('persistence of rules', () => {
  it('round-trips rules and drops malformed ones', () => {
    const d = materialize(withRent(), '2026-03', id)
    const back = parseStored(JSON.stringify(d))
    expect(back.recurring).toEqual(d.recurring)
    expect(back.transactions).toEqual(d.transactions)
    const bad = parseStored(JSON.stringify({ ...d, recurring: [{ ...d.recurring[0], dayOfMonth: 40 }, { id: 'x' }] }))
    expect(bad.recurring).toEqual([])
  })

  it('old data without rules still loads', () => {
    expect(parseStored(JSON.stringify({ transactions: [], categories: [] })).recurring).toEqual([])
  })
})
