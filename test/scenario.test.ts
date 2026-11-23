import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { writeText } from '../src/fs.js'
import { listScenarios, readScenario, scenarioLines } from '../src/scenario.js'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mesync-scn-'))
}

describe('listScenarios', () => {
  it('预置场景随插件发布，无需用户配置', () => {
    const root = tempRoot()
    const cards = listScenarios(root)
    const ids = cards.map((card) => card.id)

    expect(ids).toContain('code')
    expect(ids).toContain('design')
    expect(ids).toContain('prd')
    expect(cards.every((card) => card.source === 'preset')).toBe(true)
  })

  it('用户卡可以覆盖预置卡（同 id）', () => {
    const root = tempRoot()
    writeText(
      join(root, 'scenarios', 'code', 'scenario.md'),
      ['---', 'id: code', 'name: 我的代码场景', 'description: 自定义', 'when:', '  - 写代码', '---', ''].join('\n'),
    )

    const card = listScenarios(root).find((item) => item.id === 'code')
    expect(card?.name).toBe('我的代码场景')
    expect(card?.source).toBe('user')
    expect(card?.dir).toBe(join(root, 'scenarios', 'code'))
  })

  it('用户只加了产物目录时沿用预置卡', () => {
    const root = tempRoot()
    writeText(join(root, 'scenarios', 'code', 'features', 'p1', 'wiki', 'a.md'), 'x')

    const card = listScenarios(root).find((item) => item.id === 'code')
    expect(card?.source).toBe('preset')
    expect(card?.name).toBe('代码开发')
  })

  it('用户自建场景即使没有卡也会出现在清单里', () => {
    const root = tempRoot()
    writeText(join(root, 'scenarios', 'writing', 'AGENT.md'), '# 写作')

    const card = listScenarios(root).find((item) => item.id === 'writing')
    expect(card).toBeDefined()
    expect(card?.source).toBe('user')
  })
})

describe('readScenario', () => {
  it('加载预置场景的 AGENT.md 与目录', () => {
    const root = tempRoot()
    const detail = readScenario(root, 'code')

    expect(detail).not.toBeNull()
    expect(detail?.agentDoc).toContain('代码开发场景')
    expect(detail?.tools).toEqual([])
  })

  it('用户 AGENT.md 覆盖预置', () => {
    const root = tempRoot()
    writeText(join(root, 'scenarios', 'code', 'AGENT.md'), '# 我的执行说明')

    expect(readScenario(root, 'code')?.agentDoc).toContain('我的执行说明')
  })

  it('列出场景自带的工具', () => {
    const root = tempRoot()
    writeText(join(root, 'scenarios', 'code', 'tools', 'check.sh'), 'echo hi')

    const detail = readScenario(root, 'code')
    expect(detail?.tools).toEqual(['check.sh'])
  })

  it('未知场景返回 null', () => {
    expect(readScenario(tempRoot(), 'nope')).toBeNull()
  })
})

describe('scenarioLines', () => {
  it('清单行带名称、描述、判据与产出', () => {
    const lines = scenarioLines(listScenarios(tempRoot())).join('\n')
    expect(lines).toContain('code（代码开发）')
    expect(lines).toContain('产出 可运行')
    expect(lines).toContain('判据')
  })

  it('没有场景时给出去哪建卡的提示', () => {
    // 用不存在任何场景的假根（assets 里始终有预置场景，这里只验兜底文案本身）
    expect(scenarioLines([])[0]).toContain('scenarios')
  })
})