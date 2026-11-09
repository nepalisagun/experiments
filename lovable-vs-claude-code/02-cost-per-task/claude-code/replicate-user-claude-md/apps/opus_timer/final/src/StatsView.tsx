import { useState } from 'react'
import { csvFilename, lastDays, streak, toCsv, weekMinutes } from './stats'
import type { LogEntry } from './timer'

const BAR = '#b5654a' // the Focus accent; validated with the dataviz palette checks (contrast ≥ 3:1 on the card)
const CHART_PX = 152

function niceMax(v: number): number {
  if (v <= 0) return 60
  const steps = [30, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200, 1440]
  return steps.find((s) => s >= v) ?? Math.ceil(v / 60) * 60
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

export function downloadCsv(log: LogEntry[], now: number) {
  // BOM so Excel opens the UTF-8 task labels correctly.
  const blob = new Blob(['﻿', toCsv(log)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = csvFilename(now)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Stats({ log, now }: { log: LogEntry[]; now: number }) {
  const days = lastDays(log, now, 7)
  const week = weekMinutes(log, now)
  const run = streak(log, now)
  const max = niceMax(Math.max(...days.map((d) => d.minutes)))
  const sevenDayTotal = days.reduce((a, d) => a + d.minutes, 0)
  const [active, setActive] = useState<number | null>(null)

  const dayName = (start: number, i: number) =>
    i === days.length - 1 ? 'Today' : new Date(start).toLocaleDateString([], { weekday: 'short' })
  const longDate = (start: number) => new Date(start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3">
        <Tile label="This week" hint="Mon – today" value={String(week)} unit="min" testId="week-total" sub={week >= 60 ? formatMinutes(week) : undefined} />
        <Tile
          label="Current streak"
          hint="in a row with focus time"
          value={String(run)}
          unit={run === 1 ? 'day' : 'days'}
          testId="streak"
        />
      </div>

      <section aria-labelledby="chart-title" className="rounded-3xl bg-white/70 px-5 py-5 shadow-sm ring-1 ring-black/5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="chart-title" className="text-sm font-medium text-stone-600">
            Focus minutes, last 7 days
          </h2>
          <p className="text-xs text-stone-500">{sevenDayTotal} min total</p>
        </div>

        <div className="relative mt-8" data-testid="chart">
          {/* Recessive scale reference: top line labelled with the scale max. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-stone-200" style={{ height: CHART_PX }} aria-hidden="true">
            <span className="absolute -top-2 right-0 bg-[#fbf9f8] pl-1 text-[10px] leading-none text-stone-400">{max}</span>
          </div>
          <ol className="relative grid grid-cols-7 gap-1" style={{ height: CHART_PX }} onMouseLeave={() => setActive(null)}>
            {days.map((d, i) => {
              const h = d.minutes > 0 ? Math.max(3, Math.round((d.minutes / max) * CHART_PX)) : 0
              const label = `${longDate(d.start)}: ${d.minutes} focus minutes, ${d.sessions} ${d.sessions === 1 ? 'session' : 'sessions'}`
              return (
                <li
                  key={d.key}
                  tabIndex={0}
                  aria-label={label}
                  data-minutes={d.minutes}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(i)}
                  className="group relative flex cursor-default flex-col items-center justify-end rounded-lg outline-none focus-visible:bg-black/[0.04]"
                >
                  {d.minutes > 0 && (
                    <span className="mb-1 text-[11px] font-medium tabular-nums leading-none text-stone-600" aria-hidden="true">
                      {d.minutes}
                    </span>
                  )}
                  <span
                    className="block w-full max-w-6 rounded-t-[4px] transition-[height,opacity] duration-300 group-hover:opacity-85"
                    style={{ height: h, backgroundColor: BAR }}
                    aria-hidden="true"
                  />
                  {active === i && (
                    <span
                      role="tooltip"
                      className={`absolute z-10 w-max max-w-[11rem] rounded-xl bg-stone-800 px-3 py-2 text-xs leading-snug text-white shadow-lg ${
                        i < 2 ? 'left-0' : i > 4 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                      }`}
                      style={{ bottom: h + 22 }}
                    >
                      <span className="block font-medium">{longDate(d.start)}</span>
                      <span className="block text-stone-300">
                        {d.minutes} min · {d.sessions} {d.sessions === 1 ? 'session' : 'sessions'}
                      </span>
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="border-t border-stone-300" aria-hidden="true" />
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] text-stone-500" aria-hidden="true">
            {days.map((d, i) => (
              <span key={d.key} className={i === days.length - 1 ? 'font-semibold text-stone-700' : ''}>
                {dayName(d.start, i)}
              </span>
            ))}
          </div>
          {sevenDayTotal === 0 && (
            <p className="absolute inset-x-0 top-12 text-center text-sm text-stone-400">No focus sessions in the last 7 days yet.</p>
          )}
        </div>

        <table className="sr-only">
          <caption>Focus minutes per day, last 7 days</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Minutes</th>
              <th scope="col">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.key}>
                <th scope="row">{longDate(d.start)}</th>
                <td>{d.minutes}</td>
                <td>{d.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3 rounded-3xl bg-white/70 px-5 py-4 shadow-sm ring-1 ring-black/5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium text-stone-600">All sessions</h2>
          <p className="text-xs text-stone-500" data-testid="history-count">
            {log.length} completed {log.length === 1 ? 'session' : 'sessions'} · {log.reduce((a, e) => a + e.minutes, 0)} min
          </p>
        </div>
        <button
          type="button"
          disabled={log.length === 0}
          onClick={() => downloadCsv(log, Date.now())}
          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export CSV
        </button>
      </section>
    </div>
  )
}

function Tile({ label, hint, value, unit, sub, testId }: { label: string; hint: string; value: string; unit: string; sub?: string; testId: string }) {
  return (
    <section className="rounded-3xl bg-white/70 px-4 py-4 shadow-sm ring-1 ring-black/5">
      <h2 className="text-sm font-medium text-stone-600">{label}</h2>
      <p className="mt-1 flex items-baseline gap-1" data-testid={testId}>
        <span className="text-4xl font-light tabular-nums tracking-tight text-stone-800">{value}</span>
        <span className="text-sm text-stone-500">{unit}</span>
      </p>
      <p className="mt-0.5 text-xs text-stone-500">{sub ?? hint}</p>
    </section>
  )
}
