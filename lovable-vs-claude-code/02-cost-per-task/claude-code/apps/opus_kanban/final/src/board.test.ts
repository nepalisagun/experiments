import { describe, expect, it } from 'vitest'
import {
  addCard,
  type Card,
  type CardInput,
  cardsIn,
  deleteCard,
  isFilterActive,
  isOverdue,
  isWipExceeded,
  loadBoard,
  matchesFilter,
  moveCard,
  parseBoard,
  saveBoard,
  serializeBoard,
  shiftColumn,
  shiftWithinColumn,
  STORAGE_KEY,
  todayISO,
  updateCard,
} from './board'

const input = (title: string, extra: Partial<CardInput> = {}): CardInput => ({
  title,
  description: '',
  due: '',
  priority: 'medium',
  ...extra,
})

function board(): Card[] {
  let cards: Card[] = []
  cards = addCard(cards, input('A'), 'todo', 'a')
  cards = addCard(cards, input('B'), 'todo', 'b')
  cards = addCard(cards, input('C'), 'todo', 'c')
  cards = addCard(cards, input('D'), 'doing', 'd')
  cards = addCard(cards, input('E'), 'done', 'e')
  return cards
}
const ids = (cards: Card[], col: Card['column']) => cardsIn(cards, col).map((c) => c.id)

describe('add / update / delete', () => {
  it('adds a card to To do by default with trimmed fields', () => {
    const cards = addCard([], input('  Hello  ', { description: '  world ' }), undefined, 'x')
    expect(cards).toEqual([{ id: 'x', title: 'Hello', description: 'world', due: '', priority: 'medium', column: 'todo' }])
  })
  it('drops invalid due dates and priorities', () => {
    const [c] = addCard([], { title: 't', description: '', due: 'tomorrow', priority: 'urgent' as never })
    expect(c.due).toBe('')
    expect(c.priority).toBe('medium')
  })
  it('generates unique ids', () => {
    const cards = addCard(addCard([], input('a')), input('b'))
    expect(cards[0].id).not.toBe(cards[1].id)
  })
  it('updates fields but keeps id and column', () => {
    const cards = updateCard(board(), 'd', input('New', { priority: 'high', due: '2026-01-02', description: 'x' }))
    expect(cards.find((c) => c.id === 'd')).toEqual({
      id: 'd', title: 'New', description: 'x', due: '2026-01-02', priority: 'high', column: 'doing',
    })
  })
  it('deletes a card', () => {
    expect(deleteCard(board(), 'b').map((c) => c.id)).toEqual(['a', 'c', 'd', 'e'])
  })
})

describe('moveCard', () => {
  it('reorders within a column (before a card)', () => {
    expect(ids(moveCard(board(), 'c', 'todo', 'a'), 'todo')).toEqual(['c', 'a', 'b'])
  })
  it('moves to the end of a column with beforeId null', () => {
    expect(ids(moveCard(board(), 'a', 'todo', null), 'todo')).toEqual(['b', 'c', 'a'])
  })
  it('moves between columns at a specific position', () => {
    const cards = moveCard(board(), 'b', 'doing', 'd')
    expect(ids(cards, 'todo')).toEqual(['a', 'c'])
    expect(ids(cards, 'doing')).toEqual(['b', 'd'])
  })
  it('moves into an empty column', () => {
    const cards = moveCard(deleteCard(board(), 'e'), 'a', 'done', null)
    expect(ids(cards, 'done')).toEqual(['a'])
  })
  it('is a no-op when dropped before itself or for unknown ids', () => {
    const b = board()
    expect(moveCard(b, 'a', 'todo', 'a')).toBe(b)
    expect(moveCard(b, 'zzz', 'todo', null)).toBe(b)
  })
  it('falls back to end of column if beforeId is in a different column', () => {
    expect(ids(moveCard(board(), 'a', 'doing', 'e'), 'doing')).toEqual(['d', 'a'])
  })
  it('never loses or duplicates cards', () => {
    const cards = moveCard(moveCard(board(), 'a', 'done', 'e'), 'e', 'todo', 'c')
    expect(cards.map((c) => c.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('keyboard moves', () => {
  it('shifts a card right and left between columns', () => {
    let cards = shiftColumn(board(), 'a', 1)
    expect(ids(cards, 'doing')).toEqual(['d', 'a'])
    cards = shiftColumn(cards, 'a', 1)
    expect(ids(cards, 'done')).toEqual(['e', 'a'])
    cards = shiftColumn(cards, 'a', -1)
    expect(ids(cards, 'doing')).toEqual(['d', 'a'])
  })
  it('does nothing past the first/last column', () => {
    const b = board()
    expect(shiftColumn(b, 'a', -1)).toBe(b)
    expect(shiftColumn(b, 'e', 1)).toBe(b)
  })
  it('reorders up and down within a column', () => {
    expect(ids(shiftWithinColumn(board(), 'a', 1), 'todo')).toEqual(['b', 'a', 'c'])
    expect(ids(shiftWithinColumn(board(), 'b', 1), 'todo')).toEqual(['a', 'c', 'b'])
    expect(ids(shiftWithinColumn(board(), 'c', -1), 'todo')).toEqual(['a', 'c', 'b'])
    const b = board()
    expect(shiftWithinColumn(b, 'a', -1)).toBe(b)
    expect(shiftWithinColumn(b, 'c', 1)).toBe(b)
  })
})

describe('overdue', () => {
  const today = '2026-11-09'
  const card = (due: string, column: Card['column'] = 'todo'): Card => ({
    id: '1', title: 't', description: '', priority: 'low', due, column,
  })
  it('is overdue when due before today and not done', () => {
    expect(isOverdue(card('2026-11-08'), today)).toBe(true)
    expect(isOverdue(card('2025-12-31', 'doing'), today)).toBe(true)
  })
  it('is not overdue when due today, in the future, missing, or done', () => {
    expect(isOverdue(card('2026-11-09'), today)).toBe(false)
    expect(isOverdue(card('2026-11-10'), today)).toBe(false)
    expect(isOverdue(card(''), today)).toBe(false)
    expect(isOverdue(card('2020-01-01', 'done'), today)).toBe(false)
  })
  it('todayISO uses the local date with padding', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('WIP limit', () => {
  it('is exceeded only above 3 cards in Doing', () => {
    let cards = board() // 1 in doing
    cards = addCard(cards, input('x'), 'doing')
    cards = addCard(cards, input('y'), 'doing')
    expect(isWipExceeded(cards)).toBe(false) // exactly 3
    cards = addCard(cards, input('z'), 'doing')
    expect(isWipExceeded(cards)).toBe(true)
  })
})

describe('filter', () => {
  const c: Card = { id: '1', title: 'Write Report', description: 'Quarterly numbers', due: '', priority: 'high', column: 'todo' }
  it('matches title and description case-insensitively', () => {
    expect(matchesFilter(c, { query: 'report', priority: 'all' })).toBe(true)
    expect(matchesFilter(c, { query: 'QUARTER', priority: 'all' })).toBe(true)
    expect(matchesFilter(c, { query: 'nope', priority: 'all' })).toBe(false)
    expect(matchesFilter(c, { query: '   ', priority: 'all' })).toBe(true)
  })
  it('filters by priority and combines with search', () => {
    expect(matchesFilter(c, { query: '', priority: 'high' })).toBe(true)
    expect(matchesFilter(c, { query: '', priority: 'low' })).toBe(false)
    expect(matchesFilter(c, { query: 'report', priority: 'low' })).toBe(false)
  })
  it('reports when a filter is active', () => {
    expect(isFilterActive({ query: '', priority: 'all' })).toBe(false)
    expect(isFilterActive({ query: ' ', priority: 'all' })).toBe(false)
    expect(isFilterActive({ query: 'a', priority: 'all' })).toBe(true)
    expect(isFilterActive({ query: '', priority: 'low' })).toBe(true)
  })
})

describe('persistence', () => {
  function memoryStorage() {
    const map = new Map<string, string>()
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    }
  }
  it('round-trips through storage preserving order', () => {
    const s = memoryStorage()
    const cards = moveCard(board(), 'c', 'todo', 'a')
    expect(saveBoard(cards, s)).toBe(true)
    expect(loadBoard(s)).toEqual(cards)
  })
  it('returns an empty board for missing or corrupt data', () => {
    expect(parseBoard(null)).toEqual([])
    expect(parseBoard('{not json')).toEqual([])
    expect(parseBoard('"str"')).toEqual([])
    expect(parseBoard('{"cards": 5}')).toEqual([])
  })
  it('drops invalid cards and repairs bad fields', () => {
    const raw = JSON.stringify({
      cards: [
        { id: 'ok', title: 'Ok', column: 'doing', priority: 'nope', due: 'x' },
        { id: 'ok', title: 'Duplicate', column: 'todo' },
        { id: 'bad-col', title: 'x', column: 'later' },
        { id: 'no-title', title: '  ', column: 'todo' },
        null,
        42,
      ],
    })
    expect(parseBoard(raw)).toEqual([{ id: 'ok', title: 'Ok', description: '', due: '', priority: 'medium', column: 'doing' }])
  })
  it('accepts a bare array too', () => {
    expect(parseBoard(JSON.stringify(board()))).toEqual(board())
  })
  it('survives storage that throws', () => {
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') },
    }
    expect(loadBoard(throwing)).toEqual([])
    expect(saveBoard(board(), throwing)).toBe(false)
  })
  it('uses a versioned key and format', () => {
    expect(STORAGE_KEY).toBe('kanban-board-v1')
    expect(JSON.parse(serializeBoard([])).version).toBe(1)
  })
})
