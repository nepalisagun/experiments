import { currentStreak, isoDate, lastDays, toCsv, totalMinutes } from './stats'
import type { LogEntry } from './timer'

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const CHART_H = 160

export default function Stats({ history, now }: { history: LogEntry[]; now: number }) {
  const days = lastDays(history, now, 7)
  const total = totalMinutes(days)
  const streak = currentStreak(history, now)
  const max = Math.max(25, ...days.map((d) => d.minutes))

  return (
    <div className="flex flex-col gap-5" data-testid="stats">
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <div className="text-xs font-medium uppercase tracking-widest text-stone-500">Last 7 days</div>
          <div className="mt-2 text-3xl font-light tabular-nums" data-testid="week-total">
            {total}
            <span className="ml-1 text-base text-stone-500">min</span>
          </div>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <div className="text-xs font-medium uppercase tracking-widest text-stone-500">Streak</div>
          <div className="mt-2 text-3xl font-light tabular-nums" data-testid="streak">
            {streak}
            <span className="ml-1 text-base text-stone-500">{streak === 1 ? 'day' : 'days'}</span>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200 sm:p-6">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-stone-500">Focus minutes per day</h2>
        <div
          className="grid grid-cols-7 gap-2"
          role="img"
          aria-label={
            'Focus minutes per day, last 7 days: ' +
            days.map((d) => d.date.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.minutes).join(', ')
          }
          data-testid="chart"
        >
          {days.map((d, i) => {
            const isToday = i === days.length - 1
            return (
              <div key={d.key} className="flex flex-col items-center gap-1" data-testid="bar" data-minutes={d.minutes} data-day={isoDate(d.date.getTime())}>
                <span className="text-xs tabular-nums text-stone-500">{d.minutes}</span>
                <div className="flex w-full items-end justify-center" style={{ height: CHART_H }}>
                  <div
                    className={'w-full max-w-9 rounded-t-lg ' + (d.minutes > 0 ? 'bg-rose-400' : 'bg-stone-200')}
                    style={{ height: d.minutes > 0 ? Math.max(4, (d.minutes / max) * CHART_H) : 3 }}
                  />
                </div>
                <span className={'text-xs ' + (isToday ? 'font-semibold text-stone-800' : 'text-stone-500')}>
                  {d.date.toLocaleDateString([], { weekday: 'short' })}
                </span>
              </div>
            )
          })}
        </div>
        {total === 0 && <p className="mt-4 text-center text-sm text-stone-400">No focus sessions in the last 7 days yet.</p>}
      </section>

      <section className="flex items-center justify-between gap-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
        <p className="text-sm text-stone-500">
          {history.length} completed session{history.length === 1 ? '' : 's'} saved in this browser
        </p>
        <button
          onClick={() => download('pomodoro-sessions-' + isoDate(now) + '.csv', toCsv(history))}
          disabled={history.length === 0}
          className="shrink-0 rounded-xl bg-stone-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export CSV
        </button>
      </section>
    </div>
  )
}
