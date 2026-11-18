import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CompanyAppliedBadge, resolveCompanyAppliedStats } from './CompanyAppliedBadge'
import type { Job } from '@/hooks/useDashboard'

afterEach(() => {
  cleanup()
})

const baseJob: Job = {
  id: 'job-pending-1',
  title: '嵌入式软件工程师',
  company: '大疆创新',
  salary: '25K-40K',
  city: '深圳',
  experience: '3-5年',
  jd: '负责无人机驱动',
  score: 90,
  score_reason: '匹配度高',
  greeting: '您好',
  status: 'ready',
  hr_name: '王经理',
  hr_title: '招聘专家',
  hr_active: '刚刚活跃',
  company_size: '10000人以上',
  company_industry: '智能硬件',
  url: 'https://example.com/job1',
  created_at: '2026-11-18T00:00:00Z',
}

describe('resolveCompanyAppliedStats', () => {
  it('returns backend stats directly if present', () => {
    const jobWithStats: Job = {
      ...baseJob,
      company_applied_stats: {
        has_applied: true,
        count: 2,
        same_hr: false,
        jobs: [
          { id: 'job-old-1', title: 'C++开发', status: 'sent', hr_name: '李经理' },
          { id: 'job-old-2', title: '底层驱动', status: 'sent', hr_name: '赵经理' },
        ],
      },
    }
    const stats = resolveCompanyAppliedStats(jobWithStats)
    expect(stats.has_applied).toBe(true)
    expect(stats.count).toBe(2)
    expect(stats.same_hr).toBe(false)
  })

  it('computes stats from allKnownJobs if backend stats missing (different HR)', () => {
    const sentJob: Job = {
      ...baseJob,
      id: 'job-sent-1',
      title: '飞控算法工程师',
      hr_name: '张总监',
      status: 'sent',
    }
    const stats = resolveCompanyAppliedStats(baseJob, [baseJob, sentJob])
    expect(stats.has_applied).toBe(true)
    expect(stats.count).toBe(1)
    expect(stats.same_hr).toBe(false)
    expect(stats.jobs[0].title).toBe('飞控算法工程师')
  })

  it('identifies same_hr when HR name matches', () => {
    const sentJobSameHr: Job = {
      ...baseJob,
      id: 'job-sent-2',
      title: '固件开发',
      hr_name: '王经理', // matches baseJob.hr_name
      status: 'sent',
    }
    const stats = resolveCompanyAppliedStats(baseJob, [baseJob, sentJobSameHr])
    expect(stats.has_applied).toBe(true)
    expect(stats.count).toBe(1)
    expect(stats.same_hr).toBe(true)
  })
})

describe('CompanyAppliedBadge component', () => {
  it('renders nothing when no applied jobs exist for the company', () => {
    const { container } = render(<CompanyAppliedBadge job={baseJob} allKnownJobs={[baseJob]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders purple badge for different HR and opens details popover', () => {
    const jobWithStats: Job = {
      ...baseJob,
      company_applied_stats: {
        has_applied: true,
        count: 1,
        same_hr: false,
        jobs: [{ id: 'job-old-1', title: 'C++后台开发', status: 'sent', hr_name: '刘总' }],
      },
    }
    render(<CompanyAppliedBadge job={jobWithStats} />)
    const button = screen.getByRole('button', { name: /同司已投/i })
    expect(button).toBeTruthy()
    expect(button.className).toContain('text-purple-700')

    // Open popover
    fireEvent.click(button)
    expect(screen.getByText('企业投递记录')).toBeTruthy()
    expect(screen.getByText('C++后台开发')).toBeTruthy()
    expect(screen.getByText(/刘总/)).toBeTruthy()
  })

  it('renders amber warning badge for same HR with alert text', () => {
    const jobWithStats: Job = {
      ...baseJob,
      company_applied_stats: {
        has_applied: true,
        count: 1,
        same_hr: true,
        jobs: [{ id: 'job-old-2', title: '嵌入式固件', status: 'sent', hr_name: '王经理' }],
      },
    }
    render(<CompanyAppliedBadge job={jobWithStats} />)
    const button = screen.getByRole('button', { name: /同HR已投/i })
    expect(button).toBeTruthy()
    expect(button.className).toContain('text-amber-800')

    // Open popover
    fireEvent.click(button)
    expect(screen.getByText('同一招聘者警示')).toBeTruthy()
    expect(screen.getByText(/本岗位与已投岗位均由/)).toBeTruthy()
  })
})
