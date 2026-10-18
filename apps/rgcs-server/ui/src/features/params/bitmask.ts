// Bitmask parameters (ArduPilot `@Bitmask`, e.g. LOG_BITMASK, ARMING_CHECK): the value is an
// int32 whose bits are named; the helper edits bits and leaves undocumented bits untouched.

const BITS = 32

/** Bit numbers set in `value` (0 = least significant). */
export function bitsOf(value: number): number[] {
  const u = Math.trunc(value) >>> 0
  return Array.from({ length: BITS }, (_, b) => b).filter((b) => (u >>> b) & 1)
}

/** `value` with one bit set or cleared; a negative input stays signed (int32), others unsigned. */
export function withBit(value: number, bit: number, on: boolean): number {
  const mask = (1 << bit) >>> 0
  const u = Math.trunc(value) >>> 0
  const next = (on ? u | mask : u & ~mask) >>> 0
  return value < 0 ? next | 0 : next
}

/** Set bits that the metadata does not name (kept as they are). */
export function unknownBits(value: number, names: Readonly<Record<string, string>>): number[] {
  return bitsOf(value).filter((b) => !(String(b) in names))
}
