import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resetLaneNumbersOncePerDay } from '@/lib/laneReset'
import { QueueItemStatus } from '@prisma/client'

// Returns display rows for the queue screen.
// Each cashier user with a window label gets their own row showing the last
// ticket they personally called today. Lanes with no windowed users fall
// back to a single lane-level row.
export async function GET() {
  try {
    await resetLaneNumbersOncePerDay()

    const now = new Date()
    const queueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const nextDay = new Date(queueDate.getTime() + 86400000)

    // Fetch all active lanes with their queue items and assigned window users
    const lanes = await prisma.lane.findMany({
      where: { isActive: true },
      include: {
        assignedUsers: {
          where: { user: { isActive: true, role: 'USER' } },
          include: { user: { select: { id: true, window: true } } },
          orderBy: { userId: 'asc' },
        },
        queueItems: {
          where: { queueDate },
          select: { number: true, status: true },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Precompute waiting counts
    const waitingByLane = new Map<number, number>()
    const waitingByGroup = new Map<string, number>()
    for (const lane of lanes) {
      const w = lane.queueItems.filter((i) => i.status === QueueItemStatus.WAITING).length
      waitingByLane.set(lane.id, w)
      if (lane.serviceGroup) {
        waitingByGroup.set(lane.serviceGroup, (waitingByGroup.get(lane.serviceGroup) ?? 0) + w)
      }
    }

    // Collect all (userId, laneId) pairs for users with windows for a batched query
    const userLanePairs: { userId: number; laneId: number }[] = []
    const seenPairKeys = new Set<string>()
    for (const lane of lanes) {
      for (const au of lane.assignedUsers) {
        const key = `${au.user.id}-${lane.id}`
        if (au.user.window && !seenPairKeys.has(key)) {
          seenPairKeys.add(key)
          userLanePairs.push({ userId: au.user.id, laneId: lane.id })
        }
      }
    }

    // Batch fetch the most recent NEXT/CALL operation today for every window user
    let batchOps: { userId: number; laneId: number; number: number | null; createdAt: Date }[] = []
    if (userLanePairs.length > 0) {
      const allUserIds = userLanePairs.map((p) => p.userId)
      const allLaneIds = [...new Set(userLanePairs.map((p) => p.laneId))]
      batchOps = await prisma.queueOperation.findMany({
        where: {
          userId: { in: allUserIds },
          laneId: { in: allLaneIds },
          action: { in: ['NEXT', 'CALL'] },
          createdAt: { gte: queueDate, lt: nextDay },
        },
        orderBy: { createdAt: 'desc' },
        select: { userId: true, laneId: true, number: true, createdAt: true },
      })
    }

    // Index latest op per (userId, laneId)
    const lastOpByKey = new Map<string, { number: number | null }>()
    for (const op of batchOps) {
      const key = `${op.userId}-${op.laneId}`
      if (!lastOpByKey.has(key)) lastOpByKey.set(key, op)
    }

    type LaneRow = {
      id: string
      name: string
      serviceGroup: string | null
      prefix: string | null
      window: string | null
      currentNumber: number
      lastServedNumber: number
      waitingCount: number
      nextNumber: number
    }

    const rows: LaneRow[] = []
    const coveredLaneIds = new Set<number>()

    for (const lane of lanes) {
      const windowUsers = lane.assignedUsers.filter((au) => au.user.window)

      for (const au of windowUsers) {
        coveredLaneIds.add(lane.id)

        const lastOp = lastOpByKey.get(`${au.user.id}-${lane.id}`)
        const waitingCount = lane.serviceGroup
          ? (waitingByGroup.get(lane.serviceGroup) ?? 0)
          : (waitingByLane.get(lane.id) ?? 0)

        rows.push({
          id: `u${au.user.id}-l${lane.id}`,
          name: lane.serviceGroup || lane.name,
          serviceGroup: lane.serviceGroup,
          prefix: lane.prefix ?? null,
          window: au.user.window!,
          currentNumber: lastOp?.number ?? 0,
          lastServedNumber: lane.lastServedNumber,
          waitingCount,
          nextNumber: 0,
        })
      }
    }

    // Add bare rows for lanes not covered by any windowed user
    for (const lane of lanes) {
      if (coveredLaneIds.has(lane.id)) continue
      const allNums = lane.queueItems.map((i) => i.number)
      const maxNum = allNums.length > 0 ? Math.max(...allNums) : 0
      const waitingCount = lane.serviceGroup
        ? (waitingByGroup.get(lane.serviceGroup) ?? 0)
        : (waitingByLane.get(lane.id) ?? 0)

      rows.push({
        id: String(lane.id),
        name: lane.serviceGroup || lane.name,
        serviceGroup: lane.serviceGroup,
        prefix: lane.prefix ?? null,
        window: null,
        currentNumber: lane.currentNumber,
        lastServedNumber: lane.lastServedNumber,
        waitingCount,
        nextNumber: maxNum >= 999 ? 1 : maxNum + 1,
      })
    }

    // Sort by window number ascending (nulls last)
    rows.sort((a, b) => {
      const wa = a.window !== null ? parseInt(a.window, 10) : Infinity
      const wb = b.window !== null ? parseInt(b.window, 10) : Infinity
      if (isFinite(wa) && isFinite(wb)) return wa - wb
      if (isFinite(wa)) return -1
      if (isFinite(wb)) return 1
      return 0
    })

    return NextResponse.json(rows)
  } catch (error) {
    console.error('Get display lane status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
