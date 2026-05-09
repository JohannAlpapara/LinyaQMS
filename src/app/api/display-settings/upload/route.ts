import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import path from 'path'
import fs from 'fs/promises'
import { randomBytes } from 'crypto'

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request)
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const ext = ALLOWED_TYPES[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: `File type not allowed: ${file.type}` },
        { status: 400 }
      )
    }

    const filename = `${randomBytes(16).toString('hex')}${ext}`
    const uploadDir = path.join(process.cwd(), 'public', 'uploads')

    await fs.mkdir(uploadDir, { recursive: true })
    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(path.join(uploadDir, filename), buffer)

    return NextResponse.json({ url: `/api/display-settings/media/${filename}` })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
