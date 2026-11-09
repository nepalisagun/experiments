import { useId, useRef, useState } from 'react'
import { caretCoordinates } from '../lib/caret'
import { applyTag, extractTags, suggestTags, tagQueryAt, type TagQuery } from '../lib/tags'

interface Suggest {
  q: TagQuery
  caret: number
  items: string[]
  index: number
  top: number
  left: number
  lineHeight: number
}

const POPUP_W = 208
const POPUP_MAX_H = 200

/** Markdown textarea that suggests existing tags while a #tag is being typed. */
export function MarkdownEditor({
  value,
  onChange,
  otherTags,
  onTyping,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  /** Tags used by the other notes. */
  otherTags: string[]
  /** The range of a #tag still being typed at the caret, or null. */
  onTyping?: (range: { from: number; to: number } | null) => void
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [ac, setAc] = useState<Suggest | null>(null)
  // The '#' position the user dismissed (Escape) or just completed; stays closed until the caret leaves it.
  const quiet = useRef<number | null>(null)
  const listId = useId()

  const refresh = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart
    const q = el.selectionEnd === caret ? tagQueryAt(el.value, caret) : null
    onTyping?.(q ? { from: q.start, to: caret } : null)
    if (!q || quiet.current !== q.start) quiet.current = null
    if (!q || quiet.current === q.start) return setAc(null)
    // This note's own tags, minus the half-typed one.
    const own = extractTags(el.value.slice(0, q.start) + ' ' + el.value.slice(caret))
    const items = suggestTags([...new Set([...otherTags, ...own])], q.prefix)
    if (items.length === 0) return setAc(null)
    const c = caretCoordinates(el, q.start)
    setAc((prev) => ({
      q,
      caret,
      items,
      index: prev && prev.q.start === q.start && prev.q.prefix === q.prefix ? Math.min(prev.index, items.length - 1) : 0,
      top: c.top,
      left: c.left,
      lineHeight: c.height,
    }))
  }

  const choose = (tag: string) => {
    const el = ref.current
    if (!el || !ac) return
    const r = applyTag(el.value, ac.q, ac.caret, tag)
    quiet.current = r.from
    setAc(null)
    el.focus()
    el.setSelectionRange(r.from, r.to)
    // insertText keeps the browser's undo history; fall back to setting the value.
    const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, r.insert)
    if (!ok || el.value !== r.text) {
      onChange(r.text)
      requestAnimationFrame(() => el.setSelectionRange(r.caret, r.caret))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!ac) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : -1
      setAc({ ...ac, index: (ac.index + d + ac.items.length) % ac.items.length })
    } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      choose(ac.items[ac.index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      quiet.current = ac.q.start
      setAc(null)
    }
  }

  // Place the list under the '#', or above it when there is no room below.
  let style: React.CSSProperties = {}
  if (ac && wrapRef.current) {
    const w = wrapRef.current.clientWidth
    const h = wrapRef.current.clientHeight
    const left = Math.max(8, Math.min(ac.left, w - POPUP_W - 8))
    const below = ac.top + ac.lineHeight + 2
    style =
      below + Math.min(POPUP_MAX_H, ac.items.length * 34 + 8) > h && ac.top > h / 2
        ? { left, bottom: h - ac.top + 2 }
        : { left, top: below }
  }

  const activeId = ac ? `${listId}-${ac.index}` : undefined

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          refresh(e.target)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key))
            refresh(e.currentTarget)
        }}
        onClick={(e) => refresh(e.currentTarget)}
        onBlur={() => {
          setAc(null)
          onTyping?.(null)
        }}
        onScroll={(e) => ac && refresh(e.currentTarget)}
        aria-label="Markdown source"
        placeholder="Write Markdown here…  Type # to add a tag."
        spellCheck
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={!!ac}
        aria-controls={listId}
        aria-activedescendant={activeId}
        className="block h-full w-full resize-none bg-(--bg) p-4 font-mono text-sm leading-relaxed outline-none"
      />
      {ac && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Tag suggestions"
          style={{ ...style, width: POPUP_W, maxHeight: POPUP_MAX_H }}
          className="absolute z-20 overflow-y-auto rounded-lg border border-(--line) bg-(--panel) p-1 text-sm shadow-lg"
        >
          {ac.items.map((t, i) => (
            <li
              key={t}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === ac.index}
              // Keep focus (and the caret) in the textarea.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setAc({ ...ac, index: i })}
              onClick={() => choose(t)}
              className={`cursor-pointer truncate rounded-md px-2 py-1.5 ${i === ac.index ? 'bg-(--active)' : ''}`}
            >
              #{t}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
