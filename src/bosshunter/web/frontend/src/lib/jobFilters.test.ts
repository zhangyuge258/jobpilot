import { describe, expect, it } from 'vitest'
import { EMPTY_JOB_FILTERS, filterJobs, hasActiveJobFilters, type JobFilters } from './jobFilters'
import type { Job } from '@/hooks/useDashboard'

function job(overrides: Partial<Job>): Job {
  return {
    id: 'job', source_platform: 'boss', title: '岗位', company: '公司', salary: '10K', city: '北京', experience: '',
    education: '本科', recruitment_type: 'experienced', jd: '', score: 80, score_reason: '', greeting: '', status: 'ready',
    hr_name: '', hr_title: '', hr_active: '', company_size: '', company_industry: '', url: '', created_at: '', ...overrides,
  }
}

describe('job multi-select filters', () => {
  it('compares K, yuan and wan monthly salaries in the same K range', () => {
    const filters = { ...EMPTY_JOB_FILTERS, salaryMin: '5', salaryMax: '12' }
    expect(filterJobs([
      job({ id: 'yuan', salary: '4000-7000元/月' }), job({ id: 'wan', salary: '1-1.5万' }),
      job({ id: 'k', salary: '8-10K·13薪' }), job({ id: 'daily', salary: '5000元/天' }),
    ], filters).map(item => item.id)).toEqual(['yuan', 'wan', 'k'])
  })
  it('combines text, activity and score bounds with other columns', () => {
    const filters = { ...EMPTY_JOB_FILTERS, company: 'TECH%_', titles: ['嵌入式硬件', '嵌入式软件'], hrActive: '未知', minScore: '70', maxScore: '85', city: ['天津'] }
    const matching = job({ id: 'matching', company: '芯片Tech%_', title: '嵌入式硬件', city: '天津·西青区' })
    expect(filterJobs([matching, { ...matching, id: 'software', title: '嵌入式软件' }, { ...matching, id: 'too-high', score: 90 }, { ...matching, id: 'active', hr_active: '今日活跃' }, { ...matching, id: 'wrong-title', title: '高级嵌入式硬件' }], filters).map(item => item.id)).toEqual(['matching', 'software'])
    expect(filterJobs([matching], { ...filters, maxScore: '60' })).toEqual([])
  })
  it('matches any selected value within a field', () => {
    const filters: JobFilters = { ...EMPTY_JOB_FILTERS, sourcePlatform: ['boss', 'zhilian'], status: ['ready', 'filtered'] }
    expect(filterJobs([
      job({ id: 'boss-ready' }),
      job({ id: 'zhilian-filtered', source_platform: 'zhilian', status: 'filtered' }),
      job({ id: 'liepin-ready', source_platform: 'liepin' }),
    ], filters).map(item => item.id)).toEqual(['boss-ready', 'zhilian-filtered'])
  })

  it('treats unknown education as an option alongside recognized values', () => {
    const filters: JobFilters = { ...EMPTY_JOB_FILTERS, education: ['硕士', 'unknown'] }
    expect(filterJobs([job({ id: 'master', education: '硕士' }), job({ id: 'unknown', education: '' }), job({ id: 'bachelor' })], filters).map(item => item.id)).toEqual(['master', 'unknown'])
  })

  it('matches any selected city, including district-suffixed labels', () => {
    const filters: JobFilters = { ...EMPTY_JOB_FILTERS, city: ['北京', '上海'] }
    expect(filterJobs([
      job({ id: 'beijing' }),
      job({ id: 'shanghai-pudong', city: '上海·浦东新区' }),
      job({ id: 'shenzhen', city: '深圳' }),
    ], filters).map(item => item.id)).toEqual(['beijing', 'shanghai-pudong'])
  })

  it('treats space-only education as unknown like server search', () => {
    const filters: JobFilters = { ...EMPTY_JOB_FILTERS, education: ['unknown'] }
    expect(filterJobs([
      job({ id: 'spaces', education: '   ' }),
      job({ id: 'bachelor' }),
    ], filters).map(item => item.id)).toEqual(['spaces'])
  })

  it('does not count empty multi-selects as active filters', () => {
    expect(hasActiveJobFilters(EMPTY_JOB_FILTERS)).toBe(false)
    expect(hasActiveJobFilters({ ...EMPTY_JOB_FILTERS, status: ['ready'] })).toBe(true)
  })
})
