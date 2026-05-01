import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, hasRole } from '@/lib/auth'
import { UserRole, QueueItemStatus } from '@prisma/client'
import { broadcastAllLaneData, broadcastQueueUpdate } from '@/lib/broadcast'

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request)
    if (!currentUser || !hasRole(currentUser.role, [UserRole.USER, UserRole.ADMIN])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { action, laneId } = await request.json()

    if (!action || !laneId) {
      return NextResponse.json(
        { error: 'Action and lane ID are required' },
        { status: 400 }
      )
    }

    // Check if user is assigned to this lane (unless admin)
    if (currentUser.role !== UserRole.ADMIN) {
      const isAssigned = currentUser.assignedLanes.some(
        (assignment) => assignment.laneId === laneId
      )
      if (!isAssigned) {
        return NextResponse.json(
          { error: 'Not assigned to this lane' },
          { status: 403 }
        )
      }
    }

    const lane = await prisma.lane.findUnique({
      where: { id: laneId }
    })

    if (!lane) {
      return NextResponse.json(
        { error: 'Lane not found' },
        { status: 404 }
      )
    }

    let result: { currentNumber?: number; servedNumber?: number } = {}

    switch (action) {
      case 'NEXT':
        // Advance to next waiting ticket (today only) and keep lane.currentNumber in sync
        const now = new Date()
        const queueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

        // For lanes in a serviceGroup, all tickets live on the primary lane (lowest ID).
        // Pull from the primary pool regardless of which window the cashier is on.
        let sourceLaneId = laneId
        if (lane.serviceGroup) {
          const primaryLane = await prisma.lane.findFirst({
            where: { serviceGroup: lane.serviceGroup, isActive: true },
            orderBy: { id: 'asc' },
            select: { id: true },
          })
          if (primaryLane) sourceLaneId = primaryLane.id
        }

        // Find the next waiting queue item with number greater than this cashier's current number
        let queueItem = await prisma.queueItem.findFirst({
          where: {
            laneId: sourceLaneId,
            queueDate,
            status: QueueItemStatus.WAITING,
            number: {
              gt: lane.currentNumber
            }
          },
          orderBy: { number: 'asc' }
        })

        // If none found above current number (wrap around case), take the earliest waiting ticket
        if (!queueItem) {
          queueItem = await prisma.queueItem.findFirst({
            where: {
              laneId: sourceLaneId,
              queueDate,
              status: QueueItemStatus.WAITING
            },
            orderBy: { number: 'asc' }
          })
        }

        if (!queueItem) {
          return NextResponse.json(
            { error: 'No waiting tickets in this lane' },
            { status: 400 }
          )
        }

        const nextNumber = queueItem.number

        await prisma.$transaction(async (tx) => {
          // Update this cashier's lane current number
          await tx.lane.update({
            where: { id: laneId },
            data: { currentNumber: nextNumber }
          })

          // Claim the ticket: reassign it to the calling lane and mark as called
          await tx.queueItem.update({
            where: { id: queueItem.id },
            data: {
              laneId,  // move from primary pool to this cashier's lane
              status: QueueItemStatus.CALLED,
              calledAt: new Date()
            }
          })

          // Log operation
          await tx.queueOperation.create({
            data: {
              userId: currentUser.id,
              laneId,
              action: 'NEXT',
              number: nextNumber
            }
          })

          result = { currentNumber: nextNumber }
        })
        break

      case 'CALL':
        // Re-call current number
        await prisma.queueOperation.create({
          data: {
            userId: currentUser.id,
            laneId,
            action: 'CALL',
            number: lane.currentNumber
          }
        })
        result = { currentNumber: lane.currentNumber }
        break

      case 'BUZZ':
        // Buzz current number
        await prisma.queueOperation.create({
          data: {
            userId: currentUser.id,
            laneId,
            action: 'BUZZ',
            number: lane.currentNumber
          }
        })
        result = { currentNumber: lane.currentNumber }
        break

      case 'SERVE':
        // Mark current number as served
        await prisma.$transaction(async (tx) => {
          const queueItem = await tx.queueItem.findFirst({
            where: {
              laneId,
              number: lane.currentNumber
            }
          })

          if (queueItem) {
            await tx.queueItem.update({
              where: { id: queueItem.id },
              data: {
                status: QueueItemStatus.SERVED,
                servedAt: new Date()
              }
            })
          }

          await tx.lane.update({
            where: { id: laneId },
            data: { lastServedNumber: lane.currentNumber }
          })

          await tx.queueOperation.create({
            data: {
              userId: currentUser.id,
              laneId,
              action: 'SERVE',
              number: lane.currentNumber
            }
          })
        })

        result = { servedNumber: lane.currentNumber }
        break

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        )
    }

    // Broadcast the update to all connected display clients.
    // 1. Send a lightweight operation event first (triggers sound + highlight immediately).
    // 2. Then push full lane data so display state is always authoritative from the server.
    try {
      broadcastQueueUpdate({
        type: 'operation',
        action,
        laneId,
        result,
        timestamp: new Date().toISOString(),
      })
      await broadcastAllLaneData()
    } catch (error) {
      console.error('Failed to broadcast queue update:', error)
      // Don't fail the operation if broadcast fails
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Queue operation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
