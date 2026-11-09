import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  THEME_KEY, WELCOME, createNote, filterNotes, highlightSegments, loadNotes, saveNotes,
  snippet, sortNotes, toggleCheckbox, wordCount, type Note,
} from './lib/notes'
import { renderMarkdown } from './lib/markdown'
import {
  activeTagToken, applySuggestion, filterByTag, normalizeTagName, renameTagInText, suggestTags, tagCounts,
} from './lib/tags'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function initialNotes(): Note[] {
  return loadNotes() ?? [createNote(Date.now(), 'Welcome', WELCOME)]
}

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  return highlightSegments(text, query).map((s, i) =>
    s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
  )
}

const btn =
  'rounded-md border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-500'

export default function App() {
  const [init] = useState(() => {
    const n = initialNotes()
    return { notes: n, id: sortNotes(n)[0]?.id ?? null }
  })
  const [notes, setNotes] = useState<Note[]>(init.notes)
  const [selectedId, setSelectedId] = useState<string | null>(init.id)
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list')
  const titleRef = useRef<HTMLInputElement>(null)
  const notesRef = useRef(notes)
  const dirty = useRef(false)

  // Keep selection valid on first render when it was derived from a different initialNotes() call.
  const sorted = useMemo(() => sortNotes(notes), [notes])
  const tags = useMemo(() => tagCounts(notes), [notes])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ tag: string; value: string; error: string } | null>(null)
  const [caret, setCaret] = useState(0)
  const [acIndex, setAcIndex] = useState(0)
  const [acDismissed, setAcDismissed] = useState<number | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const visible = useMemo(() => filterNotes(filterByTag(sorted, activeTag), query), [sorted, activeTag, query])

  useEffect(() => setCaret(0), [selectedId])

  // Clear the filter if its tag no longer exists anywhere.
  useEffect(() => {
    if (activeTag && !tags.some((t) => t.tag === activeTag)) setActiveTag(null)
  }, [tags, activeTag])

  function renameTag() {
    if (!renaming) return
    const to = normalizeTagName(renaming.value)
    if (!to) {
      setRenaming({ ...renaming, error: 'Use letters, numbers, _ or -' })
      return
    }
    const from = renaming.tag
    if (to !== from) {
      const now = Date.now()
      dirty.current = true
      setNotes((ns) =>
        ns.map((n) => {
          const content = renameTagInText(n.content, from, to)
          return content === n.content ? n : { ...n, content, updatedAt: now }
        }),
      )
      if (activeTag === from) setActiveTag(to)
    }
    setRenaming(null)
  }
  const selected = notes.find((n) => n.id === selectedId) ?? null
  const confirmNote = notes.find((n) => n.id === confirmId) ?? null

  useEffect(() => {
    if (selectedId === null || notes.some((n) => n.id === selectedId)) return
    setSelectedId(sorted[0]?.id ?? null)
  }, [notes, selectedId, sorted])

  // Autosave (debounced) + flush when the page is hidden.
  useEffect(() => {
    notesRef.current = notes
    if (!dirty.current) return
    setStatus('saving')
    const t = setTimeout(() => {
      setStatus(saveNotes(notes) ? 'saved' : 'error')
      dirty.current = false
    }, 400)
    return () => clearTimeout(t)
  }, [notes])

  useEffect(() => {
    const flush = () => {
      if (dirty.current) {
        saveNotes(notesRef.current)
        dirty.current = false
      }
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  // Persist the very first state (e.g. the welcome note) too.
  useEffect(() => {
    saveNotes(notesRef.current)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  function edit(id: string, patch: Partial<Note>, touch = true) {
    dirty.current = true
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, ...(touch ? { updatedAt: Date.now() } : {}) } : n)))
  }

  function addNote() {
    const note = createNote()
    dirty.current = true
    setNotes((ns) => [note, ...ns])
    setSelectedId(note.id)
    setQuery('')
    setMobileView('editor')
    setTimeout(() => {
      titleRef.current?.focus()
      titleRef.current?.select()
    }, 0)
  }

  function deleteNote(id: string) {
    dirty.current = true
    setNotes((ns) => ns.filter((n) => n.id !== id))
    setConfirmId(null)
    setMobileView('list')
  }

  // Tag autocomplete: the token being typed before the caret, matched against tags used elsewhere.
  const token = selected ? activeTagToken(selected.content, caret) : null
  const suggestions = useMemo(() => {
    if (!selected || !token) return []
    const others = notes.map((n) =>
      n.id === selected.id ? { content: selected.content.slice(0, token.start) + selected.content.slice(caret) } : n,
    )
    return suggestTags(token.prefix, tagCounts(others))
    // eslint-disable-next-line
  }, [notes, selectedId, caret, token?.start, token?.prefix])
  const acOpen = !!token && suggestions.length > 0 && acDismissed !== token.start
  const acSel = Math.min(acIndex, Math.max(0, suggestions.length - 1))

  function insertSuggestion(tag: string) {
    if (!selected || !token) return
    const r = applySuggestion(selected.content, caret, token, tag)
    edit(selected.id, { content: r.text })
    setCaret(r.caret)
    setAcIndex(0)
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      editorRef.current?.setSelectionRange(r.caret, r.caret)
    })
  }

  function onEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!acOpen || !token) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : -1
      setAcIndex((acSel + d + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insertSuggestion(suggestions[acSel])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setAcDismissed(token.start)
    }
  }

  const html = useMemo(() => (selected ? renderMarkdown(selected.content) : ''), [selected?.content])

  function onPreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement
    if (!selected || t.tagName !== 'INPUT' || (t as HTMLInputElement).type !== 'checkbox') return
    const boxes = Array.from(e.currentTarget.querySelectorAll('input[type="checkbox"]'))
    const idx = boxes.indexOf(t)
    if (idx < 0) return
    e.preventDefault() // state re-render sets the true checked value
    edit(selected.id, { content: toggleCheckbox(selected.content, idx) })
  }

  return (
    <div className="flex h-full flex-col text-slate-900 dark:text-slate-100">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-lg font-semibold">Notes</h1>
        <span
          data-testid="save-status"
          aria-live="polite"
          className={`ml-2 text-xs ${status === 'error' ? 'text-red-600' : 'text-slate-500 dark:text-slate-400'}`}
        >
          {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Save failed'}
        </span>
        <button
          className={`${btn} ml-auto`}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
          data-testid="theme-toggle"
        >
          {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside
          className={`${mobileView === 'list' ? 'flex' : 'hidden'} w-full flex-col border-r border-slate-200 bg-white md:flex md:w-72 md:shrink-0 dark:border-slate-700 dark:bg-slate-900`}
          aria-label="Notes list"
        >
          <div className="flex gap-2 p-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-slate-600"
            />
            <button className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500 border-indigo-600`} onClick={addNote}>
              + New
            </button>
          </div>
          {tags.length > 0 && (
            <div className="max-h-32 overflow-y-auto border-y border-slate-200 px-3 py-2 dark:border-slate-700" data-testid="tag-list" aria-label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {tags.map(({ tag, count }) =>
                  renaming?.tag === tag ? (
                    <form
                      key={tag}
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        renameTag()
                      }}
                    >
                      <input
                        autoFocus
                        value={renaming.value}
                        aria-label={`New name for tag #${tag}`}
                        onChange={(e) => setRenaming({ ...renaming, value: e.target.value, error: '' })}
                        onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                        className="w-28 rounded-md border border-indigo-500 bg-transparent px-2 py-0.5 text-sm"
                      />
                      <button type="submit" className={`${btn} py-0.5`}>OK</button>
                      <button type="button" className={`${btn} py-0.5`} onClick={() => setRenaming(null)}>✕</button>
                    </form>
                  ) : (
                    <span
                      key={tag}
                      data-testid="tag-chip"
                      className={`inline-flex items-center rounded-full border text-sm ${
                        activeTag === tag
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      <button
                        className="rounded-l-full py-0.5 pl-2.5 pr-1"
                        aria-pressed={activeTag === tag}
                        aria-label={`Filter by tag #${tag}, ${count} ${count === 1 ? 'note' : 'notes'}`}
                        onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                      >
                        #{tag} <span className="opacity-70">{count}</span>
                      </button>
                      <button
                        className="rounded-r-full py-0.5 pl-1 pr-2 opacity-70 hover:opacity-100"
                        aria-label={`Rename tag #${tag}`}
                        onClick={() => setRenaming({ tag, value: tag, error: '' })}
                      >
                        ✎
                      </button>
                    </span>
                  ),
                )}
              </div>
              {renaming?.error && <p className="mt-1 text-xs text-red-600">{renaming.error}</p>}
            </div>
          )}
          <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="note-list">
            {visible.map((n) => (
              <li key={n.id}>
                <div
                  className={`group flex items-start gap-1 border-l-4 px-3 py-2 ${
                    n.id === selectedId
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-slate-800'
                      : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                  data-testid="note-item"
                  data-pinned={n.pinned}
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setSelectedId(n.id)
                      setMobileView('editor')
                    }}
                  >
                    <div className="truncate text-sm font-medium">
                      {n.pinned && <span aria-label="Pinned">📌 </span>}
                      <Highlight text={n.title || 'Untitled note'} query={query} />
                    </div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                      <Highlight text={snippet(n.content, query) || 'No content'} query={query} />
                    </div>
                  </button>
                  <button
                    className="rounded p-1 text-sm hover:bg-slate-200 dark:hover:bg-slate-700"
                    aria-label={`${n.pinned ? 'Unpin' : 'Pin'} ${n.title}`}
                    aria-pressed={n.pinned}
                    onClick={() => edit(n.id, { pinned: !n.pinned }, false)}
                  >
                    {n.pinned ? '★' : '☆'}
                  </button>
                </div>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="p-4 text-sm text-slate-500">{notes.length ? 'No notes match your search.' : 'Nothing here yet. Create your first note.'}</li>
            )}
          </ul>
        </aside>

        {/* Editor */}
        <main className={`${mobileView === 'editor' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <button className={`${btn} md:hidden`} onClick={() => setMobileView('list')}>
                  ← Notes
                </button>
                <input
                  ref={titleRef}
                  value={selected.title}
                  onChange={(e) => edit(selected.id, { title: e.target.value })}
                  aria-label="Note title"
                  className="min-w-0 flex-1 basis-40 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold hover:border-slate-300 dark:hover:border-slate-600"
                />
                <button className={btn} onClick={() => { titleRef.current?.focus(); titleRef.current?.select() }}>
                  Rename
                </button>
                <button className={btn} onClick={() => edit(selected.id, { pinned: !selected.pinned }, false)} aria-pressed={selected.pinned}>
                  {selected.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button className={`${btn} text-red-600 dark:text-red-400`} onClick={() => setConfirmId(selected.id)}>
                  Delete
                </button>
              </div>
              <div className="grid min-h-0 flex-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1">
                <div className="relative min-h-0">
                  <textarea
                    ref={editorRef}
                    value={selected.content}
                    onChange={(e) => {
                      edit(selected.id, { content: e.target.value })
                      setCaret(e.target.selectionStart)
                      setAcIndex(0)
                    }}
                    onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                    onKeyDown={onEditorKeyDown}
                    onBlur={() => setAcDismissed(token ? token.start : null)}
                    aria-label="Markdown editor"
                    spellCheck={false}
                    placeholder="Write Markdown here…"
                    className="h-full w-full resize-none border-b border-slate-200 bg-white p-4 font-mono text-sm outline-none dark:border-slate-700 dark:bg-slate-900 lg:border-b-0 lg:border-r"
                  />
                  {acOpen && (
                    <ul
                      role="listbox"
                      aria-label="Tag suggestions"
                      data-testid="tag-suggestions"
                      className="absolute bottom-3 left-3 z-10 max-h-40 min-w-40 overflow-y-auto rounded-md border border-slate-300 bg-white py-1 text-sm shadow-lg dark:border-slate-600 dark:bg-slate-800"
                    >
                      {suggestions.map((t, i) => (
                        <li
                          key={t}
                          role="option"
                          aria-selected={i === acSel}
                          className={`cursor-pointer px-3 py-1 ${i === acSel ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            insertSuggestion(t)
                          }}
                        >
                          #{t}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div
                  className="md min-h-0 overflow-y-auto p-4"
                  data-testid="preview"
                  onClick={onPreviewClick}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </div>
              <div className="flex justify-end border-t border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <span data-testid="word-count">
                  {wordCount(selected.content)} {wordCount(selected.content) === 1 ? 'word' : 'words'}
                </span>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-slate-500">
              <div className="text-center">
                <p className="mb-3">No note selected.</p>
                <button className={btn} onClick={addNote}>+ New note</button>
              </div>
            </div>
          )}
        </main>
      </div>

      {confirmNote && (
        <div
          className="fixed inset-0 z-10 grid place-items-center bg-black/50 p-4"
          onKeyDown={(e) => e.key === 'Escape' && setConfirmId(null)}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="del-title" className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-slate-800">
            <h2 id="del-title" className="text-lg font-semibold">Delete note?</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              “{confirmNote.title || 'Untitled note'}” will be permanently deleted.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className={btn} autoFocus onClick={() => setConfirmId(null)}>Cancel</button>
              <button className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700" onClick={() => deleteNote(confirmNote.id)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
