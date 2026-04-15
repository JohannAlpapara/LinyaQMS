import { NextResponse } from 'next/server'
import { getPrinterStatus } from '@/lib/printers'

export async function GET() {
  try {
    const status = await getPrinterStatus()
    return NextResponse.json(status)
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : 'Unknown printer status error'
    return NextResponse.json(
      {
        connected: false,
        platform: process.platform,
        printers: [],
        readyPrinters: [],
        defaultPrinter: null,
        details,
      },
      { status: 500 }
    )
  }
}
