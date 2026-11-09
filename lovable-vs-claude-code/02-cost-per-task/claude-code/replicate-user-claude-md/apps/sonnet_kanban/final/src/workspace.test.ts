import { describe, expect, it } from 'vitest'
import { STORAGE_KEY, addCard, emptyBoard, moveCard, type Board } from './board'
import {
  DEFAULT_BOARD_NAME, WORKSPACE_KEY, activeBoard, boardList, canDeleteBoard, createBoard, deleteBoard, loadWorkspace,
  moveCardToBoard, parseWorkspace, renameBoard, saveWorkspace, setActiveBoard, totalCards, updateActiveBoard,
  workspaceFrom,
} from './workspace'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const withCards = (): Board => {
  let b = addCard(emptyBoard(), { title: 'One', description: 'd', dueDate: '2026-01-01', priority: 'high' }, 'todo', 'c1')
  b = addCard(b, { title: 'Two', priority: 'low' }, 'doing', 'c2')
  return b
}
const names = (ws: ReturnType<typeof workspaceFrom>) => boardList(ws).map((b) => b.name)

describe('create / rename', () => {
  it('creates an empty board, appends it and makes it active', () => {
    const ws = createBoard(workspaceFrom(withCards(), 'A', 'a'), '  Work   stuff ', 'b')
    expect(names(ws)).toEqual(['A', 'Work stuff'])
    expect(ws.activeId).toBe('b')
    expect(activeBoard(ws)).toEqual(emptyBoard())
    expect(totalCards(ws.boards.a.board)).toBe(2) // untouched
  })
  it('gives blank names a unique default', () => {
    let ws = workspaceFrom(emptyBoard(), 'Board 2', 'a')
    ws = createBoard(ws, '   ', 'b')
    expect(names(ws)).toEqual(['Board 2', 'Board 3'])
  })
  it('renames, trims, and rejects blank names', () => {
    const ws = workspaceFrom(emptyBoard(), 'A', 'a')
    expect(renameBoard(ws, 'a', ' New ').boards.a.name).toBe('New')
    expect(renameBoard(ws, 'a', '   ')).toBe(ws)
    expect(renameBoard(ws, 'zzz', 'x')).toBe(ws)
    expect(renameBoard(ws, 'a', 'A')).toBe(ws)
  })
  it('caps very long names', () => {
    expect(renameBoard(workspaceFrom(emptyBoard(), 'A', 'a'), 'a', 'x'.repeat(500)).boards.a.name).toHaveLength(60)
  })
})

describe('delete', () => {
  const three = () => createBoard(createBoard(workspaceFrom(emptyBoard(), 'A', 'a'), 'B', 'b'), 'C', 'c')
  it('never deletes the last board', () => {
    const ws = workspaceFrom(withCards(), 'A', 'a')
    expect(canDeleteBoard(ws)).toBe(false)
    expect(deleteBoard(ws, 'a')).toBe(ws)
  })
  it('deleting an inactive board keeps the active one', () => {
    const ws = deleteBoard(three(), 'a') // active is c
    expect(ws.order).toEqual(['b', 'c'])
    expect(ws.activeId).toBe('c')
    expect(ws.boards.a).toBeUndefined()
  })
  it('deleting the active board activates the previous, or the next if first', () => {
    expect(deleteBoard(setActiveBoard(three(), 'b'), 'b').activeId).toBe('a')
    expect(deleteBoard(setActiveBoard(three(), 'a'), 'a').activeId).toBe('b')
    expect(deleteBoard(three(), 'c').activeId).toBe('b')
  })
  it('unknown id is a no-op', () => {
    const ws = three()
    expect(deleteBoard(ws, 'nope')).toBe(ws)
  })
})

describe('active board', () => {
  it('switches only to existing boards', () => {
    const ws = createBoard(workspaceFrom(emptyBoard(), 'A', 'a'), 'B', 'b')
    expect(setActiveBoard(ws, 'a').activeId).toBe('a')
    expect(setActiveBoard(ws, 'x')).toBe(ws)
    expect(setActiveBoard(ws, 'b')).toBe(ws)
  })
  it('edits touch only the active board', () => {
    let ws = createBoard(workspaceFrom(withCards(), 'A', 'a'), 'B', 'b')
    ws = updateActiveBoard(ws, (b) => addCard(b, { title: 'In B', priority: 'low' }, 'todo', 'x'))
    expect(totalCards(ws.boards.b.board)).toBe(1)
    expect(totalCards(ws.boards.a.board)).toBe(2)
    expect(updateActiveBoard(ws, (b) => b)).toBe(ws)
  })
})

describe('moveCardToBoard', () => {
  const two = () => createBoard(workspaceFrom(withCards(), 'A', 'a'), 'B', 'b')
  it('moves the card with all its fields, appended to the chosen column', () => {
    let ws = two()
    ws = updateActiveBoard(ws, (b) => addCard(b, { title: 'Existing', priority: 'low' }, 'doing', 'e'))
    const next = moveCardToBoard(ws, 'a', 'c1', 'b', 'doing')
    expect(next.boards.a.board.cards.c1).toBeUndefined()
    expect(next.boards.a.board.columns.todo).toEqual([])
    expect(next.boards.b.board.columns.doing).toEqual(['e', 'c1'])
    expect(next.boards.b.board.cards.c1).toEqual({ id: 'c1', title: 'One', description: 'd', dueDate: '2026-01-01', priority: 'high' })
  })
  it('defaults to To do and conserves the total number of cards', () => {
    const ws = two()
    const next = moveCardToBoard(ws, 'a', 'c2', 'b')
    expect(next.boards.b.board.columns.todo).toEqual(['c2'])
    expect(totalCards(next.boards.a.board) + totalCards(next.boards.b.board)).toBe(2)
  })
  it('does not change the active board', () => {
    const ws = two()
    expect(moveCardToBoard(ws, 'a', 'c1', 'b').activeId).toBe(ws.activeId)
  })
  it('gives the card a new id when the destination already has that id', () => {
    let ws = two()
    ws = updateActiveBoard(ws, (b) => addCard(b, { title: 'Clash', priority: 'low' }, 'todo', 'c1'))
    const next = moveCardToBoard(ws, 'a', 'c1', 'b')
    expect(next.boards.b.board.columns.todo).toHaveLength(2)
    expect(new Set(next.boards.b.board.columns.todo).size).toBe(2)
    expect(next.boards.b.board.cards.c1.title).toBe('Clash')
    expect(Object.values(next.boards.b.board.cards).map((c) => c.title).sort()).toEqual(['Clash', 'One'])
  })
  it('ignores same board, unknown board, unknown card', () => {
    const ws = two()
    expect(moveCardToBoard(ws, 'a', 'c1', 'a')).toBe(ws)
    expect(moveCardToBoard(ws, 'a', 'c1', 'zzz')).toBe(ws)
    expect(moveCardToBoard(ws, 'a', 'nope', 'b')).toBe(ws)
  })
  it('a moved card can still be moved between columns afterwards', () => {
    const next = moveCardToBoard(two(), 'a', 'c1', 'b')
    const b = moveCard(next.boards.b.board, 'c1', 'done')
    expect(b.columns.done).toEqual(['c1'])
  })
})

describe('persistence and migration', () => {
  it('round-trips the workspace', () => {
    const s = mem()
    const ws = setActiveBoard(createBoard(workspaceFrom(withCards(), 'A', 'a'), 'B', 'b'), 'a')
    expect(saveWorkspace(ws, s)).toBe(true)
    expect(loadWorkspace(s)).toEqual(ws)
  })
  it('migrates the legacy single board into the first board without losing cards', () => {
    const legacy = withCards()
    const s = mem({ [STORAGE_KEY]: JSON.stringify(legacy) })
    const ws = loadWorkspace(s)
    expect(ws.order).toHaveLength(1)
    expect(boardList(ws)[0].name).toBe(DEFAULT_BOARD_NAME)
    expect(activeBoard(ws)).toEqual(legacy)
    expect(s.m.get(STORAGE_KEY)).toBe(JSON.stringify(legacy)) // backup left in place
  })
  it('prefers a saved workspace over the legacy board', () => {
    const ws = workspaceFrom(addCard(emptyBoard(), { title: 'New', priority: 'low' }, 'todo', 'n'), 'Saved', 's')
    const s = mem({ [STORAGE_KEY]: JSON.stringify(withCards()), [WORKSPACE_KEY]: JSON.stringify(ws) })
    expect(loadWorkspace(s)).toEqual(ws)
  })
  it('starts with one empty board when nothing or garbage is saved', () => {
    for (const s of [mem(), mem({ [WORKSPACE_KEY]: '{bad', [STORAGE_KEY]: 'also bad' })]) {
      const ws = loadWorkspace(s)
      expect(ws.order).toHaveLength(1)
      expect(activeBoard(ws)).toEqual(emptyBoard())
    }
  })
  it('repairs a damaged workspace: bad ids, names, active id, duplicate ids', () => {
    const ws = parseWorkspace({
      boards: { a: { name: '', board: withCards() }, b: { name: 'B', board: 'junk' } },
      order: ['a', 'ghost', 'a', 7, 'b'],
      activeId: 'gone',
    })!
    expect(ws.order).toEqual(['a', 'b'])
    expect(ws.activeId).toBe('a')
    expect(ws.boards.a.name).toBe(DEFAULT_BOARD_NAME)
    expect(ws.boards.b.board).toEqual(emptyBoard())
    expect(parseWorkspace({ boards: {}, order: [] })).toBeNull()
    expect(parseWorkspace(null)).toBeNull()
  })
  it('survives throwing storage', () => {
    const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(loadWorkspace(bad).order).toHaveLength(1)
    expect(saveWorkspace(workspaceFrom(), bad)).toBe(false)
  })
})
