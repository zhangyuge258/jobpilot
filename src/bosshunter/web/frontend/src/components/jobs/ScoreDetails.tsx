import { useEffect, useState } from 'react'

interface ScoreTrace {
  role_summary: string
  final_score: number
  components: Record<string, { score: number; max_score: number; evidence: string; label?: string }>
  summary_reason: string
  hard_gaps: string[]
  caps: string[]
  missing: string
}

const labels: Record<string, string> = {
  core_duties: '核心职责', transferable_evidence: '可迁移经验', hard_requirements: '硬性要求',
  tools_industry: '工具与行业', practical_fit: '现实匹配',
}

export function ScoreDetails({ jobId, score, reason }: { jobId: string; score: number; reason: string }) {
  const [trace, setTrace] = useState<ScoreTrace | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setTrace(null)
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/score-trace`, { cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted) setTrace(data?.state === 'available' ? data.trace : null) })
      .catch(() => { /* Legacy scores still show their complete saved explanation below. */ })
    return () => controller.abort()
  }, [jobId, score, reason])

  return <div className="rounded-2xl border border-card-border bg-card p-4">
    <p className="mb-2 text-xs font-black text-primary">评分细则</p>
    {trace ? <div className="space-y-2 text-xs leading-5">
      <p className="font-bold">{trace.final_score} 分 · {trace.role_summary}</p>
      {Object.entries(trace.components).map(([key, component]) => <div key={key}>
        <p className="font-bold">{component.label || labels[key] || key}：{component.score} / {component.max_score}</p>
        <p className="whitespace-pre-wrap text-muted">{component.evidence}</p>
      </div>)}
      <p className="whitespace-pre-wrap">{trace.summary_reason}</p>
      {trace.hard_gaps?.length > 0 && <p>硬性缺口：{trace.hard_gaps.join('；')}</p>}
      {trace.missing && <p>待核实：{trace.missing}</p>}
      {reason && <details><summary className="cursor-pointer font-bold">完整评分说明</summary><p className="mt-1 whitespace-pre-wrap text-muted">{reason}</p></details>}
    </div> : <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{reason || '尚无评分结果'}</p>}
  </div>
}
