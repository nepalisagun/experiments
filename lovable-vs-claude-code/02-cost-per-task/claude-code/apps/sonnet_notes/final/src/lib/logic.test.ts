import { describe, expect, it } from 'vitest'
import { renderMarkdown, toggleCheckbox, safeUrl } from './markdown'
import {
  NOTES_KEY, filterNotes, highlight, loadNotes, saveNotes, snippet, sortNotes, wordCount, type Note,
} from './notes'

const note = (o: Partial<Note>): Note => ({ id: 'x', title: 't', content: '', updatedAt: 0, pinned: false, ...o })

describe('markdown', () => {
  it('renders headings, emphasis, lists, links, code', () => {
    const h = renderMarkdown('# Hi\n\n**b** and *i* and `c`\n\n- a\n- b\n\n1. x\n\n[l](https://e.com)\n\n```js\nlet a = 1 < 2\n```')
    expect(h).toContain('<h1>Hi</h1>')
    expect(h).toContain('<strong>b</strong>')
    expect(h).toContain('<em>i</em>')
    expect(h).toContain('<code>c</code>')
    expect(h).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(h).toContain('<ol><li>x</li></ol>')
    expect(h).toContain('href="https://e.com"')
    expect(h).toContain('<pre><code class="language-js">let a = 1 &lt; 2</code></pre>')
  })
  it('renders nested lists', () => {
    expect(renderMarkdown('- a\n  - b\n- c')).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')
  })
  it('renders task lists with source line numbers', () => {
    const h = renderMarkdown('text\n\n- [ ] one\n- [x] two')
    expect(h).toContain('data-line="2"')
    expect(h).toContain('data-line="3" checked')
  })
  it('does not make checkboxes inside code fences', () => {
    expect(renderMarkdown('```\n- [ ] no\n```')).not.toContain('<input')
  })
  it('escapes raw HTML', () => {
    const h = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**<b>x</b>**')
    expect(h).not.toContain('<script')
    expect(h).not.toContain('<img')
    expect(h).toContain('&lt;script&gt;')
  })
  it('blocks dangerous link schemes', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('<a')
    expect(renderMarkdown('[x](JaVa\tScript:alert(1))')).not.toContain('<a')
    expect(renderMarkdown('[x](data:text/html,hi)')).not.toContain('<a')
    expect(safeUrl('/rel')).toBe('/rel')
    expect(safeUrl('mailto:a@b.c')).not.toBeNull()
  })
  it('cannot break out of attributes via quotes', () => {
    const h = renderMarkdown('[x](http://a.com/"onmouseover="alert(1))')
    expect(h).not.toMatch(/<a[^>]* onmouseover=/)
  })
  it('toggles checkboxes in source', () => {
    const src = 'a\n- [ ] one\n  * [x] two'
    expect(toggleCheckbox(src, 1)).toBe('a\n- [x] one\n  * [x] two')
    expect(toggleCheckbox(src, 2)).toBe('a\n- [ ] one\n  * [ ] two')
    expect(toggleCheckbox(src, 0)).toBe(src)
    expect(toggleCheckbox(src, 99)).toBe(src)
  })
})

describe('notes logic', () => {
  it('sorts pinned first then newest edited', () => {
    const s = sortNotes([
      note({ id: 'a', updatedAt: 1 }), note({ id: 'b', updatedAt: 3 }),
      note({ id: 'c', updatedAt: 2, pinned: true }), note({ id: 'd', updatedAt: 0, pinned: true }),
    ])
    expect(s.map((n) => n.id)).toEqual(['c', 'd', 'b', 'a'])
  })
  it('filters across title and content, case-insensitively', () => {
    const ns = [note({ id: 'a', title: 'Groceries' }), note({ id: 'b', content: 'buy MILK' }), note({ id: 'c' })]
    expect(filterNotes(ns, 'milk').map((n) => n.id)).toEqual(['b'])
    expect(filterNotes(ns, 'GROC').map((n) => n.id)).toEqual(['a'])
    expect(filterNotes(ns, '  ')).toHaveLength(3)
  })
  it('highlights matches', () => {
    expect(highlight('Hello hello', 'hel')).toEqual([
      { text: 'Hel', match: true }, { text: 'lo ', match: false },
      { text: 'hel', match: true }, { text: 'lo', match: false },
    ])
    expect(highlight('abc', '')).toEqual([{ text: 'abc', match: false }])
  })
  it('snippets around the match', () => {
    const long = 'x'.repeat(100) + ' needle ' + 'y'.repeat(100)
    expect(snippet(long, 'needle')).toContain('needle')
  })
  it('counts words', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('  \n ')).toBe(0)
    expect(wordCount('one two\nthree  four')).toBe(4)
  })
  it('round-trips through storage and tolerates garbage', () => {
    const mem: Record<string, string> = {}
    const st = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v } }
    const ns = [note({ id: 'a', title: 'A', content: 'c', updatedAt: 5, pinned: true })]
    expect(saveNotes(ns, st)).toBe(true)
    expect(loadNotes(st)).toEqual(ns)
    mem[NOTES_KEY] = '{bad'
    expect(loadNotes(st)).toBeNull()
    mem[NOTES_KEY] = '[1,null,{"id":"z","content":"q"}]'
    expect(loadNotes(st)?.map((n) => n.id)).toEqual(['z'])
  })
})
