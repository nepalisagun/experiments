import { describe, expect, it } from 'vitest'
import { formatCents, parseAmount } from './money'
import {
  DEFAULT_CATEGORIES as CATS, applyFilters, expensesByCategory, inMonth, isValidDate, loadData,
  saveData, shiftMonth, toCSV, totals, validateForm, STORAGE_KEY, type Transaction,
} from './budget'

const tx = (o: Partial<Transaction>): Transaction => ({ id: 'x' + Math.random(), type: 'expense', amount: 100, categoryId: 'food', date: '2026-11-05', note: '', ...o })

describe('money', () => {
  it('parses amounts to integer cents', () => {
    expect(parseAmount('0.1')).toBe(10)
    expect(parseAmount('12')).toBe(1200)
    expect(parseAmount('12,5')).toBe(1250)
    expect(parseAmount('1,234.56')).toBe(123456)
    expect(parseAmount('1.234,56')).toBe(123456)
    expect(parseAmount('19.99')).toBe(1999)
    expect(parseAmount('1.005')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('-5')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
  it('0.1 + 0.2 shows 0.30', () => {
    const sum = parseAmount('0.1')! + parseAmount('0.2')!
    expect(formatCents(sum)).toBe('0.30')
  })
  it('formats', () => {
    expect(formatCents(0)).toBe('0.00')
    expect(formatCents(5)).toBe('0.05')
    expect(formatCents(123456789)).toBe('1,234,567.89')
    expect(formatCents(-250)).toBe('-2.50')
  })
})

describe('validation', () => {
  const base = { type: 'expense' as const, amount: '5', categoryId: 'food', date: '2026-11-05', note: ' hi ', repeat: false }
  it('accepts valid and trims note', () => {
    const r = validateForm(base, CATS)
    expect(r.ok && r.value).toMatchObject({ amount: 500, note: 'hi' })
  })
  it('rejects zero / negative / empty amount', () => {
    for (const a of ['0', '0.00', '-3', '']) expect(validateForm({ ...base, amount: a }, CATS).ok).toBe(false)
    const r = validateForm({ ...base, amount: '0' }, CATS)
    expect(!r.ok && r.errors.amount).toBe('Amount must be greater than zero.')
    const n = validateForm({ ...base, amount: '-4' }, CATS)
    expect(!n.ok && n.errors.amount).toBe('Amount must be greater than zero.')
    const j = validateForm({ ...base, amount: 'abc' }, CATS)
    expect(!j.ok && j.errors.amount).toMatch(/at most 2 decimals/)
  })
  it('requires a real date', () => {
    expect(validateForm({ ...base, date: '' }, CATS)).toMatchObject({ ok: false, errors: { date: 'Pick a date.' } })
    expect(validateForm({ ...base, date: '2026-02-30' }, CATS).ok).toBe(false)
    expect(isValidDate('2024-02-29')).toBe(true)
  })
})

describe('calculations', () => {
  const txs = [
    tx({ type: 'income', amount: 10, categoryId: 'other' }),
    tx({ amount: 20, note: 'Coffee' }),
    tx({ amount: 30, categoryId: 'fun', note: 'Cinema' }),
    tx({ amount: 999, date: '2026-12-01' }),
  ]
  it('month filter and totals', () => {
    const m = inMonth(txs, '2026-11')
    expect(m).toHaveLength(3)
    expect(totals(m)).toEqual({ income: 10, expenses: 50, balance: -40 })
  })
  it('totals avoid float error', () => {
    const t = totals([tx({ amount: 10 }), tx({ amount: 20 })])
    expect(formatCents(t.expenses)).toBe('0.30')
  })
  it('expenses by category ignore income', () => {
    expect(expensesByCategory(txs.slice(0, 3))).toEqual({ food: 20, fun: 30 })
  })
  it('filters by category, type, note search', () => {
    const m = inMonth(txs, '2026-11')
    expect(applyFilters(m, { categoryId: 'fun', type: 'all', search: '' })).toHaveLength(1)
    expect(applyFilters(m, { categoryId: 'all', type: 'income', search: '' })).toHaveLength(1)
    expect(applyFilters(m, { categoryId: 'all', type: 'all', search: 'COFF' })).toHaveLength(1)
  })
  it('shifts months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})

describe('csv', () => {
  it('exports with escaping and formula guard', () => {
    const csv = toCSV([tx({ amount: 1050, note: 'a "b", c' }), tx({ amount: 5, note: '=SUM(A1)', date: '2026-11-01' })], CATS)
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('Date,Type,Category,Amount,Note')
    expect(lines[1]).toBe("2026-11-01,expense,Food,0.05,'=SUM(A1)")
    expect(lines[2]).toBe('2026-11-05,expense,Food,10.50,"a ""b"", c"')
  })
})

describe('persistence', () => {
  it('round-trips and survives corrupt data', () => {
    const store: Record<string, string> = {}
    const s = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
    const data = { transactions: [tx({ id: 'a' })], categories: CATS, budgets: { food: 5000 }, recurring: [] }
    saveData(data, s)
    expect(loadData(s)).toEqual(data)
    store[STORAGE_KEY] = '{not json'
    expect(loadData(s).transactions).toEqual([])
  })
})
