import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FormattedJobDescription } from './FormattedJobDescription'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('renders structured sections with numbered bullets and AI score reason highlight', () => {
  const sampleJd =
    'Windows软件运维JavaC 工作职责1. 覆盖项目驻地及办公区全场景IT运维需求。 2. 支撑工程类专业软件的环境部署与版本适配，包括CAD。 3. 负责公司及项目端信息资产的台账管理。'

  render(
    <FormattedJobDescription
      jd={sampleJd}
      scoreReason="具备桌面运维与专业软件部署经验，核心契合"
    />
  )

  // AI score reason should be prominently shown
  expect(screen.getByText('AI 匹配核心重点')).toBeTruthy()
  expect(screen.getByText('具备桌面运维与专业软件部署经验，核心契合')).toBeTruthy()

  // Formatted sections should appear
  expect(screen.getByText('岗位职责')).toBeTruthy()
  expect(screen.getByText(/覆盖项目驻地及办公区全场景IT运维需求/)).toBeTruthy()
  expect(screen.getByText(/支撑工程类专业软件的环境部署与版本适配/)).toBeTruthy()

  // Supports toggling back to raw text
  const toggleBtn = screen.getByText('查看原文')
  fireEvent.click(toggleBtn)

  expect(screen.getByText('精读分段')).toBeTruthy()
  expect(screen.getByText(sampleJd)).toBeTruthy()
})

it('handles empty jd gracefully', () => {
  render(<FormattedJobDescription jd="" />)
  expect(screen.getByText('暂无详细岗位描述')).toBeTruthy()
})
