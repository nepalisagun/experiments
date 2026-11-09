import { describe, expect, it } from 'vitest'
import { centsToPlain, formatCents, parseAmount } from './money.ts'
import {
  applyFilters, budgetStatuses, DEFAULT_CATEGORIES, defaultDateFor, expensesByCategory, isValidDate,
  parseStored, shiftMonth, toCSV, totals, transactionsForMonth, validateCategoryName, validateDraft,
  type Category, type Transaction,
} from './budget.ts'

const cats: Category[] = DEFAULT_CATEGORIES.map((c) => ({ ...c }))
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), type: 'expense', amountCents: 100, categoryId: 'food', date: '2026-11-05', note: '', ...p,
})

describe('money', () => {
  it('parses amounts into exact cents', () => {
    expect(parseAmount('12')).toEqual({ ok: true, cents: 1200 })
    expect(parseAmount('12.5')).toEqual({ ok: true, cents: 1250 })
    expect(parseAmount('0.01')).toEqual({ ok: true, cents: 1 })
    expect(parseAmount(' 12,50 ')).toEqual({ ok: true, cents: 1250 })
    expect(parseAmount('1,234.56')).toEqual({ ok: true, cents: 123456 })
    expect(parseAmount('.5')).toEqual({ ok: true, cents: 50 })
    expect(parseAmount('19.99')).toEqual({ ok: true, cents: 1999 })
  })
  it('rejects bad amounts with clear messages', () => {
    expect(parseAmount('')).toEqual({ ok: false, error: 'Enter an amount.' })
    expect(parseAmount('0')).toEqual({ ok: false, error: 'Amount must be above zero.' })
    expect(parseAmount('0.00')).toEqual({ ok: false, error: 'Amount must be above zero.' })
    expect(parseAmount('-5')).toEqual({ ok: false, error: 'Amount must be above zero.' })
    expect(parseAmount('abc').ok).toBe(false)
    expect(parseAmount('1e3').ok).toBe(false)
    expect(parseAmount('1.2.3').ok).toBe(false)
    expect(parseAmount('.')).toMatchObject({ ok: false })
    expect(parseAmount('1.234')).toEqual({ ok: false, error: 'Use at most 2 decimal places.' })
    expect(parseAmount('99999999999').ok).toBe(false)
  })
  it('adds 0.1 + 0.2 exactly', () => {
    const a = parseAmount('0.1'), b = parseAmount('0.2')
    if (!a.ok || !b.ok) throw new Error('parse failed')
    expect(formatCents(a.cents + b.cents)).toBe('0.30')
    const t = totals([tx({ amountCents: 10 }), tx({ amountCents: 20 })])
    expect(formatCents(t.expenseCents)).toBe('0.30')
  })
  it('formats cents', () => {
    expect(formatCents(0)).toBe('0.00')
    expect(formatCents(5)).toBe('0.05')
    expect(formatCents(123456789)).toBe('1,234,567.89')
    expect(formatCents(-1050)).toBe('-10.50')
    expect(centsToPlain(123456)).toBe('1234.56')
  })
})

describe('dates and months', () => {
  it('validates dates', () => {
    expect(isValidDate('2026-02-28')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('')).toBe(false)
    expect(isValidDate('2026-1-5')).toBe(false)
  })
  it('shifts months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-05', 0)).toBe('2026-05')
    expect(shiftMonth('2026-05', -17)).toBe('2024-12')
  })
  it('defaults a new transaction date into the selected month', () => {
    const now = new Date(2026, 10, 9)
    expect(defaultDateFor('2026-11', now)).toBe('2026-11-09')
    expect(defaultDateFor('2026-09', now)).toBe('2026-09-01')
  })
})

describe('month queries', () => {
  const data = [
    tx({ id: 'a', date: '2026-10-31', amountCents: 500 }),
    tx({ id: 'b', date: '2026-11-01', type: 'income', amountCents: 300000, categoryId: 'other', note: 'Salary' }),
    tx({ id: 'c', date: '2026-11-03', amountCents: 1250, note: 'Lunch with Ann' }),
    tx({ id: 'd', date: '2026-11-03', amountCents: 80000, categoryId: 'housing', note: 'Rent' }),
    tx({ id: 'e', date: '2026-12-01', amountCents: 999 }),
  ]
  const nov = transactionsForMonth(data, '2026-11')

  it('selects only the month, newest first', () => {
    expect(nov.map((t) => t.id)).toEqual(['d', 'c', 'b'])
  })
  it('computes totals', () => {
    expect(totals(nov)).toEqual({ incomeCents: 300000, expenseCents: 81250, balanceCents: 218750 })
    expect(totals([])).toEqual({ incomeCents: 0, expenseCents: 0, balanceCents: 0 })
  })
  it('groups expenses by category, ignoring income', () => {
    const slices = expensesByCategory(nov, cats)
    expect(slices.map((s) => [s.category.id, s.cents])).toEqual([['housing', 80000], ['food', 1250]])
  })
  it('computes budget status and over-budget', () => {
    const c = cats.map((x) => (x.id === 'food' ? { ...x, budgetCents: 1000 } : x.id === 'housing' ? { ...x, budgetCents: 100000 } : x))
    const s = budgetStatuses(nov, c)
    expect(s).toHaveLength(2)
    const food = s.find((x) => x.category.id === 'food')!
    expect(food).toMatchObject({ spentCents: 1250, budgetCents: 1000, ratio: 1, over: true })
    const housing = s.find((x) => x.category.id === 'housing')!
    expect(housing).toMatchObject({ spentCents: 80000, ratio: 0.8, over: false })
    // exactly on budget is not over
    expect(budgetStatuses([tx({ amountCents: 1000 })], c).find((x) => x.category.id === 'food')!.over).toBe(false)
  })
  it('filters by category, type and note search', () => {
    expect(applyFilters(nov, { categoryId: 'food', type: '', search: '' }).map((t) => t.id)).toEqual(['c'])
    expect(applyFilters(nov, { categoryId: '', type: 'income', search: '' }).map((t) => t.id)).toEqual(['b'])
    expect(applyFilters(nov, { categoryId: '', type: '', search: '  ann ' }).map((t) => t.id)).toEqual(['c'])
    expect(applyFilters(nov, { categoryId: 'food', type: 'income', search: '' })).toEqual([])
    expect(applyFilters(nov, { categoryId: '', type: '', search: '' })).toHaveLength(3)
  })
})

describe('validation', () => {
  const base = { type: 'expense' as const, amount: '10', categoryId: 'food', date: '2026-11-05', note: '  hi  ' }
  it('accepts a valid draft and trims the note', () => {
    expect(validateDraft(base, cats)).toEqual({
      ok: true, value: { type: 'expense', amountCents: 1000, categoryId: 'food', date: '2026-11-05', note: 'hi' },
    })
  })
  it('reports amount and date errors together', () => {
    const r = validateDraft({ ...base, amount: '0', date: '' }, cats)
    expect(r).toEqual({ ok: false, errors: { amount: 'Amount must be above zero.', date: 'A date is required.' } })
  })
  it('rejects unknown categories and invalid dates', () => {
    const r = validateDraft({ ...base, categoryId: 'nope', date: '2026-02-31' }, cats)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['categoryId', 'date'])
  })
  it('validates category names', () => {
    expect(validateCategoryName('  ', cats)).toBe('Enter a category name.')
    expect(validateCategoryName('food', cats)).toBe('That category already exists.')
    expect(validateCategoryName('Pets', cats)).toBeNull()
  })
})

describe('CSV', () => {
  it('exports with header, escaping and formula neutralising', () => {
    const csv = toCSV([
      tx({ date: '2026-11-03', amountCents: 1250, note: 'Lunch, "big" one' }),
      tx({ date: '2026-11-01', type: 'income', amountCents: 10, categoryId: 'other', note: '=SUM(A1)' }),
    ], cats)
    expect(csv).toBe(
      'Date,Type,Category,Amount,Note\r\n' +
      '2026-11-01,income,Other,0.10,\'=SUM(A1)\r\n' +
      '2026-11-03,expense,Food,12.50,"Lunch, ""big"" one"\r\n',
    )
  })
  it('exports a header only for an empty month', () => {
    expect(toCSV([], cats)).toBe('Date,Type,Category,Amount,Note\r\n')
  })
})

describe('storage parsing', () => {
  it('falls back to defaults on missing or corrupt data', () => {
    expect(parseStored(null).categories).toHaveLength(6)
    expect(parseStored('{not json').transactions).toEqual([])
    expect(parseStored('{"version":2}').categories).toHaveLength(6)
  })
  it('round-trips data and drops invalid rows', () => {
    const good = tx({ id: 'ok' })
    const raw = JSON.stringify({
      version: 1,
      categories: [...cats, { id: 'pets', name: 'Pets', color: '#123456', budgetCents: 5000 }],
      transactions: [good, { ...good, id: 'bad', amountCents: 0.5 }, { ...good, id: 'orphan', categoryId: 'gone' }],
    })
    const d = parseStored(raw)
    expect(d.categories.map((c) => c.id)).toContain('pets')
    expect(d.transactions.map((t) => t.id)).toEqual(['ok', 'orphan'])
    expect(d.transactions[1].categoryId).toBe('other')
  })
})
