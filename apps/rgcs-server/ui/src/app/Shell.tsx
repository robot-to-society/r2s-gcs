import { useEffect, useMemo, useRef, useState } from 'react'
import { authStore } from '../features/auth/store'
import { CommandsSheet, ConfirmDialog, runCommand, type RunResult } from '../features/commands'
import { EMPTY_PENDING, clearPending, getCameraProfile, markPending, putCameraProfile, sendCameraCommand, type PendingState } from '../features/camera'
import { CameraSettingsSheet } from '../features/camera-settings'
import { PresentSettings } from '../features/present-settings'
import { DetailPanel, ackMessage } from '../features/detail'
import { buttonCommand, getGimbalProfile, putGimbalProfile, useGimbalJoystick } from '../features/gimbal-joystick'
import { GuidedModal } from '../features/guided'
import { MissionPicker, MissionView, getKnownMission, getMission, uploadSavedMission } from '../features/mission'
import { MaintView } from '../features/params'
import { FollowChip, MapView, cancelPick, vehicleHomes, clearFollow, mapUiStore, padding, rasterStyle, setFollow, setTarget, startPick, toggleAside, tracksStore, useMapUi, useTracks } from '../features/map'
import { useVehicles, vehicleStore } from '../features/vehicles/store'
import { VehicleList } from '../features/vehicles/VehicleList'
import { useAppSettings } from '../shared/api/settings'
import type { CameraCommand, CameraProfile, GimbalInputProfile, Me, VehicleCommand } from '../shared/api/types'
import { t, type Lang } from '../shared/i18n'
import { LogDock } from './LogDock'
import { useLogHistory } from '../features/log/useLogHistory'
import { Header } from './Header'
import { NO_MODAL, type Modal } from './modal'
import type { View } from './view'

function formatClock(d: Date, lang: Lang): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const wd = lang === 'ja' ? ['日', '月', '火', '水', '木', '金', '土'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} (${wd[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`
}

function useClock(lang: Lang): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return formatClock(now, lang)
}

interface Props {
  readonly me: Me
  readonly lang: Lang
}

/** The signed-in application: header, stage with floating panels, footer. */
export function Shell({ me, lang }: Props) {
  const dict = t(lang)
  const { vehicles, link, log, cameras, videoSources, deadman, missionProgress, vehicleMissions, paramProgress, flightDrafts, logFetch } = useVehicles()
  const [pending, setPending] = useState<PendingState>(EMPTY_PENDING)
  const [gimbalProfile, setGimbalProfile] = useState<GimbalInputProfile | null>(null)
  useEffect(() => {
    let alive = true
    getGimbalProfile()
      .then((p) => alive && setGimbalProfile(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const [selected, setSelected] = useState<number | null>(null)
  const [view, setView] = useState<View>('ops')
  const [modal, setModal] = useState<Modal>(NO_MODAL)
  const tracks = useTracks()
  const mapUi = useMapUi()
  const settings = useAppSettings()
  const clock = useClock(lang)
  useEffect(() => vehicleStore.subscribe(() => tracksStore.ingest(vehicleStore.getState().vehicles)), [])
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const names = new Map(list.map((v) => [v.sysid, v.name]))
  const homes = useMemo(() => vehicleHomes(vehicles, vehicleMissions), [vehicles, vehicleMissions])
  useLogHistory(link)
  const current = selected ?? list[0]?.sysid ?? null
  const currentVehicle = current === null ? undefined : vehicles.get(current)
  const detail = selected === null ? undefined : vehicles.get(selected)
  // The maintenance view takes the map's place; the right panel belongs to the operations map.
  const showDetail = detail !== undefined && view !== 'maint'
  const cameraCommand = (sysid: number, cmd: CameraCommand) => {
    setPending((p) => markPending(p, sysid, cmd.cmd, Date.now()))
    sendCameraCommand(sysid, cmd).catch((e: unknown) => {
      setPending((p) => clearPending(p, sysid))
      vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: `camera:${cmd.cmd}`, ok: false, reason: e instanceof Error ? e.message : String(e), ts: Date.now() })
    })
  }
  const logDock = <LogDock log={log} names={names} dict={dict} clock={clock.slice(-5)} lead={view !== 'maint'} deadmanLost={deadman === 'lost'} />
  const ackAlert = (sysid: number, id: number) => {
    ackMessage(sysid, id)
      .then((e) => vehicleStore.markAcked(e.id, e.acked_by ?? me.username, e.acked_at ?? Date.now()))
      .catch((e: unknown) => {
        vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: 'message_ack', ok: false, reason: e instanceof Error ? e.message : String(e), ts: Date.now() })
      })
  }
  const lastCameras = useRef(cameras)
  useEffect(
    () =>
      vehicleStore.subscribe(() => {
        // A fresh camera_state (the server re-sends at least every second) settles pending commands.
        const next = vehicleStore.getState().cameras
        if (next === lastCameras.current) return
        lastCameras.current = next
        setPending((p) => [...next.keys()].reduce((acc, sysid) => clearPending(acc, sysid), p))
      }),
    [],
  )
  const [settingsProfile, setSettingsProfile] = useState<CameraProfile | null>(null)
  useEffect(() => {
    if (modal.kind !== 'camera-settings') return
    let alive = true
    getCameraProfile(modal.sysid)
      .then((p) => alive && setSettingsProfile(p))
      .catch(() => alive && setSettingsProfile(null))
    return () => {
      alive = false
    }
  }, [modal])
  const saveSettings = async (sysid: number, camera: Partial<CameraProfile>, input: GimbalInputProfile) => {
    try {
      await putCameraProfile(sysid, camera)
      const saved = await putGimbalProfile(input)
      setGimbalProfile(saved)
      vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: 'camera_settings', ok: true, reason: null, ts: Date.now() })
    } catch (e: unknown) {
      vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: 'camera_settings', ok: false, reason: e instanceof Error ? e.message : String(e), ts: Date.now() })
    }
    setModal(NO_MODAL)
  }
  useGimbalJoystick(current, gimbalProfile, (fn) => {
    if (current === null) return
    const cmd = buttonCommand(fn, cameras.get(current)?.state ?? null)
    if (cmd) cameraCommand(current, cmd)
  })

  // A reloaded page (or a second laptop) learns the vehicle's mission from the server.
  const knownMissing = current !== null && !vehicleMissions.has(current)
  useEffect(() => {
    if (current === null || !knownMissing) return
    let alive = true
    getKnownMission(current)
      .then((m) => alive && m && vehicleStore.setVehicleMission(current, m))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [current, knownMissing])

  const writeSavedMission = async (sysid: number, id: number) => {
    setModal(NO_MODAL)
    try {
      const report = await uploadSavedMission(sysid, id)
      if (report.verified) vehicleStore.setVehicleMission(sysid, { ...(await getMission(id)), sysid })
      vehicleStore.pushLocalResult({
        id: -Date.now(),
        sysid,
        cmd: 'mission_upload',
        ok: report.verified,
        reason: report.verified ? `${report.items} ${dict.mItems}, ${dict.mVerified}` : `${dict.mMismatch}: ${report.mismatched.join(', ')}`,
        ts: Date.now(),
      })
    } catch (e: unknown) {
      vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: 'mission_upload', ok: false, reason: e instanceof Error ? e.message : String(e), ts: Date.now() })
    }
  }

  const settle = (sysid: number, result: RunResult, command: VehicleCommand) => {
    if (result.kind === 'needs_confirm') return setModal({ kind: 'confirm', sysid, command, message: result.message })
    if (result.kind === 'error') {
      vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd: command.cmd, ok: false, reason: result.message, ts: Date.now() })
    }
    setModal(NO_MODAL)
  }
  return (
    <div className="shell">
      <div className="frame">
        <Header
          vehicles={list}
          link={link}
          dict={dict}
          clock={clock}
          me={me}
          view={view}
          onView={setView}
          onLogout={() => void authStore.logout()}
          onPresent={() => setModal({ kind: 'present-settings' })}
        />
        {view === 'mission' && settings && (
          <main className="stage mission" style={{ position: 'absolute', inset: 0 }}>
            <MissionView vehicles={vehicles} dict={dict} style={rasterStyle(settings.map_tile_url, settings.map_attribution)} />
            {logDock}
          </main>
        )}
        <main className={`stage${showDetail ? '' : ' noright'}${mapUi.aside === 'rail' ? ' rail' : ''}${view === 'maint' ? ' maint-on' : ''}`} style={{ position: 'absolute', inset: 0, display: view === 'mission' ? 'none' : undefined }}>
          {settings && (
            <MapView
              vehicles={vehicles}
              tracks={tracks}
              follow={mapUi.follow}
              selected={current}
              padding={padding(mapUi.aside, detail !== undefined)}
              style={rasterStyle(settings.map_tile_url, settings.map_attribution)}
              target={mapUi.target}
              mission={current === null ? null : (vehicleMissions.get(current) ?? null)}
              missionCurrent={current === null ? null : (missionProgress.get(current)?.seq ?? null)}
              homes={homes}
              cameras={cameras}
              groundProjection={settings.map.gimbal_ground_projection}
              onDragStart={() => mapUiStore.update(clearFollow)}
              onClick={(p) => mapUi.pick === 'guided-target' && mapUiStore.update((s) => setTarget(s, p))}
            />
          )}
          {view === 'maint' && (
            <>
              <div className="maint-backdrop" />
              <MaintView vehicles={vehicles} paramProgress={paramProgress} dict={dict} selected={current} onSelect={setSelected} me={me} flightDrafts={flightDrafts} logFetch={logFetch} onOpenPresent={() => setModal({ kind: 'present-settings' })} />
            </>
          )}
          <VehicleList
            vehicles={list}
            selected={current}
            dict={dict}
            aside={mapUi.aside}
            onToggleAside={() => mapUiStore.update(toggleAside)}
            onSelect={setSelected}
            onFollow={(sysid) => mapUiStore.update((s) => (s.follow === sysid ? clearFollow(s) : setFollow(s, sysid)))}
            following={mapUi.follow}
          />
          {mapUi.follow !== null && view !== 'maint' && (
            <FollowChip name={vehicles.get(mapUi.follow)?.name ?? `#${mapUi.follow}`} dict={dict} onClear={() => mapUiStore.update(clearFollow)} />
          )}
          {detail && showDetail && (
            <DetailPanel
              vehicle={detail}
              entries={log.entries}
              dict={dict}
              onAck={ackAlert}
              onOpenLog={(sysid) => vehicleStore.logAction({ k: 'open', filter: sysid })}
              onClose={() => setSelected(null)}
              onOpenCommands={() => setModal({ kind: 'commands', sysid: detail.sysid })}
              camera={cameras.get(detail.sysid)}
              videoSource={videoSources.get(detail.sysid)}
              cameraPending={pending.bySysid.has(detail.sysid)}
              onCameraCommand={(cmd) => cameraCommand(detail.sysid, cmd)}
              onCameraSettings={() => setModal({ kind: 'camera-settings', sysid: detail.sysid })}
              vehicleMission={vehicleMissions.get(detail.sysid)}
              missionProgress={missionProgress.get(detail.sysid)}
              onWriteMission={() => setModal({ kind: 'mission-pick', sysid: detail.sysid })}
              onStartMission={() => setModal({ kind: 'confirm', sysid: detail.sysid, command: { cmd: 'mission_start' } })}
              commandsOpen={modal.kind === 'commands'}
            />
          )}
          {modal.kind === 'commands' && currentVehicle && (
            <CommandsSheet
              vehicle={currentVehicle}
              dict={dict}
              beside={detail !== undefined}
              onClose={() => setModal(NO_MODAL)}
              onOpen={(target) => target === 'guided' && setModal({ kind: 'guided', sysid: currentVehicle.sysid })}
              onPick={(command) => void runCommand(currentVehicle.sysid, command).then((r) => settle(currentVehicle.sysid, r, command))}
            />
          )}
          {modal.kind === 'guided' && currentVehicle && (
            <GuidedModal
              vehicle={currentVehicle}
              target={mapUi.target}
              dict={dict}
              onPickTarget={() => mapUiStore.update((s) => startPick(s, 'guided-target'))}
              onClose={() => {
                mapUiStore.update(cancelPick)
                setModal(NO_MODAL)
              }}
              onSwitchToGuided={() => setModal({ kind: 'confirm', sysid: currentVehicle.sysid, command: { cmd: 'set_mode', args: { mode: 'GUIDED' } } })}
              onDone={(outcome) => {
                if (outcome.kind === 'error') {
                  vehicleStore.pushLocalResult({ id: -Date.now(), sysid: currentVehicle.sysid, cmd: 'guided', ok: false, reason: outcome.message, ts: Date.now() })
                }
                setModal(NO_MODAL)
              }}
            />
          )}
          {modal.kind === 'camera-settings' && settingsProfile && gimbalProfile && (
            <CameraSettingsSheet
              sysid={modal.sysid}
              profile={settingsProfile}
              inputProfile={gimbalProfile}
              cameraState={cameras.get(modal.sysid)?.state}
              gamepadIds={typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads().flatMap((g) => (g ? [g.id] : [])) : []}
              dict={dict}
              onCancel={() => setModal(NO_MODAL)}
              onCenter={() => cameraCommand(modal.sysid, { cmd: 'gimbal_center', args: { mode: 'one_key_reset' } })}
              onSave={(camera, input) => void saveSettings(modal.sysid, camera, input)}
            />
          )}
          {modal.kind === 'mission-pick' && (
            <MissionPicker dict={dict} title={dict.mWriteMission} onClose={() => setModal(NO_MODAL)} onPick={(row) => void writeSavedMission(modal.sysid, row.id)} />
          )}
          {modal.kind === 'present-settings' && (
            <PresentSettings isAdmin={me.role === 'admin'} logo={false} dict={dict} onClose={() => setModal(NO_MODAL)} />
          )}
          {modal.kind === 'confirm' && (
            <ConfirmDialog
              sysid={modal.sysid}
              command={modal.command}
              message={modal.message}
              vehicleName={vehicles.get(modal.sysid)?.name ?? `#${modal.sysid}`}
              dict={dict}
              onCancel={() => setModal(NO_MODAL)}
              onDone={(r) => settle(modal.sysid, r, modal.command)}
            />
          )}
          {view !== 'mission' && logDock}
        </main>
      </div>
    </div>
  )
}
