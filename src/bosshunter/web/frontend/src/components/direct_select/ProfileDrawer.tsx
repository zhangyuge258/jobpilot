import { useState, useEffect } from 'react'
import { ProfileSetting } from './types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { X, UserCheck, Sparkles, BookOpen, AlertTriangle } from 'lucide-react'

interface ProfileDrawerProps {
  isOpen: boolean
  onClose: () => void
  onProfileUpdated?: () => void
}

export function ProfileDrawer({ isOpen, onClose, onProfileUpdated }: ProfileDrawerProps) {
  const [profile, setProfile] = useState<ProfileSetting>({
    degree_level: 2,
    degree_name: '本科',
    major_name: '计算机科学与技术',
    grad_year: '2025届',
    ignore_location: true,
    resume_mode: 'default',
    resume_text: '',
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      fetch('/api/direct-select/profile')
        .then(res => res.json())
        .then(data => {
          if (data && !data.error) {
            setProfile(data)
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [isOpen])

  const handleDegreeChange = (lvl: number, name: string) => {
    setProfile(prev => ({ ...prev, degree_level: lvl, degree_name: name }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/direct-select/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json_string(profile),
      })
      onProfileUpdated?.()
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  function json_string(obj: any) {
    return JSON.stringify(obj)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div className="flex h-full w-full max-w-lg flex-col bg-card border-l border-border/80 shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-4 bg-secondary/20">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">基准画像与硬门槛预设</h2>
              <p className="text-xs text-muted">所有岗位均以此为标准进行一票否决与壁垒打分</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-secondary hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 内容主体 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted">正在载入画像设置...</div>
          ) : (
            <>
              {/* 核心硬规则：学历一票否决 */}
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-warning font-semibold text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>第一关：最高学历硬性门槛（超标一票否决）</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  凡岗位硬性要求高于此学历（如选本科而岗位要求硕士），将直接剔除至排除区，防止浪费宝贵投递机会。
                </p>
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {[
                    { lvl: 1, name: '大专' },
                    { lvl: 2, name: '本科' },
                    { lvl: 3, name: '硕士' },
                    { lvl: 4, name: '博士' },
                  ].map(item => (
                    <button
                      key={item.lvl}
                      type="button"
                      onClick={() => handleDegreeChange(item.lvl, item.name)}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                        profile.degree_level === item.lvl
                          ? 'bg-primary text-white border-primary shadow-xs'
                          : 'bg-card border-border/80 text-foreground hover:bg-secondary/60'
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 核心加分：专业名称 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    我的专业名称（限制专业核心加分项）
                  </label>
                  <span className="text-[11px] text-primary">命中特定专业享 +25分 竞争壁垒</span>
                </div>
                <Input
                  value={profile.major_name}
                  onChange={e => setProfile(prev => ({ ...prev, major_name: e.target.value }))}
                  placeholder="如：计算机科学与技术、软件工程、电气工程..."
                  className="bg-secondary/40 text-sm"
                />
              </div>

              {/* 毕业届别与地区 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">毕业届别 / 身份</label>
                  <Input
                    value={profile.grad_year}
                    onChange={e => setProfile(prev => ({ ...prev, grad_year: e.target.value }))}
                    placeholder="如：2025届 / 应届 / 社招"
                    className="bg-secondary/40 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">弱化地区影响</label>
                  <div className="flex items-center justify-between rounded-xl border border-border/80 bg-secondary/30 p-2.5">
                    <span className="text-xs text-muted">全国均可投，不扣分</span>
                    <Switch
                      checked={profile.ignore_location}
                      onChange={(checked: boolean) => setProfile(prev => ({ ...prev, ignore_location: checked }))}
                    />
                  </div>
                </div>
              </div>

              {/* 简历双轨制模式 */}
              <div className="space-y-3 pt-2 border-t border-border/80">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-primary" />
                    简历与优势来源（双轨模式）
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setProfile(prev => ({ ...prev, resume_mode: 'default' }))}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border text-left transition-all ${
                      profile.resume_mode === 'default'
                        ? 'bg-primary/10 border-primary text-primary font-bold'
                        : 'bg-card border-border/80 text-muted hover:bg-secondary/40'
                    }`}
                  >
                    <div>1. 默认简历母版</div>
                    <div className="text-[10px] opacity-70 mt-0.5">读取 JobPilot 已配简历</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setProfile(prev => ({ ...prev, resume_mode: 'custom_text' }))}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border text-left transition-all ${
                      profile.resume_mode === 'custom_text'
                        ? 'bg-primary/10 border-primary text-primary font-bold'
                        : 'bg-card border-border/80 text-muted hover:bg-secondary/40'
                    }`}
                  >
                    <div>2. 在线编辑优势</div>
                    <div className="text-[10px] opacity-70 mt-0.5">直接键入/粘贴经历亮点</div>
                  </button>
                </div>

                {profile.resume_mode === 'custom_text' && (
                  <div className="space-y-1.5 pt-2 animate-in fade-in">
                    <label className="text-xs text-muted">键入或粘贴你的核心经历、技术栈与优势项目：</label>
                    <textarea
                      rows={6}
                      value={profile.resume_text}
                      onChange={e => setProfile(prev => ({ ...prev, resume_text: e.target.value }))}
                      placeholder="例如：\n- 掌握 Java/Spring Boot、Python 数据分析；\n- 主导过高并发电商秒杀系统设计与上线；\n- 获得省部级竞赛一等奖，有央国企数字化实习经历..."
                      className="w-full rounded-xl border border-border/80 bg-secondary/30 p-3 text-xs text-foreground placeholder:text-muted/60 focus:outline-hidden focus:ring-1 focus:ring-primary font-mono leading-relaxed resize-none"
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 底部保存栏 */}
        <div className="border-t border-border/80 p-4 bg-card flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="bg-primary text-white">
            {saving ? '保存中...' : '保存画像预设'}
          </Button>
        </div>
      </div>
    </div>
  )
}
