import { centsToPlain, parseAmount } from './money.ts'

export type TxType = 'income' | 'expense'

export interface Category {
  id: string
  name: string
  color: string
  /** Monthly budget in cents, or null when none is set. */
  budgetCents: number | null
  builtIn?: boolean
}

export interface Transaction {
  id: string
  type: TxType
  amountCents: number
  categoryId: string
  /** Local calendar date, "YYYY-MM-DD". */
  date: string
  note: string
  /** Set when this transaction is an occurrence of a monthly recurring rule. */
  recurringId?: string
}

/** A transaction that repeats every month. Occurrences are created as months are opened. */
export interface RecurringRule {
  id: string
  type: TxType
  amountCents: number
  categoryId: string
  /** Day of month 1..31; clamped to the month's last day in shorter months. */
  day: number
  note: string
  /** "YYYY-MM" of the first occurrence. */
  startMonth: string
  /** "YYYY-MM" from which it no longer occurs, or null while it repeats indefinitely. */
  endMonth: string | null
  /** Months already generated, so reopening a month (or a deleted occurrence) never recreates it. */
  generated: string[]
}

export interface AppData {
  version: 2
  categories: Category[]
  transactions: Transaction[]
  recurring: RecurringRule[]
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', name: 'Food', color: '#2a78d6', budgetCents: null, builtIn: true },
  { id: 'housing', name: 'Housing', color: '#eb6834', budgetCents: null, builtIn: true },
  { id: 'transport', name: 'Transport', color: '#1baf7a', budgetCents: null, builtIn: true },
  { id: 'fun', name: 'Fun', color: '#eda100', budgetCents: null, builtIn: true },
  { id: 'health', name: 'Health', color: '#e87ba4', budgetCents: null, builtIn: true },
  { id: 'other', name: 'Other', color: '#8a8a85', budgetCents: null, builtIn: true },
]

/** Suggested colours for user categories (remaining validated palette slots first). */
export const CUSTOM_COLORS = ['#6250d6', '#e34948', '#008300', '#0e7490', '#a16207', '#be185d']

export function defaultData(): AppData {
  return { version: 2, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), transactions: [], recurring: [] }
}

// ---------- dates & months ----------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

const pad = (n: number) => String(n).padStart(2, '0')

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** "YYYY-MM" */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** A sensible default date for a new transaction in the given month. */
export function defaultDateFor(month: string, now = new Date()): string {
  const today = todayISO(now)
  return monthOf(today) === month ? today : `${month}-01`
}

// ---------- queries ----------

export function transactionsForMonth(txs: Transaction[], month: string): Transaction[] {
  // Newest date first; within a day, the most recently added first.
  return txs
    .map((t, i) => [t, i] as const)
    .filter(([t]) => monthOf(t.date) === month)
    .sort(([a, ai], [b, bi]) => (a.date === b.date ? bi - ai : b.date.localeCompare(a.date)))
    .map(([t]) => t)
}

export interface Totals {
  incomeCents: number
  expenseCents: number
  balanceCents: number
}

export function totals(txs: Transaction[]): Totals {
  let incomeCents = 0
  let expenseCents = 0
  for (const t of txs) {
    if (t.type === 'income') incomeCents += t.amountCents
    else expenseCents += t.amountCents
  }
  return { incomeCents, expenseCents, balanceCents: incomeCents - expenseCents }
}

export interface CategorySlice {
  category: Category
  cents: number
}

/** Expense totals per category (only categories with spending), largest first. */
export function expensesByCategory(txs: Transaction[], categories: Category[]): CategorySlice[] {
  const sums = new Map<string, number>()
  for (const t of txs) if (t.type === 'expense') sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amountCents)
  const out: CategorySlice[] = []
  for (const c of categories) {
    const cents = sums.get(c.id)
    if (cents) out.push({ category: c, cents })
  }
  return out.sort((a, b) => b.cents - a.cents)
}

export interface BudgetStatus {
  category: Category
  spentCents: number
  budgetCents: number
  /** 0..1 for the bar width. */
  ratio: number
  over: boolean
}

export function budgetStatuses(txs: Transaction[], categories: Category[]): BudgetStatus[] {
  const spent = new Map<string, number>()
  for (const t of txs) if (t.type === 'expense') spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + t.amountCents)
  return categories
    .filter((c) => c.budgetCents !== null && c.budgetCents > 0)
    .map((c) => {
      const budgetCents = c.budgetCents as number
      const spentCents = spent.get(c.id) ?? 0
      return { category: c, spentCents, budgetCents, ratio: Math.min(1, spentCents / budgetCents), over: spentCents > budgetCents }
    })
}

export interface Filters {
  categoryId: string // '' = all
  type: '' | TxType
  search: string
}

export function applyFilters(txs: Transaction[], f: Filters): Transaction[] {
  const q = f.search.trim().toLowerCase()
  return txs.filter(
    (t) =>
      (f.categoryId === '' || t.categoryId === f.categoryId) &&
      (f.type === '' || t.type === f.type) &&
      (q === '' || t.note.toLowerCase().includes(q)),
  )
}

// ---------- validation ----------

export interface TxDraft {
  type: TxType
  amount: string
  categoryId: string
  date: string
  note: string
}

export type DraftErrors = Partial<Record<'amount' | 'date' | 'categoryId' | 'note', string>>

export const MAX_NOTE = 200

export function validateDraft(
  d: TxDraft,
  categories: Category[],
): { ok: true; value: Omit<Transaction, 'id'> } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {}
  const amount = parseAmount(d.amount)
  if (!amount.ok) errors.amount = amount.error
  if (d.date.trim() === '') errors.date = 'A date is required.'
  else if (!isValidDate(d.date)) errors.date = 'Enter a valid date.'
  if (!categories.some((c) => c.id === d.categoryId)) errors.categoryId = 'Choose a category.'
  const note = d.note.trim()
  if (note.length > MAX_NOTE) errors.note = `Keep the note under ${MAX_NOTE} characters.`
  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors }
  return { ok: true, value: { type: d.type, amountCents: amount.cents, categoryId: d.categoryId, date: d.date, note } }
}

export function validateCategoryName(name: string, categories: Category[]): string | null {
  const n = name.trim()
  if (n === '') return 'Enter a category name.'
  if (n.length > 30) return 'Keep the name under 30 characters.'
  if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) return 'That category already exists.'
  return null
}

// ---------- CSV ----------

function csvCell(value: string): string {
  // Neutralise spreadsheet formula injection, then quote if needed.
  let v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`
  return v
}

export function toCSV(txs: Transaction[], categories: Category[]): string {
  const name = new Map(categories.map((c) => [c.id, c.name]))
  const rows = [['Date', 'Type', 'Category', 'Amount', 'Note']]
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([t.date, t.type, name.get(t.categoryId) ?? 'Unknown', centsToPlain(t.amountCents), t.note])
  }
  return rows.map((r) => r.map((c, i) => (i === 3 ? c : csvCell(c))).join(',')).join('\r\n') + '\r\n'
}

// ---------- storage ----------

export const STORAGE_KEY = 'budget-tracker:v1'

function isCategory(x: unknown): x is Category {
  const c = x as Category
  return (
    !!c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.color === 'string' &&
    (c.budgetCents === null || (Number.isSafeInteger(c.budgetCents) && c.budgetCents >= 0))
  )
}

function isTransaction(x: unknown): x is Transaction {
  const t = x as Transaction
  return (
    !!t && typeof t.id === 'string' && (t.type === 'income' || t.type === 'expense') &&
    Number.isSafeInteger(t.amountCents) && t.amountCents > 0 && typeof t.categoryId === 'string' &&
    typeof t.date === 'string' && isValidDate(t.date) && typeof t.note === 'string' &&
    (t.recurringId === undefined || typeof t.recurringId === 'string')
  )
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const isValidMonth = (m: unknown): m is string => typeof m === 'string' && MONTH_RE.test(m)

function isRule(x: unknown): x is RecurringRule {
  const r = x as RecurringRule
  return (
    !!r && typeof r.id === 'string' && (r.type === 'income' || r.type === 'expense') &&
    Number.isSafeInteger(r.amountCents) && r.amountCents > 0 && typeof r.categoryId === 'string' &&
    Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 && typeof r.note === 'string' &&
    isValidMonth(r.startMonth) && (r.endMonth === null || isValidMonth(r.endMonth)) &&
    Array.isArray(r.generated) && r.generated.every(isValidMonth)
  )
}

/** Parse stored JSON; anything malformed falls back to defaults rather than crashing. */
export function parseStored(raw: string | null): AppData {
  if (!raw) return defaultData()
  try {
    // Version 1 had no recurring rules; it upgrades in place.
    const data = JSON.parse(raw) as Omit<Partial<AppData>, 'version'> & { version?: number }
    if (!data || (data.version !== 1 && data.version !== 2) || !Array.isArray(data.categories) || !Array.isArray(data.transactions)) return defaultData()
    const categories = data.categories.filter(isCategory)
    for (const d of DEFAULT_CATEGORIES) if (!categories.some((c) => c.id === d.id)) categories.push({ ...d })
    const ids = new Set(categories.map((c) => c.id))
    const recurring = (Array.isArray(data.recurring) ? data.recurring : [])
      .filter(isRule)
      .map((r) => (ids.has(r.categoryId) ? r : { ...r, categoryId: 'other' }))
    const ruleIds = new Set(recurring.map((r) => r.id))
    const transactions = data.transactions.filter(isTransaction).map((t) => {
      let out = ids.has(t.categoryId) ? t : { ...t, categoryId: 'other' }
      if (out.recurringId !== undefined && !ruleIds.has(out.recurringId)) {
        const { recurringId: _drop, ...rest } = out
        out = rest
      }
      return out
    })
    return { version: 2, categories, transactions, recurring }
  } catch {
    return defaultData()
  }
}

export function loadData(storage: Storage = localStorage): AppData {
  try {
    return parseStored(storage.getItem(STORAGE_KEY))
  } catch {
    return defaultData()
  }
}

export function saveData(data: AppData, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export { parseAmount }
