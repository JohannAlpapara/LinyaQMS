'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  RefreshCw,
  LogOut,
  ChevronLeft,
  BarChart3,
  Activity,
  Users,
  Layers,
  Clock,
  CheckCircle2,
  XCircle,
  Download,
  Calendar,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileText,
  LayoutDashboard,
  TrendingUp,
  AlertCircle,
  UserCheck,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { LaneType } from '@prisma/client'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Summary {
  lanes: { total: number; active: number; inactive: number }
  staff: { total: number; active: number; assignedToActiveLanes: number }
  queue: { waiting: number; called: number; served: number; missed: number; total: number }
  asOf: string
}

interface LaneStatus {
  id: number
  name: string
  type: LaneType
  isActive: boolean
  currentNumber: number
  lastServedNumber: number
  today: { waiting: number; called: number; served: number; missed: number; total: number }
  assignedStaff: { id: number; name: string; username: string; isActive: boolean }[]
}

interface StatRow {
  date: string
  laneId: number
  laneName: string
  laneType: string
  waiting: number
  called: number
  served: number
  missed: number
  total: number
}

type SortKey = keyof StatRow
type SortDir = 'asc' | 'desc'

// ─── Helper Components ───────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string
  value: number | string
  icon: React.ElementType
  color: string
  sub?: string
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground font-medium">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-xl ${color.replace('text-', 'bg-').replace('-600', '-100').replace('-500', '-100')}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-7 text-right">{pct}%</span>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'dashboard' | 'statistics' | 'export'

export default function ReportsPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')

  // Dashboard state
  const [summary, setSummary] = useState<Summary | null>(null)
  const [laneStatuses, setLaneStatuses] = useState<LaneStatus[]>([])
  const [dashLoading, setDashLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const autoRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Statistics state
  const [statsRows, setStatsRows] = useState<StatRow[]>([])
  const [allLanes, setAllLanes] = useState<{ id: number; name: string; type: string }[]>([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsFilters, setStatsFilters] = useState({
    startDate: (() => {
      const d = new Date()
      d.setDate(d.getDate() - 29)
      return d.toISOString().slice(0, 10)
    })(),
    endDate: new Date().toISOString().slice(0, 10),
    laneId: 'all',
  })
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Export state
  const [exportFilters, setExportFilters] = useState({
    startDate: (() => {
      const d = new Date()
      d.setDate(d.getDate() - 29)
      return d.toISOString().slice(0, 10)
    })(),
    endDate: new Date().toISOString().slice(0, 10),
    laneId: 'all',
    type: 'queue_items',
  })
  const [exportLoading, setExportLoading] = useState(false)

  // ── Auth ──────────────────────────────────────────────────────────────────

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      if (res.ok) {
        setIsAuthenticated(true)
      } else {
        window.location.href = '/'
      }
    } catch {
      window.location.href = '/'
    } finally {
      setAuthLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      window.location.href = '/'
    }
  }

  // ── Dashboard data ────────────────────────────────────────────────────────

  const loadDashboard = useCallback(async () => {
    setDashLoading(true)
    try {
      const [sumRes, lanesRes] = await Promise.all([
        fetch('/api/reports/summary'),
        fetch('/api/reports/lanes-status'),
      ])
      if (!sumRes.ok || !lanesRes.ok) throw new Error('Failed to fetch dashboard data')
      const [sumData, lanesData] = await Promise.all([sumRes.json(), lanesRes.json()])
      setSummary(sumData)
      setLaneStatuses(lanesData)
    } catch {
      toast.error('Failed to load dashboard data')
    } finally {
      setDashLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated && activeTab === 'dashboard') {
      loadDashboard()
    }
  }, [isAuthenticated, activeTab, loadDashboard])

  // Auto-refresh for dashboard
  useEffect(() => {
    if (autoRefreshTimer.current) clearInterval(autoRefreshTimer.current)
    if (autoRefresh && activeTab === 'dashboard' && isAuthenticated) {
      autoRefreshTimer.current = setInterval(loadDashboard, 15000)
    }
    return () => {
      if (autoRefreshTimer.current) clearInterval(autoRefreshTimer.current)
    }
  }, [autoRefresh, activeTab, isAuthenticated, loadDashboard])

  // ── Statistics data ───────────────────────────────────────────────────────

  const loadStatistics = useCallback(async () => {
    setStatsLoading(true)
    try {
      const params = new URLSearchParams({
        startDate: statsFilters.startDate,
        endDate: statsFilters.endDate,
        laneId: statsFilters.laneId,
      })
      const res = await fetch(`/api/reports/statistics?${params}`)
      if (!res.ok) throw new Error('Failed to fetch statistics')
      const data = await res.json()
      setStatsRows(data.rows)
      setAllLanes(data.lanes)
    } catch {
      toast.error('Failed to load statistics')
    } finally {
      setStatsLoading(false)
    }
  }, [statsFilters])

  useEffect(() => {
    if (isAuthenticated && activeTab === 'statistics') {
      loadStatistics()
    }
  }, [isAuthenticated, activeTab, loadStatistics])

  // Load lanes list for export tab filter
  useEffect(() => {
    if (isAuthenticated && activeTab === 'export' && allLanes.length === 0) {
      fetch('/api/reports/statistics?startDate=2000-01-01&endDate=2000-01-01')
        .then((r) => r.json())
        .then((d) => setAllLanes(d.lanes ?? []))
        .catch(() => {})
    }
  }, [isAuthenticated, activeTab, allLanes.length])

  // ── Sorting ───────────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedRows = [...statsRows].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return sortDir === 'asc' ? cmp : -cmp
  })

  // ── Summary totals for stats ──────────────────────────────────────────────
  const statsTotals = statsRows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      served: acc.served + r.served,
      waiting: acc.waiting + r.waiting,
      called: acc.called + r.called,
      missed: acc.missed + r.missed,
    }),
    { total: 0, served: 0, waiting: 0, called: 0, missed: 0 }
  )

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    setExportLoading(true)
    try {
      const params = new URLSearchParams({
        startDate: exportFilters.startDate,
        endDate: exportFilters.endDate,
        laneId: exportFilters.laneId,
        type: exportFilters.type,
      })
      const res = await fetch(`/api/reports/export?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : 'report.csv'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`Exported ${filename}`)
    } catch {
      toast.error('Export failed')
    } finally {
      setExportLoading(false)
    }
  }

  // ─── Render guards ────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) return null

  // ─── Sort icon helper ─────────────────────────────────────────────────────
  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey !== col ? (
      <ArrowUpDown className="h-3.5 w-3.5 ml-1 text-muted-foreground" />
    ) : sortDir === 'asc' ? (
      <ArrowUp className="h-3.5 w-3.5 ml-1" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 ml-1" />
    )

  // ─── Tabs ─────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'statistics', label: 'Statistics', icon: BarChart3 },
    { id: 'export', label: 'Export Reports', icon: Download },
  ]

  // ─── JSX ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Top bar ── */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (window.location.href = '/admin')}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Admin
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Reporting</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (activeTab === 'dashboard') loadDashboard()
                else if (activeTab === 'statistics') loadStatistics()
              }}
            >
              <RefreshCw className={`h-4 w-4 ${dashLoading || statsLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Tab nav ── */}
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* ══════════════════════════════════════════════════════════════════
            DASHBOARD TAB
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'dashboard' && (
          <>
            {/* Live indicator + controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                <span className="text-sm text-muted-foreground">
                  {autoRefresh ? 'Live — refreshes every 15 s' : 'Auto-refresh paused'}
                  {summary && (
                    <span className="ml-2">
                      · Last updated{' '}
                      {new Date(summary.asOf).toLocaleTimeString()}
                    </span>
                  )}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoRefresh((v) => !v)}
                className="gap-1.5"
              >
                {autoRefresh ? <Wifi className="h-4 w-4 text-green-600" /> : <WifiOff className="h-4 w-4" />}
                {autoRefresh ? 'Pause' : 'Resume'} Live
              </Button>
            </div>

            {/* ── Stat cards ── */}
            {dashLoading && !summary ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(8)].map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-5">
                      <div className="h-16 animate-pulse bg-muted rounded" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : summary ? (
              <>
                {/* Row 1: Queue live counts */}
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Today&apos;s Queue — Live
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard
                      label="Waiting in Line"
                      value={summary.queue.waiting}
                      icon={Clock}
                      color="text-amber-600"
                      sub={`of ${summary.queue.total} total today`}
                    />
                    <StatCard
                      label="Being Served"
                      value={summary.queue.called}
                      icon={Activity}
                      color="text-blue-600"
                      sub="currently called"
                    />
                    <StatCard
                      label="Served Today"
                      value={summary.queue.served}
                      icon={CheckCircle2}
                      color="text-green-600"
                      sub={
                        summary.queue.total > 0
                          ? `${Math.round((summary.queue.served / summary.queue.total) * 100)}% completion rate`
                          : 'no tickets yet'
                      }
                    />
                    <StatCard
                      label="Missed / Skipped"
                      value={summary.queue.missed}
                      icon={XCircle}
                      color="text-red-500"
                      sub={`${summary.queue.total} total issued today`}
                    />
                  </div>
                </div>

                {/* Row 2: System overview */}
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    System Overview
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard
                      label="Active Lanes"
                      value={summary.lanes.active}
                      icon={Layers}
                      color="text-indigo-600"
                      sub={`${summary.lanes.inactive} inactive · ${summary.lanes.total} total`}
                    />
                    <StatCard
                      label="Inactive Lanes"
                      value={summary.lanes.inactive}
                      icon={AlertCircle}
                      color="text-gray-500"
                      sub={`${summary.lanes.total} lanes total`}
                    />
                    <StatCard
                      label="Active Staff"
                      value={summary.staff.active}
                      icon={Users}
                      color="text-violet-600"
                      sub={`${summary.staff.total} total staff accounts`}
                    />
                    <StatCard
                      label="Staff Assigned"
                      value={summary.staff.assignedToActiveLanes}
                      icon={UserCheck}
                      color="text-teal-600"
                      sub="to active lanes"
                    />
                  </div>
                </div>
              </>
            ) : null}

            {/* ── Lane status table ── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Lane Status Overview</CardTitle>
                    <CardDescription>Real-time status of all lanes for today</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {laneStatuses.length === 0 && dashLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-10 animate-pulse bg-muted rounded" />
                    ))}
                  </div>
                ) : laneStatuses.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No lanes found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lane</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">Current #</TableHead>
                        <TableHead className="text-center">Waiting</TableHead>
                        <TableHead className="text-center">Serving</TableHead>
                        <TableHead className="text-center">Served</TableHead>
                        <TableHead className="text-center">Missed</TableHead>
                        <TableHead>Progress</TableHead>
                        <TableHead>Assigned Staff</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {laneStatuses.map((lane) => {
                        const maxBar = Math.max(lane.today.total, 1)
                        return (
                          <TableRow key={lane.id}>
                            <TableCell className="font-medium">{lane.name}</TableCell>
                            <TableCell>
                              <Badge
                                className={`text-xs ${lane.type === LaneType.PRIORITY ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-green-100 text-green-800 border-green-200'} border`}
                                variant="secondary"
                              >
                                {lane.type === LaneType.PRIORITY ? 'Priority' : 'Regular'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={lane.isActive ? 'default' : 'destructive'}
                                className="text-xs"
                              >
                                {lane.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center font-mono text-sm">
                              {lane.currentNumber > 0 ? (
                                <span className="font-bold text-primary">{lane.currentNumber}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-semibold text-amber-600">{lane.today.waiting}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-semibold text-blue-600">{lane.today.called}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-semibold text-green-600">{lane.today.served}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-semibold text-red-500">{lane.today.missed}</span>
                            </TableCell>
                            <TableCell>
                              <MiniBar
                                value={lane.today.served}
                                max={maxBar}
                                color="bg-green-500"
                              />
                            </TableCell>
                            <TableCell>
                              {lane.assignedStaff.length === 0 ? (
                                <span className="text-muted-foreground text-sm">—</span>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  {lane.assignedStaff.map((s) => (
                                    <span key={s.id} className="text-sm">
                                      {s.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STATISTICS TAB
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'statistics' && (
          <>
            {/* Filters */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="stats-start">Start Date</Label>
                    <Input
                      id="stats-start"
                      type="date"
                      value={statsFilters.startDate}
                      max={statsFilters.endDate}
                      onChange={(e) =>
                        setStatsFilters((f) => ({ ...f, startDate: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="stats-end">End Date</Label>
                    <Input
                      id="stats-end"
                      type="date"
                      value={statsFilters.endDate}
                      min={statsFilters.startDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) =>
                        setStatsFilters((f) => ({ ...f, endDate: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Lane</Label>
                    <Select
                      value={statsFilters.laneId}
                      onValueChange={(v) => setStatsFilters((f) => ({ ...f, laneId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All Lanes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Lanes</SelectItem>
                        {allLanes.map((l) => (
                          <SelectItem key={l.id} value={String(l.id)}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={loadStatistics} disabled={statsLoading} className="gap-2">
                    {statsLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <BarChart3 className="h-4 w-4" />
                    )}
                    Apply Filters
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Summary totals */}
            {statsRows.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Total Issued', value: statsTotals.total, color: 'text-foreground' },
                  { label: 'Served', value: statsTotals.served, color: 'text-green-600' },
                  { label: 'Waiting', value: statsTotals.waiting, color: 'text-amber-600' },
                  { label: 'Called', value: statsTotals.called, color: 'text-blue-600' },
                  { label: 'Missed', value: statsTotals.missed, color: 'text-red-500' },
                ].map(({ label, value, color }) => (
                  <Card key={label}>
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-muted-foreground font-medium">{label}</p>
                      <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Stats table */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      Daily Breakdown
                    </CardTitle>
                    <CardDescription>
                      {statsRows.length} record{statsRows.length !== 1 ? 's' : ''} · {statsFilters.startDate} → {statsFilters.endDate}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    Click column headers to sort
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="space-y-2">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="h-10 animate-pulse bg-muted rounded" />
                    ))}
                  </div>
                ) : sortedRows.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>No data for the selected period</p>
                    <p className="text-sm mt-1">Try adjusting your date range or lane filter</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {(
                            [
                              { key: 'date', label: 'Date' },
                              { key: 'laneName', label: 'Lane' },
                              { key: 'laneType', label: 'Type' },
                              { key: 'total', label: 'Total' },
                              { key: 'served', label: 'Served' },
                              { key: 'waiting', label: 'Waiting' },
                              { key: 'called', label: 'Called' },
                              { key: 'missed', label: 'Missed' },
                            ] as { key: SortKey; label: string }[]
                          ).map(({ key, label }) => (
                            <TableHead
                              key={key}
                              className="cursor-pointer select-none whitespace-nowrap"
                              onClick={() => handleSort(key)}
                            >
                              <div className="flex items-center">
                                {label}
                                <SortIcon col={key} />
                              </div>
                            </TableHead>
                          ))}
                          <TableHead>Served %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedRows.map((row, i) => {
                          const servedPct = row.total > 0 ? Math.round((row.served / row.total) * 100) : 0
                          return (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-sm">{row.date}</TableCell>
                              <TableCell className="font-medium">{row.laneName}</TableCell>
                              <TableCell>
                                <Badge
                                  className={`text-xs ${row.laneType === 'PRIORITY' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-green-100 text-green-800 border-green-200'} border`}
                                  variant="secondary"
                                >
                                  {row.laneType === 'PRIORITY' ? 'Priority' : 'Regular'}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-semibold">{row.total}</TableCell>
                              <TableCell className="text-green-600 font-semibold">{row.served}</TableCell>
                              <TableCell className="text-amber-600 font-semibold">{row.waiting}</TableCell>
                              <TableCell className="text-blue-600 font-semibold">{row.called}</TableCell>
                              <TableCell className="text-red-500 font-semibold">{row.missed}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2 min-w-[100px]">
                                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${servedPct >= 80 ? 'bg-green-500' : servedPct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                      style={{ width: `${servedPct}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-medium w-9 text-right">{servedPct}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            EXPORT TAB
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'export' && (
          <div className="max-w-2xl space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Export Report to CSV
                </CardTitle>
                <CardDescription>
                  Select your filters and download the data as a CSV file for use in Excel or
                  other tools.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Report type */}
                <div className="space-y-1.5">
                  <Label>Report Type</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        id: 'queue_items',
                        label: 'Queue Tickets',
                        desc: 'All tickets issued — date, lane, number, status, timestamps',
                      },
                      {
                        id: 'operations',
                        label: 'Operations Log',
                        desc: 'Staff actions — NEXT, CALL, BUZZ, SKIP with timestamps',
                      },
                    ].map(({ id, label, desc }) => (
                      <button
                        key={id}
                        onClick={() => setExportFilters((f) => ({ ...f, type: id }))}
                        className={`text-left p-3 rounded-lg border-2 transition-colors ${
                          exportFilters.type === id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-muted-foreground'
                        }`}
                      >
                        <p className="font-medium text-sm">{label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date range */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="export-start">
                      <Calendar className="inline h-3.5 w-3.5 mr-1" />
                      Start Date
                    </Label>
                    <Input
                      id="export-start"
                      type="date"
                      value={exportFilters.startDate}
                      max={exportFilters.endDate}
                      onChange={(e) =>
                        setExportFilters((f) => ({ ...f, startDate: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="export-end">
                      <Calendar className="inline h-3.5 w-3.5 mr-1" />
                      End Date
                    </Label>
                    <Input
                      id="export-end"
                      type="date"
                      value={exportFilters.endDate}
                      min={exportFilters.startDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) =>
                        setExportFilters((f) => ({ ...f, endDate: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {/* Lane filter */}
                <div className="space-y-1.5">
                  <Label>Lane Filter</Label>
                  <Select
                    value={exportFilters.laneId}
                    onValueChange={(v) => setExportFilters((f) => ({ ...f, laneId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Lanes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Lanes</SelectItem>
                      {allLanes.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          {l.name}
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({l.type === 'PRIORITY' ? 'Priority' : 'Regular'})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Download button */}
                <div className="pt-1">
                  <Button
                    onClick={handleExport}
                    disabled={exportLoading}
                    size="lg"
                    className="w-full gap-2"
                  >
                    {exportLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {exportLoading ? 'Preparing CSV…' : 'Download CSV'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Column reference */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  CSV Column Reference
                </CardTitle>
              </CardHeader>
              <CardContent>
                {exportFilters.type === 'queue_items' ? (
                  <div className="text-sm space-y-1">
                    {[
                      ['Date', 'Queue date (YYYY-MM-DD UTC)'],
                      ['Lane', 'Lane name'],
                      ['Type', 'REGULAR or PRIORITY'],
                      ['Ticket #', 'Queue number issued'],
                      ['Status', 'WAITING | CALLED | SERVED | MISSED'],
                      ['Created At', 'ISO 8601 timestamp'],
                      ['Called At', 'When ticket was called (if applicable)'],
                      ['Served At', 'When ticket was marked served (if applicable)'],
                    ].map(([col, desc]) => (
                      <div key={col} className="flex gap-3">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded w-28 shrink-0">
                          {col}
                        </span>
                        <span className="text-muted-foreground text-xs">{desc}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm space-y-1">
                    {[
                      ['Date', 'Operation date (YYYY-MM-DD UTC)'],
                      ['Time (UTC)', 'Operation time HH:MM:SS'],
                      ['Lane', 'Lane name'],
                      ['Staff Name', 'Full name of staff who performed action'],
                      ['Username', 'Staff username'],
                      ['Action', 'NEXT | CALL | BUZZ | SKIP'],
                      ['Ticket #', 'Ticket number affected (if applicable)'],
                    ].map(([col, desc]) => (
                      <div key={col} className="flex gap-3">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded w-28 shrink-0">
                          {col}
                        </span>
                        <span className="text-muted-foreground text-xs">{desc}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
