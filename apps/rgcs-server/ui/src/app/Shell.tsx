import { useEffect, useState } from 'react'
import { authStore } from '../features/auth/store'
import { CommandsSheet, ConfirmDialog, runCommand, type RunResult } from '../features/commands'
import { useVehicles, vehicleStore } from '../features/vehicles/store'
import { VehicleList } from '../features/vehicles/VehicleList'
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
  const { vehicles, link, results } = useVehicles()
  const [selected, setSelected] = useState<number | null>(null)
  const [view, setView] = useState<View>('ops')
  const [modal, setModal] = useState<Modal>(NO_MODAL)
  const clock = useClock(lang)
  const list = [...vehicles.values()].sort((a, b) => a.sysid - b.sysid)
  const current = selected ?? list[0]?.sysid ?? null
  const currentVehicle = current === null ? undefined : vehicles.get(current)

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
        <main className="stage noright" style={{ position: 'absolute', inset: 0 }}>
          <VehicleList vehicles={list} selected={current} dict={dict} onSelect={setSelected} />
          {currentVehicle && modal.kind === 'none' && (
            <button type="button" className="g btn btn-sm float map-r top1 commands-launch" onClick={() => setModal({ kind: 'commands', sysid: currentVehicle.sysid })}>
              {dict.allCommands}
            </button>
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
