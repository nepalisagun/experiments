/**
 * Tags are `#words` written anywhere in a note's text.
 *
 * Rules:
 * - A tag is `#` followed by letters, digits, `_`, and internal `-`
 *   (`#to-do`, `#q3_goals`). Purely numeric names (`#1`) are not tags.
 * - The `#` must not be glued to a preceding word/URL character, so `C#`,
 *   `page#anchor`, `https://x.com/#top` and `&#39;` are not tags.
 * - `# Heading` (hash + space) is a heading, not a tag.
 * - Text inside inline code, fenced code blocks, link targets and bare URLs
 *   is ignored.
 * - Tags are case-insensitive and reported in lowercase.
 */

const NAME = String.raw`[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*`
/** Characters that may not directly precede the `#` of a tag. */
const BEFORE = String.raw`(?<![\p{L}\p{N}_&/#\\-])`

/** Matches `#name`; group 1 is the name. Global — reset lastIndex or use matchAll. */
export const TAG_RE = new RegExp(`${BEFORE}#(${NAME})`, 'gu')
const TAG_CHAR = /[\p{L}\p{N}_-]/u
const VALID_NAME = new RegExp(`^${NAME}$`, 'u')

export function isValidTagName(name: string): boolean {
  return VALID_NAME.test(name) && !/^[\p{N}_-]+$/u.test(name)
}

/** Cleans user input ("#Work ") into a tag name ("work"), or null if invalid. */
export function normalizeTag(input: string): string | null {
  const name = input.trim().replace(/^#+/, '').toLowerCase()
  return isValidTagName(name) ? name : null
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const INLINE_CODE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g
const LINK_TARGET = /\]\([^)]*\)/g
const BARE_URL = /\bhttps?:\/\/\S+/g

/**
 * Returns a copy of the Markdown with code, link targets and URLs replaced by
 * spaces. Same length as the input, so indices map 1:1 to the source.
 */
export function codeMask(md: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  let fence: string | null = null
  return md
    .split('\n')
    .map((line) => {
      if (fence) {
        if (new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(line)) fence = null
        return blank(line)
      }
      const open = FENCE_OPEN.exec(line)
      if (open) {
        fence = open[1]
        return blank(line)
      }
      return line
        .replace(INLINE_CODE, blank)
        .replace(LINK_TARGET, (m) => ']' + blank(m.slice(1)))
        .replace(BARE_URL, blank)
    })
    .join('\n')
}

interface TagMatch {
  /** index of the `#` */
  index: number
  name: string
}

function findTags(md: string): TagMatch[] {
  const out: TagMatch[] = []
  for (const m of codeMask(md).matchAll(TAG_RE)) {
    if (isValidTagName(m[1])) out.push({ index: m.index, name: m[1] })
  }
  return out
}

/** Unique lowercase tags in order of first appearance. */
export function extractTags(md: string): string[] {
  return [...new Set(findTags(md).map((t) => t.name.toLowerCase()))]
}

export interface TagCount {
  tag: string
  count: number
}

/** Every tag with the number of notes that use it, alphabetically. */
export function countTags(contents: string[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const c of contents) for (const t of extractTags(c)) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

export function hasTag(md: string, tag: string): boolean {
  return extractTags(md).includes(tag.toLowerCase())
}

/**
 * Renames every occurrence of `#from` to `#to` (case-insensitive, whole tag
 * only — `#work` does not touch `#workshop` or `#work-items`).
 * Returns the input unchanged if `to` is invalid or nothing matched.
 */
export function renameTag(md: string, from: string, to: string): string {
  const source = from.toLowerCase()
  const target = normalizeTag(to)
  if (!target) return md
  let out = ''
  let pos = 0
  for (const t of findTags(md)) {
    if (t.name.toLowerCase() !== source) continue
    out += md.slice(pos, t.index) + '#' + target
    pos = t.index + 1 + t.name.length
  }
  return pos === 0 ? md : out + md.slice(pos)
}

export interface TagQuery {
  /** index of the `#` */
  start: number
  /** end of the tag word (may extend past the caret) */
  end: number
  /** what has been typed between `#` and the caret */
  query: string
}

/**
 * If the caret is in a `#partial` tag being typed, describes it so tags can
 * be suggested; otherwise null (including inside code).
 */
export function tagQueryAt(text: string, caret: number): TagQuery | null {
  let i = caret
  while (i > 0 && TAG_CHAR.test(text[i - 1])) i--
  const hash = i - 1
  if (hash < 0 || text[hash] !== '#') return null
  if (hash > 0 && /[\p{L}\p{N}_&/#\\-]/u.test(text[hash - 1])) return null
  if (codeMask(text)[hash] !== '#') return null
  // An inline code span still being typed (opening backtick, no closing one yet).
  const lineBefore = text.slice(text.lastIndexOf('\n', hash - 1) + 1, hash)
  if ((lineBefore.match(/`/g) ?? []).length % 2 === 1) return null
  let end = caret
  while (end < text.length && TAG_CHAR.test(text[end])) end++
  return { start: hash, end, query: text.slice(hash + 1, caret) }
}

/** Tags matching the typed text: prefix matches first, then substring matches. */
export function suggestTags(tags: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase()
  const prefix = tags.filter((t) => t.startsWith(q))
  const inner = tags.filter((t) => !t.startsWith(q) && t.includes(q))
  return [...prefix.sort(), ...inner.sort()].slice(0, limit)
}

/** Replaces the tag being typed with `#tag` and returns the new text and caret. */
export function applySuggestion(text: string, q: TagQuery, tag: string): { text: string; caret: number } {
  const before = text.slice(0, q.start) + '#' + tag
  const after = text.slice(q.end)
  if (after === '' || !/^\s/.test(after)) {
    return { text: before + ' ' + after, caret: before.length + 1 }
  }
  return { text: before + after, caret: before.length }
}
