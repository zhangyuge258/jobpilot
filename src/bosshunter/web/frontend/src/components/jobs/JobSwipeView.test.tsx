import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { JobSwipeView, getJobExternalUrl, isJobProcessed } from './JobSwipeView'
import type { Job } from '@/hooks/useDashboard'
import { EMPTY_JOB_FILTERS } from '@/lib/jobFilters'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mockJobs: Job[] = [
  {
    id: 'job-1',
    title: '高级嵌入式软件工程师',
    company: '华芯微电子科技有限公司',
    salary: '20K-35K',
    city: '天津',
    experience: '3-5年',
    education: '本科',
    recruitment_type: 'experienced',
    jd: '岗位职责：1. 负责RTOS底层驱动开发；2. 参与系统架构设计。\n任职要求：熟练掌握C语言和ARM架构。',
    score: 88,
    score_reason: '底层驱动经验丰富',
    greeting: '您好，我对该嵌入式岗位非常感兴趣。',
    status: 'ready',
    hr_name: '李经理',
    hr_title: 'HRBP',
    hr_active: '刚刚活跃',
    company_size: '100-499人',
    company_industry: '集成电路/半导体',
    url: 'https://www.zhaopin.com/job/job-1',
    source_platform: 'zhilian',
    created_at: '2026-11-17T10:00:00Z',
  },
  {
    id: 'job-2',
    title: '嵌入式硬件开发工程师',
    company: '飞腾信息技术有限公司',
    salary: '18K-28K',
    city: '天津',
    experience: '应届生',
    education: '硕士',
    recruitment_type: 'campus',
    jd: '岗位职责：负责PCB设计与硬件原理图设计。\n任职要求：熟悉Cadence与硬件测试。',
    score: 92,
    score_reason: '飞腾硬件校招，专业高度对口',
    greeting: '您好，我对飞腾硬件设计岗位非常向往。',
    status: 'sent',
    hr_name: '张老师',
    hr_title: '校招HR',
    hr_active: '今日活跃',
    company_size: '1000-9999人',
    company_industry: '芯片/集成电路',
    url: '/job_detail/phytium-hw-2.html',
    source_platform: 'boss',
    created_at: '2026-11-17T11:00:00Z',
  },
  {
    id: 'job-3',
    title: 'Linux系统驱动工程师',
    company: '大疆创新科技有限公司',
    salary: '25K-45K',
    city: '深圳',
    experience: '不限',
    education: '本科',
    recruitment_type: 'experienced',
    jd: '岗位职责：负责无人机Linux内核裁减与驱动优化。',
    score: 85,
    score_reason: '内核底层开发契合',
    greeting: '您好，我专注Linux内核驱动开发。',
    status: 'ready',
    hr_name: '王主管',
    hr_title: '技术专家',
    hr_active: '在线',
    company_size: '10000人以上',
    company_industry: '智能硬件',
    url: 'https://careers.dji.com/job/job-3',
    source_platform: 'dji',
    created_at: '2026-11-17T12:00:00Z',
  },
]

it('correctly detects processed vs unprocessed job statuses', () => {
  expect(isJobProcessed('sent')).toBe(true)
  expect(isJobProcessed('skipped')).toBe(true)
  expect(isJobProcessed('rejected')).toBe(true)
  expect(isJobProcessed('ready')).toBe(false)
  expect(isJobProcessed('pending')).toBe(false)
})

it('correctly constructs external URLs for different platforms', () => {
  expect(getJobExternalUrl(mockJobs[0])).toBe('https://www.zhaopin.com/job/job-1')
  expect(getJobExternalUrl(mockJobs[1])).toBe('https://www.zhipin.com/job_detail/phytium-hw-2.html')
  expect(getJobExternalUrl(mockJobs[2])).toBe('https://careers.dji.com/job/job-3')
})

it('renders empty placeholder when no jobs are available', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0 })))
  )

  render(
    <JobSwipeView
      filters={{ ...EMPTY_JOB_FILTERS }}
      library="all"
      onStatusChange={vi.fn()}
    />
  )

  expect(await screen.findByText('当前岗位库暂无卡片')).toBeTruthy()
})

it('displays the bottom keyboard shortcuts bar', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: mockJobs, total: 3 })))
  )

  render(
    <JobSwipeView
      filters={{ ...EMPTY_JOB_FILTERS }}
      library="all"
      onStatusChange={vi.fn()}
    />
  )

  expect(await screen.findByText('快捷键支持：')).toBeTruthy()
  expect(screen.getByText('跳过')).toBeTruthy()
  expect(screen.getByText('投递')).toBeTruthy()
  expect(screen.getAllByText('下一个未投递').length).toBeGreaterThanOrEqual(1)
})

it('swipes to next card and marks sent when clicking apply button', async () => {
  const openMock = vi.fn()
  vi.stubGlobal('open', openMock)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: mockJobs, total: 3 })))
  )

  const onStatusChange = vi.fn(async () => {})
  const onNotice = vi.fn()

  render(
    <JobSwipeView
      filters={{ ...EMPTY_JOB_FILTERS }}
      library="all"
      onStatusChange={onStatusChange}
      onNotice={onNotice}
    />
  )

  // Wait for initial active card
  expect(await screen.findByText('高级嵌入式软件工程师')).toBeTruthy()
  expect(screen.getByText('华芯微电子科技有限公司')).toBeTruthy()
  expect(screen.getByText('20K-35K')).toBeTruthy()

  // Click Apply Button (Checkmark)
  const applyBtn = screen.getByRole('button', { name: '投递' })
  fireEvent.click(applyBtn)

  // Verify external page was opened
  expect(openMock).toHaveBeenCalledWith('https://www.zhaopin.com/job/job-1', '_blank', 'noopener,noreferrer')
  // Verify status update was called with 'sent'
  expect(onStatusChange).toHaveBeenCalledWith(mockJobs[0], 'sent')

  // Smooth advance: Next card is now active
  expect(await screen.findByText('嵌入式硬件开发工程师')).toBeTruthy()
  expect(screen.getByText('飞腾信息技术有限公司')).toBeTruthy()

  // Verify left card allows clicking to return to previous card
  const leftCard = screen.getByText('👈 点击切回上一张（可纠错）')
  fireEvent.click(leftCard)

  // Returned to previous card
  expect(await screen.findByText('高级嵌入式软件工程师')).toBeTruthy()
})

it('swipes to next card and marks skipped when clicking skip button', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: mockJobs, total: 3 })))
  )

  const onStatusChange = vi.fn(async () => {})
  const onNotice = vi.fn()

  render(
    <JobSwipeView
      filters={{ ...EMPTY_JOB_FILTERS }}
      library="all"
      onStatusChange={onStatusChange}
      onNotice={onNotice}
    />
  )

  expect(await screen.findByText('高级嵌入式软件工程师')).toBeTruthy()

  // Click Skip Button (X)
  const skipBtn = screen.getByRole('button', { name: '跳过' })
  fireEvent.click(skipBtn)

  // Verify status update called with 'skipped'
  expect(onStatusChange).toHaveBeenCalledWith(mockJobs[0], 'skipped')

  // Next card is now active
  expect(await screen.findByText('嵌入式硬件开发工程师')).toBeTruthy()
})

it('allows quickly jumping to the next unapplied job', async () => {
  // mockJobs:
  // [0] ready, [1] sent, [2] ready
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: mockJobs, total: 3 })))
  )

  const onNotice = vi.fn()

  render(
    <JobSwipeView
      filters={{ ...EMPTY_JOB_FILTERS }}
      library="all"
      initialJobId="job-2" // Starts on job-2 (which is already sent)
      onStatusChange={vi.fn()}
      onNotice={onNotice}
    />
  )

  expect(await screen.findByText('嵌入式硬件开发工程师')).toBeTruthy()

  // Click "下一个未投递" button
  const jumpBtn = screen.getByRole('button', { name: /下一个未投递/ })
  fireEvent.click(jumpBtn)

  // It should jump past job-2 to job-3
  expect(await screen.findByText('Linux系统驱动工程师')).toBeTruthy()
  expect(screen.getByText('大疆创新科技有限公司')).toBeTruthy()
})

it('allows locating directly to a specific position from the locator drawer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: mockJobs, total: 3 })))
  )

  render(
    <JobSwipeView
      filters={{ ...EMPTY_JOB_FILTERS }}
      library="all"
      onStatusChange={vi.fn()}
    />
  )

  expect(await screen.findByText('高级嵌入式软件工程师')).toBeTruthy()

  // Open locator
  const locatorTrigger = screen.getByTitle('点击快速跳转指定岗位或输入序号')
  fireEvent.click(locatorTrigger)

  expect(screen.getByText('快速定位到指定位置')).toBeTruthy()

  // Click job 3 from locator list
  const job3Item = screen.getByText('Linux系统驱动工程师')
  fireEvent.click(job3Item)

  // Active card is now job 3
  expect(await screen.findByText('大疆创新科技有限公司')).toBeTruthy()
})
