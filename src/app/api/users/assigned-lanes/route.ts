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
    const lanes = assignedLanes.map(assignment => {
      const queueItems = assignment.lane.queueItems
      return {
        id: assignment.lane.id,
        name: assignment.lane.name,
        description: assignment.lane.description,
        type: assignment.lane.type,
        currentNumber: assignment.lane.currentNumber,
        lastServedNumber: assignment.lane.lastServedNumber,
        queueItems: queueItems.map((item: { number: number; status: string }) => ({
          number: item.number,
          status: item.status
        }))
      }
    })

    return NextResponse.json({ user: { id: currentUser.id, name: currentUser.name, username: currentUser.username }, lanes })
  } catch (error) {
    console.error('Error fetching assigned lanes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
