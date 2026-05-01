import { prisma } from '@/lib/prisma'

// SSE broadcast utility for real-time queue updates
//
// IMPORTANT: connections must live on globalThis so it is shared across all
// Next.js route module instances (Next.js / Turbopack can isolate per-route
// module scopes, meaning a plain module-level Set would be empty when the
// operations route calls broadcastQueueUpdate).
declare global {
  // eslint-disable-next-line no-var
  var _sseConnections: Set<ReadableStreamDefaultController> | undefined
}
if (!globalThis._sseConnections) {
  globalThis._sseConnections = new Set<ReadableStreamDefaultController>()
}
const connections = globalThis._sseConnections

// Add connection to broadcast list
export function addConnection(controller: ReadableStreamDefaultController) {
  connections.add(controller)
}

// Remove connection from broadcast list
export function removeConnection(controller: ReadableStreamDefaultController) {
  connections.delete(controller)
}

// Get current connection count
export function getConnectionCount() {
  return connections.size
}

// Helper: send a raw SSE message to one controller
function send(controller: ReadableStreamDefaultController, data: unknown) {
  try {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
  } catch {
    connections.delete(controller)
  }
}

// Broadcast an arbitrary payload to all connected clients
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function broadcastQueueUpdate(data: any) {
  connections.forEach((controller) => send(controller, data))
}

// Fetch current lane data from DB and broadcast a lanes_update to all clients
export async function broadcastAllLaneData() {
  if (connections.size === 0) return
  try {
    const laneStatuses = await computeDisplayRows()
    const payload = { type: 'lanes_update', lanes: laneStatuses }
    for (const controller of connections) {
      send(controller, payload)
    }
  } catch (error) {
    console.error('Error broadcasting lane data:', error)
  }
}

// Fetch and send lane data to a specific connection
export async function fetchAndSendLaneData(controller: ReadableStreamDefaultController) {
  try {
    const laneStatuses = await computeDisplayRows()
    send(controller, { type: 'lanes_update', lanes: laneStatuses })
  } catch (error) {
    console.error('Error fetching lane data for SSE:', error)
    send(controller, { type: 'error', message: 'Failed to fetch lane data' })
  }
}

// Build per-user display rows (same logic as /api/queue/display-lanes)
async function computeDisplayRows() {
  const now = new Date()
  const queueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const nextDay = new Date(queueDate.getTime() + 86400000)

  const lanes = await prisma.lane.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: {
      assignedUsers: {
        where: { user: { role: 'USER', isActive: true } },
        include: { user: { select: { id: true, window: true } } },
        orderBy: { userId: 'asc' },
      },
    },
  })

  // Waiting counts per lane and per serviceGroup
  const waitingByLane = new Map<number, number>()
  const waitingByGroup = new Map<string, number>()
  const calledByLane = new Map<number, number>()
  await Promise.all(
    lanes.map(async (lane) => {
      const [w, c] = await Promise.all([
        prisma.queueItem.count({ where: { laneId: lane.id, status: 'WAITING', queueDate } }),
        prisma.queueItem.count({ where: { laneId: lane.id, status: 'CALLED', queueDate } }),
      ])
      waitingByLane.set(lane.id, w)
      calledByLane.set(lane.id, c)
      if (lane.serviceGroup) {
        waitingByGroup.set(lane.serviceGroup, (waitingByGroup.get(lane.serviceGroup) ?? 0) + w)
      }
    })
  )

  // Batch fetch last NEXT/CALL ops today for all window users
  const seenPairKeys = new Set<string>()
  const userLanePairs: { userId: number; laneId: number }[] = []
  for (const lane of lanes) {
    for (const au of lane.assignedUsers) {
      const key = `${au.user.id}-${lane.id}`
      if (au.user.window && !seenPairKeys.has(key)) {
        seenPairKeys.add(key)
        userLanePairs.push({ userId: au.user.id, laneId: lane.id })
      }
    }
  }

  const lastOpByKey = new Map<string, { number: number | null }>()
  if (userLanePairs.length > 0) {
    const allUserIds = userLanePairs.map((p) => p.userId)
    const allLaneIds = [...new Set(userLanePairs.map((p) => p.laneId))]
    const batchOps = await prisma.queueOperation.findMany({
      where: {
        userId: { in: allUserIds },
        laneId: { in: allLaneIds },
        action: { in: ['NEXT', 'CALL'] },
        createdAt: { gte: queueDate, lt: nextDay },
      },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, laneId: true, number: true, createdAt: true },
    })
    for (const op of batchOps) {
      const key = `${op.userId}-${op.laneId}`
      if (!lastOpByKey.has(key)) lastOpByKey.set(key, op)
    }
  }

  // Build rows
  type Row = {
    id: string
    name: string
    serviceGroup: string | null
    prefix: string | null
    window: string | null
    currentNumber: number
    lastServedNumber: number
    waitingCount: number
    calledCount: number
    nextNumber: number
  }
  const rows: Row[] = []
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
        calledCount: calledByLane.get(lane.id) ?? 0,
        nextNumber: 0,
      })
    }
  }

  // Uncovered lanes
  for (const lane of lanes) {
    if (coveredLaneIds.has(lane.id)) continue
    const lastItem = await prisma.queueItem.findFirst({
      where: { laneId: lane.id, queueDate },
      orderBy: { number: 'desc' },
    })
    const nextNumber = lastItem ? (lastItem.number >= 999 ? 1 : lastItem.number + 1) : 1
    const waitingCount = lane.serviceGroup
      ? (waitingByGroup.get(lane.serviceGroup) ?? 0)
      : (waitingByLane.get(lane.id) ?? 0)

    rows.push({
      id: lane.id.toString(),
      name: lane.serviceGroup || lane.name,
      serviceGroup: lane.serviceGroup,
      prefix: lane.prefix ?? null,
      window: null,
      currentNumber: lane.currentNumber,
      lastServedNumber: lane.lastServedNumber,
      waitingCount,
      calledCount: calledByLane.get(lane.id) ?? 0,
      nextNumber,
    })
  }

  rows.sort((a, b) => {
    const wa = a.window !== null ? parseInt(a.window, 10) : Infinity
    const wb = b.window !== null ? parseInt(b.window, 10) : Infinity
    if (isFinite(wa) && isFinite(wb)) return wa - wb
    if (isFinite(wa)) return -1
    if (isFinite(wb)) return 1
    return 0
  })

  return rows
}
