import { useState, type FormEvent } from 'react'
import { CUSTOM_COLORS, validateCategoryName, type BudgetStatus, type Category } from '../lib/budget.ts'
import { centsToPlain, formatCents, parseAmount } from '../lib/money.ts'

function BudgetInput({ category, onChange }: { category: Category; onChange: (cents: number | null) => void }) {
  const initial = category.budgetCents ? centsToPlain(category.budgetCents) : ''
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [prev, setPrev] = useState(initial)
  if (prev !== initial) {
    setPrev(initial)
    setValue(initial)
  }

  const commit = () => {
    if (value.trim() === '') {
      setError(null)
      if (category.budgetCents !== null) onChange(null)
      return
    }
    const r = parseAmount(value)
    if (!r.ok) return setError(r.error)
    setError(null)
    setValue(centsToPlain(r.cents))
    if (r.cents !== category.budgetCents) onChange(r.cents)
  }

  const id = `budget-${category.id}`
  return (
    <div className="w-28 shrink-0">
      <label htmlFor={id} className="sr-only">Monthly budget for {category.name}</label>
      <input
        id={id}
        inputMode="decimal"
        placeholder="No budget"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full rounded-md border px-2 py-1 text-right text-sm tabular-nums outline-none focus:ring-2 ${
          error ? 'border-red-600 focus:ring-red-200' : 'border-stone-300 focus:ring-stone-200'
        }`}
      />
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-right text-xs text-red-700">{error}</p>}
    </div>
  )
}

interface Props {
  categories: Category[]
  usage: Map<string, number>
  onAdd: (name: string, color: string) => void
  onBudget: (id: string, cents: number | null) => void
  onDelete: (id: string) => void
}

export function CategoriesPanel({ categories, usage, onAdd, onBudget, onDelete }: Props) {
  const nextColor = CUSTOM_COLORS[categories.filter((c) => !c.builtIn).length % CUSTOM_COLORS.length]
  const [name, setName] = useState('')
  const [color, setColor] = useState(nextColor)
  const [error, setError] = useState<string | null>(null)

  const add = (e: FormEvent) => {
    e.preventDefault()
    const msg = validateCategoryName(name, categories)
    if (msg) return setError(msg)
    onAdd(name.trim(), color)
    setName('')
    setError(null)
    setColor(CUSTOM_COLORS[(categories.filter((c) => !c.builtIn).length + 1) % CUSTOM_COLORS.length])
  }

  return (
    <section className="space-y-3" aria-labelledby="cats-h">
      <div>
        <h2 id="cats-h" className="text-base font-semibold text-stone-900">Categories &amp; budgets</h2>
        <p className="text-xs text-stone-500">Set a monthly budget per category. Leave empty for none.</p>
      </div>
      <ul className="divide-y divide-stone-100">
        {categories.map((c) => (
          <li key={c.id} className="flex items-start gap-2 py-1.5" data-testid={`cat-row-${c.name}`}>
            <span className="mt-2 h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden="true" />
            <span className="mt-1 min-w-0 flex-1 truncate text-sm text-stone-800">{c.name}</span>
            <BudgetInput category={c} onChange={(cents) => onBudget(c.id, cents)} />
            {!c.builtIn ? (
              <button
                type="button"
                onClick={() => {
                  const n = usage.get(c.id) ?? 0
                  if (window.confirm(n ? `Delete "${c.name}"? Its ${n} transaction(s) will move to Other.` : `Delete "${c.name}"?`)) onDelete(c.id)
                }}
                className="mt-0.5 rounded px-1.5 py-1 text-xs text-stone-500 hover:bg-red-50 hover:text-red-700"
                aria-label={`Delete category ${c.name}`}
              >
                ✕
              </button>
            ) : (
              <span className="w-[26px] shrink-0" aria-hidden="true" />
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate className="space-y-1" aria-label="Add category">
        <div className="flex gap-2">
          <label htmlFor="new-cat-color" className="sr-only">Colour</label>
          <input id="new-cat-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-stone-300 bg-white p-1" />
          <label htmlFor="new-cat-name" className="sr-only">New category name</label>
          <input
            id="new-cat-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            placeholder="New category"
            aria-invalid={!!error}
            aria-describedby={error ? 'new-cat-error' : undefined}
            className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${error ? 'border-red-600 focus:ring-red-200' : 'border-stone-300 focus:ring-stone-200'}`}
          />
          <button type="submit" className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">Add</button>
        </div>
        {error && <p id="new-cat-error" role="alert" className="text-xs font-medium text-red-700">{error}</p>}
      </form>
    </section>
  )
}

export function BudgetBars({ statuses }: { statuses: BudgetStatus[] }) {
  if (statuses.length === 0) {
    return <p className="text-sm text-stone-500">No budgets set. Add one under “Categories &amp; budgets”.</p>
  }
  return (
    <ul className="space-y-3">
      {statuses.map((s) => (
        <li key={s.category.id} data-testid={`budget-${s.category.name}`} data-over={s.over}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
            <span className="flex items-center gap-2 font-medium text-stone-800">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.category.color }} aria-hidden="true" />
              {s.category.name}
            </span>
            <span className={`tabular-nums ${s.over ? 'font-semibold text-red-700' : 'text-stone-600'}`}>
              {formatCents(s.spentCents)} / {formatCents(s.budgetCents)}
              {s.over && <> · over by {formatCents(s.spentCents - s.budgetCents)}</>}
            </span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-stone-200"
            role="progressbar"
            aria-label={`${s.category.name} budget used`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(s.ratio * 100)}
          >
            <div
              data-testid="bar-fill"
              className={`h-full rounded-full transition-[width] ${s.over ? 'bg-red-600' : 'bg-stone-700'}`}
              style={{ width: `${s.ratio * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
