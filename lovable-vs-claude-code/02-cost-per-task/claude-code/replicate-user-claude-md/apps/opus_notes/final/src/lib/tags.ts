// #tags written in note text.
//
// A tag is `#` + a letter, then letters, digits or `_`, optionally joined by
// `-` or `/` (#todo, #work-items, #project/alpha). It must start a word: at the
// start of a line, after whitespace, or after an opening bracket or quote.
// So `# Heading`, `#1`, `a#b`, `https://x.com/#frag` and `[x](#anchor)` are not
// tags. Text inside fenced code blocks and `inline code` never holds tags.
// Tags are case-insensitive and reported in lower case.

const BODY = String.raw`\p{L}[\p{L}\p{N}_]*(?:[-/][\p{L}\p{N}_]+)*`
const BEFORE = String.raw`(?<=^|[\s[{,;:"'*_~>]|(?<!\])\()`

export const tagRegex = () => new RegExp(`${BEFORE}#(${BODY})`, 'gu')
const VALID_RE = new RegExp(`^#?(${BODY})$`, 'u')
const PARTIAL_RE = new RegExp(`${BEFORE}#([\\p{L}\\p{N}_\\-/]*)$`, 'u')

const FENCE_RE = /^\s*(`{3,}|~{3,})/
const CODE_SPAN_RE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g

/** Applies `fn` to every stretch of text outside code blocks and code spans. */
export function mapOutsideCode(md: string, fn: (text: string) => string): string {
  let fence: string | null = null
  return md
    .split('\n')
    .map((line) => {
      if (fence) {
        if (line.trim().startsWith(fence)) fence = null
        return line
      }
      const f = FENCE_RE.exec(line)
      if (f) {
        fence = f[1]
        return line
      }
      let out = ''
      let last = 0
      for (const m of line.matchAll(CODE_SPAN_RE)) {
        out += fn(line.slice(last, m.index)) + m[0]
        last = m.index + m[0].length
      }
      return out + fn(line.slice(last))
    })
    .join('\n')
}

/** Tags in a note, lower-cased, in order of first appearance. */
export function extractTags(md: string): string[] {
  const found = new Set<string>()
  mapOutsideCode(md, (text) => {
    for (const m of text.matchAll(tagRegex())) found.add(m[1].toLowerCase())
    return text
  })
  return [...found]
}

export interface TagCount {
  tag: string
  count: number
}

/** Every tag with the number of notes that use it, alphabetical. */
export function tagCounts(contents: string[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const c of contents) for (const t of extractTags(c)) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

/** Normalises user input to a tag name (without '#'), or null if it isn't one. */
export function normalizeTag(input: string): string | null {
  const m = VALID_RE.exec(input.trim())
  return m ? m[1] : null
}

/** Replaces every `#from` (any case) outside code with `#to`. */
export function renameTag(md: string, from: string, to: string): string {
  const key = from.toLowerCase()
  return mapOutsideCode(md, (text) =>
    text.replace(tagRegex(), (m, body: string) => (body.toLowerCase() === key ? `#${to}` : m)),
  )
}

/** True if `offset` falls inside a fenced code block. */
function inFence(md: string, offset: number): boolean {
  let fence: string | null = null
  for (const line of md.slice(0, offset).split('\n').slice(0, -1)) {
    if (fence) {
      if (line.trim().startsWith(fence)) fence = null
    } else {
      const f = FENCE_RE.exec(line)
      if (f) fence = f[1]
    }
  }
  return fence !== null
}

export interface TagQuery {
  /** Index of the '#'. */
  start: number
  /** What has been typed after '#'. */
  prefix: string
}

/** If the caret sits right after a `#partial` tag being typed, returns it. */
export function tagQueryAt(md: string, caret: number): TagQuery | null {
  const lineStart = md.lastIndexOf('\n', caret - 1) + 1
  const before = md.slice(lineStart, caret)
  const m = PARTIAL_RE.exec(before)
  if (!m) return null
  // Not inside inline code: an odd number of backticks before the caret on this line.
  if ((before.slice(0, m.index).match(/`/g)?.length ?? 0) % 2 === 1) return null
  if (inFence(md, caret)) return null
  return { start: lineStart + m.index, prefix: m[1] }
}

/**
 * Existing tags to offer for `prefix`: those starting with it first, then those
 * containing it. The exact tag already typed is left out (Enter then still
 * makes a new line), and so is a tag the caller marks as the partial one.
 */
export function suggestTags(tags: string[], prefix: string, limit = 8): string[] {
  const p = prefix.toLowerCase()
  const starts = tags.filter((t) => t.startsWith(p) && t !== p)
  const contains = tags.filter((t) => !t.startsWith(p) && t.includes(p))
  return [...starts.sort(), ...contains.sort()].slice(0, limit)
}

/** The text after choosing `tag` for the query at `q` with the caret at `caret`. */
export function applyTag(
  md: string,
  q: TagQuery,
  caret: number,
  tag: string,
): { text: string; caret: number; from: number; to: number; insert: string } {
  const after = md.slice(caret)
  // Swallow the rest of a half-typed word the caret is in the middle of.
  const rest = /^[\p{L}\p{N}_\-/]*/u.exec(after)![0]
  const tail = after.slice(rest.length)
  const insert = `#${tag}` + (/^\s/.test(tail) ? '' : ' ')
  return {
    text: md.slice(0, q.start) + insert + tail,
    caret: q.start + insert.length,
    from: q.start,
    to: caret + rest.length,
    insert,
  }
}
