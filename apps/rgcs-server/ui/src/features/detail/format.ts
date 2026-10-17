import type { Dict } from '../../shared/i18n'

export type SeverityClass = 'danger' | 'caution' | 'info'

/** MAV_SEVERITY: 0–3 emergency…error, 4 warning, 5–7 notice…debug. */
export function severityClass(severity: number): SeverityClass {
  if (severity <= 3) return 'danger'
  if (severity === 4) return 'caution'
  return 'info'
}

const LINK_CODES: Record<string, keyof Dict> = { comms_delay: 'commsDelay', link_lost: 'linkLost', link_restored: 'linkRestored' }

/** Server-minted link codes are translated; text from the vehicle is shown verbatim (spec 00 §5). */
export function messageText(text: string, dict: Dict): string {
  const key = LINK_CODES[text]
  return key ? dict[key] : text
}
