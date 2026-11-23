import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { residentText } from '../src/resident.js'

const root = () => mkdtempSync(join(tmpdir(), 'mesync-res-'))

describe('常驻正文', () => {
  it('链在最前面，场景清单与覆盖度在它之后', () => {
    const { text } = residentText({ root: root(), cwd: '/tmp/ws', project: 'demo' })
    const chainAt = text.indexOf('M0')
    const scenarioAt = text.indexOf('## 场景')
    const coverageAt = text.indexOf('## 记忆覆盖度')

    expect(chainAt).toBeGreaterThan(-1)
    expect(scenarioAt).toBeGreaterThan(chainAt)
    expect(coverageAt).toBeGreaterThan(scenarioAt)
  })

  it('不把心法正文塞进注入', () => {
    const { text } = residentText({ root: root(), cwd: '/tmp/ws', project: 'demo' })
    expect(text).not.toContain('## 决策：为什么这么定')
    expect(text).not.toContain('## 认知：客观事实')
  })

  it('带上契约标记与场景 id', () => {
    const { text } = residentText({ root: root(), cwd: '/tmp/ws', project: 'demo' })
    expect(text.startsWith('<!-- mesync:contract -->')).toBe(true)
    expect(text).toContain('scenario_load')
    expect(text).toContain('code（代码开发）')
    expect(text).toContain('design（交互设计）')
    expect(text).toContain('prd（产品需求）')
  })

  it('超限时按顺序丢弃并如实报告', () => {
    const { text, dropped } = residentText({ root: root(), cwd: '/tmp/ws', project: 'demo', limit: 300 })
    expect(dropped.length).toBeGreaterThan(0)
    expect(text.length).toBeLessThanOrEqual(300)
  })

  it('正常体量不丢任何一段', () => {
    const { text, dropped } = residentText({ root: root(), cwd: '/tmp/ws', project: 'demo' })
    expect(dropped).toEqual([])
    expect(text.length).toBeLessThan(16_000)
  })

  it('数据根不存在也能组装', () => {
    const { text } = residentText({ root: '/tmp/mesync-none-' + Date.now(), cwd: '/tmp/ws' })
    expect(text).toContain('M0')
  })
})