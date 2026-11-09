import { useState } from 'react'
import { type AppData, type Category, type RecurringRule, monthLabel, shiftMonth } from '../lib/budget.ts'
import { formatCents } from '../lib/money.ts'
import { lastMonth, occurrencesFrom, stopRule } from '../lib/recurring.ts'
import { btnDanger, btnGhost, card, errInputCls, inputCls } from './ui.ts'

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`

export function RecurringScreen({
  data,
  catById,
  defaultStopMonth,
  onStop,
  onToast,
}: {
  data: AppData
  catById: Map<string, Category>
  defaultStopMonth: string
  onStop: (next: AppData, removedTxIds: string[]) => void
  onToast: (msg: string) => void
}) {
  const rules = [...data.recurring].sort(
    (a, b) => Number(a.endMonth !== null) - Number(b.endMonth !== null) || (a.note || '').localeCompare(b.note || ''),
  )

  return (
    <section className="space-y-4" aria-label="Recurring transactions">
      <div>
        <h2 className="text-lg font-semibold">Recurring transactions</h2>
        <p className="text-sm text-[var(--muted)]">
          These repeat every month on the same day. They’re added automatically to each later month you open.
        </p>
      </div>
      {rules.length === 0 ? (
        <div className={`${card} text-center text-sm text-[var(--muted)] py-10`}>
          No repeating transactions yet. Tick <strong className="text-[var(--text)]">Repeat monthly</strong> when adding a transaction.
        </div>
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => (
            <RuleCard key={r.id} rule={r} data={data} category={catById.get(r.categoryId)} defaultStopMonth={defaultStopMonth} onStop={onStop} onToast={onToast} />
          ))}
        </ul>
      )}
    </section>
  )
}

function RuleCard({
  rule,
  data,
  category,
  defaultStopMonth,
  onStop,
  onToast,
}: {
  rule: RecurringRule
  data: AppData
  category: Category | undefined
  defaultStopMonth: string
  onStop: (next: AppData, removedTxIds: string[]) => void
  onToast: (msg: string) => void
}) {
  const last = lastMonth(rule)
  const stopped = rule.endMonth !== null
  const title = rule.note || category?.name || 'Unknown'
  const count = occurrencesFrom(data, rule.id, rule.startMonth).length

  const initialStop = () => {
    let m = defaultStopMonth > rule.startMonth ? defaultStopMonth : shiftMonth(rule.startMonth, 1)
    if (rule.endMonth !== null && m >= rule.endMonth) m = last!
    return m
  }
  const [open, setOpen] = useState(false)
  const [stopMonth, setStopMonth] = useState(initialStop)
  const [error, setError] = useState<string | null>(null)

  const removing = stopMonth ? occurrencesFrom(data, rule.id, stopMonth) : []
  const removesAll = !!stopMonth && stopMonth <= rule.startMonth

  function confirm() {
    if (!/^\d{4}-\d{2}$/.test(stopMonth)) return setError('Choose the first month it should no longer appear in.')
    if (rule.endMonth !== null && stopMonth >= rule.endMonth)
      return setError(`It already stops from ${monthLabel(rule.endMonth)}. Choose an earlier month.`)
    const next = stopRule(data, rule.id, stopMonth)
    onStop(next, removing.map((t) => t.id))
    setOpen(false)
    onToast(removesAll ? `Removed “${title}”` : `“${title}” stops from ${monthLabel(stopMonth)}`)
  }

  return (
    <li className={card} data-testid="rule">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: category?.color ?? '#999' }} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-medium truncate max-w-full">{title}</h3>
            <span
              className={`rounded-full text-[11px] font-semibold px-2 py-px ${
                stopped ? 'bg-[var(--hover)] text-[var(--muted)]' : 'bg-[var(--accent-bg)] text-[var(--accent-strong)]'
              }`}
              data-testid="rule-status"
            >
              {stopped ? 'Stopped' : 'Active'}
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {category?.name ?? 'Unknown'} · every month on the {ordinal(rule.dayOfMonth)}
            {rule.dayOfMonth > 28 ? ' (last day in shorter months)' : ''}
          </p>
          <p className="text-xs text-[var(--muted)]" data-testid="rule-range">
            {monthLabel(rule.startMonth)} → {last ? monthLabel(last) : 'no end date'} · {count} so far
          </p>
        </div>
        <div className={`text-sm font-semibold tabular-nums whitespace-nowrap ${rule.type === 'income' ? 'text-[var(--pos)]' : ''}`}>
          {rule.type === 'income' ? '+' : '−'}
          {formatCents(rule.amountCents)}
        </div>
      </div>

      {!open ? (
        <div className="mt-3 flex justify-end">
          <button
            className={`${btnGhost} px-3 py-1.5`}
            onClick={() => {
              setStopMonth(initialStop())
              setError(null)
              setOpen(true)
            }}
          >
            {stopped ? 'Stop earlier…' : 'Stop…'}
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2">
          <label className="block text-xs font-medium text-[var(--muted)]" htmlFor={`stop-${rule.id}`}>
            Stop from (first month without it)
          </label>
          <input
            id={`stop-${rule.id}`}
            type="month"
            value={stopMonth}
            min={rule.startMonth}
            max={last ?? undefined}
            onChange={(e) => {
              setStopMonth(e.target.value)
              setError(null)
            }}
            className={`${inputCls} sm:max-w-56 ${error ? errInputCls : ''}`}
          />
          {error ? (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : (
            stopMonth && (
              <p className="text-xs text-[var(--text)]" data-testid="stop-summary">
                {removesAll
                  ? `This removes the repeating transaction and all ${removing.length} of its transactions.`
                  : `${monthLabel(shiftMonth(stopMonth, -1))} and earlier stay as they are.${
                      removing.length ? ` ${removing.length} transaction${removing.length > 1 ? 's' : ''} from ${monthLabel(stopMonth)} on will be removed.` : ''
                    }`}
              </p>
            )
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button className={`${btnDanger} px-3 py-1.5`} onClick={confirm} disabled={!stopMonth}>
              {stopMonth && /^\d{4}-\d{2}$/.test(stopMonth) ? `Stop from ${monthLabel(stopMonth)}` : 'Stop'}
            </button>
            <button className={`${btnGhost} px-3 py-1.5`} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
