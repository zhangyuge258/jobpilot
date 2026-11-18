import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { OutsourcingBadge } from '@/components/jobs/OutsourcingBadge'
import { CompanyAppliedBadge } from '@/components/jobs/CompanyAppliedBadge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Ban, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Sparkles, Trash2 } from 'lucide-react'
import { getStatusLabel, STATUS_LABELS } from '@/lib/status'
import { EMPTY_JOB_FILTERS, type JobFilters } from '@/lib/jobFilters'
import { MultiSelect } from '@/components/ui/multi-select'
import { PLATFORM_SHORT_LABELS } from '@/lib/platforms'
import type { Job } from '@/hooks/useDashboard'
import type { JobSortKey, JobSortOrder } from '@/hooks/useJobSearch'
import { InterviewPreparation } from '@/components/jobs/InterviewPreparation'
import { ScoreDetails } from '@/components/jobs/ScoreDetails'
import { DeliveryDialog } from './DeliveryDialog'

interface JobsTableProps {
  jobs: Job[]
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  selectedIds: string[]
  onToggleSelected?: (id: string) => void
  onSoftDelete?: (job: Job) => void
  onRemoveFromLibrary?: (job: Job) => void
  researchOnly?: boolean
  onMarkManuallySent?: (job: Job) => void
  onStatusChange?: (job: Job, status: string) => void
  onRecruitmentTypeChange?: (job: Job, recruitmentType: string) => void
  onBlockCompany?: (job: Job) => void
  onStartSwipeAtJob?: (job: Job, index: number, jobs: Job[], page: number) => void
  blockedCompanies?: string[]
  blockingJobId?: string | null
  loading?: boolean
  sortBy: JobSortKey
  sortOrder: JobSortOrder
  onSortChange: (sortBy: JobSortKey) => void
  filters?: JobFilters
  onFiltersChange?: (filters: JobFilters) => void
  cityOptions?: string[]
  titleOptions?: string[]
}

export function safeJobUrl(job: Pick<Job, 'url' | 'source_platform'>): string | null {
  const platform = job.source_platform || 'boss'
  if (!job.url?.trim()) return null
  if (platform !== 'boss' && platform !== 'zhilian' && platform !== '51job' && platform !== 'liepin') return null
  try {
    const parsed = platform === 'boss'
      ? new URL(job.url || '', 'https://www.zhipin.com')
      : new URL(job.url || '')
    if (parsed.protocol !== 'https:') return null
    const rootDomain = platform === 'boss'
      ? 'zhipin.com'
      : platform === 'zhilian'
        ? 'zhaopin.com'
        : platform === '51job'
          ? '51job.com'
          : 'liepin.com'
    if (parsed.hostname !== rootDomain && !parsed.hostname.endsWith(`.${rootDomain}`)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function statusVariant(status: string) {
  const variants = new Set([
    'pending',
    'scored',
    'filtered',
    'ready',
    'approved',
    'skipped',
    'sent',
    'replied',
    'resume_sent',
    'needs_resume',
    'follow_up_sent',
    'rejected',
    'error',
  ])
  return variants.has(status) ? status : 'default'
}

export function JobsTable({ jobs, page, pageSize, total, onPageChange, selectedIds, onToggleSelected, onSoftDelete, onRemoveFromLibrary, researchOnly = false, onMarkManuallySent, onStatusChange, onRecruitmentTypeChange, onBlockCompany, onStartSwipeAtJob, blockedCompanies = [], blockingJobId = null, loading = false, sortBy, sortOrder, onSortChange, filters, onFiltersChange, cityOptions = [], titleOptions = [] }: JobsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [manualJob, setManualJob] = useState<(Job & { platformUrl: string }) | null>(null)
  const [pageInput, setPageInput] = useState(String(page + 1))
  const totalPages = Math.ceil(total / pageSize)
  const hasActions = Boolean(researchOnly || onSoftDelete || onMarkManuallySent || onStatusChange || onRecruitmentTypeChange || onBlockCompany || onStartSwipeAtJob)
  const hasDeleteColumn = Boolean(onRemoveFromLibrary)
  const columnCount = 10 + Number(hasActions) + Number(hasDeleteColumn)
  const viewportRef = useRef<HTMLDivElement>(null)
  const topScrollRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [scrollWidth, setScrollWidth] = useState(0)
  const columnWidths = hasActions ? [3, 15, 18, 6, 7, 10, 4, 7, 5, 5, 20] : [3, 19, 22, 7, 9, 12, 6, 8, 8, 6]
  const update = (key: keyof JobFilters, value: string | string[]) => { if (filters) onFiltersChange?.({ ...filters, [key]: value }) }
  const controlClass = 'h-7 min-w-0 w-full rounded-md border border-card-border bg-card px-2 text-xs font-normal text-foreground outline-none focus:border-primary'

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const table = tableRef.current
    if (!viewport || !table) return
    const measure = () => setScrollWidth(viewport.scrollWidth > viewport.clientWidth + 1 ? viewport.scrollWidth : 0)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(viewport)
    observer?.observe(table)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [hasActions, hasDeleteColumn])

  const syncScroll = (left: number, target: HTMLDivElement | null) => {
    if (target && target.scrollLeft !== left) target.scrollLeft = left
  }

  useEffect(() => {
    setPageInput(String(page + 1))
  }, [page])

  const jumpToPage = () => {
    const requested = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(requested) || totalPages < 1) {
      setPageInput(String(page + 1))
      return
    }
    onPageChange(Math.min(totalPages - 1, Math.max(0, requested - 1)))
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-success'
    if (score >= 60) return 'text-primary'
    return 'text-muted'
  }

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return ''
    const normalizedDate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)
      ? `${dateStr.replace(' ', 'T')}Z`
      : dateStr
    const timestamp = new Date(normalizedDate).getTime()
    if (Number.isNaN(timestamp)) return ''
    const diff = Date.now() - timestamp
    const hours = Math.floor(diff / 3600000)
    if (hours < 1) return '刚刚'
    if (hours < 24) return `${hours}h 前`
    return `${Math.floor(hours / 24)}d 前`
  }

  const sortableHeader = (label: string, key: JobSortKey, displayLabel = label) => (
    <button
      type="button"
      onClick={() => onSortChange(key)}
      className="inline-flex max-w-full items-center gap-0.5 text-[10px] font-bold hover:text-primary"
      title={`按${label}排序`}
    >
      {displayLabel}<span className="shrink-0 text-[8px]">{sortBy === key ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  )

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between px-4 py-3">
        <CardTitle>岗位列表</CardTitle>
        <span className="text-xs text-muted">{total} 条记录</span>
      </CardHeader>
      <CardContent className="p-0">
        <div hidden={!scrollWidth} className="sticky top-0 z-20 border-b border-card-border bg-card pt-1">
          <p className="px-2 text-[10px] text-muted">左右滚动查看全部列</p>
          <div ref={topScrollRef} role="region" aria-label="岗位表格横向滚动条" tabIndex={0} className="h-4 overflow-x-auto overflow-y-hidden" onScroll={event => syncScroll(event.currentTarget.scrollLeft, viewportRef.current)}>
            <div style={{ width: scrollWidth, height: 1 }} />
          </div>
        </div>
        <div ref={viewportRef} role="region" aria-label="岗位表格" tabIndex={0} className="overflow-x-auto" onScroll={event => syncScroll(event.currentTarget.scrollLeft, topScrollRef.current)}>
          <table ref={tableRef} className="jobs-table w-full table-fixed text-xs" style={{ minWidth: hasActions ? 900 : 760 }}>
            <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width: `${width * (hasDeleteColumn ? 0.94 : 1)}%` }} />)}{hasDeleteColumn && <col style={{ width: '6%' }} />}</colgroup>
            <thead>
              <tr className="border-b border-card-border bg-secondary text-xs text-muted">
                <th className="px-3 py-3 text-center font-bold">选</th>
                <th className="px-4 py-3 text-left font-bold">公司</th>
                <th className="px-4 py-3 text-left font-bold">职位</th>
                <th className="px-4 py-3 text-left font-bold">城市</th>
                <th className="px-4 py-3 text-left">{sortableHeader('薪资', 'salary')}</th>
                <th className="px-4 py-3 text-left">{sortableHeader('学历 / 招聘类型', 'education', '学历/类型')}</th>
                <th className="px-4 py-3 text-left">{sortableHeader('评分', 'score')}</th>
                <th className="px-4 py-3 text-left">{sortableHeader('状态', 'status')}</th>
                <th className="px-4 py-3 text-left">{sortableHeader('招聘者活跃', 'hr_active', '活跃')}</th>
                <th className="px-4 py-3 text-left">{sortableHeader('时间', 'created_at')}</th>
                {hasActions && <th className="px-3 py-3 text-center font-bold">操作</th>}
                {hasDeleteColumn && <th className="sticky right-0 z-10 border-l border-card-border bg-secondary text-center font-bold">删除</th>}
              </tr>
              {filters && onFiltersChange && <tr aria-label="按列筛选" className="border-b border-card-border bg-surface text-xs">
                <th className="px-1 py-2"><button type="button" aria-label="清空全部列筛选" onClick={() => onFiltersChange({ ...EMPTY_JOB_FILTERS })} className="whitespace-nowrap text-[10px] text-primary">清空</button></th>
                <th className="px-3 py-2"><input aria-label="按公司筛选" placeholder="包含公司名" value={filters.company} onChange={event => update('company', event.target.value)} className={controlClass} />
                  <MultiSelect portal compact className="mt-1" shortLabel="平台" placeholder="列筛选：平台" value={filters.sourcePlatform} onChange={value => update('sourcePlatform', value)} options={[{ value: 'boss', label: 'BOSS' }, { value: 'zhilian', label: '智联' }, { value: '51job', label: '51job' }, { value: 'liepin', label: '猎聘' }]} /></th>
                <th className="px-3 py-2"><MultiSelect portal compact searchable shortLabel="职位" placeholder="列筛选：职位" value={filters.titles} onChange={value => update('titles', value)} options={titleOptions.map(title => ({ value: title, label: title }))} /></th>
                <th className="px-3 py-2"><MultiSelect portal compact shortLabel="城市" placeholder="列筛选：城市" value={filters.city} onChange={value => update('city', value)} options={cityOptions.map(city => ({ value: city, label: city }))} /></th>
                <th className="px-3 py-2"><input type="number" min="0" aria-label="列筛选最低薪资 K" placeholder="低 K" value={filters.salaryMin} onChange={event => update('salaryMin', event.target.value)} className={controlClass} /><input type="number" min="0" aria-label="列筛选最高薪资 K" placeholder="高 K" value={filters.salaryMax} onChange={event => update('salaryMax', event.target.value)} className={`${controlClass} mt-1`} /></th>
                <th className="px-3 py-2"><MultiSelect portal compact shortLabel="学历" placeholder="列筛选：学历" value={filters.education} onChange={value => update('education', value)} options={['博士', '硕士', '本科', '大专', '不限', 'unknown'].map(value => ({ value, label: value === 'unknown' ? '未识别' : value }))} />
                  <MultiSelect portal compact className="mt-1" shortLabel="招聘" placeholder="列筛选：招聘类型" value={filters.recruitmentType} onChange={value => update('recruitmentType', value)} options={[{ value: 'campus', label: '校招' }, { value: 'experienced', label: '社招' }, { value: 'unknown', label: '未识别' }]} /></th>
                <th className="px-3 py-2"><input type="number" min="0" max="100" aria-label="列筛选最低评分" placeholder="低" value={filters.minScore} onChange={event => update('minScore', event.target.value)} className={controlClass} /><input type="number" min="0" max="100" aria-label="列筛选最高评分" placeholder="高" value={filters.maxScore} onChange={event => update('maxScore', event.target.value)} className={`${controlClass} mt-1`} /></th>
                <th className="px-3 py-2"><MultiSelect portal compact shortLabel="状态" placeholder="列筛选：状态" value={filters.status} onChange={value => update('status', value)} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} /></th>
                <th className="px-3 py-2"><input aria-label="按招聘者活跃筛选" placeholder="活跃" value={filters.hrActive} onChange={event => update('hrActive', event.target.value)} className={controlClass} /></th>
                <th className="px-3 py-2"><select aria-label="按采集时间筛选" value={filters.createdWithin} onChange={event => update('createdWithin', event.target.value)} className={controlClass}><option value="">全部</option><option value="today">今天</option><option value="3d">近 3 天</option><option value="7d">近 7 天</option></select></th>
                {hasActions && <th className="px-3 py-2 font-normal text-muted">可组合筛选</th>}
                {hasDeleteColumn && <th />}
              </tr>}
            </thead>
            <tbody>
              {jobs.map((job, index) => {
                const isExpanded = expanded === job.id
                const isExternalPlatform = job.source_platform === 'zhilian' || job.source_platform === '51job' || job.source_platform === 'liepin'
                const jobUrl = safeJobUrl(job)
                const alreadySent = ['sent', 'replied', 'resume_sent', 'needs_resume', 'follow_up_sent'].includes(job.status)
                const company = (job.company || '').trim()
                const blockedRule = blockedCompanies.find(rule => rule.trim() && company.toLowerCase().includes(rule.trim().toLowerCase()))
                return (
                  <Fragment key={job.id}>
                    <tr
                      data-job-row
                      className="cursor-pointer border-b border-border/70 bg-card transition-colors hover:bg-secondary/40"
                      onClick={() => setExpanded(isExpanded ? null : job.id)}
                    >
                      <td className="px-3 py-3 text-center" onClick={event => event.stopPropagation()}>
                        {onToggleSelected && <input
                          type="checkbox"
                          checked={selectedIds.includes(job.id)}
                          onChange={() => onToggleSelected(job.id)}
                          aria-label={`选择 ${job.company} ${job.title}`}
                          className="h-4 w-4 accent-primary"
                        />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <span title={job.company} className="line-clamp-2 break-words font-bold tracking-tight text-foreground">{job.company}</span>
                          <div className="job-company-badges mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${job.source_platform === 'boss' || !job.source_platform ? 'bg-primary/10 text-primary border-primary/20' : 'bg-info-soft text-info border-info-border'}`}>
                            {PLATFORM_SHORT_LABELS[job.source_platform || 'boss'] || 'BOSS'}
                          </span>
                          <OutsourcingBadge job={job} />
                          <CompanyAppliedBadge job={job} allKnownJobs={jobs} size="sm" />
                          {job.company_size && (
                            <span className="rounded-full bg-secondary/70 border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted">{job.company_size}</span>
                          )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground"><span title={job.title} className="line-clamp-2 break-words">{job.title}</span></td>
                      <td className="px-4 py-3 text-muted">{job.city || '未识别'}</td>
                      <td className="px-4 py-3 text-muted tabular-nums font-medium">{job.salary || '-'}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-bold text-foreground">{job.education || '学历未识别'}</div>
                        <div className="mt-1 text-muted">类型：{job.employment_type === 'internship' ? '实习' : job.employment_type === 'full_time' ? '全职' : job.employment_type === 'part_time' ? '兼职' : '待核实'}</div>
                        {job.employment_review && <div title={job.employment_review} className="mt-1 line-clamp-2 text-amber-600">{job.employment_review}</div>}
                        <div className="mt-1"><Badge variant={job.recruitment_type === 'campus' ? 'campus' : job.recruitment_type === 'experienced' ? 'experienced' : 'default'}>{job.recruitment_type === 'campus' ? '校招' : job.recruitment_type === 'experienced' ? '社招' : '类型未识别'}</Badge></div>
                      </td>
                      <td className="px-4 py-3">
                        <button type="button" aria-label={`查看 ${job.company} ${job.title} 评分细则`} onClick={event => {
                          event.stopPropagation()
                          setExpanded(isExpanded ? null : job.id)
                        }} className={`font-mono font-black underline decoration-dotted underline-offset-4 ${getScoreColor(job.score)}`}>{job.score || (job.score_reason ? '0' : '-')}</button>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(job.status) as any}>{getStatusLabel(job.status)}</Badge>
                        {job.greeting_image_id && <p className="mt-1 text-xs text-muted">图片：{job.greeting_image_status === 'sent' ? '已送达' : job.greeting_image_status === 'skipped' ? '已沟通，跳过' : job.greeting_image_status === 'failed' ? '发送失败' : job.greeting_image_status === 'unconfirmed' ? '待检查' : '待发送'}</p>}
                        {job.greeting_image_id && job.last_error && <p title={job.last_error} className="mt-1 line-clamp-2 text-xs text-danger">{job.last_error}</p>}
                        {Boolean(job.filter_library || job.status === 'filtered') && (job.filter_reason || job.score_reason) && (
                          <p className="mt-2 line-clamp-2 text-xs text-muted" title={job.filter_reason || job.score_reason}>过滤原因：{job.filter_reason || job.score_reason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{job.hr_active || '活跃度未知'}</td>
                      <td className="px-4 py-3 text-xs text-muted">
                        <div className="flex flex-col items-start gap-1">
                          {timeAgo(job.created_at)}
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </div>
                      </td>
                      {hasActions && (
                        <td className="px-3 py-3" onClick={event => event.stopPropagation()}>
                          <div className="job-actions flex flex-wrap items-center gap-1">
                            {isExternalPlatform && jobUrl && !researchOnly && (
                              <button type="button" onClick={() => setManualJob({ ...job, platformUrl: jobUrl })} className="inline-flex items-center gap-1 rounded-lg border border-card-border px-2 py-1.5 text-[11px] font-bold text-primary hover:bg-secondary">
                                <ExternalLink className="h-3.5 w-3.5" />打开平台
                              </button>
                            )}
                            {(isExternalPlatform || researchOnly) && !jobUrl && (
                              <span className="rounded-lg bg-warning-soft px-2 py-1.5 text-[11px] font-bold text-warning">链接不可用</span>
                            )}
                            {(!isExternalPlatform || researchOnly) && jobUrl && (
                              <a href={jobUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-card-border px-2 py-1.5 text-[11px] font-bold text-primary hover:bg-secondary">
                                <ExternalLink className="h-3.5 w-3.5" />{researchOnly ? '跳转投递' : '跳转岗位'}
                              </a>
                            )}
                            {onStartSwipeAtJob && (
                              <button
                                type="button"
                                onClick={() => onStartSwipeAtJob(job, index, jobs, page)}
                                title="从该岗位开启灵动挑岗"
                                className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                              >
                                <Sparkles className="h-3.5 w-3.5" />挑岗
                              </button>
                            )}
                            {isExternalPlatform && onMarkManuallySent && (
                              <button
                                type="button"
                                disabled={alreadySent}
                                onClick={() => onMarkManuallySent(job)}
                                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-bold text-primary-foreground hover:opacity-90 disabled:bg-success-soft disabled:text-success disabled:opacity-100"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />{alreadySent ? '已发送' : '我已发送'}
                              </button>
                            )}
                            {onSoftDelete && (
                              <button type="button" onClick={() => onSoftDelete(job)} className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" aria-label={`将 ${job.company} ${job.title} 移入回收站`}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                            {onBlockCompany && (
                              <button
                                type="button"
                                disabled={!company || Boolean(blockedRule) || Boolean(blockingJobId)}
                                onClick={() => onBlockCompany(job)}
                                aria-label={`屏蔽公司 ${company || '公司名缺失'}`}
                                title={blockedRule ? `已被“${blockedRule}”屏蔽，可在配置中解除` : company ? '预览后将公司加入屏蔽名单' : '缺少公司名称，无法屏蔽'}
                                className="inline-flex items-center gap-1 rounded-lg border border-card-border px-2 py-1.5 text-[11px] font-bold text-muted hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Ban className="h-3.5 w-3.5" />{blockingJobId === job.id ? '处理中…' : blockedRule ? '已屏蔽' : '屏蔽公司'}
                              </button>
                            )}
                            {onStatusChange && (
                              <select
                                defaultValue=""
                                aria-label={`修改 ${job.company} ${job.title} 状态`}
                                onChange={event => {
                                  const status = event.target.value
                                  if (status) onStatusChange(job, status)
                                  event.currentTarget.value = ''
                                }}
                                className="rounded-lg border border-card-border bg-card px-2 py-1.5 text-[11px] font-bold text-foreground"
                              >
                                <option value="">修改状态</option>
                                <option value="sent">已投递</option>
                                <option value="ready">待确认</option>
                                <option value="filtered">已过滤</option>
                                <option value="skipped">已跳过</option>
                                <option value="rejected">已拒绝</option>
                              </select>
                            )}
                            {onRecruitmentTypeChange && (
                              <select
                                defaultValue=""
                                aria-label={`修改 ${job.company} ${job.title} 招聘类型`}
                                onChange={event => {
                                  if (event.target.value) onRecruitmentTypeChange(job, event.target.value)
                                  event.currentTarget.value = ''
                                }}
                                className="rounded-lg border border-card-border bg-card px-2 py-1.5 text-[11px] font-bold text-foreground"
                              >
                                <option value="">招聘类型</option>
                                <option value="campus">校招</option>
                                <option value="experienced">社招</option>
                              </select>
                            )}
                          </div>
                        </td>
                      )}
                      {onRemoveFromLibrary && (
                        <td className="sticky right-0 z-10 border-l border-card-border bg-card px-1 py-3 text-center" onClick={event => event.stopPropagation()}>
                          <button type="button" onClick={() => onRemoveFromLibrary(job)}
                            className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1 py-2 font-bold text-danger hover:bg-danger-soft"
                            aria-label={`删除检索库岗位 ${job.title}`}><Trash2 className="h-3.5 w-3.5" />删除</button>
                        </td>
                      )}
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-card-border bg-surface">
                        <td colSpan={columnCount} className="px-6 py-4">
                          {researchOnly ? <div className="space-y-3 text-sm">
                            <p className="whitespace-pre-wrap text-muted">{job.jd || '暂无 JD'}</p>
                            {job.score_reason && <p className="whitespace-pre-wrap text-muted">{job.score_reason}</p>}
                          </div> : <>
                          <div className="mb-3 w-full max-w-2xl">
                            <InterviewPreparation key={job.id} job={job} />
                          </div>
                          <div className="grid grid-cols-1 gap-4 text-sm lg:grid-cols-3">
                            <div className="rounded-2xl border border-card-border bg-card p-4">
                              <p className="mb-2 text-xs font-black text-primary">JD摘要</p>
                              <p className="line-clamp-6 leading-6 text-muted">{job.jd || '无'}</p>
                            </div>
                            <div className="rounded-2xl border border-card-border bg-card p-4">
                              <p className="mb-2 text-xs font-black text-primary">招呼语</p>
                              <p className="line-clamp-6 whitespace-pre-wrap leading-6 text-muted">{job.greeting || '未生成'}</p>
                            </div>
                            <ScoreDetails jobId={job.id} score={job.score} reason={job.score_reason || ''} />
                          </div>
                          </>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!jobs.length && (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-10 text-center text-sm text-muted">
                    {loading ? '正在读取岗位…' : '没有符合当前条件的岗位'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3 border-t border-card-border px-4 py-3 text-xs">
            <button
              onClick={() => onPageChange(0)}
              disabled={page === 0}
              className="font-bold text-muted transition hover:text-foreground disabled:opacity-30"
            >
              首页
            </button>
            <button
              onClick={() => onPageChange(Math.max(0, page - 1))}
              disabled={page === 0}
              className="font-bold text-muted transition hover:text-foreground disabled:opacity-30"
            >
              上一页
            </button>
            <label className="flex items-center gap-1 text-muted">
              第
              <input
                type="number"
                min={1}
                max={Math.max(1, totalPages)}
                value={pageInput}
                onChange={event => setPageInput(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') jumpToPage() }}
                onBlur={jumpToPage}
                aria-label="跳转页码"
                className="w-14 rounded-md border border-card-border bg-surface px-2 py-1 text-center text-foreground outline-none focus:border-primary"
              />
              页 / {totalPages} 页
            </label>
            <button
              onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="font-bold text-muted transition hover:text-foreground disabled:opacity-30"
            >
              下一页
            </button>
            <button
              onClick={() => onPageChange(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="font-bold text-muted transition hover:text-foreground disabled:opacity-30"
            >
              尾页
            </button>
          </div>
        )}
      </CardContent>
      {manualJob && <DeliveryDialog key={manualJob.id} open count={1} jobIds={[manualJob.id]} manualJob={manualJob} onClose={() => setManualJob(null)} />}
    </Card>
  )
}
