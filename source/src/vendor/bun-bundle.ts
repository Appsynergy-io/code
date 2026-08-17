/** External build: every bun:bundle feature() gate is off. */

export function feature(_name: string): false {
  return false
}
