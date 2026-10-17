import { z } from 'zod'

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** The 接続 tab's editable subset of `CameraProfile` (spec 60 §3.3 ranges). */
export const cameraProfileSchema = z.object({
  kind: z.enum(['none', 'mavlink', 'siyi_mt11']),
  host: z.string().regex(IPV4, 'IPv4'),
  port: z.number().int().min(1).max(65535),
})

export type CameraProfileDraft = z.infer<typeof cameraProfileSchema>

export interface Issue {
  readonly path: string
  readonly message: string
}

type ParseLike = { readonly success: true } | { readonly success: false; readonly error: { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] } }

export function firstIssue(r: ParseLike): Issue | null {
  if (r.success) return null
  const issue = r.error.issues[0]
  return issue ? { path: issue.path.map(String).join('.'), message: issue.message } : null
}
