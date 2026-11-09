import { useState, type FormEvent } from 'react'
import {
  type Budgets, type Category, type FormErrors, type FormInput, type Transaction, type TxType,
  type TxValue, validateForm, expensesByCategory,
} from './lib/budget'
import { centsToPlain, formatCents, parseAmount } from './lib/money'

export const card = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
const btn = 'rounded-lg px-3 py-2 text-sm font-medium transition-colors'
const btnPrimary = btn + ' bg-indigo-600 text-white hover:bg-indigo-700'
const btnGhost = btn + ' border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'

export const Money = ({ cents }: { cents: number }) => <>${formatCents(cents)}</>

// ---------------- Transaction form ----------------
export function TransactionForm({ categories, initial, initialRepeat = false, defaultDate, onSubmit, onCancel }: {
  categories: Category[]
  initial?: Transaction
  initialRepeat?: boolean
  defaultDate: string
  onSubmit: (v: TxValue) => void
  onCancel?: () => void
}) {
  const blank = (): FormInput => ({ type: 'expense', amount: '', categoryId: categories[0].id, date: defaultDate, note: '', repeat: false })
  const [f, setF] = useState<FormInput>(
    initial ? { type: initial.type, amount: centsToPlain(initial.amount), categoryId: initial.categoryId, date: initial.date, note: initial.note, repeat: initialRepeat } : blank(),
  )
  const [errors, setErrors] = useState<FormErrors>({})
  const set = <K extends keyof FormInput>(k: K, v: FormInput[K]) => setF((p) => ({ ...p, [k]: v }))

  function submit(e: FormEvent) {
    e.preventDefault()
    const r = validateForm(f, categories)
    if (!r.ok) return setErrors(r.errors)
    setErrors({})
    onSubmit(r.value)
    if (!initial) setF({ ...blank(), type: f.type, categoryId: f.categoryId, date: f.date })
  }

  const Err = ({ id, msg }: { id: string; msg?: string }) =>
    msg ? <p id={id} role="alert" className="mt-1 text-xs font-medium text-red-600">{msg}</p> : null

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={initial ? 'Edit transaction' : 'Add transaction'}>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Type">
        {(['expense', 'income'] as TxType[]).map((t) => (
          <label key={t} className={`cursor-pointer rounded-md py-1.5 text-center text-sm font-medium capitalize ${f.type === t ? (t === 'income' ? 'bg-teal-600 text-white' : 'bg-rose-600 text-white') : 'text-slate-600'}`}>
            <input type="radio" name="type" value={t} checked={f.type === t} onChange={() => set('type', t)} className="sr-only" />
            {t}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="tx-amount" className="mb-1 block text-xs font-medium text-slate-600">Amount</label>
          <input id="tx-amount" inputMode="decimal" placeholder="0.00" value={f.amount} onChange={(e) => set('amount', e.target.value)}
            aria-invalid={!!errors.amount} aria-describedby={errors.amount ? 'err-amount' : undefined} className={input} />
          <Err id="err-amount" msg={errors.amount} />
        </div>
        <div>
          <label htmlFor="tx-date" className="mb-1 block text-xs font-medium text-slate-600">Date</label>
          <input id="tx-date" type="date" value={f.date} onChange={(e) => set('date', e.target.value)}
            aria-invalid={!!errors.date} aria-describedby={errors.date ? 'err-date' : undefined} className={input} />
          <Err id="err-date" msg={errors.date} />
        </div>
      </div>
      <div>
        <label htmlFor="tx-cat" className="mb-1 block text-xs font-medium text-slate-600">Category</label>
        <select id="tx-cat" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} className={input}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Err id="err-cat" msg={errors.categoryId} />
      </div>
      <div>
        <label htmlFor="tx-note" className="mb-1 block text-xs font-medium text-slate-600">Note <span className="text-slate-400">(optional)</span></label>
        <input id="tx-note" value={f.note} maxLength={200} onChange={(e) => set('note', e.target.value)} className={input} />
      </div>
      <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-sm">
        <input type="checkbox" checked={f.repeat} onChange={(e) => set('repeat', e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
        <span>
          <span className="font-medium">Repeat monthly</span>
          <span className="block text-xs text-slate-500">
            {initial ? 'Later months follow this transaction. Unticking stops it after this month.' : 'Appears automatically in every later month, on the same day (last day in shorter months).'}
          </span>
        </span>
      </label>
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary + ' flex-1'}>{initial ? 'Save changes' : 'Add transaction'}</button>
        {onCancel && <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>}
      </div>
    </form>
  )
}

// ---------------- Donut chart ----------------
export function Donut({ txs, categories }: { txs: Transaction[]; categories: Category[] }) {
  const by = expensesByCategory(txs)
  const slices = categories.filter((c) => by[c.id] > 0).map((c) => ({ c, v: by[c.id] }))
  const total = slices.reduce((s, x) => s + x.v, 0)
  const R = 15.9155 // circumference 100
  let offset = 0
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label="Expenses by category donut chart" data-testid="donut">
          <circle cx="21" cy="21" r={R} fill="none" stroke="#e2e8f0" strokeWidth="5" />
          {slices.map(({ c, v }) => {
            const pct = (v / total) * 100
            const el = (
              <circle key={c.id} data-testid={'slice-' + c.id} cx="21" cy="21" r={R} fill="none" stroke={c.color} strokeWidth="5"
                strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-offset}>
                <title>{c.name}: ${formatCents(v)}</title>
              </circle>
            )
            offset += pct
            return el
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-slate-500">Spent</span>
          <span className="text-lg font-semibold tabular-nums">${formatCents(total)}</span>
        </div>
      </div>
      {slices.length === 0 ? (
        <p className="text-sm text-slate-500">No expenses this month yet.</p>
      ) : (
        <ul className="w-full space-y-1.5 text-sm">
          {slices.map(({ c, v }) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="tabular-nums text-slate-500">{v * 100 < total ? '<1' : Math.round((v / total) * 100)}%</span>
              <span className="w-24 text-right tabular-nums">${formatCents(v)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------- Budgets ----------------
function BudgetRow({ cat, spent, budget, onChange }: { cat: Category; spent: number; budget?: number; onChange: (c: number | null) => void }) {
  const [text, setText] = useState(budget ? centsToPlain(budget) : '')
  const [err, setErr] = useState('')
  const [synced, setSynced] = useState(budget)
  if (synced !== budget) { setSynced(budget); setText(budget ? centsToPlain(budget) : '') }

  function commit() {
    if (!text.trim()) { setErr(''); return onChange(null) }
    const c = parseAmount(text)
    if (c === null || c <= 0) return setErr('Enter an amount above zero.')
    setErr('')
    onChange(c)
  }
  const over = budget ? spent > budget : false
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0
  return (
    <li className="space-y-1.5" data-testid={'budget-' + cat.id}>
      <div className="flex items-center gap-2 text-sm">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: cat.color }} />
        <span className="flex-1 truncate font-medium">{cat.name}</span>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          Budget $
          <input aria-label={`${cat.name} budget`} inputMode="decimal" value={text} placeholder="none"
            onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())}
            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm text-slate-900 focus:border-indigo-500 focus:outline-none" />
        </label>
      </div>
      {budget ? (
        <>
          <div role="progressbar" aria-label={`${cat.name} spending vs limit`} aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.min(spent, budget)}
            data-over={over} className="h-2.5 overflow-hidden rounded-full bg-slate-200">
            <div className={`h-full rounded-full ${over ? 'bg-red-600' : 'bg-emerald-500'}`} style={{ width: pct + '%' }} />
          </div>
          <p className={`text-xs tabular-nums ${over ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
            ${formatCents(spent)} of ${formatCents(budget)} · {over ? `over by $${formatCents(spent - budget)}` : `$${formatCents(budget - spent)} left`}
          </p>
        </>
      ) : (
        <p className="text-xs text-slate-400 tabular-nums">${formatCents(spent)} spent · no budget set</p>
      )}
      {err && <p role="alert" className="text-xs font-medium text-red-600">{err}</p>}
    </li>
  )
}

export function BudgetList({ categories, txs, budgets, onChange }: {
  categories: Category[]; txs: Transaction[]; budgets: Budgets; onChange: (id: string, c: number | null) => void
}) {
  const by = expensesByCategory(txs)
  return (
    <ul className="space-y-4">
      {categories.map((c) => <BudgetRow key={c.id} cat={c} spent={by[c.id] ?? 0} budget={budgets[c.id]} onChange={(v) => onChange(c.id, v)} />)}
    </ul>
  )
}

// ---------------- Add category ----------------
const PALETTE = ['#eab308', '#14b8a6', '#a855f7', '#ef4444', '#84cc16', '#06b6d4', '#f43f5e', '#8b5cf6']
export function AddCategory({ categories, onAdd }: { categories: Category[]; onAdd: (c: Category) => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[categories.length % PALETTE.length])
  const [err, setErr] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setErr('Give the category a name.')
    if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) return setErr('That category already exists.')
    onAdd({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, color })
    setName(''); setErr(''); setColor(PALETTE[(categories.length + 1) % PALETTE.length])
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Add category" className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="cat-name" className="mb-1 block text-xs font-medium text-slate-600">New category</label>
          <input id="cat-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} className={input} />
        </div>
        <input type="color" aria-label="Category colour" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded-lg border border-slate-300 bg-white p-1" />
        <button type="submit" className={btnPrimary}>Add</button>
      </div>
      {err && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{err}</p>}
    </form>
  )
}

// ---------------- Transaction row ----------------
export function TxRow({ t, cat, onEdit, onDelete }: { t: Transaction; cat?: Category; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="flex items-center gap-3 py-3" data-testid="tx-row">
      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: cat?.color ?? '#94a3b8' }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{cat?.name ?? 'Unknown'}{t.note && <span className="font-normal text-slate-500"> · {t.note}</span>}</p>
        <p className="text-xs text-slate-500">{t.date}{t.recurringId && <span data-testid="recurring-badge" className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">↻ Monthly</span>}</p>
      </div>
      <p className={`shrink-0 text-sm font-semibold tabular-nums ${t.type === 'income' ? 'text-teal-600' : 'text-slate-900'}`}>
        {t.type === 'income' ? '+' : '−'}${formatCents(t.amount)}
      </p>
      <div className="flex shrink-0 gap-1">
        {confirming ? (
          <>
            <button onClick={onDelete} className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white" aria-label="Confirm delete">Delete?</button>
            <button onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">No</button>
          </>
        ) : (
          <>
            <button onClick={onEdit} className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" aria-label="Edit transaction">Edit</button>
            <button onClick={() => setConfirming(true)} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50" aria-label="Delete transaction">Delete</button>
          </>
        )}
      </div>
    </li>
  )
}

export { input as inputCls, btnGhost, btnPrimary }
