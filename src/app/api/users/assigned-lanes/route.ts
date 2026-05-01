import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, hasRole } from '@/lib/auth'
import { UserRole } from '@prisma/client'

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request)
    if (!currentUser || !hasRole(currentUser.role, [UserRole.USER, UserRole.ADMIN])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Calculate today's UTC queueDate
    const now = new Date()
    const queueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

    // Get all user's assigned lanes with queue details (today only)
    const assignedLanes = await prisma.laneUser.findMany({
      where: {
        userId: currentUser.id,
        lane: {
          isActive: true
        }
      },
      include: {
        lane: {
          include: {
            queueItems: {
              where: {
                queueDate
              },
              orderBy: {
                number: 'asc'
              }
            }
          }
        }
      },
      orderBy: {
        lane: {
          type: 'asc'
        }
      }
    })

    // Transform the data to match the Lane interface, using authoritative lane counters
    const lanes = await Promise.all(assignedLanes.map(async (assignment) => {
      let queueItems = assignment.lane.queueItems

      // For lanes in a serviceGroup, WAITING tickets live on the primary lane (lowest ID).
      // Show the primary pool's waiting items so every cashier in the group
      // sees the correct queue depth, regardless of which window they are on.
      if (assignment.lane.serviceGroup) {
        const primaryLane = await prisma.lane.findFirst({
          where: { serviceGroup: assignment.lane.serviceGroup, isActive: true },
          orderBy: { id: 'asc' },
          select: { id: true },
        })
        if (primaryLane && primaryLane.id !== assignment.lane.id) {
          const primaryWaiting = await prisma.queueItem.findMany({
            where: { laneId: primaryLane.id, queueDate, status: 'WAITING' },
            orderBy: { number: 'asc' },
          })
          // Keep this lane's own CALLED/SERVED items; replace WAITING with primary pool
          const ownNonWaiting = assignment.lane.queueItems.filter((i) => i.status !== 'WAITING')
          queueItems = [
            ...primaryWaiting.map((i) => ({ number: i.number, status: i.status })),
            ...ownNonWaiting,
          ]
        }
      }

      return {
        id: assignment.lane.id,
        name: assignment.lane.name,
        description: assignment.lane.description,
        type: assignment.lane.type,
        prefix: assignment.lane.prefix,
        currentNumber: assignment.lane.currentNumber,
        lastServedNumber: assignment.lane.lastServedNumber,
        queueItems: queueItems.map((item: { number: number; status: string }) => ({
          number: item.number,
          status: item.status
        }))
      }
    }))

    return NextResponse.json({ user: { id: currentUser.id, name: currentUser.name, username: currentUser.username }, lanes })
  } catch (error) {
    console.error('Error fetching assigned lanes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
