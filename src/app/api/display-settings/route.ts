import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SETTING_KEYS = [
  'display_header_type',
  'display_header_text',
  'display_header_image_url',
  'display_media_type',
  'display_media_items',
  'display_footer_text',
  'display_footer_animation',
  'display_primary_color',
  'display_secondary_color',
  'display_header_bg_color',
  'display_text_color',
  // Reservation page settings
  'reservation_bg_color',
  'reservation_accent_color',
  'reservation_title',
  'reservation_logo_type',
  'reservation_logo_text',
  'reservation_logo_url',
  'reservation_card_colors',
]

const DEFAULT_SETTINGS: Record<string, string> = {
  display_header_type: 'text',
  display_header_text: 'NOW SERVING',
  display_header_image_url: '',
  display_media_type: 'none',
  display_media_items: '[]',
  display_footer_text: '',
  display_footer_animation: 'static',
  display_primary_color: '#2a9d8f',
  display_secondary_color: '#1a7268',
  display_header_bg_color: '#ffffff',
  display_text_color: '#ffffff',
  // Reservation page defaults
  reservation_bg_color: '#f8fafc',
  reservation_accent_color: '#ec4899',
  reservation_title: 'Get your ticket',
  reservation_logo_type: 'text',
  reservation_logo_text: 'YOUR LOGO',
  reservation_logo_url: '',
  reservation_card_colors: '["#22c55e","#3b82f6","#ec4899","#f59e0b","#84cc16","#a855f7","#06b6d4","#f97316"]',
}

export async function GET() {
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: SETTING_KEYS } },
    })

    const result = { ...DEFAULT_SETTINGS }
    settings.forEach((s: { key: string; value: string }) => {
      result[s.key] = s.value
    })

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (error) {
    console.error('Error fetching display settings:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request)
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const updates = Object.entries(body as Record<string, unknown>).filter(([key]) =>
      SETTING_KEYS.includes(key)
    )

    await Promise.all(
      updates.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      )
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating display settings:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
