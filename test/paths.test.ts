import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { layerPaths, projectDir, projectId, resolveRoot, sanitizeId } from '../src/paths.js'

describe('sanitizeId', () => {
  it('收敛成目录名安全的小写 slug', () => {
    expect(sanitizeId('Owner/Repo X')).toBe('owner-repo-x')
    expect(sanitizeId('  A__B  ')).toBe('a__b')
  })

  it('全是非法字符时退回 untitled', () => {
    expect(sanitizeId('///')).toBe('untitled')
    expect(sanitizeId('')).toBe('untitled')
  })
})

describe('resolveRoot', () => {
  it('显式配置优先', () => {
    expect(resolveRoot({ configured: '/tmp/custom-root' })).toBe('/tmp/custom-root')
  })

  it('缺省落在 ~/.mesync（用户级：记忆跟人走；不含任何框架名）', () => {
    expect(resolveRoot({ configured: '' })).toBe(join(homedir(), '.mesync'))
  })

  // 适配层要用自己的目录名时传 dirName——dsh 就是靠这个沿用老用户的 ~/.dsh-mesync。
  it('适配层可以换目录名', () => {
    expect(resolveRoot({ dirName: '.dsh-mesync' })).toBe(join(homedir(), '.dsh-mesync'))
  })

  it('坏值不生效，回落默认', () => {
    expect(resolveRoot({ dirName: '   ' })).toBe(join(homedir(), '.mesync'))
  })
})

describe('projectId', () => {
  it('非 git 目录退回目录名', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mesync-proj-'))
    expect(projectId(dir)).toBe(sanitizeId(basename(dir)))
  })

  it('每次调用结果稳定', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mesync-proj-'))
    expect(projectId(dir)).toBe(projectId(dir))
  })
})

describe('两层作用域', () => {
  it('项目层落在 场景/features/项目 下', () => {
    expect(projectDir('/root', 'code', 'owner-repo')).toBe(
      join('/root', 'scenarios', 'code', 'features', 'owner-repo'),
    )
  })

  it('每层只有一个交付文件 AGENT.md，加上 records/', () => {
    const layer = layerPaths('/root/scenarios/code')
    expect(layer.agentDoc).toBe(join('/root/scenarios/code', 'AGENT.md'))
    expect(layer.records).toBe(join('/root/scenarios/code', 'records'))
    // 硬规则已并入 AGENT.md——层里不该再有第二个会长大的交付文件
    expect(Object.keys(layer).sort()).toEqual(['agentDoc', 'dir', 'records'])
  })
})