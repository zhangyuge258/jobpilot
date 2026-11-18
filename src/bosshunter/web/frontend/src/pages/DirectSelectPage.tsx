import React, { useState, useEffect, useRef } from 'react'
import { CompanyCampaign, ProfileSetting } from '../components/direct_select/types'
import { CampaignSidebar } from '../components/direct_select/CampaignSidebar'
import { BatchAddModal } from '../components/direct_select/BatchAddModal'
import { ProfileDrawer } from '../components/direct_select/ProfileDrawer'
import { Top10Cards } from '../components/direct_select/Top10Cards'
import { RemainingJobsDrawer } from '../components/direct_select/RemainingJobsDrawer'
import { Button } from '../components/ui/button'
import {
  Sparkles,
  SlidersHorizontal,
  RefreshCw,
  ExternalLink,
  Target,
  FileCheck2,
  AlertCircle,
  Clock,
  Layers,
} from 'lucide-react'

export default function DirectSelectPage() {
  const [campaigns, setCampaigns] = useState<CompanyCampaign[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeCampaign, setActiveCampaign] = useState<CompanyCampaign | null>(null)
  const [profile, setProfile] = useState<ProfileSetting | null>(null)

  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false)
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false)
  const [reEvaluating, setReEvaluating] = useState(false)

  // 1. 获取画像
  const loadProfile = () => {
    fetch('/api/direct-select/profile')
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) setProfile(data)
      })
      .catch(console.error)
  }

  // 2. 获取流水线列表
  const loadCampaigns = async () => {
    try {
      const res = await fetch('/api/direct-select/campaigns')
      const data: CompanyCampaign[] = await res.json()
      if (Array.isArray(data)) {
        setCampaigns(data)
        // 若没有激活项，默认激活第一个
        if (!activeId && data.length > 0) {
          setActiveId(data[0].id)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  // 3. 获取当前激活战役详情
  const loadActiveCampaignDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/direct-select/campaigns/${id}`)
      const data = await res.json()
      if (data && !data.error) {
        setActiveCampaign(data)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    loadProfile()
    loadCampaigns()
  }, [])

  useEffect(() => {
    if (activeId) {
      loadActiveCampaignDetail(activeId)
    } else {
      setActiveCampaign(null)
    }
  }, [activeId])

  // 4. 后台任务轮询检测（若有正在跑的任务，每3秒自动拉取）
  useEffect(() => {
    const hasRunningTask = campaigns.some(
      c => c.status === 'queued' || c.status === 'parsing' || c.status === 'matching'
    )
    if (!hasRunningTask) return

    const interval = setInterval(() => {
      loadCampaigns()
      if (activeId) {
        loadActiveCampaignDetail(activeId)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [campaigns, activeId])

  // 操作：删除
  const handleDeleteCampaign = async (id: string) => {
    try {
      await fetch(`/api/direct-select/campaigns/${id}`, { method: 'DELETE' })
      const updated = campaigns.filter(c => c.id !== id)
      setCampaigns(updated)
      if (activeId === id) {
        setActiveId(updated.length > 0 ? updated[0].id : null)
      }
    } catch (e) {
      console.error(e)
    }
  }

  // 操作：更新岗位投递状态
  const handleUpdateJobStatus = async (jobId: string, status: 'applied' | 'unapplied') => {
    try {
      await fetch(`/api/direct-select/jobs/${jobId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (activeId) {
        loadActiveCampaignDetail(activeId)
        loadCampaigns()
      }
    } catch (e) {
      console.error(e)
    }
  }

  // 操作：强制捞回后刷新
  const handleJobRestored = () => {
    if (activeId) {
      loadActiveCampaignDetail(activeId)
      loadCampaigns()
    }
  }

  // 操作：基于最新画像重新评估
  const handleReEvaluate = async () => {
    if (!activeId) return
    setReEvaluating(true)
    try {
      await fetch(`/api/direct-select/campaigns/${activeId}/re-evaluate`, { method: 'POST' })
      await loadActiveCampaignDetail(activeId)
      await loadCampaigns()
    } catch (e) {
      console.error(e)
    } finally {
      setReEvaluating(false)
    }
  }

  // 岗位拆解：Top 10、剩余候选与排除池
  const eligibleJobs = activeCampaign?.jobs?.filter(j => !j.is_excluded) || []
  const excludedJobs = activeCampaign?.jobs?.filter(j => j.is_excluded) || []
  const top10Jobs = eligibleJobs.slice(0, 10)
  const remainingEligible = eligibleJobs.slice(10)

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* 左侧：企业任务队列流水线 */}
      <CampaignSidebar
        campaigns={campaigns}
        activeId={activeId}
        onSelect={id => setActiveId(id)}
        onDelete={handleDeleteCampaign}
        onOpenBatchAdd={() => setIsBatchModalOpen(true)}
      />

      {/* 右侧：主决策与投递工作台 */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-y-auto">
        {/* 顶部企业状态与画像基准栏 */}
        <header className="shrink-0 border-b border-border/80 bg-card/90 px-6 py-4 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* 当前企业信息 */}
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Target className="h-5 w-5" />
                </div>
                <h1 className="text-lg font-bold text-foreground">
                  {activeCampaign ? activeCampaign.company_name : '央国企 / 名企直投优选台'}
                </h1>
                {activeCampaign && (
                  <span className="rounded-lg bg-secondary px-2 py-0.5 text-xs text-muted font-mono">
                    {activeCampaign.status_message}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mt-1">
                {activeCampaign
                  ? `共解析 ${activeCampaign.total_jobs} 岗，经学历硬筛保留 ${eligibleJobs.length} 岗，排除 ${excludedJobs.length} 岗`
                  : '添加招聘链接或按 Ctrl+V 贴入推文长图，AI 将全量挖掘冷门优质岗并选出 Top 10'}
              </p>
            </div>

            {/* 右侧控制栏：基准画像卡片 */}
            <div className="flex items-center gap-2.5">
              {profile && (
                <div
                  onClick={() => setIsProfileDrawerOpen(true)}
                  className="cursor-pointer flex items-center gap-2 rounded-xl border border-border/80 bg-secondary/40 px-3 py-1.5 text-xs hover:border-primary/50 transition-colors"
                >
                  <span className="text-muted font-medium">当前基准：</span>
                  <span className="font-bold text-foreground">{profile.degree_name}</span>
                  <span className="text-muted">•</span>
                  <span className="font-bold text-primary">{profile.major_name}</span>
                  <span className="text-muted">•</span>
                  <span className="text-[11px] text-muted">地区弱化: 开启</span>
                  <SlidersHorizontal className="h-3.5 w-3.5 text-muted ml-1" />
                </div>
              )}

              {activeCampaign && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleReEvaluate}
                  disabled={reEvaluating}
                  className="h-8.5 text-xs gap-1"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${reEvaluating ? 'animate-spin' : ''}`} />
                  <span>重算排名</span>
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* 内容展示区 */}
        <div className="flex-1 p-6 space-y-6">
          {!activeCampaign ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
                <Layers className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-foreground">开始你的企业网申流水线</h3>
                <p className="text-xs text-muted max-w-md">
                  可以同时批量丢入多个企业。直接按 Ctrl+V 粘贴公众号岗位长图，或输入官网招聘链接。
                  系统将在后台并发解析，不耽误你现在的投递节奏。
                </p>
              </div>
              <Button onClick={() => setIsBatchModalOpen(true)} className="bg-primary text-white font-bold text-xs gap-2">
                <span>立即批量添加企业</span>
              </Button>
            </div>
          ) : activeCampaign.status === 'queued' ||
            activeCampaign.status === 'parsing' ||
            activeCampaign.status === 'matching' ? (
            <div className="rounded-2xl border border-border/80 bg-card p-12 text-center space-y-3">
              <div className="flex justify-center">
                <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
              <h3 className="text-sm font-bold text-foreground">正在流水线智能分析中...</h3>
              <p className="text-xs text-muted">
                {activeCampaign.status_message || '后台多模态解析与多维打分中，你可以切换去投递其他已就绪企业'}
              </p>
            </div>
          ) : (
            <>
              {/* Top 10 核心卡片列表 */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-bold text-foreground">
                      ★ Top 10 最适投递岗位梯度推荐（学历达标 & 职能优选）
                    </h2>
                  </div>
                  <span className="text-xs text-muted">按职能契合度与专业壁垒排序 · 已淡化地区权重</span>
                </div>

                <Top10Cards jobs={top10Jobs} onUpdateStatus={handleUpdateJobStatus} />
              </div>

              {/* 满足用户要求的：剩余岗位下拉抽屉 / 人工防误筛复核 */}
              <RemainingJobsDrawer
                campaignId={activeCampaign.id}
                eligibleRemainingJobs={remainingEligible}
                excludedJobs={excludedJobs}
                onJobRestored={handleJobRestored}
                onUpdateStatus={handleUpdateJobStatus}
              />
            </>
          )}
        </div>
      </main>

      {/* 弹窗 1：批量追加企业 / 连贴图片 */}
      <BatchAddModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        onSuccess={() => {
          loadCampaigns()
        }}
      />

      {/* 弹窗 2：基准画像微调抽屉 */}
      <ProfileDrawer
        isOpen={isProfileDrawerOpen}
        onClose={() => setIsProfileDrawerOpen(false)}
        onProfileUpdated={() => {
          loadProfile()
          if (activeId) handleReEvaluate()
        }}
      />
    </div>
  )
}
