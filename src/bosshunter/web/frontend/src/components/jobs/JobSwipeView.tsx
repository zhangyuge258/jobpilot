import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers,
  MapPin,
  GraduationCap,
  Sparkles,
  X,
  RotateCcw,
  Briefcase,
  AlertCircle,
  Building2,
  Table as TableIcon,
  FastForward,
  Compass,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from 'lucide-react'
import type { Job } from '@/hooks/useDashboard'
import type { JobFilters } from '@/lib/jobFilters'
import { getStatusLabel } from '@/lib/status'
import { OutsourcingBadge } from './OutsourcingBadge'
import { FormattedJobDescription } from './FormattedJobDescription'
import { CompanyAppliedBadge, resolveCompanyAppliedStats } from './CompanyAppliedBadge'
import { Button } from '@/components/ui/button'

export interface SwipeContext {
  initialJobId: string
  initialJobs: Job[]
  initialIndex: number
  initialPage: number
}

interface JobSwipeViewProps {
  filters: JobFilters
  library: 'all' | 'filtered' | 'sent'
  swipeContext?: SwipeContext | null
  initialJobId?: string | null
  onStatusChange: (job: Job, status: string) => Promise<void>
  onNotice?: (message: string) => void
  onSwitchToTable?: () => void
}

const PLATFORM_NAMES: Record<string, string> = {
  boss: 'BOSS直聘',
  zhilian: '智联招聘',
  '51job': '前程无忧',
  liepin: '猎聘',
}

const AVAILABLE_STATUSES = [
  { value: 'ready', label: '待确认' },
  { value: 'sent', label: '已投递' },
  { value: 'skipped', label: '已跳过' },
  { value: 'filtered', label: '已过滤' },
  { value: 'rejected', label: '已拒绝' },
]

export const PROCESSED_STATUS_SET = new Set([
  'sent',
  'skipped',
  'rejected',
  'replied',
  'resume_sent',
  'needs_resume',
  'follow_up_sent',
  'filtered',
])

export const UNAPPLIED_STATUSES = ['ready', 'pending', 'scored', 'approved']

export function isJobProcessed(status: string | undefined): boolean {
  return PROCESSED_STATUS_SET.has(status || '')
}

export function getJobExternalUrl(job: Job): string {
  if (!job.url) return ''
  const platform = job.source_platform || 'boss'
  if (platform === 'boss') {
    if (job.url.startsWith('/job_detail/')) {
      return `https://www.zhipin.com${job.url}`
    }
    if (job.url.startsWith('http://') || job.url.startsWith('https://')) {
      return job.url
    }
    return `https://www.zhipin.com/${job.url.replace(/^\//, '')}`
  }
  return job.url
}

export function JobSwipeView({
  filters,
  library,
  swipeContext,
  initialJobId,
  onStatusChange,
  onNotice,
  onSwitchToTable,
}: JobSwipeViewProps) {
  const [deck, setDeck] = useState<Job[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState('')
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [showLocator, setShowLocator] = useState(false)
  const [targetIndexInput, setTargetIndexInput] = useState('')
  const [onlyUnprocessed, setOnlyUnprocessed] = useState(false)
  const [excludeCompanyApplied, setExcludeCompanyApplied] = useState(false)
  const [searchingNext, setSearchingNext] = useState(false)

  const dragStartX = useRef<number | null>(null)
  const pageRef = useRef(0)
  const pageSize = 15
  const hasLoadedContextRef = useRef(false)

  // Build query parameters
  const buildSearchParams = useCallback(
    (pageIndex: number, filterUnapplied: boolean) => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(pageIndex * pageSize),
        library,
      })

      if (filters.query?.trim()) params.set('q', filters.query.trim())
      if (filters.company?.trim()) params.set('company', filters.company.trim())
      filters.titles.forEach(value => params.append('titles', value))
      if (filters.hrActive?.trim()) params.set('hr_active', filters.hrActive.trim())
      if (filters.maxScore) params.set('max_score', filters.maxScore)
      if (filters.minScore) params.set('min_score', filters.minScore)
      if (filters.salaryMin) params.set('salary_min', filters.salaryMin)
      if (filters.salaryMax) params.set('salary_max', filters.salaryMax)

      if (filterUnapplied) {
        // Query only unapplied statuses from backend directly!
        UNAPPLIED_STATUSES.forEach(st => params.append('status', st))
      } else {
        filters.status.forEach(value => params.append('status', value))
      }

      if (filters.createdWithin) params.set('created_within', filters.createdWithin)
      filters.sourcePlatform.forEach(value => params.append('source_platform', value))
      filters.city.forEach(value => params.append('city', value))
      filters.education.forEach(value => params.append('education', value))
      filters.recruitmentType.forEach(value => params.append('recruitment_type', value))
      params.set('sort_by', 'created_at')
      params.set('sort_order', 'desc')
      return params
    },
    [filters, library]
  )

  // Fetch jobs for card stack
  const loadJobs = useCallback(
    async (pageIndex: number, isInitial = false, filterUnapplied = onlyUnprocessed): Promise<Job[]> => {
      if (isInitial) {
        setLoading(true)
        setError('')
      } else {
        setLoadingMore(true)
      }

      const params = buildSearchParams(pageIndex, filterUnapplied)

      try {
        const response = await fetch(`/api/jobs/search?${params.toString()}`, { cache: 'no-store' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '获取岗位列表失败')

        const newItems: Job[] = data.items || []
        const total: number = data.total || 0

        setDeck(prev => (isInitial ? newItems : [...prev, ...newItems]))
        setHasMore((pageIndex + 1) * pageSize < total)
        pageRef.current = pageIndex
        return newItems
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载岗位失败')
        return []
      } finally {
        if (isInitial) setLoading(false)
        setLoadingMore(false)
      }
    },
    [buildSearchParams, onlyUnprocessed]
  )

  // Initialize: if swipeContext is provided, directly seed with current page jobs and position!
  useEffect(() => {
    if (swipeContext && swipeContext.initialJobs.length > 0 && !hasLoadedContextRef.current) {
      setDeck(swipeContext.initialJobs)
      setCurrentIndex(swipeContext.initialIndex)
      pageRef.current = swipeContext.initialPage
      setLoading(false)
      setError('')
      hasLoadedContextRef.current = true
      return
    }

    setCurrentIndex(0)
    pageRef.current = 0
    void loadJobs(0, true, onlyUnprocessed).then(loaded => {
      if (initialJobId && loaded?.length) {
        const targetIdx = loaded.findIndex(j => j.id === initialJobId)
        if (targetIdx !== -1) setCurrentIndex(targetIdx)
      }
    })
  }, [filters, initialJobId, library, loadJobs, onlyUnprocessed, swipeContext])

  // Automatically preload more jobs when nearing the end
  useEffect(() => {
    if (!loading && !loadingMore && hasMore && deck.length - currentIndex <= 4) {
      void loadJobs(pageRef.current + 1, false, onlyUnprocessed)
    }
  }, [currentIndex, deck.length, hasMore, loading, loadingMore, loadJobs, onlyUnprocessed])

  const currentJob = deck[currentIndex] as Job | undefined
  const prevJob = currentIndex > 0 ? (deck[currentIndex - 1] as Job) : undefined
  const nextJob = currentIndex < deck.length - 1 ? (deck[currentIndex + 1] as Job) : undefined

  // Powerful Jump to Next Unapplied: searches memory first, then fetches pages sequentially until found!
  const handleJumpToNextUnapplied = useCallback(async () => {
    if (searchingNext) return

    const isMatch = (j: Job, list: Job[]) => {
      if (isJobProcessed(j.status)) return false
      if (excludeCompanyApplied && resolveCompanyAppliedStats(j, list).has_applied) return false
      return true
    }

    // 1. Check in already loaded items after currentIndex
    const localIdx = deck.findIndex((job, idx) => idx > currentIndex && isMatch(job, deck))
    if (localIdx !== -1) {
      setCurrentIndex(localIdx)
      onNotice?.(`已快速定位到下一个待投递岗位：${deck[localIdx].title}`)
      return
    }

    // 2. If not found in current deck, but backend has more, fetch sequentially
    if (hasMore) {
      setSearchingNext(true)
      onNotice?.('正在跨页为您寻找下一个未投递岗位…')
      let nextPage = pageRef.current + 1
      let foundIndex = -1
      let accumulatedDeck = [...deck]

      while (foundIndex === -1) {
        try {
          const params = buildSearchParams(nextPage, false)
          const response = await fetch(`/api/jobs/search?${params.toString()}`, { cache: 'no-store' })
          const data = await response.json()
          const items: Job[] = data.items || []
          const total: number = data.total || 0
          const more = (nextPage + 1) * pageSize < total

          if (!items.length) {
            setHasMore(false)
            break
          }

          const offsetBefore = accumulatedDeck.length
          accumulatedDeck = [...accumulatedDeck, ...items]
          setDeck(accumulatedDeck)
          pageRef.current = nextPage
          setHasMore(more)

          const matchRelIdx = items.findIndex(job => isMatch(job, accumulatedDeck))
          if (matchRelIdx !== -1) {
            foundIndex = offsetBefore + matchRelIdx
            break
          }

          if (!more) break
          nextPage += 1
        } catch {
          break
        }
      }

      setSearchingNext(false)

      if (foundIndex !== -1) {
        setCurrentIndex(foundIndex)
        onNotice?.(`已跨页定位到下一个待投递岗位：${accumulatedDeck[foundIndex].title}`)
        return
      }
    }

    // 3. If no unapplied jobs ahead, check if there's any unapplied earlier in the deck
    const earlierIdx = deck.findIndex((job, idx) => idx < currentIndex && !isJobProcessed(job.status))
    if (earlierIdx !== -1) {
      setCurrentIndex(earlierIdx)
      onNotice?.(`后方岗位已阅完，已回到前方未投递的岗位：${deck[earlierIdx].title}`)
      return
    }

    onNotice?.('当前库内没有找到更多待投递的岗位')
  }, [buildSearchParams, currentIndex, deck, hasMore, onNotice, searchingNext])

  // Handle Action: Mark Sent & Open External Link
  const handleApply = useCallback(
    async (jobToApply?: Job) => {
      const job = jobToApply || currentJob
      if (!job) return

      const targetUrl = getJobExternalUrl(job)
      if (targetUrl) {
        window.open(targetUrl, '_blank', 'noopener,noreferrer')
      }

      setDeck(prev =>
        prev.map(item => (item.id === job.id ? { ...item, status: 'sent' } : item))
      )

      try {
        await onStatusChange(job, 'sent')
        onNotice?.(`已跳转投递并存入“已投递库”：${job.company} · ${job.title}`)
      } catch {
        onNotice?.('投递状态更新失败，请重试')
      }

      if (currentIndex < deck.length - 1) {
        setCurrentIndex(prev => prev + 1)
      }
    },
    [currentJob, currentIndex, deck.length, onNotice, onStatusChange]
  )

  // Handle Action: Skip
  const handleSkip = useCallback(
    async (jobToSkip?: Job) => {
      const job = jobToSkip || currentJob
      if (!job) return

      setDeck(prev =>
        prev.map(item => (item.id === job.id ? { ...item, status: 'skipped' } : item))
      )

      try {
        await onStatusChange(job, 'skipped')
        onNotice?.(`已存入“已跳过”：${job.company} · ${job.title}`)
      } catch {
        onNotice?.('跳过状态更新失败，请重试')
      }

      if (currentIndex < deck.length - 1) {
        setCurrentIndex(prev => prev + 1)
      }
    },
    [currentJob, currentIndex, deck.length, onNotice, onStatusChange]
  )

  // Handle Manual Status Change
  const handleStatusSelect = async (newStatus: string) => {
    if (!currentJob) return
    setDeck(prev =>
      prev.map(item => (item.id === currentJob.id ? { ...item, status: newStatus } : item))
    )
    try {
      await onStatusChange(currentJob, newStatus)
      onNotice?.(`已更新为“${getStatusLabel(newStatus)}”：${currentJob.company} · ${currentJob.title}`)
    } catch {
      onNotice?.('修改状态失败，请重试')
    }
  }

  // Keyboard Navigation Support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        void handleSkip()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        void handleApply()
      } else if (e.key === 'ArrowUp' && currentIndex > 0) {
        e.preventDefault()
        setCurrentIndex(prev => prev - 1)
      } else if (e.key === 'ArrowDown' && currentIndex < deck.length - 1) {
        e.preventDefault()
        setCurrentIndex(prev => prev + 1)
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        void handleJumpToNextUnapplied()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, deck.length, handleApply, handleJumpToNextUnapplied, handleSkip])

  // Mouse & Touch Swipe / Drag Handling
  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartX.current = e.clientX
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || dragStartX.current === null) return
    const delta = e.clientX - dragStartX.current
    setDragOffset(delta)
  }

  const handlePointerUp = () => {
    if (!isDragging) return
    setIsDragging(false)
    if (dragOffset > 100) {
      void handleApply()
    } else if (dragOffset < -100) {
      void handleSkip()
    }
    setDragOffset(0)
    dragStartX.current = null
  }

  // Jump to specific index from locator
  const handleJumpToIndex = (idx: number) => {
    if (idx >= 0 && idx < deck.length) {
      setCurrentIndex(idx)
      setShowLocator(false)
      onNotice?.(`已定位至第 ${idx + 1} 个岗位：${deck[idx].title}`)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center rounded-3xl border border-card-border bg-card p-12 text-center shadow-sm">
        <Sparkles className="h-10 w-10 animate-spin text-primary opacity-80" />
        <p className="mt-4 text-base font-bold text-foreground">正在为您生成灵动挑岗卡片…</p>
        <p className="mt-1 text-xs text-muted">汇集当前岗位库数据，支持左右沉浸划选</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-3xl border border-danger-border bg-card p-8 text-center">
        <AlertCircle className="h-10 w-10 text-danger" />
        <p className="mt-3 text-base font-bold text-danger">{error}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void loadJobs(0, true, onlyUnprocessed)}>
          重试加载
        </Button>
      </div>
    )
  }

  if (deck.length === 0) {
    return (
      <div className="flex min-h-[460px] flex-col items-center justify-center rounded-3xl border border-dashed border-card-border bg-card p-8 text-center">
        <Layers className="h-12 w-12 text-muted opacity-40" />
        <h3 className="mt-3 text-lg font-bold text-foreground">
          {onlyUnprocessed ? '暂无未投递的岗位' : '当前岗位库暂无卡片'}
        </h3>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
          {onlyUnprocessed
            ? '太棒了！所有岗位均已处理完毕。您可以关闭“仅看未投递”查看已投递/已跳过的历史记录。'
            : '当前筛选条件下没有找到匹配的岗位。您可以尝试调整上方筛选条件，或者切换其他岗位库。'}
        </p>
        <div className="mt-5 flex gap-3">
          {onlyUnprocessed && (
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setOnlyUnprocessed(false)
                void loadJobs(0, true, false)
              }}
            >
              关闭“仅看未投递”
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => void loadJobs(0, true, onlyUnprocessed)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> 刷新数据
          </Button>
          {onSwitchToTable && (
            <Button variant="ghost" size="sm" onClick={onSwitchToTable}>
              <TableIcon className="mr-1.5 h-3.5 w-3.5" /> 切回表格视图
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col items-center justify-center py-5 select-none overflow-hidden">
      {/* Top Controller Bar - Single Line Flat Layout */}
      <div className="mb-3 flex w-full max-w-2xl flex-nowrap items-center justify-between gap-1.5 px-2 text-xs overflow-x-auto no-scrollbar">
        <div className="flex flex-nowrap items-center gap-1.5 min-w-0">
          <span className="flex shrink-0 items-center gap-1.5 font-bold text-primary mr-1">
            <Sparkles className="h-4 w-4" /> 灵动挑岗
          </span>

          {/* Location Index Pill & Click to open locator */}
          <button
            type="button"
            onClick={() => setShowLocator(prev => !prev)}
            title="点击快速跳转指定岗位或输入序号"
            className="flex shrink-0 items-center gap-1 rounded-full border border-card-border bg-secondary/80 px-2.5 py-1 font-semibold text-foreground hover:bg-secondary transition-colors"
          >
            <Compass className="h-3 w-3 text-primary" />
            <span>
              {currentIndex + 1} / {deck.length} {hasMore ? '+' : ''}
            </span>
            <span className="text-[10px] text-muted">▾ 定位</span>
          </button>

          {/* Backend-driven Filter: Only Unapplied */}
          <button
            type="button"
            onClick={() => {
              const nextState = !onlyUnprocessed
              setOnlyUnprocessed(nextState)
              setCurrentIndex(0)
              hasLoadedContextRef.current = true
              void loadJobs(0, true, nextState)
            }}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-semibold transition-colors ${
              onlyUnprocessed
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-card-border bg-secondary/40 text-muted hover:text-foreground'
            }`}
            title="直接向后端精准请求未投递岗位，彻底过滤已投递和已跳过"
          >
            <Filter className="h-3 w-3" />
            <span>{onlyUnprocessed ? '已开启：仅看未投递' : '仅看未投递'}</span>
          </button>

          {/* Exclude Same Company Applied Switch */}
          <button
            type="button"
            onClick={() => setExcludeCompanyApplied(prev => !prev)}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-semibold transition-colors ${
              excludeCompanyApplied
                ? 'border-purple-400/60 bg-purple-500/15 text-purple-700 dark:text-purple-300'
                : 'border-card-border bg-secondary/40 text-muted hover:text-foreground'
            }`}
            title="一键过滤投过其他岗位的公司，只浏览完全未接触过的新企业"
          >
            <Building2 className="h-3 w-3" />
            <span>{excludeCompanyApplied ? '已过滤同司已投' : '排除同司已投'}</span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 ml-2">
          {/* Quick Jump to Next Unapplied */}
          <Button
            variant="secondary"
            size="sm"
            disabled={searchingNext}
            onClick={() => void handleJumpToNextUnapplied()}
            className="h-7 shrink-0 px-2.5 text-xs font-bold text-primary hover:bg-primary/10"
            title="自动跨页寻找下一个待投递的岗位（快捷键：N）"
          >
            {searchingNext ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FastForward className="mr-1 h-3.5 w-3.5" />
            )}
            <span>{searchingNext ? '查找中…' : '下一个未投递'}</span>
          </Button>

          {onSwitchToTable && (
            <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs text-muted" onClick={onSwitchToTable}>
              <TableIcon className="mr-1 h-3.5 w-3.5" /> 列表表格
            </Button>
          )}
        </div>
      </div>

      {/* Quick Locator Drawer / Dropdown */}
      {showLocator && (
        <div className="mb-4 w-full max-w-2xl rounded-2xl border border-card-border bg-card p-4 shadow-xl z-30 transition-all">
          <div className="flex items-center justify-between border-b border-card-border pb-2.5">
            <span className="flex items-center gap-1.5 text-xs font-black text-foreground">
              <Compass className="h-4 w-4 text-primary" /> 快速定位到指定位置
            </span>
            <button
              type="button"
              onClick={() => setShowLocator(false)}
              className="rounded-lg p-1 text-muted hover:bg-secondary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Jump by number */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted">输入序号跳转：</span>
            <input
              type="number"
              min={1}
              max={deck.length}
              placeholder={`1 ~ ${deck.length}`}
              value={targetIndexInput}
              onChange={e => setTargetIndexInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const num = parseInt(targetIndexInput, 10)
                  if (!isNaN(num)) handleJumpToIndex(num - 1)
                }
              }}
              className="h-8 w-24 rounded-lg border border-card-border bg-secondary/50 px-2 text-xs font-bold outline-none focus:border-primary"
            />
            <Button
              variant="default"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                const num = parseInt(targetIndexInput, 10)
                if (!isNaN(num)) handleJumpToIndex(num - 1)
              }}
            >
              跳转
            </Button>
          </div>

          {/* Fast List of nearby jobs */}
          <div className="mt-3 max-h-48 overflow-y-auto space-y-1.5 pr-1">
            <span className="text-[11px] font-bold text-muted">点击直接定位到岗位：</span>
            {deck.slice(0, 40).map((job, idx) => (
              <div
                key={job.id}
                onClick={() => handleJumpToIndex(idx)}
                className={`flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-1.5 text-xs transition-colors ${
                  idx === currentIndex
                    ? 'border border-primary/40 bg-primary/10 font-bold text-primary'
                    : 'hover:bg-secondary text-foreground'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="w-5 text-center text-muted font-mono">{idx + 1}</span>
                  <span className="truncate">{job.title}</span>
                  <span className="text-muted text-[11px] truncate">· {job.company}</span>
                  <CompanyAppliedBadge job={job} allKnownJobs={deck} size="sm" />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {job.status === 'sent' && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> 已投
                    </span>
                  )}
                  {(job.status === 'skipped' || job.status === 'rejected') && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
                      <XCircle className="h-3 w-3" /> 已跳
                    </span>
                  )}
                  {!isJobProcessed(job.status) && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted">
                      <Clock className="h-3 w-3" /> 待投
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3D Stack Viewport */}
      <div className="relative flex h-[580px] w-full max-w-xl items-center justify-center">
        {/* Previous Card (Left) */}
        {prevJob ? (
          <div
            onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
            className="absolute left-0 z-10 w-[84%] max-w-[420px] cursor-pointer rounded-3xl border border-card-border/80 bg-card p-5 shadow-lg transition-all duration-300 ease-out hover:opacity-90"
            style={{
              transform: 'translateX(-22%) scale(0.9) rotate(-4deg)',
              opacity: 0.65,
              filter: 'blur(0.4px)',
            }}
            title="点击切回上一张卡片（可重新标记状态）"
          >
            <div className="flex items-center justify-between border-b border-card-border/60 pb-3">
              <div className="flex items-center gap-1.5 truncate max-w-[200px]">
                <span className="truncate font-bold text-muted">{prevJob.company}</span>
                <CompanyAppliedBadge job={prevJob} allKnownJobs={deck} size="sm" />
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-black ${
                  prevJob.status === 'sent'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                    : prevJob.status === 'skipped'
                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                    : 'border border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                }`}
              >
                {getStatusLabel(prevJob.status)}
              </span>
            </div>
            <h4 className="mt-3 truncate text-base font-bold text-foreground">{prevJob.title}</h4>
            <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted">
              <span>{prevJob.salary}</span>
              <span>· {prevJob.city}</span>
            </div>
            <div className="mt-4 line-clamp-3 rounded-xl bg-secondary/40 p-3 text-xs leading-5 text-muted">
              {prevJob.jd?.slice(0, 150) || '暂无详细职责描述'}
            </div>
            <p className="mt-4 text-center text-xs font-semibold text-primary">👈 点击切回上一张（可纠错）</p>
          </div>
        ) : null}

        {/* Current Active Card (Center) */}
        {currentJob && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`absolute z-20 flex h-full w-[92%] max-w-[450px] flex-col justify-between overflow-hidden rounded-3xl border bg-card p-6 shadow-2xl transition-all duration-200 ease-out ${
              currentJob.status === 'sent'
                ? 'border-emerald-500/60 shadow-xl shadow-emerald-500/15 ring-2 ring-emerald-500/20'
                : currentJob.status === 'skipped' || currentJob.status === 'rejected'
                ? 'border-rose-500/60 shadow-xl shadow-rose-500/15 ring-2 ring-rose-500/20'
                : 'border-sky-500/70 shadow-2xl shadow-sky-500/20 ring-2 ring-sky-500/30'
            }`}
            style={{
              transform: `translateX(${dragOffset}px) rotate(${dragOffset * 0.05}deg)`,
              cursor: isDragging ? 'grabbing' : 'grab',
            }}
          >
            {/* Soft Ambient Overlay for Sent / Skipped / Unapplied */}
            {currentJob.status === 'sent' && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-emerald-500/20 via-emerald-500/5 to-transparent transition-opacity" />
            )}
            {(currentJob.status === 'skipped' || currentJob.status === 'rejected') && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-rose-500/20 via-rose-500/5 to-transparent transition-opacity" />
            )}
            {!isJobProcessed(currentJob.status) && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-sky-500/25 via-blue-500/10 to-transparent transition-opacity" />
            )}

            {/* Drag Direction Hints */}
            {isDragging && dragOffset > 40 && (
              <div className="pointer-events-none absolute right-6 top-6 z-30 rounded-2xl border border-emerald-500/40 bg-emerald-500/90 px-3 py-1.5 text-xs font-black text-white shadow-lg backdrop-blur-sm">
                ✔ 投递中
              </div>
            )}
            {isDragging && dragOffset < -40 && (
              <div className="pointer-events-none absolute left-6 top-6 z-30 rounded-2xl border border-rose-500/40 bg-rose-500/90 px-3 py-1.5 text-xs font-black text-white shadow-lg backdrop-blur-sm">
                ✖ 跳过中
              </div>
            )}

            {/* Header: Title, Company & Status Tag */}
            <div className="relative z-10">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                      {PLATFORM_NAMES[currentJob.source_platform || 'boss'] || '官方招聘'}
                    </span>
                    {currentJob.recruitment_type === 'campus' && (
                      <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                        校招
                      </span>
                    )}
                    {currentJob.recruitment_type === 'experienced' && (
                      <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-bold text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
                        社招
                      </span>
                    )}
                    <OutsourcingBadge job={currentJob} />
                  </div>
                  <h3 className="mt-2 text-xl font-black tracking-tight text-foreground line-clamp-1" title={currentJob.title}>
                    {currentJob.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-muted">
                    <div className="flex items-center gap-1.5 truncate max-w-[200px]">
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{currentJob.company}</span>
                    </div>
                    <CompanyAppliedBadge job={currentJob} allKnownJobs={deck} size="md" />
                  </div>
                </div>

                {/* Status Dropdown Selector */}
                <div className="shrink-0 text-right">
                  <div className="relative inline-flex items-center">
                    {!isJobProcessed(currentJob.status) && (
                      <span className="mr-1.5 flex h-2 w-2 relative" title="待投递岗位">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                      </span>
                    )}
                    <div className="relative inline-block">
                      <select
                        value={currentJob.status}
                        onChange={e => void handleStatusSelect(e.target.value)}
                        aria-label="修改卡片状态"
                        className={`cursor-pointer appearance-none rounded-xl border px-3 py-1.5 pr-6 text-xs font-black shadow-sm outline-none transition-all ${
                          currentJob.status === 'sent'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : currentJob.status === 'skipped' || currentJob.status === 'rejected'
                            ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                            : 'border-sky-400 bg-sky-500/15 text-sky-800 shadow-sm ring-1 ring-sky-400/40 hover:bg-sky-500/20 dark:border-sky-500 dark:bg-sky-950/90 dark:text-sky-200'
                        }`}
                      >
                        {AVAILABLE_STATUSES.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                        {!AVAILABLE_STATUSES.some(opt => opt.value === currentJob.status) && (
                          <option value={currentJob.status}>{getStatusLabel(currentJob.status)}</option>
                        )}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-xs opacity-60">
                        ▾
                      </div>
                    </div>
                  </div>
                  {currentJob.score ? (
                    <div className="mt-1 text-[11px] font-bold text-primary">
                      AI 匹配 {currentJob.score} 分
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Meta pills: Salary, City, Experience, Education */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-black text-amber-500 dark:text-amber-400">
                  {currentJob.salary || '薪资面议'}
                </span>
                <span className="text-muted">·</span>
                <span className="inline-flex items-center gap-0.5 text-muted">
                  <MapPin className="h-3 w-3" /> {currentJob.city || '城市待核'}
                </span>
                <span className="text-muted">·</span>
                <span className="inline-flex items-center gap-0.5 text-muted">
                  <GraduationCap className="h-3 w-3" /> {currentJob.education || currentJob.experience || '学历不限'}
                </span>
                {currentJob.company_size && (
                  <>
                    <span className="text-muted">·</span>
                    <span className="text-muted">{currentJob.company_size}</span>
                  </>
                )}
              </div>
            </div>

            {/* Middle: Smart Job Description Formatted View */}
            <div className="relative my-3 flex-1 overflow-hidden rounded-2xl border border-card-border/80 bg-secondary/35 p-3.5 flex flex-col min-h-0">
              <div className="mb-2 flex items-center justify-between text-xs font-bold text-foreground shrink-0">
                <span className="flex items-center gap-1.5 text-primary font-black">
                  <Briefcase className="h-3.5 w-3.5" /> 岗位详情 (JD)
                </span>
                {currentJob.url && (
                  <a
                    href={getJobExternalUrl(currentJob)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline text-[11px]"
                    onClick={e => e.stopPropagation()}
                  >
                    原始链接 <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <FormattedJobDescription
                  jd={currentJob.jd}
                  scoreReason={currentJob.score_reason}
                />
              </div>
            </div>

            {/* Bottom: Action Buttons */}
            <div className="relative z-10 flex items-center justify-between pt-1">
              {/* Skip Button (X) */}
              <button
                type="button"
                onClick={() => void handleSkip()}
                className="group flex h-14 w-14 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 shadow-md transition-all duration-200 hover:scale-110 hover:bg-rose-100 hover:shadow-rose-500/20 active:scale-95 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-900/60"
                title="跳过此岗位并存入已跳过（快捷键：←）"
                aria-label="跳过"
              >
                <X className="h-7 w-7 transition-transform group-hover:rotate-12" />
              </button>

              {/* Prev / Next Small Switchers */}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                  className="h-8 px-2 text-xs text-muted"
                  title="上一张（快捷键：↑）"
                >
                  <ChevronLeft className="h-4 w-4" /> 上一张
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={currentIndex >= deck.length - 1}
                  onClick={() => setCurrentIndex(prev => Math.min(deck.length - 1, prev + 1))}
                  className="h-8 px-2 text-xs text-muted"
                  title="下一张（快捷键：↓）"
                >
                  下一张 <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Apply / Direct Sent Button (Check) */}
              <button
                type="button"
                onClick={() => void handleApply()}
                className="group flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 transition-all duration-200 hover:scale-110 hover:bg-emerald-700 hover:shadow-emerald-600/40 active:scale-95"
                title="打开投递网页并标记已投递（快捷键：→）"
                aria-label="投递"
              >
                <Check className="h-7 w-7 transition-transform group-hover:scale-110" />
              </button>
            </div>
          </div>
        )}

        {/* Next Card (Right) */}
        {nextJob ? (
          <div
            onClick={() => setCurrentIndex(prev => Math.min(deck.length - 1, prev + 1))}
            className={`absolute right-0 z-10 w-[84%] max-w-[420px] cursor-pointer rounded-3xl border bg-card p-5 shadow-lg transition-all duration-300 ease-out hover:opacity-90 ${
              !isJobProcessed(nextJob.status)
                ? 'border-sky-300/80 shadow-sky-500/10 dark:border-sky-700/60'
                : 'border-card-border/80'
            }`}
            style={{
              transform: 'translateX(22%) scale(0.9) rotate(4deg)',
              opacity: 0.65,
              filter: 'blur(0.4px)',
            }}
            title="点击切到下一张卡片"
          >
            <div className="flex items-center justify-between border-b border-card-border/60 pb-3">
              <div className="flex items-center gap-1.5 truncate max-w-[200px]">
                <span className="truncate font-bold text-muted">{nextJob.company}</span>
                <CompanyAppliedBadge job={nextJob} allKnownJobs={deck} size="sm" />
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-black ${
                  nextJob.status === 'sent'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                    : nextJob.status === 'skipped'
                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                    : 'border border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                }`}
              >
                {getStatusLabel(nextJob.status)}
              </span>
            </div>
            <h4 className="mt-3 truncate text-base font-bold text-foreground">{nextJob.title}</h4>
            <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted">
              <span>{nextJob.salary}</span>
              <span>· {nextJob.city}</span>
            </div>
            <div className="mt-4 line-clamp-3 rounded-xl bg-secondary/40 p-3 text-xs leading-5 text-muted">
              {nextJob.jd?.slice(0, 150) || '暂无详细职责描述'}
            </div>
            <p className="mt-4 text-center text-xs font-semibold text-primary">👉 点击切入下一张</p>
          </div>
        ) : null}
      </div>

      {/* Bottom Keyboard Shortcuts Bar */}
      <div className="mt-5 w-full max-w-xl rounded-2xl border border-card-border/80 bg-secondary/40 px-4 py-2.5 text-xs text-muted">
        <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3">
          <span className="font-bold text-foreground flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" /> 快捷键支持：
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-card-border bg-card px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose-600 dark:text-rose-400 shadow-sm">
                ←
              </kbd>
              <span>跳过</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-card-border bg-card px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400 shadow-sm">
                →
              </kbd>
              <span>投递</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-card-border bg-card px-1.5 py-0.5 font-mono text-[11px] font-bold text-foreground shadow-sm">
                ↑
              </kbd>
              <span>上一张（可纠错）</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-card-border bg-card px-1.5 py-0.5 font-mono text-[11px] font-bold text-foreground shadow-sm">
                ↓
              </kbd>
              <span>下一张</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-card-border bg-card px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary shadow-sm">
                N
              </kbd>
              <span>下一个未投递</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
