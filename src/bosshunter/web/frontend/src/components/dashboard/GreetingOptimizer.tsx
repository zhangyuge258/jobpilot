import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'

export interface TailoredGreeting {
  job_id: string
  company: string
  title: string
  greeting: string
  status: 'pending' | 'ready' | 'error'
  error?: string
  highlights: Array<{ jd_quote: string; evidence_quote: string; reason: string }>
}

export function GreetingOptimizer({ original, jobIds, drafts, onChange, onBusyChange, disabled, manual = false }: {
  original: string
  jobIds: string[]
  drafts: TailoredGreeting[] | null
  onChange: Dispatch<SetStateAction<TailoredGreeting[] | null>>
  onBusyChange: (value: boolean) => void
  disabled: boolean
  manual?: boolean
}) {
  const controllerRef = useRef<AbortController | null>(null)
  const [progress, setProgress] = useState('')
  const idsKey = JSON.stringify(jobIds)
  useEffect(() => {
    onChange(null)
    setProgress('')
    onBusyChange(false)
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
      onBusyChange(false)
    }
  }, [original, idsKey, onChange, onBusyChange])

  const update = (id: string, changes: Partial<TailoredGreeting>) => onChange(previous => previous?.map(item => item.job_id === id ? { ...item, ...changes } : item) || null)
  const run = async () => {
    if (disabled || controllerRef.current || !original.trim() || !jobIds.length) return
    const controller = new AbortController()
    controllerRef.current = controller
    onBusyChange(true)
    onChange(jobIds.map((id, index) => ({ job_id: id, company: '', title: `岗位 ${index + 1}`, greeting: original.trim(), status: 'pending', highlights: [] })))
    try {
      // One request at a time; a rate limit never triggers parallel retries.
      for (let index = 0; index < jobIds.length; index++) {
        if (controller.signal.aborted) break
        setProgress(`正在优化 ${index + 1}/${jobIds.length}`)
        const id = jobIds[index]
        try {
          const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/greeting-optimize`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ original: original.trim() }), signal: controller.signal,
          })
          const data = await response.json()
          if (controller.signal.aborted || controllerRef.current !== controller) break
          const metadata = { ...(data.company ? { company: String(data.company) } : {}), ...(data.title ? { title: String(data.title) } : {}) }
          if (!response.ok) {
            update(id, { ...metadata, status: 'error', error: data.error || '优化失败，请使用原文或稍后重试' })
            if (response.status === 429 || response.status >= 500) break
            continue
          }
          if (typeof data.greeting !== 'string' || !data.greeting.trim() || data.greeting.length > 300) throw new Error('未返回有效的优化正文')
          update(id, { ...metadata, greeting: data.greeting, highlights: Array.isArray(data.highlights) ? data.highlights : [], status: 'ready', error: '' })
        } catch (cause) {
          if (controller.signal.aborted) break
          update(id, { status: 'error', error: cause instanceof Error ? cause.message : '优化失败，请稍后重试' })
          break
        }
      }
    } finally {
      if (controllerRef.current === controller) {
        onChange(previous => previous?.map(item => item.status === 'pending' ? { ...item, status: 'error', error: '本轮尚未优化，请重试或明确选择使用原文' } : item) || null)
        controllerRef.current = null
        setProgress('')
        onBusyChange(false)
      }
    }
  }
  return <section aria-label="按岗位 JD 优化" className="mt-3 rounded-xl border border-card-border bg-surface p-3">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={disabled || Boolean(progress) || !original.trim() || !jobIds.length} onClick={() => void run()}>{drafts ? '重新按 JD 优化' : '按所选岗位 JD 优化'}</Button>
      {progress ? <><span role="status" className="text-xs text-primary">{progress}</span><Button type="button" size="sm" variant="ghost" onClick={() => controllerRef.current?.abort()}>停止优化</Button></>
        : drafts && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>全部改用原文</Button>}
    </div>
    <p className="mt-2 text-xs leading-5 text-muted">使用已配置的 AI，结合你的原文、简历和每个岗位 JD 突出相关优势。{manual ? '先预览、可修改，复制后由你自行投递；图片沿用当前搭配。' : '先预览、可修改，确认发送后才投递；图片沿用当前搭配。'}</p>
    {drafts && <div className="mt-3 max-h-[45vh] space-y-3 overflow-y-auto pr-1">
      {drafts.map(item => <article key={item.job_id} className="rounded-xl border border-card-border bg-card p-3">
        <h4 className="text-sm font-bold">{item.company ? `${item.company} · ` : ''}{item.title}</h4>
        {item.status === 'pending' && <p className="mt-1 text-xs text-muted">等待优化…</p>}
        {item.error && <p role="alert" className="mt-1 text-xs text-danger">{item.error}</p>}
        <textarea aria-label={`${item.company ? `${item.company} ` : ''}${item.title} 发送正文`} rows={4} maxLength={300} value={item.greeting} disabled={disabled || Boolean(progress)}
          onChange={event => update(item.job_id, { greeting: event.target.value, status: 'ready', error: '' })}
          className="mt-2 w-full rounded-lg border border-card-border bg-surface px-2 py-2 text-sm leading-6 outline-none focus:border-primary" />
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted"><button type="button" disabled={disabled || Boolean(progress)} onClick={() => update(item.job_id, { greeting: original.trim(), status: 'ready', error: '', highlights: [] })} className="text-primary disabled:opacity-50">此岗位使用原文</button><span>{item.greeting.length}/300 字</span></div>
        {item.highlights.length > 0 && <details className="mt-2 text-xs leading-5 text-muted"><summary className="cursor-pointer font-bold">生成时匹配依据</summary><ul className="mt-1 space-y-2">{item.highlights.map((point, index) => <li key={index}><p>JD：{point.jd_quote}</p><p>我的经历：{point.evidence_quote}</p><p className="text-foreground">{point.reason}</p></li>)}</ul></details>}
      </article>)}
    </div>}
  </section>
}
