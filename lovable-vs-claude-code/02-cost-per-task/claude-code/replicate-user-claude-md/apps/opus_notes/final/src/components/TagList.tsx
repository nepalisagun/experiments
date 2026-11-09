import { useRef, useState } from 'react'
import { normalizeTag, type TagCount } from '../lib/tags'

export function TagList({
  tags,
  active,
  onToggle,
  onRename,
}: {
  tags: TagCount[]
  active: string | null
  onToggle: (tag: string) => void
  onRename: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  if (tags.length === 0) return null

  const startEdit = (tag: string) => {
    editingRef.current = tag
    setEditing(tag)
    setDraft(tag)
    setError('')
  }
  const stopEdit = () => {
    editingRef.current = null
    setEditing(null)
    setError('')
  }
  /** `onBlur`: give up on an invalid name instead of trapping the user. */
  const commit = (fromBlur: boolean) => {
    const from = editingRef.current
    if (from === null) return
    const to = normalizeTag(draft)
    if (to === null) {
      if (fromBlur) return stopEdit()
      return setError('Use letters, digits, - _ or /, starting with a letter.')
    }
    stopEdit()
    if (to !== from) onRename(from, to)
  }

  return (
    <section className="border-b border-(--line) px-2 pb-2" aria-labelledby="tags-heading">
      <button
        id="tags-heading"
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold tracking-wide text-(--muted) uppercase hover:bg-(--hover)"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>
          ▸
        </span>
        Tags
        {active && !open && <span className="ml-auto normal-case">#{active}</span>}
      </button>
      {open && (
        <ul className="mt-1 max-h-40 overflow-y-auto" data-testid="tag-list">
          {tags.map(({ tag, count }) =>
            editing === tag ? (
              <li key={tag} className="px-1 py-0.5">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    setError('')
                  }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(false)
                    else if (e.key === 'Escape') stopEdit()
                  }}
                  onBlur={() => commit(true)}
                  aria-label={`New name for #${tag}`}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'tag-rename-error' : undefined}
                  className={`field w-full py-1 ${error ? 'border-red-500' : ''}`}
                />
                {error && (
                  <p id="tag-rename-error" role="alert" className="mt-1 px-1 text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}
              </li>
            ) : (
              <li key={tag} className="group flex items-center">
                <button
                  onClick={() => onToggle(tag)}
                  aria-pressed={active === tag}
                  data-testid="tag-item"
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
                    active === tag ? 'bg-(--active) font-medium' : 'hover:bg-(--hover)'
                  }`}
                >
                  <span className="truncate">#{tag}</span>
                  <span className="ml-auto text-xs text-(--muted)" aria-label={`${count} ${count === 1 ? 'note' : 'notes'}`}>
                    {count}
                  </span>
                </button>
                <button
                  onClick={() => startEdit(tag)}
                  aria-label={`Rename tag #${tag}`}
                  title="Rename tag"
                  className="ml-0.5 rounded-md px-1.5 py-1 text-xs text-(--muted) hover:bg-(--hover) hover:text-(--fg)"
                >
                  ✎
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
