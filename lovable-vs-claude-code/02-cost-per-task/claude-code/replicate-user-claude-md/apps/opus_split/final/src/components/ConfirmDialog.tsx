import { useEffect, useId, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  message: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel()
      }}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-900/40"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-stone-600">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
