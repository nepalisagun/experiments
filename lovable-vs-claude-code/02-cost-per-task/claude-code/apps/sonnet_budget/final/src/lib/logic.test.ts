import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CATEGORIES, addCategory, expensesByCategory, filterTxs, formatCents, inMonth, loadData, parseAmount,
  saveData, shiftMonth, toCsv, totals, validateTx, applyTx, dateForDay, isRepeating, materialise, stopRule,
  type AppData, type Transaction,
} from './logic'

const tx = (o: Partial<Transaction>): Transaction => ({ id: 'a', type: 'expense', cents: 100, categoryId: 'food', date: '2026-03-05', note: '', ...o })

describe('money', () => {
  it('parses without float errors', () => {
    expect(parseAmount('0.1')).toBe(10)
    expect(parseAmount('0.2')).toBe(20)
    expect(parseAmount('19.99')).toBe(1999)
    expect(parseAmount('1,5')).toBe(150)
    expect(parseAmount('12')).toBe(1200)
    expect(parseAmount('.5')).toBe(50)
  })
  it('rejects bad input', () => {
    for (const s of ['', 'abc', '1.234', '1e3', '.', '-1', '1.2.3']) expect(parseAmount(s)).toBeNull()
  })
  it('0.1 + 0.2 shows 0.30', () => {
    const t = totals([tx({ type: 'income', cents: parseAmount('0.1')! }), tx({ type: 'income', cents: parseAmount('0.2')! })])
    expect(formatCents(t.income)).toBe('0.30')
  })
  it('formats', () => {
    expect(formatCents(123456789)).toBe('1,234,567.89')
    expect(formatCents(-5)).toBe('-0.05')
    expect(formatCents(0)).toBe('0.00')
  })
})

describe('validation', () => {
  const ok = { type: 'expense' as const, amount: '5', categoryId: 'food', date: '2026-03-01', note: '' }
  it('accepts valid', () => expect(validateTx(ok, DEFAULT_CATEGORIES)).toEqual({ errors: {}, cents: 500 }))
  it('amount must be > 0', () => {
    expect(validateTx({ ...ok, amount: '0' }, DEFAULT_CATEGORIES).errors.amount).toMatch(/greater than zero/)
    expect(validateTx({ ...ok, amount: '-3' }, DEFAULT_CATEGORIES).errors.amount).toMatch(/greater than zero/)
    expect(validateTx({ ...ok, amount: '' }, DEFAULT_CATEGORIES).errors.amount).toMatch(/required/)
    expect(validateTx({ ...ok, amount: 'x' }, DEFAULT_CATEGORIES).errors.amount).toMatch(/valid amount/)
  })
  it('date required', () => expect(validateTx({ ...ok, date: '' }, DEFAULT_CATEGORIES).errors.date).toBe('Date is required.'))
  it('category must exist', () => expect(validateTx({ ...ok, categoryId: 'zzz' }, DEFAULT_CATEGORIES).errors.categoryId).toBeTruthy())
})

describe('months & aggregation', () => {
  it('shifts months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
  const txs = [
    tx({ id: '1', type: 'income', cents: 100000, categoryId: 'other' }),
    tx({ id: '2', cents: 2550 }),
    tx({ id: '3', cents: 450, note: 'Coffee' }),
    tx({ id: '4', cents: 999, date: '2026-04-01' }),
  ]
  it('scopes to month', () => expect(inMonth(txs, '2026-03')).toHaveLength(3))
  it('totals', () => expect(totals(inMonth(txs, '2026-03'))).toEqual({ income: 100000, expenses: 3000, balance: 97000 }))
  it('by category', () => expect(expensesByCategory(inMonth(txs, '2026-03'))).toEqual({ food: 3000 }))
  it('filters', () => {
    expect(filterTxs(txs, { categoryId: '', type: 'income', search: '' })).toHaveLength(1)
    expect(filterTxs(txs, { categoryId: 'food', type: '', search: 'COFF' })).toHaveLength(1)
    expect(filterTxs(txs, { categoryId: 'health', type: '', search: '' })).toHaveLength(0)
  })
})

describe('csv', () => {
  it('escapes and neutralises formulas', () => {
    const csv = toCsv([tx({ cents: 123456, note: 'a "b", c' }), tx({ id: 'b', note: '=SUM(A1)', date: '2026-03-01' })], DEFAULT_CATEGORIES)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Date,Type,Category,Amount,Note')
    expect(lines[1]).toBe("2026-03-01,expense,Food,1.00,'=SUM(A1)")
    expect(lines[2]).toBe('2026-03-05,expense,Food,1234.56,"a ""b"", c"')
  })
})

describe('categories & persistence', () => {
  it('adds and rejects duplicates', () => {
    const r = addCategory(DEFAULT_CATEGORIES, ' Pets ', '#000000')
    expect(r.categories).toHaveLength(7)
    expect(addCategory(r.categories, 'pets', '#fff').error).toBeTruthy()
    expect(addCategory(r.categories, '  ', '#fff').error).toBeTruthy()
  })
  it('round-trips through storage and survives corrupt data', () => {
    const mem: Record<string, string> = {}
    const st = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) }
    const data: AppData = { transactions: [tx({})], categories: DEFAULT_CATEGORIES, budgets: { food: 5000 }, recurring: [] }
    saveData(st, data)
    expect(loadData(st)).toEqual(data)
    mem['budget-tracker-v1'] = '{not json'
    expect(loadData(st).transactions).toEqual([])
  })
})

describe('recurring transactions', () => {
  const empty: AppData = { transactions: [], categories: DEFAULT_CATEGORIES, budgets: {}, recurring: [] }
  const withRule = (date = '2026-01-31', over: Partial<Transaction> = {}) =>
    applyTx(empty, tx({ id: 'o', date, cents: 5000, note: 'Gym', ...over }), true)
  const inM = (d: AppData, m: string) => d.transactions.filter((t) => t.date.startsWith(m))

  it('clamps the day in short months', () => {
    expect(dateForDay('2026-02', 31)).toBe('2026-02-28')
    expect(dateForDay('2028-02', 31)).toBe('2028-02-29')
    expect(dateForDay('2026-04', 31)).toBe('2026-04-30')
    expect(dateForDay('2026-03', 31)).toBe('2026-03-31')
    expect(dateForDay('2026-03', 15)).toBe('2026-03-15')
  })

  it('marking a transaction as repeating creates a rule linked to it', () => {
    const d = withRule()
    expect(d.recurring).toHaveLength(1)
    expect(d.recurring[0]).toMatchObject({ day: 31, startMonth: '2026-01', cents: 5000, generated: ['2026-01'] })
    expect(d.transactions[0].recurringId).toBe(d.recurring[0].id)
  })

  it('does not repeat when not marked', () => {
    const d = applyTx(empty, tx({}), false)
    expect(d.recurring).toHaveLength(0)
    expect(materialise(d, '2026-04')).toBe(d)
  })

  it('appears in later months on the same (clamped) day', () => {
    let d = withRule()
    d = materialise(d, '2026-02')
    d = materialise(d, '2026-03')
    d = materialise(d, '2026-04')
    expect(inM(d, '2026-02').map((t) => t.date)).toEqual(['2026-02-28'])
    expect(inM(d, '2026-03').map((t) => t.date)).toEqual(['2026-03-31'])
    expect(inM(d, '2026-04').map((t) => t.date)).toEqual(['2026-04-30'])
    expect(inM(d, '2026-02')[0]).toMatchObject({ cents: 5000, note: 'Gym', type: 'expense', categoryId: 'food' })
  })

  it('leap-year February gives the 29th', () => {
    const d = materialise(withRule('2027-12-31'), '2028-02')
    expect(inM(d, '2028-02')[0].date).toBe('2028-02-29')
  })

  it('never duplicates when a month is opened again', () => {
    let d = withRule()
    d = materialise(d, '2026-02')
    const again = materialise(d, '2026-02')
    expect(again).toBe(d)
    expect(d.transactions).toHaveLength(2)
    expect(materialise(materialise(d, '2026-02'), '2026-02').transactions).toHaveLength(2)
  })

  it('does not create the origin month again or earlier months', () => {
    const d = withRule('2026-03-10')
    expect(materialise(d, '2026-03')).toBe(d)
    expect(materialise(d, '2026-01')).toBe(d)
  })

  it('a deleted occurrence is not regenerated', () => {
    let d = materialise(withRule(), '2026-02')
    d = { ...d, transactions: d.transactions.filter((t) => !t.date.startsWith('2026-02')) }
    expect(materialise(d, '2026-02').transactions).toHaveLength(1)
  })

  it('opening a later month only creates that month', () => {
    const d = materialise(withRule(), '2026-05')
    expect(d.transactions).toHaveLength(2)
    expect(inM(d, '2026-05')).toHaveLength(1)
  })

  it('stop from a month keeps earlier months and removes that month on', () => {
    let d = withRule()
    for (const m of ['2026-02', '2026-03', '2026-04']) d = materialise(d, m)
    d = stopRule(d, d.recurring[0].id, '2026-03')
    expect(d.transactions.map((t) => t.date.slice(0, 7)).sort()).toEqual(['2026-01', '2026-02'])
    expect(d.recurring[0].endMonth).toBe('2026-03')
    expect(materialise(d, '2026-03')).toBe(d)
    expect(materialise(d, '2026-08')).toBe(d)
  })

  it('stopping before ever opening later months works', () => {
    let d = withRule()
    d = stopRule(d, d.recurring[0].id, '2026-04')
    d = materialise(d, '2026-03')
    expect(inM(d, '2026-03')).toHaveLength(1)
    expect(materialise(d, '2026-04')).toBe(d)
  })

  it('stopping again never extends an earlier stop', () => {
    let d = withRule()
    d = stopRule(d, d.recurring[0].id, '2026-03')
    d = stopRule(d, d.recurring[0].id, '2026-06')
    expect(d.recurring[0].endMonth).toBe('2026-03')
  })

  it('unchecking repeat on an occurrence stops from the next month', () => {
    let d = materialise(materialise(withRule(), '2026-02'), '2026-03')
    const feb = inM(d, '2026-02')[0]
    expect(isRepeating(d, feb)).toBe(true)
    d = applyTx(d, feb, false)
    expect(d.recurring[0].endMonth).toBe('2026-03')
    expect(inM(d, '2026-03')).toHaveLength(0)
    expect(inM(d, '2026-01')).toHaveLength(1)
    expect(isRepeating(d, inM(d, '2026-02')[0])).toBe(false)
  })

  it('re-checking repeat on the last occurrence resumes the rule', () => {
    let d = withRule()
    d = stopRule(d, d.recurring[0].id, '2026-02')
    d = applyTx(d, d.transactions[0], true)
    expect(d.recurring[0].endMonth).toBeUndefined()
    expect(inM(materialise(d, '2026-02'), '2026-02')).toHaveLength(1)
  })

  it('editing one occurrence leaves the others and the rule alone', () => {
    let d = materialise(withRule(), '2026-02')
    const feb = inM(d, '2026-02')[0]
    d = applyTx(d, { ...feb, cents: 9999 }, true)
    expect(inM(d, '2026-01')[0].cents).toBe(5000)
    expect(inM(d, '2026-02')[0].cents).toBe(9999)
    expect(d.recurring[0].cents).toBe(5000)
    expect(d.recurring).toHaveLength(1)
  })

  it('turning repeat on for an existing plain transaction', () => {
    const base = applyTx(empty, tx({ id: 'p', date: '2026-05-15' }), false)
    const d = applyTx(base, base.transactions[0], true)
    expect(d.recurring[0]).toMatchObject({ day: 15, startMonth: '2026-05' })
    expect(d.transactions).toHaveLength(1)
    expect(inM(materialise(d, '2026-06'), '2026-06')[0].date).toBe('2026-06-15')
  })

  it('persists rules through storage', () => {
    const mem: Record<string, string> = {}
    const st = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) }
    const d = stopRule(materialise(withRule(), '2026-02'), 'rec_o', '2026-04')
    saveData(st, d)
    expect(loadData(st)).toEqual(d)
    expect(materialise(loadData(st), '2026-02')).toEqual(loadData(st))
  })

  it('old saved data without recurring loads fine', () => {
    const st = { getItem: () => JSON.stringify({ transactions: [], categories: DEFAULT_CATEGORIES, budgets: {} }) }
    expect(loadData(st).recurring).toEqual([])
  })
})
