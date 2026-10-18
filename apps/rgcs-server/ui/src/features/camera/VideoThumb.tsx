import { useEffect, useRef, useState } from 'react'
import type { RecordingState, VideoSourceStatus } from '../../shared/api/types'
import { CSRF_HEADER, CSRF_VALUE } from '../../shared/api/client'
import type { Dict } from '../../shared/i18n'
import { WhepPlayer } from '../../shared/video/whep'
import type { PlayerState } from '../../shared/video/state'
import { recDuration } from './format'
import { whepUrl } from './api'
import { IconMaximize } from '../../shared/ui/icons'

interface Props {
  readonly sysid: number
  readonly status: VideoSourceStatus | undefined
  readonly recording: RecordingState
  readonly dict: Dict
}

/** 16:9 thumbnail in the detail panel (spec 10 §3.3 item 2), fed by WHEP when a source is live. */
export function VideoThumb({ sysid, status, recording, dict }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<PlayerState['phase']>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const live = status !== undefined && status.source !== 'none'

  useEffect(() => {
    const video = videoRef.current
    if (!live || !video) return
    const player = new WhepPlayer(video, whepUrl(sysid), {
      headers: { [CSRF_HEADER]: CSRF_VALUE },
      onState: (s) => setPhase(s.phase),
    })
    player.start()
    return () => player.stop()
  }, [live, sysid])

  useEffect(() => {
    if (recording !== 'recording') return undefined
    // The timer owns the clock: state is only touched from its callbacks, never in the effect body.
    const start = Date.now()
    const tick = () => setElapsedMs(Date.now() - start)
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [recording])

  return (
    <div className="detail-video">
      {live ? <video ref={videoRef} className="feed" muted autoPlay playsInline /> : <span className="t3">{dict.videoNotConnected}</span>}
      {recording === 'recording' && (
        <span className="pill pill-rec detail-rec">
          <span className="rdot" /> AUTO REC <span className="num">{recDuration(0, elapsedMs)}</span>
        </span>
      )}
      {live && phase === 'reconnecting' && <span className="hint caution detail-reconnect">{dict.reconnecting}</span>}
      <button type="button" className="g-ctl btn-icon maximize" aria-label={dict.maximize} title={dict.maximize} disabled>
        <IconMaximize />
      </button>
    </div>
  )
}
