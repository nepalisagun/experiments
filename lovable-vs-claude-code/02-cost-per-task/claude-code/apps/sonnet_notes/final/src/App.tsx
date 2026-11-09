import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderMarkdown, toggleCheckbox } from './lib/markdown'
import {
  applySuggestion, filterByTag, getTagTrigger, normalizeTagName, renameTag, suggestTags, tagCounts,
  type TagTrigger,
} from './lib/tags'
import {
  SELECTED_KEY, THEME_KEY, WELCOME, createNote, filterNotes, highlight, loadNotes, saveNotes,
  snippet, sortNotes, wordCount, type Note,
} from './lib/notes'

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((s, i) =>
        s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
      )}
    </>
  )
}

function initialNotes(): Note[] {
  const loaded = loadNotes()
  if (loaded) return loaded
  return [{ ...createNote(), title: 'Welcome', content: WELCOME }]
}

function readLS(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

const btn =
  'rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent'

export default function App() {
  const [notes, setNotes] = useState<Note[]>(initialNotes)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const saved = readLS(SELECTED_KEY)
    return saved
  })
  const [query, setQuery] = useState('')
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ name: string; value: string; error: string } | null>(null)
  const [sugg, setSugg] = useState<(TagTrigger & { items: string[] }) | null>(null)
  const [suggIdx, setSuggIdx] = useState(0)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const notesRef = useRef(notes)
  const first = useRef(true)

  const sorted = useMemo(() => sortNotes(notes), [notes])
  const tagList = useMemo(() => tagCounts(notes), [notes])
  const effectiveTag = activeTag && tagList.some((t) => t.name === activeTag) ? activeTag : null
  const visible = useMemo(
    () => filterNotes(filterByTag(sorted, effectiveTag), query),
    [sorted, effectiveTag, query],
  )
  const current = notes.find((n) => n.id === selectedId) ?? sorted[0] ?? null
  const html = useMemo(() => renderMarkdown(current?.content ?? ''), [current?.content])

  // Autosave (debounced) + flush on page hide.
  useEffect(() => {
    notesRef.current = notes
    if (first.current) { first.current = false; return }
    setStatus('saving')
    const t = setTimeout(() => setStatus(saveNotes(notes) ? 'saved' : 'error'), 400)
    return () => clearTimeout(t)
  }, [notes])
  useEffect(() => {
    const flush = () => { if (!first.current) saveNotes(notesRef.current) }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  useEffect(() => {
    try { if (current) localStorage.setItem(SELECTED_KEY, current.id) } catch { /* ignore */ }
  }, [current?.id]) // eslint-disable-line

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light') } catch { /* ignore */ }
  }, [dark])

  const update = (id: string, patch: Partial<Note>, touch = true) =>
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, ...(touch ? { updatedAt: Date.now() } : {}) } : n)))

  const addNote = () => {
    const n = createNote()
    setNotes((ns) => [n, ...ns])
    setSelectedId(n.id)
    setQuery('')
    setMenuOpen(false)
  }

  const confirmDelete = () => {
    if (!deleteId) return
    const remaining = sorted.filter((n) => n.id !== deleteId)
    setNotes((ns) => ns.filter((n) => n.id !== deleteId))
    if (current?.id === deleteId) setSelectedId(remaining[0]?.id ?? null)
    setDeleteId(null)
  }

  const onPreviewClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement
    if (el instanceof HTMLInputElement && el.type === 'checkbox' && current) {
      const line = Number(el.dataset.line)
      if (Number.isInteger(line)) update(current.id, { content: toggleCheckbox(current.content, line) })
    }
  }

  const toDelete = notes.find((n) => n.id === deleteId)

  // restore the caret after inserting a tag suggestion
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && editorRef.current) {
      editorRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  })

  const refreshSugg = (text: string, caret: number) => {
    const trig = getTagTrigger(text, caret)
    const items = trig ? suggestTags(tagList.map((t) => t.name), trig.query) : []
    setSugg(trig && items.length ? { ...trig, items } : null)
    // The browser's async "select" event also fires after typing: only reset the
    // highlighted option when the typed prefix actually changed.
    if (!sugg || !trig || sugg.start !== trig.start || sugg.query !== trig.query) setSuggIdx(0)
  }

  const insertSuggestion = (tag: string) => {
    const ta = editorRef.current
    if (!sugg || !current || !ta) return
    const r = applySuggestion(ta.value, sugg, ta.selectionStart, tag)
    pendingCaret.current = r.caret
    update(current.id, { content: r.text })
    setSugg(null)
    ta.focus()
  }

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!sugg || e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : -1
      setSuggIdx((i) => (i + d + sugg.items.length) % sugg.items.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insertSuggestion(sugg.items[suggIdx])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setSugg(null)
    }
  }

  const submitTagRename = (e: React.FormEvent) => {
    e.preventDefault()
    if (!renaming) return
    const to = normalizeTagName(renaming.value)
    if (!to) {
      setRenaming({ ...renaming, error: 'Use letters, numbers, _ - or / (not only digits).' })
      return
    }
    const from = renaming.name
    if (to !== from) {
      const now = Date.now()
      setNotes((ns) =>
        ns.map((n) => {
          const content = renameTag(n.content, from, to)
          return content === n.content ? n : { ...n, content, updatedAt: now }
        }),
      )
      if (activeTag === from) setActiveTag(to)
    }
    setRenaming(null)
  }

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button className={`${btn} md:hidden`} aria-label="Toggle note list" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          ☰
        </button>
        <h1 className="text-base font-semibold">Notes</h1>
        <div className="flex-1" />
        <button className={btn} onClick={() => setDark((d) => !d)} aria-label="Toggle theme" aria-pressed={dark}>
          {dark ? '☀ Light' : '🌙 Dark'}
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside
          aria-label="Notes list"
          className={`${menuOpen ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-20 w-72 max-w-[85%] flex-col border-r border-line bg-panel shadow-xl md:static md:flex md:max-w-none md:shadow-none`}
        >
          <div className="flex flex-col gap-2 p-3">
            <button className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg" onClick={addNote}>
              + New note
            </button>
            <input
              type="search"
              aria-label="Search notes"
              placeholder="Search notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="rounded-md border border-line bg-bg px-3 py-2 text-sm"
            />
          </div>
          {tagList.length > 0 && (
            <section aria-label="Tags" className="px-3 pb-2">
              <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Tags</h2>
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto" data-testid="tag-list">
                {tagList.map((t) =>
                  renaming?.name === t.name ? (
                    <form key={t.name} onSubmit={submitTagRename} className="flex w-full items-center gap-1">
                      <input
                        autoFocus
                        aria-label={`New name for tag ${t.name}`}
                        value={renaming.value}
                        onChange={(e) => setRenaming({ ...renaming, value: e.target.value, error: '' })}
                        onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null) }}
                        className="min-w-0 flex-1 rounded-md border border-accent bg-bg px-2 py-1 text-sm"
                      />
                      <button type="submit" className={btn}>Save</button>
                      <button type="button" className={btn} onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : (
                    <span
                      key={t.name}
                      className={`inline-flex items-center overflow-hidden rounded-full border text-xs ${effectiveTag === t.name ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-bg'}`}
                    >
                      <button
                        aria-pressed={effectiveTag === t.name}
                        title={effectiveTag === t.name ? 'Click to clear filter' : `Show notes tagged #${t.name}`}
                        onClick={() => setActiveTag(effectiveTag === t.name ? null : t.name)}
                        className="py-1 pr-1.5 pl-2.5"
                      >
                        #{t.name} <span className="opacity-70">{t.count}</span>
                      </button>
                      <button
                        aria-label={`Rename tag ${t.name}`}
                        title="Rename tag"
                        onClick={() => setRenaming({ name: t.name, value: t.name, error: '' })}
                        className="py-1 pr-2 pl-1 opacity-70 hover:opacity-100"
                      >
                        ✎
                      </button>
                    </span>
                  ),
                )}
              </div>
              {renaming?.error && <p role="alert" className="mt-1 text-xs text-danger">{renaming.error}</p>}
            </section>
          )}
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-testid="note-list">
            {visible.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => { setSelectedId(n.id); setMenuOpen(false) }}
                  aria-current={n.id === current?.id}
                  className={`mb-1 w-full rounded-md px-3 py-2 text-left ${n.id === current?.id ? 'bg-sel' : 'hover:bg-line/50'}`}
                >
                  <div className="flex items-center gap-1 text-sm font-medium">
                    {n.pinned && <span aria-label="Pinned" title="Pinned">📌</span>}
                    <span className="truncate" data-testid="note-title"><Highlighted text={n.title || 'Untitled'} query={query} /></span>
                  </div>
                  <div className="truncate text-xs text-muted">
                    <Highlighted text={snippet(n.content, query) || 'Empty note'} query={query} />
                  </div>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted">{query || effectiveTag ? 'No notes match your search.' : 'Nothing here yet. Create your first note.'}</li>
            )}
          </ul>
        </aside>
        {menuOpen && <div className="absolute inset-0 z-10 bg-black/30 md:hidden" onClick={() => setMenuOpen(false)} />}

        <main className="flex min-w-0 flex-1 flex-col">
          {current ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <input
                  ref={titleRef}
                  aria-label="Note title"
                  value={current.title}
                  onChange={(e) => update(current.id, { title: e.target.value })}
                  onBlur={() => { if (!current.title.trim()) update(current.id, { title: 'Untitled note' }) }}
                  className="min-w-0 flex-1 basis-40 rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold hover:border-line focus:border-accent focus:outline-none"
                />
                <button className={btn} onClick={() => { titleRef.current?.focus(); titleRef.current?.select() }}>Rename</button>
                <button className={btn} aria-pressed={current.pinned} onClick={() => update(current.id, { pinned: !current.pinned }, false)}>
                  {current.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button className={`${btn} text-danger`} onClick={() => setDeleteId(current.id)}>Delete</button>
              </div>
              <div className="flex items-center gap-4 border-b border-line bg-panel px-3 py-1 text-xs text-muted">
                <span data-testid="save-status" role="status">
                  {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Could not save'}
                </span>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
                <div className="relative min-h-0 border-b border-line md:border-r md:border-b-0">
                  <textarea
                    aria-label="Markdown editor"
                    spellCheck={false}
                    value={current.content}
                    ref={editorRef}
                    onChange={(e) => {
                      update(current.id, { content: e.target.value })
                      refreshSugg(e.target.value, e.target.selectionStart)
                    }}
                    onSelect={(e) => refreshSugg(e.currentTarget.value, e.currentTarget.selectionStart)}
                    onKeyDown={onEditorKeyDown}
                    onBlur={() => setSugg(null)}
                    placeholder="Write Markdown here… use #tags"
                    className="h-full w-full resize-none bg-bg p-4 pb-9 font-mono text-sm leading-6 focus:outline-none"
                  />
                  {sugg && (
                    <ul
                      role="listbox"
                      aria-label="Tag suggestions"
                      className="absolute bottom-10 left-3 z-10 max-h-44 min-w-40 overflow-y-auto rounded-md border border-line bg-bg py-1 text-sm shadow-lg"
                    >
                      {sugg.items.map((t, i) => (
                        <li
                          key={t}
                          role="option"
                          aria-selected={i === suggIdx}
                          onMouseDown={(e) => { e.preventDefault(); insertSuggestion(t) }}
                          className={`cursor-pointer px-3 py-1.5 ${i === suggIdx ? 'bg-sel' : 'hover:bg-panel'}`}
                        >
                          #{t}
                        </li>
                      ))}
                    </ul>
                  )}
                  <span
                    data-testid="word-count"
                    className="pointer-events-none absolute right-3 bottom-2 rounded bg-panel/90 px-2 py-0.5 text-xs text-muted"
                  >
                    {wordCount(current.content)} {wordCount(current.content) === 1 ? 'word' : 'words'}
                  </span>
                </div>
                <div
                  data-testid="preview"
                  aria-label="Preview"
                  className="md min-h-0 overflow-auto p-4"
                  onClick={onPreviewClick}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center text-muted">
              <div>
                <p className="mb-3">No notes. Create one to get started.</p>
                <button className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg" onClick={addNote}>+ New note</button>
              </div>
            </div>
          )}
        </main>
      </div>

      {toDelete && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4" onClick={() => setDeleteId(null)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="del-title" className="w-full max-w-sm rounded-lg border border-line bg-bg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="del-title" className="mb-2 text-lg font-semibold">Delete note?</h2>
            <p className="mb-4 text-sm text-muted">“{toDelete.title}” will be permanently deleted.</p>
            <div className="flex justify-end gap-2">
              <button autoFocus className={btn} onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
