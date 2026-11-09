import { useEffect, useRef } from 'react'

interface Props {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelCb = useRef(onCancel)
  cancelCb.current = onCancel

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelCb.current()
      if (e.key === 'Tab') {
        // Keep focus inside the two buttons.
        e.preventDefault()
        const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current
        next?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900 dark:ring-1 dark:ring-zinc-700"
      >
        <h2 id="confirm-title" className="text-base font-semibold">
          {title}
        </h2>
        <p id="confirm-message" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
