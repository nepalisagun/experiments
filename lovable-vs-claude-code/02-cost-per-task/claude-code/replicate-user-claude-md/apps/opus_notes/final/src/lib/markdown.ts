import { tagRegex } from './tags'

// A small Markdown renderer. Safety comes from construction: every piece of
// note text is HTML-escaped before any tag is emitted, so raw HTML in a note
// is shown as text and can never run. Link URLs are limited to safe schemes.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Returns a safe href, or null if the URL uses a scheme we don't allow. */
export function safeUrl(raw: string): string | null {
  const url = raw.trim()
  // Strip characters browsers ignore inside schemes ("java\tscript:").
  // eslint-disable-next-line no-control-regex
  const probe =url.replace(/[\u0000- \u007f]/g, '').toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(probe)
  if (scheme && !['http', 'https', 'mailto'].includes(scheme[1])) return null
  return url
}

const PH = '\u0000' // placeholder marker; stripped from input first

export function renderInline(text: string): string {
  const slots: string[] = []
  const stash = (html: string) => `${PH}${slots.push(html) - 1}${PH}`
  let s = text.replace(new RegExp(PH, 'g'), '')

  // Code spans first, so their contents are not formatted.
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, code: string) =>
    stash(`<code>${escapeHtml(code.trim() === '' ? code : code.replace(/^ (.*) $/, '$1'))}</code>`),
  )

  // Links: [text](url "optional title")
  s = s.replace(/\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+"([^"]*)")?\s*\)/g, (m, label: string, url: string, title?: string) => {
    const href = safeUrl(url)
    if (href === null) return stash(renderEmphasis(escapeHtml(label)))
    if (!url) return m
    const t = title ? ` title="${escapeHtml(title)}"` : ''
    return stash(
      `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${renderEmphasis(escapeHtml(label))}</a>`,
    )
  })

  // Bare autolinks
  s = s.replace(/\bhttps?:\/\/[^\s<]*[^\s<.,:;"')\]!?]/g, (url) =>
    stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`),
  )

  // #tags → clickable chips (tag bodies are letters, digits, _ - / only)
  s = s.replace(tagRegex(), (_, body: string) =>
    stash(`<button type="button" class="tag" data-tag="${escapeHtml(body.toLowerCase())}">#${escapeHtml(body)}</button>`),
  )

  s = renderEmphasis(escapeHtml(s))
  return s.replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_, i: string) => slots[Number(i)])
}

/** Bold / italic / strikethrough on already-escaped text. */
function renderEmphasis(s: string): string {
  return s
    .replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '<strong><em>$2</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/\*(?=\S)([^*]*?\S)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TASK_RE = /^\[([ xX])\](?:\s+|$)(.*)$/
const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/

interface ListItem {
  indent: number
  ordered: boolean
  text: string
  line: number
  children: ListItem[]
}

function renderList(items: ListItem[]): string {
  if (items.length === 0) return ''
  const ordered = items[0].ordered
  const hasTask = items.some((i) => TASK_RE.test(i.text))
  const tag = ordered ? 'ol' : 'ul'
  let html = `<${tag}${hasTask ? ' class="task-list"' : ''}>`
  for (const it of items) {
    const task = TASK_RE.exec(it.text)
    if (task) {
      const checked = task[1] !== ' '
      html +=
        `<li class="task-item"><label><input type="checkbox" data-line="${it.line}"${checked ? ' checked' : ''}> ` +
        `<span>${renderInline(task[2])}</span></label>`
    } else {
      html += `<li>${renderInline(it.text)}`
    }
    html += renderList(it.children) + '</li>'
  }
  return html + `</${tag}>`
}

function nestItems(flat: ListItem[]): ListItem[] {
  const root: ListItem[] = []
  const stack: ListItem[] = []
  for (const it of flat) {
    while (stack.length && stack[stack.length - 1].indent >= it.indent) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(it)
    else root.push(it)
    stack.push(it)
  }
  return root
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    // Fenced code block
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const marker = fence[1]
      const lang = fence[2]
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++])
      i++ // closing fence (or end of input)
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    // Heading
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      const n = h[1].length
      out.push(`<h${n}>${renderInline(h[2])}</h${n}>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>')
      i++
      continue
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`)
      continue
    }

    // List (consecutive list lines; indented continuation lines join the item)
    if (LIST_RE.test(line)) {
      const flat: ListItem[] = []
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i])
        if (m) {
          const ordered = /\d/.test(m[2])
          // A switch between bullet and numbered at the top level starts a new list.
          if (flat.length && m[1].length <= flat[0].indent && ordered !== flat[0].ordered) break
          flat.push({ indent: m[1].length, ordered, text: m[3], line: i, children: [] })
          i++
        } else if (flat.length && lines[i].trim() !== '' && /^\s+/.test(lines[i])) {
          flat[flat.length - 1].text += ' ' + lines[i].trim()
          i++
        } else break
      }
      out.push(renderList(nestItems(flat)))
      continue
    }

    // Paragraph
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE_RE.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !LIST_RE.test(lines[i])
    ) {
      para.push(lines[i++])
    }
    out.push(`<p>${para.map((l) => renderInline(l.trim())).join('<br>')}</p>`)
  }

  return out.join('\n')
}

/** Flip the checkbox of the task item on source line `lineIndex`. */
export function toggleTask(src: string, lineIndex: number): string {
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const lines = src.split(/\r?\n/)
  const line = lines[lineIndex]
  if (line === undefined) return src
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(line)
  if (!m) return src
  lines[lineIndex] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3]
  return lines.join(eol)
}

export function countWords(src: string): number {
  const text = src
    .replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/gm, '$1') // task markers
    .replace(/\]\([^)]*\)/g, ']') // link URLs
  return (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length
}
