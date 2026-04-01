import { NextRequest, NextResponse } from 'next/server'
import { UserRole } from '@prisma/client'
import { getCurrentUser, hasRole } from '@/lib/auth'
import { resetLaneNumbersOncePerDay } from '@/lib/laneReset'
import { broadcastAllLaneData } from '@/lib/broadcast'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request)
    if (!currentUser || !hasRole(currentUser.role, [UserRole.ADMIN])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const setting = await prisma.setting.findUnique({ where: { key: 'lastManualReset' } })
    return NextResponse.json({ lastManualReset: setting?.value ?? null })
  } catch (error) {
    console.error('Get last reset error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request)
    if (!currentUser || !hasRole(currentUser.role, [UserRole.ADMIN])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await resetLaneNumbersOncePerDay({ force: true })

    // Record the manual reset timestamp so the admin UI can display it
    const resetAt = new Date().toISOString()
    await prisma.setting.upsert({
      where: { key: 'lastManualReset' },
      update: { value: resetAt },
      create: { key: 'lastManualReset', value: resetAt },
    })

    // Push zeroed lane data to all connected display/cashier clients immediately
    await broadcastAllLaneData()

    return NextResponse.json({ message: 'Lane numbers reset successfully', resetAt })
  } catch (error) {
    console.error('Manual reset error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
