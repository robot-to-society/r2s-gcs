export function zoomText(zoom: number): string {
  return `${zoom.toFixed(1)}×`
}

/** Typographic minus, one decimal, degree sign. */
export function angleText(deg: number): string {
  const v = Math.abs(deg).toFixed(1)
  return `${deg < 0 ? '−' : ''}${v}°`
}

export function recDuration(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}
