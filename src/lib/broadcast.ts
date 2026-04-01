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
  for (const controller of connections) {
    await fetchAndSendLaneData(controller)
  }
}

// Fetch and send lane data to a specific connection
export async function fetchAndSendLaneData(controller: ReadableStreamDefaultController) {
  try {
    const now = new Date()
    const queueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

    const lanes = await prisma.lane.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        currentNumber: true,
        lastServedNumber: true,
      },
    })

    const laneStatuses = await Promise.all(
      lanes.map(async (lane) => {
        const [waitingCount, calledCount] = await Promise.all([
          prisma.queueItem.count({
            where: { laneId: lane.id, status: 'WAITING', queueDate },
          }),
          prisma.queueItem.count({
            where: { laneId: lane.id, status: 'CALLED', queueDate },
          }),
        ])

        const lastQueueItemToday = await prisma.queueItem.findFirst({
          where: { laneId: lane.id, queueDate },
          orderBy: { number: 'desc' },
        })

        let nextNumber = 1
        if (lastQueueItemToday) {
          nextNumber = lastQueueItemToday.number >= 999 ? 1 : lastQueueItemToday.number + 1
        }

        return {
          id: lane.id.toString(),
          name: lane.name,
          description: lane.description,
          currentNumber: lane.currentNumber,
          lastServedNumber: lane.lastServedNumber,
          waitingCount,
          calledCount,
          nextNumber,
        }
      })
    )

    send(controller, { type: 'lanes_update', lanes: laneStatuses })
  } catch (error) {
    console.error('Error fetching lane data for SSE:', error)
    send(controller, { type: 'error', message: 'Failed to fetch lane data' })
  }
}
