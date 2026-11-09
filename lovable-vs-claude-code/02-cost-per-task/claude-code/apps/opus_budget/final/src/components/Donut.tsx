import { useState } from 'react'
import type { Category } from '../lib/budget.ts'
import { formatCents } from '../lib/money.ts'

interface Slice {
  category: Category
  cents: number
}

export function Donut({ data, total }: { data: Slice[]; total: number }) {
  const [hover, setHover] = useState<string | null>(null)
  const size = 200
  const r = 78
  const stroke = 30
  const c = 2 * Math.PI * r
  const gap = data.length > 1 ? 2 : 0

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="donut-empty">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-40 h-40" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        </svg>
        <p className="text-sm text-[var(--muted)]">No expenses this month.</p>
      </div>
    )
  }

  let offset = 0
  const active = data.find((d) => d.category.id === hover)
  const pct = (cents: number) => `${(Math.round((cents * 1000) / total) / 10).toFixed(1)}%`

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-48 h-48 -rotate-90"
          role="img"
          aria-label={`Expenses by category: ${data.map((d) => `${d.category.name} ${formatCents(d.cents)}`).join(', ')}`}
          data-testid="donut"
        >
          {data.map((d) => {
            const len = (d.cents / total) * c
            const seg = (
              <circle
                key={d.category.id}
                data-testid={`slice-${d.category.name}`}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.category.color}
                strokeWidth={hover === d.category.id ? stroke + 6 : stroke}
                strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`}
                strokeDashoffset={-offset}
                opacity={hover && hover !== d.category.id ? 0.45 : 1}
                className="cursor-pointer transition-[opacity,stroke-width]"
                onMouseEnter={() => setHover(d.category.id)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${d.category.name}: ${formatCents(d.cents)} (${pct(d.cents)})`}</title>
              </circle>
            )
            offset += len
            return seg
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-8">
          <span className="text-xs text-[var(--muted)] truncate max-w-full">{active ? active.category.name : 'Total spent'}</span>
          <span className="text-lg font-semibold tabular-nums">{formatCents(active ? active.cents : total)}</span>
          {active && <span className="text-xs text-[var(--muted)]">{pct(active.cents)}</span>}
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm" data-testid="donut-legend">
        {data.map((d) => (
          <li
            key={d.category.id}
            className={`flex items-center gap-2 rounded px-1.5 py-0.5 ${hover === d.category.id ? 'bg-[var(--hover)]' : ''}`}
            onMouseEnter={() => setHover(d.category.id)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: d.category.color }} />
            <span className="flex-1 truncate">{d.category.name}</span>
            <span className="tabular-nums">{formatCents(d.cents)}</span>
            <span className="tabular-nums text-[var(--muted)] w-12 text-right">{pct(d.cents)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
