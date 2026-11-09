import { useState } from 'react'
import { dayKey, type LogEntry } from './lib/log'
import { currentStreak, formatMinutes, lastNDays, niceScale, toCsv, weekMinutes, type DayStat } from './lib/stats'

export function Stats({ log }: { log: LogEntry[] }) {
  const now = Date.now()
  const days = lastNDays(log, now, 7)
  const week = weekMinutes(log, now)
  const weekSessions = days.reduce((s, d) => s + d.sessions, 0)
  const streak = currentStreak(log, now)
  const doneToday = days[days.length - 1].sessions > 0

  const exportCsv = () => {
    // BOM so spreadsheet apps read non-ASCII task labels as UTF-8.
    const blob = new Blob(['﻿' + toCsv(log)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pomodoro-sessions-${dayKey(now)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <Tile label="This week" testId="week-total" value={String(week)} unit="min"
          note={week >= 60 ? `${formatMinutes(week)} since Monday` : 'Since Monday'} />
        <Tile label="Current streak" testId="streak" value={String(streak)} unit={streak === 1 ? 'day' : 'days'}
          note={streak === 0 ? 'Finish a session to start one' : doneToday ? 'Including today' : 'Focus today to keep it'} />
      </div>

      <section aria-labelledby="chart-heading" className="rounded-2xl bg-card p-4 ring-1 ring-line sm:p-5">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 id="chart-heading" className="text-sm font-semibold text-ink">Focus minutes, last 7 days</h2>
          <span className="text-xs text-muted">{weekSessions} {weekSessions === 1 ? 'session' : 'sessions'}</span>
        </div>
        <BarChart days={days} />
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">View as table</summary>
          <table className="mt-2 w-full text-left tabular-nums" data-testid="chart-table">
            <thead className="text-xs text-muted">
              <tr><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">Sessions</th><th className="py-1 text-right font-medium">Minutes</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {days.map((d) => (
                <tr key={d.key}><td className="py-1.5">{longDay(d.date)}</td><td className="py-1.5 text-right">{d.sessions}</td><td className="py-1.5 text-right">{d.minutes}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-line sm:p-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Your history</h2>
          <p className="text-xs text-muted" data-testid="history-count">
            {log.length} completed {log.length === 1 ? 'session' : 'sessions'} in total
          </p>
        </div>
        <button
          type="button"
          data-testid="export-csv"
          onClick={exportCsv}
          disabled={log.length === 0}
          className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          Export CSV
        </button>
      </section>
    </div>
  )
}

function Tile({ label, value, unit, note, testId }: { label: string; value: string; unit: string; note: string; testId: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-line">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5" data-testid={testId}>
        <span className="text-3xl font-light tabular-nums text-ink">{value}</span>
        <span className="text-sm text-muted">{unit}</span>
      </div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </div>
  )
}

const shortDay = (d: Date, isToday: boolean) => (isToday ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }))
const longDay = (d: Date) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

function BarChart({ days }: { days: DayStat[] }) {
  const [active, setActive] = useState<number | null>(null)
  const { top, step } = niceScale(Math.max(...days.map((d) => d.minutes)))
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)

  return (
    // Hover uses pointer events filtered to a real mouse: a touch tap also emits a compatibility
    // mouseleave right after the click, which would immediately hide the tapped bar's tooltip.
    <div className="flex gap-2 pt-12" data-testid="chart" onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}>
      {/* Y axis */}
      <div className="relative h-44 w-8 shrink-0 text-right text-[11px] tabular-nums text-muted" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>{t}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-44">
          {/* Gridlines */}
          {ticks.map((t) => (
            <div key={t} aria-hidden="true" className={`absolute inset-x-0 border-t ${t === 0 ? 'border-muted/40' : 'border-line'}`}
              style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          {/* Bars */}
          <ul className="absolute inset-0 flex gap-0.5" role="list" aria-label="Focus minutes per day">
            {days.map((d, i) => {
              const isToday = i === days.length - 1
              const label = `${longDay(d.date)}: ${d.minutes} focus minutes, ${d.sessions} ${d.sessions === 1 ? 'session' : 'sessions'}`
              const align = i === 0 ? 'left-0' : i === days.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
              return (
                <li
                  key={d.key}
                  tabIndex={0}
                  aria-label={label}
                  data-testid="bar"
                  data-minutes={d.minutes}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  onClick={() => setActive(i)}
                  className="relative flex flex-1 cursor-default items-end justify-center outline-none"
                >
                  {d.minutes > 0 && (
                    <div
                      className={`w-full max-w-8 rounded-t-[4px] bg-[var(--focus)] transition-[height,opacity] duration-300 ${active !== null && active !== i ? 'opacity-60' : ''}`}
                      style={{ height: `${(d.minutes / top) * 100}%` }}
                    />
                  )}
                  {active === i && (
                    <div
                      role="tooltip"
                      data-testid="bar-tooltip"
                      className={`pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-md ${align}`}
                      style={{ bottom: `calc(${(d.minutes / top) * 100}% + 6px)` }}
                    >
                      <div className="font-medium">{longDay(d.date)}</div>
                      <div className="text-white/80">{d.minutes} min · {d.sessions} {d.sessions === 1 ? 'session' : 'sessions'}</div>
                    </div>
                  )}
                  {isToday && <span className="sr-only">(today)</span>}
                </li>
              )
            })}
          </ul>
        </div>
        {/* X axis labels */}
        <div className="mt-2 flex gap-0.5 text-center text-[11px] text-muted" aria-hidden="true">
          {days.map((d, i) => (
            <span key={d.key} className={`flex-1 truncate ${i === days.length - 1 ? 'font-semibold text-ink' : ''}`}>
              {shortDay(d.date, i === days.length - 1)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
