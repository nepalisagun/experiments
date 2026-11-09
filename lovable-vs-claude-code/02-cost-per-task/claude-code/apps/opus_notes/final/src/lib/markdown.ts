/* oxlint-disable no-control-regex -- \u0000 is used deliberately as a placeholder delimiter */
/**
 * A small, dependency-free Markdown renderer.
 *
 * Safety model: every piece of user text is HTML-escaped before it reaches the
 * output, and the only tags emitted are the ones this file writes itself. Raw
 * HTML in a note is therefore shown as text and can never run scripts. Link
 * URLs are restricted to safe schemes (http, https, mailto, tel) or relative
 * paths, so `javascript:` links are dropped.
 *
 * Task-list checkboxes carry a `data-line` attribute with the zero-based source
 * line they came from, so the UI can toggle them in the Markdown source.
 */

import { TAG_RE, isValidTagName } from './tags'

interface Line {
  text: string
  /** zero-based line index in the original source */
  n: number
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

/** Returns the URL if it is safe to put in an href, otherwise null. */
export function safeUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  // Browsers ignore control characters and whitespace when parsing a scheme,
  // so strip them before checking (e.g. "java\tscript:").
  const probe = url.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(probe)
  if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme[1])) return null
  return url
}

const TOKEN = /\u0000(\d+)\u0000/g

/** Render inline Markdown (code, links, bold, italic, strikethrough) to HTML. */
export function renderInline(input: string): string {
  const tokens: { html: string; raw: string }[] = []
  const stash = (html: string, raw: string) => `\u0000${tokens.push({ html, raw }) - 1}\u0000`
  const unstashRaw = (s: string) => s.replace(TOKEN, (_, i) => tokens[+i].raw)

  let text = input.replace(/\u0000/g, '')

  // 1. Code spans: content is literal.
  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, _ticks, code: string) => {
    const body = code.length > 2 && code.startsWith(' ') && code.endsWith(' ') ? code.slice(1, -1) : code
    return stash(`<code>${escapeHtml(body)}</code>`, m)
  })

  // 2. Backslash escapes.
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, (_, ch: string) => stash(escapeHtml(ch), ch))

  // 3. Links: [text](url "title")
  text = text.replace(
    /\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+"([^"]*)")?\s*\)/g,
    (_m, label: string, href: string, title: string | undefined) => {
      const url = safeUrl(unstashRaw(href))
      const inner = renderEmphasis(escapeHtml(label))
      if (!url) return stash(inner, inner)
      const titleAttr = title ? ` title="${escapeHtml(unstashRaw(title))}"` : ''
      return stash(
        `<a href="${escapeHtml(url)}"${titleAttr} target="_blank" rel="noopener noreferrer">${inner}</a>`,
        label,
      )
    },
  )

  // 4. Bare URLs.
  text = text.replace(/\bhttps?:\/\/[^\s<>\u0000]*[^\s<>\u0000.,:;"')\]!?*_~]/g, (url) =>
    stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`, url),
  )

  // 5. #tags become buttons that filter the note list.
  text = text.replace(TAG_RE, (m, name: string) =>
    isValidTagName(name)
      ? stash(
          `<button type="button" class="md-tag" data-tag="${escapeHtml(name.toLowerCase())}">#${escapeHtml(name)}</button>`,
          m,
        )
      : m,
  )

  // 6. Escape everything that is left, then apply emphasis.
  let html = renderEmphasis(escapeHtml(text))

  // 7. Restore stashed fragments (they may nest).
  while (TOKEN.test(html)) {
    TOKEN.lastIndex = 0
    html = html.replace(TOKEN, (_, i) => tokens[+i].html)
  }
  TOKEN.lastIndex = 0
  return html
}

/** Applies bold / italic / strikethrough to already-escaped text. */
function renderEmphasis(s: string): string {
  return s
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*)|\s*$)/
const TASK = /^\[([ xX])\](?:\s+([\s\S]*)|$)/

const expandTabs = (s: string) => s.replace(/\t/g, '    ')
const indentOf = (s: string) => /^ */.exec(s)![0].length
const isBlank = (s: string) => /^\s*$/.test(s)

function startsBlock(text: string): boolean {
  return FENCE.test(text) || HEADING.test(text) || HR.test(text) || QUOTE.test(text) || LIST_ITEM.test(text)
}

function renderBlocks(lines: Line[]): string {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const { text } = lines[i]

    if (isBlank(text)) {
      i++
      continue
    }

    const fence = FENCE.exec(text)
    if (fence) {
      const marker = fence[1]
      const lang = fence[2]
      const body: string[] = []
      i++
      while (i < lines.length) {
        const t = lines[i].text
        if (new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(t)) {
          i++
          break
        }
        body.push(t)
        i++
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    const heading = HEADING.exec(text)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
      i++
      continue
    }

    if (HR.test(text)) {
      out.push('<hr>')
      i++
      continue
    }

    if (QUOTE.test(text)) {
      const inner: Line[] = []
      while (i < lines.length && !isBlank(lines[i].text)) {
        const q = QUOTE.exec(lines[i].text)
        inner.push({ text: q ? q[1] : lines[i].text, n: lines[i].n })
        i++
      }
      out.push(`<blockquote>${renderBlocks(inner)}</blockquote>`)
      continue
    }

    if (LIST_ITEM.test(text)) {
      const [html, next] = renderList(lines, i, indentOf(text))
      out.push(html)
      i = next
      continue
    }

    // Paragraph: consecutive lines until a blank line or another block.
    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i].text) && (para.length === 0 || !startsBlock(lines[i].text))) {
      para.push(lines[i].text.trim())
      i++
    }
    out.push(`<p>${renderInline(para.join('\n')).replace(/\n/g, '<br>')}</p>`)
  }
  return out.join('\n')
}

interface Item {
  line: number
  text: string[]
  children: string[]
}

function renderList(lines: Line[], start: number, baseIndent: number): [string, number] {
  const first = LIST_ITEM.exec(lines[start].text)!
  const ordered = /\d/.test(first[2])
  const startNum = ordered ? parseInt(first[2], 10) : 1
  const items: Item[] = []
  let i = start

  while (i < lines.length) {
    const { text, n } = lines[i]

    if (isBlank(text)) {
      // A blank line only continues the list if the next content is part of it.
      let j = i + 1
      while (j < lines.length && isBlank(lines[j].text)) j++
      if (j < lines.length && indentOf(lines[j].text) >= baseIndent && LIST_ITEM.test(lines[j].text)) {
        i = j
        continue
      }
      break
    }

    const indent = indentOf(text)
    const m = LIST_ITEM.exec(text)

    if (m && indent < baseIndent) break

    if (m && indent < baseIndent + 2) {
      if (/\d/.test(m[2]) !== ordered) break
      items.push({ line: n, text: [m[3] ?? ''], children: [] })
      i++
      continue
    }

    const current = items[items.length - 1]
    if (!current) break

    if (m) {
      const [html, next] = renderList(lines, i, indent)
      current.children.push(html)
      i = next
      continue
    }

    if (indent > baseIndent || !startsBlock(text)) {
      // Continuation of the current item's text.
      current.text.push(text.trim())
      i++
      continue
    }
    break
  }

  const tag = ordered ? 'ol' : 'ul'
  const isTaskList = items.some((it) => TASK.test(it.text[0]))
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : ''
  const body = items
    .map((it) => {
      const task = TASK.exec(it.text[0])
      const children = it.children.join('')
      if (task) {
        const checked = task[1] !== ' '
        const rest = [task[2] ?? '', ...it.text.slice(1)].join('\n')
        const label = renderInline(rest).replace(/\n/g, '<br>')
        return (
          `<li class="task-item${checked ? ' done' : ''}"><label>` +
          `<input type="checkbox" data-line="${it.line}"${checked ? ' checked' : ''}> ` +
          `<span>${label}</span></label>${children}</li>`
        )
      }
      return `<li>${renderInline(it.text.join('\n')).replace(/\n/g, '<br>')}${children}</li>`
    })
    .join('')
  const cls = isTaskList ? ' class="task-list"' : ''
  return [`<${tag}${cls}${startAttr}>${body}</${tag}>`, i]
}

/** Render a Markdown document to a safe HTML string. */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n').map((text, n) => ({ text: expandTabs(text), n }))
  return renderBlocks(lines)
}

const TASK_SOURCE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\])/

/**
 * Toggle the task-list checkbox on the given zero-based source line.
 * Returns the source unchanged if that line is not a task item.
 */
export function toggleTask(src: string, line: number): string {
  const lines = src.split('\n')
  if (line < 0 || line >= lines.length) return src
  const m = TASK_SOURCE.exec(lines[line])
  if (!m) return src
  const next = m[2] === ' ' ? 'x' : ' '
  lines[line] = m[1] + next + m[3] + lines[line].slice(m[0].length)
  return lines.join('\n')
}
