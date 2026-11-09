import { describe, expect, it } from 'vitest'
import {
  createNote, filterNotes, highlightSegments, loadNotes, saveNotes, snippet,
  sortNotes, toggleCheckbox, wordCount, NOTES_KEY, type Note,
} from './notes'
import { renderMarkdown } from './markdown'

const n = (title: string, updatedAt: number, pinned = false, content = ''): Note =>
  ({ ...createNote(updatedAt, title, content), pinned })

describe('sortNotes', () => {
  it('puts pinned first then newest first', () => {
    const r = sortNotes([n('old', 1), n('pinOld', 2, true), n('new', 9), n('pinNew', 5, true)])
    expect(r.map((x) => x.title)).toEqual(['pinNew', 'pinOld', 'new', 'old'])
  })
  it('does not mutate input', () => {
    const a = [n('a', 1), n('b', 2)]
    sortNotes(a)
    expect(a[0].title).toBe('a')
  })
})

describe('search', () => {
  const notes = [n('Groceries', 1, false, 'milk and eggs'), n('Work', 2, false, 'Meeting NOTES')]
  it('matches title and content case-insensitively', () => {
    expect(filterNotes(notes, 'GROC').map((x) => x.title)).toEqual(['Groceries'])
    expect(filterNotes(notes, 'notes').map((x) => x.title)).toEqual(['Work'])
    expect(filterNotes(notes, '  ')).toHaveLength(2)
    expect(filterNotes(notes, 'zzz')).toHaveLength(0)
  })
  it('highlights segments', () => {
    expect(highlightSegments('Foo bar foo', 'foo')).toEqual([
      { text: 'Foo', match: true }, { text: ' bar ', match: false }, { text: 'foo', match: true },
    ])
    expect(highlightSegments('abc', '')).toEqual([{ text: 'abc', match: false }])
  })
  it('snippets around a match', () => {
    const s = snippet('x'.repeat(100) + ' needle ' + 'y'.repeat(100), 'needle', 10)
    expect(s).toContain('needle')
    expect(s.startsWith('…')).toBe(true)
  })
})

describe('wordCount', () => {
  it('counts words', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('  \n ')).toBe(0)
    expect(wordCount('one two\nthree  four')).toBe(4)
  })
})

describe('toggleCheckbox', () => {
  const src = '- [ ] a\n- [x] b\n\n```\n- [ ] not a task\n```\n\n1. [ ] c\n  - [X] d'
  it('toggles by index, skipping fenced code', () => {
    expect(toggleCheckbox(src, 0).split('\n')[0]).toBe('- [x] a')
    expect(toggleCheckbox(src, 1).split('\n')[1]).toBe('- [ ] b')
    expect(toggleCheckbox(src, 2).split('\n')[7]).toBe('1. [x] c')
    expect(toggleCheckbox(src, 3).split('\n')[8]).toBe('  - [ ] d')
    expect(toggleCheckbox(src, 2)).toContain('- [ ] not a task')
  })
  it('ignores out of range', () => {
    expect(toggleCheckbox(src, 9)).toBe(src)
  })
})

describe('storage', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  it('round-trips', () => {
    const s = mem()
    const notes = [n('a', 1, true, 'hi')]
    expect(saveNotes(notes, s)).toBe(true)
    expect(loadNotes(s)).toEqual(notes)
  })
  it('returns null when empty or corrupt', () => {
    const s = mem()
    expect(loadNotes(s)).toBeNull()
    s.setItem(NOTES_KEY, '{bad')
    expect(loadNotes(s)).toBeNull()
  })
  it('save reports failure', () => {
    expect(saveNotes([], { setItem: () => { throw new Error('full') } })).toBe(false)
  })
})

describe('renderMarkdown', () => {
  it('renders supported syntax', () => {
    const h = renderMarkdown('# T\n\n**b** *i* [l](https://x.com)\n\n- a\n\n```\ncode\n```\n\n- [x] done')
    expect(h).toContain('<h1>')
    expect(h).toContain('<strong>b</strong>')
    expect(h).toContain('<em>i</em>')
    expect(h).toContain('href="https://x.com"')
    expect(h).toContain('<pre><code>')
    expect(h).toContain('type="checkbox"')
    expect(h).toContain('checked')
  })
  it('does not emit raw HTML or scripts', () => {
    const h = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n<input type=checkbox>')
    expect(h).not.toMatch(/<script/i)
    expect(h).not.toMatch(/<img/i)
    expect(h).not.toMatch(/<input/i)
    expect(h).not.toMatch(/javascript:/i)
  })
})
