import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CompanySearchLibrary } from './CompanySearchLibrary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('shows results in the nested library with a direct platform link and immediate deletion', async () => {
  const job = {
    id: 'zhilian:job-1', title: '硬件工程师', company: '示例科技', source_platform: 'zhilian',
    url: 'https://www.zhaopin.com/jobdetail/job-1.htm', status: 'pending', score: 0,
    education: '本科', created_at: '2026-11-16 03:00:00', jd: '硬件研发',
  }
  let removed = false
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/company-search') {
      return Response.json({ companies: [{
        id: 1, name: job.company, job_count: Number(!removed), platforms: {},
        website: '', website_status: '', website_candidates: [],
      }],
        cities: [], pending: 0, task: null })
    }
    if (url === '/api/company-search/1/jobs') return Response.json({ jobs: removed ? [] : [job], review: [] })
    if (url === '/api/company-search/1/job') {
      removed = JSON.parse(String(options?.body)).removed
      return Response.json({ success: true })
    }
    throw new Error(url)
  })
  vi.stubGlobal('fetch', fetchMock)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<CompanySearchLibrary />)
  fireEvent.click(await screen.findByRole('button', { name: /示例科技/ }))
  expect(fetchMock.mock.calls.every(([url]) => !url.endsWith('/jobs'))).toBe(true)
  expect(screen.queryByText(job.title)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '搜索到库' }))
  fireEvent.click(screen.getByRole('button', { name: /示例科技/ }))
  const link = await screen.findByRole('link', { name: '跳转投递' })
  expect(link.getAttribute('href')).toBe(job.url)
  expect(link.getAttribute('target')).toBe('_blank')
  const remove = screen.getByRole('button', { name: '删除检索库岗位 硬件工程师' })
  expect(remove.closest('td')).toBe(remove.closest('tr')?.lastElementChild)
  fireEvent.click(remove)
  expect(confirm).not.toHaveBeenCalled()
  expect(await screen.findByRole('button', { name: '撤销' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: '跳转投递' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  await waitFor(() => expect(screen.getByRole('link', { name: '跳转投递' })).toBeTruthy())
})
