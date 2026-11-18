import { expect, it } from 'vitest'
import { parseJobDescription } from './jdFormatter'

it('parses compacted single-line JD into structured sections and items', () => {
  const sampleJd =
    'Windows软件运维JavaC 工作职责1. 覆盖项目驻地及办公区全场景IT运维需求，负责桌面终端、办公外设、网络链路、会议系统等软硬件设备的日常巡检、故障排查与快速修复。 2. 支撑工程类专业软件的环境部署与版本适配，包括广联达、CAD等业务工具。 3. 负责公司及项目端信息资产的台账管理。'

  const sections = parseJobDescription(sampleJd)
  expect(sections.length).toBeGreaterThanOrEqual(1)

  const dutiesSection = sections.find(s => s.kind === 'duties')
  expect(dutiesSection).toBeDefined()
  expect(dutiesSection?.items.length).toBe(3)
  expect(dutiesSection?.items[0]).toContain('覆盖项目驻地及办公区全场景IT运维需求')
  expect(dutiesSection?.items[1]).toContain('支撑工程类专业软件的环境部署与版本适配')
  expect(dutiesSection?.items[2]).toContain('负责公司及项目端信息资产的台账管理')
})

it('parses multi-section JD with both duties and requirements', () => {
  const sample = `
    工作职责：
    1. 负责前端业务开发
    2. 参与架构重构
    任职要求：
    1. 熟练掌握 React 与 TypeScript
    2. 3年以上工作经验
  `
  const sections = parseJobDescription(sample)
  expect(sections.length).toBe(2)
  expect(sections[0].kind).toBe('duties')
  expect(sections[0].items.length).toBe(2)
  expect(sections[1].kind).toBe('requirements')
  expect(sections[1].items.length).toBe(2)
})

it('handles raw text without explicit section headers cleanly', () => {
  const sample = '1. 负责日常巡检； 2. 及时处理系统告警； 3. 完成领导交办的其他事务。'
  const sections = parseJobDescription(sample)
  expect(sections.length).toBe(1)
  expect(sections[0].items.length).toBe(3)
})
