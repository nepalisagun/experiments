import { useCallback, useEffect, useRef, useState } from 'react'
import { type ColumnId, isColumnId } from './board'

// Pointer-event drag and drop: one code path for mouse, touch and pen.
// Columns carry data-column="<id>", cards carry data-card-id="<id>".

export interface DragState {
  cardId: string
  x: number
  y: number
  offsetX: number
  offsetY: number
  width: number
  over: { column: ColumnId; beforeId: string | null } | null
}

const THRESHOLD = 5
const EDGE = 64

export function useDragAndDrop(onDrop: (cardId: string, column: ColumnId, beforeId: string | null) => void) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const pending = useRef<{ cardId: string; startX: number; startY: number; rect: DOMRect; pointerId: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const update = (next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }

  const onPointerDown = useCallback((e: React.PointerEvent, cardId: string) => {
    if (e.button !== 0 || dragRef.current) return
    const cardEl = (e.currentTarget as HTMLElement).closest('[data-card-id]') as HTMLElement | null
    if (!cardEl) return
    pending.current = { cardId, startX: e.clientX, startY: e.clientY, rect: cardEl.getBoundingClientRect(), pointerId: e.pointerId }
  }, [])

  useEffect(() => {
    let scrollRaf = 0
    let lastY = 0
    let lastX = 0

    const locate = (x: number, y: number, cardId: string): DragState['over'] => {
      const el = document.elementFromPoint(x, y)
      const colEl = el?.closest('[data-column]') as HTMLElement | null
      const column = colEl?.dataset.column
      if (!colEl || !isColumnId(column)) return null
      const cards = Array.from(colEl.querySelectorAll<HTMLElement>('[data-card-id]')).filter((c) => c.dataset.cardId !== cardId)
      for (const c of cards) {
        const r = c.getBoundingClientRect()
        if (y < r.top + r.height / 2) return { column, beforeId: c.dataset.cardId! }
      }
      return { column, beforeId: null }
    }

    const autoScroll = () => {
      const d = dragRef.current
      if (!d) return
      const h = window.innerHeight
      // Speed grows as the pointer nears the edge, up to ~12px per frame.
      const dy = lastY < EDGE ? -Math.ceil((EDGE - lastY) / 5) : lastY > h - EDGE ? Math.ceil((lastY - (h - EDGE)) / 5) : 0
      if (dy) {
        window.scrollBy(0, dy)
        update({ ...d, over: locate(lastX, lastY, d.cardId) })
      }
      scrollRaf = requestAnimationFrame(autoScroll)
    }

    const move = (e: PointerEvent) => {
      const p = pending.current
      if (!p || e.pointerId !== p.pointerId) return
      lastX = e.clientX
      lastY = e.clientY
      const d = dragRef.current
      if (!d) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < THRESHOLD) return
        update({
          cardId: p.cardId,
          x: e.clientX,
          y: e.clientY,
          offsetX: p.startX - p.rect.left,
          offsetY: p.startY - p.rect.top,
          width: p.rect.width,
          over: locate(e.clientX, e.clientY, p.cardId),
        })
        document.body.classList.add('dragging')
        scrollRaf = requestAnimationFrame(autoScroll)
        return
      }
      e.preventDefault()
      update({ ...d, x: e.clientX, y: e.clientY, over: locate(e.clientX, e.clientY, d.cardId) })
    }

    const end = (e: PointerEvent, commit: boolean) => {
      const p = pending.current
      if (!p || e.pointerId !== p.pointerId) return
      pending.current = null
      const d = dragRef.current
      cancelAnimationFrame(scrollRaf)
      document.body.classList.remove('dragging')
      if (!d) return
      update(null)
      if (commit && d.over) onDropRef.current(d.cardId, d.over.column, d.over.beforeId)
      // Swallow the click that follows a drag so it doesn't open the editor.
      const swallow = (ev: Event) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    }
    const up = (e: PointerEvent) => end(e, true)
    const cancel = (e: PointerEvent) => end(e, false)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) {
        pending.current = null
        cancelAnimationFrame(scrollRaf)
        document.body.classList.remove('dragging')
        update(null)
      }
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      cancelAnimationFrame(scrollRaf)
    }
  }, [])

  return { drag, onPointerDown }
}
