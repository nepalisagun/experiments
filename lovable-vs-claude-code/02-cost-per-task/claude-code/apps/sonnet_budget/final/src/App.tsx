import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addCategory, applyTx, currentMonth, expensesByCategory, filterTxs, formatCents, inMonth, isRepeating,
  loadData, materialise, monthLabel, parseAmount, saveData, shiftMonth, sortTxs, stopRule, toCsv, todayStr,
  totals, validateTx,
  type AppData, type FormErrors, type Filters, type Recurring, type Transaction, type TxType,
} from './lib/logic'

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-2 focus:outline-indigo-500'
const btn = 'rounded-lg px-3 py-2 text-sm font-medium'
const card = 'rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200'

const newId = () => `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export default function App() {
  const [data, setData] = useState<AppData>(() => loadData(localStorage))
  const [month, setMonth] = useState(currentMonth)
  const [filters, setFilters] = useState<Filters>({ categoryId: '', type: '', search: '' })
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null)

  const [view, setView] = useState<'month' | 'recurring'>('month')

  useEffect(() => saveData(localStorage, data), [data])
  // Create any missing repeating transactions for the month being viewed (idempotent).
  useEffect(() => setData((d) => materialise(d, month)), [month])

  const catMap = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories])
  const monthTxs = useMemo(() => inMonth(data.transactions, month), [data.transactions, month])
  const sum = totals(monthTxs)
  const byCat = expensesByCategory(monthTxs)
  const visible = useMemo(() => sortTxs(filterTxs(monthTxs, filters)), [monthTxs, filters])

  const saveTx = (t: Transaction, repeat: boolean) => setData((d) => materialise(applyTx(d, t, repeat), month))

  const deleteTx = (t: Transaction) => {
    if (confirm(`Delete this ${t.type} of ${formatCents(t.cents)}?`))
      setData((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== t.id) }))
  }

  const exportCsv = () => {
    const blob = new Blob([toCsv(monthTxs, data.categories)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `transactions-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-xl font-bold">Budget Tracker</h1>
          <nav className="flex gap-1 rounded-lg bg-slate-100 p-1" aria-label="Screens">
            {([['month', 'Month'], ['recurring', 'Recurring']] as const).map(([v, label]) => (
              <button
                key={v} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >{label}</button>
            ))}
          </nav>
          {view === 'month' && <div className="flex items-center gap-2">
            <button aria-label="Previous month" className={`${btn} bg-slate-100 hover:bg-slate-200`} onClick={() => setMonth(shiftMonth(month, -1))}>
              ‹
            </button>
            <span data-testid="month-label" className="min-w-36 text-center font-semibold">{monthLabel(month)}</span>
            <button aria-label="Next month" className={`${btn} bg-slate-100 hover:bg-slate-200`} onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </button>
            <button className={`${btn} text-indigo-700 hover:bg-indigo-50`} onClick={() => setMonth(currentMonth())}>
              Today
            </button>
          </div>}
        </div>
      </header>

      {view === 'recurring' && <RecurringView data={data} setData={setData} viewedMonth={month} />}
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4" hidden={view !== 'month'}>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Month totals">
          <Stat label="Income" value={sum.income} cls="text-teal-600" testid="total-income" />
          <Stat label="Expenses" value={sum.expenses} cls="text-rose-600" testid="total-expenses" />
          <Stat label="Balance" value={sum.balance} cls={sum.balance < 0 ? 'text-rose-600' : 'text-slate-900'} testid="total-balance" />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className={card}>
            <h2 className="mb-3 font-semibold">Expenses by category</h2>
            <Donut byCat={byCat} data={data} />
          </section>
          <Budgets data={data} setData={setData} byCat={byCat} />
        </div>

        <section className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Transactions</h2>
            <div className="flex gap-2">
              <button className={`${btn} border border-slate-300 hover:bg-slate-50`} onClick={exportCsv} disabled={!monthTxs.length}>
                Export CSV
              </button>
              <button className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`} onClick={() => setEditing('new')}>
                + Add transaction
              </button>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input
              className={input} type="search" placeholder="Search notes…" aria-label="Search notes"
              value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
            <select className={input} aria-label="Filter by category" value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
              <option value="">All categories</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className={input} aria-label="Filter by type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value as Filters['type'] })}>
              <option value="">Income &amp; expenses</option>
              <option value="income">Income only</option>
              <option value="expense">Expenses only</option>
            </select>
            <button
              className={`${btn} border border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40`}
              disabled={!filters.search && !filters.categoryId && !filters.type}
              onClick={() => setFilters({ categoryId: '', type: '', search: '' })}
            >
              Clear filters
            </button>
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {monthTxs.length ? 'No transactions match your filters.' : 'No transactions this month yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="tx-list">
              {visible.map((t) => {
                const c = catMap.get(t.categoryId)
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2" data-testid="tx-row">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c?.color ?? '#94a3b8' }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {t.recurringId && <span title="Repeats monthly" aria-label="Recurring" className="mr-1 text-indigo-600">↻</span>}
                        {c?.name ?? 'Unknown'}{t.note && <span className="font-normal text-slate-600"> · {t.note}</span>}
                      </div>
                      <div className="text-xs text-slate-500">{t.date}</div>
                    </div>
                    <div className={`text-sm font-semibold tabular-nums ${t.type === 'income' ? 'text-teal-600' : 'text-rose-600'}`}>
                      {t.type === 'income' ? '+' : '−'}{formatCents(t.cents)}
                    </div>
                    <button className="rounded px-2 py-1 text-sm text-indigo-700 hover:bg-indigo-50" onClick={() => setEditing(t)} aria-label={`Edit ${c?.name ?? ''} ${t.date}`}>Edit</button>
                    <button className="rounded px-2 py-1 text-sm text-rose-700 hover:bg-rose-50" onClick={() => deleteTx(t)} aria-label={`Delete ${c?.name ?? ''} ${t.date}`}>Delete</button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>

      {editing && (
        <TxDialog
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          defaultDate={month === currentMonth() ? todayStr() : `${month}-01`}
          data={data}
          setData={setData}
          onSave={(t, repeat) => { saveTx(t, repeat); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RecurringView({ data, setData, viewedMonth }: { data: AppData; setData: (f: (d: AppData) => AppData) => void; viewedMonth: string }) {
  const rules = [...data.recurring].sort((a, b) => Number(!!a.endMonth) - Number(!!b.endMonth) || a.startMonth.localeCompare(b.startMonth))
  return (
    <main className="mx-auto max-w-3xl space-y-3 px-4 py-4">
      <div>
        <h2 className="text-lg font-semibold">Recurring transactions</h2>
        <p className="text-sm text-slate-600">
          These repeat every month. To add one, tick “Repeat monthly” when adding a transaction.
        </p>
      </div>
      {rules.length === 0 ? (
        <p className={`${card} py-10 text-center text-sm text-slate-500`}>No recurring transactions yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="rule-list">
          {rules.map((r) => <RuleRow key={r.id} rule={r} data={data} setData={setData} viewedMonth={viewedMonth} />)}
        </ul>
      )}
    </main>
  )
}

function RuleRow({ rule, data, setData, viewedMonth }: { rule: Recurring; data: AppData; setData: (f: (d: AppData) => AppData) => void; viewedMonth: string }) {
  const c = data.categories.find((x) => x.id === rule.categoryId)
  const options = useMemo(() => {
    const last = viewedMonth > shiftMonth(rule.startMonth, 60) ? shiftMonth(viewedMonth, 12) : shiftMonth(rule.startMonth, 60)
    const out: string[] = []
    for (let m = rule.startMonth; m <= last; m = shiftMonth(m, 1)) out.push(m)
    return out
  }, [rule.startMonth, viewedMonth])
  const preferred = viewedMonth > rule.startMonth ? viewedMonth : shiftMonth(rule.startMonth, 1)
  const [from, setFrom] = useState(preferred)
  const stopped = !!rule.endMonth

  const stop = () => {
    if (!confirm(`Stop “${c?.name ?? ''}${rule.note ? ` · ${rule.note}` : ''}” from ${monthLabel(from)} on? Earlier months stay unchanged; this and later months lose their occurrences.`)) return
    setData((d) => stopRule(d, rule.id, from))
  }

  return (
    <li className={card} data-testid="rule-row" data-stopped={stopped}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c?.color ?? '#94a3b8' }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c?.name ?? 'Unknown'}{rule.note && <span className="font-normal text-slate-600"> · {rule.note}</span>}</div>
          <div className="text-xs text-slate-500">
            Day {rule.day} of each month{rule.day > 28 ? ' (last day in shorter months)' : ''} · from {monthLabel(rule.startMonth)}
          </div>
        </div>
        <div className={`font-semibold tabular-nums ${rule.type === 'income' ? 'text-teal-600' : 'text-rose-600'}`}>
          {rule.type === 'income' ? '+' : '−'}{formatCents(rule.cents)}
        </div>
      </div>
      {stopped ? (
        <p className="mt-2 text-sm text-slate-600" data-testid="rule-status">Stopped from {monthLabel(rule.endMonth!)}. Earlier months are unchanged.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span data-testid="rule-status" className="mr-auto text-sm text-teal-700">Active</span>
          <label className="flex items-center gap-2 text-sm">
            Stop from
            <select className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={`Stop ${c?.name ?? ''} from month`}>
              {options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <button className={`${btn} bg-rose-600 text-white hover:bg-rose-700`} onClick={stop} aria-label={`Stop ${c?.name ?? ''} ${rule.note}`.trim()}>Stop</button>
        </div>
      )}
    </li>
  )
}

function Stat({ label, value, cls, testid }: { label: string; value: number; cls: string; testid: string }) {
  return (
    <div className={card}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${cls}`} data-testid={testid}>{formatCents(value)}</div>
    </div>
  )
}

function Donut({ byCat, data }: { byCat: Record<string, number>; data: AppData }) {
  const slices = data.categories.filter((c) => byCat[c.id] > 0).map((c) => ({ c, v: byCat[c.id] }))
  const total = slices.reduce((s, x) => s + x.v, 0)
  if (!total) return <p className="py-10 text-center text-sm text-slate-500">No expenses this month.</p>
  const R = 60
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <svg viewBox="0 0 160 160" className="h-44 w-44 shrink-0 -rotate-90" role="img" aria-label="Expenses by category donut chart" data-testid="donut">
        {slices.map(({ c, v }) => {
          const len = (v / total) * C
          const el = (
            <circle key={c.id} cx="80" cy="80" r={R} fill="none" stroke={c.color} strokeWidth="26"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} data-testid="donut-slice">
              <title>{c.name}: {formatCents(v)}</title>
            </circle>
          )
          offset += len
          return el
        })}
      </svg>
      <ul className="w-full space-y-1 text-sm">
        {slices.map(({ c, v }) => (
          <li key={c.id} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
            <span className="flex-1">{c.name}</span>
            <span className="tabular-nums text-slate-600">{formatCents(v)}</span>
            <span className="w-12 text-right tabular-nums text-slate-500">{Math.round((v / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Budgets({ data, setData, byCat }: { data: AppData; setData: (f: (d: AppData) => AppData) => void; byCat: Record<string, number> }) {
  const [error, setError] = useState('')
  const setBudget = (id: string, raw: string) => {
    if (raw.trim() === '') {
      setError('')
      return setData((d) => { const b = { ...d.budgets }; delete b[id]; return { ...d, budgets: b } })
    }
    const cents = parseAmount(raw)
    if (cents === null || cents <= 0) return setError('Budget must be an amount greater than zero (or empty for none).')
    setError('')
    setData((d) => ({ ...d, budgets: { ...d.budgets, [id]: cents } }))
  }
  return (
    <section className={card}>
      <h2 className="mb-3 font-semibold">Monthly budgets</h2>
      <ul className="space-y-3">
        {data.categories.map((c) => {
          const spent = byCat[c.id] ?? 0
          const budget = data.budgets[c.id]
          const over = budget !== undefined && spent > budget
          const pct = budget ? Math.min(100, (spent / budget) * 100) : 0
          return (
            <li key={c.id} data-testid="budget-row">
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                <span className="flex-1 font-medium">{c.name}</span>
                <span className={`tabular-nums ${over ? 'font-semibold text-red-600' : 'text-slate-600'}`}>
                  {formatCents(spent)} /
                </span>
                <BudgetInput key={`${c.id}:${budget ?? ''}`} label={`Budget for ${c.name}`} cents={budget} onCommit={(v) => setBudget(c.id, v)} />
              </div>
              {budget !== undefined && (
                <div
                  role="progressbar" aria-label={`${c.name} budget used`} aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={Math.round(pct)} data-over={over} data-testid="budget-bar"
                  className="h-2 overflow-hidden rounded-full bg-slate-200"
                >
                  <div className={`h-full ${over ? 'bg-red-600' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                </div>
              )}
              {over && <p className="mt-1 text-xs text-red-600">Over budget by {formatCents(spent - budget)}</p>}
            </li>
          )
        })}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  )
}

function BudgetInput({ label, cents, onCommit }: { label: string; cents?: number; onCommit: (v: string) => void }) {
  const [v, setV] = useState(cents === undefined ? '' : formatCents(cents).replace(/,/g, ''))
  return (
    <input
      className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm tabular-nums focus:outline-2 focus:outline-indigo-500"
      inputMode="decimal" placeholder="No budget" aria-label={label} value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function TxDialog({
  initial, defaultDate, data, setData, onSave, onClose,
}: {
  initial: Transaction | null; defaultDate: string; data: AppData
  setData: (f: (d: AppData) => AppData) => void
  onSave: (t: Transaction, repeat: boolean) => void; onClose: () => void
}) {
  const [repeat, setRepeat] = useState(() => (initial ? isRepeating(data, initial) : false))
  const [type, setType] = useState<TxType>(initial?.type ?? 'expense')
  const [amount, setAmount] = useState(initial ? formatCents(initial.cents).replace(/,/g, '') : '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? data.categories[0]?.id ?? '')
  const [date, setDate] = useState(initial?.date ?? defaultDate)
  const [note, setNote] = useState(initial?.note ?? '')
  const [errors, setErrors] = useState<FormErrors>({})
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#eab308')
  const [catError, setCatError] = useState('')
  const [showCat, setShowCat] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const { errors, cents } = validateTx({ type, amount, categoryId, date, note }, data.categories)
    setErrors(errors)
    if (Object.keys(errors).length || cents === null) return
    onSave({ id: initial?.id ?? newId(), type, cents, categoryId, date, note: note.trim(), recurringId: initial?.recurringId }, repeat)
  }

  const createCat = () => {
    const r = addCategory(data.categories, newName, newColor)
    if (r.error) return setCatError(r.error)
    const created = r.categories[r.categories.length - 1]
    setData((d) => ({ ...d, categories: r.categories }))
    setCategoryId(created.id)
    setNewName(''); setCatError(''); setShowCat(false)
  }

  const err = (m?: string, id?: string) => m && <p id={id} role="alert" className="mt-1 text-xs text-red-600">{m}</p>

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        noValidate onSubmit={submit} role="dialog" aria-modal="true" aria-label={initial ? 'Edit transaction' : 'Add transaction'}
        className="max-h-full w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 className="text-lg font-semibold">{initial ? 'Edit transaction' : 'Add transaction'}</h2>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Type">
          {(['expense', 'income'] as const).map((t) => (
            <button
              type="button" key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)}
              className={`rounded-md py-1.5 text-sm font-medium capitalize ${type === t ? 'bg-white shadow-sm' : 'text-slate-500'}`}
            >{t}</button>
          ))}
        </div>

        <label className="block text-sm font-medium">Amount
          <input className={`${input} mt-1`} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} autoFocus />
          {err(errors.amount)}
        </label>

        <div>
          <label htmlFor="tx-category" className="block text-sm font-medium">Category</label>
          <select id="tx-category" className={`${input} mt-1`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {err(errors.categoryId)}
          {showCat ? (
            <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2">
              <div className="flex gap-2">
                <input className={input} placeholder="New category name" aria-label="New category name" value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCat() } }} />
                <input type="color" aria-label="New category colour" className="h-9 w-12 shrink-0 cursor-pointer rounded border border-slate-300" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
                <button type="button" className={`${btn} bg-slate-800 text-white`} onClick={createCat}>Add</button>
              </div>
              {err(catError)}
            </div>
          ) : (
            <button type="button" className="mt-1 text-sm text-indigo-700 hover:underline" onClick={() => setShowCat(true)}>+ New category</button>
          )}
        </div>

        <label className="block text-sm font-medium">Date
          <input className={`${input} mt-1`} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} />
          {err(errors.date)}
        </label>

        <label className="block text-sm font-medium">Note <span className="font-normal text-slate-500">(optional)</span>
          <input className={`${input} mt-1`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
          <span>
            <span className="font-medium">Repeat monthly</span>
            <span className="block text-xs text-slate-500">
              {initial?.recurringId
                ? 'Unchecking stops it from next month on; this and earlier months stay. Edits here change only this month.'
                : 'Appears in every later month on the same day (last day in shorter months).'}
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={`${btn} hover:bg-slate-100`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>Save</button>
        </div>
      </form>
    </div>
  )
}
