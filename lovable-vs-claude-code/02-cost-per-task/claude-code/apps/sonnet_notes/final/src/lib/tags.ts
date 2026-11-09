// Tags are #words written anywhere in a note's text (outside code and link targets).
// Names are case-insensitive and stored lowercase.

import type { Note } from './notes'

const NAME_RE = /^[\p{L}\p{N}_]+(?:[-/][\p{L}\p{N}_]+)*$/u
// A '#' that is not glued to a preceding word char, '&' (entities), '#', or '/' (URL fragments).
const TAG_RE = /(?<![\p{L}\p{N}_&#/])#([\p{L}\p{N}_]+(?:[-/][\p{L}\p{N}_]+)*)/gu
const TRIGGER_RE = /(?<![\p{L}\p{N}_&#/])#([\p{L}\p{N}_/-]*)$/u

const blank = (s: string) => s.replace(/[^\n]/g, ' ')

/** Replace code blocks, inline code and link targets by spaces, keeping every index. */
export function maskCode(text: string): string {
  let fence: string | null = null
  return text
    .split('\n')
    .map((line) => {
      const m = /^\s*(```+|~~~+)/.exec(line)
      if (fence) {
        if (m && m[1].startsWith(fence)) fence = null
        return blank(line)
      }
      if (m) { fence = m[1]; return blank(line) }
      return line
        .replace(/`[^`]*`/g, blank)
        .replace(/\]\([^)]*\)/g, blank)
    })
    .join('\n')
}

export interface TagMatch { name: string; start: number; end: number }

export function findTags(content: string): TagMatch[] {
  const out: TagMatch[] = []
  for (const m of maskCode(content).matchAll(TAG_RE)) {
    if (/^\d+$/.test(m[1])) continue // "#1" is not a tag
    out.push({ name: m[1].toLowerCase(), start: m.index, end: m.index + m[0].length })
  }
  return out
}

export function extractTags(content: string): string[] {
  return [...new Set(findTags(content).map((t) => t.name))]
}

export interface TagCount { name: string; count: number }

/** Every tag across notes with the number of notes using it, sorted by name. */
export function tagCounts(notes: Pick<Note, 'content'>[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const n of notes) for (const t of extractTags(n.content)) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function filterByTag<T extends Pick<Note, 'content'>>(notes: T[], tag: string | null): T[] {
  return tag ? notes.filter((n) => extractTags(n.content).includes(tag)) : notes
}

/** Normalise user input ("#Work ") to a valid tag name, or null if invalid. */
export function normalizeTagName(input: string): string | null {
  const t = input.trim().replace(/^#/, '').toLowerCase()
  return NAME_RE.test(t) && !/^\d+$/.test(t) ? t : null
}

/** Rewrite every occurrence of tag `from` as `to` in the text. */
export function renameTag(content: string, from: string, to: string): string {
  let out = content
  for (const m of findTags(content).filter((t) => t.name === from).reverse()) {
    out = out.slice(0, m.start) + '#' + to + out.slice(m.end)
  }
  return out
}

export interface TagTrigger { start: number; query: string }

/** If the caret is right after "#partial", describe it (start = index of '#'). */
export function getTagTrigger(text: string, caret: number): TagTrigger | null {
  let masked = maskCode(text.slice(0, caret))
  // an unclosed backtick means the caret is inside an inline code span being typed
  const open = masked.lastIndexOf('`')
  if (open >= 0 && !masked.slice(open).includes('\n')) masked = masked.slice(0, open) + blank(masked.slice(open))
  const m = TRIGGER_RE.exec(masked)
  if (!m) return null
  return { start: m.index, query: text.slice(m.index + 1, caret).toLowerCase() }
}

export function suggestTags(all: string[], query: string, limit = 8): string[] {
  return all.filter((t) => t.startsWith(query) && t !== query).slice(0, limit)
}

/** Replace the "#partial" before the caret with the chosen tag plus a space. */
export function applySuggestion(text: string, trigger: TagTrigger, caret: number, tag: string) {
  const insert = `#${tag} `
  return { text: text.slice(0, trigger.start) + insert + text.slice(caret), caret: trigger.start + insert.length }
}
