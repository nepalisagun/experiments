import { describe, expect, it } from 'vitest'
import { STORAGE_KEY, addCard, emptyBoard, saveBoard, type CardInput } from './board'
import {
  WORKSPACE_KEY, activeBoard, addBoard, createWorkspace, deleteBoard, loadWorkspace, moveCardToBoard,
  parseWorkspace, renameBoard, saveWorkspace, setActiveBoard, updateActiveBoard, validateBoardName,
} from './boards'

const input = (title: string): CardInput => ({ title, description: 'd', dueDate: '2030-01-01', priority: 'high' })
const mem = () => {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

function two() {
  let ws = createWorkspace(addCard(addCard(emptyBoard(), 'todo', input('A'), 'a'), 'doing', input('B'), 'b'), 'Home')
  ws = addBoard(ws, 'Work', 'w')
  return setActiveBoard(ws, ws.boards[0].id)
}

describe('board management', () => {
  it('creates a board, activates it, and starts it empty', () => {
    const ws = two()
    expect(ws.boards.map((b) => b.name)).toEqual(['Home', 'Work'])
    const ws2 = addBoard(ws, '  Side  ', 's')
    expect(activeBoard(ws2).name).toBe('Side')
    expect(activeBoard(ws2).board).toEqual(emptyBoard())
  })
  it('validates names: required, unique ignoring case, max length', () => {
    const ws = two()
    expect(validateBoardName(ws, '  ')).toBe('Name is required')
    expect(validateBoardName(ws, 'work')).toMatch(/already exists/)
    expect(validateBoardName(ws, 'x'.repeat(51))).toMatch(/50/)
    expect(validateBoardName(ws, 'Work', 'w')).toBeNull() // renaming to its own name is fine
    expect(addBoard(ws, 'WORK')).toBe(ws)
  })
  it('renames', () => {
    const ws = renameBoard(two(), 'w', ' Job ')
    expect(ws.boards[1].name).toBe('Job')
    expect(renameBoard(ws, 'w', 'Home')).toBe(ws)
    expect(renameBoard(ws, 'nope', 'Zed')).toBe(ws)
  })
  it('deletes and picks a sensible active board', () => {
    let ws = setActiveBoard(two(), 'w')
    ws = deleteBoard(ws, 'w')
    expect(ws.boards).toHaveLength(1)
    expect(activeBoard(ws).name).toBe('Home')
    const ws3 = setActiveBoard(addBoard(two(), 'Third', 't'), 'w')
    expect(deleteBoard(ws3, 't').activeId).toBe('w') // deleting a non-active board keeps the active one
  })
  it('never deletes the last board', () => {
    const ws = createWorkspace()
    expect(deleteBoard(ws, ws.boards[0].id)).toBe(ws)
    const ws2 = two()
    expect(deleteBoard(ws2, 'missing')).toBe(ws2)
  })
  it('keeps cards separate per board', () => {
    let ws = setActiveBoard(two(), 'w')
    ws = updateActiveBoard(ws, (b) => addCard(b, 'done', input('Z'), 'z'))
    expect(ws.boards[0].board.columns.done).toEqual([])
    expect(ws.boards[1].board.columns.done).toEqual(['z'])
    expect(ws.boards[0].board.columns.todo).toEqual(['a'])
  })
})

describe('move card to board', () => {
  it('moves keeping the column and all fields', () => {
    const base = two()
    const ws = moveCardToBoard(base, 'b', base.boards[0].id, 'w')
    expect(ws.boards[0].board.cards.b).toBeUndefined()
    expect(ws.boards[0].board.columns.doing).toEqual([])
    expect(ws.boards[1].board.columns.doing).toEqual(['b'])
    expect(ws.boards[1].board.cards.b).toMatchObject({ title: 'B', description: 'd', dueDate: '2030-01-01', priority: 'high' })
  })
  it('appends to the end of the target column', () => {
    const base = two()
    let ws = updateActiveBoard(setActiveBoard(base, 'w'), (b) => addCard(b, 'todo', input('Q'), 'q'))
    ws = moveCardToBoard(ws, 'a', base.boards[0].id, 'w')
    expect(ws.boards[1].board.columns.todo).toEqual(['q', 'a'])
  })
  it('is a no-op for same board or unknown ids', () => {
    const ws = two()
    const home = ws.boards[0].id
    expect(moveCardToBoard(ws, 'a', home, home)).toBe(ws)
    expect(moveCardToBoard(ws, 'zz', home, 'w')).toBe(ws)
    expect(moveCardToBoard(ws, 'a', home, 'nope')).toBe(ws)
  })
  it('does not lose or duplicate cards', () => {
    const base = two()
    const ws = moveCardToBoard(base, 'a', base.boards[0].id, 'w')
    const total = ws.boards.reduce((n, b) => n + Object.keys(b.board.cards).length, 0)
    expect(total).toBe(2)
  })
})

describe('migration and persistence', () => {
  it('turns the legacy single board into the first board, keeping every card', () => {
    const s = mem()
    let legacy = emptyBoard()
    legacy = addCard(legacy, 'todo', input('A'), 'a')
    legacy = addCard(legacy, 'doing', input('B'), 'b')
    legacy = addCard(legacy, 'done', input('C'), 'c')
    saveBoard(legacy, s)
    const ws = loadWorkspace(s)
    expect(ws.boards).toHaveLength(1)
    expect(ws.boards[0].board).toEqual(legacy)
    expect(activeBoard(ws).id).toBe(ws.activeId)
  })
  it('does not touch the legacy data, and prefers the new data once saved', () => {
    const s = mem()
    const legacy = addCard(emptyBoard(), 'todo', input('A'), 'a')
    saveBoard(legacy, s)
    const ws = updateActiveBoard(loadWorkspace(s), (b) => addCard(b, 'todo', input('New'), 'n'))
    saveWorkspace(ws, s)
    expect(s.m.get(STORAGE_KEY)).toBeDefined()
    expect(loadWorkspace(s)).toEqual(ws)
    expect(loadWorkspace(s).boards[0].board.columns.todo).toEqual(['a', 'n'])
  })
  it('starts with one empty board when nothing is stored', () => {
    const ws = loadWorkspace(mem())
    expect(ws.boards).toHaveLength(1)
    expect(ws.boards[0].board).toEqual(emptyBoard())
  })
  it('round-trips multiple boards and the active one', () => {
    const s = mem()
    const ws = setActiveBoard(two(), 'w')
    saveWorkspace(ws, s)
    expect(loadWorkspace(s)).toEqual(ws)
  })
  it('repairs corrupt data', () => {
    expect(parseWorkspace('garbage', null).boards).toHaveLength(1)
    const raw = JSON.stringify({ activeId: 'nope', boards: [{ id: 'x', name: '', board: { columns: { todo: ['c'] }, cards: { c: { title: 'T' } } } }, { id: 'x', name: 'dup' }, null] })
    const ws = parseWorkspace(raw, null)
    expect(ws.boards).toHaveLength(1)
    expect(ws.activeId).toBe('x')
    expect(ws.boards[0].name).toBe('Board 1')
    expect(ws.boards[0].board.columns.todo).toEqual(['c'])
  })
  it('falls back to a board if storage throws', () => {
    const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(loadWorkspace(bad).boards).toHaveLength(1)
    expect(() => saveWorkspace(createWorkspace(), bad)).not.toThrow()
    expect(WORKSPACE_KEY).not.toBe(STORAGE_KEY)
  })
})
