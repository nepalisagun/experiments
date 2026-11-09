import { describe, expect, it } from 'vitest'
import {
  type Note,
  STORAGE_KEY,
  createNote,
  displayTitle,
  highlight,
  loadState,
  relativeTime,
  saveState,
  searchNotes,
  snippet,
  sortNotes,
  wordCount,
} from './notes'

const note = (id: string, updatedAt: number, extra: Partial<Note> = {}): Note => ({
  id,
  title: id,
  content: '',
  pinned: false,
  createdAt: 0,
  updatedAt,
  ...extra,
})

class MemoryStorage {
  data = new Map<string, string>()
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.data.set(k, v)
  }
}

describe('sortNotes', () => {
  it('sorts by last edited, newest first', () => {
    const out = sortNotes([note('a', 1), note('b', 3), note('c', 2)])
    expect(out.map((n) => n.id)).toEqual(['b', 'c', 'a'])
  })

  it('puts pinned notes first, each group newest first', () => {
    const out = sortNotes([
      note('a', 5),
      note('p1', 1, { pinned: true }),
      note('b', 9),
      note('p2', 3, { pinned: true }),
    ])
    expect(out.map((n) => n.id)).toEqual(['p2', 'p1', 'b', 'a'])
  })

  it('does not mutate the input', () => {
    const input = [note('a', 1), note('b', 2)]
    sortNotes(input)
    expect(input.map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('searchNotes', () => {
  const notes = [
    note('Groceries', 1, { content: 'milk, eggs' }),
    note('Work', 2, { content: 'Ship the MILKSHAKE feature' }),
    note('Ideas', 3, { content: 'nothing' }),
  ]
  it('matches titles and contents case-insensitively', () => {
    expect(searchNotes(notes, 'milk').map((n) => n.id)).toEqual(['Groceries', 'Work'])
    expect(searchNotes(notes, 'IDEAS').map((n) => n.id)).toEqual(['Ideas'])
  })
  it('returns everything for an empty query and nothing for no match', () => {
    expect(searchNotes(notes, '   ')).toHaveLength(3)
    expect(searchNotes(notes, 'zzz')).toHaveLength(0)
  })
})

describe('highlight', () => {
  it('splits text around every case-insensitive match', () => {
    expect(highlight('Milk and milk', 'milk')).toEqual([
      { text: 'Milk', match: true },
      { text: ' and ', match: false },
      { text: 'milk', match: true },
    ])
  })
  it('returns the whole text when there is no query or match', () => {
    expect(highlight('abc', '')).toEqual([{ text: 'abc', match: false }])
    expect(highlight('abc', 'x')).toEqual([{ text: 'abc', match: false }])
  })
  it('treats regex characters literally', () => {
    expect(highlight('a.b*c', '.b*')).toEqual([
      { text: 'a', match: false },
      { text: '.b*', match: true },
      { text: 'c', match: false },
    ])
  })
})

describe('snippet', () => {
  it('shows the start of the note as plain text without a query', () => {
    expect(snippet('# Hello\n\n**big** _world_ [link](https://x.com)\n- [ ] task\n`code`')).toBe(
      'Hello big world link task code',
    )
    expect(snippet('snake_case_name')).toBe('snake_case_name')
    expect(snippet('window.__xss = 1')).toBe('window.__xss = 1')
  })
  it('centres on the first match with ellipses', () => {
    const text = 'x'.repeat(100) + 'needle' + 'y'.repeat(100)
    const s = snippet(text, 'needle', 10)
    expect(s).toBe('…' + 'x'.repeat(10) + 'needle' + 'y'.repeat(10) + '…')
  })
})

describe('wordCount', () => {
  it('counts words ignoring Markdown syntax', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('   \n ')).toBe(0)
    expect(wordCount('# Hello **world**')).toBe(2)
    expect(wordCount('- [ ] buy milk\n- [x] done')).toBe(3)
    expect(wordCount("It's a well-known [link](https://example.com/a/b)")).toBe(4)
    expect(wordCount('```js\nconst x\n```')).toBe(2)
    expect(wordCount('Zażółć gęślą jaźń')).toBe(3)
  })
})

describe('persistence', () => {
  it('round-trips state through storage', () => {
    const s = new MemoryStorage()
    const n = createNote(100, 'Title', 'Body')
    expect(saveState(s, { notes: [n], activeId: n.id })).toBe(true)
    expect(loadState(s)).toEqual({ notes: [n], activeId: n.id })
  })

  it('returns null when nothing is saved', () => {
    expect(loadState(new MemoryStorage())).toBeNull()
  })

  it('survives corrupt data and drops invalid notes', () => {
    const s = new MemoryStorage()
    s.setItem(STORAGE_KEY, '{not json')
    expect(loadState(s)).toEqual({ notes: [], activeId: null })
    s.setItem(STORAGE_KEY, JSON.stringify({ notes: [{ id: 1 }, { id: 'ok', title: 't', content: '', updatedAt: 5 }], activeId: 'gone' }))
    expect(loadState(s)).toEqual({
      notes: [{ id: 'ok', title: 't', content: '', updatedAt: 5, createdAt: 5, pinned: false }],
      activeId: null,
    })
  })

  it('reports failure when storage throws (e.g. quota exceeded)', () => {
    const s = { setItem: () => { throw new Error('QuotaExceeded') } }
    expect(saveState(s, { notes: [], activeId: null })).toBe(false)
  })
})

describe('misc', () => {
  it('displayTitle falls back to Untitled', () => {
    expect(displayTitle({ title: '  ' })).toBe('Untitled')
    expect(displayTitle({ title: 'A' })).toBe('A')
  })
  it('createNote gives unique ids', () => {
    expect(createNote().id).not.toBe(createNote().id)
  })
  it('relativeTime formats recent times', () => {
    expect(relativeTime(1000, 1000)).toBe('just now')
    expect(relativeTime(0, 5 * 60_000)).toBe('5m ago')
    expect(relativeTime(0, 3 * 3600_000)).toBe('3h ago')
    expect(relativeTime(0, 2 * 86400_000)).toBe('2d ago')
  })
})
