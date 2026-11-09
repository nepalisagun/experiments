export interface Note {
  id: string
  title: string
  content: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export const STORAGE_KEY = 'md-notes:v1'
export const THEME_KEY = 'md-notes:theme'
export const UNTITLED = 'Untitled note'

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function createNote(now = Date.now(), title = UNTITLED, content = ''): Note {
  return { id: newId(), title, content, pinned: false, createdAt: now, updatedAt: now }
}

/** Pinned first, then most recently edited first. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export function matchesQuery(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q)
}

export interface Segment {
  text: string
  match: boolean
}

/** Splits `text` into matching / non-matching segments (case-insensitive). */
export function highlight(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase()
  if (!q) return [{ text, match: false }]
  const lower = text.toLowerCase()
  const out: Segment[] = []
  let pos = 0
  for (let idx = lower.indexOf(q); idx !== -1; idx = lower.indexOf(q, pos)) {
    if (idx > pos) out.push({ text: text.slice(pos, idx), match: false })
    out.push({ text: text.slice(idx, idx + q.length), match: true })
    pos = idx + q.length
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false })
  return out
}

/** Markdown source with the syntax markers removed, for list excerpts. */
export function plainText(md: string): string {
  return md
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, '') // code fences
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s*>\s?/gm, '') // blockquotes
    .replace(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '$1') // list / task markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/(\*\*|__|~~|\*|`)/g, '') // emphasis / code markers
}

/** A one-line excerpt of the content: around the first match, or its start. */
export function snippet(content: string, query: string, radius = 40): string {
  const flat = plainText(content).replace(/\s+/g, ' ').trim()
  const q = query.trim().toLowerCase()
  const idx = q ? flat.toLowerCase().indexOf(q) : -1
  if (idx === -1) return flat.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(flat.length, idx + q.length + radius)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}

function isNote(x: unknown): x is Note {
  const n = x as Note
  return (
    !!n &&
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.content === 'string' &&
    typeof n.updatedAt === 'number'
  )
}

export function loadNotes(storage: Pick<Storage, 'getItem'>): Note[] | null {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    return data.filter(isNote).map((n) => ({
      ...n,
      pinned: !!n.pinned,
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : n.updatedAt,
    }))
  } catch {
    return null
  }
}

export function saveNotes(storage: Pick<Storage, 'setItem'>, notes: Note[]): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(notes))
    return true
  } catch {
    return false
  }
}

export const WELCOME = `# Welcome to Markdown Notes

Type Markdown in the editor and the preview updates as you go. Everything is **saved in this browser** automatically.

## What you can use

- **Bold**, *italic* and \`inline code\`
- [Links](https://example.com)
- Numbered lists:
  1. First
  2. Second

## Checklist

- [x] Open the app
- [ ] Click a checkbox in the preview
- [ ] Pin a note to keep it on top

## Tags

Write a \`#tag\` anywhere in a note and it appears in the sidebar, like this one: #welcome

\`\`\`js
console.log('code blocks work too')
\`\`\`
`
