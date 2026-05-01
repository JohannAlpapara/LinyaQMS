import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resetLaneNumbersOncePerDay } from '@/lib/laneReset'

import { QueueItemStatus } from '@prisma/client'
import { broadcastAllLaneData } from '@/lib/broadcast'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serviceGroup } = body;
    let { laneId } = body;

    if (!serviceGroup && !laneId) {
      return NextResponse.json(
        { error: 'serviceGroup or laneId is required' },
        { status: 400 }
      )
    }

    // Use queueDate (UTC midnight) for daily queue logic
    const now = new Date();
    const queueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // If serviceGroup is provided, auto-select the lane with fewest waiting items today
    if (serviceGroup) {
      const groupLanes = await prisma.lane.findMany({
        where: { serviceGroup, isActive: true },
        select: {
          id: true,
          name: true,
          serviceGroup: true,
          queueItems: {
            where: { queueDate, status: 'WAITING' },
            select: { id: true }
          }
        },
        orderBy: { id: 'asc' }  // lowest ID = primary lane
      });

      if (groupLanes.length === 0) {
        return NextResponse.json(
          { error: 'No active lanes found for this service' },
          { status: 404 }
        );
      }

      // Always use the primary lane (lowest ID) — shared single queue
      laneId = groupLanes[0].id;
    } else {
      // Ensure laneId is an integer (Prisma expects Int, not string)
      if (typeof laneId === 'string') laneId = parseInt(laneId, 10);
    }

    const lane = await prisma.lane.findUnique({
      where: { id: laneId }
    })

    if (!lane || !lane.isActive) {
      return NextResponse.json(
        { error: 'Lane not found or inactive' },
        { status: 404 }
      )
    }

    // Find the highest queue number for today for this lane (using queueDate)
    const lastQueueItemToday = await prisma.queueItem.findFirst({
      where: {
        laneId: laneId,
        queueDate: queueDate
      },
      orderBy: { number: 'desc' }
    });

    // Calculate next number with daily reset and 999 max limit (wraps to 1)
    let nextNumber = 1;
    if (lastQueueItemToday) {
      if (lastQueueItemToday.number >= 999) {
        nextNumber = 1;
      } else {
        nextNumber = lastQueueItemToday.number + 1;
      }
    }


    // Ensure the next number is not already used for today (handle rare race conditions)
    let attempts = 0;
    let createdItem = null;
    while (attempts < 999) {
      try {
        createdItem = await prisma.queueItem.create({
          data: {
            laneId,
            number: nextNumber,
            queueDate: queueDate,
            status: QueueItemStatus.WAITING
          }
        });
        break; // Success
      } catch (error) {
        // Prisma error type
        if ((error as { code?: string }).code === 'P2002') {
          // Unique constraint failed, try next number
          nextNumber = nextNumber >= 999 ? 1 : nextNumber + 1;
          attempts++;
        } else {
          throw error;
        }
      }
    }
    if (!createdItem) {
      return NextResponse.json({ error: 'All queue numbers for today are in use. Please contact admin.' }, { status: 400 });
    }

    // Broadcast full lane update to all display clients (SSE)
    await broadcastAllLaneData();

    // Calculate waiting count (people ahead of this person in today's queue)
    const waitingCount = await prisma.queueItem.count({
      where: {
        laneId,
        status: QueueItemStatus.WAITING,
        number: {
          lt: nextNumber
        },
        queueDate: queueDate
      }
    })

    const responseObj = {
      queueNumber: nextNumber,
      prefix: lane.prefix ?? null,
      laneName: lane.name,
      currentNumber: lane.currentNumber,
      waitingCount: waitingCount,
      estimatedWait: waitingCount * 5 // Assume 5 minutes per person
    };
    return NextResponse.json(responseObj, { status: 201 })
  } catch (error) {
    console.error('Get queue number error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    await resetLaneNumbersOncePerDay();
    // Use queueDate (UTC midnight) for daily queue logic
    const now = new Date();
    const queueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Get current queue status for all active lanes (today's data only)
    const lanes = await prisma.lane.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        serviceGroup: true,
        currentNumber: true,
        lastServedNumber: true,
        queueItems: {
          where: { queueDate },
          select: { number: true, status: true },
          orderBy: { number: 'asc' }
        }
      },
      orderBy: { name: 'asc' }
    })

    // Group lanes by serviceGroup (or by individual lane name if no serviceGroup)
    const groupMap = new Map<string, typeof lanes>()
    for (const lane of lanes) {
      const key = lane.serviceGroup?.trim() || `__lane__${lane.id}`
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(lane)
    }

    const serviceStatus = Array.from(groupMap.entries()).map(([key, groupLanes]) => {
      const isGroup = !key.startsWith('__lane__')
      // Display name: serviceGroup value or individual lane name
      const displayName = isGroup ? key : groupLanes[0].name
      const description = groupLanes.length === 1 ? groupLanes[0].description : undefined

      // waitingCount: all tickets still waiting (live on primary lane)
      const waitingCount = groupLanes.reduce((sum, l) =>
        sum + l.queueItems.filter(i => i.status === QueueItemStatus.WAITING).length, 0)
      const calledCount = groupLanes.reduce((sum, l) =>
        sum + l.queueItems.filter(i => i.status === QueueItemStatus.CALLED).length, 0)

      // currentNumber: the highest currentNumber across group lanes (most recently called overall)
      const currentNumber = groupLanes.reduce((max, l) =>
        l.currentNumber > max ? l.currentNumber : max, 0)

      // nextNumber: derived from the primary lane (lowest ID) which holds the shared pool
      const primaryLane = [...groupLanes].sort((a, b) => Number(a.id) - Number(b.id))[0]
      const maxNumberToday = primaryLane.queueItems.length > 0
        ? Math.max(...primaryLane.queueItems.map(i => i.number))
        : 0
      const nextNumber = maxNumberToday >= 999 ? 1 : maxNumberToday + 1

      return {
        // Use serviceGroup as the ID for grouped services, laneId for singles
        id: isGroup ? key : String(groupLanes[0].id),
        serviceGroup: isGroup ? key : null,
        laneId: isGroup ? null : groupLanes[0].id,
        name: displayName,
        description,
        currentNumber,
        waitingCount,
        calledCount,
        nextNumber,
        laneCount: groupLanes.length
      }
    })

    // Sort alphabetically by name
    serviceStatus.sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json(serviceStatus)
  } catch (error) {
    console.error('Get queue status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
