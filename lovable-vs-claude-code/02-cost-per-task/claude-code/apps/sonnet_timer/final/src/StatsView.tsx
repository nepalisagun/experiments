import { useMemo } from 'react'
import * as S from './stats'
import type { LogEntry } from './timer'

function downloadCsv(log: LogEntry[]) {
  // BOM so Excel reads non-ASCII task labels as UTF-8
  const blob = new Blob(['﻿', S.toCsv(log)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pomodoro-sessions-${S.isoDate(Date.now())}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function StatsView({ log }: { log: LogEntry[] }) {
  const { days, total, streak } = useMemo(() => {
    const now = Date.now()
    const days = S.lastSevenDays(log, now)
    return { days, total: S.weekTotal(days), streak: S.currentStreak(log, now) }
  }, [log])

  const max = Math.max(60, ...days.map((d) => d.minutes))
  const W = 336, H = 200, top = 22, bottom = 28, barW = 32
  const slot = W / 7
  const plotH = H - top - bottom
  const weekday = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' })
  const fullDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <>
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">This week</p>
          <p data-testid="week-total" data-minutes={total} className="mt-1 whitespace-nowrap text-2xl font-light tabular-nums sm:text-3xl">{S.formatMinutes(total)}</p>
          <p className="mt-1 text-xs text-slate-400">focus, last 7 days</p>
        </div>
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Streak</p>
          <p data-testid="streak" data-days={streak} className="mt-1 whitespace-nowrap text-2xl font-light tabular-nums sm:text-3xl">
            {streak} <span className="text-base">{streak === 1 ? 'day' : 'days'}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">{streak > 0 ? 'in a row' : 'finish a session to start'}</p>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-500">Focus minutes per day</h2>
        <svg
          data-testid="chart"
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Focus minutes per day, last 7 days: ${days.map((d) => `${weekday(d.date)} ${d.minutes}`).join(', ')}`}
        >
          <line x1="0" x2={W} y1={top + plotH} y2={top + plotH} stroke="#e2e8f0" />
          {days.map((d, i) => {
            const h = d.minutes === 0 ? 0 : Math.max(3, (d.minutes / max) * plotH)
            const x = i * slot + (slot - barW) / 2
            const cx = i * slot + slot / 2
            return (
              <g key={d.key} data-testid="bar" data-minutes={d.minutes} data-day={S.isoDate(d.date.getTime())}>
                <title>{`${fullDate(d.date)}: ${d.minutes} min`}</title>
                <rect x={x} y={top + plotH - h} width={barW} height={h} rx="5" fill={d.isToday ? '#f43f5e' : '#fda4af'} />
                <text x={cx} y={top + plotH - h - 6} textAnchor="middle" fontSize="12" fill="#475569" className="tabular-nums">
                  {d.minutes}
                </text>
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="12" fill={d.isToday ? '#be123c' : '#64748b'} fontWeight={d.isToday ? 600 : 400}>
                  {weekday(d.date)}
                </text>
              </g>
            )
          })}
        </svg>
      </section>

      <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">History</h2>
            <p data-testid="history-count" className="mt-1 text-sm text-slate-500">
              {log.length} completed session{log.length === 1 ? '' : 's'} saved
            </p>
          </div>
          <button
            type="button"
            disabled={log.length === 0}
            onClick={() => downloadCsv(log)}
            className="shrink-0 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </section>
    </>
  )
}
