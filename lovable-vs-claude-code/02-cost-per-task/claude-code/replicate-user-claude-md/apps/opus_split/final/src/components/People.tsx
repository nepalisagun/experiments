import { useState } from 'react'
import { validatePersonName, type Person } from '../lib/bill'

interface Props {
  people: Person[]
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}

export function People({ people, onAdd, onRename, onRemove }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validatePersonName(name, people)
    setError(err)
    if (err) return
    onAdd(name.trim())
    setName('')
  }

  return (
    <section className="card" aria-labelledby="people-title">
      <h2 id="people-title" className="card-title">
        People <span className="font-normal text-stone-500">({people.length})</span>
      </h2>
      <form onSubmit={add} noValidate>
        <div className="flex gap-2">
          <label htmlFor="new-person" className="sr-only">
            New person's name
          </label>
          <input
            id="new-person"
            className="input"
            placeholder="Add a person, e.g. Alex"
            value={name}
            maxLength={60}
            aria-invalid={!!error}
            aria-describedby={error ? 'new-person-error' : undefined}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
          />
          <button type="submit" className="btn-primary">
            Add
          </button>
        </div>
        {error && (
          <p id="new-person-error" role="alert" className="error-text">
            {error}
          </p>
        )}
      </form>

      {people.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">No one yet. Add everyone who was at the dinner.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {people.map((p) => (
            <PersonRow key={p.id} person={p} people={people} onRename={onRename} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PersonRow({
  person,
  people,
  onRename,
  onRemove,
}: {
  person: Person
  people: Person[]
  onRename: Props['onRename']
  onRemove: Props['onRemove']
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(person.name)
  const [error, setError] = useState<string | null>(null)
  const errId = `rename-error-${person.id}`

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validatePersonName(draft, people, person.id)
    setError(err)
    if (err) return
    onRename(person.id, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="py-2">
        <form onSubmit={save} noValidate className="flex flex-wrap gap-2">
          <input
            className="input flex-1 basis-40"
            aria-label={`New name for ${person.name}`}
            value={draft}
            maxLength={60}
            autoFocus
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
            onChange={(e) => {
              setDraft(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditing(false)
                setError(null)
              }
            }}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
        {error && (
          <p id={errId} role="alert" className="error-text">
            {error}
          </p>
        )}
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2 py-2">
      <span className="flex-1 truncate font-medium">{person.name}</span>
      <button
        type="button"
        className="btn-ghost"
        aria-label={`Rename ${person.name}`}
        onClick={() => {
          setDraft(person.name)
          setEditing(true)
        }}
      >
        Rename
      </button>
      <button
        type="button"
        className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
        aria-label={`Remove ${person.name}`}
        onClick={() => onRemove(person.id)}
      >
        Remove
      </button>
    </li>
  )
}
