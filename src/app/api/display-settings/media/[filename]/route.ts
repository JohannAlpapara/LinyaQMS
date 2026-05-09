import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
}

function isSafeFilename(value: string) {
  return /^[a-f0-9]{32}\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|ogv)$/i.test(value)
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params

    if (!isSafeFilename(filename)) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    const filePath = path.join(process.cwd(), 'public', 'uploads', filename)
    const ext = path.extname(filename).toLowerCase()
    const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream'

    const fileBuffer = await fs.readFile(filePath)

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    console.error('Media serve error:', error)
    return NextResponse.json({ error: 'Failed to load media' }, { status: 500 })
  }
}
