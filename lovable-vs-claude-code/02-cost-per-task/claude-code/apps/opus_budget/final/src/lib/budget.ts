import { centsToPlain, parseAmount, sumCents } from './money.ts'

export type TxType = 'income' | 'expense'

export interface Transaction {
  id: string
  type: TxType
  amountCents: number
  categoryId: string
  date: string // YYYY-MM-DD
  note: string
  recurringId?: string // set when this transaction belongs to a monthly repeating rule
}

/** A monthly repeating transaction. Its occurrences are materialised as normal Transactions. */
export interface RecurringRule {
  id: string
  type: TxType
  amountCents: number
  categoryId: string
  note: string
  dayOfMonth: number // 1-31; clamped to the last day in shorter months
  startMonth: string // YYYY-MM, first month it occurs
  endMonth: string | null // YYYY-MM, first month it NO LONGER occurs (null = forever)
  generatedThrough: string // YYYY-MM, every month from startMonth to here has been materialised
}

export interface Category {
  id: string
  name: string
  color: string
  budgetCents: number | null // monthly expense budget; null = none
  builtIn?: boolean
}

export interface AppData {
  transactions: Transaction[]
  categories: Category[]
  recurring: RecurringRule[]
}

// Validated categorical palette (fixed order).
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', name: 'Food', color: PALETTE[0], budgetCents: null, builtIn: true },
  { id: 'housing', name: 'Housing', color: PALETTE[1], budgetCents: null, builtIn: true },
  { id: 'transport', name: 'Transport', color: PALETTE[2], budgetCents: null, builtIn: true },
  { id: 'fun', name: 'Fun', color: PALETTE[6], budgetCents: null, builtIn: true },
  { id: 'health', name: 'Health', color: PALETTE[4], budgetCents: null, builtIn: true },
  { id: 'other', name: 'Other', color: '#7a7974', budgetCents: null, builtIn: true },
]

// ---------- dates / months ----------

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function todayISO(now = new Date()): string {
  return `${currentMonth(now)}-${String(now.getDate()).padStart(2, '0')}`
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// ---------- validation ----------

export interface TxInput {
  type: TxType
  amount: string
  categoryId: string
  date: string
  note: string
}

export type TxErrors = Partial<Record<'type' | 'amount' | 'categoryId' | 'date' | 'note', string>>

export const NOTE_MAX = 200

export function validateTransaction(
  input: TxInput,
  categories: Category[],
): { ok: true; value: Omit<Transaction, 'id'> } | { ok: false; errors: TxErrors } {
  const errors: TxErrors = {}
  if (input.type !== 'income' && input.type !== 'expense') errors.type = 'Choose income or expense.'
  const amt = parseAmount(input.amount)
  if (!amt.ok) errors.amount = amt.error
  if (!input.categoryId) errors.categoryId = 'Choose a category.'
  else if (!categories.some((c) => c.id === input.categoryId)) errors.categoryId = 'That category no longer exists.'
  if (!input.date.trim()) errors.date = 'Date is required.'
  else if (!isValidDate(input.date)) errors.date = 'Enter a valid date.'
  if (input.note.length > NOTE_MAX) errors.note = `Note can be at most ${NOTE_MAX} characters.`
  if (Object.keys(errors).length || !amt.ok) return { ok: false, errors }
  return {
    ok: true,
    value: { type: input.type, amountCents: amt.cents, categoryId: input.categoryId, date: input.date, note: input.note.trim() },
  }
}

export function validateCategoryName(name: string, categories: Category[]): string | null {
  const n = name.trim()
  if (!n) return 'Category name is required.'
  if (n.length > 30) return 'Category name can be at most 30 characters.'
  if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) return `A category named “${n}” already exists.`
  return null
}

// ---------- derived data ----------

export function forMonth(txs: Transaction[], month: string): Transaction[] {
  return txs
    .filter((t) => monthOf(t.date) === month)
    .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)))
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
      (!f.categoryId || t.categoryId === f.categoryId) &&
      (!f.type || t.type === f.type) &&
      (!q || t.note.toLowerCase().includes(q)),
  )
}

export function totals(txs: Transaction[]) {
  const income = sumCents(txs.filter((t) => t.type === 'income').map((t) => t.amountCents))
  const expenses = sumCents(txs.filter((t) => t.type === 'expense').map((t) => t.amountCents))
  return { income, expenses, balance: income - expenses }
}

export function expensesByCategory(txs: Transaction[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of txs) if (t.type === 'expense') out.set(t.categoryId, (out.get(t.categoryId) ?? 0) + t.amountCents)
  return out
}

/** Integer percentage spent of budget (may exceed 100). */
export function budgetStatus(spentCents: number, budgetCents: number) {
  const pct = budgetCents > 0 ? Math.round((spentCents * 100) / budgetCents) : 0
  return { pct, over: spentCents > budgetCents, remainingCents: budgetCents - spentCents }
}

// ---------- CSV ----------

function csvCell(v: string): string {
  // Neutralise spreadsheet formula injection, then quote when needed.
  let s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCSV(txs: Transaction[], categories: Category[]): string {
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Unknown'
  const rows = [['Date', 'Type', 'Category', 'Amount', 'Note']]
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date)))
    rows.push([t.date, t.type, name(t.categoryId), centsToPlain(t.amountCents), t.note])
  return rows.map((r) => r.map((c, i) => (i === 3 ? c : csvCell(c))).join(',')).join('\r\n') + '\r\n'
}

// ---------- persistence ----------

export const STORAGE_KEY = 'budget-tracker:v1'

function isTx(x: unknown): x is Transaction {
  const t = x as Transaction
  return (
    !!t &&
    typeof t.id === 'string' &&
    (t.type === 'income' || t.type === 'expense') &&
    Number.isInteger(t.amountCents) &&
    t.amountCents > 0 &&
    typeof t.categoryId === 'string' &&
    typeof t.date === 'string' &&
    isValidDate(t.date) &&
    typeof t.note === 'string' &&
    (t.recurringId === undefined || typeof t.recurringId === 'string')
  )
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function isRule(x: unknown): x is RecurringRule {
  const r = x as RecurringRule
  return (
    !!r &&
    typeof r.id === 'string' &&
    (r.type === 'income' || r.type === 'expense') &&
    Number.isInteger(r.amountCents) &&
    r.amountCents > 0 &&
    typeof r.categoryId === 'string' &&
    typeof r.note === 'string' &&
    Number.isInteger(r.dayOfMonth) &&
    r.dayOfMonth >= 1 &&
    r.dayOfMonth <= 31 &&
    typeof r.startMonth === 'string' &&
    MONTH_RE.test(r.startMonth) &&
    (r.endMonth === null || (typeof r.endMonth === 'string' && MONTH_RE.test(r.endMonth))) &&
    typeof r.generatedThrough === 'string' &&
    MONTH_RE.test(r.generatedThrough)
  )
}

function isCat(x: unknown): x is Category {
  const c = x as Category
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.color === 'string' &&
    (c.budgetCents === null || (Number.isInteger(c.budgetCents) && c.budgetCents > 0))
  )
}

export function defaultData(): AppData {
  return { transactions: [], categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), recurring: [] }
}

export function parseStored(raw: string | null): AppData {
  if (!raw) return defaultData()
  try {
    const d = JSON.parse(raw) as Partial<AppData>
    const categories = Array.isArray(d.categories) ? d.categories.filter(isCat) : []
    // Ensure built-ins always exist.
    for (const def of DEFAULT_CATEGORIES) if (!categories.some((c) => c.id === def.id)) categories.push({ ...def })
    const transactions = Array.isArray(d.transactions) ? d.transactions.filter(isTx) : []
    const recurring = Array.isArray(d.recurring) ? d.recurring.filter(isRule) : []
    return { categories, transactions, recurring }
  } catch {
    return defaultData()
  }
}

export function loadData(storage: Pick<Storage, 'getItem'> = localStorage): AppData {
  try {
    return parseStored(storage.getItem(STORAGE_KEY))
  } catch {
    return defaultData()
  }
}

export function saveData(data: AppData, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
