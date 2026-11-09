import { useEffect, useMemo, useState } from 'react'
import { addTransaction, applyEdit, isRepeating, materialize, stopRule } from './lib/recurring'
import { RecurringScreen } from './recurring-ui'
import {
  type AppData, type Filters, type Transaction, type TxValue, applyFilters, inMonth, loadData, monthLabel, monthOf, saveData,
  shiftMonth, sortTx, todayISO, toCSV, totals,
} from './lib/budget'
import { AddCategory, BudgetList, Donut, Money, TransactionForm, TxRow, btnGhost, card, inputCls } from './components'

export default function App() {
  const [data, setData] = useState<AppData>(() => loadData())
  const [month, setMonth] = useState(() => monthOf(todayISO()))
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [filters, setFilters] = useState<Filters>({ categoryId: 'all', type: 'all', search: '' })

  const [view, setView] = useState<'overview' | 'recurring'>('overview')

  useEffect(() => saveData(data), [data])
  // Fill in repeating transactions for the opened month. Idempotent: returns the same state when nothing is due.
  useEffect(() => setData((d) => materialize(d, month)), [month, data.recurring])

  const monthTxs = useMemo(() => inMonth(data.transactions, month), [data.transactions, month])
  const t = totals(monthTxs)
  const visible = useMemo(() => sortTx(applyFilters(monthTxs, filters)), [monthTxs, filters])
  const defaultDate = todayISO().startsWith(month) ? todayISO() : month + '-01'
  const catOf = (id: string) => data.categories.find((c) => c.id === id)
  const filtering = filters.categoryId !== 'all' || filters.type !== 'all' || filters.search.trim() !== ''

  function addTx(v: TxValue) {
    setData((d) => addTransaction(d, v, crypto.randomUUID(), crypto.randomUUID()))
    // Show the month the user just added to, so the new row is visible.
    setMonth(monthOf(v.date))
  }
  function saveEdit(v: TxValue) {
    if (!editing) return
    setData((d) => applyEdit(d, editing.id, v, crypto.randomUUID()))
    setMonth(monthOf(v.date))
    setEditing(null)
  }
  function exportCsv() {
    const blob = new Blob([toCSV(monthTxs, data.categories)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `transactions-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold">Budget Tracker</h1>
          <nav aria-label="Screens" className="order-last flex w-full gap-1 rounded-lg bg-slate-100 p-1 sm:order-none sm:w-auto">
            {([['overview', 'Overview'], ['recurring', 'Recurring']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} aria-current={view === k ? 'page' : undefined}
                className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium sm:flex-none ${view === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
                {label}{k === 'recurring' && data.recurring.length > 0 && <span className="ml-1.5 text-xs text-slate-500">{data.recurring.length}</span>}
              </button>
            ))}
          </nav>
          {view === 'overview' ? <div className="flex items-center gap-2">
            <button aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className={btnGhost}>‹</button>
            <span data-testid="month-label" className="min-w-36 text-center text-sm font-semibold">{monthLabel(month)}</span>
            <button aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className={btnGhost}>›</button>
            <button onClick={() => setMonth(monthOf(todayISO()))} className={btnGhost}>Today</button>
          </div> : <div className="hidden sm:block sm:w-56" />}
        </div>
      </header>

      {view === 'recurring' ? (
        <main className="mx-auto max-w-3xl px-4 py-4">
          <RecurringScreen rules={data.recurring} categories={data.categories} suggested={month}
            lastMonth={shiftMonth(month > monthOf(todayISO()) ? month : monthOf(todayISO()), 24)}
            onStop={(id, from) => { setData((d) => stopRule(d, id, from)); setEditing((e) => (e && e.recurringId === id && monthOf(e.date) >= from ? null : e)) }} />
        </main>
      ) : (
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <section aria-label="Month totals" className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="Income" testid="total-income" tone="text-teal-600"><Money cents={t.income} /></Stat>
          <Stat label="Expenses" testid="total-expenses" tone="text-rose-600"><Money cents={t.expenses} /></Stat>
          <Stat label="Balance" testid="total-balance" tone={t.balance < 0 ? 'text-red-600' : 'text-slate-900'}>
            {t.balance < 0 && '−'}<Money cents={Math.abs(t.balance)} />
          </Stat>
        </section>

        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-4">
            <section className={card}>
              <h2 className="mb-3 font-semibold">{editing ? 'Edit transaction' : 'Add transaction'}</h2>
              <TransactionForm key={editing?.id ?? 'new-' + month} categories={data.categories} initial={editing ?? undefined} initialRepeat={editing ? isRepeating(data, editing) : false}
                defaultDate={defaultDate} onSubmit={editing ? saveEdit : addTx} onCancel={editing ? () => setEditing(null) : undefined} />
            </section>
            <section className={card}>
              <h2 className="mb-3 font-semibold">Expenses by category</h2>
              <Donut txs={monthTxs} categories={data.categories} />
            </section>
          </div>

          <div className="space-y-4">
            <section className={card}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Transactions</h2>
                <button onClick={exportCsv} disabled={monthTxs.length === 0} className={btnGhost + ' disabled:cursor-not-allowed disabled:opacity-50'}>Export CSV</button>
              </div>
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_2fr]">
                <select aria-label="Filter by category" value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })} className={inputCls}>
                  <option value="all">All categories</option>
                  {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select aria-label="Filter by type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value as Filters['type'] })} className={inputCls}>
                  <option value="all">All types</option>
                  <option value="income">Income</option>
                  <option value="expense">Expenses</option>
                </select>
                <div className="col-span-2 flex gap-2 sm:col-span-1">
                  <input type="search" aria-label="Search notes" placeholder="Search notes…" value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })} className={inputCls + ' min-w-0 flex-1'} />
                  <button type="button" onClick={() => setFilters({ categoryId: 'all', type: 'all', search: '' })} disabled={!filtering}
                    className={btnGhost + ' shrink-0 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50'}>Clear filters</button>
                </div>
              </div>
              {visible.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  {filtering ? 'No transactions match your filters.' : 'No transactions in ' + monthLabel(month) + ' yet.'}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {visible.map((x) => (
                    <TxRow key={x.id} t={x} cat={catOf(x.categoryId)}
                      onEdit={() => { setEditing(x); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                      onDelete={() => { setData((d) => ({ ...d, transactions: d.transactions.filter((y) => y.id !== x.id) })); if (editing?.id === x.id) setEditing(null) }} />
                  ))}
                </ul>
              )}
            </section>

            <section className={card}>
              <h2 className="font-semibold">Monthly budgets</h2>
              <p className="mb-3 text-xs text-slate-500">Set a limit per category; it applies to every month. Compared with {monthLabel(month)} spending.</p>
              <BudgetList categories={data.categories} txs={monthTxs} budgets={data.budgets}
                onChange={(id, c) => setData((d) => {
                  const budgets = { ...d.budgets }
                  if (c === null) delete budgets[id]; else budgets[id] = c
                  return { ...d, budgets }
                })} />
              <AddCategory categories={data.categories} onAdd={(c) => setData((d) => ({ ...d, categories: [...d.categories, c] }))} />
            </section>
          </div>
        </div>
      </main>
      )}
    </div>
  )
}

function Stat({ label, testid, tone, children }: { label: string; testid: string; tone: string; children: React.ReactNode }) {
  return (
    <div className={card + ' !p-3 sm:!p-5'}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">{label}</p>
      <p data-testid={testid} className={`mt-1 break-words text-base sm:text-2xl font-semibold tabular-nums ${tone}`}>{children}</p>
    </div>
  )
}
