import { type AppData, type Recurring, type Transaction, type TxValue, monthOf, shiftMonth } from './budget'

const pad = (n: number) => String(n).padStart(2, '0')

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export const dayOf = (date: string) => Number(date.slice(8, 10))

/** The date an occurrence lands on: the intended day, or the last day of a shorter month. */
export function occurrenceDate(month: string, day: number): string {
  return month + '-' + pad(Math.min(day, daysInMonth(month)))
}

export function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return n + 'th'
  return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
}

const ruleFrom = (tx: Transaction, id: string, day = dayOf(tx.date)): Recurring => ({
  id, type: tx.type, amount: tx.amount, categoryId: tx.categoryId, note: tx.note, day,
  startMonth: monthOf(tx.date), done: [monthOf(tx.date)],
})

/** Fill in `month` for every active rule that has not been filled yet. Idempotent: returns the same object when nothing is due. */
export function materialize(data: AppData, month: string, newId: () => string = () => crypto.randomUUID()): AppData {
  const added: Transaction[] = []
  const recurring = data.recurring.map((r) => {
    if (!(r.startMonth < month)) return r
    if (r.stopFrom && month >= r.stopFrom) return r
    if (r.done.includes(month)) return r
    if (data.transactions.some((t) => t.recurringId === r.id && monthOf(t.date) === month)) return r
    added.push({
      id: newId(), type: r.type, amount: r.amount, categoryId: r.categoryId, note: r.note,
      date: occurrenceDate(month, r.day), recurringId: r.id,
    })
    return { ...r, done: [...r.done, month] }
  })
  if (!added.length) return data
  return { ...data, recurring, transactions: [...data.transactions, ...added] }
}

/** Is this transaction part of a rule that is still running at its month? (drives the form checkbox) */
export function isRepeating(data: AppData, tx: Transaction): boolean {
  const r = data.recurring.find((x) => x.id === tx.recurringId)
  return !!r && (!r.stopFrom || monthOf(tx.date) < r.stopFrom)
}

export function addTransaction(data: AppData, v: TxValue, txId: string, ruleId: string): AppData {
  const { repeat, ...rest } = v
  const tx: Transaction = { ...rest, id: txId }
  if (!repeat) return { ...data, transactions: [...data.transactions, tx] }
  tx.recurringId = ruleId
  return { ...data, transactions: [...data.transactions, tx], recurring: [...data.recurring, ruleFrom(tx, ruleId)] }
}

/**
 * Edit a transaction.
 * - plain + repeat ticked  -> becomes the start of a new rule
 * - repeating, still ticked -> this one changes; the rule's template follows, so *later* months pick it up
 *   (months already created keep their own values)
 * - repeating, unticked     -> this one changes; the rule stops after this month and later occurrences are removed
 */
export function applyEdit(data: AppData, id: string, v: TxValue, newRuleId: string): AppData {
  const old = data.transactions.find((t) => t.id === id)
  if (!old) return data
  const { repeat, ...rest } = v
  const updated: Transaction = { ...old, ...rest }
  const newMonth = monthOf(v.date)
  let recurring = data.recurring
  let transactions = data.transactions.map((t) => (t.id === id ? updated : t))
  const rule = data.recurring.find((r) => r.id === old.recurringId)

  if (!rule) {
    if (repeat) {
      updated.recurringId = newRuleId
      recurring = [...recurring, ruleFrom(updated, newRuleId)]
    }
  } else if (repeat) {
    const day = dayOf(v.date) !== dayOf(old.date) ? dayOf(v.date) : rule.day
    const done = rule.done.includes(newMonth) ? rule.done : [...rule.done, newMonth]
    // "This and following": later occurrences that still match the old template follow the change;
    // ones edited individually, and every earlier month, stay as they are.
    const fromMonth = monthOf(old.date)
    transactions = transactions.map((t) =>
      t.id !== id && t.recurringId === rule.id && monthOf(t.date) > fromMonth &&
      t.type === rule.type && t.amount === rule.amount && t.categoryId === rule.categoryId && t.note === rule.note
        ? { ...t, type: v.type, amount: v.amount, categoryId: v.categoryId, note: v.note, date: occurrenceDate(monthOf(t.date), day) }
        : t)
    recurring = recurring.map((r) => r.id === rule.id
      ? { ...r, type: v.type, amount: v.amount, categoryId: v.categoryId, note: v.note, day, done } : r)
  } else {
    const next = shiftMonth(monthOf(old.date), 1)
    const from = [next, rule.stopFrom].filter((x): x is string => !!x).sort()[0]
    const stop = stopRule({ ...data, transactions }, rule.id, from < shiftMonth(rule.startMonth, 1) ? shiftMonth(rule.startMonth, 1) : from)
    return stop
  }
  return { ...data, transactions, recurring }
}

/** Stop a rule from `fromMonth` on. Earlier months are untouched; occurrences in `fromMonth` and later are removed. */
export function stopRule(data: AppData, ruleId: string, fromMonth: string): AppData {
  const rule = data.recurring.find((r) => r.id === ruleId)
  if (!rule || !(fromMonth > rule.startMonth)) return data
  return {
    ...data,
    recurring: data.recurring.map((r) => (r.id === ruleId ? { ...r, stopFrom: fromMonth } : r)),
    transactions: data.transactions.filter((t) => !(t.recurringId === ruleId && monthOf(t.date) >= fromMonth)),
  }
}
