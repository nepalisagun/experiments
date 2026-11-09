import { useEffect, useRef, useState } from 'react'
import { type TagCount, normalizeTag } from '../lib/tags'
import { Icon } from './Icon'

interface Props {
  tags: TagCount[]
  selected: string | null
  onSelect: (tag: string | null) => void
  /** Renames `from` to `to` in every note. */
  onRename: (from: string, to: string) => void
}

export function TagPanel({ tags, selected, onSelect, onRename }: Props) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Leaving the selected tag cancels an unfinished rename.
  useEffect(() => {
    setRenaming(false)
    setError(null)
  }, [selected])

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  if (tags.length === 0 && !selected) return null

  const startRename = () => {
    setDraft(selected ?? '')
    setError(null)
    setRenaming(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    const to = normalizeTag(draft)
    if (!to) {
      setError('Use letters, numbers, - or _ (not only numbers).')
      inputRef.current?.focus()
      return
    }
    if (to !== selected) onRename(selected, to)
    setRenaming(false)
  }

  return (
    <section aria-label="Tags" className="px-4 pb-3">
      {tags.length > 0 && (
        <>
          <h2 className="mb-1.5 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
            Tags
          </h2>
          <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="Tag list">
            {tags.map(({ tag, count }) => {
              const on = tag === selected
              return (
                <li key={tag}>
                  <button
                    type="button"
                    data-testid="tag-chip"
                    data-tag={tag}
                    aria-pressed={on}
                    title={on ? 'Click to clear the filter' : `Show notes tagged #${tag}`}
                    onClick={() => onSelect(on ? null : tag)}
                    className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-indigo-500 ${
                      on
                        ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                        : 'bg-zinc-200/80 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                    }`}
                  >
                    <span className="truncate">#{tag}</span>
                    <span
                      className={`tabular-nums ${on ? 'text-indigo-100' : 'text-zinc-500 dark:text-zinc-400'}`}
                      aria-label={`${count} ${count === 1 ? 'note' : 'notes'}`}
                    >
                      {count}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {selected && !renaming && (
        <div
          className="mt-2 flex items-center gap-1 rounded-md bg-indigo-50 py-1 pr-1 pl-2.5 text-xs text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-200"
          data-testid="tag-filter-bar"
        >
          <span className="min-w-0 flex-1 truncate">
            Tagged <strong>#{selected}</strong>
          </span>
          <button
            type="button"
            onClick={startRename}
            className="rounded px-1.5 py-0.5 font-medium hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label="Clear tag filter"
            title="Clear filter"
            className="grid size-6 place-items-center rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
          >
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
      )}

      {selected && renaming && (
        <form
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRenaming(false)
          }}
          className="mt-2 rounded-md bg-indigo-50 p-2 dark:bg-indigo-500/15">
          <label htmlFor="rename-tag" className="block text-xs text-indigo-900 dark:text-indigo-200">
            Rename <strong>#{selected}</strong> in every note
          </label>
          <div className="mt-1.5 flex gap-1.5">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm text-zinc-400">#</span>
              <input
                id="rename-tag"
                ref={inputRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setError(null)
                }}
                aria-label="New tag name"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'rename-tag-error' : undefined}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded border border-zinc-300 bg-white py-1 pr-2 pl-5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
            <button type="submit" className="rounded bg-indigo-600 px-2.5 text-xs font-medium text-white hover:bg-indigo-500">
              Save
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="rounded px-2 text-xs font-medium text-zinc-600 hover:bg-indigo-100 dark:text-zinc-300 dark:hover:bg-indigo-500/20"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p id="rename-tag-error" role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {!error && normalizeTag(draft) && normalizeTag(draft) !== selected && tags.some((t) => t.tag === normalizeTag(draft)) && (
            <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              #{normalizeTag(draft)} already exists — the tags will be merged.
            </p>
          )}
        </form>
      )}
    </section>
  )
}
