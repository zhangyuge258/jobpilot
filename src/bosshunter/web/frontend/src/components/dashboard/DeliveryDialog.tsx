import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { GreetingOptimizer, type TailoredGreeting } from './GreetingOptimizer'
import type { Job } from '@/hooks/useDashboard'

export interface CustomDelivery {
  custom_greeting: string
  greeting_image_id: string
  custom_greetings?: Record<string, string>
}

interface GreetingPreset extends CustomDelivery {
  id: string
  name: string
}

const DRAFT_KEY = 'bosshunter.custom-delivery'
const MAX_IMAGE = 10 * 1024 * 1024

function readDraft(): CustomDelivery {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    return { custom_greeting: typeof value.custom_greeting === 'string' ? value.custom_greeting : '',
      greeting_image_id: typeof value.greeting_image_id === 'string' && /^[a-f0-9]{32}\.(png|jpg)$/.test(value.greeting_image_id) ? value.greeting_image_id : '' }
  } catch { return { custom_greeting: '', greeting_image_id: '' } }
}

export function DeliveryDialog({ open, count, jobIds = [], manualJob, onClose, onConfirm }: {
  open: boolean
  count: number
  jobIds?: string[]
  onClose: () => void
  onConfirm?: (content: CustomDelivery) => Promise<void>
  manualJob?: Job & { platformUrl: string }
}) {
  const [draft] = useState(readDraft)
  const [text, setText] = useState(draft.custom_greeting)
  const [imageId, setImageId] = useState(draft.greeting_image_id)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [tailored, setTailored] = useState<TailoredGreeting[] | null>(null)
  const locked = busy || optimizing
  const ready = !tailored || (tailored.length === count && tailored.every(item => item.status === 'ready' && item.greeting.trim().length > 0 && item.greeting.trim().length <= 300))
  const [error, setError] = useState('')
  const [presets, setPresets] = useState<GreetingPreset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetNotice, setPresetNotice] = useState('')
  const [jd, setJd] = useState(manualJob?.jd || '')
  const [jdNotice, setJdNotice] = useState('')
  const [manualNotice, setManualNotice] = useState('')
  useEffect(() => {
    if (!open || !manualJob) return
    const controller = new AbortController()
    setJd(manualJob.jd || '')
    setJdNotice('正在读取岗位 JD…')
    fetch(`/api/jobs/${encodeURIComponent(manualJob.id)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '读取岗位 JD 失败')
        if (controller.signal.aborted) return
        setJd(data.jd || '')
        setJdNotice(data.jd?.trim() ? '' : '该岗位缺少 JD，请在岗位网页核实；可保留原文自行投递。')
      })
      .catch(cause => { if (!controller.signal.aborted) setJdNotice(cause instanceof Error ? cause.message : '读取岗位 JD 失败，原文保留') })
    return () => controller.abort()
  }, [open, manualJob?.id])

  const copyGreeting = async () => {
    setManualNotice('')
    try {
      await navigator.clipboard.writeText((tailored?.[0]?.greeting || text).trim())
      setManualNotice('招呼语已复制，请在对应岗位网页自行粘贴发送。')
    } catch { setManualNotice('复制失败，请选中正文手动复制。原文和优化结果均已保留。') }
  }
  useEffect(() => {
    if (!open) return
    let disposed = false
    setPresetsLoading(true)
    setPresetNotice('')
    fetch('/api/workbench/greeting-presets', { cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '读取预保存搭配失败')
        if (!disposed) setPresets(Array.isArray(data.items) ? data.items : [])
      })
      .catch(cause => { if (!disposed) setPresetNotice(cause instanceof Error ? cause.message : '读取预保存搭配失败') })
      .finally(() => { if (!disposed) setPresetsLoading(false) })
    return () => { disposed = true }
  }, [open])
  const localPreview = useMemo(() => file ? URL.createObjectURL(file) : '', [file])
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview) }, [localPreview])
  const preview = localPreview || (imageId ? `/api/workbench/greeting-images/${imageId}` : '')

  const chooseFile = (next: File) => {
    if (!['image/png', 'image/jpeg'].includes(next.type) || next.size > MAX_IMAGE) {
      setError('请选择不超过 10MB 的 PNG 或 JPEG 图片')
      return
    }
    setFile(next)
    setImageId('')
    setError('')
  }

  const ensureImage = async () => {
    let token = imageId
    if (file && !token) {
      const form = new FormData()
      form.append('image', file)
      const response = await fetch('/api/workbench/greeting-images', { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '招呼图片上传失败')
      token = data.image_id
      setImageId(token)
    }
    return token
  }

  const savePreset = async (update: boolean) => {
    if (locked || !text.trim() || presetsLoading) return
    if (!update && presets.length >= 5) { setPresetNotice('最多保存 5 组，请更新已有搭配或删除后再新增'); return }
    setBusy(true)
    setPresetNotice('')
    try {
      const token = await ensureImage()
      const response = await fetch('/api/workbench/greeting-presets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(update ? { id: selectedPresetId } : {}),
          name: presetName.trim() || `搭配 ${presets.length + 1}`, custom_greeting: text.trim(), greeting_image_id: token }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '保存搭配失败')
      const item: GreetingPreset = data.item
      setPresets(previous => update ? previous.map(preset => preset.id === item.id ? item : preset) : [...previous, item])
      setSelectedPresetId(item.id)
      setPresetName(item.name)
      setPresetNotice('搭配已保存，可随时点击导入。')
    } catch (cause) { setPresetNotice(cause instanceof Error ? cause.message : '保存搭配失败') }
    finally { setBusy(false) }
  }

  const importPreset = (preset: GreetingPreset) => {
    setText(preset.custom_greeting)
    setImageId(preset.greeting_image_id || '')
    setFile(null)
    setSelectedPresetId(preset.id)
    setPresetName(preset.name)
    setError('')
    setPresetNotice(`已导入“${preset.name}”的文字和图片。`)
  }

  const deletePreset = async (preset: GreetingPreset) => {
    setBusy(true)
    try {
      const response = await fetch(`/api/workbench/greeting-presets/${preset.id}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '删除搭配失败')
      setPresets(previous => previous.filter(item => item.id !== preset.id))
      if (selectedPresetId === preset.id) setSelectedPresetId('')
      setPresetNotice('搭配已删除，当前编辑内容保留。')
    } catch (cause) { setPresetNotice(cause instanceof Error ? cause.message : '删除搭配失败') }
    finally { setBusy(false) }
  }

  const submit = async () => {
    if (manualJob || !onConfirm || locked || !ready || !text.trim() || text.trim().length > 300 || !count) return
    setBusy(true)
    setError('')
    try {
      const token = await ensureImage()
      const content: CustomDelivery = { custom_greeting: text.trim(), greeting_image_id: token,
        ...(tailored ? { custom_greetings: Object.fromEntries(tailored.map(item => [item.job_id, item.greeting.trim()])) } : {}) }
      await onConfirm(content)
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ custom_greeting: text.trim(), greeting_image_id: token })) } catch { /* Sending does not depend on draft storage. */ }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '投递启动失败')
    } finally { setBusy(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="delivery-dialog-title" className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-card-border bg-card p-6 shadow-2xl">
        <h3 id="delivery-dialog-title" className="text-xl font-black">{manualJob ? '手动投递 · 招呼语准备' : '批量投递 · 自定义招呼'}</h3>
        <p className="mt-2 text-sm text-muted">{manualJob ? `${manualJob.company} · ${manualJob.title}。准备招呼语后，由你打开岗位网页并自行投递。` : count ? `已选择 ${count} 个岗位。无需先评分，可直接发送原文，或先按各岗位 JD 优化、预览确认。未沟通过的岗位依次发送文字和图片。` : '可以提前保存文字和图片搭配，选中岗位后再确认批量发送。'}</p>
        <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
        {manualJob && <section aria-label="所选岗位 JD" className="mb-4 rounded-xl border border-card-border bg-surface p-3">
          <h4 className="text-sm font-bold">所选岗位 JD · {manualJob.company} · {manualJob.title}</h4>
          {jdNotice && <p role="status" className="mt-2 text-xs text-warning">{jdNotice}</p>}
          <p className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">{jd || '暂无岗位 JD'}</p>
        </section>}
        <label className="block text-sm font-bold">
          自定义招呼语
          <textarea autoFocus rows={6} maxLength={300} value={text} disabled={locked} onChange={event => setText(event.target.value)}
            className="mt-2 w-full rounded-xl border border-card-border bg-surface px-3 py-2 font-normal leading-6 outline-none focus:border-primary"
            placeholder="在这里输入你想发给 HR 的招呼语" />
        </label>
        <p className="text-right text-xs text-muted">{text.length}/300 字</p>
        {count > 0 && jobIds.length > 0 && <GreetingOptimizer original={text} jobIds={jobIds} drafts={tailored} onChange={setTailored} onBusyChange={setOptimizing} disabled={busy} manual={Boolean(manualJob)} />}
        <label className="mt-3 block text-sm font-bold">
          招呼图片（可选）
          <input type="file" accept="image/png,image/jpeg" disabled={locked} className="mt-2 block w-full text-xs"
            onChange={event => { const image = event.target.files?.[0]; if (image) chooseFile(image); event.target.value = '' }} />
        </label>
        <div tabIndex={0} aria-label="粘贴招呼图片" className="mt-3 rounded-xl border border-dashed border-card-border p-3 text-center"
          onPaste={event => { const image = Array.from(event.clipboardData.files).find(item => item.type.startsWith('image/')); if (image && !locked) { event.preventDefault(); chooseFile(image) } }}>
          {preview ? <><img src={preview} alt="待发送招呼图片预览" className="mx-auto max-h-64 max-w-full object-contain" />
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => { setFile(null); setImageId('') }}>移除图片</Button></>
            : <p className="text-xs text-muted">选择图片，或点击此处后粘贴。支持 PNG/JPG，最大 10MB。</p>}
        </div>
        <div className="mt-4 rounded-xl bg-secondary p-3 text-sm">
          <p className="font-bold">{manualJob ? '手动投递准备' : '本批发送顺序'}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-muted">1. {tailored ? manualJob ? '复制上方预览、可编辑的正文' : '发送上方逐岗预览、可编辑的正文' : text.trim() || '请填写招呼语'}</p>
          <p className="mt-2 text-muted">2. {manualJob ? '自行打开岗位网页、发送招呼语及所需图片' : preview ? '发送上方预览的图片' : '不发送图片'}</p>
          {manualJob && preview && <a className="mt-2 inline-block text-primary" href={preview} download="招呼图片">保存招呼图片</a>}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">{manualJob ? '此窗口只准备内容。打开网页不会自动发送消息、上传简历或标为已投递；完成后可使用“我已发送”或修改状态。' : count ? `本次确认仅覆盖这 ${count} 个岗位。会话已有你成功发出的消息时，跳过本次文字和图片；无法核实时暂停检查。发送仍遵循 BOSS 平台限制和每日额度。聊天图片与附件简历分别处理。` : '保存和导入搭配不会发送消息。选中岗位后，可在投递弹窗中预览并确认发送。'}</p>
        {manualNotice && <p role="status" className="mt-3 text-sm text-primary">{manualNotice}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </div>
        <aside aria-label="预保存搭配" className="rounded-2xl border border-card-border bg-surface p-4 md:self-start">
          <div className="flex items-center justify-between"><h4 className="font-black">预保存搭配</h4><span className="text-xs text-muted">{presets.length}/5</span></div>
          <p className="mt-2 text-xs leading-5 text-muted">点击即可同时导入文字和图片。保存在本机，重启后仍可使用。</p>
          <div className="mt-3 space-y-2">
            {presetsLoading && <p className="text-xs text-muted">正在读取搭配…</p>}
            {!presetsLoading && !presets.length && <p className="py-2 text-xs text-muted">还没有保存搭配。编辑左侧内容后保存即可。</p>}
            {presets.map(preset => <div key={preset.id} className={`rounded-xl border p-2 ${selectedPresetId === preset.id ? 'border-primary bg-secondary' : 'border-card-border bg-card'}`}>
              <button type="button" aria-label={`导入搭配 ${preset.name}`} aria-pressed={selectedPresetId === preset.id} disabled={locked} onClick={() => importPreset(preset)} className="flex w-full gap-2 text-left disabled:opacity-50">
                {preset.greeting_image_id && <img src={`/api/workbench/greeting-images/${preset.greeting_image_id}`} alt={`${preset.name}图片`} className="h-12 w-10 shrink-0 rounded object-contain" />}
                <div className="min-w-0"><p className="break-words text-sm font-bold">{preset.name}</p><p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted">{preset.custom_greeting}</p><p className="mt-1 text-[10px] text-muted">{preset.greeting_image_id ? '文字 + 图片' : '仅文字'}</p></div>
              </button>
              <button type="button" aria-label={`删除搭配 ${preset.name}`} disabled={locked} onClick={() => void deletePreset(preset)} className="mt-2 text-xs text-muted hover:text-danger disabled:opacity-50">删除</button>
            </div>)}
          </div>
          <label className="mt-4 block text-xs font-bold">搭配名称<input value={presetName} maxLength={40} disabled={locked} onChange={event => setPresetName(event.target.value)} placeholder="例如：嵌入式校招" className="mt-2 w-full rounded-lg border border-card-border bg-card px-2 py-2 font-normal outline-none focus:border-primary" /></label>
          <div className="mt-3 flex flex-col gap-2">
            <Button variant="secondary" size="sm" disabled={locked || presetsLoading || !text.trim() || presets.length >= 5} onClick={() => void savePreset(false)}>保存为新搭配</Button>
            <Button variant="secondary" size="sm" disabled={locked || presetsLoading || !text.trim() || !selectedPresetId} onClick={() => void savePreset(true)}>更新选中搭配</Button>
          </div>
          {presets.length >= 5 && <p className="mt-2 text-xs text-muted">已保存 5 组，可更新选中搭配，或删除后再新增。</p>}
          {presetNotice && <p role="status" className="mt-3 break-words text-xs leading-5 text-primary">{presetNotice}</p>}
        </aside>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
          {manualJob ? <>
            <Button disabled={locked || !ready || !text.trim()} onClick={() => void copyGreeting()}>复制最终招呼语</Button>
            <a href={manualJob.platformUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" onClick={() => setManualNotice('岗位网页已打开，请自行完成投递；完成后手动标记。')}>打开岗位网页（手动投递）</a>
          </> : <Button disabled={locked || !ready || !text.trim() || !count} onClick={() => void submit()}>{busy ? '提交中…' : `确认发送给 ${count} 个岗位`}</Button>}
        </div>
      </div>
    </div>
  )
}
