import React, { useState } from 'react'
import { JobItem } from './types'
import { Button } from '../ui/button'
import {
  ExternalLink,
  CheckCircle,
  Copy,
  Sparkles,
  AlertCircle,
  MapPin,
  Users,
  Briefcase,
  Award,
  Check,
} from 'lucide-react'

interface Top10CardsProps {
  jobs: JobItem[]
  onUpdateStatus: (jobId: string, status: 'applied' | 'unapplied') => void
}

export function Top10Cards({ jobs, onUpdateStatus }: Top10CardsProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopyKeywords = (job: JobItem) => {
    const text = job.suggested_keywords.join('、') || job.job_title
    navigator.clipboard.writeText(text)
    setCopiedId(job.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <span className="flex items-center gap-1 rounded-xl bg-amber-500/15 text-amber-500 border border-amber-500/30 px-2.5 py-1 text-xs font-black shadow-xs">
          <Award className="h-3.5 w-3.5 fill-amber-500/20" />
          Top 1
        </span>
      )
    }
    if (rank === 2) {
      return (
        <span className="flex items-center gap-1 rounded-xl bg-slate-400/15 text-slate-300 border border-slate-400/30 px-2.5 py-1 text-xs font-black shadow-xs">
          <Award className="h-3.5 w-3.5" />
          Top 2
        </span>
      )
    }
    if (rank === 3) {
      return (
        <span className="flex items-center gap-1 rounded-xl bg-amber-700/15 text-amber-600 border border-amber-700/30 px-2.5 py-1 text-xs font-black shadow-xs">
          <Award className="h-3.5 w-3.5" />
          Top 3
        </span>
      )
    }
    return (
      <span className="rounded-xl bg-secondary/80 text-muted px-2.5 py-1 text-xs font-bold font-mono">
        #{rank}
      </span>
    )
  }

  const getTierBadge = (tier: string) => {
    if (tier === 'sprint') {
      return (
        <span className="rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 text-[11px] font-semibold">
          冲刺志愿
        </span>
      )
    }
    if (tier === 'safety') {
      return (
        <span className="rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold">
          稳健保底
        </span>
      )
    }
    return (
      <span className="rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[11px] font-semibold">
        主力对口
      </span>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 p-12 text-center text-muted">
        暂无符合学历要求的推荐岗位，可展开下方“防误筛抽屉”查看或捞回。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {jobs.map(job => {
        const isApplied = job.status === 'applied'

        return (
          <div
            key={job.id}
            className={`rounded-2xl border transition-all p-5 relative overflow-hidden ${
              isApplied
                ? 'bg-secondary/20 border-border/60 opacity-80'
                : job.rank <= 3
                ? 'bg-gradient-to-r from-card to-card/90 border-primary/40 shadow-sm hover:border-primary/70'
                : 'bg-card border-border/80 hover:border-border hover:shadow-xs'
            }`}
          >
            {/* 已投递角标 */}
            {isApplied && (
              <div className="absolute right-0 top-0 bg-success/20 text-success text-[11px] font-bold px-3 py-1 rounded-bl-xl border-l border-b border-success/30 flex items-center gap-1">
                <Check className="h-3 w-3" />
                已网申投递
              </div>
            )}

            {/* 卡片头部 */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {getRankBadge(job.rank)}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-foreground hover:text-primary transition-colors">
                      {job.job_title}
                    </h3>
                    {getTierBadge(job.volunteer_tier)}
                    {job.major_bonus_tag && (
                      <span className="rounded-md bg-amber-500/15 text-amber-500 border border-amber-500/25 px-2 py-0.5 text-[11px] font-bold flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        {job.major_bonus_tag}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-1 flex items-center gap-3 flex-wrap">
                    <span>{job.department || '总部/直属'}</span>
                    <span>•</span>
                    <span className="text-foreground/90 font-medium">{job.degree_req}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3 text-muted" />
                      招 {job.headcount}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-muted" />
                      {job.location} (弱化地区)
                    </span>
                    <span>•</span>
                    <span className="rounded-md bg-secondary px-1.5 py-0.2 text-[10px] text-muted">
                      {job.employment_type}
                    </span>
                  </div>
                </div>
              </div>

              {/* 右侧匹配分 */}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-2xl font-black tracking-tight text-primary">{job.score}分</div>
                  <div className="text-[10px] font-semibold text-muted uppercase">综合契合度</div>
                </div>
              </div>
            </div>

            {/* 契合点与诊断 */}
            <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 契合优势 */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-success"></span>
                  <span>核心契合点（投递/面试抓手）</span>
                </div>
                <ul className="text-xs text-muted space-y-1 pl-3">
                  {job.fit_reasons && job.fit_reasons.length > 0 ? (
                    job.fit_reasons.map((r, i) => (
                      <li key={i} className="list-disc list-outside leading-relaxed text-foreground/85">
                        {r}
                      </li>
                    ))
                  ) : (
                    <li className="text-muted">职责与你的专业技能高度贴合</li>
                  )}
                </ul>
              </div>

              {/* 潜在短板/面试预警 */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning"></span>
                  <span>潜在短板 / 面试建议</span>
                </div>
                <ul className="text-xs text-muted space-y-1 pl-3">
                  {job.shortcomings && job.shortcomings.length > 0 ? (
                    job.shortcomings.map((s, i) => (
                      <li key={i} className="list-disc list-outside leading-relaxed text-warning/90">
                        {s}
                      </li>
                    ))
                  ) : (
                    <li className="text-muted">暂无显著短板，注意面试表现</li>
                  )}
                </ul>
              </div>
            </div>

            {/* 底部操作与微调关键词 */}
            <div className="mt-4 pt-3 border-t border-border/40 flex flex-wrap items-center justify-between gap-3">
              {/* 建议微调关键词 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-muted">建议微调关键词：</span>
                {job.suggested_keywords && job.suggested_keywords.length > 0 ? (
                  job.suggested_keywords.map((kw, i) => (
                    <span
                      key={i}
                      className="rounded-md bg-secondary/80 text-foreground px-2 py-0.5 text-[11px] font-mono font-medium"
                    >
                      {kw}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-muted">与母版简历保持一致</span>
                )}
              </div>

              {/* 投递按钮组 */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleCopyKeywords(job)}
                  className="h-8 text-xs gap-1 text-muted hover:text-foreground"
                >
                  {copiedId === job.id ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedId === job.id ? '已复制' : '复制关键词'}</span>
                </Button>

                {job.url && (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-secondary/50 text-xs font-semibold text-foreground hover:bg-secondary hover:text-primary transition-colors"
                  >
                    <span>直达网申官网</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}

                <Button
                  size="sm"
                  onClick={() => onUpdateStatus(job.id, isApplied ? 'unapplied' : 'applied')}
                  className={`h-8 text-xs font-bold gap-1 transition-all ${
                    isApplied
                      ? 'bg-secondary text-muted hover:text-foreground'
                      : 'bg-primary text-white hover:bg-primary/90'
                  }`}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>{isApplied ? '撤销已投标记' : '标记为已投递'}</span>
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
