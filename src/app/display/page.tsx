'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

interface LaneStatus {
  id: string
  name: string
  currentNumber: number
  lastServedNumber: number
  waitingCount: number
  nextNumber: number
}

interface MediaItem {
  url: string
  duration: number
}

interface DisplaySettings {
  display_header_type: string
  display_header_text: string
  display_header_image_url: string
  display_media_type: string
  display_media_items: string
  display_footer_text: string
  display_footer_animation: string
  display_primary_color: string
  display_secondary_color: string
  display_header_bg_color: string
  display_text_color: string
}

const DEFAULT_SETTINGS: DisplaySettings = {
  display_header_type: 'text',
  display_header_text: 'NOW SERVING',
  display_header_image_url: '',
  display_media_type: 'none',
  display_media_items: '[]',
  display_footer_text: '',
  display_footer_animation: 'static',
  display_primary_color: '#2a9d8f',
  display_secondary_color: '#1a7268',
  display_header_bg_color: '#ffffff',
  display_text_color: '#ffffff',
}

interface ExtendedAudioElement extends HTMLAudioElement {
  playNotification?: () => void
}

interface ExtendedWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

export default function DisplayPage() {
  const [lanes, setLanes] = useState<LaneStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS)
  const [recentlyUpdatedLanes, setRecentlyUpdatedLanes] = useState<Set<string>>(new Set())
  const [isConnected, setIsConnected] = useState(false)
  const [connectionRetries, setConnectionRetries] = useState(0)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0)
  const [mediaKey, setMediaKey] = useState(0)

  const audioRef = useRef<ExtendedAudioElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const previousLanesRef = useRef<LaneStatus[]>([])

  // Fetch display settings
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/display-settings', { cache: 'no-cache' })
      if (response.ok) {
        const data = await response.json()
        setSettings(data)
      }
    } catch (error) {
      console.error('Error fetching display settings:', error)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
    const interval = setInterval(fetchSettings, 30000)
    return () => clearInterval(interval)
  }, [fetchSettings])

  // Initialize audio
  useEffect(() => {
    audioRef.current = new Audio() as ExtendedAudioElement
    const playNotification = () => {
      const extWindow = window as ExtendedWindow
      const audioContext = new (window.AudioContext || extWindow.webkitAudioContext!)()
      const frequencies = [800, 1000, 1200]
      frequencies.forEach((freq, index) => {
        setTimeout(() => {
          const osc = audioContext.createOscillator()
          const gain = audioContext.createGain()
          osc.connect(gain)
          gain.connect(audioContext.destination)
          osc.frequency.setValueAtTime(freq, audioContext.currentTime)
          gain.gain.setValueAtTime(0.3, audioContext.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5)
          osc.start(audioContext.currentTime)
          osc.stop(audioContext.currentTime + 0.5)
        }, index * 200)
      })
    }
    if (audioRef.current) {
      audioRef.current.playNotification = playNotification
    }
  }, [])

  const sortLanes = useCallback((data: LaneStatus[]) => {
    return [...data].sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      if (nameCompare !== 0) return nameCompare
      return Number(a.id) - Number(b.id)
    })
  }, [])

  const fetchLaneStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/queue/reservation', {
        cache: 'no-cache',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
      })
      if (response.ok) {
        const data = await response.json()
        setLanes(sortLanes(data))
        setIsLoading(false)
      }
    } catch (error) {
      console.error('Error fetching lane status:', error)
    }
  }, [sortLanes])

  const startFallbackPolling = useCallback(() => {
    const interval = setInterval(() => {
      if (isPageVisible) fetchLaneStatus()
    }, 2000)
    return () => clearInterval(interval)
  }, [isPageVisible, fetchLaneStatus])

  useEffect(() => {
    if (!isPageVisible) return

    const connectSSE = () => {
      try {
        if (eventSourceRef.current) {
          eventSourceRef.current.close()
          eventSourceRef.current = null
        }

        eventSourceRef.current = new EventSource('/api/queue/events')

        eventSourceRef.current.onopen = () => {
          setIsConnected(true)
          setConnectionRetries(0)
          setIsLoading(false)
        }

        eventSourceRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'lanes_update') {
              // Full lane data pushed directly — update immediately, no secondary fetch
              setLanes(sortLanes(data.lanes))
              setIsLoading(false)
            } else if (data.type === 'operation') {
              // Play sound and highlight the affected lane right away
              if (['CALL', 'BUZZ', 'NEXT', 'SERVE'].includes(data.action)) {
                if (audioRef.current?.playNotification) {
                  setTimeout(() => audioRef.current!.playNotification!(), 50)
                }
                setRecentlyUpdatedLanes((prev) => new Set([...prev, data.laneId.toString()]))
                setTimeout(() => {
                  setRecentlyUpdatedLanes((prev) => {
                    const next = new Set(prev)
                    next.delete(data.laneId.toString())
                    return next
                  })
                }, 3000)
              }
              // broadcastAllLaneData fires right after the operation event, so
              // lanes_update will arrive momentarily — no extra fetch needed.
            }
          } catch (error) {
            console.error('Error parsing SSE data:', error)
          }
        }

        eventSourceRef.current.onerror = () => {
          setIsConnected(false)
          eventSourceRef.current?.close()
          eventSourceRef.current = null
          // Trigger reconnect via state; the effect will re-run
          setConnectionRetries((prev) => {
            if (prev >= 5) return prev // hand off to polling
            return prev + 1
          })
        }
      } catch {
        startFallbackPolling()
      }
    }

    if (connectionRetries < 5) {
      const delay = connectionRetries === 0 ? 0 : Math.min(1000 * Math.pow(2, connectionRetries - 1), 30000)
      const t = setTimeout(connectSSE, delay)
      return () => {
        clearTimeout(t)
        if (eventSourceRef.current) {
          eventSourceRef.current.close()
          eventSourceRef.current = null
        }
      }
    } else {
      return startFallbackPolling()
    }
  }, [isPageVisible, connectionRetries, startFallbackPolling, fetchLaneStatus])

  // Highlight rows when number changes
  useEffect(() => {
    const prev = previousLanesRef.current
    if (prev.length > 0 && lanes.length > 0) {
      const updatedIds = new Set<string>()
      lanes.forEach((lane) => {
        const prevLane = prev.find((p) => String(p.id) === String(lane.id))
        if (prevLane && prevLane.currentNumber !== lane.currentNumber && lane.currentNumber > 0) {
          updatedIds.add(String(lane.id))
          if (audioRef.current?.playNotification) {
            setTimeout(() => audioRef.current!.playNotification!(), 100)
          }
        }
      })
      if (updatedIds.size > 0) {
        setRecentlyUpdatedLanes(updatedIds)
        setTimeout(() => setRecentlyUpdatedLanes(new Set()), 4000)
      }
    }
    previousLanesRef.current = lanes
  }, [lanes])

  useEffect(() => {
    fetchLaneStatus()
  }, [fetchLaneStatus])

  // Guaranteed safety-net polling: fetches lane data every 2 seconds regardless
  // of SSE state. This ensures the display is always up-to-date even if the SSE
  // connection or in-process broadcast is disrupted (e.g. dev HMR, cold starts).
  useEffect(() => {
    const interval = setInterval(() => {
      if (isPageVisible) fetchLaneStatus()
    }, 2000)
    return () => clearInterval(interval)
  }, [isPageVisible, fetchLaneStatus])

  useEffect(() => {
    const handleVisibilityChange = () => setIsPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    const handleFocus = () => {
      if (!isConnected && isPageVisible) window.location.reload()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [isConnected, isPageVisible])

  // Parse the media items list (stable reference via useMemo)
  const mediaItems = useMemo<MediaItem[]>(() => {
    try {
      const parsed = JSON.parse(settings.display_media_items || '[]')
      return Array.isArray(parsed) ? parsed.filter((i: MediaItem) => i.url) : []
    } catch {
      return []
    }
  }, [settings.display_media_items])

  // ── Media playlist ──────────────────────────────────────────
  const handleMediaNext = useCallback(() => {
    if (mediaItems.length === 0) return
    setCurrentMediaIndex((prev) => (prev + 1) % mediaItems.length)
    setMediaKey((prev) => prev + 1)
  }, [mediaItems.length])

  // Reset playlist index when settings change
  useEffect(() => {
    setCurrentMediaIndex(0)
    setMediaKey(0)
  }, [settings.display_media_items, settings.display_media_type])

  // Keep current index in range if media list shrinks
  useEffect(() => {
    if (mediaItems.length === 0) {
      setCurrentMediaIndex(0)
      return
    }
    setCurrentMediaIndex((prev) => prev % mediaItems.length)
  }, [mediaItems.length])

  // Image slideshow: advance after configured duration
  useEffect(() => {
    if (settings.display_media_type !== 'image' || mediaItems.length === 0) return
    const item = mediaItems[currentMediaIndex]
    const ms = Math.max((item?.duration ?? 10), 1) * 1000
    const timer = setTimeout(handleMediaNext, ms)
    return () => clearTimeout(timer)
  }, [settings.display_media_type, mediaItems, currentMediaIndex, handleMediaNext])

  // YouTube video-ended detection via postMessage (no external script needed)
  useEffect(() => {
    if (settings.display_media_type !== 'video') return
    const handler = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com' && event.origin !== 'https://www.youtube-nocookie.com') return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        const ended =
          (data.event === 'onStateChange' && data.info === 0) ||
          (data.event === 'infoDelivery' && data.info?.playerState === 0)
        if (ended) handleMediaNext()
      } catch { /* noop */ }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [settings.display_media_type, handleMediaNext])

  const {
    display_header_type: headerType,
    display_header_text: headerText,
    display_header_image_url: headerImageUrl,
    display_media_type: mediaType,
    display_footer_text: footerText,
    display_footer_animation: footerAnimation,
    display_primary_color: primaryColor,
    display_secondary_color: secondaryColor,
    display_header_bg_color: headerBgColor,
    display_text_color: textColor,
  } = settings

  // Derive current media item
  const effectiveIndex = mediaItems.length > 0 ? currentMediaIndex : 0
  const currentMedia = mediaItems[effectiveIndex] ?? null

  // Convert YouTube watch/share/embed URLs to embed URLs with API enabled
  function getYouTubeEmbedUrl(url: string): string | null {
    const match = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    )
    if (match) {
      const id = match[1]
      const origin = typeof window !== 'undefined' ? `&origin=${encodeURIComponent(window.location.origin)}` : ''
      return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=0&controls=0&rel=0&modestbranding=1&playsinline=1&enablejsapi=1${origin}`
    }
    return null
  }

  // Auto-scale font based on row count
  const rowCount = Math.max(lanes.length, 1)
  const counterFontSize = `clamp(0.875rem, ${Math.min(6, 36 / rowCount)}vh, 3.5rem)`
  const numberFontSize = `clamp(1rem, ${Math.min(7.5, 44 / rowCount)}vh, 5rem)`
  const headerFontSize = `clamp(0.5rem, ${Math.min(2.5, 14 / rowCount)}vh, 1.5rem)`

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: primaryColor }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-white mx-auto mb-4" />
          <p className="text-white text-xl">Loading display...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none">
      <style>{`
        @keyframes dsplay-marquee-left {
          0%   { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
        @keyframes dsplay-marquee-right {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100vw); }
        }
      `}</style>
      {/* ── Header ── */}
      <header
        className="flex-none flex items-center justify-center px-8"
        style={{ backgroundColor: headerBgColor, minHeight: '80px', maxHeight: '100px' }}
      >
        {headerType === 'text' ? (
          <h1
            className="font-extrabold tracking-widest text-center uppercase"
            style={{ color: primaryColor, fontSize: 'clamp(1.5rem, 4vw, 3.5rem)' }}
          >
            {headerText || 'NOW SERVING'}
          </h1>
        ) : headerImageUrl ? (
          <img
            src={headerImageUrl}
            alt="Header"
            className="max-h-[64px] object-contain"
          />
        ) : (
          <h1
            className="font-extrabold tracking-widest text-center uppercase"
            style={{ color: primaryColor, fontSize: 'clamp(1.5rem, 4vw, 3.5rem)' }}
          >
            NOW SERVING
          </h1>
        )}
      </header>

      {/* ── Main Content ── */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left: Queue Table */}
        <div
          className="flex flex-col overflow-hidden"
          style={{
            width: mediaType !== 'none' && mediaItems.length > 0 ? '43%' : '100%',
            backgroundColor: primaryColor,
          }}
        >
          {/* Column headers */}
          <div
            className="flex-none grid grid-cols-2 border-b"
            style={{ backgroundColor: secondaryColor, borderColor: `${textColor}33` }}
          >
            <div
              className="text-center font-bold py-3 px-2 border-r"
              style={{ color: textColor, fontSize: headerFontSize, borderColor: `${textColor}33` }}
            >
              COUNTER
            </div>
            <div
              className="text-center font-bold py-3 px-2"
              style={{ color: textColor, fontSize: headerFontSize }}
            >
              TICKET NUMBER
            </div>
          </div>

          {/* Rows */}
          {lanes.length === 0 ? (
            <div
              className="flex-1 flex items-center justify-center"
              style={{ color: textColor, opacity: 0.5, fontSize: '1.25rem' }}
            >
              No active counters
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {lanes.map((lane, index) => {
                const isHighlighted = recentlyUpdatedLanes.has(String(lane.id))
                const rowBg = isHighlighted
                  ? '#f0c040'
                  : index % 2 === 0
                  ? primaryColor
                  : secondaryColor
                const numColor = isHighlighted ? '#1a1a1a' : '#ffd700'
                const labelColor = isHighlighted ? '#1a1a1a' : textColor

                return (
                  <div
                    key={lane.id}
                    className="flex-1 grid grid-cols-2 transition-colors duration-500 min-h-0 border-b"
                    style={{ backgroundColor: rowBg, borderColor: `${textColor}18` }}
                  >
                    {/* Counter label */}
                    <div
                      className="flex items-center justify-center text-center font-semibold px-3 border-r overflow-hidden"
                      style={{ color: labelColor, fontSize: counterFontSize, borderColor: `${textColor}18` }}
                    >
                      <span className="truncate leading-tight">{lane.name}</span>
                    </div>

                    {/* Ticket number */}
                    <div
                      className="flex items-center justify-center font-black font-mono overflow-hidden"
                      style={{ color: numColor, fontSize: numberFontSize }}
                    >
                      {lane.currentNumber === 0
                        ? '----'
                        : lane.currentNumber.toString().padStart(4, '0')}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Media Playlist */}
        {mediaType !== 'none' && mediaItems.length > 0 && (() => {
          const youtubeUrl = mediaType === 'video' ? getYouTubeEmbedUrl(currentMedia?.url ?? '') : null
          return (
            <div className="flex-1 bg-black overflow-hidden">
              {mediaType === 'image' ? (
                <img
                  key={mediaKey}
                  src={currentMedia?.url}
                  alt="Display media"
                  className="w-full h-full object-cover"
                  onError={handleMediaNext}
                />
              ) : youtubeUrl ? (
                <iframe
                  key={mediaKey}
                  src={youtubeUrl}
                  className="w-full h-full border-0"
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                  title="Display video"
                />
              ) : (
                <video
                  key={mediaKey}
                  src={currentMedia?.url}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                  onEnded={handleMediaNext}
                  onError={handleMediaNext}
                />
              )}
            </div>
          )
        })()}
        {mediaType !== 'none' && mediaItems.length === 0 && (
          <div className="flex-1 bg-black" />
        )}
      </main>

      {/* ── Footer ── */}
      {footerText && (
        <footer
          className="flex-none flex items-center"
          style={{ backgroundColor: secondaryColor, minHeight: '80px', maxHeight: '100px' }}
        >
          {footerAnimation === 'marquee-left' || footerAnimation === 'marquee-right' ? (
            <div style={{ width: '100%', overflow: 'hidden' }}>
              <span
                style={{
                  display: 'inline-block',
                  whiteSpace: 'nowrap',
                  color: textColor,
                  fontSize: 'clamp(1rem, 2.5vw, 2rem)',
                  fontWeight: 600,
                  animation:
                    footerAnimation === 'marquee-left'
                      ? 'dsplay-marquee-left 28s linear infinite'
                      : 'dsplay-marquee-right 28s linear infinite',
                }}
              >
                {footerText}
              </span>
            </div>
          ) : (
            <p
              className="font-semibold text-center w-full px-8"
              style={{ color: textColor, fontSize: 'clamp(1rem, 2.5vw, 2rem)' }}
            >
              {footerText}
            </p>
          )}
        </footer>
      )}

      {/* Connection dot */}
      <div className="fixed bottom-3 right-3 flex items-center gap-2 bg-black/60 text-white text-xs px-3 py-2 rounded-lg">
        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
        {isConnected ? 'Live' : 'Reconnecting...'}
      </div>
    </div>
  )
}
