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
  const reportType = searchParams.get('type') ?? 'queue_items'

  const now = new Date()
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const defaultStart = new Date(defaultEnd.getTime() - 29 * 24 * 60 * 60 * 1000)

  const startDate = startDateStr
    ? new Date(startDateStr + 'T00:00:00.000Z')
    : defaultStart
  // For end date in export, include the full day (items created on that day)
  const endDate = endDateStr
    ? new Date(endDateStr + 'T00:00:00.000Z')
    : defaultEnd

  let csv = ''
  let filename = ''

  if (reportType === 'queue_items') {
    const items = await prisma.queueItem.findMany({
      where: {
        queueDate: { gte: startDate, lte: endDate },
        ...(laneIdStr && laneIdStr !== 'all'
          ? { laneId: parseInt(laneIdStr, 10) }
          : {}),
      },
      include: { lane: { select: { name: true, type: true } } },
      orderBy: [{ queueDate: 'asc' }, { laneId: 'asc' }, { number: 'asc' }],
    })

    const rows = [
      'Date,Lane,Type,Ticket #,Status,Created At,Called At,Served At',
      ...items.map((item) =>
        [
          item.queueDate.toISOString().slice(0, 10),
          `"${item.lane.name.replace(/"/g, '""')}"`,
          item.lane.type,
          item.number,
          item.status,
          item.createdAt.toISOString(),
          item.calledAt?.toISOString() ?? '',
          item.servedAt?.toISOString() ?? '',
        ].join(',')
      ),
    ]
    csv = rows.join('\n')
    filename = `queue-items-${startDate.toISOString().slice(0, 10)}-to-${endDate.toISOString().slice(0, 10)}.csv`
  } else if (reportType === 'operations') {
    const ops = await prisma.queueOperation.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1),
        },
        ...(laneIdStr && laneIdStr !== 'all'
          ? { laneId: parseInt(laneIdStr, 10) }
          : {}),
      },
      include: {
        user: { select: { name: true, username: true } },
        lane: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const rows = [
      'Date,Time (UTC),Lane,Staff Name,Username,Action,Ticket #',
      ...ops.map((op) =>
        [
          op.createdAt.toISOString().slice(0, 10),
          op.createdAt.toISOString().slice(11, 19),
          `"${op.lane.name.replace(/"/g, '""')}"`,
          `"${op.user.name.replace(/"/g, '""')}"`,
          op.user.username,
          op.action,
          op.number ?? '',
        ].join(',')
      ),
    ]
    csv = rows.join('\n')
    filename = `operations-${startDate.toISOString().slice(0, 10)}-to-${endDate.toISOString().slice(0, 10)}.csv`
  } else {
    return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
  }

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
