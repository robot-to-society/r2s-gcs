import { useRef } from 'react'
import type { Dict } from '../../shared/i18n'
import type { Busy, Tool } from './store'

interface Props {
  readonly tool: Tool
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly dirty: boolean
  readonly busy: Busy
  readonly hasVehicle: boolean
  readonly dict: Dict
  readonly onTool: (tool: Tool) => void
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onNew: () => void
  readonly onOpen: () => void
  readonly onSave: () => void
  readonly onFileWaypoints: () => void
  readonly onFileRgcs: () => void
  readonly onFile: (file: File) => void
  readonly onWrite: () => void
  readonly onRead: () => void
}

/** Footer bar of the mission view (spec 10 §6): tools, history, storage, files, vehicle I/O. */
export function MissionFooter(p: Props) {
  const file = useRef<HTMLInputElement>(null)
  const idle = p.busy === 'idle'
  return (
    <div className="mission-footer" data-testid="mission-footer">
      <div className="seg sm" role="group" aria-label="tool">
        <button type="button" className={p.tool === 'add' ? 'on' : ''} onClick={() => p.onTool('add')}>
          {p.dict.mToolAdd}
        </button>
        <button type="button" className={p.tool === 'select' ? 'on' : ''} onClick={() => p.onTool('select')}>
          {p.dict.mToolSelect}
        </button>
      </div>
      <span className="sep" />
      <button type="button" className="btn btn-ghost btn-sm" disabled={!p.canUndo} onClick={p.onUndo}>
        {p.dict.mUndo}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!p.canRedo} onClick={p.onRedo}>
        {p.dict.mRedo}
      </button>
      <span className="sep" />
      <button type="button" className="btn btn-ghost btn-sm" onClick={p.onNew}>
        {p.dict.mNew}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={p.onOpen}>
        {p.dict.mOpen}
      </button>
      <button type="button" className="btn btn-primary btn-sm" disabled={!idle} onClick={p.onSave}>
        {p.dict.mSave}
      </button>
      {p.dirty && <span className="dirty">{p.dict.mDirty}</span>}
      <span className="sep" />
      <button type="button" className="btn btn-ghost btn-sm" disabled={!idle} onClick={p.onFileWaypoints}>
        {p.dict.mFileWaypoints}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={p.onFileRgcs}>
        {p.dict.mFileRgcs}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => file.current?.click()}>
        {p.dict.mFileLoad}
      </button>
      <input
        ref={file}
        type="file"
        accept=".waypoints,.rgcsmission,.txt,text/plain,application/json"
        style={{ display: 'none' }}
        data-testid="mission-file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) p.onFile(f)
          e.target.value = ''
        }}
      />
      <span className="grow" />
      <button type="button" className="btn btn-ghost btn-sm" disabled={!idle || !p.hasVehicle} onClick={p.onRead}>
        {p.dict.mRead}
      </button>
      <button type="button" className="btn btn-primary btn-sm" disabled={!idle || !p.hasVehicle} onClick={p.onWrite}>
        {p.dict.mWrite}
      </button>
    </div>
  )
}
