import { describe, expect, it } from 'vitest'
import {
  addCard,
  type Board,
  type Card,
  deleteCard,
  emptyBoard,
  isOverWip,
  isOverdue,
  isValidDate,
  loadBoard,
  matchesFilter,
  moveCard,
  moveCardToAdjacentColumn,
  moveCardWithinColumn,
  normalizeInput,
  parseBoard,
  saveBoard,
  STORAGE_KEY,
  todayString,
  updateCard,
} from './board'

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  title: `Card ${id}`,
  description: '',
  due: '',
  priority: 'medium',
  ...extra,
})

const board = (todo: string[], doing: string[] = [], done: string[] = []): Board => ({
  todo: todo.map((id) => card(id)),
  doing: doing.map((id) => card(id)),
  done: done.map((id) => card(id)),
})

const ids = (b: Board) => ({ todo: b.todo.map((c) => c.id), doing: b.doing.map((c) => c.id), done: b.done.map((c) => c.id) })

describe('add / update / delete', () => {
  it('adds a card to the end of the chosen column', () => {
    const b = addCard(board(['a']), 'todo', { title: 'New', description: '', due: '', priority: 'high' }, 'n')
    expect(ids(b).todo).toEqual(['a', 'n'])
    expect(b.todo[1]).toEqual({ id: 'n', title: 'New', description: '', due: '', priority: 'high' })
  })

  it('generates unique ids', () => {
    let b = emptyBoard()
    for (let i = 0; i < 50; i++) b = addCard(b, 'todo', { title: 't', description: '', due: '', priority: 'low' })
    expect(new Set(b.todo.map((c) => c.id)).size).toBe(50)
  })

  it('updates a card in place without moving it', () => {
    const b = updateCard(board(['a'], ['b', 'c']), 'b', { title: 'B2', description: 'd', due: '2026-01-02', priority: 'low' })
    expect(ids(b).doing).toEqual(['b', 'c'])
    expect(b.doing[0]).toEqual({ id: 'b', title: 'B2', description: 'd', due: '2026-01-02', priority: 'low' })
  })

  it('deletes a card', () => {
    expect(ids(deleteCard(board(['a', 'b'], ['c']), 'a'))).toEqual({ todo: ['b'], doing: ['c'], done: [] })
  })

  it('ignores unknown ids and does not mutate the input', () => {
    const b = board(['a'])
    const snapshot = JSON.stringify(b)
    expect(deleteCard(b, 'zz')).toBe(b)
    expect(updateCard(b, 'zz', { title: 'x', description: '', due: '', priority: 'low' })).toBe(b)
    deleteCard(b, 'a')
    expect(JSON.stringify(b)).toBe(snapshot)
  })
})

describe('normalizeInput', () => {
  it('trims and requires a title', () => {
    expect(normalizeInput({ title: '   ', description: '', due: '', priority: 'low' }).error).toBe('Title is required.')
    const r = normalizeInput({ title: '  Hi ', description: ' d ', due: '', priority: 'low' })
    expect(r).toEqual({ card: { title: 'Hi', description: 'd', due: '', priority: 'low' }, error: null })
  })

  it('rejects impossible dates', () => {
    expect(normalizeInput({ title: 'x', description: '', due: '2026-02-30', priority: 'low' }).error).toMatch(/date/)
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2025-02-29')).toBe(false)
    expect(isValidDate('nope')).toBe(false)
  })
})

describe('moveCard', () => {
  it('moves a card to another column at the end', () => {
    expect(ids(moveCard(board(['a', 'b'], ['c']), 'a', 'doing', null))).toEqual({ todo: ['b'], doing: ['c', 'a'], done: [] })
  })

  it('moves a card to another column before a given card', () => {
    expect(ids(moveCard(board(['a'], ['c', 'd']), 'a', 'doing', 'd')).doing).toEqual(['c', 'a', 'd'])
  })

  it('reorders within a column, both directions', () => {
    expect(ids(moveCard(board(['a', 'b', 'c']), 'c', 'todo', 'a')).todo).toEqual(['c', 'a', 'b'])
    expect(ids(moveCard(board(['a', 'b', 'c']), 'a', 'todo', 'c')).todo).toEqual(['b', 'a', 'c'])
    expect(ids(moveCard(board(['a', 'b', 'c']), 'a', 'todo', null)).todo).toEqual(['b', 'c', 'a'])
  })

  it('returns the same board for a no-op move', () => {
    const b = board(['a', 'b'])
    expect(moveCard(b, 'a', 'todo', 'b')).toBe(b)
    expect(moveCard(b, 'a', 'todo', 'a')).toBe(b)
    expect(moveCard(b, 'b', 'todo', null)).toBe(b)
    expect(moveCard(b, 'missing', 'doing', null)).toBe(b)
  })

  it('appends when beforeId is not in the target column', () => {
    expect(ids(moveCard(board(['a', 'b'], ['c']), 'a', 'doing', 'b')).doing).toEqual(['c', 'a'])
  })

  it('keeps the card data intact', () => {
    const b = addCard(emptyBoard(), 'todo', { title: 'T', description: 'D', due: '2026-03-04', priority: 'high' }, 'x')
    expect(moveCard(b, 'x', 'done', null).done[0]).toEqual(b.todo[0])
  })
})

describe('keyboard moves', () => {
  it('moves to adjacent columns and stops at the edges', () => {
    const b = board(['a'], ['b'])
    expect(ids(moveCardToAdjacentColumn(b, 'a', 1))).toEqual({ todo: [], doing: ['b', 'a'], done: [] })
    expect(moveCardToAdjacentColumn(b, 'a', -1)).toBe(b)
    const d = board([], [], ['z'])
    expect(moveCardToAdjacentColumn(d, 'z', 1)).toBe(d)
    expect(ids(moveCardToAdjacentColumn(d, 'z', -1)).doing).toEqual(['z'])
  })

  it('moves up and down within a column', () => {
    const b = board(['a', 'b', 'c'])
    expect(ids(moveCardWithinColumn(b, 'b', -1)).todo).toEqual(['b', 'a', 'c'])
    expect(ids(moveCardWithinColumn(b, 'b', 1)).todo).toEqual(['a', 'c', 'b'])
    expect(moveCardWithinColumn(b, 'a', -1)).toBe(b)
    expect(moveCardWithinColumn(b, 'c', 1)).toBe(b)
  })
})

describe('filter', () => {
  const c = card('1', { title: 'Write Report', description: 'quarterly NUMBERS', priority: 'high' })
  it('matches title and description case-insensitively', () => {
    expect(matchesFilter(c, { query: 'report', priority: 'all' })).toBe(true)
    expect(matchesFilter(c, { query: 'numbers', priority: 'all' })).toBe(true)
    expect(matchesFilter(c, { query: '  numb  ', priority: 'all' })).toBe(true)
    expect(matchesFilter(c, { query: 'invoice', priority: 'all' })).toBe(false)
    expect(matchesFilter(c, { query: '', priority: 'all' })).toBe(true)
  })
  it('filters by priority and combines with the query', () => {
    expect(matchesFilter(c, { query: '', priority: 'high' })).toBe(true)
    expect(matchesFilter(c, { query: '', priority: 'low' })).toBe(false)
    expect(matchesFilter(c, { query: 'report', priority: 'low' })).toBe(false)
  })
})

describe('overdue and WIP', () => {
  const today = '2026-11-09'
  it('is overdue only when due before today and not done', () => {
    expect(isOverdue(card('1', { due: '2026-11-08' }), 'todo', today)).toBe(true)
    expect(isOverdue(card('1', { due: '2026-11-08' }), 'doing', today)).toBe(true)
    expect(isOverdue(card('1', { due: '2026-11-08' }), 'done', today)).toBe(false)
    expect(isOverdue(card('1', { due: today }), 'todo', today)).toBe(false)
    expect(isOverdue(card('1', { due: '2026-11-10' }), 'todo', today)).toBe(false)
    expect(isOverdue(card('1', { due: '' }), 'todo', today)).toBe(false)
    expect(isOverdue(card('1', { due: '2025-12-31' }), 'todo', '2026-01-01')).toBe(true)
  })
  it('formats today as a local date', () => {
    expect(todayString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
  it('warns only when In progress has more than 3 cards', () => {
    expect(isOverWip(board([], ['a', 'b', 'c']))).toBe(false)
    expect(isOverWip(board([], ['a', 'b', 'c', 'd']))).toBe(true)
  })
})

describe('persistence', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
  }

  it('round-trips a board', () => {
    const s = memory()
    const b = addCard(board(['a'], ['b'], ['c']), 'done', { title: 'X', description: 'y', due: '2026-01-01', priority: 'high' }, 'x')
    expect(saveBoard(s, b)).toBe(true)
    expect(s.m.has(STORAGE_KEY)).toBe(true)
    expect(loadBoard(s)).toEqual(b)
  })

  it('returns an empty board when nothing or garbage is stored', () => {
    expect(loadBoard(memory())).toEqual(emptyBoard())
    const s = memory()
    s.setItem(STORAGE_KEY, '{not json')
    expect(loadBoard(s)).toEqual(emptyBoard())
    expect(parseBoard('42')).toBeNull()
    expect(loadBoard({ getItem: () => { throw new Error('denied') } })).toEqual(emptyBoard())
  })

  it('drops invalid cards and repairs bad fields', () => {
    const raw = JSON.stringify({
      todo: [{ id: 'a', title: 'ok', priority: 'urgent', due: 'soon' }, { id: 'b' }, null, { id: 'a', title: 'dupe' }],
      doing: 'nope',
    })
    expect(parseBoard(raw)).toEqual({
      todo: [{ id: 'a', title: 'ok', description: '', due: '', priority: 'medium' }],
      doing: [],
      done: [],
    })
  })

  it('reports failure when storage throws', () => {
    expect(saveBoard({ setItem: () => { throw new Error('quota') } }, emptyBoard())).toBe(false)
  })
})
