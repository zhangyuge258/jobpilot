import { useEffect, useState } from 'react'
import type { Job } from '@/hooks/useDashboard'

export interface JobFilters {
  query: string
  minScore: string
  salaryMin: string
  salaryMax: string
  status: string[]
  createdWithin: string
  sourcePlatform: string[]
  city: string[]
  education: string[]
  recruitmentType: string[]
  company: string
  titles: string[]
  hrActive: string
  maxScore: string
}

export const EMPTY_JOB_FILTERS: JobFilters = {
  query: '',
  minScore: '',
  salaryMin: '',
  salaryMax: '',
  status: [],
  createdWithin: '',
  sourcePlatform: [],
  city: [],
  education: [],
  recruitmentType: [],
  company: '',
  titles: [],
  hrActive: '',
  maxScore: '',
}

export function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay)
    return () => window.clearTimeout(timeout)
  }, [value, delay])

  return debouncedValue
}

export function hasInvalidSalaryRange(filters: JobFilters) {
  if (filters.salaryMin === '' || filters.salaryMax === '') return false
  return Number(filters.salaryMin) > Number(filters.salaryMax)
}

export function scoreFilterError(filters: JobFilters) {
  for (const value of [filters.minScore, filters.maxScore]) {
    if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) return '评分须在 0 至 100 之间。'
  }
  if (filters.minScore !== '' && filters.maxScore !== '' && Number(filters.minScore) > Number(filters.maxScore)) return '最低评分不能高于最高评分。'
  return ''
}

export function hasActiveJobFilters(filters: JobFilters) {
  return Object.values(filters).some(value => Array.isArray(value) ? value.length > 0 : value !== '')
}

/** Mirrors the backend: platform city labels look like 上海·浦东新区. */
export function jobCityBaseName(city: string) {
  return (city || '').split('·')[0].trim()
}

function parseMonthlySalaryK(salary: string): [number, number] | null {
  const normalized = salary.replace(/,/g, '')
  if (/[/／]\s*(?:天|日|小时|时|周|年)|(?:日薪|时薪|周薪|年薪)/.test(normalized)) return null
  const scales: Record<string, number> = { k: 1, '万': 10, '千': 1, '元': .001 }
  const range = normalized.match(/(\d+(?:\.\d+)?)\s*([kK万千元]?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*([kK万千元])/)
  if (range) {
    const low = Number(range[1]) * scales[(range[2] || range[4]).toLowerCase()]
    const high = Number(range[3]) * scales[range[4].toLowerCase()]
    return [Math.min(low, high), Math.max(low, high)]
  }
  const single = normalized.match(/(\d+(?:\.\d+)?)\s*([kK万千元])/)
  if (single) {
    const value = Number(single[1]) * scales[single[2].toLowerCase()]
    return [value, value]
  }
  return null
}

function parseCreatedAt(createdAt: string) {
  const value = (createdAt || '').trim()
  if (!value) return null
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function matchesCreatedWithin(createdAt: string, createdWithin: string) {
  if (!createdWithin) return true
  const created = parseCreatedAt(createdAt)
  if (!created) return false
  const now = new Date()
  if (createdWithin === 'today') {
    return created.getFullYear() === now.getFullYear()
      && created.getMonth() === now.getMonth()
      && created.getDate() === now.getDate()
  }
  const days = createdWithin === '3d' ? 3 : 7
  return now.getTime() - created.getTime() <= days * 24 * 60 * 60 * 1000
}

export function filterJobs(jobs: Job[], filters: JobFilters) {
  if (hasInvalidSalaryRange(filters) || scoreFilterError(filters)) return []
  const keyword = filters.query.trim().toLocaleLowerCase()
  const minimumScore = filters.minScore === '' ? null : Number(filters.minScore)
  const salaryMin = filters.salaryMin === '' ? null : Number(filters.salaryMin)
  const salaryMax = filters.salaryMax === '' ? null : Number(filters.salaryMax)
  const salaryEnabled = salaryMin !== null || salaryMax !== null

  return jobs.filter(job => {
    if (!matchesCreatedWithin(job.created_at, filters.createdWithin)) return false
    if (keyword) {
      const searchable = [job.title, job.company, job.jd, job.score_reason]
        .join('\n')
        .toLocaleLowerCase()
      if (!searchable.includes(keyword)) return false
    }
    if (minimumScore !== null && Number(job.score || 0) < minimumScore) return false
    if (filters.maxScore && Number(job.score || 0) > Number(filters.maxScore)) return false
    if (filters.company && !(job.company || '').toLocaleLowerCase().includes(filters.company.trim().toLocaleLowerCase())) return false
    if (filters.titles.length > 0 && !filters.titles.includes((job.title || '').trim())) return false
    if (filters.hrActive) {
      const active = (job.hr_active || '').trim()
      const expected = filters.hrActive.trim()
      if (['unknown', '未知', '活跃度未知'].includes(expected) ? active && !active.includes('未知') : !active.toLocaleLowerCase().includes(expected.toLocaleLowerCase())) return false
    }
    if (filters.status.length > 0 && !filters.status.includes(job.status)) return false
    if (filters.sourcePlatform.length > 0 && !filters.sourcePlatform.includes(job.source_platform || 'boss')) return false
    if (filters.city.length > 0 && !filters.city.includes(jobCityBaseName(job.city))) return false
    if (filters.recruitmentType.length > 0 && !filters.recruitmentType.includes(job.recruitment_type || 'unknown')) return false
    if (filters.education.length > 0 && !filters.education.some(value => value === 'unknown' ? !(job.education || '').trim() : (job.education || '').includes(value))) return false
    if (salaryEnabled) {
      const salaryRange = parseMonthlySalaryK(job.salary || '')
      if (!salaryRange) return false
      const [jobMin, jobMax] = salaryRange
      if (salaryMin !== null && jobMax < salaryMin) return false
      if (salaryMax !== null && jobMin > salaryMax) return false
    }
    return true
  })
}
