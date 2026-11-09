export interface Note {
  id: string
  title: string
  content: string
  pinned: boolean
  updatedAt: number
}

export const NOTES_KEY = 'mdnotes.notes.v1'
export const THEME_KEY = 'mdnotes.theme.v1'

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function createNote(now = Date.now(), title = 'Untitled note', content = ''): Note {
  return { id: newId(), title, content, pinned: false, updatedAt: now }
}

/** Pinned first, then newest edited first. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export function matchesQuery(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q)
}

export function filterNotes(notes: Note[], query: string): Note[] {
  return notes.filter((n) => matchesQuery(n, query))
}

export interface Segment {
  text: string
  match: boolean
}

/** Split text into segments, flagging case-insensitive occurrences of query. */
export function highlightSegments(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase()
  if (!q) return [{ text, match: false }]
  const lower = text.toLowerCase()
  const out: Segment[] = []
  let i = 0
  while (i < text.length) {
    const at = lower.indexOf(q, i)
    if (at === -1) break
    if (at > i) out.push({ text: text.slice(i, at), match: false })
    out.push({ text: text.slice(at, at + q.length), match: true })
    i = at + q.length
  }
  if (i < text.length) out.push({ text: text.slice(i), match: false })
  return out.length ? out : [{ text, match: false }]
}

/** A one-line snippet of content around the first match (or the start when no query). */
export function snippet(content: string, query: string, radius = 36): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  const q = query.trim().toLowerCase()
  if (!q) return flat.slice(0, radius * 2)
  const at = flat.toLowerCase().indexOf(q)
  if (at === -1) return flat.slice(0, radius * 2)
  const start = Math.max(0, at - radius)
  const end = Math.min(flat.length, at + q.length + radius)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g)
  return m ? m.length : 0
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/

/** Line indexes of task-list items, skipping fenced code blocks. */
function taskLines(lines: string[]): number[] {
  const res: number[] = []
  let fence: string | null = null
  lines.forEach((line, i) => {
    const f = FENCE_RE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      return
    }
    if (f) {
      fence = f[1]
      return
    }
    if (TASK_RE.test(line)) res.push(i)
  })
  return res
}

/** Toggle the nth (0-based) checkbox in the Markdown source. */
export function toggleCheckbox(source: string, index: number): string {
  const lines = source.split('\n')
  const at = taskLines(lines)[index]
  if (at === undefined) return source
  lines[at] = lines[at].replace(TASK_RE, (_m, a, c, b) => a + (c === ' ' ? 'x' : ' ') + b)
  return lines.join('\n')
}

export function loadNotes(storage: Pick<Storage, 'getItem'> = localStorage): Note[] | null {
  try {
    const raw = storage.getItem(NOTES_KEY)
    if (raw === null) return null
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    return data
      .filter((n) => n && typeof n.id === 'string')
      .map((n) => ({
        id: n.id,
        title: typeof n.title === 'string' ? n.title : 'Untitled note',
        content: typeof n.content === 'string' ? n.content : '',
        pinned: !!n.pinned,
        updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : 0,
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

export const WELCOME = `# Welcome

This is a **Markdown** notes app. Edit on the left, preview on the right.

- Bullet lists, *italic*, **bold** and [links](https://example.com)
- Tick the boxes in the preview:

- [ ] Write a note
- [x] Open the app

\`\`\`js
console.log("code blocks work")
\`\`\`
`
