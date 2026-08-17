import type { DurableTaskRecord, TaskStatus } from '../../Task.js'

function isCleared(value: unknown): boolean {
  return (
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function mergeRecord(
  prev: DurableTaskRecord,
  next: DurableTaskRecord,
): DurableTaskRecord {
  const out: DurableTaskRecord = { ...prev, id: next.id, status: next.status }
  for (const [key, value] of Object.entries(next) as [
    keyof DurableTaskRecord,
    DurableTaskRecord[keyof DurableTaskRecord],
  ][]) {
    if (value === undefined) continue
    if (isCleared(value)) {
      delete out[key]
      continue
    }
    ;(out as Record<string, unknown>)[key] = value
  }
  out.id = next.id
  out.status = next.status
  return out
}

export function mergeDurableTasks(
  existing: DurableTaskRecord[],
  current: DurableTaskRecord[],
): DurableTaskRecord[] {
  const byId = new Map(existing.map(t => [t.id, t]))
  for (const t of current) {
    const prev = byId.get(t.id)
    byId.set(t.id, prev ? mergeRecord(prev, t) : t)
  }
  return [...byId.values()]
}

/** Stubs have no process — only terminal statuses survive rehydrate. */
export function statusForStub(recorded: TaskStatus): TaskStatus {
  if (
    recorded === 'completed' ||
    recorded === 'failed' ||
    recorded === 'killed'
  ) {
    return recorded
  }
  return 'killed'
}
