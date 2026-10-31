import { ApiError } from '../../shared/api/client'
import type { Dict } from '../../shared/i18n'

/** The server's tile cap for one area (`LTE_MAX_TILES`). */
export const LTE_MAX_TILES = 3000

/** A failed LTE call in the operator's words. */
export function lteErrorText(e: unknown, dict: Dict): string {
  const code = e instanceof ApiError ? e.code : 'network'
  if (code === 'too_many_tiles') return dict.lteErrTooMany.replace('{max}', String(LTE_MAX_TILES))
  if (code === 'bad_rect') return dict.lteErrBadRect
  if (code === 'busy') return dict.lteErrBusy
  return dict.lteErrOther.replace('{code}', code)
}
