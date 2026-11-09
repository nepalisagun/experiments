import { type AppData, type RecurringRule, type Transaction, monthOf, newId, shiftMonth } from './budget.ts'

// Months are "YYYY-MM" strings, which compare correctly as plain strings.

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The date a rule falls on in a month: same day, or the last day if the month is shorter. */
export function occurrenceDate(month: string, dayOfMonth: number): string {
  return `${month}-${String(Math.min(dayOfMonth, daysInMonth(month))).padStart(2, '0')}`
}

export function isActiveIn(rule: RecurringRule, month: string): boolean {
  return month >= rule.startMonth && (rule.endMonth === null || month < rule.endMonth)
}

/** Last month the rule occurs in, or null if it runs forever. */
export function lastMonth(rule: RecurringRule): string | null {
  return rule.endMonth === null ? null : shiftMonth(rule.endMonth, -1)
}

export function ruleFromTransaction(tx: Omit<Transaction, 'id' | 'recurringId'>, id = newId()): RecurringRule {
  const month = monthOf(tx.date)
  return {
    id,
    type: tx.type,
    amountCents: tx.amountCents,
    categoryId: tx.categoryId,
    note: tx.note,
    dayOfMonth: Number(tx.date.slice(8, 10)),
    startMonth: month,
    endMonth: null,
    generatedThrough: month,
  }
}

function occurrence(rule: RecurringRule, month: string, id = newId()): Transaction {
  return {
    id,
    type: rule.type,
    amountCents: rule.amountCents,
    categoryId: rule.categoryId,
    date: occurrenceDate(month, rule.dayOfMonth),
    note: rule.note,
    recurringId: rule.id,
  }
}

/**
 * Create the occurrences of every rule for all months up to and including `uptoMonth`
 * that have not been created before. Each month is only ever generated once per rule
 * (tracked by `generatedThrough`), so opening a month again never duplicates, and an
 * occurrence the user deleted is not brought back.
 * Returns the same object when nothing changed.
 */
export function materialize(data: AppData, uptoMonth: string, makeId: () => string = newId): AppData {
  let changed = false
  const added: Transaction[] = []
  const recurring = data.recurring.map((rule) => {
    if (uptoMonth <= rule.generatedThrough) return rule
    let m = shiftMonth(rule.generatedThrough, 1)
    while (m <= uptoMonth && isActiveIn(rule, m)) {
      added.push(occurrence(rule, m, makeId()))
      m = shiftMonth(m, 1)
    }
    changed = true
    return { ...rule, generatedThrough: uptoMonth }
  })
  if (!changed) return data
  return { ...data, recurring, transactions: [...data.transactions, ...added] }
}

/** Occurrences of a rule in `fromMonth` or later. */
export function occurrencesFrom(data: AppData, ruleId: string, fromMonth: string): Transaction[] {
  return data.transactions.filter((t) => t.recurringId === ruleId && monthOf(t.date) >= fromMonth)
}

/**
 * Stop a rule from `fromMonth` on: removes its occurrences in that month and later and
 * prevents new ones. Earlier months are untouched. Stopping from (or before) the first
 * month removes the rule entirely.
 */
export function stopRule(data: AppData, ruleId: string, fromMonth: string): AppData {
  const rule = data.recurring.find((r) => r.id === ruleId)
  if (!rule) return data
  const transactions = data.transactions.filter((t) => !(t.recurringId === ruleId && monthOf(t.date) >= fromMonth))
  if (fromMonth <= rule.startMonth) return { ...data, transactions, recurring: data.recurring.filter((r) => r.id !== ruleId) }
  const endMonth = rule.endMonth !== null && rule.endMonth < fromMonth ? rule.endMonth : fromMonth
  return { ...data, transactions, recurring: data.recurring.map((r) => (r.id === ruleId ? { ...r, endMonth } : r)) }
}

export type SaveResult = { ok: true; data: AppData } | { ok: false; field: 'date'; error: string }

/**
 * Add or edit a transaction, honouring the "Repeat monthly" choice.
 * - New + repeat: creates a rule starting in the transaction's month.
 * - Edit a one-off + repeat: turns it into the first occurrence of a new rule.
 * - Edit an occurrence + repeat: updates it and the rule; later occurrences follow, earlier months stay as they were.
 * - Edit an occurrence, repeat unticked: keeps it as a one-off and stops the rule from that month on.
 */
export function saveTransaction(
  data: AppData,
  value: Omit<Transaction, 'id' | 'recurringId'>,
  opts: { editingId: string | null; repeat: boolean },
  makeId: () => string = newId,
): SaveResult {
  const existing = opts.editingId ? data.transactions.find((t) => t.id === opts.editingId) : undefined
  const rule = existing?.recurringId ? data.recurring.find((r) => r.id === existing.recurringId) : undefined

  // New transaction, or editing a one-off.
  if (!rule) {
    const id = existing?.id ?? makeId()
    if (!opts.repeat) {
      const tx: Transaction = { id, ...value }
      return { ok: true, data: { ...data, transactions: existing ? data.transactions.map((t) => (t.id === id ? tx : t)) : [...data.transactions, tx] } }
    }
    const newRule = ruleFromTransaction(value, makeId())
    const tx: Transaction = { id, ...value, recurringId: newRule.id }
    return {
      ok: true,
      data: {
        ...data,
        recurring: [...data.recurring, newRule],
        transactions: existing ? data.transactions.map((t) => (t.id === id ? tx : t)) : [...data.transactions, tx],
      },
    }
  }

  const month = monthOf(existing!.date)

  // Editing an occurrence and switching repeat off: detach it, stop the rule from this month.
  if (!opts.repeat) {
    const tx: Transaction = { id: existing!.id, ...value }
    return { ok: true, data: stopRule({ ...data, transactions: data.transactions.map((t) => (t.id === tx.id ? tx : t)) }, rule.id, month) }
  }

  // Editing an occurrence and keeping it repeating: this and later months change.
  if (monthOf(value.date) !== month) {
    return { ok: false, field: 'date', error: 'A repeating transaction must stay in its month. Change the day, or untick “Repeat monthly” to move it.' }
  }
  const dayOfMonth = Number(value.date.slice(8, 10))
  const updatedRule: RecurringRule = { ...rule, type: value.type, amountCents: value.amountCents, categoryId: value.categoryId, note: value.note, dayOfMonth }
  const transactions = data.transactions.map((t) => {
    if (t.id === existing!.id) return { ...t, ...value }
    if (t.recurringId === rule.id && monthOf(t.date) > month)
      return { ...t, type: value.type, amountCents: value.amountCents, categoryId: value.categoryId, note: value.note, date: occurrenceDate(monthOf(t.date), dayOfMonth) }
    return t
  })
  return { ok: true, data: { ...data, transactions, recurring: data.recurring.map((r) => (r.id === rule.id ? updatedRule : r)) } }
}
