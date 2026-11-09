import { describe, expect, it } from 'vitest'
import { countWords, renderInline, renderMarkdown, safeUrl, toggleTask } from './markdown'

describe('renderMarkdown: blocks', () => {
  it('renders headings h1-h6', () => {
    expect(renderMarkdown('# One')).toBe('<h1>One</h1>')
    expect(renderMarkdown('### Three ###')).toBe('<h3>Three</h3>')
    expect(renderMarkdown('###### Six')).toBe('<h6>Six</h6>')
    // No space after # → not a heading (it's a tag; see tags.test.ts)
    expect(renderMarkdown('#NoSpace')).not.toContain('<h1>')
    expect(renderMarkdown('#1 first')).toBe('<p>#1 first</p>')
  })

  it('renders paragraphs with line breaks', () => {
    expect(renderMarkdown('a\nb\n\nc')).toBe('<p>a<br>b</p>\n<p>c</p>')
  })

  it('renders bullet and numbered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>')
    expect(renderMarkdown('* a\n+ b')).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it('nests lists by indentation', () => {
    expect(renderMarkdown('- a\n  - b\n- c')).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')
    expect(renderMarkdown('- a\n  1. x')).toBe('<ul><li>a<ol><li>x</li></ol></li></ul>')
  })

  it('renders task lists with checkboxes tagged by source line', () => {
    const html = renderMarkdown('intro\n\n- [ ] todo\n- [x] done')
    expect(html).toContain('<ul class="task-list">')
    expect(html).toContain('<input type="checkbox" data-line="2">')
    expect(html).toContain('<input type="checkbox" data-line="3" checked>')
    expect(html).toContain('<span>todo</span>')
  })

  it('renders fenced code blocks verbatim and escaped', () => {
    const html = renderMarkdown('```js\nconst a = **b** < 3\n- [ ] not a task\n```')
    expect(html).toBe(
      '<pre><code class="language-js">const a = **b** &lt; 3\n- [ ] not a task</code></pre>',
    )
  })

  it('handles an unterminated fence', () => {
    expect(renderMarkdown('```\ncode')).toBe('<pre><code>code</code></pre>')
  })

  it('renders blockquotes and horizontal rules', () => {
    expect(renderMarkdown('> quote')).toBe('<blockquote><p>quote</p></blockquote>')
    expect(renderMarkdown('---')).toBe('<hr>')
  })
})

describe('renderInline', () => {
  it('renders bold, italic, both, strikethrough', () => {
    expect(renderInline('**b** *i* __b2__ _i2_ ***bi*** ~~s~~')).toBe(
      '<strong>b</strong> <em>i</em> <strong>b2</strong> <em>i2</em> <strong><em>bi</em></strong> <del>s</del>',
    )
  })

  it('does not italicise snake_case words', () => {
    expect(renderInline('some_var_name')).toBe('some_var_name')
  })

  it('renders inline code without formatting inside', () => {
    expect(renderInline('`**x** <b>`')).toBe('<code>**x** &lt;b&gt;</code>')
  })

  it('renders links with safe attributes', () => {
    expect(renderInline('[Ex **bold**](https://example.com/?a=1&b=2)')).toBe(
      '<a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Ex <strong>bold</strong></a>',
    )
  })

  it('autolinks bare URLs', () => {
    expect(renderInline('see https://example.com.')).toBe(
      'see <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>.',
    )
  })
})

describe('safety', () => {
  it('escapes raw HTML so scripts never become elements', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes HTML inside headings, lists and tasks', () => {
    const html = renderMarkdown('# <b onclick=x>\n- <iframe>\n- [ ] <svg onload=x>')
    expect(html).not.toMatch(/<(b|iframe|svg)[\s>]/)
  })

  it('drops javascript: and data: links but keeps their text', () => {
    expect(renderInline('[click](javascript:alert(1))')).not.toContain('href')
    expect(renderInline('[click](JaVaScRiPt:alert(1))')).not.toContain('<a')
    expect(renderInline('[x](data:text/html,<script>)')).not.toContain('<a')
    expect(renderInline('[x](vbscript:msgbox)')).not.toContain('<a')
  })

  it('cannot break out of attributes with quotes', () => {
    const html = renderInline('[x](https://a.com/"onmouseover="alert(1))')
    expect(html).not.toMatch(/"\s*onmouseover=/)
  })

  it('allows http, https, mailto and relative URLs', () => {
    expect(safeUrl('https://a.com')).toBe('https://a.com')
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeUrl('/path#x')).toBe('/path#x')
    expect(safeUrl('java\tscript:alert(1)')).toBeNull()
  })

  it('ignores injected placeholder characters', () => {
    expect(renderInline('\u00000\u0000 `x`')).toBe('0 <code>x</code>')
  })
})

describe('toggleTask', () => {
  const src = 'title\n- [ ] one\n- [x] two\n  * [X] three\n1. [ ] four\nplain'
  it('checks an unchecked task', () => {
    expect(toggleTask(src, 1).split('\n')[1]).toBe('- [x] one')
  })
  it('unchecks checked tasks (x and X)', () => {
    expect(toggleTask(src, 2).split('\n')[2]).toBe('- [ ] two')
    expect(toggleTask(src, 3).split('\n')[3]).toBe('  * [ ] three')
  })
  it('works for numbered tasks', () => {
    expect(toggleTask(src, 4).split('\n')[4]).toBe('1. [x] four')
  })
  it('leaves non-task lines and out-of-range lines alone', () => {
    expect(toggleTask(src, 0)).toBe(src)
    expect(toggleTask(src, 5)).toBe(src)
    expect(toggleTask(src, 99)).toBe(src)
  })
  it('only touches the targeted line', () => {
    const out = toggleTask(src, 1).split('\n')
    expect(out.slice(2)).toEqual(src.split('\n').slice(2))
  })
  it('preserves CRLF line endings', () => {
    expect(toggleTask('a\r\n- [ ] b\r\nc', 1)).toBe('a\r\n- [x] b\r\nc')
  })
  it('round-trips with the rendered data-line', () => {
    const md = 'x\n\n```\n- [ ] in code\n```\n- [ ] real'
    const line = Number(/data-line="(\d+)"/.exec(renderMarkdown(md))![1])
    expect(toggleTask(md, line).endsWith('- [x] real')).toBe(true)
    expect(toggleTask(md, line)).toContain('- [ ] in code')
  })
})

describe('countWords', () => {
  it('counts words, ignoring Markdown punctuation', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n ')).toBe(0)
    expect(countWords('# Hello **world**')).toBe(2)
    expect(countWords('- [ ] buy milk\n- [x] done')).toBe(3)
    expect(countWords("don't stop")).toBe(2)
    expect(countWords('[my site](https://example.com/a/b)')).toBe(2)
    expect(countWords('zażółć gęślą 42')).toBe(3)
  })
})
