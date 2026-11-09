import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applySettings, durationMs, formatTitle, getRemainingMs, reset as resetTimer,
  sanitizeSettings, sanitizeTimer, skip as skipTimer, tick, toggle as toggleTimer,
  type Settings, type TimerState,
} from './lib/timer'
import { addEntry, sanitizeHistory, type LogEntry } from './lib/log'
import { KEYS, load, save } from './lib/storage'
import { playChime, unlockAudio } from './lib/sound'

interface Boot {
  settings: Settings
  timer: TimerState
  log: LogEntry[]
  muted: boolean
  task: string
}

/** Load persisted state and catch up on anything that finished while the page was closed. */
function boot(): Boot {
  const now = Date.now()
  const settings = sanitizeSettings(load(KEYS.settings))
  let timer = sanitizeTimer(load(KEYS.timer), settings)
  // The full history of completed sessions across all days (today's log is derived from it).
  let log = sanitizeHistory(load(KEYS.log))
  const task = typeof load(KEYS.task) === 'string' ? (load(KEYS.task) as string) : ''
  const result = tick(timer, settings, now)
  if (result.ended?.phase === 'focus') {
    log = addEntry(log, { task: task.trim(), finishedAt: result.ended.at, minutes: settings.focus })
  }
  timer = result.state
  return { settings, timer, log, muted: load(KEYS.muted) === true, task }
}

export function usePomodoro() {
  const [initial] = useState(boot)
  const [settings, setSettingsState] = useState(initial.settings)
  const [timer, setTimer] = useState(initial.timer)
  const [log, setLog] = useState(initial.log)
  const [muted, setMuted] = useState(initial.muted)
  const [task, setTask] = useState(initial.task)
  const [now, setNow] = useState(() => Date.now())

  // Refs mirror the latest values so the interval callback can act without stale closures.
  const ref = useRef({ settings, timer, muted, task })
  ref.current = { settings, timer, muted, task }

  // Persistence.
  useEffect(() => save(KEYS.settings, settings), [settings])
  useEffect(() => save(KEYS.timer, timer), [timer])
  useEffect(() => save(KEYS.log, log), [log])
  useEffect(() => save(KEYS.muted, muted), [muted])
  useEffect(() => save(KEYS.task, task), [task])

  const check = useCallback(() => {
    const t = Date.now()
    setNow(t)
    const { settings, timer, muted, task } = ref.current
    const result = tick(timer, settings, t)
    if (!result.ended) return
    ref.current.timer = result.state
    setTimer(result.state)
    if (result.ended.phase === 'focus') {
      const entry = { task: task.trim(), finishedAt: result.ended.at, minutes: settings.focus }
      setLog((prev) => addEntry(prev, entry))
    }
    if (!muted) playChime()
  }, [])

  // Poll frequently while running, and fire exactly at the end time. Both read the clock,
  // so throttled timers in a background tab only delay the update, never skew it.
  useEffect(() => {
    if (timer.status !== 'running' || timer.endsAt === null) return
    const interval = window.setInterval(check, 250)
    const timeout = window.setTimeout(check, Math.max(0, timer.endsAt - Date.now()) + 20)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [timer.status, timer.endsAt, check])

  useEffect(() => {
    const onVisible = () => check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [check])

  useEffect(() => {
    document.title = formatTitle(timer, now)
  }, [timer, now])

  const update = (fn: (t: TimerState) => TimerState) => {
    const t = Date.now()
    const next = fn(ref.current.timer)
    ref.current.timer = next
    setTimer(next)
    setNow(t)
  }

  const toggle = useCallback(() => {
    unlockAudio()
    update((t) => toggleTimer(t, Date.now()))
  }, [])
  const reset = useCallback(() => update((t) => resetTimer(t, ref.current.settings)), [])
  const skip = useCallback(() => update((t) => skipTimer(t, ref.current.settings)), [])

  const setSettings = useCallback((s: Settings) => {
    ref.current.settings = s
    setSettingsState(s)
    update((t) => applySettings(t, s))
  }, [])

  const remainingMs = getRemainingMs(timer, now)
  const totalMs = timer.status === 'idle' ? durationMs(timer.phase, settings) : Math.max(remainingMs, durationMs(timer.phase, settings))

  return { settings, setSettings, timer, remainingMs, totalMs, log, muted, setMuted, task, setTask, toggle, reset, skip }
}
