import { useLayoutEffect, useRef, useState } from 'react'
import { caretCoordinates } from '../lib/caret'
import { type TagQuery, applySuggestion, extractTags, suggestTags, tagQueryAt } from '../lib/tags'

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  /** Tags used by other notes; the current note's own tags are added here. */
  otherTags: string[]
  className?: string
}

interface Suggest {
  q: TagQuery
  items: string[]
  index: number
  top: number
  left: number
}

const ITEM_HEIGHT = 32
const POPUP_WIDTH = 224

/** Markdown textarea that suggests existing #tags while one is being typed. */
export function MarkdownEditor({ id, value, onChange, otherTags, className = '' }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [suggest, setSuggest] = useState<Suggest | null>(null)
  /** `#` position the user dismissed (Escape) or just completed. */
  const dismissed = useRef<number | null>(null)
  const pendingCaret = useRef<number | null>(null)

  useLayoutEffect(() => {
    const ta = ref.current
    if (ta && pendingCaret.current != null) {
      ta.focus()
      ta.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  }, [value])

  const close = () => setSuggest(null)

  const update = (ta: HTMLTextAreaElement) => {
    const text = ta.value
    const q = ta.selectionStart === ta.selectionEnd ? tagQueryAt(text, ta.selectionStart) : null
    if (!q) dismissed.current = null
    if (!q || dismissed.current === q.start) return close()

    // The tag being typed is not a suggestion source itself.
    const own = extractTags(text.slice(0, q.start) + text.slice(q.end))
    const pool = [...new Set([...otherTags, ...own])]
    const items = suggestTags(pool, q.query)
    if (items.length === 0) return close()

    const c = caretCoordinates(ta, q.start)
    const wrap = wrapRef.current!
    const height = items.length * ITEM_HEIGHT + 8
    let top = ta.offsetTop + c.top + c.height + 2
    if (top + height > wrap.clientHeight && ta.offsetTop + c.top - height - 2 > 0) {
      top = ta.offsetTop + c.top - height - 2
    }
    const left = Math.max(8, Math.min(ta.offsetLeft + c.left, wrap.clientWidth - POPUP_WIDTH - 8))

    setSuggest((prev) => ({
      q,
      items,
      index: prev && prev.items.join() === items.join() ? prev.index : 0,
      top,
      left,
    }))
  }

  const choose = (tag: string) => {
    const ta = ref.current
    if (!ta || !suggest) return
    const result = applySuggestion(ta.value, suggest.q, tag)
    dismissed.current = suggest.q.start
    pendingCaret.current = result.caret
    close()
    onChange(result.text)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggest || e.nativeEvent.isComposing) return
    const n = suggest.items.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setSuggest({ ...suggest, index: (suggest.index + step + n) % n })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      choose(suggest.items[suggest.index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      dismissed.current = suggest.q.start
      close()
    }
  }

  const listId = `${id}-tags`
  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <textarea
        ref={ref}
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          update(e.target)
        }}
        onSelect={(e) => update(e.currentTarget)}
        onScroll={(e) => suggest && update(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={close}
        spellCheck
        placeholder="Start writing Markdown… Use #tags to organise notes."
        aria-label="Markdown editor"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggest ? true : false}
        aria-controls={suggest ? listId : undefined}
        aria-activedescendant={suggest ? `${listId}-${suggest.index}` : undefined}
        className="block h-[45vh] w-full resize-none bg-transparent px-4 py-3 font-mono text-sm leading-relaxed outline-none md:h-full"
      />
      {suggest && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Tag suggestions"
          className="absolute z-20 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{ top: suggest.top, left: suggest.left, width: POPUP_WIDTH }}
        >
          {suggest.items.map((tag, i) => (
            <li
              key={tag}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === suggest.index}
              // Keep focus (and the caret) in the textarea.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(tag)}
              onMouseEnter={() => setSuggest({ ...suggest, index: i })}
              className={`flex h-8 cursor-pointer items-center truncate px-3 font-mono ${
                i === suggest.index ? 'bg-indigo-600 text-white' : 'text-zinc-700 dark:text-zinc-200'
              }`}
            >
              #{tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
