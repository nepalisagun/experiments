import { describe, expect, it } from 'vitest'
import { renderMarkdown, renderInline, safeUrl, toggleTask } from './markdown'

describe('renderMarkdown', () => {
  it('renders headings of every level', () => {
    for (let l = 1; l <= 6; l++) {
      expect(renderMarkdown(`${'#'.repeat(l)} Title`)).toBe(`<h${l}>Title</h${l}>`)
    }
    // Without a space it is not a heading (it is a #tag instead).
    expect(renderMarkdown('#NoSpace')).not.toContain('<h1>')
  })

  it('renders bold, italic, bold-italic and strikethrough', () => {
    expect(renderInline('**b** and __b__')).toBe('<strong>b</strong> and <strong>b</strong>')
    expect(renderInline('*i* and _i_')).toBe('<em>i</em> and <em>i</em>')
    expect(renderInline('***bi***')).toBe('<strong><em>bi</em></strong>')
    expect(renderInline('**bold _and italic_**')).toBe('<strong>bold <em>and italic</em></strong>')
    expect(renderInline('~~gone~~')).toBe('<del>gone</del>')
  })

  it('does not treat underscores inside words as emphasis', () => {
    expect(renderInline('snake_case_name')).toBe('snake_case_name')
    expect(renderInline('2 * 3 * 4')).toBe('2 * 3 * 4')
  })

  it('renders unordered, ordered and nested lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('* a\n+ b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>')
    expect(renderMarkdown('3. a\n4. b')).toBe('<ol start="3"><li>a</li><li>b</li></ol>')
    expect(renderMarkdown('- a\n  - b\n- c')).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')
  })

  it('renders links with safe attributes', () => {
    expect(renderInline('[site](https://example.com)')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>',
    )
    expect(renderInline('[t](https://a.com/x_y_z "Title")')).toContain('href="https://a.com/x_y_z" title="Title"')
    expect(renderInline('see https://example.com/a_b.')).toBe(
      'see <a href="https://example.com/a_b" target="_blank" rel="noopener noreferrer">https://example.com/a_b</a>.',
    )
  })

  it('renders inline code and fenced code blocks literally', () => {
    expect(renderInline('`**not bold** <b>`')).toBe('<code>**not bold** &lt;b&gt;</code>')
    expect(renderMarkdown('```js\nconst a = 1 < 2\n# not heading\n```')).toBe(
      '<pre><code class="language-js">const a = 1 &lt; 2\n# not heading</code></pre>',
    )
    // Unclosed fence runs to end of document.
    expect(renderMarkdown('```\ncode')).toBe('<pre><code>code</code></pre>')
    expect(renderMarkdown('~~~\n- [ ] x\n~~~')).toBe('<pre><code>- [ ] x</code></pre>')
  })

  it('renders task lists with source line numbers', () => {
    const html = renderMarkdown('# T\n\n- [ ] todo\n- [x] done')
    expect(html).toContain('<input type="checkbox" data-line="2">')
    expect(html).toContain('<input type="checkbox" data-line="3" checked>')
    expect(html).toContain('<ul class="task-list">')
  })

  it('renders paragraphs, line breaks, blockquotes and rules', () => {
    expect(renderMarkdown('one\ntwo\n\nthree')).toBe('<p>one<br>two</p>\n<p>three</p>')
    expect(renderMarkdown('> quoted')).toBe('<blockquote><p>quoted</p></blockquote>')
    expect(renderMarkdown('a\n\n---\n\nb')).toBe('<p>a</p>\n<hr>\n<p>b</p>')
  })

  it('renders #tags as filter buttons, but not in code, headings or URLs', () => {
    expect(renderInline('see #Work_1 now')).toBe(
      'see <button type="button" class="md-tag" data-tag="work_1">#Work_1</button> now',
    )
    expect(renderInline('`#code` C# https://a.com/#x #123 \\#esc')).not.toContain('md-tag')
    expect(renderMarkdown('# Heading #tag')).toBe(
      '<h1>Heading <button type="button" class="md-tag" data-tag="tag">#tag</button></h1>',
    )
    expect(renderMarkdown('```\n#tag\n```')).not.toContain('md-tag')
  })

  it('handles empty input and backslash escapes', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderInline('\\*not italic\\*')).toBe('*not italic*')
  })
})

describe('safety', () => {
  const xss = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<svg onload=alert(1)>',
    '"><script>alert(1)</script>',
  ]

  it.each(xss)('escapes raw HTML: %s', (src) => {
    const html = renderMarkdown(src)
    expect(html).not.toMatch(/<(script|img|iframe|svg|a)\b/i)
    expect(html).toContain('&lt;')
  })

  it('escapes HTML inside every construct', () => {
    const html = renderMarkdown(
      '# <b>h</b>\n\n- <i>x</i>\n- [ ] <img src=x onerror=alert(1)>\n\n**<u>b</u>**\n\n[<s>t</s>](https://x.com)',
    )
    expect(html).not.toMatch(/<(b|i|u|s|img)\b/)
  })

  it('drops dangerous link schemes', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(safeUrl(url)).toBeNull()
    }
    const html = renderInline('[click](javascript:alert(1))')
    expect(html).not.toContain('href')
    expect(html).not.toContain('javascript:alert(1)"')
  })

  it('allows safe link schemes and relative links', () => {
    for (const url of ['https://a.com', 'http://a.com', 'mailto:a@b.c', '#top', '/path', 'page.html']) {
      expect(safeUrl(url)).toBe(url)
    }
  })

  it('cannot break out of the href attribute', () => {
    const html = renderInline('[x](https://a.com/"onmouseover="alert(1))')
    expect(html).not.toMatch(/"\s*onmouseover=/)
  })

  it('escapes code-block language names', () => {
    expect(renderMarkdown('```"><script>\nx\n```')).not.toContain('<script>')
  })
})

describe('toggleTask', () => {
  it('toggles unchecked and checked items', () => {
    const src = '- [ ] a\n- [x] b\n* [X] c'
    expect(toggleTask(src, 0)).toBe('- [x] a\n- [x] b\n* [X] c')
    expect(toggleTask(src, 1)).toBe('- [ ] a\n- [ ] b\n* [X] c')
    expect(toggleTask(src, 2)).toBe('- [ ] a\n- [x] b\n* [ ] c')
  })

  it('handles nested, ordered and quoted items', () => {
    expect(toggleTask('  - [ ] nested', 0)).toBe('  - [x] nested')
    expect(toggleTask('1. [ ] first', 0)).toBe('1. [x] first')
    expect(toggleTask('> - [ ] quoted', 0)).toBe('> - [x] quoted')
  })

  it('leaves non-task lines and out-of-range lines untouched', () => {
    const src = 'text [ ] here\n- item'
    expect(toggleTask(src, 0)).toBe(src)
    expect(toggleTask(src, 1)).toBe(src)
    expect(toggleTask(src, 9)).toBe(src)
  })

  it('round-trips with the rendered data-line', () => {
    const src = 'Intro\n\n```\n- [ ] in code\n```\n\n- [ ] real\n  - [ ] child'
    const lines = [...renderMarkdown(src).matchAll(/data-line="(\d+)"/g)].map((m) => +m[1])
    expect(lines).toEqual([6, 7])
    expect(toggleTask(src, 7).split('\n')[7]).toBe('  - [x] child')
  })
})
