import { describe, expect, it } from 'vitest'
import { cameraProfileSchema, firstIssue } from './schema'

const base = { kind: 'siyi_mt11', host: '192.168.144.25', port: 37260 }

describe('cameraProfileSchema', () => {
  it('requires an IPv4 host and a 1-65535 port', () => {
    expect(cameraProfileSchema.safeParse(base).success).toBe(true)
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, host: 'camera.local' }))).toEqual({ path: 'host', message: expect.any(String) })
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, host: '300.1.1.1' }))?.path).toBe('host')
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, port: 0 }))?.path).toBe('port')
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, port: 70000 }))?.path).toBe('port')
    expect(cameraProfileSchema.safeParse({ kind: 'none', host: '192.168.144.25', port: 37260 }).success).toBe(true)
    expect(firstIssue(cameraProfileSchema.safeParse(base))).toBeNull()
  })
})
