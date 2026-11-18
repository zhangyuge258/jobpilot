import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ScoreDetails } from './ScoreDetails'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows saved component scores and evidence independently of job status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    state: 'available', trace: {
      role_summary: '嵌入式开发', final_score: 82,
      components: { core_duties: { score: 34, max_score: 40, evidence: 'STM32 项目证据' } },
      summary_reason: '核心技能匹配', hard_gaps: ['部分技能待核实'], caps: [], missing: '毕业届别',
    },
  }), { headers: { 'Content-Type': 'application/json' } })))
  render(<ScoreDetails jobId="manual-sent" score={82} reason="完整评分及封顶说明" />)
  expect(await screen.findByText('核心职责：34 / 40')).toBeTruthy()
  expect(screen.getByText('STM32 项目证据')).toBeTruthy()
  expect(screen.getByText('待核实：毕业届别')).toBeTruthy()
  fireEvent.click(screen.getByText('完整评分说明'))
  expect(screen.getByText('完整评分及封顶说明')).toBeTruthy()
})

it('keeps the complete legacy explanation when structured details are unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'unavailable' }))))
  render(<ScoreDetails jobId="legacy" score={0} reason="预筛不通过：明确的资格要求不满足" />)
  expect(await screen.findByText('预筛不通过：明确的资格要求不满足')).toBeTruthy()
})
