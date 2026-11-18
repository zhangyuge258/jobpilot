import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeliveryDialog } from './DeliveryDialog'

beforeEach(() => {
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-preview')
  URL.revokeObjectURL = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }))))
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('does not upload or send before confirmation and cancellation keeps it local', async () => {
  const onConfirm = vi.fn(), onClose = vi.fn(), fetch = vi.fn(async () => new Response(JSON.stringify({ items: [] })))
  vi.stubGlobal('fetch', fetch)
  render(<DeliveryDialog open count={3} onConfirm={onConfirm} onClose={onClose} />)
  await screen.findByText('还没有保存搭配。编辑左侧内容后保存即可。')
  fireEvent.change(screen.getByRole('textbox', { name: '自定义招呼语' }), { target: { value: '我的招呼语' } })
  fireEvent.change(screen.getByLabelText('招呼图片（可选）'), { target: { files: [new File(['image'], 'resume.png', { type: 'image/png' })] } })
  expect(screen.getByAltText('待发送招呼图片预览').getAttribute('src')).toBe('blob:synthetic-preview')
  expect(fetch.mock.calls.length).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(onConfirm).not.toHaveBeenCalled()
})

it('uploads the selected picture and confirms exactly the previewed text and image', async () => {
  const token = 'a'.repeat(32)+'.png'
  const fetch = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(String(url).endsWith('greeting-presets') ? { items: [] } : { image_id: token })))
  vi.stubGlobal('fetch', fetch)
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  render(<DeliveryDialog open count={2} onConfirm={onConfirm} onClose={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: '自定义招呼语' }), { target: { value: '您好！\n这是我自己输入的内容。' } })
  fireEvent.change(screen.getByLabelText('招呼图片（可选）'), { target: { files: [new File(['image'], 'resume.png', { type: 'image/png' })] } })
  fireEvent.click(screen.getByRole('button', { name: '确认发送给 2 个岗位' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ custom_greeting: '您好！\n这是我自己输入的内容。', greeting_image_id: token }))
  const upload = fetch.mock.calls.find(([url]) => String(url) === '/api/workbench/greeting-images')!
  expect(upload[1]?.body).toBeInstanceOf(FormData)
  await waitFor(() => expect(JSON.parse(localStorage.getItem('bosshunter.custom-delivery')!).greeting_image_id).toBe(token))
})

it('keeps the draft and shows an error when submission fails', async () => {
  const onConfirm = vi.fn().mockRejectedValue(new Error('当前已有采集任务，请稍后发送'))
  render(<DeliveryDialog open count={1} onConfirm={onConfirm} onClose={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: '自定义招呼语' }), { target: { value: '保留这段文字' } })
  fireEvent.click(screen.getByRole('button', { name: '确认发送给 1 个岗位' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '当前已有采集任务，请稍后发送')
  expect((screen.getByRole('textbox', { name: '自定义招呼语' }) as HTMLTextAreaElement).value).toBe('保留这段文字')
})

it('saves a paired preset without sending and loads it again after reopening', async () => {
  const token = 'b'.repeat(32)+'.png'
  let saved: Record<string, string> | null = null
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/workbench/greeting-images') return new Response(JSON.stringify({ image_id: token }))
    if (init?.method === 'POST') {
      saved = { id: 'saved-one', ...JSON.parse(String(init.body)) }
      return new Response(JSON.stringify({ item: saved }))
    }
    return new Response(JSON.stringify({ items: saved ? [saved] : [], limit: 5 }))
  })
  vi.stubGlobal('fetch', fetch)
  const onConfirm = vi.fn()
  const first = render(<DeliveryDialog open count={0} onConfirm={onConfirm} onClose={vi.fn()} />)
  await screen.findByText('还没有保存搭配。编辑左侧内容后保存即可。')
  fireEvent.change(screen.getByRole('textbox', { name: '自定义招呼语' }), { target: { value: '校招原文\n第二行' } })
  fireEvent.change(screen.getByRole('textbox', { name: '搭配名称' }), { target: { value: '嵌入式校招' } })
  fireEvent.change(screen.getByLabelText('招呼图片（可选）'), { target: { files: [new File(['image'], 'resume.png', { type: 'image/png' })] } })
  fireEvent.click(screen.getByRole('button', { name: '保存为新搭配' }))
  await screen.findByRole('button', { name: '导入搭配 嵌入式校招' })
  onConfirm.mockClear()
  expect(saved).toMatchObject({ custom_greeting: '校招原文\n第二行', greeting_image_id: token })
  expect(onConfirm).not.toHaveBeenCalled()
  first.unmount()
  render(<DeliveryDialog open count={1} onConfirm={onConfirm} onClose={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '导入搭配 嵌入式校招' }))
  expect((screen.getByRole('textbox', { name: '自定义招呼语' }) as HTMLTextAreaElement).value).toBe('校招原文\n第二行')
  expect(screen.getByAltText('待发送招呼图片预览').getAttribute('src')).toBe(`/api/workbench/greeting-images/${token}`)
  expect(onConfirm).not.toHaveBeenCalled()
  expect(fetch.mock.calls.some(([url]) => String(url) === '/api/workbench/deliver')).toBe(false)
})

it('limits new presets to five while permitting update and deletion, and imports whole pairs', async () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ id: `p${index}`, name: `搭配${index}`, custom_greeting: `原文${index}`, greeting_image_id: index === 0 ? 'c'.repeat(32)+'.png' : '' }))
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ success: true }))
    if (init?.method === 'POST') return new Response(JSON.stringify({ item: JSON.parse(String(init.body)) }))
    return new Response(JSON.stringify({ items, limit: 5 }))
  })
  vi.stubGlobal('fetch', fetch)
  const onConfirm = vi.fn()
  render(<DeliveryDialog open count={1} onConfirm={onConfirm} onClose={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '导入搭配 搭配0' }))
  expect(screen.getByAltText('待发送招呼图片预览')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '导入搭配 搭配4' }))
  expect(screen.queryByAltText('待发送招呼图片预览')).toBeNull()
  expect((screen.getByRole('textbox', { name: '自定义招呼语' }) as HTMLTextAreaElement).value).toBe('原文4')
  expect((screen.getByRole('button', { name: '保存为新搭配' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByRole('textbox', { name: '自定义招呼语' }), { target: { value: '更新原文4' } })
  fireEvent.click(screen.getByRole('button', { name: '更新选中搭配' }))
  await screen.findByText('搭配已保存，可随时点击导入。')
  const update = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(update[1]?.body))).toMatchObject({ id: 'p4', custom_greeting: '更新原文4', greeting_image_id: '' })
  fireEvent.click(screen.getByRole('button', { name: '删除搭配 搭配3' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '导入搭配 搭配3' })).toBeNull())
  expect((screen.getByRole('button', { name: '保存为新搭配' }) as HTMLButtonElement).disabled).toBe(false)
  expect(onConfirm).not.toHaveBeenCalled()
})

it('previews per-job improvements, allows edits and sends only the reviewed map', async () => {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const path=String(url)
    if (path.endsWith('greeting-presets')) return new Response(JSON.stringify({ items: [] }))
    calls.push(path)
    const one=path.includes('/one/')
    return new Response(JSON.stringify({ company: one ? '甲公司' : '乙公司', title: one ? '软件工程师' : '硬件工程师', greeting: one ? '软件方向优化稿' : '硬件方向优化稿', highlights: [{ jd_quote:'外设驱动开发', evidence_quote:'完成外设驱动', reason:'职责相关' }] }))
  }))
  render(<DeliveryDialog open count={2} jobIds={['one','two']} onConfirm={onConfirm} onClose={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox',{name:'自定义招呼语'}),{target:{value:'我的原招呼语'}})
  fireEvent.click(screen.getByRole('button',{name:'按所选岗位 JD 优化'}))
  await screen.findByRole('textbox',{name:'乙公司 硬件工程师 发送正文'})
  await waitFor(()=>expect((screen.getByRole('button',{name:'确认发送给 2 个岗位'}) as HTMLButtonElement).disabled).toBe(false))
  expect(onConfirm).not.toHaveBeenCalled()
  expect(calls).toEqual(['/api/jobs/one/greeting-optimize','/api/jobs/two/greeting-optimize'])
  expect((screen.getByRole('textbox',{name:'自定义招呼语'}) as HTMLTextAreaElement).value).toBe('我的原招呼语')
  fireEvent.change(screen.getByRole('textbox',{name:'甲公司 软件工程师 发送正文'}),{target:{value:'我最终修改的软件稿'}})
  fireEvent.click(screen.getByRole('button',{name:'确认发送给 2 个岗位'}))
  await waitFor(()=>expect(onConfirm).toHaveBeenCalledWith({custom_greeting:'我的原招呼语',greeting_image_id:'',custom_greetings:{one:'我最终修改的软件稿',two:'硬件方向优化稿'}}))
  await waitFor(()=>expect(JSON.parse(localStorage.getItem('bosshunter.custom-delivery')!)).toEqual({custom_greeting:'我的原招呼语',greeting_image_id:''}))
})

it('stops on rate limits and never silently sends original text for failed previews', async () => {
  const onConfirm=vi.fn().mockResolvedValue(undefined)
  const calls: string[]=[]
  vi.stubGlobal('fetch',vi.fn(async (url:RequestInfo|URL)=>{
    const path=String(url)
    if(path.endsWith('greeting-presets')) return new Response(JSON.stringify({items:[]}))
    calls.push(path)
    return new Response(JSON.stringify({company:'甲公司',title:'软件工程师',error:'AI 频率限制'}),{status:429})
  }))
  render(<DeliveryDialog open count={2} jobIds={['one','two']} onConfirm={onConfirm} onClose={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox',{name:'自定义招呼语'}),{target:{value:'保留原文'}})
  fireEvent.click(screen.getByRole('button',{name:'按所选岗位 JD 优化'}))
  await screen.findByText('AI 频率限制')
  await screen.findByText('本轮尚未优化，请重试或明确选择使用原文')
  expect(calls).toHaveLength(1)
  expect((screen.getByRole('button',{name:'确认发送给 2 个岗位'}) as HTMLButtonElement).disabled).toBe(true)
  expect(onConfirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'全部改用原文'}))
  fireEvent.click(screen.getByRole('button',{name:'确认发送给 2 个岗位'}))
  await waitFor(()=>expect(onConfirm).toHaveBeenCalledWith({custom_greeting:'保留原文',greeting_image_id:''}))
})

it('invalidates old previews when the original greeting changes', async () => {
  const onConfirm=vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('fetch',vi.fn(async (url:RequestInfo|URL)=>new Response(JSON.stringify(String(url).endsWith('greeting-presets')?{items:[]}:{company:'甲公司',title:'软件工程师',greeting:'上一稿',highlights:[]}))))
  render(<DeliveryDialog open count={1} jobIds={['one']} onConfirm={onConfirm} onClose={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox',{name:'自定义招呼语'}),{target:{value:'旧原文'}})
  fireEvent.click(screen.getByRole('button',{name:'按所选岗位 JD 优化'}))
  await screen.findByRole('textbox',{name:'甲公司 软件工程师 发送正文'})
  await waitFor(()=>expect((screen.getByRole('textbox',{name:'自定义招呼语'}) as HTMLTextAreaElement).disabled).toBe(false))
  fireEvent.change(screen.getByRole('textbox',{name:'自定义招呼语'}),{target:{value:'新原文'}})
  expect(screen.queryByRole('textbox',{name:'甲公司 软件工程师 发送正文'})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'确认发送给 1 个岗位'}))
  await waitFor(()=>expect(onConfirm).toHaveBeenCalledWith({custom_greeting:'新原文',greeting_image_id:''}))
})

it('can stop optimization without submitting or retaining a pending send', async () => {
  const onConfirm=vi.fn()
  vi.stubGlobal('fetch',vi.fn(async (url:RequestInfo|URL, init?:RequestInit)=>{
    if(String(url).endsWith('greeting-presets')) return new Response(JSON.stringify({items:[]}))
    return await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))
  }))
  render(<DeliveryDialog open count={1} jobIds={['one']} onConfirm={onConfirm} onClose={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox',{name:'自定义招呼语'}),{target:{value:'我的原文'}})
  fireEvent.click(screen.getByRole('button',{name:'按所选岗位 JD 优化'}))
  fireEvent.click(await screen.findByRole('button',{name:'停止优化'}))
  await screen.findByText('本轮尚未优化，请重试或明确选择使用原文')
  expect(onConfirm).not.toHaveBeenCalled()
  expect((screen.getByRole('button',{name:'确认发送给 1 个岗位'}) as HTMLButtonElement).disabled).toBe(true)
})
