import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { patchStateFor, readState, readStateFor } from '../src/state.js'

const root = () => mkdtempSync(join(tmpdir(), 'mesync-state-'))

describe('按项目分键', () => {
  it('两个项目各记各的场景', () => {
    const dir = root()
    patchStateFor(dir, 'alpha', { scenario: 'design' })
    patchStateFor(dir, 'beta', { scenario: 'code' })

    expect(readStateFor(dir, 'alpha').scenario).toBe('design')
    expect(readStateFor(dir, 'beta').scenario).toBe('code')
  })

  // 这条是修复的核心：以前写 beta 会把 alpha 的记录整份覆盖掉。
  it('后写的项目不覆盖先写的', () => {
    const dir = root()
    patchStateFor(dir, 'alpha', { scenario: 'design' })
    patchStateFor(dir, 'beta', { scenario: 'code' })

    expect(readState(dir).projects.alpha.scenario).toBe('design')
  })

  it('没记过的项目是空的，不拿别人的', () => {
    const dir = root()
    patchStateFor(dir, 'alpha', { scenario: 'design' })

    expect(readStateFor(dir, 'gamma')).toEqual({})
  })

  // 项目未知（拿不到 cwd）时不写也不读：没有归属的场景记下来，只会让下一次
  // 调用误以为自己是那个场景。
  it('项目未知时既不写也不读', () => {
    const dir = root()
    patchStateFor(dir, '', { scenario: 'design' })

    expect(readState(dir).projects).toEqual({})
    expect(readStateFor(dir, '').scenario).toBeUndefined()
  })
})

describe('兼容与容错', () => {
  it('读到老形状的文件时迁移到当时那个项目名下', () => {
    const dir = root()
    mkdirSync(join(dir, '.runtime'), { recursive: true })
    writeFileSync(
      join(dir, '.runtime', 'state.json'),
      JSON.stringify({ scenario: 'prd', project: 'alpha', updatedAt: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    )

    // 升级后提示不丢……
    expect(readStateFor(dir, 'alpha').scenario).toBe('prd')
    // ……但也不会让别的项目以为那是自己的
    expect(readStateFor(dir, 'beta').scenario).toBeUndefined()
  })

  it('文件损坏时当成没记过，不抛错', () => {
    // 状态只是「省一次重复推断」的提示，它坏掉不该影响工具能不能用
    const dir = root()
    mkdirSync(join(dir, '.runtime'), { recursive: true })
    writeFileSync(join(dir, '.runtime', 'state.json'), '{坏掉的 json', 'utf8')

    expect(readState(dir).projects).toEqual({})
  })

  it('没有任何状态文件时返回空', () => {
    expect(readState(root()).projects).toEqual({})
  })
})