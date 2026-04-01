import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { UserRole } from '@prisma/client'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const lanes = await prisma.lane.findMany({
    include: {
      assignedUsers: {
        include: {
          user: { select: { id: true, name: true, username: true, isActive: true } },
        },
      },
      queueItems: {
        where: { queueDate: todayUTC },
        select: { status: true },
      },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })

  const result = lanes.map((lane) => {
    const statusMap: Record<string, number> = {}
    for (const item of lane.queueItems) {
      statusMap[item.status] = (statusMap[item.status] ?? 0) + 1
    }
    return {
      id: lane.id,
      name: lane.name,
      type: lane.type,
      isActive: lane.isActive,
      currentNumber: lane.currentNumber,
      lastServedNumber: lane.lastServedNumber,
      today: {
        waiting: statusMap['WAITING'] ?? 0,
        called: statusMap['CALLED'] ?? 0,
        served: statusMap['SERVED'] ?? 0,
        missed: statusMap['MISSED'] ?? 0,
        total: lane.queueItems.length,
      },
      assignedStaff: lane.assignedUsers.map((lu) => lu.user),
    }
  })

  return NextResponse.json(result)
}
