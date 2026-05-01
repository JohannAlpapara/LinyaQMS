import { NextRequest, NextResponse } from 'next/server'
import { printTicketText } from '@/lib/printers'

interface PrintTicketRequest {
  queueNumber: string | number
  laneName: string
  currentNumber: number
  timestamp: string
}

export async function POST(request: NextRequest) {
  try {
    const { queueNumber, laneName, currentNumber, timestamp }: PrintTicketRequest = await request.json()
    const formattedDate = new Date(timestamp).toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

    const ticketContent = [
      'Queue Ticket',
      'Please keep this ticket until your number is called',
      '===============================',
      formattedDate,
      '',
      `Number: ${queueNumber}`,
      `Service: ${laneName}`,
      `Now Serving: ${currentNumber}`,
      '===============================',
      'Please listen to your number or watch the display screen',
      'If you miss your call, please approach the service counter',
      '',
      '',
    ].join('\n')

    const result = await printTicketText(ticketContent)
    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Ticket printing failed',
          details: result.details,
        },
        { status: 503 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Ticket sent to printer',
      details: result.details,
      queueNumber,
    })
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('� Ticket printing error:', errorMessage)
    return NextResponse.json({
      error: 'Ticket printing failed',
      details: errorMessage
    }, { status: 500 })
  }
}
