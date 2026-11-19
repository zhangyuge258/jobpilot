import React, { useState, useEffect, useRef } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { X, Image as ImageIcon, Link as LinkIcon, FileText, Plus, Trash2, ArrowRight } from 'lucide-react'

interface BatchAddModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface ImageItem {
  id: string
  company_name: string
  base64: string
  media_type: string
  preview_url: string
}

export function BatchAddModal({ isOpen, onClose, onSuccess }: BatchAddModalProps) {
  const [tab, setTab] = useState<'image' | 'links' | 'text'>('image')
  const [loading, setLoading] = useState(false)

  // Tab 1: 多图连续粘贴
  const [images, setImages] = useState<ImageItem[]>([])
  const pasteAreaRef = useRef<HTMLDivElement>(null)

  // Tab 2: 批量链接
  const [batchLinksText, setBatchLinksText] = useState('')

  // Tab 3: 单公司大文本
  const [singleCompanyName, setSingleCompanyName] = useState('')
  const [singleTextContent, setSingleTextContent] = useState('')

  // 监听全窗口或粘贴区 Ctrl+V
  useEffect(() => {
    if (!isOpen) return

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue

          const reader = new FileReader()
          reader.onload = evt => {
            const result = evt.target?.result as string
            if (result) {
              const newImg: ImageItem = {
                id: Math.random().toString(36).substring(2, 9),
                company_name: `企业招聘截图 #${images.length + 1}`,
                base64: result,
                media_type: file.type || 'image/png',
                preview_url: result,
              }
              setImages(prev => [...prev, newImg])
              setTab('image') // 自动切到图片 tab
            }
          }
          reader.readAsDataURL(file)
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [isOpen, images.length])

  const handleRemoveImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }

  const handleUpdateImageName = (id: string, name: string) => {
    setImages(prev => prev.map(img => (img.id === id ? { ...img, company_name: name } : img)))
  }

  // 提交创建任务
  const handleSubmit = async () => {
    setLoading(true)
    try {
      const tasksToCreate: any[] = []

      if (tab === 'image') {
        if (images.length === 0) {
          alert('请先粘贴或上传至少一张招聘长图或表格截图')
          setLoading(false)
          return
        }
        for (const img of images) {
          tasksToCreate.push({
            company_name: img.company_name,
            source_type: 'image',
            source_input: img.base64,
            media_type: img.media_type,
          })
        }
      } else if (tab === 'links') {
        const lines = batchLinksText.split('\n').map(l => l.trim()).filter(Boolean)
        if (lines.length === 0) {
          alert('请粘贴至少一个公司名称或网址')
          setLoading(false)
          return
        }
        for (const line of lines) {
          // 匹配 URL 与企业描述
          const urlMatch = line.match(/(https?:\/\/[^\s]+)/i)
          let cname = '知名企业招聘'
          let sinput = line
          let stype: 'url' | 'text' = 'text'

          if (urlMatch) {
            stype = 'url'
            const rawUrl = urlMatch[1]
            const textWithoutUrl = line.replace(rawUrl, '').trim()
            if (textWithoutUrl) {
              const namePart = textWithoutUrl.split(/[-–—]/)[0].trim()
              cname = namePart || textWithoutUrl.slice(0, 30)
              sinput = `企业名称与业务方向：${textWithoutUrl}\n招聘官网链接：${rawUrl}`
            } else {
              try {
                cname = new URL(rawUrl).hostname.replace('www.', '')
              } catch {}
              sinput = rawUrl
            }
          } else {
            cname = line.split(/[-–—]/)[0].trim() || line.slice(0, 30)
            sinput = line
            stype = 'text'
          }

          tasksToCreate.push({
            company_name: cname,
            source_type: stype,
            source_input: sinput,
          })
        }
      } else if (tab === 'text') {
        if (!singleTextContent.trim()) {
          alert('请粘贴公告或岗位列表文本')
          setLoading(false)
          return
        }
        tasksToCreate.push({
          company_name: singleCompanyName.trim() || '目标企业招聘',
          source_type: 'text',
          source_input: singleTextContent,
        })
      }

      // 批量创建任务
      await fetch('/api/direct-select/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: tasksToCreate }),
      })

      // 重置并回调
      setImages([])
      setBatchLinksText('')
      setSingleCompanyName('')
      setSingleTextContent('')
      onSuccess()
      onClose()
    } catch (e) {
      console.error(e)
      alert('添加任务失败，请检查网络或后端状态')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="flex w-full max-w-2xl flex-col rounded-2xl bg-card border border-border/80 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-4 bg-secondary/20">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <span>批量追加网申企业（流水线并线）</span>
            </h2>
            <p className="text-xs text-muted">支持多图连贴、多链接一行一个，后台异步静默解析，不阻塞当前投递</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-secondary hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 选项卡切换 */}
        <div className="flex border-b border-border/80 bg-secondary/30 px-6 pt-3 gap-2">
          <button
            onClick={() => setTab('image')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-all ${
              tab === 'image'
                ? 'border-primary text-primary bg-card shadow-xs'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            <ImageIcon className="h-4 w-4" />
            <span>截图 / 长图连续直贴 (Ctrl+V)</span>
            {images.length > 0 && (
              <span className="rounded-full bg-primary/20 text-primary px-1.5 py-0.2 text-[10px] font-bold">
                {images.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setTab('links')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-all ${
              tab === 'links'
                ? 'border-primary text-primary bg-card shadow-xs'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            <LinkIcon className="h-4 w-4" />
            <span>批量链接 / 公司清单 (一行一个)</span>
          </button>

          <button
            onClick={() => setTab('text')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold border-b-2 transition-all ${
              tab === 'text'
                ? 'border-primary text-primary bg-card shadow-xs'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>单篇公告纯文本</span>
          </button>
        </div>

        {/* 选项卡内容区 */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {tab === 'image' && (
            <div className="space-y-4">
              {/* Ctrl+V 提示框 */}
              <div
                ref={pasteAreaRef}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-6 text-center transition-colors hover:border-primary/70"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-2">
                  <ImageIcon className="h-6 w-6" />
                </div>
                <div className="text-sm font-bold text-foreground">
                  直接在此处按 <kbd className="rounded-md bg-secondary px-2 py-1 text-xs font-mono font-bold text-primary">Ctrl + V</kbd> 粘贴截图
                </div>
                <p className="text-xs text-muted mt-1">
                  支持微信公众号岗位长图、Excel表格截图、官网推文截图（支持连续粘贴多张）
                </p>
              </div>

              {/* 已粘贴图片列表 */}
              {images.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted">已捕获 {images.length} 张截图：</div>
                  <div className="grid grid-cols-2 gap-3">
                    {images.map(img => (
                      <div
                        key={img.id}
                        className="flex items-center gap-3 rounded-xl border border-border/80 bg-secondary/30 p-2.5 relative group"
                      >
                        <img
                          src={img.preview_url}
                          alt="preview"
                          className="h-14 w-14 shrink-0 rounded-lg object-cover border border-border"
                        />
                        <div className="flex-1 min-w-0 pr-6">
                          <input
                            type="text"
                            value={img.company_name}
                            onChange={e => handleUpdateImageName(img.id, e.target.value)}
                            placeholder="填写企业名称..."
                            className="w-full bg-transparent text-xs font-bold text-foreground border-b border-transparent hover:border-border focus:border-primary focus:outline-hidden py-0.5 truncate"
                          />
                          <span className="text-[10px] text-muted">多模态 Vision 解析</span>
                        </div>
                        <button
                          onClick={() => handleRemoveImage(img.id)}
                          className="absolute right-2 top-2 p-1 text-muted hover:text-danger rounded-md hover:bg-secondary transition-colors"
                          title="删除此截图"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'links' && (
            <div className="space-y-3">
              <label className="text-xs font-semibold text-foreground">
                粘贴网址或企业名称（每行一个，系统将作为独立任务并发处理）：
              </label>
              <textarea
                rows={8}
                value={batchLinksText}
                onChange={e => setBatchLinksText(e.target.value)}
                placeholder={`示例：\n国家电网2025校招 https://zhaopin.sgcc.com.cn/...\n中国电子科技集团\n中国移动校园招聘 https://job.10086.cn/...\n华为技术2025届届届校园招聘`}
                className="w-full rounded-xl border border-border/80 bg-secondary/30 p-3 text-xs text-foreground placeholder:text-muted/60 focus:outline-hidden focus:ring-1 focus:ring-primary font-mono leading-relaxed"
              />
              <p className="text-[11px] text-muted">
                💡 技巧：可以直接复制公众号或招聘汇总里的多行链接，系统会自动识别企业名与链接。
              </p>
            </div>
          )}

          {tab === 'text' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">企业名称</label>
                <Input
                  value={singleCompanyName}
                  onChange={e => setSingleCompanyName(e.target.value)}
                  placeholder="如：中国航天科技集团"
                  className="bg-secondary/40 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">公告正文 / 岗位列表文本</label>
                <textarea
                  rows={8}
                  value={singleTextContent}
                  onChange={e => setSingleTextContent(e.target.value)}
                  placeholder="在此直接粘贴网页复制的招聘正文、岗位要求列表或大段描述..."
                  className="w-full rounded-xl border border-border/80 bg-secondary/30 p-3 text-xs text-foreground placeholder:text-muted/60 focus:outline-hidden focus:ring-1 focus:ring-primary font-mono leading-relaxed"
                />
              </div>
            </div>
          )}
        </div>

        {/* 底部提交栏 */}
        <div className="border-t border-border/80 p-4 bg-card flex items-center justify-between">
          <div className="text-xs text-muted">
            {tab === 'image' && `${images.length} 个任务准备中`}
            {tab === 'links' && `${batchLinksText.split('\n').filter(l => l.trim()).length} 行待添加`}
          </div>
          <div className="flex gap-2.5">
            <Button variant="secondary" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={loading}
              className="bg-primary text-white flex items-center gap-1.5"
            >
              <span>{loading ? '提交中...' : '启动流水线并发解析'}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
