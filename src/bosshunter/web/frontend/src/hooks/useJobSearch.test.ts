import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useJobSearch } from './useJobSearch'
import { EMPTY_JOB_FILTERS } from '@/lib/jobFilters'

const response = (score: number, total = 2) => new Response(JSON.stringify({
  items: [{ id: 'job-1', score, status: score ? 'scored' : 'pending' }],
  total, all_total: 3, city_options: ['上海'], title_options: ['嵌入式软件工程师', '嵌入式硬件工程师'],
}))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('automatic job refresh', () => {
  it('sends column filters together, including each selected value and score bounds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(75))
    vi.stubGlobal('fetch', fetchMock)
    const filters = { ...EMPTY_JOB_FILTERS, company: '芯片%_', titles: ['嵌入式软件工程师', '嵌入式硬件工程师'], hrActive: '今日', minScore: '70', maxScore: '85', city: ['天津', '北京'], status: ['ready', 'pending'] }
    const { result } = renderHook(() => useJobSearch(filters, 1, 15, 'score', 'desc', 'filtered'))
    await act(async () => {})
    const params = new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams
    expect(params.get('company')).toBe('芯片%_')
    expect(params.getAll('titles')).toEqual(['嵌入式软件工程师', '嵌入式硬件工程师'])
    expect(result.current.titleOptions).toEqual(['嵌入式软件工程师', '嵌入式硬件工程师'])
    expect(params.get('hr_active')).toBe('今日')
    expect(params.get('min_score')).toBe('70')
    expect(params.get('max_score')).toBe('85')
    expect(params.getAll('city')).toEqual(['天津', '北京'])
    expect(params.getAll('status')).toEqual(['ready', 'pending'])
    expect(params.get('library')).toBe('filtered')
    expect(params.get('offset')).toBe('15')
  })

  it('shows invalid score ranges without requesting stale results', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useJobSearch({ ...EMPTY_JOB_FILTERS, minScore: '90', maxScore: '70' }, 0, 15))
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
    expect(result.current.error).toContain('最低评分不能高于最高评分')
  })
  it('updates scores, statuses and counts in place while preserving the query and page', async () => {
    const filters = { ...EMPTY_JOB_FILTERS, status: ['pending'] }
    let finishRefresh!: (value: Response) => void
    const fetchMock = vi.fn().mockResolvedValueOnce(response(0))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishRefresh = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useJobSearch(filters, 2, 15, 'score', 'desc'))
    await act(async () => {})
    expect(result.current.items[0].score).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.loading).toBe(false)
    expect(result.current.items[0].status).toBe('pending')
    // Slow requests must not accumulate another fetch on each timer tick.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { finishRefresh(response(88, 1)) })
    expect(result.current.items[0].score).toBe(88)
    expect(result.current.items[0].status).toBe('scored')
    expect(result.current.total).toBe(1)
    expect(result.current.allTotal).toBe(3)
    expect(result.current.lastRefreshedAt).not.toBeNull()
    const url = new URL(fetchMock.mock.calls[1][0], 'http://localhost')
    expect(url.searchParams.get('offset')).toBe('30')
    expect(url.searchParams.getAll('status')).toEqual(['pending'])
    expect(url.searchParams.get('sort_by')).toBe('score')
  })

  it('polls when embedded visibility reports hidden and refreshes immediately on focus', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response(80)))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = renderHook(() => useJobSearch(EMPTY_JOB_FILTERS, 0, 15))
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    window.dispatchEvent(new Event('focus'))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('times out a stuck request and recovers on the next poll', async () => {
    const fetchMock = vi.fn().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })).mockImplementation(() => Promise.resolve(response(90)))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useJobSearch(EMPTY_JOB_FILTERS, 0, 15))
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(result.current.items[0].score).toBe(90)
    expect(result.current.error).toBe('')
    expect(result.current.loading).toBe(false)
  })

  it('ignores an old response when the user changes page during a refresh', async () => {
    let finishOld!: (value: Response) => void
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce(response(92))
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ page }) => useJobSearch(EMPTY_JOB_FILTERS, page, 15), { initialProps: { page: 0 } })
    rerender({ page: 1 })
    await act(async () => {})
    expect(result.current.items[0].score).toBe(92)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => { finishOld(response(10)) })
    expect(result.current.items[0].score).toBe(92)
  })
})
