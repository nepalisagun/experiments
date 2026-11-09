import { useEffect, useMemo, useRef, useState } from 'react'
import { Donut } from './components/Donut.tsx'
import {
  type AppData,
  type Category,
  type Filters,
  type Transaction,
  type TxErrors,
  type TxInput,
  NOTE_MAX,
  PALETTE,
  applyFilters,
  budgetStatus,
  currentMonth,
  expensesByCategory,
  forMonth,
  loadData,
  monthLabel,
  monthOf,
  saveData,
  shiftMonth,
  toCSV,
  todayISO,
  totals,
  validateCategoryName,
  validateTransaction,
} from './lib/budget.ts'
import { centsToPlain, formatCents, parseAmount } from './lib/money.ts'
import { materialize, saveTransaction } from './lib/recurring.ts'
import { RecurringScreen } from './components/RecurringScreen.tsx'

type View = 'overview' | 'recurring'
const viewFromHash = (): View => (location.hash === '#recurring' ? 'recurring' : 'overview')
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`

import { btn, btnGhost, btnPrimary, card, errInputCls, inputCls } from './components/ui.ts'

const isValidDay = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)

function defaultDateFor(month: string) {
  const today = todayISO()
  return monthOf(today) === month ? today : `${month}-01`
}

function emptyForm(month: string): TxInput {
  return { type: 'expense', amount: '', categoryId: 'food', date: defaultDateFor(month), note: '' }
}

export default function App() {
  const [data, setData] = useState<AppData>(() => loadData())
  const [month, setMonth] = useState(currentMonth())
  const [saveFailed, setSaveFailed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    setSaveFailed(!saveData(data))
  }, [data])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // Repeating transactions: create any occurrences due up to the month being viewed.
  // materialize() is idempotent and returns the same object when nothing is due, so this can't loop.
  useEffect(() => {
    setData((d) => materialize(d, month))
  }, [month, data.recurring])

  const [view, setViewState] = useState<View>(viewFromHash)
  useEffect(() => {
    const onHash = () => setViewState(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  function setView(v: View) {
    setViewState(v)
    history.replaceState(null, '', v === 'recurring' ? '#recurring' : location.pathname + location.search)
    window.scrollTo(0, 0)
  }

  const { categories, transactions, recurring } = data
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const activeRuleCount = recurring.filter((r) => r.endMonth === null).length

  const monthTxs = useMemo(() => forMonth(transactions, month), [transactions, month])
  const monthTotals = useMemo(() => totals(monthTxs), [monthTxs])
  const spent = useMemo(() => expensesByCategory(monthTxs), [monthTxs])

  // ----- form -----
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TxInput>(() => emptyForm(currentMonth()))
  const [errors, setErrors] = useState<TxErrors>({})
  const [repeat, setRepeat] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const editingTx = editingId ? transactions.find((t) => t.id === editingId) : undefined
  const editingRecurring = !!editingTx?.recurringId && recurring.some((r) => r.id === editingTx.recurringId)

  function changeMonth(m: string) {
    setMonth(m)
    if (!editingId) setForm((f) => ({ ...f, date: defaultDateFor(m) }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const res = validateTransaction(form, categories)
    if (!res.ok) {
      setErrors(res.errors)
      return
    }
    const saved = saveTransaction(data, res.value, { editingId, repeat })
    if (!saved.ok) {
      setErrors({ [saved.field]: saved.error })
      return
    }
    setData(saved.data)
    const txMonth = monthOf(res.value.date)
    const what = editingId ? (editingRecurring && repeat ? 'Updated this and later months' : 'Transaction updated') : repeat ? 'Repeating transaction added' : 'Transaction added'
    if (txMonth !== month) {
      setMonth(txMonth)
      setToast(`${what} — switched to ${monthLabel(txMonth)}`)
    } else setToast(what)
    setEditingId(null)
    setErrors({})
    setRepeat(false)
    setForm({ ...emptyForm(txMonth), type: form.type, categoryId: form.categoryId, date: res.value.date })
  }

  function startEdit(t: Transaction) {
    setView('overview')
    setEditingId(t.id)
    setErrors({})
    setRepeat(!!t.recurringId && recurring.some((r) => r.id === t.recurringId))
    setForm({ type: t.type, amount: centsToPlain(t.amountCents), categoryId: t.categoryId, date: t.date, note: t.note })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function cancelEdit() {
    setEditingId(null)
    setErrors({})
    setRepeat(false)
    setForm(emptyForm(month))
  }

  function deleteTx(id: string) {
    setData((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== id) }))
    if (editingId === id) cancelEdit()
    setToast('Transaction deleted')
  }

  // ----- filters -----
  const [filters, setFilters] = useState<Filters>({ categoryId: '', type: '', search: '' })
  const visible = useMemo(() => applyFilters(monthTxs, filters), [monthTxs, filters])
  const filtersActive = !!(filters.categoryId || filters.type || filters.search)

  // ----- export -----
  function exportCSV() {
    const blob = new Blob([toCSV(monthTxs, categories)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `budget-${month}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const donutData = categories
    .filter((c) => (spent.get(c.id) ?? 0) > 0)
    .map((c) => ({ category: c, cents: spent.get(c.id)! }))
    .sort((a, b) => b.cents - a.cents)

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="sm:sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
          <div className="flex items-center gap-3 sm:gap-5">
            <h1 className="text-lg font-semibold tracking-tight">Budget</h1>
            <nav className="flex rounded-md border border-[var(--border)] p-0.5 bg-[var(--bg)]" aria-label="Screens">
              {(['overview', 'recurring'] as const).map((v) => (
                <button
                  key={v}
                  aria-current={view === v ? 'page' : undefined}
                  onClick={() => setView(v)}
                  className={`rounded px-3 py-1.5 text-sm font-medium cursor-pointer ${view === v ? 'bg-[var(--surface)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
                >
                  {v === 'overview' ? 'Overview' : 'Recurring'}
                  {v === 'recurring' && activeRuleCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-[var(--accent)] text-white text-[11px] px-1.5 py-px tabular-nums">{activeRuleCount}</span>
                  )}
                </button>
              ))}
            </nav>
          </div>
          {view === 'overview' && (
          <div className="flex items-center justify-center gap-1 order-last w-full sm:order-none sm:w-auto" aria-label="Month switcher">
            <button className={btnGhost} onClick={() => changeMonth(shiftMonth(month, -1))} aria-label="Previous month">
              ‹
            </button>
            <label className="relative">
              <span className="sr-only">Selected month</span>
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && changeMonth(e.target.value)}
                onClick={(e) => {
                  try {
                    e.currentTarget.showPicker()
                  } catch {
                    /* not supported */
                  }
                }}
                className="absolute inset-0 opacity-0 cursor-pointer"
                data-testid="month-input"
              />
              <span className="inline-block min-w-36 text-center font-medium px-2" data-testid="month-label">
                {monthLabel(month)}
              </span>
            </label>
            <button className={btnGhost} onClick={() => changeMonth(shiftMonth(month, 1))} aria-label="Next month">
              ›
            </button>
            {month !== currentMonth() && (
              <button className={`${btn} text-[var(--accent)] hover:underline`} onClick={() => changeMonth(currentMonth())}>
                Today
              </button>
            )}
          </div>
          )}
          {view === 'overview' && (
            <button className={`${btnGhost} hidden sm:block`} onClick={exportCSV} disabled={monthTxs.length === 0} title="Download this month's transactions">
              Export CSV
            </button>
          )}
        </div>
      </header>

      {saveFailed && (
        <div role="alert" className="bg-[var(--danger-bg)] text-[var(--danger)] text-sm text-center py-2 px-4">
          Couldn't save to this browser's storage. Your latest changes may be lost on reload.
        </div>
      )}

      {view === 'recurring' ? (
        <main className="mx-auto max-w-3xl px-4 py-5">
          <RecurringScreen
            data={data}
            catById={catById}
            defaultStopMonth={month}
            onStop={(next, removedIds) => {
              setData(next)
              if (editingId && removedIds.includes(editingId)) cancelEdit()
            }}
            onToast={setToast}
          />
        </main>
      ) : (
      <main className="mx-auto max-w-6xl px-4 py-5 space-y-5">
        <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Monthly totals">
          <Stat label="Income" value={monthTotals.income} tone="pos" testId="total-income" />
          <Stat label="Expenses" value={monthTotals.expenses} tone="neg" testId="total-expenses" />
          <Stat label="Balance" value={monthTotals.balance} tone={monthTotals.balance < 0 ? 'neg' : 'neutral'} testId="total-balance" />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            <form ref={formRef} onSubmit={submit} noValidate className={`${card} space-y-3 scroll-mt-20`} aria-label="Transaction form">
              <h2 className="font-semibold">{editingId ? 'Edit transaction' : 'Add transaction'}</h2>
              <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 rounded-md border border-[var(--border)] p-0.5 bg-[var(--bg)]">
                {(['expense', 'income'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={form.type === t}
                    onClick={() => setForm({ ...form, type: t })}
                    className={`rounded px-3 py-1.5 text-sm font-medium capitalize cursor-pointer ${
                      form.type === t ? 'bg-[var(--surface)] shadow-sm' : 'text-[var(--muted)]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <Field label="Amount" error={errors.amount} id="f-amount">
                <input
                  id="f-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className={`${inputCls} ${errors.amount ? errInputCls : ''} tabular-nums`}
                  aria-invalid={!!errors.amount}
                  aria-describedby={errors.amount ? 'f-amount-err' : undefined}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category" error={errors.categoryId} id="f-cat">
                  <select
                    id="f-cat"
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                    className={`${inputCls} ${errors.categoryId ? errInputCls : ''}`}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date" error={errors.date} id="f-date">
                  <input
                    id="f-date"
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className={`${inputCls} ${errors.date ? errInputCls : ''}`}
                    aria-invalid={!!errors.date}
                    aria-describedby={errors.date ? 'f-date-err' : undefined}
                  />
                </Field>
              </div>
              <Field label="Note (optional)" error={errors.note} id="f-note">
                <input
                  id="f-note"
                  value={form.note}
                  maxLength={NOTE_MAX}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. Groceries at the market"
                />
              </Field>
              <div>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={repeat}
                    onChange={(e) => setRepeat(e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
                  />
                  Repeat monthly
                </label>
                {repeat && isValidDay(form.date) && (
                  <p className="text-xs text-[var(--muted)] mt-1 ml-6" data-testid="repeat-hint">
                    {editingRecurring
                      ? 'Changes apply to this month and all later months. Earlier months stay as they are.'
                      : `Adds it to every later month on the ${ordinal(Number(form.date.slice(8, 10)))}${
                          Number(form.date.slice(8, 10)) > 28 ? ' (or the last day in shorter months)' : ''
                        }.`}
                  </p>
                )}
                {!repeat && editingRecurring && (
                  <p className="text-xs text-[var(--muted)] mt-1 ml-6" data-testid="repeat-hint">
                    Keeps this one and stops repeating from {monthLabel(monthOf(editingTx!.date))} on.
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" className={`${btnPrimary} flex-1`}>
                  {editingId ? 'Save changes' : 'Add transaction'}
                </button>
                {editingId && (
                  <button type="button" className={btnGhost} onClick={cancelEdit}>
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <Budgets
              categories={categories}
              spent={spent}
              onSetBudget={(id, cents) =>
                setData((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, budgetCents: cents } : c)) }))
              }
              onAddCategory={(c) => setData((d) => ({ ...d, categories: [...d.categories, c] }))}
            />
          </div>

          <div className="space-y-5 min-w-0">
            <section className={card} aria-label="Expenses by category">
              <h2 className="font-semibold mb-3">Expenses by category</h2>
              <Donut data={donutData} total={monthTotals.expenses} />
            </section>

            <section className={card} aria-label="Transactions">
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <h2 className="font-semibold">Transactions</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--muted)]" data-testid="tx-count">
                    {filtersActive ? `${visible.length} of ${monthTxs.length}` : `${monthTxs.length}`} shown
                  </span>
                  <button className={`${btnGhost} px-2.5 py-1 text-xs sm:hidden`} onClick={exportCSV} disabled={monthTxs.length === 0}>
                    Export CSV
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_2fr] gap-2 mb-3">
                <select
                  aria-label="Filter by category"
                  value={filters.categoryId}
                  onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
                  className={inputCls}
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by type"
                  value={filters.type}
                  onChange={(e) => setFilters({ ...filters, type: e.target.value as Filters['type'] })}
                  className={inputCls}
                >
                  <option value="">All types</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
                <div className="col-span-2 sm:col-span-1 flex gap-2 min-w-0">
                  <input
                    type="search"
                    aria-label="Search notes"
                    placeholder="Search notes…"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className={`${inputCls} min-w-0`}
                  />
                  <button
                    type="button"
                    className={`${btnGhost} whitespace-nowrap shrink-0 disabled:cursor-not-allowed`}
                    disabled={!filtersActive}
                    onClick={() => setFilters({ categoryId: '', type: '', search: '' })}
                  >
                    Clear filters
                  </button>
                </div>
              </div>
              <TxList
                txs={visible}
                catById={catById}
                editingId={editingId}
                onEdit={startEdit}
                onDelete={deleteTx}
                emptyText={monthTxs.length === 0 ? `No transactions in ${monthLabel(month)} yet.` : 'No transactions match these filters.'}
              />
            </section>
          </div>
        </div>
      </main>
      )}

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-[var(--text)] text-[var(--bg)] text-sm px-4 py-2 shadow-lg max-w-[90vw]">
          {toast}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone, testId }: { label: string; value: number; tone: 'pos' | 'neg' | 'neutral'; testId: string }) {
  const color = tone === 'pos' ? 'text-[var(--pos)]' : tone === 'neg' ? 'text-[var(--danger)]' : ''
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 sm:p-5 shadow-sm min-w-0">
      <div className="text-[11px] sm:text-xs uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`text-sm min-[380px]:text-base sm:text-2xl font-semibold tabular-nums mt-0.5 sm:mt-1 break-all ${color}`} data-testid={testId}>
        {formatCents(value)}
      </div>
    </div>
  )
}

function Field({ label, error, id, children }: { label: string; error?: string; id: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-[var(--muted)] mb-1">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-err`} className="text-xs text-[var(--danger)] mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function TxList({
  txs,
  catById,
  editingId,
  onEdit,
  onDelete,
  emptyText,
}: {
  txs: Transaction[]
  catById: Map<string, Category>
  editingId: string | null
  onEdit: (t: Transaction) => void
  onDelete: (id: string) => void
  emptyText: string
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  if (txs.length === 0) return <p className="text-sm text-[var(--muted)] py-6 text-center">{emptyText}</p>
  return (
    <ul className="divide-y divide-[var(--border)]" data-testid="tx-list">
      {txs.map((t) => {
        const cat = catById.get(t.categoryId)
        return (
          <li key={t.id} className={`py-2.5 flex items-center gap-3 ${editingId === t.id ? 'bg-[var(--hover)] -mx-2 px-2 rounded' : ''}`} data-testid="tx-row">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cat?.color ?? '#999' }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {t.recurringId && (
                  <span
                    className="mr-1.5 inline-block rounded bg-[var(--accent-bg)] text-[var(--accent-strong)] text-[10px] font-semibold uppercase tracking-wide px-1.5 py-px align-[1px]"
                    title="Repeats monthly"
                    data-testid="monthly-badge"
                  >
                    ↻ Monthly
                  </span>
                )}
                {t.note || cat?.name || 'Unknown'}
              </div>
              <div className="text-xs text-[var(--muted)] truncate">
                {cat?.name ?? 'Unknown'} · {t.date}
              </div>
            </div>
            <div className="flex flex-col items-end sm:flex-row sm:items-center sm:gap-3 shrink-0">
            <div className={`text-sm font-semibold tabular-nums whitespace-nowrap ${t.type === 'income' ? 'text-[var(--pos)]' : ''}`}>
              {t.type === 'income' ? '+' : '−'}
              {formatCents(t.amountCents)}
            </div>
            {confirmId === t.id ? (
              <div className="flex gap-1">
                <button className={`${btn} px-2 py-1 bg-[var(--danger)] text-white`} onClick={() => onDelete(t.id)}>
                  Delete
                </button>
                <button className={`${btn} px-2 py-1 border border-[var(--border)]`} onClick={() => setConfirmId(null)}>
                  Keep
                </button>
              </div>
            ) : (
              <div className="flex gap-1">
                <button className={`${btn} px-2 py-1 text-[var(--accent)] hover:bg-[var(--hover)]`} onClick={() => onEdit(t)} aria-label={`Edit ${t.note || cat?.name}`}>
                  Edit
                </button>
                <button className={`${btn} px-2 py-1 text-[var(--danger)] hover:bg-[var(--hover)]`} onClick={() => setConfirmId(t.id)} aria-label={`Delete ${t.note || cat?.name}`}>
                  Delete
                </button>
              </div>
            )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Budgets({
  categories,
  spent,
  onSetBudget,
  onAddCategory,
}: {
  categories: Category[]
  spent: Map<string, number>
  onSetBudget: (id: string, cents: number | null) => void
  onAddCategory: (c: Category) => void
}) {
  const [name, setName] = useState('')
  const nextColor = (cats: Category[]) =>
    PALETTE.find((p) => !cats.some((c) => c.color.toLowerCase() === p)) ?? PALETTE[cats.length % PALETTE.length]
  const [color, setColor] = useState(() => nextColor(categories))
  const [error, setError] = useState<string | null>(null)

  function add(e: React.FormEvent) {
    e.preventDefault()
    const err = validateCategoryName(name, categories)
    if (err) return setError(err)
    const cat: Category = { id: `c-${Date.now().toString(36)}`, name: name.trim(), color, budgetCents: null }
    onAddCategory(cat)
    setName('')
    setError(null)
    setColor(nextColor([...categories, cat]))
  }

  return (
    <section className={card} aria-label="Categories and budgets">
      <h2 className="font-semibold">Monthly budgets</h2>
      <p className="text-xs text-[var(--muted)] mb-3">Set a monthly spending limit per category. Leave blank for none.</p>
      <ul className="space-y-3">
        {categories.map((c) => (
          <BudgetRow key={c.id} category={c} spent={spent.get(c.id) ?? 0} onSet={(v) => onSetBudget(c.id, v)} />
        ))}
      </ul>
      <form onSubmit={add} noValidate className="mt-4 pt-4 border-t border-[var(--border)]" aria-label="Add category">
        <label htmlFor="new-cat" className="block text-xs font-medium text-[var(--muted)] mb-1">
          New category
        </label>
        <div className="flex gap-2">
          <input
            type="color"
            aria-label="Category colour"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-10 shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--surface)] p-0.5"
          />
          <input
            id="new-cat"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder="e.g. Education"
            className={`${inputCls} ${error ? errInputCls : ''}`}
            maxLength={30}
          />
          <button type="submit" className={btnGhost}>
            Add
          </button>
        </div>
        {error && (
          <p className="text-xs text-[var(--danger)] mt-1" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}

function BudgetRow({ category, spent, onSet }: { category: Category; spent: number; onSet: (cents: number | null) => void }) {
  const [draft, setDraft] = useState(category.budgetCents ? centsToPlain(category.budgetCents) : '')
  const [error, setError] = useState<string | null>(null)

  function commit() {
    if (draft.trim() === '') {
      setError(null)
      if (category.budgetCents !== null) onSet(null)
      return
    }
    const r = parseAmount(draft)
    if (!r.ok) return setError(r.error.replace('Amount', 'Budget'))
    setError(null)
    setDraft(centsToPlain(r.cents))
    if (r.cents !== category.budgetCents) onSet(r.cents)
  }

  const b = category.budgetCents
  const st = b ? budgetStatus(spent, b) : null
  return (
    <li data-testid={`budget-${category.name}`}>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: category.color }} />
        <span className="text-sm flex-1 truncate">{category.name}</span>
        <span className="text-xs tabular-nums text-[var(--muted)] whitespace-nowrap">{formatCents(spent)} /</span>
        <input
          aria-label={`${category.name} monthly budget`}
          inputMode="decimal"
          placeholder="—"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className={`w-24 rounded border px-2 py-1 text-xs text-right tabular-nums bg-[var(--surface)] outline-none focus:border-[var(--accent)] ${
            error ? 'border-[var(--danger)]' : 'border-[var(--border)]'
          }`}
        />
      </div>
      {error && <p className="text-xs text-[var(--danger)] mt-1" role="alert">{error}</p>}
      {st && b && (
        <>
          <div
            className="mt-1.5 h-2 rounded-full bg-[var(--track)] overflow-hidden"
            role="progressbar"
            aria-label={`${category.name} budget used`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(st.pct, 100)}
            data-over={st.over}
          >
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${Math.min(st.pct, 100)}%`, background: st.over ? 'var(--danger)' : category.color }}
            />
          </div>
          <div className={`text-xs mt-0.5 tabular-nums ${st.over ? 'text-[var(--danger)] font-medium' : 'text-[var(--muted)]'}`}>
            {st.over ? `Over budget by ${formatCents(-st.remainingCents)} (${st.pct}%)` : `${formatCents(st.remainingCents)} left (${st.pct}%)`}
          </div>
        </>
      )}
    </li>
  )
}
