'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

interface LaneStatus {
  id: string
  name: string
  serviceGroup: string | null
  prefix: string | null
  window: string | null
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

const REQUEST_TIMEOUT_MS = 8000
const NORMAL_MEDIA_VOLUME = 1
const DUCKED_MEDIA_VOLUME = 0.07
const DUCK_DURATION_MS = 1700

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

interface ExtendedAudioElement extends HTMLAudioElement {
  playNotification?: () => void
}

interface ExtendedWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

interface YtPlayerController {
  destroy(): void
  mute(): void
  unMute(): void
  playVideo?: () => void
  getIframe?: () => HTMLIFrameElement
  setVolume?: (volume: number) => void
  getVolume?: () => number
}

export default function DisplayPage() {
  const [lanes, setLanes] = useState<LaneStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS)
  const [recentlyUpdatedLanes, setRecentlyUpdatedLanes] = useState<Set<string>>(new Set())
  const [isConnected, setIsConnected] = useState(false)
  const [connectionRetries, setConnectionRetries] = useState(0)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0)
  const [mediaKey, setMediaKey] = useState(0)
  const [ytApiReady, setYtApiReady] = useState(false)
  // null = not yet checked, true = unlocked, false = blocked (show overlay)
  const [audioUnlocked, setAudioUnlocked] = useState<boolean | null>(null)
  const audioUnlockedRef = useRef(false)

  const audioRef = useRef<ExtendedAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const previousLanesRef = useRef<LaneStatus[]>([])
  const ytPlayerRef = useRef<YtPlayerController | null>(null)
  const ytContainerRef = useRef<HTMLDivElement>(null)
  const videoElementRef = useRef<HTMLVideoElement | null>(null)
  const volumeRestoreTimerRef = useRef<number | null>(null)
  const mediaVolumeRef = useRef(NORMAL_MEDIA_VOLUME)
  const handleMediaNextRef = useRef<() => void>(() => {})

  // On mount: check if Chrome allows autoplay-with-sound for this origin.
  useEffect(() => {
    type NavWithAutoplay = Navigator & { getAutoplayPolicy?: (type: string) => string }
    const nav = navigator as NavWithAutoplay
    if (typeof nav.getAutoplayPolicy === 'function') {
      if (nav.getAutoplayPolicy('mediaelement') === 'allowed') {
        audioUnlockedRef.current = true
        setAudioUnlocked(true)
        return
      }
    }
    // Restore from localStorage (set after a prior successful unmuted play).
    if (localStorage.getItem('display_audio_unlocked') === 'true') {
      audioUnlockedRef.current = true
      setAudioUnlocked(true)
    } else {
      setAudioUnlocked(false)
    }
  }, [])

  const unlockAudio = useCallback(() => {
    audioUnlockedRef.current = true
    setAudioUnlocked(true)
    localStorage.setItem('display_audio_unlocked', 'true')
    // Resume the shared AudioContext so chimes fire immediately after this gesture.
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
    // Called from a click handler (user gesture) — Chrome allows muted=false here.
    const v = videoElementRef.current
    if (v) {
      v.muted = false
      v.volume = mediaVolumeRef.current
      if (v.paused) {
        v.play().catch(() => {})
      }
    }
  }, [])

  const setMediaVolume = useCallback((volume: number) => {
    const clamped = Math.min(Math.max(volume, 0), 1)
    mediaVolumeRef.current = clamped

    if (videoElementRef.current) {
      videoElementRef.current.volume = clamped
    }

    const ytPlayer = ytPlayerRef.current
    if (ytPlayer?.setVolume) {
      ytPlayer.setVolume(Math.round(clamped * 100))
    }
  }, [])

  const playNotificationWithDucking = useCallback(() => {
    if (audioRef.current?.playNotification) {
      setTimeout(() => audioRef.current?.playNotification?.(), 50)
    }

    setMediaVolume(DUCKED_MEDIA_VOLUME)

    if (volumeRestoreTimerRef.current !== null) {
      window.clearTimeout(volumeRestoreTimerRef.current)
    }

    volumeRestoreTimerRef.current = window.setTimeout(() => {
      setMediaVolume(NORMAL_MEDIA_VOLUME)
      volumeRestoreTimerRef.current = null
    }, DUCK_DURATION_MS)
  }, [setMediaVolume])

  // Fetch display settings
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetchWithTimeout('/api/display-settings', { cache: 'no-cache' })
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

  // Initialize audio — one persistent AudioContext reused for all chimes.
  // Chrome starts AudioContexts in 'suspended' state until a user gesture;
  // we resume it the moment Chrome grants audio permission.
  useEffect(() => {
    const extWindow = window as ExtendedWindow
    const ctx = new (window.AudioContext || extWindow.webkitAudioContext!)()
    audioContextRef.current = ctx

    audioRef.current = new Audio() as ExtendedAudioElement
    const playNotification = () => {
      const audioContext = audioContextRef.current
      if (!audioContext) return
      // Resume in case it's still suspended (e.g. MEI granted autoplay but
      // AudioContext wasn't resumed yet).
      const play = () => {
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
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(play).catch(() => {})
      } else {
        play()
      }
    }
    if (audioRef.current) {
      audioRef.current.playNotification = playNotification
    }
    return () => {
      ctx.close().catch(() => {})
      audioContextRef.current = null
    }
  }, [])

  const sortLanes = useCallback((data: LaneStatus[]) => {
    return [...data].sort((a, b) => {
      const wa = a.window !== null ? parseInt(a.window, 10) : Infinity
      const wb = b.window !== null ? parseInt(b.window, 10) : Infinity
      if (isFinite(wa) && isFinite(wb)) return wa - wb
      if (isFinite(wa)) return -1
      if (isFinite(wb)) return 1
      return 0
    })
  }, [])

  const fetchLaneStatus = useCallback(async () => {
    try {
      const response = await fetchWithTimeout('/api/queue/display-lanes', {
        cache: 'no-cache',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
      })

      if (!response.ok) {
        setLoadError('Unable to load queue data right now.')
        setIsConnected(false)
        setLanes([])
        return
      }

      const data = await response.json()
      setLanes(sortLanes(data))
      setLoadError('')
    } catch (error) {
      console.error('Error fetching lane status:', error)
      setLoadError('Cannot reach the queue server from this device.')
      setIsConnected(false)
      setLanes([])
    } finally {
      setIsLoading(false)
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
          setLoadError('')
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
                playNotificationWithDucking()
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
  }, [isPageVisible, connectionRetries, startFallbackPolling, fetchLaneStatus, playNotificationWithDucking])

  // Highlight rows when number changes
  useEffect(() => {
    const prev = previousLanesRef.current
    if (prev.length > 0 && lanes.length > 0) {
      const updatedIds = new Set<string>()
      lanes.forEach((lane) => {
        const prevLane = prev.find((p) => String(p.id) === String(lane.id))
        if (prevLane && prevLane.currentNumber !== lane.currentNumber && lane.currentNumber > 0) {
          updatedIds.add(String(lane.id))
          playNotificationWithDucking()
        }
      })
      if (updatedIds.size > 0) {
        setRecentlyUpdatedLanes(updatedIds)
        setTimeout(() => setRecentlyUpdatedLanes(new Set()), 4000)
      }
    }
    previousLanesRef.current = lanes
  }, [lanes, playNotificationWithDucking])

  useEffect(() => {
    return () => {
      if (volumeRestoreTimerRef.current !== null) {
        window.clearTimeout(volumeRestoreTimerRef.current)
      }
    }
  }, [])

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
  // Keep ref up to date so YT player callbacks never hold a stale closure
  handleMediaNextRef.current = handleMediaNext

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

  // Derive current media item (must be above YouTube effects that reference it)
  const effectiveIndex = mediaItems.length > 0 ? currentMediaIndex : 0
  const currentMedia = mediaItems[effectiveIndex] ?? null

  // ── YouTube IFrame Player API ──────────────────────────────
  // Load the YouTube IFrame API script once when video mode is active.
  // Using the official JS API (instead of raw postMessage parsing) is the
  // only reliable way to receive onStateChange=ENDED events across all
  // browsers without requiring user interaction.
  useEffect(() => {
    if (settings.display_media_type !== 'video') return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    if (win.YT?.Player) { setYtApiReady(true); return }
    if (document.getElementById('yt-iframe-api')) return
    const script = document.createElement('script')
    script.id = 'yt-iframe-api'
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
    win.onYouTubeIframeAPIReady = () => setYtApiReady(true)
  }, [settings.display_media_type])

  // Create / replace the YouTube player whenever the current video URL changes
  // or the API becomes ready for the first time.
  useEffect(() => {
    if (settings.display_media_type !== 'video' || !ytApiReady || !currentMedia) return
    const normalizedUrl = /^(https?:)?\/\//i.test(currentMedia.url) || /^(data:|blob:)/i.test(currentMedia.url)
      ? currentMedia.url
      : currentMedia.url.startsWith('/')
        ? currentMedia.url
        : `/${currentMedia.url}`
    const urlMatch = normalizedUrl.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    )
    const videoId = urlMatch ? urlMatch[1] : null
    if (!videoId || !ytContainerRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const YT = (window as any).YT
    if (!YT?.Player) return

    // Destroy previous player and clear the container so YT gets a fresh element
    ytPlayerRef.current?.destroy()
    ytPlayerRef.current = null
    ytContainerRef.current.innerHTML = ''
    const placeholder = document.createElement('div')
    ytContainerRef.current.appendChild(placeholder)

    ytPlayerRef.current = new YT.Player(placeholder, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
      },
      events: {
        onReady() {
          const player = ytPlayerRef.current
          player?.mute()
          setMediaVolume(mediaVolumeRef.current)
          player?.playVideo?.()

          const iframe = player?.getIframe?.()
          if (iframe) {
            iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture')
          }

          // Reinforce autoplay start in case of an initial buffering/paused state.
          setTimeout(() => player?.playVideo?.(), 300)
        },
        onStateChange(e: { data: number }) {
          // 1 = YT.PlayerState.PLAYING
          if (e.data === 1) {
            const player = ytPlayerRef.current
            setTimeout(() => {
              player?.unMute()
              setMediaVolume(mediaVolumeRef.current)
            }, 250)
          }
          if (e.data === 0) handleMediaNextRef.current() // 0 = YT.PlayerState.ENDED
        },
      },
    })

    return () => {
      ytPlayerRef.current?.destroy()
      ytPlayerRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.display_media_type, currentMedia?.url, ytApiReady, setMediaVolume])

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

  // Check whether the current item is a YouTube video
  function normalizeMediaUrl(url: string): string {
    if (!url) return ''
    if (/^(https?:)?\/\//i.test(url) || /^(data:|blob:)/i.test(url)) return url
    return url.startsWith('/') ? url : `/${url}`
  }

  const currentMediaUrl = normalizeMediaUrl(currentMedia?.url ?? '')

  function extractYouTubeId(url: string): string | null {
    const m = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    )
    return m ? m[1] : null
  }
  const isYouTubeVideo = mediaType === 'video' && !!extractYouTubeId(currentMediaUrl)

  // Auto-scale font based on row count
  const rowCount = Math.max(lanes.length, 1)
  const counterFontSize = `clamp(0.875rem, ${Math.min(6, 36 / rowCount)}vh, 3.5rem)`
  const numberFontSize = `clamp(1rem, ${Math.min(7.5, 44 / rowCount)}vh, 5rem)`
  const headerFontSize = `clamp(0.5rem, ${Math.min(2.5, 14 / rowCount)}vh, 1.5rem)`

  // Service label font: same size as counter but shrinks proportionally for long names
  const getServiceFontSize = (name: string): string => {
    const baseVh = Math.min(6, 36 / rowCount)
    const maxChars = 9 // chars that fit comfortably at full size
    const scale = name.length > maxChars ? maxChars / name.length : 1
    const minRem = Math.max(0.5, 0.875 * scale)
    return `clamp(${minRem.toFixed(3)}rem, ${(baseVh * scale).toFixed(2)}vh, ${(3.5 * scale).toFixed(2)}rem)`
  }

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
            className="flex-none grid border-b"
            style={{ backgroundColor: secondaryColor, borderColor: `${textColor}33`, gridTemplateColumns: '3fr 1fr 2fr' }}
          >
            <div
              className="text-center font-bold py-3 px-2 border-r"
              style={{ color: textColor, fontSize: headerFontSize, borderColor: `${textColor}33` }}
            >
              SERVICE
            </div>
            <div
              className="text-center font-bold py-3 px-2 border-r"
              style={{ color: textColor, fontSize: headerFontSize, borderColor: `${textColor}33` }}
            >
              WINDOW
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
              {loadError || 'No active counters'}
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
                    className="flex-1 grid transition-colors duration-500 min-h-0 border-b"
                    style={{ backgroundColor: rowBg, borderColor: `${textColor}18`, gridTemplateColumns: '3fr 1fr 2fr' }}
                  >
                    {/* Service label */}
                    <div
                      className="flex items-center justify-center text-center font-semibold px-3 border-r overflow-hidden"
                      style={{ color: labelColor, fontSize: getServiceFontSize(lane.serviceGroup || lane.name), borderColor: `${textColor}18` }}
                    >
                      <span className="leading-tight whitespace-nowrap">{lane.serviceGroup || lane.name}</span>
                    </div>

                    {/* Window label */}
                    <div
                      className="flex items-center justify-center text-center font-semibold px-3 border-r overflow-hidden"
                      style={{ color: labelColor, fontSize: counterFontSize, borderColor: `${textColor}18` }}
                    >
                      <span className="truncate leading-tight">{lane.window || '—'}</span>
                    </div>

                    {/* Ticket number */}
                    <div
                      className="flex items-center justify-center font-black font-mono overflow-hidden"
                      style={{ color: numColor, fontSize: numberFontSize }}
                    >
                      {lane.currentNumber === 0
                        ? '----'
                        : lane.prefix
                          ? lane.prefix + lane.currentNumber.toString().padStart(3, '0')
                          : lane.currentNumber.toString().padStart(4, '0')}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Media Playlist */}
        {mediaType !== 'none' && mediaItems.length > 0 && (
          <div className="flex-1 bg-black overflow-hidden">
            {mediaType === 'image' ? (
              <img
                key={mediaKey}
                src={currentMediaUrl}
                alt="Display media"
                className="w-full h-full object-cover"
                onError={handleMediaNext}
              />
            ) : isYouTubeVideo ? (
              <div ref={ytContainerRef} className="w-full h-full bg-black" />
            ) : (
              <video
                key={mediaKey}
                ref={videoElementRef}
                src={currentMediaUrl}
                playsInline
                preload="auto"
                className="w-full h-full object-cover"
                onEnded={handleMediaNext}
                onError={handleMediaNext}
                onCanPlay={(event) => {
                  const v = event.currentTarget
                  // Only attempt once per element instance (key resets this per playlist item).
                  if (v.dataset.playAttempted) return
                  v.dataset.playAttempted = 'true'
                  v.volume = mediaVolumeRef.current
                  // Chrome recommended pattern (https://developer.chrome.com/blog/autoplay/):
                  // call play() explicitly and handle the rejection promise.
                  // Chrome allows unmuted play if MEI score is sufficient (built up from
                  // regular use) or if the user has interacted with the domain before.
                  v.play()
                    .then(() => {
                      // Unmuted autoplay allowed — resume AudioContext to enable chimes.
                      audioContextRef.current?.resume().catch(() => {})
                      audioUnlockedRef.current = true
                      setAudioUnlocked(true)
                      localStorage.setItem('display_audio_unlocked', 'true')
                    })
                    .catch(() => {
                      // Chrome blocked unmuted autoplay — fall back to muted and show overlay.
                      audioUnlockedRef.current = false
                      setAudioUnlocked(false)
                      localStorage.removeItem('display_audio_unlocked')
                      v.muted = true
                      v.play().catch(() => {})
                    })
                }}
              />
            )}
          </div>
        )}
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

      {/* Audio unlock overlay — only shown when Chrome blocks unmuted autoplay.
           Solved permanently by launching Chrome with --autoplay-policy=no-user-gesture-required */}
      {audioUnlocked === false && (
        <div
          className="fixed inset-0 z-50 cursor-pointer"
          onClick={unlockAudio}
          aria-label="Click to enable audio"
        >
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 text-white text-sm px-4 py-2 rounded-full select-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
            <span>Click anywhere to enable audio</span>
          </div>
        </div>
      )}
    </div>
  )
}
