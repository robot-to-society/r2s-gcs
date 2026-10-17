import { useEffect } from 'react'
import type { Me } from '../shared/api/types'
import type { Dict } from '../shared/i18n'

interface Props {
  readonly me: Me
  readonly onLogout: () => void
  readonly onClose: () => void
  readonly onPresent?: () => void
  readonly dict: Dict
}

/** `.pop` under the username (spec 10 §1): name, role, audit note, logout. */
export function UserPopover({ me, onLogout, onClose, onPresent, dict }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="g-strong pop" role="dialog" aria-label={me.username}>
      <div className="pop-user">{me.username}</div>
      <div className="t3">{me.role === 'admin' ? dict.roleAdmin : dict.roleOperator}</div>
      <div className="t3 pop-note">{dict.auditNote}</div>
      {onPresent && (
        <button type="button" className="btn btn-ghost" onClick={onPresent}>
          {dict.presentTitle}
        </button>
      )}
      <button type="button" className="btn btn-ghost" onClick={onLogout}>
        {dict.logout}
      </button>
    </div>
  )
}
