import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, emptyData, inMonth, loadData, saveData, STORAGE_KEY, totals, type AppData, type TxValue } from './budget'
import {
  addTransaction, applyEdit, daysInMonth, isRepeating, materialize, occurrenceDate, ordinal, stopRule,
} from './recurring'

let n = 0
const id = () => 'id' + ++n
const val = (o: Partial<TxValue> = {}): TxValue => ({
  type: 'expense', amount: 1000, categoryId: 'housing', date: '2026-01-15', note: 'Rent', repeat: true, ...o,
})
const withRule = (o: Partial<TxValue> = {}): AppData => addTransaction(emptyData(), val(o), 'tx0', 'r1')
const dates = (d: AppData, ruleId = 'r1') => d.transactions.filter((t) => t.recurringId === ruleId).map((t) => t.date).sort()

describe('dates', () => {
  it('days in month incl. leap years', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-04')).toBe(30)
    expect(daysInMonth('2026-12')).toBe(31)
  })
  it('clamps the day to the last day of short months', () => {
    expect(occurrenceDate('2026-01', 31)).toBe('2026-01-31')
    expect(occurrenceDate('2026-04', 31)).toBe('2026-04-30')
    expect(occurrenceDate('2026-02', 31)).toBe('2026-02-28')
    expect(occurrenceDate('2028-02', 30)).toBe('2028-02-29')
    expect(occurrenceDate('2026-05', 15)).toBe('2026-05-15')
  })
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 31].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th', '31st'])
  })
})

describe('materialize', () => {
  it('does nothing for non-repeating data, the start month and earlier months', () => {
    const plain = addTransaction(emptyData(), val({ repeat: false }), 'tx0', 'r1')
    expect(materialize(plain, '2026-02', id)).toBe(plain)
    const d = withRule()
    expect(materialize(d, '2026-01', id)).toBe(d)
    expect(materialize(d, '2025-12', id)).toBe(d)
  })
  it('creates the occurrence in a later month with the rule values', () => {
    const d = materialize(withRule(), '2026-02', id)
    const feb = inMonth(d.transactions, '2026-02')
    expect(feb).toHaveLength(1)
    expect(feb[0]).toMatchObject({ amount: 1000, categoryId: 'housing', note: 'Rent', date: '2026-02-15', type: 'expense', recurringId: 'r1' })
    expect(totals(feb).expenses).toBe(1000)
  })
  it('opening the same month again creates no duplicate (same object back)', () => {
    const d1 = materialize(withRule(), '2026-02', id)
    const d2 = materialize(d1, '2026-02', id)
    expect(d2).toBe(d1)
    expect(dates(materialize(materialize(d2, '2026-02', id), '2026-02', id))).toEqual(['2026-01-15', '2026-02-15'])
  })
  it('jumping ahead fills only opened months; skipped ones fill when opened later', () => {
    let d = materialize(withRule(), '2026-06', id)
    expect(dates(d)).toEqual(['2026-01-15', '2026-06-15'])
    d = materialize(d, '2026-03', id)
    expect(dates(d)).toEqual(['2026-01-15', '2026-03-15', '2026-06-15'])
  })
  it('31st becomes 30th / 28th / 29th, and back to 31st', () => {
    let d = withRule({ date: '2026-01-31' })
    for (const m of ['2026-02', '2026-03', '2026-04', '2027-02', '2028-02']) d = materialize(d, m, id)
    expect(dates(d)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2027-02-28', '2028-02-29'])
  })
  it('a deleted occurrence is not resurrected', () => {
    let d = materialize(withRule(), '2026-02', id)
    d = { ...d, transactions: d.transactions.filter((t) => t.date !== '2026-02-15') }
    expect(dates(materialize(d, '2026-02', id))).toEqual(['2026-01-15'])
  })
  it('income repeats as income', () => {
    const d = materialize(withRule({ type: 'income', amount: 500000 }), '2026-03', id)
    expect(totals(inMonth(d.transactions, '2026-03'))).toEqual({ income: 500000, expenses: 0, balance: 500000 })
  })
})

describe('stopping', () => {
  const filled = () => {
    let d = withRule()
    for (const m of ['2026-02', '2026-03', '2026-04', '2026-05']) d = materialize(d, m, id)
    return d
  }
  it('keeps earlier months, removes the chosen month and later ones', () => {
    const d = stopRule(filled(), 'r1', '2026-04')
    expect(dates(d)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
    expect(d.recurring[0].stopFrom).toBe('2026-04')
  })
  it('no new occurrences appear from that month on, even when opened later', () => {
    let d = stopRule(filled(), 'r1', '2026-04')
    for (const m of ['2026-04', '2026-05', '2026-09']) d = materialize(d, m, id)
    expect(dates(d)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })
  it('stopping before anything was created still blocks future months', () => {
    let d = stopRule(withRule(), 'r1', '2026-03')
    d = materialize(materialize(d, '2026-02', id), '2026-03', id)
    expect(dates(d)).toEqual(['2026-01-15', '2026-02-15'])
  })
  it('cannot stop at or before the start month', () => {
    const d = filled()
    expect(stopRule(d, 'r1', '2026-01')).toBe(d)
    expect(stopRule(d, 'r1', '2025-06')).toBe(d)
  })
  it("leaves other rules and plain transactions alone", () => {
    let d = addTransaction(filled(), val({ note: 'Gym', amount: 50, date: '2026-01-10' }), 'tx9', 'r2')
    d = addTransaction(d, val({ repeat: false, date: '2026-04-02', note: 'one-off' }), 'tx10', 'x')
    d = materialize(d, '2026-04', id)
    d = stopRule(d, 'r1', '2026-04')
    expect(dates(d, 'r2')).toContain('2026-04-10')
    expect(d.transactions.some((t) => t.note === 'one-off')).toBe(true)
  })
})

describe('editing', () => {
  it('ticking repeat on a plain transaction starts a rule', () => {
    let d = addTransaction(emptyData(), val({ repeat: false }), 'tx0', 'x')
    d = applyEdit(d, 'tx0', val({ amount: 2000 }), 'r1')
    expect(d.recurring).toHaveLength(1)
    expect(d.recurring[0]).toMatchObject({ amount: 2000, day: 15, startMonth: '2026-01', done: ['2026-01'] })
    expect(d.transactions[0].recurringId).toBe('r1')
    expect(dates(materialize(d, '2026-02', id))).toEqual(['2026-01-15', '2026-02-15'])
  })
  it('editing a repeating one changes it and later months, not months already created', () => {
    let d = materialize(withRule(), '2026-02', id)
    const feb = d.transactions.find((t) => t.date === '2026-02-15')!
    d = applyEdit(d, feb.id, val({ amount: 1200, date: '2026-02-15', note: 'Rent up' }), 'zzz')
    d = materialize(d, '2026-03', id)
    const amt = (date: string) => d.transactions.find((t) => t.date === date)!.amount
    expect(amt('2026-01-15')).toBe(1000)
    expect(amt('2026-02-15')).toBe(1200)
    expect(amt('2026-03-15')).toBe(1200)
    expect(d.recurring).toHaveLength(1)
  })
  it('edit applies to already-created later months, but not earlier ones or ones edited individually', () => {
    let d = withRule()
    for (const m of ['2026-02', '2026-03', '2026-04']) d = materialize(d, m, id)
    const at = (date: string) => d.transactions.find((t) => t.date === date)!
    // April was changed by hand to something else (differs from the template): it must be left alone
    d = { ...d, transactions: d.transactions.map((t) => (t.date === '2026-04-15' ? { ...t, amount: 555 } : t)) }
    d = applyEdit(d, at('2026-02-15').id, val({ date: '2026-02-15', amount: 1200 }), 'z')
    expect(at('2026-01-15').amount).toBe(1000) // before: unchanged
    expect(at('2026-02-15').amount).toBe(1200)
    expect(at('2026-03-15').amount).toBe(1200) // created earlier, untouched: follows
    expect(at('2026-04-15').amount).toBe(555) // differs from the template: kept
    // and a later edit keeps cascading from the new template
    d = applyEdit(d, at('2026-03-15').id, val({ date: '2026-03-15', amount: 1300 }), 'z')
    expect(at('2026-02-15').amount).toBe(1200)
    expect(at('2026-03-15').amount).toBe(1300)
    expect(at('2026-04-15').amount).toBe(555)
  })
  it('changing the day also moves later occurrences (clamped)', () => {
    let d = withRule({ date: '2026-01-31' })
    for (const m of ['2026-02', '2026-03', '2026-04']) d = materialize(d, m, id)
    d = applyEdit(d, 'tx0', val({ date: '2026-01-29' }), 'z')
    expect(dates(d)).toEqual(['2026-01-29', '2026-02-28', '2026-03-29', '2026-04-29'])
  })
  it('changing the day moves the rule day; an unchanged (clamped) date keeps the original day', () => {
    let d = withRule({ date: '2026-01-31' })
    d = materialize(d, '2026-02', id)
    const feb = d.transactions.find((t) => t.date === '2026-02-28')!
    d = applyEdit(d, feb.id, val({ date: '2026-02-28', amount: 1000, note: 'Rent' }), 'z') // only note/amount same
    d = materialize(d, '2026-03', id)
    expect(d.transactions.some((t) => t.date === '2026-03-31')).toBe(true)
    const mar = d.transactions.find((t) => t.date === '2026-03-31')!
    d = applyEdit(d, mar.id, val({ date: '2026-03-10' }), 'z')
    d = materialize(d, '2026-04', id)
    expect(d.transactions.some((t) => t.date === '2026-04-10')).toBe(true)
  })
  it('moving an occurrence to another month does not cause a duplicate there', () => {
    let d = materialize(withRule(), '2026-02', id)
    const feb = d.transactions.find((t) => t.date === '2026-02-15')!
    d = applyEdit(d, feb.id, val({ date: '2026-03-05' }), 'z')
    d = materialize(d, '2026-03', id)
    expect(inMonth(d.transactions, '2026-03').filter((t) => t.recurringId === 'r1')).toHaveLength(1)
  })
  it('unticking stops the repeat after this month and removes later ones', () => {
    let d = withRule()
    for (const m of ['2026-02', '2026-03', '2026-04']) d = materialize(d, m, id)
    const feb = d.transactions.find((t) => t.date === '2026-02-15')!
    expect(isRepeating(d, feb)).toBe(true)
    d = applyEdit(d, feb.id, val({ repeat: false, amount: 1100, date: '2026-02-15' }), 'z')
    expect(dates(d)).toEqual(['2026-01-15', '2026-02-15'])
    expect(d.transactions.find((t) => t.date === '2026-02-15')!.amount).toBe(1100)
    expect(d.recurring[0].stopFrom).toBe('2026-03')
    expect(dates(materialize(d, '2026-05', id))).toEqual(['2026-01-15', '2026-02-15'])
    expect(isRepeating(d, d.transactions.find((t) => t.date === '2026-01-15')!)).toBe(true)
  })
  it('unticking the original in its own month stops everything after it', () => {
    let d = materialize(withRule(), '2026-02', id)
    d = applyEdit(d, 'tx0', val({ repeat: false }), 'z')
    expect(dates(d)).toEqual(['2026-01-15'])
  })
})

describe('persistence of recurring data', () => {
  it('survives a save/load round-trip and ignores broken rules', () => {
    const store: Record<string, string> = {}
    const s = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
    const d = materialize(withRule(), '2026-02', id)
    saveData(d, s)
    const back = loadData(s)
    expect(back.recurring).toEqual(d.recurring)
    expect(back.transactions).toEqual(d.transactions)
    expect(dates(materialize(back, '2026-02', id))).toEqual(['2026-01-15', '2026-02-15']) // reload: still no duplicate
    store[STORAGE_KEY] = JSON.stringify({ categories: DEFAULT_CATEGORIES, transactions: [], recurring: [{ id: 'bad' }, null] })
    expect(loadData(s).recurring).toEqual([])
  })
  it('old saved data without recurring still loads', () => {
    const s = { getItem: () => JSON.stringify({ categories: DEFAULT_CATEGORIES, transactions: [], budgets: {} }) }
    expect(loadData(s).recurring).toEqual([])
  })
})
