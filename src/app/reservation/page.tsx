'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Clock, Users } from 'lucide-react'

interface ReservationSettings {
  reservation_bg_color: string
  reservation_accent_color: string
  reservation_title: string
  reservation_logo_type: string
  reservation_logo_text: string
  reservation_logo_url: string
  reservation_card_colors: string
}

const DEFAULT_COLORS = ['#22c55e', '#3b82f6', '#ec4899', '#f59e0b', '#84cc16', '#a855f7', '#06b6d4', '#f97316']
const REQUEST_TIMEOUT_MS = 8000

async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      cache: 'no-store',
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDayOfWeek(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

interface LaneStatus {
  id: string
  name: string
  description?: string
  currentNumber: number
  lastServedNumber: number
  waitingCount: number
  calledCount: number
  nextNumber: number
}

interface QueueTicket {
  queueNumber: number
  laneName: string
  currentNumber: number
  waitingCount: number
  estimatedWait: number
}

export default function ReservationPage() {
  const [lanes, setLanes] = useState<LaneStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [gettingNumberFor, setGettingNumberFor] = useState<string | null>(null)
  const [isPrinterConnected, setIsPrinterConnected] = useState(false)
  const [printerStatusText, setPrinterStatusText] = useState('Checking printer...')
  const [printerName, setPrinterName] = useState<string | null>(null)
  const [settings, setSettings] = useState<ReservationSettings>({
    reservation_bg_color: '#f8fafc',
    reservation_accent_color: '#ec4899',
    reservation_title: 'Get your ticket',
    reservation_logo_type: 'text',
    reservation_logo_text: 'YOUR LOGO',
    reservation_logo_url: '',
    reservation_card_colors: JSON.stringify(DEFAULT_COLORS),
  })
  const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Clock tick
  useEffect(() => {
    setCurrentDateTime(new Date())
    const tick = setInterval(() => setCurrentDateTime(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

  // Fetch reservation settings
  useEffect(() => {
    fetchWithTimeout('/api/display-settings')
      .then((r) => r.json())
      .then((data) => {
        setSettings({
          reservation_bg_color: data.reservation_bg_color ?? '#f8fafc',
          reservation_accent_color: data.reservation_accent_color ?? '#ec4899',
          reservation_title: data.reservation_title ?? 'Get your ticket',
          reservation_logo_type: data.reservation_logo_type ?? 'text',
          reservation_logo_text: data.reservation_logo_text ?? 'YOUR LOGO',
          reservation_logo_url: data.reservation_logo_url ?? '',
          reservation_card_colors: data.reservation_card_colors ?? JSON.stringify(DEFAULT_COLORS),
        })
      })
      .catch(() => {/* use defaults */})
  }, [])

  // Fetch lane status
  useEffect(() => {
    fetchLaneStatus()
    const interval = setInterval(fetchLaneStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  // Printer status
  useEffect(() => {
    fetchPrinterStatus()
    const interval = setInterval(fetchPrinterStatus, 15000)
    return () => clearInterval(interval)
  }, [])

  // SSE for real-time queue updates
  useEffect(() => {
    eventSourceRef.current = new EventSource('/api/queue/events')
    eventSourceRef.current.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data && data.type === 'operation') {
          fetchLaneStatus()
        }
      } catch {/**/}
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [])

  const fetchLaneStatus = async () => {
    try {
      const response = await fetchWithTimeout('/api/queue/reservation', {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      })

      if (!response.ok) {
        setLoadError('Unable to load services right now.')
        setLanes([])
        return
      }

      const data = await response.json()
      setLanes(data)
      setLoadError('')
    } catch (error) {
      console.error('Error fetching reservation lane status:', error)
      setLoadError('Cannot reach the queue server from this device.')
      setLanes([])
    } finally {
      setIsLoading(false)
    }
  }

  const fetchPrinterStatus = async () => {
    try {
      const response = await fetchWithTimeout('/api/print/status', { cache: 'no-cache' })
      if (!response.ok) {
        setIsPrinterConnected(false)
        setPrinterStatusText('Printer status unavailable')
        setPrinterName(null)
        return
      }
      const data = await response.json()
      const connected = Boolean(data.connected)
      const printers: string[] = Array.isArray(data.printers) ? data.printers : []
      const readyPrinters: string[] = Array.isArray(data.readyPrinters) ? data.readyPrinters : []
      const defaultPrinter = typeof data.defaultPrinter === 'string' ? data.defaultPrinter : null
      const details = typeof data.details === 'string' ? data.details : ''
      const preferredPrinter = readyPrinters.includes(defaultPrinter ?? '')
        ? defaultPrinter
        : readyPrinters[0] || defaultPrinter || printers[0] || null

      setIsPrinterConnected(connected)
      setPrinterName(connected ? preferredPrinter : null)
      if (connected) {
        setPrinterStatusText(preferredPrinter ? `Printer ready: ${preferredPrinter}` : `Printer ready (${readyPrinters.length || printers.length})`)
      } else {
        setPrinterStatusText(details || 'Printer offline or unavailable')
      }
    } catch {
      setIsPrinterConnected(false)
      setPrinterStatusText('Printer status unavailable')
      setPrinterName(null)
    }
  }

  const printTicket = async (ticketData: QueueTicket) => {
    try {
      const currentTime = new Date()
      const timestamp = currentTime.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      const response = await fetch('/api/print/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueNumber: ticketData.queueNumber,
          laneName: ticketData.laneName,
          currentNumber: ticketData.currentNumber,
          timestamp,
        }),
      })
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const details = data.details ? ` (${data.details})` : ''
          toast.success(`Physical ticket printed successfully!${details}`)
        } else {
          const details = data.details || data.error || 'Unknown print service response'
          console.error('printTicket returned success HTTP but data.success is false', { data })
          toast.error(`Printing failed: ${details}`)
        }
      } else {
        let errorData: { error?: string; details?: string } = {}
        try {
          errorData = await response.json()
        } catch (jsonError) {
          console.warn('printTicket: response JSON parse failed', jsonError)
        }
        const errorDetails = errorData.details || errorData.error || `HTTP ${response.status}`
        console.error('printTicket failed', { status: response.status, errorDetails })
        if (response.status === 503) {
          toast.error(`No printer available. ${errorDetails}`)
        } else {
          toast.error(`Printing failed: ${errorDetails}`)
        }
      }
    } catch {
      toast.error('Failed to print ticket. Please check printer connection.')
    }
  }

  const getQueueNumber = async (laneId: string) => {
    if (gettingNumberFor) return
    if (!isPrinterConnected) {
      toast.warning('Printer is not connected or not ready; the ticket may not print.')
    }
    setGettingNumberFor(laneId)
    try {
      const response = await fetch('/api/queue/reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laneId }),
      })
      if (response.ok) {
        const data = await response.json()
        await printTicket({
          queueNumber: data.queueNumber,
          laneName: data.laneName,
          currentNumber: data.currentNumber,
          waitingCount: data.waitingCount,
          estimatedWait: data.estimatedWait,
        })
        toast.success(`Queue number ${data.queueNumber} assigned for ${data.laneName}!`)
        fetchLaneStatus()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to get queue number')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setGettingNumberFor(null)
    }
  }

  const estimateWait = (waitingCount: number) => {
    if (waitingCount === 0) return '< 1'
    const mins = waitingCount * 5
    return mins < 60 ? `${mins}` : `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: settings.reservation_bg_color }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-gray-500 mx-auto" />
          <p className="mt-4 text-gray-600">Loading services...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: settings.reservation_bg_color }}>
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5">
        <div className="text-black">
          {settings.reservation_logo_type === 'image' && settings.reservation_logo_url ? (
            <img
              src={settings.reservation_logo_url}
              alt="Reservation logo"
              className="h-10 object-contain"
            />
          ) : (
            <span className="font-bold text-lg tracking-wide text-black">
              {settings.reservation_logo_text || 'YOUR LOGO'}
            </span>
          )}
        </div>

        <div className="text-right text-black">
          <div className="text-sm font-medium text-black/70">
            {currentDateTime ? formatDate(currentDateTime) : 'Loading...'}
          </div>
          <div className="font-bold text-xl leading-tight text-black">
            {currentDateTime ? formatTime(currentDateTime) : '--:--'}
          </div>
          <div className="text-xs text-black/50">
            {currentDateTime ? formatDayOfWeek(currentDateTime) : ''}
          </div>
        </div>
      </header>

      {/* Title */}
      <div className="text-center pt-1 pb-6 px-4">
        <h1 className="text-black text-2xl font-semibold tracking-wide">
          {settings.reservation_title}
        </h1>
      </div>

      {/* Lane Cards */}
      <div className="px-6 pb-12 space-y-3 max-w-2xl mx-auto">
        {lanes.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4 opacity-20">🏢</div>
            <h3 className="text-gray-600 text-lg font-medium">
              {loadError ? 'Connection issue' : 'No Services Available'}
            </h3>
            <p className="text-gray-500 text-sm mt-1">
              {loadError || 'All service lanes are currently closed.'}
            </p>
          </div>
        ) : (
          lanes.map((lane) => {
            const isThisLoading = gettingNumberFor === lane.id
            const isAnyLoading = gettingNumberFor !== null
            const wait = estimateWait(lane.waitingCount)

            return (
              <button
                key={lane.id}
                onClick={() => getQueueNumber(lane.id)}
                disabled={isAnyLoading}
                className={[
                  'w-full flex items-center gap-4 rounded-xl px-5 py-4',
                  'bg-white border',
                  'text-left transition-all duration-150',
                  isAnyLoading && !isThisLoading ? 'opacity-50 cursor-not-allowed' : '',
                  !isAnyLoading ? 'hover:bg-gray-50 active:bg-gray-100 cursor-pointer' : '',
                ].join(' ')}
                style={{ borderColor: settings.reservation_accent_color }}
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                  {isThisLoading ? (
                    <div className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-gray-700 animate-spin" />
                  ) : (
                    <Users className="w-5 h-5 text-gray-700" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-black font-semibold text-base leading-snug truncate">
                    {lane.name}
                  </div>
                  {lane.description && (
                    <div className="text-gray-600 text-sm truncate mt-0.5">
                      {lane.description}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex flex-col items-center gap-0.5">
                    <Clock className="w-4 h-4 text-gray-700" />
                    <span className="text-gray-700 text-xs">{wait} min</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <Users className="w-4 h-4 text-gray-700" />
                    <span className="text-gray-700 text-xs">{lane.waitingCount}</span>
                  </div>
                </div>

                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="w-4 h-4 text-gray-500 shrink-0"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )
          })
        )}
      </div>

      {/* Printer status */}
      <div className="fixed bottom-4 left-4 z-20 flex items-center gap-1.5 text-xs text-gray-600">
        <div className={`w-1.5 h-1.5 rounded-full ${isPrinterConnected ? 'bg-green-400/70' : 'bg-red-400/40'}`} />
        <span>{printerName ?? printerStatusText}</span>
      </div>
    </div>
  )
}

