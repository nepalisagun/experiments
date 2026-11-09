import { describe, expect, it } from 'vitest'
import { centsToPlain, formatCents, parseAmount, sumCents } from './money.ts'
import {
  DEFAULT_CATEGORIES,
  STORAGE_KEY,
  type Transaction,
  applyFilters,
  budgetStatus,
  expensesByCategory,
  forMonth,
  isValidDate,
  loadData,
  parseStored,
  saveData,
  shiftMonth,
  toCSV,
  totals,
  validateCategoryName,
  validateTransaction,
} from './budget.ts'

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  type: 'expense',
  amountCents: 100,
  categoryId: 'food',
  date: '2026-03-10',
  note: '',
  ...p,
})

describe('money', () => {
  it('parses amounts to integer cents', () => {
    expect(parseAmount('12')).toEqual({ ok: true, cents: 1200 })
    expect(parseAmount('12.5')).toEqual({ ok: true, cents: 1250 })
    expect(parseAmount('0.1')).toEqual({ ok: true, cents: 10 })
    expect(parseAmount('.99')).toEqual({ ok: true, cents: 99 })
    expect(parseAmount('1,234.56')).toEqual({ ok: true, cents: 123456 })
    expect(parseAmount(' 7. ')).toEqual({ ok: true, cents: 700 })
    expect(parseAmount('1.005').ok).toBe(false) // never silently rounds
    expect(parseAmount('19.99')).toEqual({ ok: true, cents: 1999 })
  })

  it('rejects zero, negative, empty and junk with clear messages', () => {
    expect(parseAmount('')).toEqual({ ok: false, error: 'Amount is required.' })
    expect(parseAmount('0')).toEqual({ ok: false, error: 'Amount must be greater than zero.' })
    expect(parseAmount('0.00')).toEqual({ ok: false, error: 'Amount must be greater than zero.' })
    expect(parseAmount('-5')).toEqual({ ok: false, error: 'Amount must be greater than zero.' })
    expect(parseAmount('abc')).toMatchObject({ ok: false, error: expect.stringContaining('number') })
    expect(parseAmount('1e3').ok).toBe(false)
    expect(parseAmount('.').ok).toBe(false)
    expect(parseAmount('99999999999').ok).toBe(false)
  })

  it('adds 0.1 + 0.2 to exactly 0.30', () => {
    const a = parseAmount('0.1')
    const b = parseAmount('0.2')
    if (!a.ok || !b.ok) throw new Error('parse failed')
    expect(formatCents(sumCents([a.cents, b.cents]))).toBe('0.30')
    // Many small sums stay exact
    expect(formatCents(sumCents(Array(1000).fill(10)))).toBe('100.00')
  })

  it('formats cents', () => {
    expect(formatCents(0)).toBe('0.00')
    expect(formatCents(5)).toBe('0.05')
    expect(formatCents(123456789)).toBe('1,234,567.89')
    expect(formatCents(-150)).toBe('-1.50')
    expect(centsToPlain(123456)).toBe('1234.56')
  })
})

describe('validation', () => {
  const base = { type: 'expense' as const, amount: '10', categoryId: 'food', date: '2026-03-01', note: ' hi ' }

  it('accepts a valid transaction and trims the note', () => {
    const r = validateTransaction(base, DEFAULT_CATEGORIES)
    expect(r).toEqual({ ok: true, value: { type: 'expense', amountCents: 1000, categoryId: 'food', date: '2026-03-01', note: 'hi' } })
  })

  it('requires amount > 0 and a date', () => {
    const r = validateTransaction({ ...base, amount: '0', date: '' }, DEFAULT_CATEGORIES)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.amount).toBe('Amount must be greater than zero.')
      expect(r.errors.date).toBe('Date is required.')
    }
  })

  it('rejects invalid dates and unknown categories', () => {
    const r = validateTransaction({ ...base, date: '2026-02-30', categoryId: 'nope' }, DEFAULT_CATEGORIES)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.date).toBe('Enter a valid date.')
      expect(r.errors.categoryId).toBeTruthy()
    }
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2025-02-29')).toBe(false)
  })

  it('validates category names', () => {
    expect(validateCategoryName('  ', DEFAULT_CATEGORIES)).toMatch(/required/)
    expect(validateCategoryName('food', DEFAULT_CATEGORIES)).toMatch(/already exists/)
    expect(validateCategoryName('Education', DEFAULT_CATEGORIES)).toBeNull()
  })
})

describe('months', () => {
  it('shifts across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-05', 0)).toBe('2026-05')
    expect(shiftMonth('2026-05', -17)).toBe('2024-12')
  })

  it('selects only the given month, newest first', () => {
    const list = [tx({ date: '2026-03-01' }), tx({ date: '2026-04-01' }), tx({ date: '2026-03-31' }), tx({ date: '2026-02-28' })]
    expect(forMonth(list, '2026-03').map((t) => t.date)).toEqual(['2026-03-31', '2026-03-01'])
  })
})

describe('aggregation', () => {
  const list = [
    tx({ type: 'income', amountCents: 300000, categoryId: 'other', note: 'Salary' }),
    tx({ amountCents: 10, categoryId: 'food', note: 'Gum' }),
    tx({ amountCents: 20, categoryId: 'food', note: 'Candy' }),
    tx({ amountCents: 120000, categoryId: 'housing', note: 'Rent March' }),
  ]

  it('computes totals', () => {
    expect(totals(list)).toEqual({ income: 300000, expenses: 120030, balance: 179970 })
    expect(totals([])).toEqual({ income: 0, expenses: 0, balance: 0 })
    expect(totals([tx({ amountCents: 500 })]).balance).toBe(-500)
  })

  it('groups expenses by category (ignores income)', () => {
    const m = expensesByCategory(list)
    expect(m.get('food')).toBe(30)
    expect(m.get('housing')).toBe(120000)
    expect(m.has('other')).toBe(false)
  })

  it('filters by category, type and note search (case-insensitive)', () => {
    expect(applyFilters(list, { categoryId: 'food', type: '', search: '' })).toHaveLength(2)
    expect(applyFilters(list, { categoryId: '', type: 'income', search: '' })).toHaveLength(1)
    expect(applyFilters(list, { categoryId: '', type: '', search: 'RENT' })[0].note).toBe('Rent March')
    expect(applyFilters(list, { categoryId: 'food', type: 'expense', search: 'gum' })).toHaveLength(1)
    expect(applyFilters(list, { categoryId: 'housing', type: 'income', search: '' })).toHaveLength(0)
  })

  it('computes budget status', () => {
    expect(budgetStatus(5000, 10000)).toEqual({ pct: 50, over: false, remainingCents: 5000 })
    expect(budgetStatus(10000, 10000)).toEqual({ pct: 100, over: false, remainingCents: 0 })
    expect(budgetStatus(10001, 10000).over).toBe(true)
    expect(budgetStatus(15000, 10000)).toEqual({ pct: 150, over: true, remainingCents: -5000 })
  })
})

describe('csv', () => {
  it('exports a header and escaped rows sorted by date', () => {
    const csv = toCSV(
      [
        tx({ date: '2026-03-05', amountCents: 30, note: 'He said "hi", then left' }),
        tx({ date: '2026-03-01', type: 'income', amountCents: 123456, categoryId: 'other', note: '=SUM(A1)' }),
      ],
      DEFAULT_CATEGORIES,
    )
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe('Date,Type,Category,Amount,Note')
    expect(lines[1]).toBe("2026-03-01,income,Other,1234.56,'=SUM(A1)")
    expect(lines[2]).toBe('2026-03-05,expense,Food,0.30,"He said ""hi"", then left"')
  })
})

describe('persistence', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const data = { transactions: [tx({ note: 'x' })], categories: [...DEFAULT_CATEGORIES, { id: 'c1', name: 'Pets', color: '#123456', budgetCents: 5000 }], recurring: [] }
    expect(saveData(data, storage)).toBe(true)
    expect(store.has(STORAGE_KEY)).toBe(true)
    expect(loadData(storage)).toEqual(data)
  })

  it('falls back safely on missing or corrupt data', () => {
    expect(parseStored(null).categories).toHaveLength(6)
    expect(parseStored('not json').transactions).toEqual([])
    const partial = parseStored(JSON.stringify({ transactions: [{ bad: true }, tx({ amountCents: 1.5 }), tx({ note: 'ok' })] }))
    expect(partial.transactions.map((t) => t.note)).toEqual(['ok'])
    expect(partial.categories.map((c) => c.name)).toEqual(DEFAULT_CATEGORIES.map((c) => c.name))
  })

  it('reports failure when storage throws', () => {
    expect(saveData({ transactions: [], categories: [], recurring: [] }, { setItem: () => { throw new Error('quota') } })).toBe(false)
  })
})
