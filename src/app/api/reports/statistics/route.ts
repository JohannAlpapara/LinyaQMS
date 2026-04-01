import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { UserRole } from '@prisma/client'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const startDateStr = searchParams.get('startDate')
  const endDateStr = searchParams.get('endDate')
  const laneIdStr = searchParams.get('laneId')

  const now = new Date()
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const defaultStart = new Date(defaultEnd.getTime() - 29 * 24 * 60 * 60 * 1000)

  const startDate = startDateStr
    ? new Date(startDateStr + 'T00:00:00.000Z')
    : defaultStart
  const endDate = endDateStr
    ? new Date(endDateStr + 'T00:00:00.000Z')
    : defaultEnd

  const whereClause: {
    queueDate: { gte: Date; lte: Date }
    laneId?: number
  } = {
    queueDate: { gte: startDate, lte: endDate },
  }

  if (laneIdStr && laneIdStr !== 'all') {
    const parsedId = parseInt(laneIdStr, 10)
    if (!isNaN(parsedId)) {
      whereClause.laneId = parsedId
    }
  }

  const [grouped, allLanes] = await Promise.all([
    prisma.queueItem.groupBy({
      by: ['queueDate', 'laneId', 'status'],
      where: whereClause,
      _count: { status: true },
      orderBy: [{ queueDate: 'desc' }],
    }),
    prisma.lane.findMany({ select: { id: true, name: true, type: true } }),
  ])

  const laneMap = Object.fromEntries(allLanes.map((l) => [l.id, l]))

  const map = new Map<
    string,
    {
      date: string
      laneId: number
      laneName: string
      laneType: string
      waiting: number
      called: number
      served: number
      missed: number
      total: number
    }
  >()

  for (const row of grouped) {
    const dateStr = row.queueDate.toISOString().slice(0, 10)
    const key = `${dateStr}-${row.laneId}`
    if (!map.has(key)) {
      map.set(key, {
        date: dateStr,
        laneId: row.laneId,
        laneName: laneMap[row.laneId]?.name ?? `Lane ${row.laneId}`,
        laneType: laneMap[row.laneId]?.type ?? 'REGULAR',
        waiting: 0,
        called: 0,
        served: 0,
        missed: 0,
        total: 0,
      })
    }
    const entry = map.get(key)!
    const count = row._count.status
    entry.total += count
    if (row.status === 'WAITING') entry.waiting += count
    else if (row.status === 'CALLED') entry.called += count
    else if (row.status === 'SERVED') entry.served += count
    else if (row.status === 'MISSED') entry.missed += count
  }

  return NextResponse.json({
    rows: Array.from(map.values()),
    dateRange: {
      start: startDate.toISOString().slice(0, 10),
      end: endDate.toISOString().slice(0, 10),
    },
    lanes: allLanes,
  })
}
