import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { countWords, renderMarkdown, toggleTask } from './lib/markdown'
import {
  createNote,
  highlight,
  loadNotes,
  matchesQuery,
  saveNotes,
  snippet,
  sortNotes,
  THEME_KEY,
  UNTITLED,
  WELCOME,
  type Note,
} from './lib/notes'

import { MarkdownEditor } from './components/MarkdownEditor'
import { TagList } from './components/TagList'
import { extractTags, renameTag, tagCounts } from './lib/tags'

type Theme = 'light' | 'dark'

// Notes are immutable, so a note object's tags never change: cache them per object.
const tagCache = new WeakMap<Note, string[]>()
function tagsOf(n: Note): string[] {
  let t = tagCache.get(n)
  if (!t) tagCache.set(n, (t = extractTags(n.content)))
  return t
}
type SaveState = 'saved' | 'saving' | 'error'

function initialNotes(): Note[] {
  const stored = loadNotes(localStorage)
  if (stored) return stored
  return [createNote(Date.now(), 'Welcome', WELCOME)]
}

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'light' || t === 'dark') return t
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

function relativeTime(ts: number, now: number): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(ts).toLocaleDateString()
}

function ConfirmDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        className="w-full max-w-sm rounded-xl border border-(--line) bg-(--panel) p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          Delete note?
        </h2>
        <p id="confirm-desc" className="mt-2 text-sm text-(--muted)">
          “{title}” will be permanently deleted. This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>(initialNotes)
  const [selectedId, setSelectedId] = useState<string | null>(() => sortNotes(notes)[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const titleRef = useRef<HTMLInputElement>(null)

  // ---- persistence: debounced autosave, flushed when the page is hidden ----
  const latest = useRef(notes)
  const dirty = useRef(false)
  const saved = useRef<Note[] | null>(null)
  useEffect(() => {
    latest.current = notes
    if (notes === saved.current) return // nothing new (e.g. StrictMode re-run)
    if (saved.current === null) {
      saved.current = notes
      saveNotes(localStorage, notes) // first render: persist the seeded welcome note
      return
    }
    dirty.current = true
    setSaveState('saving')
    const t = setTimeout(() => {
      dirty.current = false
      saved.current = notes
      setSaveState(saveNotes(localStorage, notes) ? 'saved' : 'error')
    }, 400)
    return () => clearTimeout(t)
  }, [notes])
  useEffect(() => {
    const flush = () => {
      if (dirty.current) {
        dirty.current = false
        saveNotes(localStorage, latest.current)
      }
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    const onVis = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // ---- theme ----
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const [activeTag, setActiveTag] = useState<string | null>(null)
  // A #tag still being typed in the editor doesn't count until the word is finished.
  type Typing = { id: string; from: number; to: number }
  const [typing, setTyping] = useState<Typing | null>(null)
  const onTyping = useCallback(
    (r: Typing | null) =>
      setTyping((p) => (p?.id === r?.id && p?.from === r?.from && p?.to === r?.to ? p : r)),
    [],
  )
  const counts = useMemo(
    () =>
      tagCounts(
        notes.map((n) =>
          typing?.id === n.id ? n.content.slice(0, typing.from) + ' ' + n.content.slice(typing.to) : n.content,
        ),
      ),
    [notes, typing],
  )
  // A filter on a tag that no longer exists is no filter.
  const tagFilter = activeTag && counts.some((t) => t.tag === activeTag) ? activeTag : null

  const sorted = useMemo(() => sortNotes(notes), [notes])
  const visible = useMemo(
    () => sorted.filter((n) => matchesQuery(n, query) && (!tagFilter || tagsOf(n).includes(tagFilter))),
    [sorted, query, tagFilter],
  )
  const current = notes.find((n) => n.id === selectedId) ?? null
  const otherTags = useMemo(
    () => [...new Set(notes.filter((n) => n.id !== selectedId).flatMap(tagsOf))],
    [notes, selectedId],
  )

  const renameTagEverywhere = (from: string, to: string) => {
    const now = Date.now()
    setNotes((ns) =>
      ns.map((n) => {
        const content = renameTag(n.content, from, to)
        return content === n.content ? n : { ...n, content, updatedAt: now }
      }),
    )
    if (activeTag === from) setActiveTag(to.toLowerCase())
  }
  const html = useMemo(() => (current ? renderMarkdown(current.content) : ''), [current])
  const words = useMemo(() => (current ? countWords(current.content) : 0), [current])

  const update = useCallback((id: string, patch: Partial<Note>) => {
    setNow(Date.now())
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)))
  }, [])

  const addNote = () => {
    const n = createNote()
    setNotes((ns) => [n, ...ns])
    setSelectedId(n.id)
    setQuery('')
    setMobileView('editor')
    requestAnimationFrame(() => {
      titleRef.current?.focus()
      titleRef.current?.select()
    })
  }

  const togglePin = (id: string) =>
    // Pinning is not an edit, so it leaves updatedAt alone.
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)))

  const deleteNote = (id: string) => {
    const order = sortNotes(notes)
    const idx = order.findIndex((n) => n.id === id)
    const rest = order.filter((n) => n.id !== id)
    setNotes((ns) => ns.filter((n) => n.id !== id))
    if (selectedId === id) {
      setSelectedId(rest[Math.min(idx, rest.length - 1)]?.id ?? null)
      if (rest.length === 0) setMobileView('list')
    }
    setConfirmId(null)
  }

  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement
    const chip = el.closest<HTMLElement>('[data-tag]')
    if (chip?.dataset.tag) {
      setActiveTag(chip.dataset.tag)
      setMobileView('list')
      return
    }
    if (!current || !(el instanceof HTMLInputElement) || el.type !== 'checkbox') return
    const line = Number(el.dataset.line)
    if (Number.isInteger(line)) update(current.id, { content: toggleTask(current.content, line) })
  }

  const open = (id: string) => {
    setSelectedId(id)
    setMobileView('editor')
  }

  const confirmNote = notes.find((n) => n.id === confirmId)
  const cancelConfirm = useCallback(() => setConfirmId(null), [])

  return (
    <div className="flex h-dvh flex-col bg-(--bg) text-(--fg)">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-(--line) bg-(--panel) px-3">
        {mobileView === 'editor' && (
          <button className="btn btn-ghost md:hidden" onClick={() => setMobileView('list')} aria-label="Back to notes">
            ← Notes
          </button>
        )}
        <span className={`font-semibold tracking-tight ${mobileView === 'editor' ? 'hidden md:inline' : ''}`}>
          Markdown Notes
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span
            className="text-xs text-(--muted)"
            role="status"
            aria-live="polite"
            data-testid="save-status"
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved (storage full?)' : '✓ Saved'}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀︎' : '☾'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside
          className={`${mobileView === 'list' ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-r border-(--line) bg-(--panel) md:flex md:w-72`}
          aria-label="Notes"
        >
          <div className="flex gap-2 p-3">
            <input
              type="search"
              placeholder="Search notes…"
              aria-label="Search notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="field min-w-0 flex-1"
            />
            <button className="btn btn-primary shrink-0" onClick={addNote}>
              + New
            </button>
          </div>
          <TagList
            tags={counts}
            active={tagFilter}
            onToggle={(t) => setActiveTag((a) => (a === t ? null : t))}
            onRename={renameTagEverywhere}
          />
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-3" data-testid="note-list">
            {visible.map((n) => {
              const active = n.id === selectedId
              return (
                <li key={n.id}>
                  <button
                    onClick={() => open(n.id)}
                    aria-current={active ? 'true' : undefined}
                    data-testid="note-item"
                    className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      active ? 'bg-(--active)' : 'hover:bg-(--hover)'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {n.pinned && (
                        <span aria-label="Pinned" title="Pinned" className="text-xs">
                          📌
                        </span>
                      )}
                      <span className="truncate font-medium" data-testid="note-title">
                        <Highlighted text={n.title || UNTITLED} query={query} />
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-(--muted)">
                      <Highlighted text={snippet(n.content, query) || 'Empty note'} query={query} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-(--muted)">{relativeTime(n.updatedAt, now)}</div>
                  </button>
                </li>
              )
            })}
            {visible.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-(--muted)">
                {notes.length === 0
                  ? 'Nothing here yet. Create your first note.'
                  : query.trim()
                    ? 'No notes match your search.'
                    : `No notes tagged #${tagFilter}.`}
              </li>
            )}
          </ul>
        </aside>

        {/* Editor */}
        <main className={`${mobileView === 'editor' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>
          {current ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--line) px-3 py-2">
                <input
                  ref={titleRef}
                  value={current.title}
                  placeholder={UNTITLED}
                  onChange={(e) => update(current.id, { title: e.target.value })}
                  aria-label="Note title"
                  className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-(--muted) focus:ring-0"
                />
                <button
                  className="btn btn-ghost"
                  onClick={() => togglePin(current.id)}
                  aria-pressed={current.pinned}
                >
                  {current.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button className="btn btn-ghost text-red-600 dark:text-red-400" onClick={() => setConfirmId(current.id)}>
                  Delete
                </button>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-1 content-start overflow-y-auto md:grid-cols-2 md:content-stretch md:overflow-hidden">
                <MarkdownEditor
                  key={current.id}
                  value={current.content}
                  onChange={(content) => update(current.id, { content })}
                  otherTags={otherTags}
                  onTyping={(r) => onTyping(r && { id: current.id, ...r })}
                  className="h-[45dvh] border-b border-(--line) md:h-full md:border-r md:border-b-0"
                />
                <div
                  className="md-preview p-4 md:h-full md:overflow-y-auto"
                  aria-label="Preview"
                  data-testid="preview"
                  onClick={onPreviewClick}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </div>
              <div className="flex shrink-0 justify-end border-t border-(--line) bg-(--panel) px-3 py-1">
                <span className="text-xs text-(--muted)" data-testid="word-count">
                  {words} {words === 1 ? 'word' : 'words'}
                </span>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center text-(--muted)">
              <div>
                <p>No note selected.</p>
                <button className="btn btn-primary mt-3" onClick={addNote}>
                  + New note
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {confirmNote && (
        <ConfirmDialog
          title={confirmNote.title || UNTITLED}
          onCancel={cancelConfirm}
          onConfirm={() => deleteNote(confirmNote.id)}
        />
      )}
    </div>
  )
}
