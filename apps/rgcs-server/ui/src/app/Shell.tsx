import { useEffect, useState } from 'react'
import { authStore } from '../features/auth/store'
import { CommandsSheet, ConfirmDialog, runCommand, type RunResult } from '../features/commands'
import { DetailPanel, EMPTY_MESSAGES, ack, type MessagesState } from '../features/detail'
import { FollowChip, MapView, clearFollow, mapUiStore, padding, rasterStyle, setFollow, tracksStore, useMapUi, useTracks } from '../features/map'
import { useVehicles, vehicleStore } from '../features/vehicles/store'
import { VehicleList } from '../features/vehicles/VehicleList'
import { useAppSettings } from '../shared/api/settings'
import type { Me, VehicleCommand } from '../shared/api/types'
import { t, type Lang } from '../shared/i18n'
import { Footer } from './Footer'
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
  const { vehicles, link, results, messages } = useVehicles()
  const [selected, setSelected] = useState<number | null>(null)
  const [acks, setAcks] = useState<MessagesState>(EMPTY_MESSAGES)
  const [view, setView] = useState<View>('ops')
  const [modal, setModal] = useState<Modal>(NO_MODAL)
  const tracks = useTracks()
  const mapUi = useMapUi()
  const settings = useAppSettings()
  const clock = useClock(lang)
  useEffect(() => vehicleStore.subscribe(() => tracksStore.ingest(vehicleStore.getState().vehicles)), [])
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const current = selected ?? list[0]?.sysid ?? null
  const currentVehicle = current === null ? undefined : vehicles.get(current)
  const detail = selected === null ? undefined : vehicles.get(selected)

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
        />
        <main className={`stage${detail ? '' : ' noright'}${mapUi.aside === 'rail' ? ' rail' : ''}`} style={{ position: 'absolute', inset: 0 }}>
          {settings && (
            <MapView
              vehicles={vehicles}
              tracks={tracks}
              follow={mapUi.follow}
              selected={current}
              padding={padding(mapUi.aside, detail !== undefined)}
              style={rasterStyle(settings.map_tile_url, settings.map_attribution)}
              target={mapUi.target}
              onDragStart={() => mapUiStore.update(clearFollow)}
              onClick={() => {}}
            />
          )}
          <VehicleList
            vehicles={list}
            selected={current}
            dict={dict}
            onSelect={setSelected}
            onFollow={(sysid) => mapUiStore.update((s) => (s.follow === sysid ? clearFollow(s) : setFollow(s, sysid)))}
            following={mapUi.follow}
          />
          {mapUi.follow !== null && (
            <FollowChip name={vehicles.get(mapUi.follow)?.name ?? `#${mapUi.follow}`} dict={dict} onClear={() => mapUiStore.update(clearFollow)} />
          )}
          {detail && modal.kind !== 'commands' && (
            <DetailPanel
              vehicle={detail}
              messages={messages}
              acked={acks.acked}
              dict={dict}
              onAck={(id) => setAcks((s) => ack(s, id))}
              onClose={() => setSelected(null)}
              onOpenCommands={() => setModal({ kind: 'commands', sysid: detail.sysid })}
            />
          )}
          {modal.kind === 'commands' && currentVehicle && (
            <CommandsSheet
              vehicle={currentVehicle}
              dict={dict}
              onClose={() => setModal(NO_MODAL)}
              onOpen={(target) => target === 'guided' && setModal({ kind: 'guided', sysid: currentVehicle.sysid })}
              onPick={(command) => void runCommand(currentVehicle.sysid, command).then((r) => settle(currentVehicle.sysid, r, command))}
            />
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
        </main>
        <Footer results={results} dict={dict} clock={clock.slice(-5)} />
      </div>
    </div>
  )
}
