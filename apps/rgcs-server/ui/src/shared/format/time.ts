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

const JST = 'Asia/Tokyo'
const jstTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: JST, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const jstDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit' })
const jstHmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: JST, hour: '2-digit', minute: '2-digit', hour12: false })

/** `HH:MM:SS` in JST (Asia/Tokyo), whatever the browser's zone; for fetch status rows. */
export function jstTime(ts: number): string {
  return jstTimeFmt.format(ts).replace(/^24/, '00')
}

/** `YYYY-MM-DD HH:MM` in JST. */
export function jstDateTime(ts: number): string {
  return `${jstDateFmt.format(ts)} ${jstHmFmt.format(ts).replace(/^24/, '00')}`
}
