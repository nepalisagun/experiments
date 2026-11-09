import { describe, expect, it } from 'vitest'
import { defaultData, parseStored, transactionsForMonth, type AppData, type Transaction } from './budget.ts'
import {
  dateInMonth, deleteCategory, describeDay, isActiveIn, lastDayOf, materializeMonth, repeatsAfter, saveTransaction, stopRule,
  type TxValue,
} from './recurring.ts'

const ids = () => {
  let n = 0
  return () => `id${++n}`
}

const rent: TxValue = { type: 'expense', amountCents: 80000, categoryId: 'housing', date: '2026-01-31', note: 'Rent' }

function addRepeating(value: TxValue = rent, data: AppData = defaultData(), id = ids()) {
  const r = saveTransaction(data, { editingId: null, value, repeat: true }, id)
  if (!r.ok) throw new Error('save failed')
  return { data: r.data, id }
}

const open = (data: AppData, months: string[], id = ids()) => months.reduce((d, m) => materializeMonth(d, m, id), data)
const datesOf = (data: AppData, month: string) => transactionsForMonth(data.transactions, month).map((t) => t.date)
const unwrap = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r as Extract<T, { ok: true }>
}

describe('month arithmetic', () => {
  it('knows the last day of each month, including leap years', () => {
    expect(lastDayOf('2026-01')).toBe(31)
    expect(lastDayOf('2026-02')).toBe(28)
    expect(lastDayOf('2028-02')).toBe(29)
    expect(lastDayOf('2026-04')).toBe(30)
  })
  it('clamps the day to short months', () => {
    expect(dateInMonth('2026-02', 31)).toBe('2026-02-28')
    expect(dateInMonth('2028-02', 31)).toBe('2028-02-29')
    expect(dateInMonth('2026-04', 31)).toBe('2026-04-30')
    expect(dateInMonth('2026-03', 31)).toBe('2026-03-31')
    expect(dateInMonth('2026-02', 5)).toBe('2026-02-05')
  })
  it('describes the day', () => {
    expect(describeDay(1)).toBe('Monthly on the 1st')
    expect(describeDay(12)).toBe('Monthly on the 12th')
    expect(describeDay(22)).toBe('Monthly on the 22nd')
    expect(describeDay(31)).toBe('Monthly on the 31st (last day in shorter months)')
  })
})

describe('adding a repeating transaction', () => {
  it('creates a rule and links the first occurrence', () => {
    const { data } = addRepeating()
    expect(data.recurring).toHaveLength(1)
    expect(data.recurring[0]).toMatchObject({ day: 31, startMonth: '2026-01', endMonth: null, generated: ['2026-01'], amountCents: 80000 })
    expect(data.transactions).toHaveLength(1)
    expect(data.transactions[0].recurringId).toBe(data.recurring[0].id)
  })
  it('a one-off transaction creates no rule', () => {
    const r = unwrap(saveTransaction(defaultData(), { editingId: null, value: rent, repeat: false }, ids()))
    expect(r.data.recurring).toEqual([])
    expect(r.data.transactions[0].recurringId).toBeUndefined()
  })
})

describe('materializing months', () => {
  it('appears in later months on the same day, clamped to the last day', () => {
    const { data } = addRepeating()
    const d = open(data, ['2026-02', '2026-03', '2026-04'])
    expect(datesOf(d, '2026-02')).toEqual(['2026-02-28'])
    expect(datesOf(d, '2026-03')).toEqual(['2026-03-31'])
    expect(datesOf(d, '2026-04')).toEqual(['2026-04-30'])
    expect(transactionsForMonth(d.transactions, '2026-03')[0]).toMatchObject({ amountCents: 80000, note: 'Rent', categoryId: 'housing' })
  })
  it('uses the 29th in a leap February', () => {
    const { data } = addRepeating({ ...rent, date: '2027-12-31' })
    expect(datesOf(open(data, ['2028-02']), '2028-02')).toEqual(['2028-02-29'])
  })
  it('only fills months that are opened, and can skip ahead', () => {
    const { data } = addRepeating()
    const d = open(data, ['2026-06'])
    expect(datesOf(d, '2026-06')).toEqual(['2026-06-30'])
    expect(datesOf(d, '2026-03')).toEqual([])
    expect(datesOf(open(d, ['2026-03']), '2026-03')).toEqual(['2026-03-31'])
  })
  it('never appears before its first month', () => {
    const { data } = addRepeating()
    const d = materializeMonth(data, '2025-12', ids())
    expect(d).toBe(data)
  })
  it('opening the same month again creates no duplicates and returns the same object', () => {
    const { data } = addRepeating()
    const once = materializeMonth(data, '2026-02', ids())
    const twice = materializeMonth(once, '2026-02', ids())
    expect(twice).toBe(once)
    expect(open(once, ['2026-02', '2026-02', '2026-01'])).toBe(once)
    expect(datesOf(twice, '2026-02')).toHaveLength(1)
    expect(datesOf(twice, '2026-01')).toHaveLength(1)
  })
  it('does not bring back an occurrence the user deleted', () => {
    const { data } = addRepeating()
    const d = open(data, ['2026-02'])
    const febId = transactionsForMonth(d.transactions, '2026-02')[0].id
    const deleted = { ...d, transactions: d.transactions.filter((t) => t.id !== febId) }
    expect(materializeMonth(deleted, '2026-02', ids())).toBe(deleted)
  })
  it('does not duplicate when an occurrence exists but the month was not recorded', () => {
    const { data } = addRepeating()
    const d = open(data, ['2026-02'])
    const lost = { ...d, recurring: d.recurring.map((r) => ({ ...r, generated: ['2026-01'] })) }
    const again = materializeMonth(lost, '2026-02', ids())
    expect(datesOf(again, '2026-02')).toHaveLength(1)
    expect(again.recurring[0].generated).toEqual(['2026-01', '2026-02'])
  })
  it('handles several rules independently', () => {
    const id = ids()
    const a = addRepeating(rent, defaultData(), id)
    const b = unwrap(saveTransaction(a.data, { editingId: null, value: { ...rent, type: 'income', amountCents: 300000, date: '2026-02-01', note: 'Salary' }, repeat: true }, id))
    const d = open(b.data, ['2026-02', '2026-03'])
    expect(datesOf(d, '2026-02').sort()).toEqual(['2026-02-01', '2026-02-28'])
    expect(datesOf(d, '2026-03').sort()).toEqual(['2026-03-01', '2026-03-31'])
  })
})

describe('editing', () => {
  const setup = () => {
    const { data, id } = addRepeating()
    const d = open(data, ['2026-02', '2026-03', '2026-04'], id)
    const tx = (m: string) => transactionsForMonth(d.transactions, m)[0]
    return { d, id, tx }
  }

  it('reports whether an occurrence repeats after its month', () => {
    const { d, tx } = setup()
    expect(repeatsAfter(tx('2026-02'), d.recurring)).toBe(true)
    const oneOff: Transaction = { ...tx('2026-02'), recurringId: undefined }
    expect(repeatsAfter(oneOff, d.recurring)).toBe(false)
  })

  it('updates this and later months, leaving earlier months alone', () => {
    const { d, id, tx } = setup()
    const r = unwrap(saveTransaction(d, { editingId: tx('2026-02').id, value: { ...rent, amountCents: 85000, date: '2026-02-15', note: 'New rent' }, repeat: true }, id))
    const after = (m: string) => transactionsForMonth(r.data.transactions, m)[0]
    expect(after('2026-01')).toMatchObject({ amountCents: 80000, date: '2026-01-31', note: 'Rent' })
    expect(after('2026-02')).toMatchObject({ amountCents: 85000, date: '2026-02-15', note: 'New rent' })
    expect(after('2026-03')).toMatchObject({ amountCents: 85000, date: '2026-03-15' })
    expect(after('2026-04')).toMatchObject({ amountCents: 85000, date: '2026-04-15' })
    expect(r.data.recurring[0]).toMatchObject({ amountCents: 85000, day: 15, note: 'New rent' })
    // later months opened afterwards use the new values
    expect(transactionsForMonth(materializeMonth(r.data, '2026-05', id).transactions, '2026-05')[0]).toMatchObject({ amountCents: 85000, date: '2026-05-15' })
  })

  it('editing a clamped occurrence keeps the series on its original day', () => {
    const { d, id, tx } = setup()
    const r = unwrap(saveTransaction(d, { editingId: tx('2026-02').id, value: { ...rent, amountCents: 90000, date: '2026-02-28' }, repeat: true }, id))
    expect(r.data.recurring[0].day).toBe(31)
    expect(transactionsForMonth(r.data.transactions, '2026-03')[0]).toMatchObject({ date: '2026-03-31', amountCents: 90000 })
    expect(transactionsForMonth(r.data.transactions, '2026-04')[0]).toMatchObject({ date: '2026-04-30', amountCents: 90000 })
  })

  it('refuses to move a repeating occurrence to another month', () => {
    const { d, id, tx } = setup()
    const r = saveTransaction(d, { editingId: tx('2026-02').id, value: { ...rent, date: '2026-03-02' }, repeat: true }, id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.date).toMatch(/stays in February 2026/)
  })

  it('unticking repeat ends the series after that month', () => {
    const { d, id, tx } = setup()
    const r = unwrap(saveTransaction(d, { editingId: tx('2026-02').id, value: { ...rent, date: '2026-02-28' }, repeat: false }, id))
    expect(datesOf(r.data, '2026-01')).toHaveLength(1)
    expect(datesOf(r.data, '2026-02')).toHaveLength(1)
    expect(datesOf(r.data, '2026-03')).toEqual([])
    expect(r.data.recurring[0].endMonth).toBe('2026-03')
    expect(materializeMonth(r.data, '2026-05', id)).toBe(r.data)
    const feb = transactionsForMonth(r.data.transactions, '2026-02')[0]
    expect(repeatsAfter(feb, r.data.recurring)).toBe(false)

    // ticking it again on the final month resumes the series
    const resumed = unwrap(saveTransaction(r.data, { editingId: feb.id, value: { ...rent, date: '2026-02-28' }, repeat: true }, id))
    expect(resumed.data.recurring[0].endMonth).toBeNull()
    expect(datesOf(materializeMonth(resumed.data, '2026-03', id), '2026-03')).toEqual(['2026-03-31'])
  })

  it('unticking repeat and moving the month detaches that transaction', () => {
    const { d, id, tx } = setup()
    const r = unwrap(saveTransaction(d, { editingId: tx('2026-02').id, value: { ...rent, date: '2026-05-10' }, repeat: false }, id))
    const moved = r.data.transactions.find((t) => t.id === tx('2026-02').id)!
    expect(moved.date).toBe('2026-05-10')
    expect(moved.recurringId).toBeUndefined()
    expect(datesOf(r.data, '2026-02')).toEqual([])
  })

  it('ticking repeat on a one-off transaction starts a series from its month', () => {
    const one = unwrap(saveTransaction(defaultData(), { editingId: null, value: { ...rent, date: '2026-03-10' }, repeat: false }, ids()))
    const txId = one.data.transactions[0].id
    const r = unwrap(saveTransaction(one.data, { editingId: txId, value: { ...rent, date: '2026-03-10' }, repeat: true }, ids()))
    expect(r.data.recurring[0]).toMatchObject({ startMonth: '2026-03', day: 10 })
    expect(r.data.transactions).toHaveLength(1)
    expect(datesOf(materializeMonth(r.data, '2026-04', ids()), '2026-04')).toEqual(['2026-04-10'])
  })
})

describe('stopping a series', () => {
  const setup = () => {
    const { data, id } = addRepeating()
    return { d: open(data, ['2026-02', '2026-03', '2026-04', '2026-05'], id), id }
  }

  it('removes occurrences from the chosen month on and keeps earlier months unchanged', () => {
    const { d, id } = setup()
    const before = transactionsForMonth(d.transactions, '2026-02')[0]
    const r = unwrap(stopRule(d, d.recurring[0].id, '2026-04'))
    expect(r.removedRule).toBe(false)
    expect(datesOf(r.data, '2026-01')).toHaveLength(1)
    expect(transactionsForMonth(r.data.transactions, '2026-02')[0]).toEqual(before)
    expect(datesOf(r.data, '2026-03')).toHaveLength(1)
    expect(datesOf(r.data, '2026-04')).toEqual([])
    expect(datesOf(r.data, '2026-05')).toEqual([])
    expect(r.data.recurring[0]).toMatchObject({ endMonth: '2026-04', generated: ['2026-01', '2026-02', '2026-03'] })
    // reopening later months doesn't bring it back
    expect(open(r.data, ['2026-04', '2026-05', '2027-01'], id)).toBe(r.data)
    expect(isActiveIn(r.data.recurring[0], '2026-03')).toBe(true)
    expect(isActiveIn(r.data.recurring[0], '2026-04')).toBe(false)
  })

  it('stopping from a month not yet opened only prevents future months', () => {
    const { d, id } = setup()
    const r = unwrap(stopRule(d, d.recurring[0].id, '2026-08'))
    expect(r.data.transactions).toHaveLength(5)
    expect(datesOf(open(r.data, ['2026-07'], id), '2026-07')).toEqual(['2026-07-31'])
    expect(open(r.data, ['2026-08', '2026-09'], id)).toBe(r.data)
  })

  it('stopping from its first month removes the whole series', () => {
    const { d } = setup()
    const r = unwrap(stopRule(d, d.recurring[0].id, '2026-01'))
    expect(r.removedRule).toBe(true)
    expect(r.data.recurring).toEqual([])
    expect(r.data.transactions).toEqual([])
  })

  it('validates the stop month', () => {
    const { d } = setup()
    const ruleId = d.recurring[0].id
    expect(stopRule(d, ruleId, '2025-12')).toEqual({ ok: false, error: 'Choose January 2026 or later; it starts then.' })
    expect(stopRule(d, ruleId, '')).toEqual({ ok: false, error: 'Choose a month.' })
    expect(stopRule(d, 'nope', '2026-03').ok).toBe(false)
    const stopped = unwrap(stopRule(d, ruleId, '2026-04'))
    expect(stopRule(stopped.data, ruleId, '2026-06')).toEqual({ ok: false, error: 'It already stops from April 2026. Choose an earlier month.' })
    expect(stopRule(stopped.data, ruleId, '2026-03').ok).toBe(true)
  })
})

describe('categories and storage', () => {
  it('moves rules of a deleted category to Other', () => {
    const base = { ...defaultData(), categories: [...defaultData().categories, { id: 'pets', name: 'Pets', color: '#000000', budgetCents: null }] }
    const { data } = addRepeating({ ...rent, categoryId: 'pets' }, base)
    const d = deleteCategory(data, 'pets')
    expect(d.recurring[0].categoryId).toBe('other')
    expect(d.transactions[0].categoryId).toBe('other')
    expect(d.categories.some((c) => c.id === 'pets')).toBe(false)
  })
  it('round-trips rules through storage and upgrades version 1 data', () => {
    const { data } = addRepeating()
    const d = open(data, ['2026-02'])
    expect(parseStored(JSON.stringify(d))).toEqual(d)
    const v1 = JSON.stringify({ version: 1, categories: d.categories, transactions: [{ ...d.transactions[0], recurringId: undefined }] })
    const up = parseStored(v1)
    expect(up.version).toBe(2)
    expect(up.recurring).toEqual([])
    expect(up.transactions).toHaveLength(1)
  })
  it('drops invalid rules and unlinks their occurrences', () => {
    const { data } = addRepeating()
    const bad = { ...data, recurring: [{ ...data.recurring[0], day: 40 }] }
    const p = parseStored(JSON.stringify(bad))
    expect(p.recurring).toEqual([])
    expect(p.transactions[0].recurringId).toBeUndefined()
  })
})
