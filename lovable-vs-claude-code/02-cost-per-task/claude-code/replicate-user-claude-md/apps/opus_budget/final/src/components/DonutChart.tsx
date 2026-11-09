import { useState } from 'react'
import type { CategorySlice } from '../lib/budget.ts'
import { formatCents } from '../lib/money.ts'

const R = 80
const STROKE = 26
const C = 2 * Math.PI * R
const GAP = 2 // px of surface between segments

export function DonutChart({ slices }: { slices: CategorySlice[] }) {
  const [active, setActive] = useState<string | null>(null)
  const total = slices.reduce((s, x) => s + x.cents, 0)

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-stone-500" data-testid="donut-empty">
        <svg viewBox="0 0 200 200" className="h-32 w-32" aria-hidden="true">
          <circle cx="100" cy="100" r={R} fill="none" stroke="#e7e5e4" strokeWidth={STROKE} />
        </svg>
        No expenses this month yet.
      </div>
    )
  }

  let offset = 0
  const segs = slices.map((s) => {
    const len = (s.cents / total) * C
    const seg = { ...s, len, offset }
    offset += len
    return seg
  })
  const activeSlice = slices.find((s) => s.category.id === active)
  const pct = (cents: number) => {
    const p = (cents / total) * 100
    return cents === total ? '100%' : p < 0.1 ? '<0.1%' : p > 99.9 ? '>99.9%' : `${p.toFixed(1)}%`
  }

  return (
    <div className="@container">
    <div className="flex flex-col items-center gap-5 @md:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" role="img" aria-label={`Expenses by category, total ${formatCents(total)}`}>
          {segs.map((s) => {
            const visible = slices.length > 1 ? Math.max(s.len - GAP, 1.5) : C
            return (
              <circle
                key={s.category.id}
                data-testid={`donut-seg-${s.category.name}`}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={s.category.color}
                strokeWidth={active === s.category.id ? STROKE + 6 : STROKE}
                strokeDasharray={`${visible} ${C - visible}`}
                strokeDashoffset={-s.offset}
                className="cursor-pointer transition-[stroke-width] duration-150"
                opacity={active && active !== s.category.id ? 0.35 : 1}
                onMouseEnter={() => setActive(s.category.id)}
                onMouseLeave={() => setActive(null)}
              >
                <title>{`${s.category.name}: ${formatCents(s.cents)} (${pct(s.cents)})`}</title>
              </circle>
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-live="polite">
          <span className="text-xs text-stone-500">{activeSlice ? activeSlice.category.name : 'Total spent'}</span>
          <span className="text-lg font-semibold tabular-nums text-stone-900">{formatCents(activeSlice ? activeSlice.cents : total)}</span>
          {activeSlice && <span className="text-xs text-stone-500">{pct(activeSlice.cents)}</span>}
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1 text-sm" aria-label="Expenses by category">
        {slices.map((s) => (
          <li
            key={s.category.id}
            tabIndex={0}
            onMouseEnter={() => setActive(s.category.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(s.category.id)}
            onBlur={() => setActive(null)}
            className={`flex items-center gap-2 rounded px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-stone-400 ${active === s.category.id ? 'bg-stone-100' : ''}`}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.category.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-stone-700">{s.category.name}</span>
            <span className="tabular-nums text-stone-900">{formatCents(s.cents)}</span>
            <span className="w-14 shrink-0 text-right tabular-nums text-stone-500">{pct(s.cents)}</span>
          </li>
        ))}
      </ul>
    </div>
    </div>
  )
}
