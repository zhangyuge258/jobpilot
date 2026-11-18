import React, { useState, useRef, useEffect } from 'react'
import { Building2, AlertTriangle, ChevronRight, X, Clock, UserCheck } from 'lucide-react'
import type { Job, CompanyAppliedStats } from '@/hooks/useDashboard'

export function resolveCompanyAppliedStats(job: Job, allKnownJobs?: Job[]): CompanyAppliedStats {
  if (job.company_applied_stats && typeof job.company_applied_stats.has_applied === 'boolean') {
    return job.company_applied_stats
  }

  // 客户端优雅兜底运算
  if (!allKnownJobs || !job.company) {
    return { has_applied: false, count: 0, jobs: [], same_hr: false }
  }

  const comp = job.company.trim().toLowerCase()
  const sentStatuses = new Set(['sent', 'replied', 'resume_sent', 'needs_resume', 'follow_up_sent'])
  const matched = allKnownJobs.filter(
    other =>
      other.id !== job.id &&
      (other.company || '').trim().toLowerCase() === comp &&
      sentStatuses.has(other.status)
  )

  const currHr = (job.hr_name || '').trim()
  const sameHr = Boolean(currHr && matched.some(m => (m.hr_name || '').trim() === currHr))

  return {
    has_applied: matched.length > 0,
    count: matched.length,
    jobs: matched.map(m => ({
      id: m.id,
      title: m.title,
      hr_name: m.hr_name,
      hr_title: m.hr_title,
      status: m.status,
      created_at: m.created_at,
    })),
    same_hr: sameHr,
  }
}

export interface CompanyAppliedBadgeProps {
  job: Job
  allKnownJobs?: Job[]
  size?: 'sm' | 'md'
  className?: string
}

export function CompanyAppliedBadge({
  job,
  allKnownJobs,
  size = 'md',
  className = '',
}: CompanyAppliedBadgeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const stats = resolveCompanyAppliedStats(job, allKnownJobs)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [isOpen])

  if (!stats.has_applied || stats.count === 0) {
    return null
  }

  const isSameHr = stats.same_hr

  return (
    <div className={`relative inline-flex items-center ${className}`} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        title={isSameHr ? '注意：该公司投递过同一位 HR' : `该公司已有 ${stats.count} 个已投递岗位`}
        className={`group inline-flex items-center gap-1 rounded-full border transition-all duration-200 hover:scale-[1.02] active:scale-95 ${
          size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs font-bold'
        } ${
          isSameHr
            ? 'border-amber-300 bg-amber-500/15 text-amber-800 shadow-sm shadow-amber-500/10 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-200'
            : 'border-purple-200 bg-purple-500/15 text-purple-700 shadow-sm shadow-purple-500/10 dark:border-purple-800 dark:bg-purple-950/70 dark:text-purple-300'
        }`}
      >
        {isSameHr ? (
          <AlertTriangle className={size === 'sm' ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5 shrink-0 animate-pulse'} />
        ) : (
          <Building2 className={size === 'sm' ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5 shrink-0'} />
        )}
        <span>
          {isSameHr ? '同HR已投' : '同司已投'} {stats.count > 1 ? `(${stats.count})` : ''}
        </span>
        <span className="opacity-60 group-hover:opacity-100">▾</span>
      </button>

      {/* Popover Details Modal */}
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-50 mt-1.5 w-72 sm:w-80 rounded-2xl border border-card-border bg-card p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-start justify-between border-b border-card-border/60 pb-2.5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-black text-foreground">
                <Building2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span className="truncate max-w-[180px]" title={job.company}>
                  {job.company}
                </span>
                <span className="rounded bg-purple-500/10 px-1 py-0.2 text-[9px] font-bold text-purple-700 dark:text-purple-300">
                  企业投递记录
                </span>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-muted">
                已有 <span className="text-primary font-bold">{stats.count}</span> 个历史投递岗位
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1 text-muted hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* HR Warning Banner */}
          {isSameHr ? (
            <div className="mt-2.5 rounded-xl border border-amber-300/80 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:border-amber-700/80 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span>同一招聘者警示</span>
              </div>
              <p className="mt-1 leading-relaxed opacity-90">
                本岗位与已投岗位均由 <strong className="font-black underline">{job.hr_name}</strong> 负责，请注意沟通连贯性与防海投风险。
              </p>
            </div>
          ) : (
            <div className="mt-2.5 rounded-xl border border-purple-200/80 bg-purple-500/10 p-2 text-[11px] text-purple-800 dark:border-purple-800/80 dark:text-purple-200">
              <p className="leading-relaxed">
                跨部门/不同招聘者业务线，未与本岗位直接冲突，可放心独立评估。
              </p>
            </div>
          )}

          {/* History Jobs List */}
          <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
            {stats.jobs.map((item, idx) => {
              const itemSameHr = Boolean(job.hr_name && item.hr_name === job.hr_name)
              return (
                <div
                  key={item.id || idx}
                  className="rounded-xl border border-card-border/80 bg-secondary/30 p-2.5 transition-colors hover:bg-secondary/60"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <h5 className="truncate text-xs font-bold text-foreground" title={item.title}>
                      {item.title}
                    </h5>
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                      已投递
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted">
                    {item.hr_name && (
                      <span
                        className={`inline-flex items-center gap-0.5 ${
                          itemSameHr ? 'font-bold text-amber-700 dark:text-amber-300' : ''
                        }`}
                      >
                        <UserCheck className="h-3 w-3 shrink-0" />
                        {item.hr_name} {item.hr_title ? `(${item.hr_title})` : ''}
                        {itemSameHr && <span className="text-[9px]">(同HR)</span>}
                      </span>
                    )}
                    {item.created_at && (
                      <span className="inline-flex items-center gap-0.5 opacity-80">
                        <Clock className="h-3 w-3 shrink-0" />
                        {item.created_at.slice(0, 10)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 border-t border-card-border/60 pt-2 text-center text-[10px] text-muted">
            💡 本岗位仍保持待投递状态，不改变其所属库分类
          </div>
        </div>
      )}
    </div>
  )
}
