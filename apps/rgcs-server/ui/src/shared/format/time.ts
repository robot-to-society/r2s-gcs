/** `HH:MM` in local time, for log pills and message rows. */
export function hhmm(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** `HH:MM:SS` in local time, for message log rows (prototype log). */
export function hhmmss(ts: number): string {
  const d = new Date(ts)
  return `${hhmm(ts)}:${String(d.getSeconds()).padStart(2, '0')}`
}
