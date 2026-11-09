import { centsToPlain, parseAmount } from './money'

export type TxType = 'income' | 'expense'
export interface Category { id: string; name: string; color: string }
export interface Transaction {
  id: string
  type: TxType
  amount: number // cents, > 0
  categoryId: string
  date: string // YYYY-MM-DD
  note: string
  recurringId?: string // set when this transaction belongs to a monthly repeat rule
}
/** A monthly repeat rule. Occurrences become real transactions when their month is opened. */
export interface Recurring {
  id: string
  type: TxType
  amount: number
  categoryId: string
  note: string
  day: number // intended day of month (1-31); clamped to the last day in shorter months
  startMonth: string // first month (the original transaction); occurrences begin the month after
  stopFrom?: string // from this month on there are no occurrences
  done: string[] // months already filled in, so reopening a month never duplicates (or resurrects deleted ones)
}
export type Budgets = Record<string, number> // categoryId -> cents per month
export interface AppData { transactions: Transaction[]; categories: Category[]; budgets: Budgets; recurring: Recurring[] }

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', name: 'Food', color: '#f97316' },
  { id: 'housing', name: 'Housing', color: '#6366f1' },
  { id: 'transport', name: 'Transport', color: '#0ea5e9' },
  { id: 'fun', name: 'Fun', color: '#ec4899' },
  { id: 'health', name: 'Health', color: '#10b981' },
  { id: 'other', name: 'Other', color: '#64748b' },
]

// ---------- dates ----------
export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}
export const monthOf = (date: string) => date.slice(0, 7)
export function todayISO(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate())
}
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return Math.floor(idx / 12) + '-' + String((idx % 12) + 1).padStart(2, '0')
}
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

// ---------- validation ----------
export interface FormInput { type: TxType; amount: string; categoryId: string; date: string; note: string; repeat: boolean }
export type TxValue = Omit<Transaction, 'id' | 'recurringId'> & { repeat: boolean }
export type FormErrors = Partial<Record<'amount' | 'categoryId' | 'date', string>>

export function validateForm(f: FormInput, categories: Category[]):
  { ok: true; value: TxValue } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {}
  const cents = parseAmount(f.amount)
  if (!f.amount.trim()) errors.amount = 'Enter an amount.'
  else if (/^-/.test(f.amount.trim()) && /\d/.test(f.amount)) errors.amount = 'Amount must be greater than zero.'
  else if (cents === null) errors.amount = 'Amount must be a number with at most 2 decimals (e.g. 12.50).'
  else if (cents <= 0) errors.amount = 'Amount must be greater than zero.'
  if (!f.date) errors.date = 'Pick a date.'
  else if (!isValidDate(f.date)) errors.date = 'That is not a valid date.'
  if (!categories.some((c) => c.id === f.categoryId)) errors.categoryId = 'Choose a category.'
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { type: f.type, amount: cents!, categoryId: f.categoryId, date: f.date, note: f.note.trim(), repeat: f.repeat } }
}

// ---------- calculations ----------
export const inMonth = (txs: Transaction[], month: string) => txs.filter((t) => monthOf(t.date) === month)

export function totals(txs: Transaction[]) {
  let income = 0
  let expenses = 0
  for (const t of txs) {
    if (t.type === 'income') income += t.amount
    else expenses += t.amount
  }
  return { income, expenses, balance: income - expenses }
}

export function expensesByCategory(txs: Transaction[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of txs) if (t.type === 'expense') out[t.categoryId] = (out[t.categoryId] ?? 0) + t.amount
  return out
}

export interface Filters { categoryId: string; type: TxType | 'all'; search: string }
export function applyFilters(txs: Transaction[], f: Filters): Transaction[] {
  const q = f.search.trim().toLowerCase()
  return txs.filter((t) =>
    (f.categoryId === 'all' || t.categoryId === f.categoryId) &&
    (f.type === 'all' || t.type === f.type) &&
    (!q || t.note.toLowerCase().includes(q)))
}

export function sortTx(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

// ---------- CSV ----------
function csvCell(v: string): string {
  // Neutralise spreadsheet formula injection, then quote when needed.
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}
export function toCSV(txs: Transaction[], categories: Category[]): string {
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? id
  const rows = [['Date', 'Type', 'Category', 'Amount', 'Note']]
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date)))
    rows.push([t.date, t.type, name(t.categoryId), centsToPlain(t.amount), t.note])
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

// ---------- persistence ----------
export const STORAGE_KEY = 'budget-tracker:v1'
export function emptyData(): AppData { return { transactions: [], categories: DEFAULT_CATEGORIES, budgets: {}, recurring: [] } }

export function loadData(storage: Pick<Storage, 'getItem'> = localStorage): AppData {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyData()
    const p = JSON.parse(raw)
    const categories: Category[] = Array.isArray(p.categories) && p.categories.length ? p.categories : DEFAULT_CATEGORIES
    const transactions: Transaction[] = (Array.isArray(p.transactions) ? p.transactions : []).filter(
      (t: Transaction) => t && Number.isSafeInteger(t.amount) && t.amount > 0 && isValidDate(t.date) &&
        (t.type === 'income' || t.type === 'expense') && typeof t.id === 'string')
    const recurring: Recurring[] = (Array.isArray(p.recurring) ? p.recurring : []).filter(
      (r: Recurring) => r && typeof r.id === 'string' && Number.isSafeInteger(r.amount) && r.amount > 0 &&
        (r.type === 'income' || r.type === 'expense') && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 &&
        /^\d{4}-\d{2}$/.test(r.startMonth) && Array.isArray(r.done))
    return { transactions, categories, recurring, budgets: p.budgets && typeof p.budgets === 'object' ? p.budgets : {} }
  } catch {
    return emptyData()
  }
}
export function saveData(d: AppData, storage: Pick<Storage, 'setItem'> = localStorage) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* quota / private mode */ }
}
