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
    expect(resolveRoot('/tmp/custom-root')).toBe('/tmp/custom-root')
  })

  it('缺省落在 ~/.dsh-mesync（用户级：记忆跟人走）', () => {
    expect(resolveRoot('')).toBe(join(homedir(), '.dsh-mesync'))
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

  it('每层都有 AGENT.md、rules.md 与 records/', () => {
    const layer = layerPaths('/root/scenarios/code')
    expect(layer.agentDoc).toBe(join('/root/scenarios/code', 'AGENT.md'))
    expect(layer.rules).toBe(join('/root/scenarios/code', 'rules.md'))
    expect(layer.records).toBe(join('/root/scenarios/code', 'records'))
  })
})