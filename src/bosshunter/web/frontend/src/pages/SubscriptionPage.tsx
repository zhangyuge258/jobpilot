import { useCallback, useEffect, useState } from 'react'
import { Bell, ChevronDown, ExternalLink, RefreshCw } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'

const categories = { state: '央国企', major: '大厂', public: '事业编', other: '其他' }
const views = { latest: '最新动态', all: '全部岗位', sent: '已投递' }
const statusLabels: Record<string, string> = { open: '在招', closed: '已截止', upcoming: '即将开放', withdrawn: '已撤回', unknown: '状态待核实' }
const eventLabels: Record<string, string> = { initial: '上线前已发布', new: '新增', changed: '已更新', withdrawn: '已撤回' }
const sourceLabels: Record<string, string> = { ok: '检查完成', pending: '等待检查', partial: '部分完成', error: '待补查', running: '检查中' }
const platformLabels: Record<string, string> = { boss: 'BOSS 直聘', zhilian: '智联招聘', '51job': '前程无忧', liepin: '猎聘' }
type Category = keyof typeof categories
type View = keyof typeof views
type Item = {
  source: string; key: string; company: string; title: string; url: string; original?: string; attachment?: string
  platform?: string; city?: string; education?: string; closes?: string; opens?: string; published?: string
  first_seen?: string; seen?: string; event_id?: number; event_kind?: string; kind?: string
  jd?: string; score?: number | null; score_reason?: string; sent?: boolean; availability?: string
  routes?: Pick<Item, 'source' | 'platform' | 'url' | 'availability'>[]
}
type Source = { id: string; name: string; url: string; scope: string; state: string; successful?: string; message?: string; minutes: number }
type Report = {
  day: string; created: string; read: number
  data: { first: boolean; open_count: number; urgent: Item[]; changes: Item[]; sources: Source[] }
}
type Organisation = { name: string; jobs: number; open: number; notices: number; sources: string[]; links: { title: string; url: string }[] }
type State = { groups: { company: string; jobs: Item[] }[]; events: Item[]; sources: Source[]; report: Report | null; organisations?: Organisation[] }

function displayTime(value?: string) {
  return value?.replace('T', ' ').slice(0, 16) || '未注明'
}

function publicLink(raw: string | undefined) {
  try {
    const url = new URL(raw || '')
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}

function originalLink(item: Pick<Item, 'url' | 'platform'>) {
  if (item.platform === 'boss' && item.url?.startsWith('/job_detail/')) return publicLink('https://www.zhipin.com' + item.url)
  return publicLink(item.url)
}

async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/subscription' + path, {
    cache: 'no-store', signal, method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '招聘订阅请求失败')
  return data
}

export function SubscriptionNotification() {
  const [report, setReport] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    const check = () => void request<{ day?: string }>('/unread', undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setReport(data.day) }).catch(() => {})
    check()
    const timer = window.setInterval(check, 30000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [])
  if (!report) return null
  return <Link to="/subscription?report=1" onClick={() => setReport(undefined)}
    className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-3 text-sm font-bold text-primary shadow-lg">
    <Bell className="h-4 w-4" /> 新的招聘日报 · {report}
  </Link>
}

export default function SubscriptionPage() {
  const [category, setCategory] = useState<Category>('state')
  const [view, setView] = useState<View>('all')
  const [state, setState] = useState<State>()
  const [query, setQuery] = useState('')
  const [city, setCity] = useState('')
  const [showDirectory, setShowDirectory] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [names, setNames] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const location = useLocation()
  const [reportOpen, setReportOpen] = useState(location.search.includes('report=1'))
  useEffect(() => {
    if (new URLSearchParams(location.search).get('report') === '1') setReportOpen(true)
  }, [location.search])
  const qs = '?' + new URLSearchParams({ category, mode: showDirectory ? 'directory' : view, q: query, city }).toString()
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const data = await request<State>(qs, undefined, signal)
    if (!signal?.aborted) setState(data)
  }, [qs])
  useEffect(() => {
    setState(undefined)
    const controller = new AbortController()
    const update = () => void refresh(controller.signal).catch(cause => {
      if (!controller.signal.aborted) setError(cause.message)
    })
    update()
    const timer = window.setInterval(update, 12000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [refresh])

  const perform = async (call: () => Promise<unknown>) => {
    setError('')
    setPending(true)
    try {
      await call()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setPending(false)
    }
  }

  const markSent = (item: Item) => {
    if (!window.confirm('确认你已经完成该岗位的投递？')) return
    void perform(async () => {
      if (item.source !== 'pool') return request('/update', { action: 'sent', source: item.source, key: item.key, sent: true })
      const res = await fetch('/api/jobs/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: [item.key], status: 'sent' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '岗位状态更新失败')
    })
  }

  useEffect(() => {
    if (reportOpen && state?.report && !state.report.read) {
      void request('/update', { action: 'read', day: state.report.day }).then(() => refresh()).catch(() => {})
    }
  }, [reportOpen, state?.report?.day, state?.report?.read, refresh])

  const report = state?.report
  const renderEvent = (item: Item) => <li key={item.event_id || (item.source + item.key)} className="rounded-lg border border-card-border px-3 py-2 text-sm">
    <a href={originalLink(item)} target="_blank" rel="noreferrer" className="font-semibold text-primary">{item.title}</a>
    <p className="mt-1 text-xs text-muted">{item.company}{item.event_kind ? ' · ' + eventLabels[item.event_kind] : ''}{item.closes ? ' · 截止 ' + displayTime(item.closes) : ''}</p>
    {item.seen && <p className="mt-1 text-xs text-muted">发布 {displayTime(item.published)} · 发现 {displayTime(item.seen)}</p>}
  </li>

  return <div className="mx-auto max-w-6xl space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight">全网搜集</h1><p className="mt-1 text-sm text-muted">官方招聘动态 · 每日自动巡检与 08:30 招聘日报</p></div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setReportOpen(value => !value)}><Bell className="mr-1 h-4 w-4" /> 日报{report && !report.read ? ' · 未读' : ''}</Button>
        <Button variant={showDirectory ? 'default' : 'secondary'} aria-pressed={showDirectory} onClick={() => { setShowDirectory(value => !value); setQuery('') }}>
          {showDirectory ? '返回招聘动态和岗位' : '机构目录'}
        </Button>
        <Button disabled={pending || state?.sources.some(source => source.state === 'running')} onClick={() => void perform(() => request('/refresh', {}))}>
          <RefreshCw className="mr-1 h-4 w-4" />检查官方来源
        </Button>
      </div>
    </header>
    {error && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    {reportOpen && <section className="space-y-3 rounded-2xl border border-card-border bg-card p-4">
      <h2 className="font-bold">{report ? report.day + ' 招聘日报' : '招聘日报'}</h2>
      {report ? <>
        <p className="text-sm text-muted">生成 {displayTime(report.created)} · {report.data.open_count} 个官方岗位在招</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><h3 className="mb-1 text-sm font-bold">未来 3 天截止</h3><ul className="space-y-1">{report.data.urgent.map(renderEvent)}</ul>
            {!report.data.urgent.length && <p className="text-sm text-muted">没有已核实的临近截止岗位</p>}</div>
          <div><h3 className="mb-1 text-sm font-bold">{report.data.first ? '首轮发现' : '新增与变更'}</h3>
            <ul className="max-h-64 space-y-1 overflow-auto">{report.data.changes.map(renderEvent)}</ul>{!report.data.changes.length && <p className="text-sm text-muted">暂无变更</p>}</div>
        </div>
        <p className="text-xs text-muted">{report.data.sources.filter(source => source.state !== 'ok').map(source => source.name + ' · ' + sourceLabels[source.state]).join('；')}</p>
      </> : <p className="text-sm text-muted">首次来源检查完成后可生成日报。</p>}
    </section>}
    <details className="rounded-2xl border border-card-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-bold">官方来源 · {state?.sources.filter(source => source.state === 'ok').length || 0}/{state?.sources.length || 0} 检查完成</summary>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">{state?.sources.map(source => <li key={source.id} className="rounded-lg border border-card-border p-2 text-sm">
        <a href={publicLink(source.url)} target="_blank" rel="noreferrer" className="font-semibold text-primary">{source.name}</a>
        <p className="text-xs text-muted">{sourceLabels[source.state]} · {source.scope} · 每 {source.minutes} 分钟</p>
        <p className="text-xs text-muted">上次完整检查 {displayTime(source.successful)}{source.message ? ' · ' + source.message : ''}</p>
      </li>)}</ul>
    </details>
    <section className="space-y-4 rounded-2xl border border-card-border bg-card p-4">
      <nav aria-label="招聘类别" className="flex flex-wrap gap-2">
        {Object.entries(categories).map(([key, label]) => <Button key={key} variant={category === key ? 'default' : 'secondary'} size="sm"
          aria-pressed={category === key} onClick={() => setCategory(key as Category)}>{label}</Button>)}
      </nav>
      {showDirectory ? <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-bold">{categories[category]}机构目录</h2><p className="text-xs text-muted">岗位与公告分别计数。仅收录名录的机构仍需接入招聘来源。</p></div>
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(value => !value)}>批量补充机构</Button>
        </div>
        {showAdd && <div className="space-y-2">
          <label className="grid gap-1 text-sm">添加到「{categories[category]}」，每行一家
            <textarea rows={4} className="rounded-lg border border-card-border bg-surface px-3 py-2" value={names} onChange={event => setNames(event.target.value)} />
          </label>
          <Button size="sm" disabled={!names.trim() || pending} onClick={() => void perform(async () => {
            await request('/update', { action: 'add_organisations', category, names: names.split('\n').map(name => name.trim()).filter(Boolean) })
            setNames('')
            setShowAdd(false)
          })}>加入目录</Button>
        </div>}
        <input aria-label="搜索机构" placeholder="搜索机构" value={query} onChange={event => setQuery(event.target.value)}
          className="rounded-lg border border-card-border bg-surface px-3 py-2 text-sm" />
        {state && <p className="text-xs text-muted">{state.organisations?.length || 0} 家机构</p>}
        <ul className="divide-y divide-card-border">
          {state?.organisations?.map(item => <li key={item.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="font-semibold">{item.name}</span>
            <span className="text-xs text-muted">{item.jobs ? `${item.jobs} 个岗位 · ${item.open} 个已核实在招` : item.notices ? `${item.notices} 条公告 · 暂无具体岗位` : '仅纳入目录'}</span>
            {!!item.sources.length && <span className="text-xs text-muted" title={item.sources.map(id => state.sources.find(source => source.id === id)?.name).filter(Boolean).join('、')}>
              {item.sources.length} 个跟踪来源
            </span>}
            {item.links.map(link => <a key={link.url} href={publicLink(link.url)} target="_blank" rel="noreferrer"
              className="text-xs text-primary">{link.title} ↗</a>)}
            {item.jobs > 0 && <button className="text-xs font-semibold text-primary" type="button"
              onClick={() => { setShowDirectory(false); setView('all'); setQuery(item.name); setCity('') }}>查看岗位</button>}
          </li>)}
        </ul>
      </> : <>
      <nav aria-label="岗位视图" className="flex gap-2 border-b border-card-border pb-2">
        {Object.entries(views).map(([key, label]) => <Button key={key} size="sm" variant={view === key ? 'secondary' : 'ghost'}
          aria-pressed={view === key} onClick={() => setView(key as View)}>{label}</Button>)}
      </nav>
      {view === 'latest' ? <ul className="space-y-2">{state?.events.map(renderEvent)}</ul> : <>
        <div className="flex flex-wrap gap-2">
          <input aria-label="搜索岗位或单位" placeholder="搜索岗位或单位" value={query} onChange={event => setQuery(event.target.value)} className="rounded-lg border border-card-border bg-surface px-3 py-2 text-sm" />
          <input aria-label="筛选城市" placeholder="筛选城市" value={city} onChange={event => setCity(event.target.value)} className="rounded-lg border border-card-border bg-surface px-3 py-2 text-sm" />
        </div>
        <div className="space-y-2">
          {state?.groups.map(group => <details key={group.company} className="rounded-xl border border-card-border p-3">
            <summary className="cursor-pointer text-sm font-bold">{group.company} <span className="ml-1 font-normal text-muted">{group.jobs.length} 个岗位</span></summary>
            <div className="mb-2 mt-2">
              <label className="text-xs text-muted">单位类别 <select className="rounded border border-card-border bg-card p-1" value={category} disabled={pending}
                onChange={event => void perform(() => request('/update', { action: 'category', company: group.company, category: event.target.value }))}>
                {Object.entries(categories).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
              </select></label>
            </div>
            <ul className="divide-y divide-card-border">{group.jobs.map(item => <li key={item.source + item.key} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2"><strong>{item.title}</strong><span className="rounded-full bg-secondary px-2 py-1 text-xs text-primary">{item.score == null ? '未评分' : item.score + ' 分'}</span>
                <span className="text-xs text-muted">{item.sent ? '已投递 · ' : ''}{statusLabels[item.availability || 'unknown']}</span></div>
              <p className="text-xs text-muted">{[platformLabels[item.platform || ''] || '官方来源', item.city, item.education || '学历未注明', item.closes && '截止 ' + displayTime(item.closes)].filter(Boolean).join(' · ')}</p>
              <details className="text-sm"><summary className="flex cursor-pointer items-center gap-1"><ChevronDown className="h-4 w-4" /> 岗位详情与评分说明</summary>
                <p className="mt-2 whitespace-pre-wrap">{item.jd || '暂无完整岗位描述'}</p>
                {item.score_reason && <p className="mt-2 whitespace-pre-wrap text-muted">{item.score_reason}</p>}
                {(item.published || item.first_seen) && <p className="mt-2 text-xs text-muted">发布 {displayTime(item.published)} · 发现 {displayTime(item.first_seen)}</p>}
              </details>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {(item.routes || [item]).filter(route => originalLink(route)).map((route, index) =>
                  <a key={route.url + index} className="inline-flex items-center gap-1 font-bold text-primary" href={originalLink(route)} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {item.routes ? platformLabels[route.platform || ''] || '官网' : '打开原报名入口'}
                    {(route.availability === 'closed' || route.availability === 'withdrawn') && '（已结束）'}
                  </a>)}
                {publicLink(item.original) && <a className="text-primary" href={publicLink(item.original)} target="_blank" rel="noreferrer">官方职位页</a>}
                {publicLink(item.attachment) && <a className="text-primary" href={publicLink(item.attachment)} target="_blank" rel="noreferrer">岗位表</a>}
                {!item.sent && <Button size="sm" variant="secondary" disabled={pending} onClick={() => markSent(item)}>标记已投递</Button>}
                {item.source !== 'pool' && item.sent && <Button size="sm" variant="secondary" disabled={pending} onClick={() => void perform(() => request('/update', { action: 'sent', source: item.source, key: item.key, sent: false }))}>撤销标记</Button>}
                {item.source !== 'pool' && item.score == null && item.jd && <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => void perform(() => request('/score', { source: item.source, key: item.key }))}>评估匹配度</Button>}
              </div>
            </li>)}</ul>
          </details>)}
        </div>
      </>}
      {state && !(view === 'latest' ? state.events.length : state.groups.length) && <p className="text-sm text-muted">该栏目暂无记录</p>}
      </>}
      {!state && <p className="text-sm text-muted">正在读取招聘订阅…</p>}
    </section>
  </div>
}
