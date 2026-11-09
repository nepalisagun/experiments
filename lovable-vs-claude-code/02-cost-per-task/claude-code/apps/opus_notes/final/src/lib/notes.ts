export interface Note {
  id: string
  title: string
  content: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface AppState {
  notes: Note[]
  activeId: string | null
}

export const STORAGE_KEY = 'md-notes:v1'
export const THEME_KEY = 'md-notes:theme'

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createNote(now = Date.now(), title = '', content = ''): Note {
  return { id: newId(), title, content, pinned: false, createdAt: now, updatedAt: now }
}

export function displayTitle(note: Pick<Note, 'title'>): string {
  return note.title.trim() || 'Untitled'
}

/** Pinned notes first, then most recently edited first. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || b.createdAt - a.createdAt,
  )
}

/** Case-insensitive substring search over titles and contents. */
export function searchNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase()
  if (!q) return notes
  return notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
}

export interface Segment {
  text: string
  match: boolean
}

/** Split text into matching / non-matching segments for highlighting. */
export function highlight(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase()
  if (!q) return text ? [{ text, match: false }] : []
  const lower = text.toLowerCase()
  const out: Segment[] = []
  let pos = 0
  for (;;) {
    const idx = lower.indexOf(q, pos)
    if (idx === -1) break
    if (idx > pos) out.push({ text: text.slice(pos, idx), match: false })
    out.push({ text: text.slice(idx, idx + q.length), match: true })
    pos = idx + q.length
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false })
  return out
}

/** Roughly strips Markdown syntax so list previews read as plain text. */
export function plainText(md: string): string {
  return md
    .replace(/^\s*(```|~~~).*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(?=\S)(.*?\S)\1/g, '$2')
    .replace(/(^|\W)[*_](?=\S)([^*_]*?\S)[*_](?=\W|$)/g, '$1$2')
}

/**
 * A one-line preview of the note body. With a query, it is centred on the
 * first match so the highlight is visible; otherwise it is the opening text.
 */
export function snippet(content: string, query = '', radius = 40): string {
  const flat = plainText(content).replace(/\s+/g, ' ').trim()
  const q = query.trim().toLowerCase()
  const idx = q ? flat.toLowerCase().indexOf(q) : -1
  if (idx === -1) return flat.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(flat.length, idx + q.length + radius)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}

/** Counts words in the Markdown source, ignoring syntax and link URLs. */
export function wordCount(md: string): number {
  const text = md
    .replace(/^\s*(```|~~~).*$/gm, ' ') // fence lines
    .replace(/\]\([^)]*\)/g, ']') // link targets
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/gm, ' ') // task markers
  const words = text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)
  return words ? words.length : 0
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

function isNote(v: unknown): v is Note {
  if (!v || typeof v !== 'object') return false
  const n = v as Record<string, unknown>
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.content === 'string' &&
    typeof n.updatedAt === 'number'
  )
}

/** Loads saved state. Returns null when nothing has been saved yet. */
export function loadState(storage: Pick<Storage, 'getItem'>): AppState | null {
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (raw == null) return null
  try {
    const data = JSON.parse(raw) as { notes?: unknown; activeId?: unknown }
    const notes = Array.isArray(data.notes)
      ? data.notes.filter(isNote).map((n) => ({
          ...n,
          pinned: Boolean(n.pinned),
          createdAt: typeof n.createdAt === 'number' ? n.createdAt : n.updatedAt,
        }))
      : []
    const activeId =
      typeof data.activeId === 'string' && notes.some((n) => n.id === data.activeId) ? data.activeId : null
    return { notes, activeId }
  } catch {
    return { notes: [], activeId: null }
  }
}

export function saveState(storage: Pick<Storage, 'setItem'>, state: AppState): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export const WELCOME_NOTE = `# Welcome to Notes

Write **Markdown** in the editor and see the *live preview* update as you type.

## Things to try

- [x] Open this note
- [ ] Click a checkbox in the preview
- [ ] Pin a note with the pin button
- [ ] Search with the box above the list

1. Numbered lists
2. [Links](https://example.com)
3. \`inline code\`

\`\`\`js
console.log('code blocks too')
\`\`\`

Tag notes by writing \`#tag\` anywhere in the text, like #welcome.

Everything is saved in this browser automatically.
`
