import { upload } from '@vercel/blob/client'

/**
 * The shared asset library, held in Vercel Blob. Anything uploaded here is on a
 * real URL that everyone opening the site can load — unlike a dropped file,
 * which lives in one tab as a blob URL and dies with it.
 *
 * These calls need the serverless functions in `api/`, so they only work on the
 * deployment or under `vercel dev`. Plain `vite dev` has no `/api`, which is why
 * every failure here degrades to "uploads unavailable" instead of an error.
 */

export type RemoteAsset = { name: string; url: string }

export type RemoteLibrary = {
  models: RemoteAsset[]
  backgrounds: RemoteAsset[]
  /** False when there is no Blob store, no upload password, or no /api at all. */
  uploads: boolean
}

export type AssetKind = 'models' | 'backgrounds'

const EMPTY: RemoteLibrary = { models: [], backgrounds: [], uploads: false }
const PASSWORD_KEY = 'constructor3d.upload-password'

function assets(value: unknown): RemoteAsset[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is RemoteAsset =>
      typeof entry === 'object' && entry !== null &&
      typeof (entry as RemoteAsset).name === 'string' &&
      typeof (entry as RemoteAsset).url === 'string',
  )
}

export async function listRemote(): Promise<RemoteLibrary> {
  try {
    const response = await fetch('/api/assets', { cache: 'no-store' })
    if (!response.ok) return EMPTY
    const body = (await response.json()) as Record<string, unknown>
    return {
      models: assets(body.models),
      backgrounds: assets(body.backgrounds),
      uploads: body.uploads === true,
    }
  } catch {
    return EMPTY
  }
}

/**
 * The password is kept per browser rather than per upload so a batch of files
 * only asks once. A rejected password is forgotten immediately, otherwise a
 * typo would be remembered forever.
 */
function password(): string | null {
  const stored = localStorage.getItem(PASSWORD_KEY)
  if (stored) return stored

  const typed = window.prompt('Upload password')
  if (!typed) return null
  localStorage.setItem(PASSWORD_KEY, typed)
  return typed
}

export function forgetPassword(): void {
  localStorage.removeItem(PASSWORD_KEY)
}

/**
 * Checks the password before any bytes move.
 *
 * It would be neater to let the token request reject, but @vercel/blob's client
 * throws away the response body of a failed one — every refusal, whatever the
 * reason, reaches us as "failed to retrieve the client token". Asking first is
 * what makes "wrong password" sayable.
 */
async function authorize(secret: string): Promise<void> {
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'password-check', password: secret }),
  })
  if (response.ok) return

  if (response.status === 401) {
    forgetPassword()
    throw new Error('wrong upload password')
  }

  const body = (await response.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error ?? `upload refused (${response.status})`)
}

export async function uploadAsset(file: File, kind: AssetKind): Promise<RemoteAsset> {
  const secret = password()
  if (!secret) throw new Error('cancelled')
  await authorize(secret)

  const blob = await upload(`${kind}/${file.name}`, file, {
    access: 'public',
    handleUploadUrl: '/api/upload',
    // Reaches the server as `clientPayload` in onBeforeGenerateToken, which
    // checks it again — this browser is not the only thing that can post here.
    clientPayload: secret,
  })
  return { name: file.name, url: blob.url }
}
