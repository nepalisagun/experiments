import { useEffect, useMemo, useState } from 'react'
import {
  applyFilters, budgetStatuses, defaultDateFor, expensesByCategory, loadData, monthLabel, monthOf, newId, saveData,
  shiftMonth, STORAGE_KEY, parseStored, todayISO, totals, toCSV, transactionsForMonth,
  type AppData, type Filters, type Transaction,
} from './lib/budget.ts'
import { deleteCategory, materializeMonth, repeatsAfter, saveTransaction, stopRule } from './lib/recurring.ts'
import { formatCents } from './lib/money.ts'
import { DonutChart } from './components/DonutChart.tsx'
import { TransactionForm } from './components/TransactionForm.tsx'
import { BudgetBars, CategoriesPanel } from './components/Categories.tsx'
import { RecurringScreen } from './components/RecurringScreen.tsx'

const card = 'rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5'
const control = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:ring-2 focus:ring-stone-200'

type View = 'overview' | 'recurring'
const viewFromHash = (): View => (window.location.hash === '#/recurring' ? 'recurring' : 'overview')

export default function App() {
  const [data, setData] = useState<AppData>(() => loadData())
  const [month, setMonth] = useState(() => monthOf(todayISO()))
  const [view, setView] = useState<View>(viewFromHash)

  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Fill in repeating transactions for the month on screen. Idempotent, so reopening never duplicates.
  useEffect(() => setData((d) => materializeMonth(d, month, newId)), [data.recurring, month])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({ categoryId: '', type: '', search: '' })
  const [notice, setNotice] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => setSaveFailed(!saveData(data)), [data])

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && setData(parseStored(e.newValue))
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const monthTx = useMemo(() => transactionsForMonth(data.transactions, month), [data.transactions, month])
  const sums = useMemo(() => totals(monthTx), [monthTx])
  const slices = useMemo(() => expensesByCategory(monthTx, data.categories), [monthTx, data.categories])
  const budgets = useMemo(() => budgetStatuses(monthTx, data.categories), [monthTx, data.categories])
  const visible = useMemo(() => applyFilters(monthTx, filters), [monthTx, filters])
  const catById = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories])
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of data.transactions) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1)
    return m
  }, [data.transactions])
  const editing = data.transactions.find((t) => t.id === editingId) ?? null
  const defaultDate = useMemo(() => defaultDateFor(month), [month])
  const filtered = filters.categoryId !== '' || filters.type !== '' || filters.search.trim() !== ''

  const editingRepeats = editing ? repeatsAfter(editing, data.recurring) : false

  const submitTx = (value: Omit<Transaction, 'id' | 'recurringId'>, repeat: boolean) => {
    const r = saveTransaction(data, { editingId: editing?.id ?? null, value, repeat }, newId)
    if (!r.ok) return r.error
    setData(r.data)
    const where = monthOf(value.date) === month ? '' : ` ${editing ? 'and moved to' : 'to'} ${monthLabel(monthOf(value.date))}`
    const repeatNote = repeat ? (editing && editingRepeats ? ' Later months updated too.' : ' It repeats monthly.') : editing && editingRepeats ? ' It no longer repeats.' : ''
    setNotice(`Transaction ${editing ? 'updated' : 'added'}${where}.${repeatNote}`)
    if (editing) setEditingId(null)
    return null
  }

  const stopRecurring = (ruleId: string, stopMonth: string) => {
    const r = stopRule(data, ruleId, stopMonth)
    if (!r.ok) return r.error
    setData(r.data)
    setEditingId(null)
    setNotice(r.removedRule ? 'Repeating transaction deleted from every month.' : `Stopped from ${monthLabel(stopMonth)} on. Earlier months are unchanged.`)
    return null
  }

  const deleteTx = (t: Transaction) => {
    const label = `${t.type} of ${formatCents(t.amountCents)}${t.note ? ` (“${t.note}”)` : ''}`
    const series = t.recurringId && data.recurring.some((r) => r.id === t.recurringId)
    const msg = series
      ? `Delete this ${label} from ${monthLabel(monthOf(t.date))} only?\n\nIt keeps repeating in other months. To stop it, use the Recurring screen.`
      : `Delete this ${label}?`
    if (!window.confirm(msg)) return
    setData((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== t.id) }))
    if (editingId === t.id) setEditingId(null)
    setNotice('Transaction deleted.')
  }

  const exportCSV = () => {
    const blob = new Blob(['﻿' + toCSV(monthTx, data.categories)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `budget-${month}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const goMonth = (m: string) => {
    setMonth(m)
    setEditingId(null)
  }

  const goView = (v: View) => {
    setEditingId(null)
    setNotice(null)
    window.location.hash = v === 'recurring' ? '#/recurring' : '#/'
  }

  const activeRules = data.recurring.filter((r) => r.endMonth === null).length
  const tab = (v: View, label: string) => (
    <a
      href={v === 'recurring' ? '#/recurring' : '#/'}
      onClick={(e) => { e.preventDefault(); goView(v) }}
      aria-current={view === v ? 'page' : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
    >
      {label}
    </a>
  )

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">Budget</h1>
          </div>
          <nav className="flex rounded-lg bg-stone-100 p-1 sm:order-last" aria-label="Screens">
            {tab('overview', 'Overview')}
            {tab('recurring', activeRules ? `Recurring (${activeRules})` : 'Recurring')}
          </nav>
          {view === 'overview' && (
          <nav className="order-last flex w-full items-center justify-center gap-1 sm:order-none sm:w-auto" aria-label="Month">
            <button type="button" onClick={() => goMonth(shiftMonth(month, -1))} className="rounded-lg p-2 text-stone-600 hover:bg-stone-100" aria-label="Previous month">‹</button>
            <label htmlFor="month" className="sr-only">Selected month</label>
            <div className="relative">
              <span className="pointer-events-none block min-w-36 text-center font-medium" data-testid="month-label">{monthLabel(month)}</span>
              <input
                id="month"
                type="month"
                value={month}
                onChange={(e) => e.target.value && goMonth(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </div>
            <button type="button" onClick={() => goMonth(shiftMonth(month, 1))} className="rounded-lg p-2 text-stone-600 hover:bg-stone-100" aria-label="Next month">›</button>
            {month !== monthOf(todayISO()) && (
              <button type="button" onClick={() => goMonth(monthOf(todayISO()))} className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100">Today</button>
            )}
          </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:py-6">
        {saveFailed && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Couldn’t save to this browser’s storage. Changes will be lost on reload.
          </p>
        )}

        {view === 'recurring' ? (
          <>
            <p className={`text-sm text-green-800 ${notice ? '' : 'sr-only'}`} role="status">{notice}</p>
            <RecurringScreen rules={data.recurring} categories={data.categories} suggestedStop={shiftMonth(monthOf(todayISO()), 1)} onStop={stopRecurring} />
          </>
        ) : (
        <>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Month totals">
          <Stat label="Income" cents={sums.incomeCents} tone="text-teal-700" testId="total-income" />
          <Stat label="Expenses" cents={sums.expenseCents} tone="text-stone-900" testId="total-expenses" />
          <Stat label="Balance" cents={sums.balanceCents} tone={sums.balanceCents < 0 ? 'text-red-700' : 'text-stone-900'} testId="total-balance" />
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start">
            <div className={`${card} lg:col-start-1 lg:row-start-1`}>
              <TransactionForm
                categories={data.categories}
                defaultDate={defaultDate}
                editing={editing}
                editingRepeats={editingRepeats}
                onSubmit={submitTx}
                onCancel={() => setEditingId(null)}
              />
              <p className="mt-2 min-h-5 text-sm text-green-800" role="status">{notice}</p>
            </div>
            <div className={`${card} order-last lg:order-none lg:col-start-1 lg:row-start-2`}>
              <CategoriesPanel
                categories={data.categories}
                usage={usage}
                onAdd={(name, color) => setData((d) => ({ ...d, categories: [...d.categories, { id: newId(), name, color, budgetCents: null }] }))}
                onBudget={(id, cents) => setData((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, budgetCents: cents } : c)) }))}
                onDelete={(id) => {
                  setData((d) => deleteCategory(d, id))
                  if (filters.categoryId === id) setFilters((f) => ({ ...f, categoryId: '' }))
                }}
              />
            </div>

          <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <section className={card} aria-labelledby="chart-h">
                <h2 id="chart-h" className="mb-3 text-base font-semibold">Spending by category</h2>
                <DonutChart slices={slices} />
              </section>
              <section className={card} aria-labelledby="budget-h">
                <h2 id="budget-h" className="mb-3 text-base font-semibold">Budgets</h2>
                <BudgetBars statuses={budgets} />
              </section>
            </div>

            <section className={card} aria-labelledby="tx-h">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <h2 id="tx-h" className="text-base font-semibold">Transactions</h2>
                  <span className="text-xs text-stone-500" data-testid="tx-count">
                    {filtered ? `Showing ${visible.length} of ${monthTx.length}` : `${monthTx.length} this month`}
                  </span>
                </div>
                <button type="button" onClick={exportCSV} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-50">
                  Export CSV
                </button>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                <label className="sr-only" htmlFor="f-cat">Filter by category</label>
                <select id="f-cat" className={control} value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
                  <option value="">All categories</option>
                  {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <label className="sr-only" htmlFor="f-type">Filter by type</label>
                <select id="f-type" className={control} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value as Filters['type'] })}>
                  <option value="">All types</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
                <label className="sr-only" htmlFor="f-search">Search notes</label>
                <div className="col-span-2 flex gap-2 sm:contents">
                  <input id="f-search" type="search" placeholder="Search notes…" className={`${control} min-w-0 flex-1`} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                  <button
                    type="button"
                    disabled={!filtered}
                    onClick={() => setFilters({ categoryId: '', type: '', search: '' })}
                    className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-stone-400 disabled:hover:bg-transparent"
                  >
                    Clear filters
                  </button>
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="py-8 text-center text-sm text-stone-500">
                  {monthTx.length === 0 ? `No transactions in ${monthLabel(month)}.` : 'No transactions match the filters.'}
                </div>
              ) : (
                <ul className="divide-y divide-stone-100" aria-label="Transactions">
                  {visible.map((t) => {
                    const c = catById.get(t.categoryId)
                    return (
                      <li key={t.id} data-testid="tx-row" className={`flex items-center gap-3 py-2.5 ${editingId === t.id ? 'bg-amber-50' : ''}`}>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c?.color ?? '#999' }} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-stone-900">{t.note || <span className="text-stone-500">{c?.name ?? 'Unknown'}</span>}</div>
                          <div className="text-xs text-stone-500">
                            {c?.name ?? 'Unknown'} · {new Date(t.date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {t.recurringId && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-stone-100 px-1.5 text-[11px] font-medium text-stone-600" data-testid="tx-repeat-badge">
                                <span aria-hidden="true">↻</span> Monthly
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${t.type === 'income' ? 'text-teal-700' : 'text-stone-900'}`} data-testid="tx-amount">
                          {t.type === 'income' ? '+' : '−'}{formatCents(t.amountCents)}
                        </span>
                        <div className="flex shrink-0 gap-0.5">
                          <button type="button" onClick={() => setEditingId(t.id)} className="rounded px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100" aria-label={`Edit ${t.note || c?.name}`}>Edit</button>
                          <button type="button" onClick={() => deleteTx(t)} className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50" aria-label={`Delete ${t.note || c?.name}`}>Delete</button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  )
}

function Stat({ label, cents, tone, testId }: { label: string; cents: number; tone: string; testId: string }) {
  return (
    <div className={`${card} flex items-baseline justify-between sm:block`}>
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums sm:mt-1 sm:text-2xl ${tone}`} data-testid={testId}>{formatCents(cents)}</div>
    </div>
  )
}
