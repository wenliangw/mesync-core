import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readText } from '../src/fs.js'
import {
  appendPath,
  discard,
  listRecords,
  pendingFiles,
  readByRel,
  readRecordFile,
  writeRecord,
} from '../src/memory.js'

const root = () => mkdtempSync(join(tmpdir(), 'mesync-mem-'))

describe('writeRecord / readRecordFile', () => {
  it('项目级记录带上 scope、scenario、project、created', () => {
    const r = root()
    const { file } = writeRecord({
      root: r,
      scope: 'project',
      scenario: 'code',
      project: 'owner-repo',
      kind: 'decision',
      title: '不建索引',
      content: '扫文件即可。',
    })

    const record = readRecordFile(r, file)!
    expect(record.kind).toBe('decision')
    expect(record.scope).toBe('project')
    expect(record.scenario).toBe('code')
    expect(record.project).toBe('owner-repo')
    expect(record.title).toBe('不建索引')
    expect(record.created).not.toBe('')
    expect(record.body).toContain('扫文件即可')
  })

  it('场景级记录不写 project 字段', () => {
    const r = root()
    const { file } = writeRecord({
      root: r,
      scope: 'scenario',
      scenario: 'code',
      project: 'whatever',
      kind: 'taste',
      title: '都用 pnpm',
      content: '偏好。',
    })
    expect(readText(file)).not.toContain('project:')
  })

  it('正文是多行散文，frontmatter 只放定位字段', () => {
    const r = root()
    const { file } = writeRecord({
      root: r,
      scope: 'project',
      scenario: 'code',
      project: 'p',
      kind: 'correction',
      title: '忘了跑测试',
      content: '症状：改完没测\n触发：赶时间\n检查：跑 npm test\n止损：回滚',
    })
    const text = readText(file)!
    expect(text.startsWith('---')).toBe(true)
    expect(text).toContain('症状：改完没测')
    // 正文里的多行不能被塞进 frontmatter
    expect(text.split('---')[1]).not.toContain('症状')
  })
})

describe('listRecords', () => {
  it('按 kind 分子目录读回，两层互不串', () => {
    const r = root()
    writeRecord({ root: r, scope: 'scenario', scenario: 'code', project: '', kind: 'cognition', title: '通用', content: 'x' })
    writeRecord({ root: r, scope: 'project', scenario: 'code', project: 'a', kind: 'cognition', title: 'A 的', content: 'x' })
    writeRecord({ root: r, scope: 'project', scenario: 'code', project: 'b', kind: 'taste', title: 'B 的', content: 'x' })

    expect(listRecords(r, 'scenario', 'code', '').map((x) => x.title)).toEqual(['通用'])
    expect(listRecords(r, 'project', 'code', 'a').map((x) => x.title)).toEqual(['A 的'])
    expect(listRecords(r, 'project', 'code', 'b').map((x) => x.title)).toEqual(['B 的'])
  })

  it('空目录返回空数组而不是报错', () => {
    expect(listRecords(root(), 'project', 'nope', 'nope')).toEqual([])
  })
})

describe('临时区', () => {
  it('pending 不进入正式记录，单独可列出', () => {
    const r = root()
    writeRecord({ root: r, scope: 'project', scenario: 'code', project: 'a', kind: 'pending', title: '待验证', content: 'x' })

    expect(listRecords(r, 'project', 'code', 'a')).toEqual([])
    expect(pendingFiles(r).length).toBe(1)
  })
})

describe('路径记录', () => {
  it('多次追加，保留时间序', () => {
    const r = root()
    appendPath(r, 'code', 'p', 'M0!→M1!→M2!→M3!→M4!→K! 第一条')
    const { file } = appendPath(r, 'code', 'p', 'M0!→M1?→M2!→M3!→M4!→没有 第二条')

    const text = readText(file)!
    expect(text.indexOf('第一条')).toBeLessThan(text.indexOf('第二条'))
    expect(text).toContain('M1?')
  })
})

describe('readByRel / discard', () => {
  it('读不到返回 null，删掉返回真假', () => {
    const r = root()
    expect(readByRel(r, 'meta/nope.md')).toBeNull()

    const { rel } = writeRecord({
      root: r,
      scope: 'project',
      scenario: 'code',
      project: 'p',
      kind: 'cognition',
      title: '要删的',
      content: 'x',
    })
    expect(readByRel(r, rel)).not.toBeNull()
    expect(discard(join(r, rel))).toBe(true)
    expect(readByRel(r, rel)).toBeNull()
    expect(discard(join(r, rel))).toBe(false)
  })
})