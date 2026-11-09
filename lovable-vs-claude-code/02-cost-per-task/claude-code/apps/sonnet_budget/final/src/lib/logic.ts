export type TxType = 'income' | 'expense'

export interface Category {
  id: string
  name: string
  color: string
}

export interface Transaction {
  id: string
  type: TxType
  cents: number
  categoryId: string
  date: string // YYYY-MM-DD
  note: string
  recurringId?: string // set when this transaction belongs to a recurring rule
}

/** A monthly repeating transaction template. */
export interface Recurring {
  id: string
  type: TxType
  cents: number
  categoryId: string
  note: string
  day: number // intended day of month (1-31); clamped in shorter months
  startMonth: string // first month (the one it was created in)
  endMonth?: string // stopped: months >= endMonth no longer get occurrences
  generated: string[] // months already materialised (prevents duplicates)
}

export interface AppData {
  transactions: Transaction[]
  categories: Category[]
  budgets: Record<string, number> // categoryId -> cents per month
  recurring: Recurring[]
}

export const daysInMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Date in `month` for a rule's day, clamped to the month's last day. */
export const dateForDay = (month: string, day: number) =>
  `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`

/** Does the rule produce an occurrence in the month after `txMonth`? */
export const repeatsAfter = (r: Recurring, txMonth: string) => !r.endMonth || shiftMonth(txMonth, 1) < r.endMonth

export const isRepeating = (data: AppData, t: Transaction) => {
  const r = t.recurringId ? data.recurring.find((x) => x.id === t.recurringId) : undefined
  return !!r && repeatsAfter(r, monthKey(t.date))
}

/**
 * Create the transactions of all rules for `month` that are missing. Idempotent: a
 * month is recorded in the rule's `generated` list, so reopening it (or deleting one
 * occurrence) never creates duplicates. Returns the same object when nothing changed.
 */
export function materialise(data: AppData, month: string): AppData {
  let changed = false
  const transactions = [...data.transactions]
  const recurring = data.recurring.map((r) => {
    if (month <= r.startMonth || (r.endMonth && month >= r.endMonth) || r.generated.includes(month)) return r
    changed = true
    const id = `r_${r.id}_${month}`
    if (!transactions.some((t) => t.id === id))
      transactions.push({ id, type: r.type, cents: r.cents, categoryId: r.categoryId, note: r.note, date: dateForDay(month, r.day), recurringId: r.id })
    return { ...r, generated: [...r.generated, month] }
  })
  return changed ? { ...data, transactions, recurring } : data
}

/** Stop a rule from `from` (YYYY-MM) on: remove occurrences from that month on, keep earlier months. */
export function stopRule(data: AppData, ruleId: string, from: string): AppData {
  const rule = data.recurring.find((r) => r.id === ruleId)
  if (!rule) return data
  const f = from < rule.startMonth ? rule.startMonth : from
  return {
    ...data,
    transactions: data.transactions.filter((t) => !(t.recurringId === ruleId && monthKey(t.date) >= f)),
    recurring: data.recurring.map((r) =>
      r.id === ruleId
        ? { ...r, endMonth: r.endMonth && r.endMonth < f ? r.endMonth : f, generated: r.generated.filter((m) => m < f) }
        : r,
    ),
  }
}

/** Save (add or replace) a transaction and apply the "repeat monthly" choice. */
export function applyTx(data: AppData, t: Transaction, repeat: boolean): AppData {
  let tx = t
  let recurring = data.recurring
  const month = monthKey(t.date)
  if (repeat && !t.recurringId) {
    const id = `rec_${t.id}`
    tx = { ...t, recurringId: id }
    recurring = [
      ...recurring,
      { id, type: t.type, cents: t.cents, categoryId: t.categoryId, note: t.note, day: Number(t.date.slice(8, 10)), startMonth: month, generated: [month] },
    ]
  }
  let next: AppData = {
    ...data,
    recurring,
    transactions: data.transactions.some((x) => x.id === tx.id)
      ? data.transactions.map((x) => (x.id === tx.id ? tx : x))
      : [...data.transactions, tx],
  }
  const rule = tx.recurringId ? next.recurring.find((r) => r.id === tx.recurringId) : undefined
  if (rule) {
    const repeating = repeatsAfter(rule, month)
    if (!repeat && repeating) next = stopRule(next, rule.id, shiftMonth(month, 1))
    // Re-enable a stopped rule from this occurrence on
    else if (repeat && !repeating)
      next = { ...next, recurring: next.recurring.map((r) => (r.id === rule.id ? { ...r, endMonth: undefined, generated: r.generated.filter((m) => m <= month) } : r)) }
  }
  return next
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', name: 'Food', color: '#f97316' },
  { id: 'housing', name: 'Housing', color: '#6366f1' },
  { id: 'transport', name: 'Transport', color: '#0ea5e9' },
  { id: 'fun', name: 'Fun', color: '#ec4899' },
  { id: 'health', name: 'Health', color: '#10b981' },
  { id: 'other', name: 'Other', color: '#64748b' },
]

/** Parse a user-typed amount into integer cents without floats. Returns null if invalid. */
export function parseAmount(input: string): number | null {
  const s = input.trim().replace(',', '.')
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s)
  if (!m || (m[1] === '' && !m[2])) return null
  const whole = parseInt(m[1] || '0', 10)
  const frac = parseInt((m[2] ?? '').padEnd(2, '0'), 10)
  const cents = whole * 100 + frac
  return Number.isSafeInteger(cents) ? cents : null
}

/** Format integer cents as e.g. "1,234.50". */
export function formatCents(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = (abs % 100).toString().padStart(2, '0')
  return `${neg ? '-' : ''}${whole}.${frac}`
}

export interface FormInput {
  type: TxType
  amount: string
  categoryId: string
  date: string
  note: string
}

export type FormErrors = Partial<Record<'amount' | 'date' | 'categoryId', string>>

export function validateTx(f: FormInput, categories: Category[]): { errors: FormErrors; cents: number | null } {
  const errors: FormErrors = {}
  let cents: number | null = null
  if (f.amount.trim() === '') errors.amount = 'Amount is required.'
  else {
    cents = parseAmount(f.amount)
    if (/^\s*-/.test(f.amount) || cents === 0) errors.amount = 'Amount must be greater than zero.'
    else if (cents === null) errors.amount = 'Enter a valid amount, e.g. 12.50 (max 2 decimals).'
  }
  if (!f.date) errors.date = 'Date is required.'
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || Number.isNaN(Date.parse(f.date))) errors.date = 'Enter a valid date.'
  if (!categories.some((c) => c.id === f.categoryId)) errors.categoryId = 'Choose a category.'
  return { errors, cents: errors.amount ? null : cents }
}

export const monthKey = (date: string) => date.slice(0, 7)

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

export const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const todayStr = () => {
  const d = new Date()
  return `${currentMonth()}-${String(d.getDate()).padStart(2, '0')}`
}

export const inMonth = (txs: Transaction[], key: string) => txs.filter((t) => monthKey(t.date) === key)

export function totals(txs: Transaction[]) {
  let income = 0
  let expenses = 0
  for (const t of txs) {
    if (t.type === 'income') income += t.cents
    else expenses += t.cents
  }
  return { income, expenses, balance: income - expenses }
}

export function expensesByCategory(txs: Transaction[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of txs) if (t.type === 'expense') out[t.categoryId] = (out[t.categoryId] ?? 0) + t.cents
  return out
}

export interface Filters {
  categoryId: string // '' = all
  type: '' | TxType
  search: string
}

export function filterTxs(txs: Transaction[], f: Filters): Transaction[] {
  const q = f.search.trim().toLowerCase()
  return txs.filter(
    (t) =>
      (!f.categoryId || t.categoryId === f.categoryId) &&
      (!f.type || t.type === f.type) &&
      (!q || t.note.toLowerCase().includes(q)),
  )
}

export const sortTxs = (txs: Transaction[]) =>
  [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

function csvCell(v: string): string {
  // Neutralise spreadsheet formula injection, then quote if needed.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(txs: Transaction[], categories: Category[]): string {
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? id
  const rows = sortTxs(txs)
    .reverse()
    .map((t) => [t.date, t.type, name(t.categoryId), formatCents(t.cents).replace(/,/g, ''), t.note].map(csvCell).join(','))
  return ['Date,Type,Category,Amount,Note', ...rows].join('\r\n')
}

export function addCategory(
  categories: Category[],
  name: string,
  color: string,
): { categories: Category[]; error?: string } {
  const n = name.trim()
  if (!n) return { categories, error: 'Category name is required.' }
  if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase()))
    return { categories, error: 'A category with that name already exists.' }
  const id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return { categories: [...categories, { id, name: n, color }] }
}

export const STORAGE_KEY = 'budget-tracker-v1'

export function loadData(storage: Pick<Storage, 'getItem'>): AppData {
  const fresh: AppData = { transactions: [], categories: DEFAULT_CATEGORIES, budgets: {}, recurring: [] }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return fresh
    const p = JSON.parse(raw)
    const txs: Transaction[] = Array.isArray(p.transactions)
      ? p.transactions.filter(
          (t: Transaction) =>
            t && typeof t.id === 'string' && Number.isSafeInteger(t.cents) && typeof t.date === 'string' &&
            (t.type === 'income' || t.type === 'expense') && typeof t.categoryId === 'string',
        ).map((t: Transaction) => ({ ...t, note: typeof t.note === 'string' ? t.note : '' }))
      : []
    const cats: Category[] =
      Array.isArray(p.categories) && p.categories.length
        ? p.categories.filter((c: Category) => c && typeof c.id === 'string' && typeof c.name === 'string')
        : DEFAULT_CATEGORIES
    const budgets: Record<string, number> = {}
    if (p.budgets && typeof p.budgets === 'object')
      for (const [k, v] of Object.entries(p.budgets)) if (Number.isSafeInteger(v) && (v as number) > 0) budgets[k] = v as number
    const monthRe = /^\d{4}-\d{2}$/
    const recurring: Recurring[] = Array.isArray(p.recurring)
      ? p.recurring
          .filter(
            (r: Recurring) =>
              r && typeof r.id === 'string' && Number.isSafeInteger(r.cents) && (r.type === 'income' || r.type === 'expense') &&
              typeof r.categoryId === 'string' && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 &&
              typeof r.startMonth === 'string' && monthRe.test(r.startMonth),
          )
          .map((r: Recurring) => ({
            ...r,
            note: typeof r.note === 'string' ? r.note : '',
            endMonth: typeof r.endMonth === 'string' && monthRe.test(r.endMonth) ? r.endMonth : undefined,
            generated: Array.isArray(r.generated) ? r.generated.filter((m) => typeof m === 'string') : [],
          }))
      : []
    return { transactions: txs, categories: cats, budgets, recurring }
  } catch {
    return fresh
  }
}

export function saveData(storage: Pick<Storage, 'setItem'>, data: AppData) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* storage full / unavailable */
  }
}
