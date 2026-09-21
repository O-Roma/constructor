import { createHash, timingSafeEqual } from 'node:crypto'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Hands the browser a short-lived token so it can upload straight to Vercel
 * Blob. The bytes never pass through this function, which is the point: a
 * serverless request body caps out at 4.5 MB and models go well past that.
 */

const MODEL_EXT = /\.(glb|gltf)$/i
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|hdr)$/i
const MAX_BYTES = 64 * 1024 * 1024

const WRONG_PASSWORD = 'wrong upload password'

/** Compared as digests so the check takes the same time whatever is sent. */
function matches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'POST only' })
    return
  }

  const password = process.env.UPLOAD_PASSWORD
  // Without a password every visitor could write to the store, so uploads stay
  // shut rather than open by default.
  if (!password) {
    response.status(503).json({ error: 'uploads are disabled: UPLOAD_PASSWORD is not set' })
    return
  }

  // The client checks the password here before it starts an upload. It has to
  // be a separate step because @vercel/blob's client discards the body of a
  // failed token request, so a 401 raised below reaches the browser as a
  // generic "failed to retrieve the client token" and the user never learns
  // what was actually wrong.
  const body = request.body as { type?: unknown; password?: unknown }
  if (body?.type === 'password-check') {
    if (!matches(body.password, password)) {
      response.status(401).json({ error: WRONG_PASSWORD })
      return
    }
    response.status(200).json({ ok: true })
    return
  }

  try {
    const result = await handleUpload({
      body: body as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!matches(clientPayload, password)) throw new Error(WRONG_PASSWORD)

        const isModel = pathname.startsWith('models/') && MODEL_EXT.test(pathname)
        const isImage = pathname.startsWith('backgrounds/') && IMAGE_EXT.test(pathname)
        if (!isModel && !isImage) throw new Error(`cannot upload ${pathname}`)

        return {
          // Same name overwrites the old file rather than piling up copies, so
          // re-uploading a model the designer changed does what you expect.
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: MAX_BYTES,
        }
      },
      // Required by the API. Nothing to do: the library is read back from the
      // store itself, so there is no record to keep here.
      onUploadCompleted: async () => {},
    })

    response.status(200).json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upload failed'
    response.status(message === WRONG_PASSWORD ? 401 : 400).json({ error: message })
  }
}
