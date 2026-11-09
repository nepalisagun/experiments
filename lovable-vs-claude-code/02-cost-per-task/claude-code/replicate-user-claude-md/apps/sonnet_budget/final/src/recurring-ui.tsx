import { useState } from 'react'
import { type Category, type Recurring, monthLabel, shiftMonth } from './lib/budget'
import { formatCents } from './lib/money'
import { ordinal } from './lib/recurring'
import { btnGhost, card, inputCls } from './components'

function RuleRow({ r, cat, suggested, lastMonth, onStop }: {
  r: Recurring; cat?: Category; suggested: string; lastMonth: string; onStop: (from: string) => void
}) {
  const first = shiftMonth(r.startMonth, 1)
  const options: string[] = []
  for (let m = first; m <= lastMonth; m = shiftMonth(m, 1)) options.push(m)
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(suggested > r.startMonth ? suggested : first)
  const stopped = !!r.stopFrom
  const sign = r.type === 'income' ? '+' : '−'

  return (
    <li className={`py-4 ${stopped ? 'opacity-70' : ''}`} data-testid="rule-row">
      <div className="flex items-center gap-3">
        <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: cat?.color ?? '#94a3b8' }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{cat?.name ?? 'Unknown'}{r.note && <span className="font-normal text-slate-500"> · {r.note}</span>}</p>
          <p className="text-xs text-slate-500">
            Monthly on the {ordinal(r.day)}{r.day > 28 && ' (last day in shorter months)'} · since {monthLabel(r.startMonth)}
          </p>
        </div>
        <p className={`shrink-0 text-sm font-semibold tabular-nums ${r.type === 'income' ? 'text-teal-600' : 'text-slate-900'}`}>{sign}${formatCents(r.amount)}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-4">
        {stopped ? (
          <span data-testid="rule-status" className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Stopped from {monthLabel(r.stopFrom!)}</span>
        ) : (
          <>
            <span data-testid="rule-status" className="rounded bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700">Active</span>
            {!open && <button onClick={() => setOpen(true)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50">Stop repeating…</button>}
          </>
        )}
      </div>
      {open && !stopped && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label htmlFor={'stop-' + r.id} className="mb-1 block text-xs font-medium text-slate-600">Stop from</label>
          <select id={'stop-' + r.id} value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls}>
            {options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <p className="mt-2 text-xs text-slate-600">
            Months before {monthLabel(from)} stay as they are. {monthLabel(from)} and later months will no longer include it.
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => { onStop(from); setOpen(false) }} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">Stop repeating</button>
            <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  )
}

export function RecurringScreen({ rules, categories, suggested, lastMonth, onStop }: {
  rules: Recurring[]; categories: Category[]; suggested: string; lastMonth: string; onStop: (id: string, from: string) => void
}) {
  const sorted = [...rules].sort((a, b) => Number(!!a.stopFrom) - Number(!!b.stopFrom) || a.day - b.day)
  return (
    <section className={card} aria-label="Recurring transactions">
      <h2 className="font-semibold">Recurring transactions</h2>
      <p className="mb-2 text-xs text-slate-500">Everything set to repeat monthly. Tick “Repeat monthly” when adding or editing a transaction to add one here.</p>
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Nothing repeats yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sorted.map((r) => (
            <RuleRow key={r.id} r={r} cat={categories.find((c) => c.id === r.categoryId)} suggested={suggested} lastMonth={lastMonth} onStop={(m) => onStop(r.id, m)} />
          ))}
        </ul>
      )}
    </section>
  )
}
