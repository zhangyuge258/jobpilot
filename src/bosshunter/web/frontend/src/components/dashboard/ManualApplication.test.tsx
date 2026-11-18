import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { JobsTable } from './JobsTable'
import type { Job } from '@/hooks/useDashboard'

const token = `${'a'.repeat(32)}.png`
const writeText = vi.fn().mockResolvedValue(undefined)
const urls = { zhilian: 'https://jobs.zhaopin.com/CC123.htm', '51job': 'https://jobs.51job.com/tianjin/123.html', liepin: 'https://www.liepin.com/job/123.shtml' }
const job = (platform: keyof typeof urls) => ({ id: `${platform}:one`, source_platform: platform, company: '目标公司', title: '嵌入式工程师',
  jd: '列表摘要', url: urls[platform], status: 'pending', salary: '10-15K', city: '天津', score: 0, created_at: '' } as Job)

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  writeText.mockClear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it.each(['zhilian', '51job', 'liepin'] as const)('prepares %s content from presets and its JD, copies edited optimization and only opens an explicit link', async platform => {
  const selected = job(platform)
  const fetcher = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).endsWith('greeting-presets')) return Response.json({ items: [{ id: 'p1', name: '校招搭配', custom_greeting: '您好，我熟悉 STM32 开发。', greeting_image_id: token }] })
    if (String(url).endsWith('greeting-optimize')) return Response.json({ job_id: selected.id, company: selected.company, title: selected.title,
      greeting: '您好，我有 STM32 联调经验，希望了解本岗。', highlights: [{ jd_quote: 'STM32 驱动开发', evidence_quote: 'STM32 开发', reason: '相关驱动经验' }] })
    return Response.json({ ...selected, jd: '完整岗位要求：STM32 驱动开发，嵌入式软件联调。' })
  })
  vi.stubGlobal('fetch', fetcher)
  const mark = vi.fn()
  render(<JobsTable jobs={[selected]} page={0} pageSize={15} total={1} onPageChange={vi.fn()} selectedIds={[]} onToggleSelected={vi.fn()} onMarkManuallySent={mark} onStatusChange={vi.fn()} sortBy="created_at" sortOrder="desc" onSortChange={vi.fn()} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '打开平台' }))
  const dialog = await screen.findByRole('dialog', { name: '手动投递 · 招呼语准备' })
  expect(await within(dialog).findByText('完整岗位要求：STM32 驱动开发，嵌入式软件联调。')).toBeTruthy()
  fireEvent.click(await within(dialog).findByRole('button', { name: '导入搭配 校招搭配' }))
  expect((within(dialog).getByPlaceholderText('在这里输入你想发给 HR 的招呼语') as HTMLTextAreaElement).value).toContain('STM32')
  expect(within(dialog).getByAltText('待发送招呼图片预览').getAttribute('src')).toContain(token)
  fireEvent.click(within(dialog).getByRole('button', { name: '按所选岗位 JD 优化' }))
  const final = await within(dialog).findByLabelText('目标公司 嵌入式工程师 发送正文')
  await waitFor(() => expect((final as HTMLTextAreaElement).value).toContain('联调经验'))
  fireEvent.click(within(dialog).getByText('生成时匹配依据'))
  expect(within(dialog).getByText('JD：STM32 驱动开发')).toBeTruthy()
  fireEvent.change(final, { target: { value: '我编辑后的招呼语' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '复制最终招呼语' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('我编辑后的招呼语'))
  const link = within(dialog).getByRole('link', { name: '打开岗位网页（手动投递）' })
  expect(link.getAttribute('href')).toBe(urls[platform])
  expect(link.getAttribute('rel')).toContain('noopener')
  link.addEventListener('click', event => event.preventDefault())
  fireEvent.click(link)
  expect(await within(dialog).findByText(/岗位网页已打开/)).toBeTruthy()
  expect(mark).not.toHaveBeenCalled()
  expect(fetcher.mock.calls.some(([url]) => /deliver|manual-sent|\/status/.test(String(url)))).toBe(false)
})

it.each([429, 422])('keeps the original after optimization error %s and requires choosing it before copying', async status => {
  const selected = job('zhilian')
  localStorage.setItem('bosshunter.custom-delivery', JSON.stringify({ custom_greeting: '我的原文', greeting_image_id: '' }))
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).endsWith('greeting-presets')) return Response.json({ items: [] })
    if (String(url).endsWith('greeting-optimize')) return Response.json({ error: status === 429 ? 'AI 频率限制，请稍后重试' : '岗位缺少 JD' }, { status })
    return Response.json({ ...selected, jd: status === 422 ? '' : selected.jd })
  }))
  render(<JobsTable jobs={[selected]} page={0} pageSize={15} total={1} onPageChange={vi.fn()} selectedIds={[]} onToggleSelected={vi.fn()} onStatusChange={vi.fn()} sortBy="created_at" sortOrder="desc" onSortChange={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '打开平台' }))
  fireEvent.click(await screen.findByRole('button', { name: '按所选岗位 JD 优化' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect((screen.getByRole('button', { name: '复制最终招呼语' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByPlaceholderText('在这里输入你想发给 HR 的招呼语') as HTMLTextAreaElement).value).toBe('我的原文')
  fireEvent.click(screen.getByRole('button', { name: '此岗位使用原文' }))
  fireEvent.click(screen.getByRole('button', { name: '复制最终招呼语' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('我的原文'))
})
