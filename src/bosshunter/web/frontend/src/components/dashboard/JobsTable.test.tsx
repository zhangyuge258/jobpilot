import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { JobsTable } from './JobsTable'
import { EMPTY_JOB_FILTERS, type JobFilters } from '@/lib/jobFilters'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('retains independent column values, supports multi-select portals and clears all conditions', async () => {
  const changed = vi.fn()
  function Table() {
    const [filters, setFilters] = useState<JobFilters>({ ...EMPTY_JOB_FILTERS })
    return <JobsTable jobs={[]} page={0} pageSize={15} total={0} onPageChange={vi.fn()} selectedIds={[]} onToggleSelected={vi.fn()} sortBy="created_at" sortOrder="desc" onSortChange={vi.fn()} filters={filters} onFiltersChange={value => { changed(value); setFilters(value) }} cityOptions={['天津', '北京']} titleOptions={['嵌入式软件工程师', '嵌入式硬件工程师', '销售工程师']} />
  }
  render(<Table />)
  fireEvent.change(screen.getByLabelText('按公司筛选'), { target: { value: '芯片' } })
  fireEvent.click(screen.getByRole('group', { name: '列筛选：职位选项' }).querySelector('summary')!)
  const titles = await screen.findByRole('group', { name: '列筛选：职位选项列表' })
  const beforeSearch = changed.mock.calls.length
  fireEvent.change(within(titles).getByRole('searchbox'), { target: { value: '嵌入式' } })
  expect(changed.mock.calls.length).toBe(beforeSearch)
  expect(within(titles).queryByRole('checkbox', { name: '销售工程师' })).toBeNull()
  fireEvent.click(within(titles).getByRole('checkbox', { name: '全选搜索结果' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.change(screen.getByLabelText('列筛选最高评分'), { target: { value: '90' } })
  const trigger = screen.getByRole('group', { name: '列筛选：城市选项' }).querySelector('summary')!
  fireEvent.click(trigger)
  const menu = await screen.findByRole('group', { name: '列筛选：城市选项列表' })
  expect(trigger.closest('details')!.contains(menu)).toBe(false)
  fireEvent.pointerDown(within(menu).getByRole('checkbox', { name: '天津' }))
  fireEvent.click(within(menu).getByRole('checkbox', { name: '天津' }))
  fireEvent.click(within(menu).getByRole('checkbox', { name: '北京' }))
  expect(changed.mock.lastCall?.[0]).toMatchObject({ company: '芯片', titles: ['嵌入式软件工程师', '嵌入式硬件工程师'], maxScore: '90', city: ['天津', '北京'] })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(trigger.closest('details')!.open).toBe(false)
  expect(screen.queryByRole('group', { name: '列筛选：城市选项列表' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '清空全部列筛选' }))
  expect(changed.mock.lastCall?.[0]).toEqual(EMPTY_JOB_FILTERS)
})

it('shows a top scrollbar only when needed and synchronizes it with the table', () => {
  let availableWidth = 700
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('aria-label') === '岗位表格' ? availableWidth : 0 })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('aria-label') === '岗位表格' ? 900 : 0 })
  render(<JobsTable jobs={[]} page={0} pageSize={15} total={0} onPageChange={vi.fn()} selectedIds={[]} onToggleSelected={vi.fn()} sortBy="created_at" sortOrder="desc" onSortChange={vi.fn()} onStatusChange={vi.fn()} />)
  const top = screen.getByRole('region', { name: '岗位表格横向滚动条' })
  const viewport = screen.getByRole('region', { name: '岗位表格' })
  top.scrollLeft = 150
  fireEvent.scroll(top)
  expect(viewport.scrollLeft).toBe(150)
  viewport.scrollLeft = 240
  fireEvent.scroll(viewport)
  expect(top.scrollLeft).toBe(240)
  availableWidth = 1200
  fireEvent.resize(window)
  expect(screen.queryByRole('region', { name: '岗位表格横向滚动条' })).toBeNull()
})
