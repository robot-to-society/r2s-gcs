import type { NetworkTopology } from '../../shared/api/types'

/** A minimal standalone topology for tests (one link, no vehicles, no clients). */
export function topology(at_unix_ms: number, overrides: Partial<NetworkTopology> = {}): NetworkTopology {
  return {
    server: { hostname: 'gcs', version: '0.1.0', build: 'dev', listen: '0.0.0.0:8000', role: 'standalone', uptime_s: 10, started_unix_ms: 0 },
    links: [],
    vehicles: [],
    clients: [],
    media: { whep_upstream: '', reachable: null },
    unconfigured: ['hub', 'lte', 'mesh', 'gateway', 'ntrip', 'node'],
    at_unix_ms,
    ...overrides,
  }
}
