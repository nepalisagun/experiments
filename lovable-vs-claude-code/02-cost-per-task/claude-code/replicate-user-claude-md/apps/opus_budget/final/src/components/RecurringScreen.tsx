import { useState, type FormEvent } from 'react'
import { monthLabel, shiftMonth, type Category, type RecurringRule } from '../lib/budget.ts'
import { describeDay } from '../lib/recurring.ts'
import { formatCents } from '../lib/money.ts'

interface Props {
  rules: RecurringRule[]
  categories: Category[]
  /** First month a stop would normally apply to (next month). */
  suggestedStop: string
  onStop: (ruleId: string, month: string) => string | null
}

const btn = 'rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50'

function defaultStopFor(rule: RecurringRule, suggested: string): string {
  let m = suggested < rule.startMonth ? rule.startMonth : suggested
  if (rule.endMonth !== null && m >= rule.endMonth) m = shiftMonth(rule.endMonth, -1)
  return m
}

function StopForm({ rule, suggested, onStop, onDone }: { rule: RecurringRule; suggested: string; onStop: Props['onStop']; onDone: () => void }) {
  const [month, setMonth] = useState(() => defaultStopFor(rule, suggested))
  const [error, setError] = useState<string | null>(null)
  const id = `stop-${rule.id}`
  const valid = /^\d{4}-\d{2}$/.test(month)
  const removesAll = valid && month === rule.startMonth

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (removesAll && !window.confirm(`It starts in ${monthLabel(month)}, so this deletes it from every month. Continue?`)) return
    const err = onStop(rule.id, month)
    if (err) setError(err)
    else onDone()
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 rounded-xl bg-stone-50 p-3" aria-label={`Stop ${rule.note || 'repeating transaction'}`}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-40 sm:max-w-56">
          <label htmlFor={id} className="mb-1 block text-xs font-medium text-stone-600">Stop from</label>
          <input
            id={id}
            type="month"
            value={month}
            min={rule.startMonth}
            max={rule.endMonth ? shiftMonth(rule.endMonth, -1) : undefined}
            onChange={(e) => { setMonth(e.target.value); setError(null) }}
            aria-invalid={!!error}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
            className={`w-full rounded-lg border bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 ${error ? 'border-red-600 focus:ring-red-200' : 'border-stone-300 focus:ring-stone-200'}`}
          />
        </div>
        <button type="submit" className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700">Stop repeating</button>
        <button type="button" onClick={onDone} className={btn}>Cancel</button>
      </div>
      <p id={`${id}-help`} className="mt-2 text-xs text-stone-500">
        {!valid
          ? 'Choose the first month it should no longer appear in.'
          : removesAll
            ? 'It starts this month, so it will be removed from every month.'
            : `Removed from ${monthLabel(month)} onward. ${monthLabel(rule.startMonth)} to ${monthLabel(shiftMonth(month, -1))} stay unchanged.`}
      </p>
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-red-700">{error}</p>}
    </form>
  )
}

export function RecurringScreen({ rules, categories, suggestedStop, onStop }: Props) {
  const [stopping, setStopping] = useState<string | null>(null)
  const catById = new Map(categories.map((c) => [c.id, c]))
  const sorted = [...rules].sort(
    (a, b) => Number(a.endMonth !== null) - Number(b.endMonth !== null) || (a.note || '').localeCompare(b.note || '') || a.startMonth.localeCompare(b.startMonth),
  )

  return (
    <section aria-labelledby="rec-h" className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 id="rec-h" className="text-base font-semibold">Repeating transactions</h2>
      <p className="mt-1 text-sm text-stone-500">
        These are added to every month you open, on the same day. Stop one from any month; earlier months stay as they are.
      </p>
      {sorted.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500" data-testid="rec-empty">
          Nothing repeats yet. Tick “Repeat monthly” when adding or editing a transaction.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100" aria-label="Repeating transactions">
          {sorted.map((r) => {
            const c = catById.get(r.categoryId)
            const title = r.note || c?.name || 'Unknown'
            const ended = r.endMonth !== null
            return (
              <li key={r.id} className="py-3" data-testid="rec-row">
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c?.color ?? '#999' }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-stone-900">{title}</div>
                    <div className="text-xs text-stone-500">{c?.name ?? 'Unknown'} · {describeDay(r.day)}</div>
                    <div className="mt-0.5 text-xs" data-testid="rec-status">
                      {ended ? (
                        <span className="text-stone-500">
                          <span className="font-medium text-stone-700">Stopped</span> · {monthLabel(r.startMonth)}
                          {shiftMonth(r.endMonth!, -1) !== r.startMonth && <> – {monthLabel(shiftMonth(r.endMonth!, -1))}</>}
                        </span>
                      ) : (
                        <span className="text-stone-500"><span className="font-medium text-teal-700">Repeating</span> · since {monthLabel(r.startMonth)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                    <span className={`text-sm font-semibold tabular-nums ${r.type === 'income' ? 'text-teal-700' : 'text-stone-900'}`}>
                      {r.type === 'income' ? '+' : '−'}{formatCents(r.amountCents)}
                    </span>
                    {stopping !== r.id && (
                      <button type="button" className={`${btn} py-1 text-xs`} onClick={() => setStopping(r.id)} aria-label={`${ended ? 'Stop earlier' : 'Stop'}: ${title}`}>
                        {ended ? 'Stop earlier…' : 'Stop…'}
                      </button>
                    )}
                  </div>
                </div>
                {stopping === r.id && <StopForm rule={r} suggested={suggestedStop} onStop={onStop} onDone={() => setStopping(null)} />}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
