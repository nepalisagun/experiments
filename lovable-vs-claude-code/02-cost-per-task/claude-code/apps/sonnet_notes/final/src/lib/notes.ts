export interface Note {
  id: string
  title: string
  content: string
  updatedAt: number
  pinned: boolean
}

export const NOTES_KEY = 'md-notes:v1'
export const THEME_KEY = 'md-notes:theme'
export const SELECTED_KEY = 'md-notes:selected'

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function createNote(now = Date.now()): Note {
  return { id: newId(), title: 'Untitled note', content: '', updatedAt: now, pinned: false }
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export function filterNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase()
  if (!q) return notes
  return notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
}

export interface Segment { text: string; match: boolean }

export function highlight(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase()
  if (!q || !text) return [{ text, match: false }]
  const lower = text.toLowerCase()
  const out: Segment[] = []
  let pos = 0
  for (;;) {
    const idx = lower.indexOf(q, pos)
    if (idx < 0) break
    if (idx > pos) out.push({ text: text.slice(pos, idx), match: false })
    out.push({ text: text.slice(idx, idx + q.length), match: true })
    pos = idx + q.length
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false })
  return out
}

/** A one-line snippet of content: around the first match when searching, else the start. */
export function snippet(content: string, query: string, max = 70): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  const q = query.trim().toLowerCase()
  const idx = q ? flat.toLowerCase().indexOf(q) : -1
  if (idx < 0) return flat.slice(0, max)
  const start = Math.max(0, idx - 20)
  return (start > 0 ? '…' : '') + flat.slice(start, start + max)
}

export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

export function loadNotes(storage: Pick<Storage, 'getItem'> = localStorage): Note[] | null {
  try {
    const raw = storage.getItem(NOTES_KEY)
    if (!raw) return null
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    return data
      .filter((n): n is Note => !!n && typeof n.id === 'string' && typeof n.content === 'string')
      .map((n) => ({
        id: n.id,
        title: typeof n.title === 'string' ? n.title : 'Untitled note',
        content: n.content,
        updatedAt: Number(n.updatedAt) || 0,
        pinned: !!n.pinned,
      }))
  } catch {
    return null
  }
}

export function saveNotes(notes: Note[], storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    storage.setItem(NOTES_KEY, JSON.stringify(notes))
    return true
  } catch {
    return false
  }
}

export const WELCOME = [
  '# Welcome to Notes',
  '',
  'Write **Markdown** on the left, see it *rendered* on the right.',
  '',
  '- [x] Create a note',
  '- [ ] Click this checkbox in the preview',
  '- [ ] Pin your favourites',
  '',
  '## Code',
  '',
  '```js',
  'console.log("hello")',
  '```',
  '',
  'Read the [Markdown guide](https://commonmark.org/help/).',
  '',
].join('\n')
