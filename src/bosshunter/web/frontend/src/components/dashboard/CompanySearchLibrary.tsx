import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { JobsTable, safeJobUrl } from './JobsTable'
import type { Job, WorkbenchTask } from '@/hooks/useDashboard'
import type { JobSortKey } from '@/hooks/useJobSearch'

const platforms = { boss: 'BOSS 直聘', zhilian: '智联招聘', '51job': '前程无忧', website: '查找官网' }
const statuses: Record<string, string> = { found: '已收录', empty: '未命中', retry: '待补查', review: '待核实' }
const companyHeaders = ['公司', '企业', '单位', '公司名称', '企业名称', '单位名称', '招聘单位']
const pageSize = 15

type Company = {
  id: number
  name: string
  job_count: number
  review_count?: number
  platform_job_counts?: Record<string, number>
  website: string
  website_status: string
  website_candidates: { url: string; title: string }[]
  platforms: Record<string, { status: string; message: string }>
}
type ImportSheet = { rows: unknown[][]; source: string }
type ReviewJob = Pick<Job, 'id' | 'title' | 'company' | 'education' | 'jd' | 'url' | 'source_platform'> & { reason: string }
type SearchState = {
  companies: Company[]
  cities: string[]
  pending: number
  task: (Omit<WorkbenchTask, 'progress'> & {
    progress?: { company?: string; platform?: keyof typeof platforms; current?: number; total?: number }
  }) | null
}

async function api<T>(path = '', body?: object, signal?: AbortSignal): Promise<T> {
  const isFile = body instanceof FormData
  const response = await fetch('/api/company-search' + path, {
    signal, cache: 'no-store', method: body ? 'POST' : 'GET',
    headers: body && !isFile ? { 'Content-Type': 'application/json' } : undefined,
    body: isFile ? body : body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '企业检索请求失败')
  return data
}

export function CompanySearchLibrary() {
  const [state, setState] = useState<SearchState>()
  const [view, setView] = useState<'search' | 'results'>('search')
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [review, setReview] = useState<ReviewJob[]>([])
  const [sheet, setSheet] = useState<ImportSheet>()
  const [column, setColumn] = useState(0)
  const [names, setNames] = useState('')
  const [cities, setCities] = useState('')
  const [maxPages, setMaxPages] = useState(3)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [undo, setUndo] = useState<{ companyId: number; job: Job | ReviewJob }[]>([])
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<JobSortKey>('created_at')
  const [ascending, setAscending] = useState(false)
  const [companyQuery, setCompanyQuery] = useState('')
  const selectedCompany = useRef(companyId)
  selectedCompany.current = view === 'results' ? companyId : null
  const refreshId = useRef(0)
  const task = state?.task
  const active = task?.status === 'running' || task?.status === 'stopping'
  const company = state?.companies.find(item => item.id === companyId)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const revision = ++refreshId.current
    const data = await api<SearchState>('', undefined, signal)
    if (signal?.aborted || revision !== refreshId.current) return
    setState(data)
    const id = selectedCompany.current
    if (id !== null) {
      const detail = await api<{ jobs: Job[]; review?: ReviewJob[] }>('/' + id + '/jobs', undefined, signal)
      if (!signal?.aborted && revision === refreshId.current && id === selectedCompany.current) {
        setJobs(detail.jobs)
        setReview(detail.review ?? [])
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const update = () => void refresh(controller.signal).catch(cause => {
      if (!controller.signal.aborted) setError(cause.message)
    })
    update()
    const interval = window.setInterval(update, 3500)
    return () => { controller.abort(); window.clearInterval(interval) }
  }, [refresh, companyId, view])

  const perform = async (action: () => Promise<void>) => {
    setError('')
    setPending(true)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setPending(false)
    }
  }
  const setPreview = (data: ImportSheet, index: number) => {
    setColumn(index)
    const values = data.rows.map(row => typeof row[index] === 'string' ? String(row[index]).trim() : '')
    const header = values.findIndex(value => companyHeaders.includes(value))
    setNames(values.slice(header + 1).filter(Boolean).join('\n'))
  }
  const upload = (file?: File) => file && void perform(async () => {
    const form = new FormData()
    form.append('file', file)
    const data = await api<ImportSheet>('/import', form)
    const header = data.rows.find(row => row.some(value => typeof value === 'string' && companyHeaders.includes(value.trim())))
    setSheet(data)
    setPreview(data, Math.max(0, header?.findIndex(value => typeof value === 'string' && companyHeaders.includes(value.trim())) ?? 0))
    setCities(current => current || state?.cities.join('、') || '')
  })
  const changeMembership = (id: number, job: Job | ReviewJob, removed: boolean) => {
    setError('')
    void api('/' + id + '/job', { job_id: job.id, removed }).then(() => {
      if (removed && selectedCompany.current === id) {
        setJobs(previous => previous.filter(item => item.id !== job.id))
        setReview(previous => previous.filter(item => item.id !== job.id))
      }
      setUndo(previous => removed ? [...previous.filter(item => item.companyId !== id || item.job.id !== job.id), { companyId: id, job }]
        : previous.filter(item => item.companyId !== id || item.job.id !== job.id))
      return refresh()
    }).catch(cause => setError(cause.message))
  }
  const changeLabel = (id: number, job: Job, patch: { status: string } | { recruitment_type: string }) =>
    void perform(async () => { await api('/' + id + '/job', { job_id: job.id, ...patch }) })
  const sortedJobs = [...jobs].sort((a, b) => {
    const left = a[sort as keyof Job]
    const right = b[sort as keyof Job]
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN')
    return ascending ? order : -order
  })
  const currentPage = Math.min(page, Math.max(0, Math.ceil(jobs.length / pageSize) - 1))
  const lastRemoved = undo[undo.length - 1]
  const count = names.split('\n').filter(value => value.trim()).length
  const results = view === 'results'
  const companies = state?.companies.filter(item => !results || item.job_count > 0 || (item.review_count ?? 0) > 0) ?? []

  const switchView = (next: typeof view) => {
    if (next === view) return
    setView(next)
    setCompanyId(null)
    setJobs([])
    setReview([])
    setPage(0)
    setCompanyQuery('')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="检索库子菜单">
        <Button size="sm" variant={results ? 'secondary' : 'default'} aria-pressed={!results}
          onClick={() => switchView('search')}>企业检索</Button>
        <Button size="sm" variant={results ? 'default' : 'secondary'} aria-pressed={results}
          onClick={() => switchView('results')}>搜索到库</Button>
      </div>
      {!results && <div className="rounded-2xl border border-card-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-bold">导入企业名单
            <input type="file" accept=".xlsx,.xls,.png,.jpg,.jpeg,.webp,.bmp" className="ml-2 max-w-full text-sm"
              disabled={pending || active} onChange={event => { upload(event.target.files?.[0]); event.target.value = '' }} />
          </label>
          {Boolean(state?.pending) && <Button size="sm" variant="secondary" disabled={pending || active}
            onClick={() => void perform(async () => { await api('/start', { resume: true }) })}>续搜待处理企业 ({state?.pending})</Button>}
        </div>
        {sheet && <div className="mt-4 grid gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">企业名称列
              <select className="ml-2 rounded-lg border border-card-border bg-card p-2" value={column}
                onChange={event => setPreview(sheet, Number(event.target.value))}>
                {Array.from({ length: sheet.rows.reduce((n, row) => Math.max(n, row.length), 0) }, (_, index) =>
                  <option key={index} value={index}>第 {index + 1} 列 · {String(sheet.rows.find(row => row[index])?.[index] ?? '').slice(0, 25)}</option>)}
              </select>
            </label>
            <span className="self-center text-xs text-muted">{sheet.source}</span>
          </div>
          <label className="grid gap-1 text-sm">确认企业名单（可编辑，每行一家）
            <textarea className="rounded-xl border border-card-border bg-card p-2" rows={5} value={names} onChange={event => setNames(event.target.value)} />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">搜索城市（用顿号分隔）
              <input className="rounded-lg border border-card-border bg-card p-2" value={cities} onChange={event => setCities(event.target.value)} placeholder="如 天津、北京" />
            </label>
            <label className="grid gap-1 text-sm">每城每平台最多页数
              <input className="w-28 rounded-lg border border-card-border bg-card p-2" type="number" min={1} max={20}
                value={maxPages} onChange={event => setMaxPages(Number(event.target.value))} />
            </label>
            <Button disabled={pending || active || !count || !cities.trim()} onClick={() => void perform(async () => {
              await api('/start', {
                names: names.split('\n').map(value => value.trim()).filter(Boolean),
                cities: cities.split(/[、,，\s]+/).filter(Boolean), max_pages: maxPages,
              })
              setSheet(undefined)
            })}>开始搜索 {count} 家企业</Button>
          </div>
        </div>}
        {active && <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span role="status">{task.status === 'stopping' ? '正在停止' : '正在搜索'} {task.progress?.current}/{task.progress?.total} {task.progress?.company} {task.progress?.platform && platforms[task.progress.platform]}</span>
          <Button size="sm" variant="secondary" disabled={pending || task.status === 'stopping'} onClick={() => void perform(async () => {
            const response = await fetch('/api/workbench/task/' + task.id + '/stop', { method: 'POST' })
            if (!response.ok) throw new Error('停止检索失败')
          })}>停止检索</Button>
        </div>}
      </div>}
      {(error || (!results && task?.error)) && <p role="alert" className="text-sm text-danger">{error || task?.error}</p>}
      {results && lastRemoved && <div className="flex items-center gap-2 text-sm" role="status">
        已从检索库移除「{lastRemoved.job.title}」
        <Button size="sm" variant="secondary" disabled={pending}
          onClick={() => changeMembership(lastRemoved.companyId, lastRemoved.job, false)}>撤销</Button>
      </div>}
      {!!companies.length && <input type="search" className="rounded-xl border border-card-border bg-card px-3 py-2 text-sm"
        aria-label="筛选企业" placeholder="筛选企业" value={companyQuery} onChange={event => setCompanyQuery(event.target.value)} />}
      <div className="space-y-2">
        {companies.filter(item => item.name.toLowerCase().includes(companyQuery.trim().toLowerCase())).map(item => (
          <div key={item.id} className="rounded-xl border border-card-border bg-card">
            <button className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left" type="button"
              aria-expanded={companyId === item.id} onClick={() => { setJobs([]); setReview([]); setPage(0); setCompanyId(current => current === item.id ? null : item.id) }}>
              <strong>{item.name}</strong><span className="text-sm text-muted">{item.job_count} 个岗位</span>
              {!!item.review_count && <span className="text-xs font-bold text-warning">{item.review_count} 个待核实</span>}
              {Object.entries(platforms).filter(([key]) => key !== 'website').map(([key, label]) => {
                const platform = item.platforms[key]
                const saved = item.platform_job_counts?.[key] || 0
                const status = platform?.status
                const stateText = status === 'found' ? '已收录' : status === 'empty' ? '本轮未命中' : status ? statuses[status] : '待查'
                const tone = !platform ? 'bg-surface text-muted' : platform.status === 'found' ? 'bg-success-soft text-success'
                  : platform.status === 'empty' ? 'bg-surface text-muted' : 'bg-warning-soft text-warning'
                return <span key={key} title={platform?.message} className={'rounded-full px-2 py-1 text-xs ' + tone}>
                  {label} · {saved ? `已收录 ${saved}${status === 'found' ? '' : ` · ${stateText}`}` : stateText}
                </span>
              })}
              {item.website && <span className="text-xs font-bold text-primary">有官网</span>}
            </button>
            {company?.id === item.id && <div className="space-y-2 border-t border-card-border p-3">
              {Object.entries(item.platforms).filter(([, value]) => ['retry', 'review'].includes(value.status)).map(([key, value]) =>
                <p key={key} className="text-xs text-muted">{platforms[key as keyof typeof platforms]} · {value.message}</p>)}
              {item.website ? <a href={item.website} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-primary">打开企业官网或招聘页 ↗</a>
                : item.website_status === 'retry' ? <p className="text-xs text-warning">官网搜索失败，可续搜重试</p>
                : item.website_status === 'empty' ? <p className="text-xs text-muted">未找到可核实的官网</p> : null}
              {!item.website && item.website_candidates.map(candidate => <div key={candidate.url} className="flex flex-wrap items-center gap-2 text-sm">
                <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="text-primary">{candidate.title} ↗</a>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => void perform(async () => {
                  await api('/' + item.id + '/website', { url: candidate.url })
                })}>确认为官网</Button>
              </div>)}
              {results && (jobs.length ? <JobsTable jobs={sortedJobs.slice(currentPage * pageSize, (currentPage + 1) * pageSize)}
                page={currentPage} pageSize={pageSize} total={jobs.length} onPageChange={setPage}
                selectedIds={[]} researchOnly
                onStatusChange={(job, status) => changeLabel(item.id, job, { status })}
                onRecruitmentTypeChange={(job, recruitment_type) => changeLabel(item.id, job, { recruitment_type })}
                onRemoveFromLibrary={job => changeMembership(item.id, job, true)}
                sortBy={sort} sortOrder={ascending ? 'asc' : 'desc'}
                onSortChange={key => { setAscending(key === sort ? !ascending : true); setSort(key); setPage(0) }} />
                : <p className="p-3 text-sm text-muted">{item.job_count ? '正在加载岗位' : '暂无已核实岗位'}</p>)}
              {results && !!review.length && <div className="space-y-2 rounded-xl border border-card-border bg-surface p-3">
                <h3 className="text-sm font-bold">搜到的待核实岗位</h3>
                {review.map(job => {
                  const url = safeJobUrl(job)
                  return (
                  <details key={job.id} className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-bold">
                      {job.title} · {platforms[job.source_platform as keyof typeof platforms]}
                      <button type="button" className="float-right ml-2 text-xs font-bold text-danger hover:underline"
                        aria-label={`删除待核实岗位 ${job.title}`} onClick={event => {
                          event.preventDefault()
                          event.stopPropagation()
                          changeMembership(item.id, job, true)
                        }}>删除</button>
                    </summary>
                    <p className="mt-2 text-xs text-muted">{job.company || '企业未注明'} · {job.education || '学历未注明'} · {job.reason}</p>
                    {job.jd && <p className="my-2 whitespace-pre-wrap">{job.jd}</p>}
                    <div className="mt-2 flex items-center gap-3">
                      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary">跳转投递 ↗</a>}
                      {job.jd && <Button size="sm" variant="secondary" disabled={pending} onClick={() => {
                        if (window.confirm(`确认「${job.title}」属于「${item.name}」并收录？`)) {
                          void perform(async () => { await api('/' + item.id + '/review', { job_id: job.id }) })
                        }
                      }}>确认企业并收录</Button>}
                    </div>
                  </details>
                  )
                })}
              </div>}
            </div>}
          </div>
        ))}
      </div>
      {state && !companies.length && <p className="text-sm text-muted">{results ? '暂无搜到的岗位' : '上传名单后，企业会显示在这里。'}</p>}
    </div>
  )
}
