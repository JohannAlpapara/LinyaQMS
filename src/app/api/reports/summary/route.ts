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

  const [
    lanesTotal,
    lanesActive,
    staffTotal,
    staffActive,
    queueCounts,
    assignedToActiveCount,
  ] = await Promise.all([
    prisma.lane.count(),
    prisma.lane.count({ where: { isActive: true } }),
    prisma.user.count({ where: { role: UserRole.USER } }),
    prisma.user.count({ where: { role: UserRole.USER, isActive: true } }),
    prisma.queueItem.groupBy({
      by: ['status'],
      where: { queueDate: todayUTC },
      _count: { status: true },
    }),
    prisma.laneUser.count({ where: { lane: { isActive: true } } }),
  ])

  const queueByStatus: Record<string, number> = {}
  for (const row of queueCounts) {
    queueByStatus[row.status] = row._count.status
  }

  return NextResponse.json({
    lanes: {
      total: lanesTotal,
      active: lanesActive,
      inactive: lanesTotal - lanesActive,
    },
    staff: {
      total: staffTotal,
      active: staffActive,
      assignedToActiveLanes: assignedToActiveCount,
    },
    queue: {
      waiting: queueByStatus['WAITING'] ?? 0,
      called: queueByStatus['CALLED'] ?? 0,
      served: queueByStatus['SERVED'] ?? 0,
      missed: queueByStatus['MISSED'] ?? 0,
      total: Object.values(queueByStatus).reduce((a, b) => a + b, 0),
    },
    asOf: now.toISOString(),
  })
}
