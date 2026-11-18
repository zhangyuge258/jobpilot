import React, { useState } from 'react'
import { JobItem } from './types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ChevronDown, ChevronUp, Search, ShieldAlert, Sparkles, CheckCircle, RefreshCw, Undo2 } from 'lucide-react'

interface RemainingJobsDrawerProps {
  campaignId: string
  eligibleRemainingJobs: JobItem[]
  excludedJobs: JobItem[]
  onJobRestored: () => void
  onUpdateStatus: (jobId: string, status: 'applied' | 'unapplied') => void
}

export function RemainingJobsDrawer({
  campaignId,
  eligibleRemainingJobs,
  excludedJobs,
  onJobRestored,
  onUpdateStatus,
}: RemainingJobsDrawerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'eligible' | 'excluded'>('eligible')
  const [searchQuery, setSearchQuery] = useState('')
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const totalRemaining = eligibleRemainingJobs.length + excludedJobs.length
  if (totalRemaining === 0) return null

  // 搜索过滤
  const filteredEligible = eligibleRemainingJobs.filter(
    j =>
      j.job_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.major_req.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredExcluded = excludedJobs.filter(
    j =>
      j.job_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (j.exclude_reason && j.exclude_reason.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  // 人工强制捞回
  const handleRestore = async (jobId: string) => {
    setRestoringId(jobId)
    try {
      const res = await fetch(`/api/direct-select/campaigns/${campaignId}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      })
      if (res.ok) {
        onJobRestored()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card overflow-hidden shadow-xs mt-6 transition-all">
      {/* 折叠/下拉触发条 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
          <div>
            <div className="text-sm font-bold text-foreground flex items-center gap-2">
              <span>人工二次复核与防误筛下拉抽屉</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted">
                剩余 {totalRemaining} 个岗位
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5">
              含 {eligibleRemainingJobs.length} 个第11+名候选岗、{excludedJobs.length} 个被硬条件排除岗（支持一键强制捞回复活）
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {excludedJobs.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-warning/10 text-warning px-2.5 py-1 text-xs font-semibold">
              <ShieldAlert className="h-3.5 w-3.5" />
              {excludedJobs.length} 个岗位待复核
            </span>
          )}
          <span className="text-xs font-medium text-primary">
            {isOpen ? '收起列表' : '展开查看'}
          </span>
        </div>
      </button>

      {/* 展开内容 */}
      {isOpen && (
        <div className="p-6 border-t border-border/80 space-y-4 animate-in fade-in duration-150">
          {/* 工具栏：搜索与切换标签 */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex gap-2 bg-secondary/40 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('eligible')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'eligible'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                第 11+ 名合规候选岗 ({eligibleRemainingJobs.length})
              </button>
              <button
                onClick={() => setActiveTab('excluded')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'excluded'
                    ? 'bg-warning/15 text-warning font-bold shadow-xs'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                硬门槛已排除岗 ({excludedJobs.length})
              </button>
            </div>

            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索岗位/部门/专业..."
                className="pl-8 text-xs bg-secondary/30 h-8.5 rounded-xl"
              />
            </div>
          </div>

          {/* Tab 1: 排名 11+ 合规候选岗位 */}
          {activeTab === 'eligible' && (
            <div className="overflow-x-auto rounded-xl border border-border/80">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/40 text-muted border-b border-border/80 font-medium">
                  <tr>
                    <th className="py-2.5 px-3 w-16">排名</th>
                    <th className="py-2.5 px-3">岗位名称</th>
                    <th className="py-2.5 px-3">部门/分公司</th>
                    <th className="py-2.5 px-3">专业要求</th>
                    <th className="py-2.5 px-3">人数</th>
                    <th className="py-2.5 px-3">匹配分</th>
                    <th className="py-2.5 px-3 text-right">投递标记</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredEligible.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted">
                        没有符合条件的候选岗位
                      </td>
                    </tr>
                  ) : (
                    filteredEligible.map(job => (
                      <tr key={job.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-muted">#{job.rank}</td>
                        <td className="py-2.5 px-3 font-semibold text-foreground">
                          {job.job_title}
                          {job.major_bonus_tag && (
                            <span className="ml-2 inline-block rounded-md bg-primary/10 text-primary px-1.5 py-0.2 text-[10px] font-normal">
                              壁垒
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-muted">{job.department || '-'}</td>
                        <td className="py-2.5 px-3 text-muted max-w-[200px] truncate" title={job.major_req}>
                          {job.major_req}
                        </td>
                        <td className="py-2.5 px-3 text-muted">{job.headcount}</td>
                        <td className="py-2.5 px-3 font-bold text-primary">{job.score}分</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() =>
                              onUpdateStatus(job.id, job.status === 'applied' ? 'unapplied' : 'applied')
                            }
                            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                              job.status === 'applied'
                                ? 'bg-success/15 text-success font-bold'
                                : 'bg-secondary text-muted hover:text-foreground'
                            }`}
                          >
                            {job.status === 'applied' ? '✓ 已网申' : '标记已投'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: 硬门槛已排除岗 (防误筛核心区) */}
          {activeTab === 'excluded' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-warning/5 border border-warning/20 p-3 text-xs text-muted flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-foreground">防误筛提示：</span>
                  这些岗位因学历等预设规则被系统自动排除。如果你有相关交叉学科经历，或岗位虽标硕博但招不满本科可投，点击
                  <span className="text-primary font-bold">【强制捞回】</span>即可立即将其纳入正常打分并排进 Top 列表！
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border/80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/40 text-muted border-b border-border/80 font-medium">
                    <tr>
                      <th className="py-2.5 px-3">岗位名称</th>
                      <th className="py-2.5 px-3">部门</th>
                      <th className="py-2.5 px-3">学历要求</th>
                      <th className="py-2.5 px-3">排除原因</th>
                      <th className="py-2.5 px-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredExcluded.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted">
                          没有被排除的岗位
                        </td>
                      </tr>
                    ) : (
                      filteredExcluded.map(job => (
                        <tr key={job.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-foreground">{job.job_title}</td>
                          <td className="py-2.5 px-3 text-muted">{job.department || '-'}</td>
                          <td className="py-2.5 px-3 font-semibold text-warning">{job.degree_req}</td>
                          <td className="py-2.5 px-3 text-muted text-warning/90">{job.exclude_reason}</td>
                          <td className="py-2.5 px-3 text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={restoringId === job.id}
                              onClick={() => handleRestore(job.id)}
                              className="h-7 text-xs border-primary/40 text-primary hover:bg-primary hover:text-white"
                            >
                              <Undo2 className="h-3 w-3 mr-1" />
                              {restoringId === job.id ? '捞回中...' : '强制捞回 (复活)'}
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
