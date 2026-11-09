import type { Note } from './notes'

/** Characters allowed inside a tag name. */
const TAG_CHARS = '[\\p{L}\\p{N}_-]'
/** `#tag`, not preceded by a word char, `#`, `&` or `/` (so URLs, anchors and entities are ignored). */
const TAG_RE = new RegExp(`(^|[^\\p{L}\\p{N}_#&/])#(${TAG_CHARS}+)`, 'gu')
const TOKEN_RE = new RegExp(`(^|[^\\p{L}\\p{N}_#&/])#(${TAG_CHARS}*)$`, 'u')
const NAME_RE = new RegExp(`^${TAG_CHARS}+$`, 'u')
const HAS_LETTER = /\p{L}/u

/** Replace code (fenced blocks and inline spans) with spaces, keeping offsets and newlines. */
export function maskCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  let fence: string | null = null
  const lines = text.split('\n').map((line) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      return blank(line)
    }
    if (f) {
      fence = f[1]
      return blank(line)
    }
    return line.replace(/`[^`\n]*`/g, blank)
  })
  return lines.join('\n')
}

interface Occurrence {
  /** offset of the name (after the #) */
  start: number
  name: string
}

function occurrences(text: string): Occurrence[] {
  const masked = maskCode(text)
  const out: Occurrence[] = []
  for (const m of masked.matchAll(TAG_RE)) {
    const name = m[2]
    if (!HAS_LETTER.test(name)) continue // "#123" is not a tag
    out.push({ start: m.index! + m[1].length + 1, name })
  }
  return out
}

/** Unique tags (lower-case, no #) in a text, in order of first appearance. */
export function extractTags(text: string): string[] {
  const seen = new Set<string>()
  for (const o of occurrences(text)) seen.add(o.name.toLowerCase())
  return [...seen]
}

export interface TagCount {
  tag: string
  count: number
}

/** All tags across notes with the number of notes each appears in, sorted by name. */
export function tagCounts(notes: Pick<Note, 'content'>[]): TagCount[] {
  const map = new Map<string, number>()
  for (const n of notes) for (const t of extractTags(n.content)) map.set(t, (map.get(t) ?? 0) + 1)
  return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag))
}

export function filterByTag<T extends Pick<Note, 'content'>>(notes: T[], tag: string | null): T[] {
  if (!tag) return notes
  return notes.filter((n) => extractTags(n.content).includes(tag))
}

/** A valid tag name (without #), lower-cased, or null. */
export function normalizeTagName(raw: string): string | null {
  const s = raw.trim().replace(/^#/, '')
  if (!NAME_RE.test(s) || !HAS_LETTER.test(s)) return null
  return s.toLowerCase()
}

/** Rename every occurrence of tag `from` (case-insensitive) to `to` in the text. */
export function renameTagInText(text: string, from: string, to: string): string {
  const f = from.toLowerCase()
  let out = text
  const hits = occurrences(text).filter((o) => o.name.toLowerCase() === f)
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    out = out.slice(0, h.start) + to + out.slice(h.start + h.name.length)
  }
  return out
}

export interface TagToken {
  /** offset of the `#` */
  start: number
  prefix: string
}

/** The `#prefix` being typed immediately before the caret, if any. */
export function activeTagToken(text: string, caret: number): TagToken | null {
  const before = maskCode(text.slice(0, caret))
  const m = TOKEN_RE.exec(before)
  if (!m) return null
  return { start: caret - m[2].length - 1, prefix: m[2] }
}

/** Tags starting with the prefix (case-insensitive), most used first. */
export function suggestTags(prefix: string, tags: TagCount[], limit = 8): string[] {
  const p = prefix.toLowerCase()
  return tags
    .filter((t) => t.tag.startsWith(p))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit)
    .map((t) => t.tag)
}

/** Replace the `#prefix` token (and any tag characters directly after the caret) with `#tag`. */
export function applySuggestion(text: string, caret: number, token: TagToken, tag: string): { text: string; caret: number } {
  const rest = text.slice(caret)
  const tail = new RegExp(`^${TAG_CHARS}*`, 'u').exec(rest)![0]
  const after = rest.slice(tail.length)
  const space = after === '' || !/^\s/.test(after) ? ' ' : ''
  const head = text.slice(0, token.start) + '#' + tag + space
  return { text: head + after, caret: head.length }
}
