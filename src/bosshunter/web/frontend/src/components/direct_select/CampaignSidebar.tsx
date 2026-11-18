import React from 'react'
import { CompanyCampaign } from './types'
import { Plus, Trash2, Globe, Image as ImageIcon, FileText, CheckCircle2, Clock, AlertCircle } from 'lucide-react'

interface CampaignSidebarProps {
  campaigns: CompanyCampaign[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onOpenBatchAdd: () => void
}

export function CampaignSidebar({
  campaigns,
  activeId,
  onSelect,
  onDelete,
  onOpenBatchAdd,
}: CampaignSidebarProps) {
  const getSourceIcon = (sourceType: string) => {
    if (sourceType === 'image') return <ImageIcon className="h-3.5 w-3.5 text-muted" />
    if (sourceType === 'url') return <Globe className="h-3.5 w-3.5 text-muted" />
    return <FileText className="h-3.5 w-3.5 text-muted" />
  }

  const getStatusBadge = (c: CompanyCampaign) => {
    if (c.status === 'queued') {
      return (
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <Clock className="h-3 w-3 animate-spin" />
          <span>排队中</span>
        </span>
      )
    }
    if (c.status === 'parsing' || c.status === 'matching') {
      return (
        <span className="flex items-center gap-1 text-[11px] text-primary font-bold animate-pulse">
          <span className="h-2 w-2 rounded-full bg-primary animate-ping" />
          <span>正在智能解析...</span>
        </span>
      )
    }
    if (c.status === 'failed') {
      return (
        <span className="flex items-center gap-1 text-[11px] text-danger font-medium">
          <AlertCircle className="h-3 w-3" />
          <span>解析失败</span>
        </span>
      )
    }
    return (
      <span className="flex items-center gap-1 text-[11px] text-success font-medium">
        <CheckCircle2 className="h-3 w-3" />
        <span>已就绪 ({c.total_jobs}岗)</span>
      </span>
    )
  }

  return (
    <aside className="w-80 shrink-0 border-r border-border/80 bg-card/60 flex flex-col h-full overflow-hidden">
      {/* 头部操作区 */}
      <div className="p-4 border-b border-border/80 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">企业网申流水线</h2>
          <span className="text-xs text-muted font-mono">{campaigns.length} 家企业</span>
        </div>
        <button
          onClick={onOpenBatchAdd}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-primary/90 transition-all active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          <span>添加企业 / 批量图片直贴</span>
        </button>
      </div>

      {/* 企业任务列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {campaigns.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted px-4 space-y-2">
            <p>流水线目前为空</p>
            <p className="text-[11px] leading-relaxed">
              点击上方按钮，粘贴招聘链接、公司名称或直接按 <kbd className="px-1 py-0.5 rounded bg-secondary font-mono">Ctrl+V</kbd> 贴入多张岗位截图
            </p>
          </div>
        ) : (
          campaigns.map(c => {
            const isActive = c.id === activeId
            const isFinished = c.status === 'ready'
            const appliedRatio = c.total_jobs > 0 ? (c.applied_jobs / Math.min(3, c.eligible_jobs || 1)) * 100 : 0

            return (
              <div
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`group relative rounded-xl border p-3 cursor-pointer transition-all ${
                  isActive
                    ? 'bg-primary/10 border-primary text-foreground shadow-xs'
                    : 'bg-card border-border/70 hover:border-border hover:bg-secondary/40'
                }`}
              >
                {/* 标题与删除 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {getSourceIcon(c.source_type)}
                    <h3 className="text-xs font-bold truncate text-foreground" title={c.company_name}>
                      {c.company_name}
                    </h3>
                  </div>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      if (confirm(`确定删除企业【${c.company_name}】及其解析结果吗？`)) {
                        onDelete(c.id)
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-danger rounded-md hover:bg-secondary transition-all"
                    title="删除此企业"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* 状态与进度 */}
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  {getStatusBadge(c)}
                  {isFinished && c.eligible_jobs > 0 && (
                    <span className="font-semibold text-primary font-mono text-[10px]">
                      Top 10 已筛
                    </span>
                  )}
                </div>

                {/* 投递进度条 */}
                {isFinished && c.eligible_jobs > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted">
                    <span>投递进度：</span>
                    <span className="font-bold text-foreground">
                      已投 {c.applied_jobs} / {Math.min(3, c.eligible_jobs)}
                    </span>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
