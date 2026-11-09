import { describe, expect, it } from 'vitest'
import {
  createNote,
  highlight,
  loadNotes,
  matchesQuery,
  saveNotes,
  snippet,
  sortNotes,
  STORAGE_KEY,
  type Note,
} from './notes'

const note = (title: string, updatedAt: number, pinned = false, content = ''): Note => ({
  ...createNote(updatedAt, title, content),
  pinned,
})

function memoryStorage(init: Record<string, string> = {}) {
  const data = { ...init }
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

describe('sortNotes', () => {
  it('puts pinned first, then newest edited first', () => {
    const notes = [note('old', 1), note('pinOld', 2, true), note('new', 5), note('pinNew', 4, true), note('mid', 3)]
    expect(sortNotes(notes).map((n) => n.title)).toEqual(['pinNew', 'pinOld', 'new', 'mid', 'old'])
  })
  it('does not mutate the input', () => {
    const notes = [note('a', 1), note('b', 2)]
    sortNotes(notes)
    expect(notes.map((n) => n.title)).toEqual(['a', 'b'])
  })
})

describe('search', () => {
  const n = note('Shopping List', 1, false, 'Buy MILK and eggs')
  it('matches title or content, case-insensitively', () => {
    expect(matchesQuery(n, 'shop')).toBe(true)
    expect(matchesQuery(n, 'milk')).toBe(true)
    expect(matchesQuery(n, 'bread')).toBe(false)
    expect(matchesQuery(n, '   ')).toBe(true)
  })
  it('highlight splits text into match segments', () => {
    expect(highlight('Banana', 'an')).toEqual([
      { text: 'B', match: false },
      { text: 'an', match: true },
      { text: 'an', match: true },
      { text: 'a', match: false },
    ])
    expect(highlight('abc', '')).toEqual([{ text: 'abc', match: false }])
    expect(highlight('ABC', 'abc')).toEqual([{ text: 'ABC', match: true }])
  })
  it('highlight treats regex characters literally', () => {
    expect(highlight('a.b*c', '.b*')).toEqual([
      { text: 'a', match: false },
      { text: '.b*', match: true },
      { text: 'c', match: false },
    ])
  })
  it('snippet centres on the first match', () => {
    const text = 'x '.repeat(100) + 'needle' + ' y'.repeat(100)
    const s = snippet(text, 'needle', 10)
    expect(s).toContain('needle')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(snippet('hello\n\nworld', '')).toBe('hello world')
  })
  it('snippet strips Markdown syntax', () => {
    expect(snippet('# Title\n- [ ] **buy** [milk](https://x.y)\n> `quote`', '')).toBe('Title buy milk quote')
  })
})

describe('storage', () => {
  it('round-trips notes', () => {
    const st = memoryStorage()
    const notes = [note('a', 1, true, 'body')]
    expect(saveNotes(st, notes)).toBe(true)
    expect(loadNotes(st)).toEqual(notes)
  })
  it('returns null when nothing is stored or data is corrupt', () => {
    expect(loadNotes(memoryStorage())).toBeNull()
    expect(loadNotes(memoryStorage({ [STORAGE_KEY]: '{not json' }))).toBeNull()
    expect(loadNotes(memoryStorage({ [STORAGE_KEY]: '{"a":1}' }))).toBeNull()
  })
  it('keeps an empty list (user deleted everything)', () => {
    expect(loadNotes(memoryStorage({ [STORAGE_KEY]: '[]' }))).toEqual([])
  })
  it('drops malformed entries and fills defaults', () => {
    const raw = JSON.stringify([{ id: '1', title: 't', content: 'c', updatedAt: 5 }, { id: 2 }, null])
    expect(loadNotes(memoryStorage({ [STORAGE_KEY]: raw }))).toEqual([
      { id: '1', title: 't', content: 'c', updatedAt: 5, pinned: false, createdAt: 5 },
    ])
  })
  it('reports a failed save (quota exceeded)', () => {
    const st = {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(saveNotes(st, [])).toBe(false)
  })
})
