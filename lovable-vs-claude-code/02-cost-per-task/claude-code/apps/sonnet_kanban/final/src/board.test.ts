import { describe, expect, it } from 'vitest'
import {
  addCard, deleteCard, emptyBoard, findColumn, isOverdue, loadBoard, matchesFilters, moveCard,
  moveCardByStep, parseBoard, reorderByStep, saveBoard, todayString, updateCard, wipExceeded,
  type Board, type CardInput,
} from './board'

const input = (title: string, extra: Partial<CardInput> = {}): CardInput =>
  ({ title, description: '', dueDate: '', priority: 'medium', ...extra })

function sample(): Board {
  let b = emptyBoard()
  b = addCard(b, 'todo', input('A'), 'a')
  b = addCard(b, 'todo', input('B'), 'b')
  b = addCard(b, 'todo', input('C'), 'c')
  b = addCard(b, 'doing', input('D'), 'd')
  return b
}

describe('cards', () => {
  it('adds, trims, edits and deletes', () => {
    let b = addCard(emptyBoard(), 'todo', input('  Hi  ', { description: ' x ' }), 'a')
    expect(b.cards.a.title).toBe('Hi')
    expect(b.cards.a.description).toBe('x')
    b = updateCard(b, 'a', input('New', { priority: 'high', dueDate: '2030-01-01' }))
    expect(b.cards.a).toMatchObject({ title: 'New', priority: 'high', dueDate: '2030-01-01' })
    b = deleteCard(b, 'a')
    expect(b.cards.a).toBeUndefined()
    expect(b.columns.todo).toEqual([])
  })
  it('ignores unknown ids', () => {
    const b = sample()
    expect(deleteCard(b, 'zz')).toBe(b)
    expect(updateCard(b, 'zz', input('x'))).toBe(b)
  })
})

describe('moving', () => {
  it('reorders within a column', () => {
    expect(moveCard(sample(), 'c', 'todo', 'a').columns.todo).toEqual(['c', 'a', 'b'])
    expect(moveCard(sample(), 'a', 'todo', null).columns.todo).toEqual(['b', 'c', 'a'])
    expect(moveCard(sample(), 'a', 'todo', 'c').columns.todo).toEqual(['b', 'a', 'c'])
  })
  it('moves across columns at a position', () => {
    const b = moveCard(sample(), 'b', 'doing', 'd')
    expect(b.columns.todo).toEqual(['a', 'c'])
    expect(b.columns.doing).toEqual(['b', 'd'])
  })
  it('appends to an empty column', () => {
    expect(moveCard(sample(), 'a', 'done').columns.done).toEqual(['a'])
  })
  it('steps between columns, stopping at the edges', () => {
    let b = moveCardByStep(sample(), 'a', 1)
    expect(findColumn(b, 'a')).toBe('doing')
    expect(b.columns.doing).toEqual(['d', 'a'])
    b = moveCardByStep(b, 'a', 1)
    expect(findColumn(b, 'a')).toBe('done')
    expect(moveCardByStep(b, 'a', 1)).toBe(b)
    expect(moveCardByStep(sample(), 'a', -1).columns.todo).toEqual(['a', 'b', 'c'])
  })
  it('reorders by step', () => {
    expect(reorderByStep(sample(), 'b', -1).columns.todo).toEqual(['b', 'a', 'c'])
    expect(reorderByStep(sample(), 'b', 1).columns.todo).toEqual(['a', 'c', 'b'])
    const b = sample()
    expect(reorderByStep(b, 'a', -1)).toBe(b)
  })
  it('never duplicates a card', () => {
    const b = moveCard(moveCard(sample(), 'a', 'doing'), 'a', 'done')
    const all = [...b.columns.todo, ...b.columns.doing, ...b.columns.done]
    expect(all.filter((x) => x === 'a')).toHaveLength(1)
  })
})

describe('wip limit', () => {
  it('is exceeded only above 3 in Doing', () => {
    let b = emptyBoard()
    for (let i = 0; i < 3; i++) b = addCard(b, 'doing', input('x' + i))
    expect(wipExceeded(b)).toBe(false)
    b = addCard(b, 'doing', input('x4'))
    expect(wipExceeded(b)).toBe(true)
  })
})

describe('filters', () => {
  const card = { id: '1', title: 'Buy Milk', description: 'from the shop', dueDate: '', priority: 'low' as const }
  it('searches title and description case-insensitively', () => {
    expect(matchesFilters(card, { query: 'milk', priority: 'all' })).toBe(true)
    expect(matchesFilters(card, { query: 'SHOP', priority: 'all' })).toBe(true)
    expect(matchesFilters(card, { query: 'bread', priority: 'all' })).toBe(false)
    expect(matchesFilters(card, { query: '  ', priority: 'all' })).toBe(true)
  })
  it('filters by priority and combines with search', () => {
    expect(matchesFilters(card, { query: '', priority: 'high' })).toBe(false)
    expect(matchesFilters(card, { query: 'milk', priority: 'low' })).toBe(true)
    expect(matchesFilters(card, { query: 'bread', priority: 'low' })).toBe(false)
  })
})

describe('overdue', () => {
  const c = (dueDate: string) => ({ id: '1', title: 't', description: '', dueDate, priority: 'low' as const })
  it('flags past due cards not in Done', () => {
    expect(isOverdue(c('2020-01-01'), 'todo', '2026-01-02')).toBe(true)
    expect(isOverdue(c('2020-01-01'), 'doing', '2026-01-02')).toBe(true)
    expect(isOverdue(c('2020-01-01'), 'done', '2026-01-02')).toBe(false)
  })
  it('does not flag today, future or no date', () => {
    expect(isOverdue(c('2026-01-02'), 'todo', '2026-01-02')).toBe(false)
    expect(isOverdue(c('2026-01-03'), 'todo', '2026-01-02')).toBe(false)
    expect(isOverdue(c(''), 'todo', '2026-01-02')).toBe(false)
  })
  it('formats local dates', () => {
    expect(todayString(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('persistence', () => {
  it('round-trips through storage', () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    const b = moveCard(sample(), 'a', 'done')
    saveBoard(b, storage)
    expect(loadBoard(storage)).toEqual(b)
  })
  it('survives corrupt or hostile data', () => {
    expect(parseBoard('not json')).toEqual(emptyBoard())
    expect(parseBoard(null)).toEqual(emptyBoard())
    const raw = JSON.stringify({
      columns: { todo: ['x', 'x', 5] },
      cards: { x: { title: 'T', priority: 'bogus', dueDate: 'nope' } },
    })
    expect(parseBoard(raw)).toEqual({
      cards: { x: { id: 'x', title: 'T', description: '', dueDate: '', priority: 'medium' } },
      columns: { todo: ['x'], doing: [], done: [] },
    })
  })
  it('does not throw if storage throws', () => {
    const bad = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
    expect(loadBoard(bad)).toEqual(emptyBoard())
    expect(() => saveBoard(emptyBoard(), bad)).not.toThrow()
  })
})
