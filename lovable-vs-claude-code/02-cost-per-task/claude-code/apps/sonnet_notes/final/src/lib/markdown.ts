// Minimal, safe Markdown renderer. All source text is HTML-escaped first, so raw
// HTML in a note is displayed as text and can never execute.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Allow only http(s), mailto and relative/anchor URLs. Input is already escaped. */
export function safeUrl(url: string): string | null {
  const raw = url.replace(/&amp;/g, '&').trim()
  // strip control chars/whitespace browsers ignore inside schemes
  const probe = raw.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase()
  const m = /^([a-z][a-z0-9+.-]*):/.exec(probe)
  if (m && !['http', 'https', 'mailto'].includes(m[1])) return null
  return url
}

export function renderInline(escaped: string): string {
  const stash: string[] = []
  const hold = (html: string) => `\u0000${stash.push(html) - 1}\u0000`
  let s = escaped.replace(/\u0000/g, '')
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, code: string) => hold(`<code>${code.trim()}</code>`))
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*?&quot;)?\)/g, (m, text: string, url: string) => {
    const u = safeUrl(url)
    if (u === null) return m
    return hold(`<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`)
  })
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
  s = s.replace(/(\*|(?<![A-Za-z0-9_])_)(?=\S)([\s\S]*?\S)\1(?![A-Za-z0-9_])/g, '<em>$2</em>')
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
  // restore (stash entries may nest inside link text)
  for (let i = 0; i < 3; i++) s = s.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => stash[+n])
  return s
}

interface Item {
  indent: number
  ordered: boolean
  html: string
  task: boolean
  checked: boolean
  line: number
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TASK_RE = /^\[([ xX])\]\s+(.*)$/
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/

function renderList(items: Item[]): string {
  let out = ''
  const stack: { indent: number; tag: string }[] = []
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul'
    while (stack.length && it.indent < stack[stack.length - 1].indent) {
      out += `</li></${stack.pop()!.tag}>`
    }
    const top = stack[stack.length - 1]
    if (top && it.indent === top.indent) {
      out += '</li>'
    } else if (!top || it.indent > top.indent) {
      stack.push({ indent: it.indent, tag })
      out += `<${tag}>`
    }
    const box = it.task
      ? `<input type="checkbox" data-line="${it.line}"${it.checked ? ' checked' : ''}> `
      : ''
    out += `<li${it.task ? ' class="task"' : ''}>${box}${it.html}`
  }
  while (stack.length) out += `</li></${stack.pop()!.tag}>`
  return out
}

export function renderMarkdown(src: string, lineOffset = 0): string {
  const lines = src.split('\n').map((l) => l.replace(/\r$/, ''))
  let html = ''
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line)
    if (fence) {
      const marker = fence[1]
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(marker)) buf.push(lines[i++])
      i++
      const cls = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : ''
      html += `<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`
      continue
    }
    if (!line.trim()) { i++; continue }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      html += `<h${h[1].length}>${renderInline(escapeHtml(h[2]))}</h${h[1].length}>`
      i++
      continue
    }
    if (HR_RE.test(line) && !LIST_RE.test(line)) { html += '<hr>'; i++; continue }
    if (/^\s*>/.test(line)) {
      const start = i
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      // checkbox line numbers inside quotes would be off, so quotes render without live boxes
      void start
      html += `<blockquote>${renderMarkdown(buf.join('\n'), -1)}</blockquote>`
      continue
    }
    if (LIST_RE.test(line)) {
      const items: Item[] = []
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i])
        if (!m || (HR_RE.test(lines[i]) && !m[3].trim())) break
        const indent = m[1].replace(/\t/g, '    ').length
        const t = TASK_RE.exec(m[3])
        items.push({
          indent,
          ordered: /\d/.test(m[2]),
          task: !!t && lineOffset >= 0,
          checked: !!t && t[1] !== ' ',
          html: renderInline(escapeHtml(t ? t[2] : m[3])),
          line: i + lineOffset,
        })
        i++
      }
      html += renderList(items)
      continue
    }
    const buf: string[] = []
    while (
      i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) &&
      !LIST_RE.test(lines[i]) && !HR_RE.test(lines[i])
    ) buf.push(lines[i++])
    if (!buf.length) buf.push(lines[i++])
    html += `<p>${buf.map((l) => renderInline(escapeHtml(l))).join('<br>')}</p>`
  }
  return html
}

/** Toggle the task checkbox on the given 0-based source line. */
export function toggleCheckbox(src: string, line: number): string {
  const lines = src.split('\n')
  const l = lines[line]
  if (l === undefined) return src
  lines[line] = l.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/, (_m, a: string, c: string, b: string) =>
    `${a}${c === ' ' ? 'x' : ' '}${b}`)
  return lines.join('\n')
}
