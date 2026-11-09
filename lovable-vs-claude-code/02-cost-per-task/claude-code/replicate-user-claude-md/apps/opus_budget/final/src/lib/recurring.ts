import { isValidMonth, monthLabel, monthOf, shiftMonth, type AppData, type RecurringRule, type Transaction } from './budget.ts'

export type TxValue = Omit<Transaction, 'id' | 'recurringId'>
type IdFn = () => string

const pad = (n: number) => String(n).padStart(2, '0')

export function lastDayOf(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** The rule's day in the given month, moved to the last day when the month is shorter. */
export function dateInMonth(month: string, day: number): string {
  return `${month}-${pad(Math.min(day, lastDayOf(month)))}`
}

const dayOf = (date: string) => Number(date.slice(8, 10))

export function isActiveIn(rule: RecurringRule, month: string): boolean {
  return month >= rule.startMonth && (rule.endMonth === null || month < rule.endMonth)
}

/** Whether a transaction's series continues after the transaction's own month. */
export function repeatsAfter(tx: Transaction, rules: RecurringRule[]): boolean {
  const rule = tx.recurringId ? rules.find((r) => r.id === tx.recurringId) : undefined
  return !!rule && isActiveIn(rule, shiftMonth(monthOf(tx.date), 1))
}

/**
 * Create this month's occurrence of every active rule that hasn't produced one yet.
 * Idempotent: returns the same object when nothing needs adding, so opening a month again never duplicates.
 */
export function materializeMonth(data: AppData, month: string, newId: IdFn): AppData {
  let changed = false
  const added: Transaction[] = []
  const recurring = data.recurring.map((r) => {
    if (!isActiveIn(r, month) || r.generated.includes(month)) return r
    changed = true
    const exists = data.transactions.some((t) => t.recurringId === r.id && monthOf(t.date) === month)
    if (!exists) {
      added.push({ id: newId(), type: r.type, amountCents: r.amountCents, categoryId: r.categoryId, date: dateInMonth(month, r.day), note: r.note, recurringId: r.id })
    }
    return { ...r, generated: [...r.generated, month].sort() }
  })
  if (!changed) return data
  return { ...data, recurring, transactions: [...data.transactions, ...added] }
}

function ruleFrom(value: TxValue, id: string): RecurringRule {
  const month = monthOf(value.date)
  return {
    id, type: value.type, amountCents: value.amountCents, categoryId: value.categoryId, note: value.note,
    day: dayOf(value.date), startMonth: month, endMonth: null, generated: [month],
  }
}

/** End a rule from `fromMonth` (exclusive of earlier months): drop its occurrences from then on. */
function endRule(data: AppData, rule: RecurringRule, fromMonth: string): AppData {
  return {
    ...data,
    recurring: data.recurring.map((r) => (r.id === rule.id ? { ...r, endMonth: fromMonth, generated: r.generated.filter((m) => m < fromMonth) } : r)),
    transactions: data.transactions.filter((t) => !(t.recurringId === rule.id && monthOf(t.date) >= fromMonth)),
  }
}

export type SaveResult = { ok: true; data: AppData } | { ok: false; error: { date: string } }

/**
 * Add or edit a transaction, with "Repeat monthly" on or off.
 * Editing an occurrence of a series with repeat on also updates the series and its later months.
 * Turning repeat off on an occurrence ends the series after that month.
 */
export function saveTransaction(
  data: AppData,
  input: { editingId: string | null; value: TxValue; repeat: boolean },
  newId: IdFn,
): SaveResult {
  const { editingId, value, repeat } = input
  const existing = editingId ? data.transactions.find((t) => t.id === editingId) : undefined
  const rule = existing?.recurringId ? data.recurring.find((r) => r.id === existing.recurringId) : undefined

  // New transaction, or an edit of a one-off transaction.
  if (!existing || !rule) {
    const id = existing?.id ?? newId()
    const tx: Transaction = { ...value, id }
    let recurring = data.recurring
    if (repeat) {
      const r = ruleFrom(value, newId())
      tx.recurringId = r.id
      recurring = [...recurring, r]
    }
    const transactions = existing ? data.transactions.map((t) => (t.id === id ? tx : t)) : [...data.transactions, tx]
    return { ok: true, data: { ...data, transactions, recurring } }
  }

  const fromMonth = monthOf(existing.date)
  const toMonth = monthOf(value.date)

  if (repeat) {
    if (toMonth !== fromMonth) {
      return {
        ok: false,
        error: { date: `A repeating transaction stays in ${monthLabel(fromMonth)}. Change only the day, or untick “Repeat monthly” to move it.` },
      }
    }
    // Keep the series' day if the date is still its (possibly clamped) day this month: editing
    // the 28 Feb occurrence of a "31st" series must not turn it into a "28th" series.
    const day = value.date === dateInMonth(fromMonth, rule.day) ? rule.day : dayOf(value.date)
    const updated: RecurringRule = {
      ...rule, type: value.type, amountCents: value.amountCents, categoryId: value.categoryId, note: value.note, day,
      // Ticking repeat on the series' final month resumes it.
      endMonth: rule.endMonth !== null && rule.endMonth <= shiftMonth(fromMonth, 1) ? null : rule.endMonth,
    }
    const transactions = data.transactions.map((t) => {
      if (t.id === existing.id) return { ...value, id: t.id, recurringId: rule.id }
      if (t.recurringId === rule.id && monthOf(t.date) > fromMonth) {
        return { ...t, type: value.type, amountCents: value.amountCents, categoryId: value.categoryId, note: value.note, date: dateInMonth(monthOf(t.date), day) }
      }
      return t
    })
    return { ok: true, data: { ...data, transactions, recurring: data.recurring.map((r) => (r.id === rule.id ? updated : r)) } }
  }

  // Repeat turned off: the series ends after this month; this occurrence is kept (detached if it moves month).
  const ended = isActiveIn(rule, shiftMonth(fromMonth, 1)) ? endRule(data, rule, shiftMonth(fromMonth, 1)) : data
  const transactions = ended.transactions.map((t) =>
    t.id === existing.id ? (toMonth === fromMonth ? { ...value, id: t.id, recurringId: rule.id } : { ...value, id: t.id }) : t,
  )
  return { ok: true, data: { ...ended, transactions } }
}

export type StopResult = { ok: true; data: AppData; removedRule: boolean } | { ok: false; error: string }

/** Stop a series from `stopMonth` on; months before it keep their transactions unchanged. */
export function stopRule(data: AppData, ruleId: string, stopMonth: string): StopResult {
  const rule = data.recurring.find((r) => r.id === ruleId)
  if (!rule) return { ok: false, error: 'That repeating transaction no longer exists.' }
  if (!isValidMonth(stopMonth)) return { ok: false, error: 'Choose a month.' }
  if (stopMonth < rule.startMonth) return { ok: false, error: `Choose ${monthLabel(rule.startMonth)} or later; it starts then.` }
  if (rule.endMonth !== null && stopMonth >= rule.endMonth) {
    return { ok: false, error: `It already stops from ${monthLabel(rule.endMonth)}. Choose an earlier month.` }
  }
  if (stopMonth === rule.startMonth) {
    return {
      ok: true,
      removedRule: true,
      data: { ...data, recurring: data.recurring.filter((r) => r.id !== ruleId), transactions: data.transactions.filter((t) => t.recurringId !== ruleId) },
    }
  }
  return { ok: true, removedRule: false, data: endRule(data, rule, stopMonth) }
}

/** Remove a custom category; its transactions and repeating rules move to Other. */
export function deleteCategory(data: AppData, id: string): AppData {
  return {
    ...data,
    categories: data.categories.filter((c) => c.id !== id),
    transactions: data.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: 'other' } : t)),
    recurring: data.recurring.map((r) => (r.categoryId === id ? { ...r, categoryId: 'other' } : r)),
  }
}

/** Human description of when a rule falls, e.g. "Monthly on the 31st (last day in shorter months)". */
export function describeDay(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  return `Monthly on the ${day}${suffix}${day > 28 ? ' (last day in shorter months)' : ''}`
}
