import { describe, expect, it } from 'vitest'
import {
  addCard, deleteCard, dropCard, emptyBoard, isOverdue, isWipExceeded, loadBoard, matchesFilters, moveCard,
  moveCardBy, parseBoard, reorderCardBy, saveBoard, toDateString, updateCard, visibleIds, STORAGE_KEY,
  type Board, type Card,
} from './board'

const mk = (spec: Partial<Record<'todo' | 'doing' | 'done', string[]>>): Board => {
  let b = emptyBoard()
  for (const [col, ids] of Object.entries(spec))
    for (const id of ids!) b = addCard(b, { title: id.toUpperCase(), priority: 'medium' }, col as 'todo', id)
  return b
}
const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('add / edit / delete', () => {
  it('adds a trimmed card to the end of a column', () => {
    let b = addCard(emptyBoard(), { title: '  Hi ', description: ' d ', priority: 'high', dueDate: '2026-01-02' }, 'todo', 'a')
    b = addCard(b, { title: 'Two', priority: 'low' }, 'todo', 'b')
    expect(b.columns.todo).toEqual(['a', 'b'])
    expect(b.cards.a).toEqual({ id: 'a', title: 'Hi', description: 'd', dueDate: '2026-01-02', priority: 'high' })
    expect(b.cards.b.description).toBe('')
    expect(b.cards.b.dueDate).toBe('')
  })
  it('edits in place without moving', () => {
    const b = updateCard(mk({ todo: ['a', 'b'] }), 'a', { title: 'New', priority: 'high' })
    expect(b.cards.a.title).toBe('New')
    expect(b.cards.a.priority).toBe('high')
    expect(b.columns.todo).toEqual(['a', 'b'])
  })
  it('ignores edits to unknown ids', () => {
    const b = mk({ todo: ['a'] })
    expect(updateCard(b, 'zzz', { title: 'x', priority: 'low' })).toBe(b)
  })
  it('deletes from cards and columns', () => {
    const b = deleteCard(mk({ todo: ['a'], doing: ['b'] }), 'b')
    expect(b.cards.b).toBeUndefined()
    expect(b.columns.doing).toEqual([])
    expect(b.columns.todo).toEqual(['a'])
  })
  it('does not mutate its input', () => {
    const b = mk({ todo: ['a', 'b'] })
    const snap = JSON.stringify(b)
    moveCard(b, 'a', 'doing'); deleteCard(b, 'a'); updateCard(b, 'a', { title: 'x', priority: 'low' })
    expect(JSON.stringify(b)).toBe(snap)
  })
})

describe('moving', () => {
  it('moves across columns to a given index', () => {
    const b = moveCard(mk({ todo: ['a'], doing: ['x', 'y'] }), 'a', 'doing', 1)
    expect(b.columns).toEqual({ todo: [], doing: ['x', 'a', 'y'], done: [] })
  })
  it('appends when no index, clamps out-of-range', () => {
    expect(moveCard(mk({ todo: ['a'], doing: ['x'] }), 'a', 'doing').columns.doing).toEqual(['x', 'a'])
    expect(moveCard(mk({ todo: ['a'], doing: ['x'] }), 'a', 'doing', 99).columns.doing).toEqual(['x', 'a'])
    expect(moveCard(mk({ todo: ['a'], doing: ['x'] }), 'a', 'doing', -5).columns.doing).toEqual(['a', 'x'])
  })
  it('reorders within a column', () => {
    expect(moveCard(mk({ todo: ['a', 'b', 'c'] }), 'a', 'todo', 2).columns.todo).toEqual(['b', 'c', 'a'])
    expect(moveCard(mk({ todo: ['a', 'b', 'c'] }), 'c', 'todo', 0).columns.todo).toEqual(['c', 'a', 'b'])
  })
  it('never duplicates or loses cards', () => {
    const b = moveCard(mk({ todo: ['a', 'b'], doing: ['c'] }), 'b', 'done')
    expect([...b.columns.todo, ...b.columns.doing, ...b.columns.done].sort()).toEqual(['a', 'b', 'c'])
  })
  it('ignores unknown cards', () => {
    const b = mk({ todo: ['a'] })
    expect(moveCard(b, 'nope', 'done')).toBe(b)
  })
  it('keyboard column step stops at the edges', () => {
    const b = mk({ todo: ['a'] })
    expect(moveCardBy(b, 'a', -1)).toBe(b)
    const b2 = moveCardBy(moveCardBy(b, 'a', 1), 'a', 1)
    expect(b2.columns.done).toEqual(['a'])
    expect(moveCardBy(b2, 'a', 1)).toBe(b2)
    expect(moveCardBy(b2, 'a', -1).columns.doing).toEqual(['a'])
  })
  it('keyboard reorder step stops at the edges', () => {
    const b = mk({ todo: ['a', 'b', 'c'] })
    expect(reorderCardBy(b, 'a', -1)).toBe(b)
    expect(reorderCardBy(b, 'c', 1)).toBe(b)
    expect(reorderCardBy(b, 'b', -1).columns.todo).toEqual(['b', 'a', 'c'])
    expect(reorderCardBy(b, 'b', 1).columns.todo).toEqual(['a', 'c', 'b'])
  })
})

describe('dropCard', () => {
  it('drop on empty column appends', () => {
    expect(dropCard(mk({ todo: ['a'] }), 'a', 'done').columns.done).toEqual(['a'])
  })
  it('drop on a card in another column inserts before it', () => {
    expect(dropCard(mk({ todo: ['a'], doing: ['x', 'y'] }), 'a', 'y').columns.doing).toEqual(['x', 'a', 'y'])
  })
  it('drop on a card in the same column swaps into its slot', () => {
    expect(dropCard(mk({ todo: ['a', 'b', 'c'] }), 'a', 'c').columns.todo).toEqual(['b', 'c', 'a'])
    expect(dropCard(mk({ todo: ['a', 'b', 'c'] }), 'c', 'a').columns.todo).toEqual(['c', 'a', 'b'])
  })
  it('drop on itself or unknown target is a no-op', () => {
    const b = mk({ todo: ['a'] })
    expect(dropCard(b, 'a', 'a')).toBe(b)
    expect(dropCard(b, 'a', 'ghost')).toBe(b)
  })
})

describe('WIP limit', () => {
  it('warns only above 3 in Doing', () => {
    expect(isWipExceeded(mk({ doing: ['a', 'b', 'c'] }))).toBe(false)
    expect(isWipExceeded(mk({ doing: ['a', 'b', 'c', 'd'] }))).toBe(true)
    expect(isWipExceeded(mk({ todo: ['a', 'b', 'c', 'd', 'e'] }))).toBe(false)
  })
})

describe('overdue', () => {
  const card = (dueDate: string): Card => ({ id: 'a', title: 't', description: '', dueDate, priority: 'low' })
  it('is true only when strictly before today and not done', () => {
    expect(isOverdue(card('2026-11-08'), 'todo', '2026-11-09')).toBe(true)
    expect(isOverdue(card('2026-11-08'), 'doing', '2026-11-09')).toBe(true)
    expect(isOverdue(card('2026-11-09'), 'todo', '2026-11-09')).toBe(false)
    expect(isOverdue(card('2026-11-10'), 'todo', '2026-11-09')).toBe(false)
    expect(isOverdue(card('2026-11-08'), 'done', '2026-11-09')).toBe(false)
    expect(isOverdue(card(''), 'todo', '2026-11-09')).toBe(false)
  })
  it('formats local dates with zero padding', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('search and filter', () => {
  const b = (() => {
    let x = addCard(emptyBoard(), { title: 'Buy milk', description: 'from the SHOP', priority: 'low' }, 'todo', 'a')
    x = addCard(x, { title: 'Write report', description: '', priority: 'high' }, 'todo', 'b')
    x = addCard(x, { title: 'Call shop', priority: 'high' }, 'doing', 'c')
    return x
  })()
  const f = (query: string, priority: 'all' | 'low' | 'medium' | 'high' = 'all') => ({ query, priority })
  it('matches title or description, case-insensitively', () => {
    expect(visibleIds(b, 'todo', f('MILK'))).toEqual(['a'])
    expect(visibleIds(b, 'todo', f('shop'))).toEqual(['a'])
    expect(visibleIds(b, 'doing', f('shop'))).toEqual(['c'])
  })
  it('trims the query and treats blank as match-all', () => {
    expect(matchesFilters(b.cards.a, f('   '))).toBe(true)
    expect(visibleIds(b, 'todo', f('  report '))).toEqual(['b'])
  })
  it('combines with priority', () => {
    expect(visibleIds(b, 'todo', f('', 'high'))).toEqual(['b'])
    expect(visibleIds(b, 'todo', f('milk', 'high'))).toEqual([])
  })
})

describe('persistence', () => {
  it('round-trips through storage', () => {
    const s = mem()
    const b = mk({ todo: ['a', 'b'], doing: ['c'] })
    expect(saveBoard(b, s)).toBe(true)
    expect(loadBoard(s)).toEqual(b)
  })
  it('returns an empty board for missing, corrupt or wrong-shaped data', () => {
    expect(loadBoard(mem())).toEqual(emptyBoard())
    const s = mem(); s.setItem(STORAGE_KEY, '{nope')
    expect(loadBoard(s)).toEqual(emptyBoard())
    expect(parseBoard(null)).toEqual(emptyBoard())
    expect(parseBoard({ cards: 1, columns: 2 })).toEqual(emptyBoard())
  })
  it('drops malformed and duplicate cards but keeps good ones', () => {
    const b = parseBoard({
      cards: {
        a: { id: 'a', title: 'ok', priority: 'high', dueDate: 'garbage' },
        b: { id: 'b', title: '', priority: 'low' },
        c: { id: 'c', title: 'bad prio', priority: 'urgent' },
      },
      columns: { todo: ['a', 'b', 'c', 'missing', 7], doing: ['a'], done: 'x' },
    })
    expect(b.columns).toEqual({ todo: ['a'], doing: [], done: [] })
    expect(b.cards.a).toEqual({ id: 'a', title: 'ok', description: '', dueDate: '', priority: 'high' })
  })
  it('survives a throwing storage', () => {
    const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(loadBoard(bad)).toEqual(emptyBoard())
    expect(saveBoard(emptyBoard(), bad)).toBe(false)
  })
})
