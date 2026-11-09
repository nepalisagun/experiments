import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderMarkdown, toggleTask } from './lib/markdown'
import {
  type Note,
  THEME_KEY,
  WELCOME_NOTE,
  createNote,
  displayTitle,
  highlight,
  loadState,
  relativeTime,
  saveState,
  searchNotes,
  snippet,
  sortNotes,
  wordCount,
} from './lib/notes'
import { countTags, hasTag, renameTag } from './lib/tags'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Icon } from './components/Icon'
import { MarkdownEditor } from './components/MarkdownEditor'
import { TagPanel } from './components/TagPanel'

type Theme = 'light' | 'dark'
type SaveStatus = 'saved' | 'saving' | 'error'

const SAVE_DELAY = 400

function initialState() {
  const saved = loadState(localStorage)
  if (saved) return saved
  const welcome = createNote(Date.now(), 'Welcome', WELCOME_NOTE)
  return { notes: [welcome], activeId: welcome.id }
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

export default function App() {
  const [init] = useState(initialState)
  const [notes, setNotes] = useState<Note[]>(init.notes)
  const [activeId, setActiveId] = useState<string | null>(init.activeId)
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list')
  const [, setTick] = useState(0)
  const titleRef = useRef<HTMLInputElement>(null)
  const focusTitleNext = useRef(false)

  // ---- persistence ---------------------------------------------------------
  const latest = useRef({ notes, activeId })
  latest.current = { notes, activeId }
  const dirty = useRef(false)
  const lastSaved = useRef<Note[] | null>(null)

  const flush = useCallback(() => {
    const ok = saveState(localStorage, latest.current)
    lastSaved.current = latest.current.notes
    dirty.current = false
    setSaveStatus(ok ? 'saved' : 'error')
  }, [])

  useEffect(() => {
    if (lastSaved.current === null) {
      // First mount: persist (e.g. the seeded welcome note) without showing "Saving…".
      saveState(localStorage, latest.current)
      lastSaved.current = notes
      return
    }
    if (lastSaved.current === notes) return
    dirty.current = true
    setSaveStatus('saving')
    const t = setTimeout(flush, SAVE_DELAY)
    return () => clearTimeout(t)
  }, [notes, flush])

  // The active note is a UI preference; save it straight away without the indicator.
  useEffect(() => {
    if (!dirty.current) saveState(localStorage, latest.current)
  }, [activeId])

  useEffect(() => {
    const onHide = () => {
      if (dirty.current) flush()
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
    }
  }, [flush])

  // Keep "edited 2m ago" labels fresh.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // ---- theme ----------------------------------------------------------------
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  // ---- derived --------------------------------------------------------------
  const sorted = useMemo(() => sortNotes(notes), [notes])
  const visible = useMemo(() => {
    const found = searchNotes(sorted, query)
    return tagFilter ? found.filter((n) => hasTag(n.content, tagFilter)) : found
  }, [sorted, query, tagFilter])
  const tagCounts = useMemo(() => countTags(notes.map((n) => n.content)), [notes])
  const otherTags = useMemo(
    () => countTags(notes.filter((n) => n.id !== activeId).map((n) => n.content)).map((t) => t.tag),
    [notes, activeId],
  )
  const active = notes.find((n) => n.id === activeId) ?? null
  const previewHtml = useMemo(() => (active ? renderMarkdown(active.content) : ''), [active])
  const words = useMemo(() => (active ? wordCount(active.content) : 0), [active])

  useEffect(() => {
    if (focusTitleNext.current && titleRef.current) {
      focusTitleNext.current = false
      titleRef.current.focus()
      titleRef.current.select()
    }
  })

  // ---- actions --------------------------------------------------------------
  const updateNote = (id: string, patch: Partial<Note>, touch = true) =>
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, ...(touch ? { updatedAt: Date.now() } : {}) } : n)))

  const addNote = () => {
    const note = createNote()
    setNotes((ns) => [note, ...ns])
    setActiveId(note.id)
    setQuery('')
    setMobileView('editor')
    focusTitleNext.current = true
  }

  const openNote = (id: string) => {
    setActiveId(id)
    setMobileView('editor')
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const id = pendingDelete.id
    const idx = sorted.findIndex((n) => n.id === id)
    const rest = sorted.filter((n) => n.id !== id)
    setNotes((ns) => ns.filter((n) => n.id !== id))
    if (activeId === id) {
      const next = rest[Math.min(idx, rest.length - 1)]
      setActiveId(next ? next.id : null)
      setMobileView('list')
    }
    setPendingDelete(null)
  }

  const renameTagEverywhere = (from: string, to: string) => {
    const now = Date.now()
    setNotes((ns) =>
      ns.map((n) => {
        const content = renameTag(n.content, from, to)
        return content === n.content ? n : { ...n, content, updatedAt: now }
      }),
    )
    setTagFilter(to)
  }

  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const tagButton = target.closest<HTMLElement>('[data-tag]')
    if (tagButton?.dataset.tag) {
      e.preventDefault()
      setTagFilter(tagButton.dataset.tag)
      setMobileView('list')
      return
    }
    if (target instanceof HTMLInputElement && target.type === 'checkbox' && target.dataset.line && active) {
      e.preventDefault()
      const line = Number(target.dataset.line)
      updateNote(active.id, { content: toggleTask(active.content, line) })
    }
  }

  // ---- render -----------------------------------------------------------------
  return (
    <div className="flex h-dvh overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Sidebar */}
      <aside
        className={`${mobileView === 'list' ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-zinc-200 bg-zinc-50 md:flex md:w-72 md:border-r dark:border-zinc-800 dark:bg-zinc-900`}
        aria-label="Notes"
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <h1 className="flex-1 text-lg font-semibold tracking-tight">Notes</h1>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            className="icon-btn"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button
            type="button"
            onClick={addNote}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            <Icon name="plus" className="size-4" />
            New
          </button>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              className="w-full rounded-md border border-zinc-300 bg-white py-1.5 pr-2 pl-8 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
        </div>
        <TagPanel tags={tagCounts} selected={tagFilter} onSelect={setTagFilter} onRename={renameTagEverywhere} />
        <ul className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Note list">
          {visible.map((n) => {
            const isActive = n.id === activeId
            return (
              <li key={n.id} className="group relative">
                <button
                  type="button"
                  onClick={() => openNote(n.id)}
                  aria-current={isActive ? 'true' : undefined}
                  data-testid="note-item"
                  className={`block w-full rounded-md px-3 py-2 pr-9 text-left ${
                    isActive
                      ? 'bg-indigo-100 dark:bg-indigo-500/20'
                      : 'hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {n.pinned && <Icon name="pin-filled" className="size-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />}
                    <span className="truncate text-sm font-medium" data-testid="note-title">
                      <Highlighted text={displayTitle(n)} query={query} />
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {snippet(n.content, query) ? <Highlighted text={snippet(n.content, query)} query={query} /> : 'Empty note'}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-zinc-400 dark:text-zinc-500">
                    {relativeTime(n.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => updateNote(n.id, { pinned: !n.pinned }, false)}
                  aria-label={n.pinned ? `Unpin ${displayTitle(n)}` : `Pin ${displayTitle(n)}`}
                  aria-pressed={n.pinned}
                  title={n.pinned ? 'Unpin' : 'Pin to top'}
                  className={`icon-btn absolute top-1.5 right-1.5 ${
                    n.pinned ? 'text-indigo-600 dark:text-indigo-400' : 'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'
                  }`}
                >
                  <Icon name={n.pinned ? 'pin-filled' : 'pin'} className="size-4" />
                </button>
              </li>
            )
          })}
          {visible.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-zinc-500">
              {notes.length === 0
                ? 'Nothing here yet. Create your first note.'
                : query.trim()
                  ? `No notes match “${query.trim()}”${tagFilter ? ` tagged #${tagFilter}` : ''}.`
                  : `No notes tagged #${tagFilter}.`}
            </li>
          )}
        </ul>
      </aside>

      {/* Editor */}
      <main className={`${mobileView === 'editor' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>
        {active ? (
          <>
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-200 px-3 py-2 md:px-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setMobileView('list')}
                className="icon-btn md:hidden"
                aria-label="Back to notes"
              >
                <Icon name="back" />
              </button>
              <input
                ref={titleRef}
                value={active.title}
                onChange={(e) => updateNote(active.id, { title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    document.getElementById('editor')?.focus()
                  }
                }}
                placeholder="Untitled"
                aria-label="Note title"
                className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 text-lg font-semibold outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-indigo-500/30"
              />
              <button
                type="button"
                onClick={() => updateNote(active.id, { pinned: !active.pinned }, false)}
                className={`icon-btn ${active.pinned ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
                aria-label={active.pinned ? 'Unpin note' : 'Pin note'}
                aria-pressed={active.pinned}
                title={active.pinned ? 'Unpin' : 'Pin to top'}
              >
                <Icon name={active.pinned ? 'pin-filled' : 'pin'} />
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(active)}
                className="icon-btn hover:text-red-600 dark:hover:text-red-400"
                aria-label="Delete note"
                title="Delete"
              >
                <Icon name="trash" />
              </button>
              <div className="flex w-full items-center gap-3 px-1 text-xs text-zinc-500 md:w-auto md:order-none dark:text-zinc-400">
                <span
                  data-testid="save-status"
                  aria-live="polite"
                  className={saveStatus === 'error' ? 'text-red-600' : ''}
                >
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved — storage full' : (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="check" className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      Saved
                    </span>
                  )}
                </span>
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-2 md:overflow-hidden">
              <section className="flex flex-col border-zinc-200 md:min-h-0 md:border-r dark:border-zinc-800" aria-label="Markdown source">
                <div className="pane-label">Markdown</div>
                <MarkdownEditor
                  id="editor"
                  value={active.content}
                  onChange={(content) => updateNote(active.id, { content })}
                  otherTags={otherTags}
                  className="md:min-h-0 md:flex-1"
                />
                <div className="flex justify-end px-4 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span data-testid="word-count">
                    {words} {words === 1 ? 'word' : 'words'}
                  </span>
                </div>
              </section>
              <section className="flex flex-col border-t border-zinc-200 md:min-h-0 md:border-t-0 dark:border-zinc-800" aria-label="Preview">
                <div className="pane-label">Preview</div>
                <div
                  className="md-preview px-4 py-3 md:flex-1 md:overflow-y-auto"
                  data-testid="preview"
                  onClick={onPreviewClick}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </section>
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div>
              <p className="text-zinc-500 dark:text-zinc-400">
                {notes.length === 0 ? 'You have no notes yet.' : 'Select a note to start editing.'}
              </p>
              <button
                type="button"
                onClick={addNote}
                className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Create a note
              </button>
              <button type="button" onClick={() => setMobileView('list')} className="mt-3 ml-2 text-sm underline md:hidden">
                Back to list
              </button>
            </div>
          </div>
        )}
      </main>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete note?"
          message={`“${displayTitle(pendingDelete)}” will be permanently deleted. This can’t be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
