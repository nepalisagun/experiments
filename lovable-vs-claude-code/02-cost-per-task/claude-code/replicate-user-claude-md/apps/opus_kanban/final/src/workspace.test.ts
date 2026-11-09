import { describe, expect, it } from 'vitest'
import { addCard, type Board, type Card, emptyBoard, STORAGE_KEY as LEGACY_KEY, moveCard } from './board'
import {
  activeBoard,
  BACKUP_KEY,
  canDeleteBoard,
  createBoard,
  DEFAULT_BOARD_NAME,
  deleteBoard,
  loadWorkspace,
  moveCardToBoard,
  newWorkspace,
  parseWorkspace,
  renameBoard,
  saveWorkspace,
  switchBoard,
  updateBoardColumns,
  validateBoardName,
  WORKSPACE_KEY,
  type Workspace,
} from './workspace'

const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, title: `Card ${id}`, description: '', due: '', priority: 'medium', ...extra })
const cols = (todo: string[] = [], doing: string[] = [], done: string[] = []): Board => ({
  todo: todo.map((id) => card(id)),
  doing: doing.map((id) => card(id)),
  done: done.map((id) => card(id)),
})
const ids = (b: Board) => ({ todo: b.todo.map((c) => c.id), doing: b.doing.map((c) => c.id), done: b.done.map((c) => c.id) })

/** Two boards: A (active) and B. */
const twoBoards = (): Workspace => ({
  activeBoardId: 'A',
  boards: [
    { id: 'A', name: 'Work', columns: cols(['a1', 'a2'], ['a3'], ['a4']) },
    { id: 'B', name: 'Home', columns: cols(['b1']) },
  ],
})

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('board names', () => {
  it('trims, collapses spaces, and rejects empty, too long and duplicate names', () => {
    const ws = twoBoards()
    expect(validateBoardName(ws, '  Side   project ')).toEqual({ name: 'Side project', error: null })
    expect(validateBoardName(ws, '   ').error).toBe('Board name is required.')
    expect(validateBoardName(ws, 'x'.repeat(61)).error).toMatch(/at most 60/)
    expect(validateBoardName(ws, 'x'.repeat(60)).error).toBeNull()
    expect(validateBoardName(ws, 'work').error).toBe('A board with this name already exists.')
    expect(validateBoardName(ws, 'WORK', 'A').error).toBeNull() // renaming a board to itself (case change) is fine
  })
})

describe('create / rename / switch / delete boards', () => {
  it('creates an empty board at the end and makes it active', () => {
    const ws = createBoard(twoBoards(), ' Garden ', 'C')
    expect(ws.boards.map((b) => b.name)).toEqual(['Work', 'Home', 'Garden'])
    expect(ws.activeBoardId).toBe('C')
    expect(activeBoard(ws).columns).toEqual(emptyBoard())
  })

  it('refuses invalid names without changing anything', () => {
    const ws = twoBoards()
    expect(createBoard(ws, '')).toBe(ws)
    expect(createBoard(ws, 'home')).toBe(ws)
    expect(renameBoard(ws, 'A', 'Home')).toBe(ws)
    expect(renameBoard(ws, 'nope', 'Other')).toBe(ws)
  })

  it('renames a board and keeps its cards', () => {
    const ws = renameBoard(twoBoards(), 'B', 'Household')
    expect(ws.boards[1].name).toBe('Household')
    expect(ids(ws.boards[1].columns).todo).toEqual(['b1'])
    expect(ws.activeBoardId).toBe('A')
  })

  it('switches the active board', () => {
    const ws = twoBoards()
    expect(switchBoard(ws, 'B').activeBoardId).toBe('B')
    expect(switchBoard(ws, 'A')).toBe(ws)
    expect(switchBoard(ws, 'missing')).toBe(ws)
  })

  it('never deletes the last board', () => {
    const ws = newWorkspace(emptyBoard(), 'only')
    expect(canDeleteBoard(ws)).toBe(false)
    expect(deleteBoard(ws, 'only')).toBe(ws)
  })

  it('deleting the active board activates its neighbour', () => {
    let ws = createBoard(twoBoards(), 'Third', 'C') // A, B, C
    ws = switchBoard(ws, 'B')
    expect(deleteBoard(ws, 'B').activeBoardId).toBe('C') // next one
    ws = switchBoard(ws, 'C')
    expect(deleteBoard(ws, 'C').activeBoardId).toBe('B') // last one: previous
    const kept = deleteBoard(ws, 'A')
    expect(kept.activeBoardId).toBe('C') // deleting another board keeps the active one
    expect(kept.boards.map((b) => b.id)).toEqual(['B', 'C'])
    expect(deleteBoard(ws, 'missing')).toBe(ws)
  })
})

describe('boards are independent', () => {
  it('updates only the given board', () => {
    const base = twoBoards()
    const ws = updateBoardColumns(base, 'B', (c) => addCard(c, 'doing', { title: 'x', description: '', due: '', priority: 'low' }, 'bx'))
    expect(ids(ws.boards[1].columns).doing).toEqual(['bx'])
    expect(ws.boards[0]).toBe(base.boards[0]) // board A is untouched
    expect(ids(base.boards[1].columns).doing).toEqual([]) // input not mutated
  })

  it('returns the same workspace when the board update is a no-op', () => {
    const ws = twoBoards()
    expect(updateBoardColumns(ws, 'A', (c) => moveCard(c, 'a1', 'todo', 'a2'))).toBe(ws)
    expect(updateBoardColumns(ws, 'missing', () => emptyBoard())).toBe(ws)
  })
})

describe('moveCardToBoard', () => {
  it('moves a card to the same column on the other board, at the end, with all its data', () => {
    const ws0 = twoBoards()
    ws0.boards[0].columns.todo[1] = card('a2', { title: 'Taxes', description: 'd', due: '2026-04-30', priority: 'high' })
    const ws = moveCardToBoard(ws0, 'a2', 'A', 'B')
    expect(ids(ws.boards[0].columns).todo).toEqual(['a1'])
    expect(ids(ws.boards[1].columns).todo).toEqual(['b1', 'a2'])
    expect(ws.boards[1].columns.todo[1]).toEqual(ws0.boards[0].columns.todo[1])
    expect(ws.activeBoardId).toBe('A')
  })

  it('can target a different column', () => {
    const ws = moveCardToBoard(twoBoards(), 'a3', 'A', 'B', 'done')
    expect(ids(ws.boards[0].columns).doing).toEqual([])
    expect(ids(ws.boards[1].columns).done).toEqual(['a3'])
  })

  it('ignores unknown cards, unknown boards and same-board moves', () => {
    const ws = twoBoards()
    expect(moveCardToBoard(ws, 'zz', 'A', 'B')).toBe(ws)
    expect(moveCardToBoard(ws, 'a1', 'A', 'Z')).toBe(ws)
    expect(moveCardToBoard(ws, 'a1', 'A', 'A')).toBe(ws)
    expect(moveCardToBoard(ws, 'b1', 'A', 'B')).toBe(ws) // b1 is not on A
  })

  it('gives the card a fresh id if the target already has that id', () => {
    const ws0 = twoBoards()
    ws0.boards[1].columns.todo = [card('a1')]
    const ws = moveCardToBoard(ws0, 'a1', 'A', 'B')
    const moved = ws.boards[1].columns.todo
    expect(moved).toHaveLength(2)
    expect(new Set(moved.map((c) => c.id)).size).toBe(2)
  })

  it('does not mutate the input', () => {
    const ws = twoBoards()
    const snap = JSON.stringify(ws)
    moveCardToBoard(ws, 'a1', 'A', 'B')
    deleteBoard(ws, 'A')
    renameBoard(ws, 'A', 'x')
    expect(JSON.stringify(ws)).toBe(snap)
  })
})

describe('persistence and migration', () => {
  it('round-trips a workspace', () => {
    const s = memory()
    const ws = createBoard(twoBoards(), 'Third', 'C')
    expect(saveWorkspace(s, ws)).toBe(true)
    expect(loadWorkspace(s)).toEqual(ws)
  })

  it('turns the old single saved board into the first board, keeping every card and its order', () => {
    const legacy: Board = {
      todo: [card('t1', { title: 'Write', description: 'report', due: '2020-01-01', priority: 'high' }), card('t2')],
      doing: [card('d1'), card('d2'), card('d3'), card('d4')],
      done: [card('x1', { priority: 'low' })],
    }
    const s = memory({ [LEGACY_KEY]: JSON.stringify(legacy) })
    const ws = loadWorkspace(s)
    expect(ws.boards).toHaveLength(1)
    expect(ws.boards[0].name).toBe(DEFAULT_BOARD_NAME)
    expect(ws.boards[0].columns).toEqual(legacy)
    expect(ws.activeBoardId).toBe(ws.boards[0].id)
    expect(s.m.get(LEGACY_KEY)).toBe(JSON.stringify(legacy)) // old data left in place
  })

  it('prefers the saved workspace over the legacy board', () => {
    const s = memory({ [LEGACY_KEY]: JSON.stringify(cols(['old'])), [WORKSPACE_KEY]: JSON.stringify(twoBoards()) })
    expect(loadWorkspace(s)).toEqual(twoBoards())
  })

  it('starts with one empty board when nothing is saved', () => {
    const ws = loadWorkspace(memory())
    expect(ws.boards).toHaveLength(1)
    expect(ws.boards[0].columns).toEqual(emptyBoard())
  })

  it('backs up unreadable workspace data, then falls back to the legacy board', () => {
    const s = memory({ [WORKSPACE_KEY]: '{oops', [LEGACY_KEY]: JSON.stringify(cols(['keep'])) })
    const ws = loadWorkspace(s)
    expect(ids(ws.boards[0].columns).todo).toEqual(['keep'])
    expect(s.m.get(BACKUP_KEY)).toBe('{oops')
  })

  it('survives storage that throws', () => {
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadWorkspace(throwing).boards).toHaveLength(1)
    expect(saveWorkspace(throwing, twoBoards())).toBe(false)
  })

  it('repairs bad boards: drops unusable ones, fixes names and a dangling active id', () => {
    const raw = JSON.stringify({
      activeBoardId: 'gone',
      boards: [
        { id: 'A', name: '  Work ', columns: { todo: [{ id: 'c', title: 'ok' }] } },
        { id: 'A', name: 'dupe id', columns: {} },
        { name: 'no id', columns: {} },
        null,
        { id: 'B', name: 'work', columns: { doing: 'bad' } },
        { id: 'C', name: '', columns: undefined },
      ],
    })
    const ws = parseWorkspace(raw)!
    expect(ws.boards.map((b) => [b.id, b.name])).toEqual([['A', 'Work'], ['B', 'work (2)'], ['C', 'Board 3']])
    expect(ws.activeBoardId).toBe('A')
    expect(ws.boards[0].columns.todo[0].title).toBe('ok')
    expect(parseWorkspace(JSON.stringify({ boards: [] }))).toBeNull()
    expect(parseWorkspace('[]')).toBeNull()
    expect(parseWorkspace(null)).toBeNull()
  })
})
