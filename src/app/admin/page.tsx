'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { UserRole, LaneType } from '@prisma/client'
import { toast } from 'sonner'
import { 
  RefreshCw, 
  LogOut, 
  UserPlus, 
  Edit, 
  UserCheck, 
  UserX, 
  Plus, 
  Users, 
  Power, 
  PowerOff, 
  Trash2, 
  X,
  Check,
  Monitor,
  Save,
  Upload,
  BarChart3
} from 'lucide-react'

interface User {
  id: number
  username: string
  name: string
  role: UserRole
  window?: string
  isActive: boolean
  createdAt: string
  assignedLanes?: {
    lane: {
      id: number
      name: string
    }
  }[]
}

interface Lane {
  id: number
  name: string
  description?: string
  serviceGroup?: string
  prefix?: string
  type: LaneType
  isActive: boolean
  currentNumber: number
  lastServedNumber: number
  assignedUsers: {
    user: {
      id: number
      username: string
      name: string
      role: UserRole
    }
  }[]
}

export default function AdminDashboard() {
  // State management
  const [users, setUsers] = useState<User[]>([])
  const [lanes, setLanes] = useState<Lane[]>([])
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)

  // Display settings state
  const [displaySettings, setDisplaySettings] = useState({
    display_header_type: 'text',
    display_header_text: 'NOW SERVING',
    display_header_image_url: '',
    display_media_type: 'none',
    display_footer_text: '',
    display_footer_animation: 'static',
    display_primary_color: '#2a9d8f',
    display_secondary_color: '#1a7268',
    display_header_bg_color: '#ffffff',
    display_text_color: '#ffffff',
  })
  const [displaySettingsSaving, setDisplaySettingsSaving] = useState(false)
  const [mediaItemsList, setMediaItemsList] = useState<Array<{ url: string; duration: number }>>([])
  const [mediaItemUploading, setMediaItemUploading] = useState<number | null>(null)
  const [headerUploading, setHeaderUploading] = useState(false)

  // Reservation page settings state
  const [reservationSettings, setReservationSettings] = useState({
    reservation_bg_color: '#f8fafc',
    reservation_accent_color: '#ec4899',
    reservation_title: 'Get your ticket',
    reservation_logo_type: 'text',
    reservation_logo_text: 'YOUR LOGO',
    reservation_logo_url: '',
  })
  const [reservationSettingsSaving, setReservationSettingsSaving] = useState(false)
  const [reservationLogoUploading, setReservationLogoUploading] = useState(false)

  // User form state
  const [showUserDialog, setShowUserDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    name: '',
    role: UserRole.USER as UserRole,
    window: ''
  })

  // Lane form state
  const [showLaneDialog, setShowLaneDialog] = useState(false)
  const [editingLane, setEditingLane] = useState<Lane | null>(null)
  const [laneForm, setLaneForm] = useState({
    name: '',
    description: '',
    serviceGroup: '',
    prefix: '',
    type: LaneType.REGULAR as LaneType
  })

  // Staff assignment state
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [selectedLane, setSelectedLane] = useState<Lane | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)

  // Delete confirmation state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [laneToDelete, setLaneToDelete] = useState<{ id: number; name: string } | null>(null)
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [lastManualReset, setLastManualReset] = useState<string | null>(null)

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/users')
      if (response.ok) {
        setIsAuthenticated(true)
        loadData()
      } else {
        // Redirect to main login page
        window.location.href = '/'
      }
    } catch {
      // Redirect to main login page
      window.location.href = '/'
    } finally {
      setAuthLoading(false)
    }
  }, [])

  // Load data
  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      toast.success('Logged out successfully')
      window.location.href = '/'
    } catch (err) {
      console.error('Logout error:', err)
      toast.error('Logout failed, redirecting anyway...')
      window.location.href = '/'
    }
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [usersResponse, lanesResponse, displaySettingsResponse, resetSettingResponse] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/lanes'),
        fetch('/api/display-settings'),
        fetch('/api/admin/reset'),
      ])

      if (!usersResponse.ok || !lanesResponse.ok) {
        throw new Error('Failed to fetch data')
      }

      const usersData = await usersResponse.json()
      const lanesData = await lanesResponse.json()

      setUsers(usersData)
      setLanes(lanesData)

      if (displaySettingsResponse.ok) {
        const dsData = await displaySettingsResponse.json()
        setDisplaySettings({
          display_header_type: dsData.display_header_type ?? 'text',
          display_header_text: dsData.display_header_text ?? 'NOW SERVING',
          display_header_image_url: dsData.display_header_image_url ?? '',
          display_media_type: dsData.display_media_type ?? 'none',
          display_footer_text: dsData.display_footer_text ?? '',
          display_footer_animation: dsData.display_footer_animation ?? 'static',
          display_primary_color: dsData.display_primary_color ?? '#2a9d8f',
          display_secondary_color: dsData.display_secondary_color ?? '#1a7268',
          display_header_bg_color: dsData.display_header_bg_color ?? '#ffffff',
          display_text_color: dsData.display_text_color ?? '#ffffff',
        })
        try {
          const items = JSON.parse(dsData.display_media_items || '[]')
          setMediaItemsList(Array.isArray(items) ? items : [])
        } catch {
          setMediaItemsList([])
        }
        // Reservation settings
        setReservationSettings({
          reservation_bg_color: dsData.reservation_bg_color ?? '#f8fafc',
          reservation_accent_color: dsData.reservation_accent_color ?? '#ec4899',
          reservation_title: dsData.reservation_title ?? 'Get your ticket',
          reservation_logo_type: dsData.reservation_logo_type ?? 'text',
          reservation_logo_text: dsData.reservation_logo_text ?? 'YOUR LOGO',
          reservation_logo_url: dsData.reservation_logo_url ?? '',
        })
      }
      if (resetSettingResponse.ok) {
        const rsData = await resetSettingResponse.json()
        setLastManualReset(rsData.lastManualReset ?? null)
      }
    } catch (err) {
      toast.error('Failed to load data. Please try refreshing the page.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // User management functions
  const handleCreateUser = async () => {
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create user')
      }

      setShowUserDialog(false)
      resetUserForm()
      loadData()
      toast.success('User created successfully')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create user'
      toast.error(errorMessage)
    }
  }

  const handleUpdateUser = async () => {
    if (!editingUser) return

    try {
      const response = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: userForm.name,
          role: userForm.role,
          password: userForm.password || undefined,
          window: userForm.window || undefined
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update user')
      }

      setShowUserDialog(false)
      setEditingUser(null)
      resetUserForm()
      loadData()
      toast.success('User updated successfully')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update user'
      toast.error(errorMessage)
    }
  }

  const handleToggleUserStatus = async (userId: number, isActive: boolean) => {
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive })
      })

      if (!response.ok) {
        throw new Error('Failed to update user status')
      }

      loadData()
    } catch (error) {
      toast.error('Failed to update user status')
      console.error('Toggle user status error:', error)
    }
  }

  const handleSaveDisplaySettings = async () => {
    try {
      setDisplaySettingsSaving(true)
      const response = await fetch('/api/display-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...displaySettings, display_media_items: JSON.stringify(mediaItemsList) }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save display settings')
      }

      toast.success('Display settings saved successfully')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save display settings'
      toast.error(errorMessage)
    } finally {
      setDisplaySettingsSaving(false)
    }
  }

  const handleSaveReservationSettings = async () => {
    try {
      setReservationSettingsSaving(true)
      const response = await fetch('/api/display-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...reservationSettings }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save reservation settings')
      }
      toast.success('Reservation settings saved successfully')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save reservation settings'
      toast.error(errorMessage)
    } finally {
      setReservationSettingsSaving(false)
    }
  }

  const handleUploadFile = async (
    file: File,
    setUploading: (v: boolean) => void
  ) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/display-settings/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }
      const { url } = await res.json()
      setDisplaySettings((prev) => ({ ...prev, display_header_image_url: url }))
      toast.success('File uploaded successfully')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleUploadReservationLogo = async (file: File) => {
    setReservationLogoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/display-settings/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }
      const { url } = await res.json()
      setReservationSettings((prev) => ({ ...prev, reservation_logo_url: url }))
      toast.success('Logo uploaded successfully')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setReservationLogoUploading(false)
    }
  }

  const handleUploadMediaItem = async (file: File, index: number) => {
    setMediaItemUploading(index)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/display-settings/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }
      const { url } = await res.json()
      setMediaItemsList((prev) => prev.map((item, i) => i === index ? { ...item, url } : item))
      toast.success('File uploaded successfully')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setMediaItemUploading(null)
    }
  }

  const resetUserForm = () => {
    setUserForm({
      username: '',
      password: '',
      name: '',
      role: UserRole.USER as UserRole,
      window: ''
    })
  }

  const openUserDialog = (user?: User) => {
    if (user) {
      setEditingUser(user)
      setUserForm({
        username: user.username,
        password: '',
        name: user.name,
        role: user.role,
        window: user.window || ''
      })
    } else {
      setEditingUser(null)
      resetUserForm()
    }
    setShowUserDialog(true)
  }

  // Lane management functions
  const handleCreateLane = async () => {
    try {
      const response = await fetch('/api/lanes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(laneForm)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create lane')
      }

      setShowLaneDialog(false)
      resetLaneForm()
      loadData()
      toast.success('Lane created successfully')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create lane'
      toast.error(errorMessage)
    }
  }

  const handleUpdateLane = async () => {
    if (!editingLane) return

    try {
      const response = await fetch(`/api/lanes/${editingLane.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(laneForm)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update lane')
      }

      setShowLaneDialog(false)
      setEditingLane(null)
      resetLaneForm()
      loadData()
      toast.success('Lane updated successfully')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update lane'
      toast.error(errorMessage)
    }
  }

  const handleToggleLaneStatus = async (laneId: number, isActive: boolean) => {
    try {
      const response = await fetch(`/api/lanes/${laneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive })
      })

      if (!response.ok) {
        throw new Error('Failed to update lane status')
      }

      loadData()
    } catch (error) {
      toast.error('Failed to update lane status')
      console.error('Toggle lane status error:', error)
    }
  }

  const handleDeleteLane = (laneId: number, laneName: string) => {
    setLaneToDelete({ id: laneId, name: laneName })
    setShowDeleteDialog(true)
  }

  const confirmDeleteLane = async () => {
    if (!laneToDelete) return

    try {
      const response = await fetch(`/api/lanes/${laneToDelete.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete lane')
      }

      loadData()
      toast.success('Lane deleted successfully')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete lane'
      toast.error(errorMessage)
    } finally {
      setShowDeleteDialog(false)
      setLaneToDelete(null)
    }
  }

  const handleManualReset = async () => {
    try {
      setIsResetting(true)
      const response = await fetch('/api/admin/reset', {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to reset lane numbers')
      }

      const data = await response.json()
      setLastManualReset(data.resetAt ?? null)
      await loadData()
      toast.success('Lane numbers reset successfully')
      setShowResetDialog(false)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reset lane numbers'
      toast.error(errorMessage)
    } finally {
      setIsResetting(false)
    }
  }

  const resetLaneForm = () => {
    setLaneForm({
      name: '',
      description: '',
      serviceGroup: '',
      prefix: '',
      type: LaneType.REGULAR as LaneType
    })
  }

  const openLaneDialog = (lane?: Lane) => {
    if (lane) {
      setEditingLane(lane)
      setLaneForm({
        name: lane.name,
        description: lane.description || '',
        serviceGroup: lane.serviceGroup || '',
        prefix: lane.prefix || '',
        type: lane.type
      })
    } else {
      setEditingLane(null)
      resetLaneForm()
    }
    setShowLaneDialog(true)
  }

  // Staff assignment functions
  const handleAssignStaff = async () => {
    if (!selectedLane || !selectedUserId) return

    try {
      const response = await fetch(`/api/lanes/${selectedLane.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to assign staff')
      }

      setShowAssignDialog(false)
      setSelectedLane(null)
      setSelectedUserId(null)
      loadData()
      toast.success('Staff assigned successfully')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to assign staff'
      toast.error(errorMessage)
    }
  }

  const handleUnassignStaff = async (laneId: number, userId: number) => {
    try {
      const response = await fetch(`/api/lanes/${laneId}/unassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })

      if (!response.ok) {
        throw new Error('Failed to unassign staff')
      }

      toast.success('Staff member unassigned successfully')
      loadData()
    } catch (error) {
      toast.error('Failed to unassign staff')
      console.error('Unassign staff error:', error)
    }
  }

  const openAssignDialog = (lane: Lane) => {
    setSelectedLane(lane)
    setSelectedUserId(null)
    setShowAssignDialog(true)
  }

  // Get available staff (USER role only, considering lane assignment rules)
  const getAvailableStaff = () => {
    if (!selectedLane) return []
    
    const assignedUserIds = selectedLane.assignedUsers.map(au => au.user.id)
    
    return users.filter(user => {
      // Must be USER role and active
      if (user.role !== UserRole.USER || !user.isActive) return false
      
      // Must not be already assigned to this specific lane
      if (assignedUserIds.includes(user.id)) return false
      
      // Check current assignments for this user
      const userAssignments = user.assignedLanes || []
      
      // If user has 2 assignments already, can't assign more
      if (userAssignments.length >= 2) return false
      
      // If user has no assignments, can assign to any lane
      if (userAssignments.length === 0) return true
      
      const regularCount = userAssignments.filter(al => 
        lanes.find(l => l.id === al.lane.id)?.type === LaneType.REGULAR
      ).length
      const priorityCount = userAssignments.filter(al => 
        lanes.find(l => l.id === al.lane.id)?.type === LaneType.PRIORITY
      ).length
      
      // REGULAR lanes: allow up to 2 regular assignments total
      if (selectedLane.type === LaneType.REGULAR && regularCount >= 2) return false
      
      // PRIORITY lanes: allow only one priority assignment
      if (selectedLane.type === LaneType.PRIORITY && priorityCount >= 1) return false
      
      return true
    })
  }

  // Show loading while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
      </div>
    )
  }

  // If not authenticated, user will be redirected to login page
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end">
            <Button variant="destructive" size="sm" onClick={() => setShowResetDialog(true)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reset Queue
            </Button>
            {lastManualReset && (
              <span className="text-xs text-muted-foreground mt-0.5">
                Last reset: {new Date(lastManualReset).toLocaleString()}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (window.location.href = '/admin/reports')}
            className="gap-1.5"
          >
            <BarChart3 className="h-4 w-4" />
            Reports
          </Button>
          <Button onClick={() => window.location.reload()} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={handleLogout} size="sm">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Users Management */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Users Management</CardTitle>
              <CardDescription>Manage system users and their roles</CardDescription>
            </div>
            <Button onClick={() => openUserDialog()}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned Lanes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>
                    {user.window ? (
                      <Badge variant="outline" className="text-xs font-semibold px-2.5 py-0.5 rounded-full border border-border bg-purple-100 text-purple-800">
                        {user.window}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={user.role === UserRole.ADMIN ? 'default' : 'outline'}
                      className="text-xs font-semibold px-2.5 py-0.5 rounded-full border border-border"
                    >
                      {user.role === UserRole.ADMIN ? 'Admin' : 'User'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={user.isActive ? 'default' : 'destructive'}
                      className="text-xs font-semibold px-2.5 py-0.5 rounded-full border border-border"
                    >
                      {user.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.assignedLanes && user.assignedLanes.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {user.assignedLanes.map(al => {
                          const lane = lanes.find(l => l.id === al.lane.id)
                          return (
                            <div key={al.lane.id} className="flex items-center gap-2">
                              <span className="text-sm">{al.lane.name}</span>
                  <Badge
                    variant={lane?.type === LaneType.PRIORITY ? 'secondary' : 'secondary'}
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border border-border ${lane?.type === LaneType.PRIORITY ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}
                  >
                    {lane?.type === LaneType.PRIORITY ? 'Priority' : 'Regular'}
                  </Badge>
                            </div>
                          )
                        })}
                        <span className="text-xs text-muted-foreground">
                          {user.assignedLanes.length}/2 assignments
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openUserDialog(user)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant={user.isActive ? 'destructive' : 'default'}
                        size="sm"
                        onClick={() => handleToggleUserStatus(user.id, user.isActive)}
                      >
                        {user.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Lanes Management */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Lanes Management</CardTitle>
              <CardDescription>Manage service lanes and staff assignments</CardDescription>
            </div>
            <Button onClick={() => openLaneDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Lane
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Service Group</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned Staff</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lanes.map((lane) => (
                <TableRow key={lane.id}>
                  <TableCell className="font-medium">{lane.name}</TableCell>
                  <TableCell>
                    {lane.serviceGroup ? (
                      <Badge variant="secondary" className="text-xs font-semibold px-2 py-0.5 rounded border border-border bg-purple-100 text-purple-800">
                        {lane.serviceGroup}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {lane.prefix ? (
                      <Badge variant="secondary" className="text-xs font-semibold px-2 py-0.5 rounded border border-border bg-orange-100 text-orange-800">
                        {lane.prefix}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                  <Badge
                    variant={lane.type === LaneType.PRIORITY ? 'secondary' : 'secondary'}
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border border-border ${lane.type === LaneType.PRIORITY ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}
                  >
                    {lane.type === LaneType.PRIORITY ? 'Priority' : 'Regular'}
                  </Badge>
                  </TableCell>
                  <TableCell>{lane.description || 'No description'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={lane.isActive ? 'default' : 'destructive'}
                      className="text-xs font-semibold px-2.5 py-0.5 rounded-full border border-border"
                    >
                      {lane.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {lane.assignedUsers.map(au => (
                        <div key={au.user.id} className="flex items-center gap-2">
                          <span className="text-sm">{au.user.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUnassignStaff(lane.id, au.user.id)}
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )) || 'No staff assigned'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openLaneDialog(lane)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openAssignDialog(lane)}
                      >
                        <Users className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant={lane.isActive ? 'destructive' : 'default'}
                        size="sm"
                        onClick={() => handleToggleLaneStatus(lane.id, lane.isActive)}
                      >
                        {lane.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteLane(lane.id, lane.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Display Settings */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="h-5 w-5" />
                Display Settings
              </CardTitle>
              <CardDescription>Customize the public queue display screen</CardDescription>
            </div>
            <Button onClick={handleSaveDisplaySettings} disabled={displaySettingsSaving}>
              <Save className="h-4 w-4 mr-2" />
              {displaySettingsSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Header Settings */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Header</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Header Type</Label>
                <Select
                  value={displaySettings.display_header_type}
                  onValueChange={(value) => setDisplaySettings({ ...displaySettings, display_header_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="logo">Logo / Image URL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {displaySettings.display_header_type === 'text' ? (
                <div className="space-y-2">
                  <Label>Header Text</Label>
                  <Input
                    value={displaySettings.display_header_text}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_header_text: e.target.value })}
                    placeholder="NOW SERVING"
                  />
                </div>
              ) : (
                <div className="space-y-2 md:col-span-1">
                  <Label>Header Logo</Label>
                  {/* Drop zone */}
                  <div
                    className="border-2 border-dashed border-muted-foreground/40 rounded-lg p-4 text-center cursor-pointer hover:border-primary/60 transition-colors"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      const file = e.dataTransfer.files[0]
                      if (file) handleUploadFile(file, setHeaderUploading)
                    }}
                    onClick={() => document.getElementById('header-file-input')?.click()}
                  >
                    <input
                      id="header-file-input"
                      type="file"
                      accept="image/*"
                      title="Upload header logo"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUploadFile(file, setHeaderUploading)
                      }}
                    />
                    {headerUploading ? (
                      <p className="text-sm text-muted-foreground">Uploading...</p>
                    ) : displaySettings.display_header_image_url ? (
                      <div className="space-y-2">
                        <img src={displaySettings.display_header_image_url} alt="Header logo preview" className="max-h-16 mx-auto object-contain" />
                        <p className="text-xs text-muted-foreground">Click or drag to replace</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-muted-foreground">
                        <Upload className="h-6 w-6" />
                        <p className="text-sm">Click or drag &amp; drop an image</p>
                      </div>
                    )}
                  </div>
                  {/* URL fallback */}
                  <Input
                    value={displaySettings.display_header_image_url}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_header_image_url: e.target.value })}
                    placeholder="or paste image URL"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Header Background Color</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    title="Header background color"
                    value={displaySettings.display_header_bg_color}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_header_bg_color: e.target.value })}
                    className="h-9 w-14 rounded border border-input cursor-pointer"
                  />
                  <Input
                    value={displaySettings.display_header_bg_color}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_header_bg_color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Media Settings */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Right Side Media</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Media Type</Label>
                <Select
                  value={displaySettings.display_media_type}
                  onValueChange={(value) => setDisplaySettings({ ...displaySettings, display_media_type: value })}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="image">Image Slideshow</SelectItem>
                    <SelectItem value="video">Video Playlist</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {displaySettings.display_media_type !== 'none' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>
                      {displaySettings.display_media_type === 'video' ? 'Video Playlist' : 'Image Slideshow'}
                      <span className="ml-2 text-muted-foreground font-normal">({mediaItemsList.length} item{mediaItemsList.length !== 1 ? 's' : ''})</span>
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMediaItemsList((prev) => [...prev, { url: '', duration: 10 }])}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add {displaySettings.display_media_type === 'video' ? 'Video' : 'Image'}
                    </Button>
                  </div>

                  {displaySettings.display_media_type === 'video' && (
                    <p className="text-xs text-muted-foreground">YouTube links (youtube.com/watch?v=… or youtu.be/…) and MP4/WebM files are supported. Videos play one after another automatically.</p>
                  )}
                  {displaySettings.display_media_type === 'image' && (
                    <p className="text-xs text-muted-foreground">Images cycle automatically. Set how many seconds each image is shown.</p>
                  )}

                  {mediaItemsList.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                      No items yet. Click &quot;Add {displaySettings.display_media_type === 'video' ? 'Video' : 'Image'}&quot; to begin.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {mediaItemsList.map((item, index) => (
                        <div key={index} className="flex gap-2 items-start p-3 border rounded-lg bg-muted/30">
                          <span className="text-xs text-muted-foreground font-mono mt-2 w-5 shrink-0">{index + 1}</span>

                          {/* Upload button */}
                          <div className="shrink-0">
                            <label
                              className="flex flex-col items-center justify-center w-16 h-16 border-2 border-dashed border-muted-foreground/40 rounded-lg cursor-pointer hover:border-primary/60 transition-colors text-muted-foreground overflow-hidden"
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault()
                                const file = e.dataTransfer.files[0]
                                if (file) handleUploadMediaItem(file, index)
                              }}
                            >
                              <input
                                type="file"
                                accept={displaySettings.display_media_type === 'video' ? 'video/*' : 'image/*'}
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) handleUploadMediaItem(file, index)
                                }}
                              />
                              {mediaItemUploading === index ? (
                                <p className="text-xs text-center px-1">Uploading...</p>
                              ) : item.url && displaySettings.display_media_type === 'image' ? (
                                <img src={item.url} alt="" className="w-full h-full object-cover" />
                              ) : item.url ? (
                                <div className="flex flex-col items-center gap-1">
                                  <Upload className="h-4 w-4" />
                                  <p className="text-xs text-center leading-tight px-1 break-all line-clamp-2">{item.url.split('/').pop()}</p>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <Upload className="h-4 w-4" />
                                  <p className="text-xs text-center">Upload</p>
                                </div>
                              )}
                            </label>
                          </div>

                          {/* URL input */}
                          <div className="flex-1 space-y-1">
                            <Input
                              value={item.url}
                              onChange={(e) => setMediaItemsList((prev) => prev.map((it, i) => i === index ? { ...it, url: e.target.value } : it))}
                              placeholder={displaySettings.display_media_type === 'video' ? 'YouTube URL or video file URL' : 'Image URL'}
                              className="text-sm"
                            />
                            {displaySettings.display_media_type === 'image' && (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs text-muted-foreground whitespace-nowrap">Show for</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={300}
                                  value={item.duration}
                                  onChange={(e) => setMediaItemsList((prev) => prev.map((it, i) => i === index ? { ...it, duration: Math.max(1, parseInt(e.target.value) || 10) } : it))}
                                  className="w-20 text-sm"
                                />
                                <Label className="text-xs text-muted-foreground">seconds</Label>
                              </div>
                            )}
                          </div>

                          {/* Remove button */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-destructive hover:text-destructive/80"
                            onClick={() => setMediaItemsList((prev) => prev.filter((_, i) => i !== index))}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer Settings */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Footer Announcement</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Announcement Text</Label>
                <textarea
                  value={displaySettings.display_footer_text}
                  onChange={(e) => setDisplaySettings({ ...displaySettings, display_footer_text: e.target.value })}
                  placeholder="Leave blank to hide footer. e.g. Please have your documents ready. Thank you for waiting."
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                />
              </div>
              <div className="space-y-2">
                <Label>Text Animation</Label>
                <Select
                  value={displaySettings.display_footer_animation}
                  onValueChange={(value) => setDisplaySettings({ ...displaySettings, display_footer_animation: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="static">Static (centered)</SelectItem>
                    <SelectItem value="marquee-left">Scroll left (right → left)</SelectItem>
                    <SelectItem value="marquee-right">Scroll right (left → right)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Color Settings */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Colors</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Primary Color</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    title="Primary color"
                    value={displaySettings.display_primary_color}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_primary_color: e.target.value })}
                    className="h-9 w-14 rounded border border-input cursor-pointer"
                  />
                  <Input
                    value={displaySettings.display_primary_color}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_primary_color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Secondary Color</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    title="Secondary color"
                    value={displaySettings.display_secondary_color}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_secondary_color: e.target.value })}
                    className="h-9 w-14 rounded border border-input cursor-pointer"
                  />
                  <Input
                    value={displaySettings.display_secondary_color}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_secondary_color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Text Color</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    title="Text color"
                    value={displaySettings.display_text_color}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_text_color: e.target.value })}
                    className="h-9 w-14 rounded border border-input cursor-pointer"
                  />
                  <Input
                    value={displaySettings.display_text_color}
                    onChange={(e) => setDisplaySettings({ ...displaySettings, display_text_color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Preview Link */}
          <div className="pt-2 border-t">
            <a
              href="/display"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
            >
              <Monitor className="h-4 w-4" />
              Open Display Screen
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Reservation Page Settings */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="h-5 w-5" />
                Reservation Page Settings
              </CardTitle>
              <CardDescription>Customize the customer ticket reservation screen</CardDescription>
            </div>
            <Button onClick={handleSaveReservationSettings} disabled={reservationSettingsSaving}>
              <Save className="h-4 w-4 mr-2" />
              {reservationSettingsSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Branding */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Branding</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Logo Type</Label>
                <Select
                  value={reservationSettings.reservation_logo_type}
                  onValueChange={(value) => setReservationSettings({ ...reservationSettings, reservation_logo_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="image">Logo Image</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reservationSettings.reservation_logo_type === 'text' ? (
                <div className="space-y-2">
                  <Label>Logo Text</Label>
                  <Input
                    value={reservationSettings.reservation_logo_text}
                    onChange={(e) => setReservationSettings({ ...reservationSettings, reservation_logo_text: e.target.value })}
                    placeholder="YOUR LOGO"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Logo Image</Label>
                  <div
                    className="border-2 border-dashed border-muted-foreground/40 rounded-lg p-4 text-center cursor-pointer hover:border-primary/60 transition-colors"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      const file = e.dataTransfer.files[0]
                      if (file) handleUploadReservationLogo(file)
                    }}
                    onClick={() => document.getElementById('reservation-logo-input')?.click()}
                  >
                    <input
                      id="reservation-logo-input"
                      type="file"
                      accept="image/*"
                      title="Upload reservation logo"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUploadReservationLogo(file)
                      }}
                    />
                    {reservationLogoUploading ? (
                      <p className="text-sm text-muted-foreground">Uploading...</p>
                    ) : reservationSettings.reservation_logo_url ? (
                      <div className="space-y-2">
                        <img src={reservationSettings.reservation_logo_url} alt="Logo preview" className="max-h-16 mx-auto object-contain" />
                        <p className="text-xs text-muted-foreground">Click or drag to replace</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-muted-foreground">
                        <Upload className="h-6 w-6" />
                        <p className="text-sm">Click or drag &amp; drop an image</p>
                      </div>
                    )}
                  </div>
                  <Input
                    value={reservationSettings.reservation_logo_url}
                    onChange={(e) => setReservationSettings({ ...reservationSettings, reservation_logo_url: e.target.value })}
                    placeholder="or paste image URL"
                  />
                </div>
              )}
              <div className="space-y-2 md:col-span-2">
                <Label>Page Title</Label>
                <Input
                  value={reservationSettings.reservation_title}
                  onChange={(e) => setReservationSettings({ ...reservationSettings, reservation_title: e.target.value })}
                  placeholder="Get your ticket"
                />
              </div>
              <div className="space-y-2">
                <Label>Background Color</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    title="Reservation Background Color"
                    value={reservationSettings.reservation_bg_color}
                    onChange={(e) => setReservationSettings({ ...reservationSettings, reservation_bg_color: e.target.value })}
                    className="h-9 w-14 rounded border border-input cursor-pointer"
                  />
                  <Input
                    value={reservationSettings.reservation_bg_color}
                    onChange={(e) => setReservationSettings({ ...reservationSettings, reservation_bg_color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Accent Color</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    title="Reservation Accent Color"
                    value={reservationSettings.reservation_accent_color}
                    onChange={(e) => setReservationSettings({ ...reservationSettings, reservation_accent_color: e.target.value })}
                    className="h-9 w-14 rounded border border-input cursor-pointer"
                  />
                  <Input
                    value={reservationSettings.reservation_accent_color}
                    onChange={(e) => setReservationSettings({ ...reservationSettings, reservation_accent_color: e.target.value })}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
            Reservation layout now uses a plain background with plain white service cards and black text.
            Use the Logo and Page Title settings above to customize branding.
          </div>

          {/* Preview Link */}
          <div className="pt-2 border-t">
            <a
              href="/reservation"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
            >
              <Monitor className="h-4 w-4" />
              Open Reservation Screen
            </a>
          </div>
        </CardContent>
      </Card>

      {/* User Dialog */}
      <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Add User'}</DialogTitle>
            <DialogDescription>
              {editingUser ? 'Update user information' : 'Create a new user account'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={userForm.username}
                onChange={(e) => setUserForm({...userForm, username: e.target.value})}
                disabled={!!editingUser}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={userForm.name}
                onChange={(e) => setUserForm({...userForm, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="window">Window Label <span className="text-muted-foreground font-normal">(shown on display screen)</span></Label>
              <Input
                id="window"
                placeholder="e.g. Window 1, W-2"
                value={userForm.window}
                onChange={(e) => setUserForm({...userForm, window: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={userForm.role} onValueChange={(value) => setUserForm({...userForm, role: value as UserRole})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
                  <SelectItem value={UserRole.USER}>User</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">
                {editingUser ? 'New Password (leave blank to keep current)' : 'Password'}
              </Label>
              <Input
                id="password"
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm({...userForm, password: e.target.value})}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowUserDialog(false)}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={editingUser ? handleUpdateUser : handleCreateUser}>
                <Check className="h-4 w-4 mr-2" />
                {editingUser ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lane Dialog */}
      <Dialog open={showLaneDialog} onOpenChange={setShowLaneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLane ? 'Edit Lane' : 'Add Lane'}</DialogTitle>
            <DialogDescription>
              {editingLane ? 'Update lane information' : 'Create a new service lane'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lane-name">Name</Label>
              <Input
                id="lane-name"
                value={laneForm.name}
                onChange={(e) => setLaneForm({...laneForm, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lane-type">Type</Label>
              <Select value={laneForm.type} onValueChange={(value) => setLaneForm({...laneForm, type: value as LaneType})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                <SelectItem value={LaneType.REGULAR}>Regular</SelectItem>
                <SelectItem value={LaneType.PRIORITY}>Priority</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lane-service-group">Service Group</Label>
              <Input
                id="lane-service-group"
                placeholder="e.g. Birth, Verification (groups lanes on reservation screen)"
                value={laneForm.serviceGroup}
                onChange={(e) => setLaneForm({...laneForm, serviceGroup: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lane-prefix">Ticket Prefix</Label>
              <Input
                id="lane-prefix"
                placeholder="e.g. B for Birth → B001, C for Correction → C001"
                maxLength={5}
                value={laneForm.prefix}
                onChange={(e) => setLaneForm({...laneForm, prefix: e.target.value.toUpperCase()})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lane-description">Description</Label>
              <Input
                id="lane-description"
                value={laneForm.description}
                onChange={(e) => setLaneForm({...laneForm, description: e.target.value})}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowLaneDialog(false)}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={editingLane ? handleUpdateLane : handleCreateLane}>
                <Check className="h-4 w-4 mr-2" />
                {editingLane ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Staff Assignment Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Staff to {selectedLane?.name}</DialogTitle>
            <DialogDescription>
              Select a staff member to assign to this {selectedLane?.type === LaneType.PRIORITY ? 'Priority' : 'Regular'} lane.
              <br />
              <span className="text-sm text-muted-foreground">
                Note: Each user can be assigned to maximum 2 lanes, including up to 2 Regular lanes (and up to 1 Priority lane).
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staff-select">Available Staff</Label>
              <Select 
                value={selectedUserId?.toString() || ''} 
                onValueChange={(value) => setSelectedUserId(value ? parseInt(value) : null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a staff member" />
                </SelectTrigger>
                <SelectContent>
                  {getAvailableStaff().length > 0 ? (
                    getAvailableStaff().map((user) => (
                      <SelectItem key={user.id} value={user.id.toString()}>
                        {user.name} ({user.username})
                        {user.assignedLanes && user.assignedLanes.length > 0 && (
                          <span className="text-xs text-muted-foreground ml-2">
                            - Currently assigned: {user.assignedLanes.length}/2 lanes
                          </span>
                        )}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-staff" disabled>
                      No available staff for this lane type
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {getAvailableStaff().length === 0 && (
                <p className="text-sm text-muted-foreground">
                  All eligible staff are either already assigned to this lane,
                  have reached the maximum of 2 lane assignments, or already have the maximum allowed assignments for this lane type (up to 2 Regular or 1 Priority).
                </p>
              )}
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleAssignStaff} disabled={!selectedUserId || getAvailableStaff().length === 0}>
                <UserCheck className="h-4 w-4 mr-2" />
                Assign
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Lane Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lane</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete lane &ldquo;{laneToDelete?.name}&rdquo;? 
              This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLaneToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteLane}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Lane
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Lane Numbers</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset all lane current numbers to 0 immediately.
              Use this only when you need to manually run the daily reset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleManualReset}
              disabled={isResetting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isResetting ? 'Resetting...' : 'Confirm Reset'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
