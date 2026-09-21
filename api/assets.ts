import { list } from '@vercel/blob'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/** What the panel shows in its library lists. */
type Asset = { name: string; url: string }

export default async function handler(_request: VercelRequest, response: VercelResponse): Promise<void> {
  const models: Asset[] = []
  const backgrounds: Asset[] = []

  try {
    let cursor: string | undefined
    do {
      const page = await list({ cursor, limit: 1000 })
      for (const blob of page.blobs) {
        const slash = blob.pathname.indexOf('/')
        const folder = blob.pathname.slice(0, slash)
        const name = blob.pathname.slice(slash + 1)
        if (folder === 'models') models.push({ name, url: blob.url })
        else if (folder === 'backgrounds') backgrounds.push({ name, url: blob.url })
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
  } catch {
    // No Blob store connected yet. An empty library with uploads marked
    // unavailable is a far better answer here than a 500 the panel has to
    // interpret.
    response.status(200).json({ models: [], backgrounds: [], uploads: false })
    return
  }

  const byName = (a: Asset, b: Asset) => a.name.localeCompare(b.name)
  models.sort(byName)
  backgrounds.sort(byName)

  // A just-uploaded file has to show up on the next refresh, so nothing is cached.
  response.setHeader('cache-control', 'no-store')
  response.status(200).json({ models, backgrounds, uploads: Boolean(process.env.UPLOAD_PASSWORD) })
}
