import { chmodSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { appendBlock, ensureDir, frontList, frontString, listFilesDeep, parseFront, readText, writeText } from '../src/fs.js'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mesync-fs-'))
}

describe('parseFront', () => {
  it('解析标量与块列表', () => {
    const text = [
      '---',
      'id: code',
      'name: 代码开发',
      'when:',
      '  - 新增功能',
      '  - 修 bug',
      'produces: 可运行的代码',
      '---',
      '',
      '正文第一行',
    ].join('\n')

    const front = parseFront(text)
    expect(frontString(front, 'id')).toBe('code')
    expect(frontString(front, 'name')).toBe('代码开发')
    expect(frontList(front, 'when')).toEqual(['新增功能', '修 bug'])
    expect(frontString(front, 'produces')).toBe('可运行的代码')
    expect(front.body.trim()).toBe('正文第一行')
  })

  it('解析行内数组', () => {
    const front = parseFront(['---', 'tags: [a, b, c]', '---', '', 'x'].join('\n'))
    expect(frontList(front, 'tags')).toEqual(['a', 'b', 'c'])
  })

  it('没有 frontmatter 时整个文本都是正文', () => {
    const front = parseFront('# 标题\n\n内容')
    expect(front.fields).toEqual({})
    expect(front.body).toBe('# 标题\n\n内容')
  })

  it('缺字段时返回空值而不是抛错', () => {
    const front = parseFront(['---', 'id: x', '---', ''].join('\n'))
    expect(frontString(front, 'missing')).toBe('')
    expect(frontList(front, 'missing')).toEqual([])
  })
})

// 数据根不可写是**真实会发生的**（容器里 UID 不对、只读挂载、公司机器的权限策略）。
// 这种情况报原始 errno，Agent 只会拿同样的参数重试一遍然后放弃。
describe('ensureDir', () => {
  it('不可写时给的是能照着做的话', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return // root 不看权限位

    const dir = mkdtempSync(join(tmpdir(), 'mesync-ro-'))
    chmodSync(dir, 0o500)
    try {
      expect(() => ensureDir(join(dir, 'sub'))).toThrow(/数据根不可写/)
    } finally {
      chmodSync(dir, 0o700)
    }
  })

  it('别的错原样抛出，不瞎套话', () => {
    // /dev/null 是个文件，在它下面建目录是 ENOTDIR——不属于「数据根不可写」
    expect(() => ensureDir('/dev/null/nope')).toThrow()
    expect(() => ensureDir('/dev/null/nope')).not.toThrow(/数据根不可写/)
  })
})

describe('writeText / readText', () => {
  it('原子写入后可读回，并自动建目录', () => {
    const file = join(tempRoot(), 'deep', 'nested', 'a.md')
    writeText(file, '内容')
    expect(readText(file)).toBe('内容')
  })

  it('文件不存在时返回 null 而不是抛错', () => {
    expect(readText(join(tempRoot(), 'nope.md'))).toBeNull()
  })
})

describe('appendBlock', () => {
  it('首次写入带标题，二次追加不带标题', () => {
    const file = join(tempRoot(), 'tastes', 'naming.md')
    appendBlock(file, '# 品味：命名', '## 用完整单词\n\n- direction: prefer')
    appendBlock(file, '# 品味：命名', '## 不用缩写\n\n- direction: avoid')

    const text = readFileSync(file, 'utf8')
    expect(text.startsWith('# 品味：命名')).toBe(true)
    expect(text.match(/# 品味：命名/g)).toHaveLength(1)
    expect(text).toContain('## 用完整单词')
    expect(text).toContain('## 不用缩写')
  })

  it('同一条目重复追加不会写第二遍', () => {
    const file = join(tempRoot(), 'tastes', 'naming.md')
    appendBlock(file, '# 品味：命名', '## 用完整单词\n\n- direction: prefer')
    const again = appendBlock(file, '# 品味：命名', '## 用完整单词\n\n- direction: prefer')

    expect(again).toBe(false)
    expect(readFileSync(file, 'utf8').match(/## 用完整单词/g)).toHaveLength(1)
  })
})

describe('listFilesDeep', () => {
  it('递归列出文件并跳过不存在的目录', () => {
    const root = tempRoot()
    writeText(join(root, 'wiki', 'a.md'), 'a')
    writeText(join(root, 'wiki', 'sub', 'b.md'), 'b')
    writeText(join(root, 'wiki', 'sub', 'c.txt'), 'c')

    expect(listFilesDeep(join(root, 'wiki'), '.md')).toHaveLength(2)
    expect(listFilesDeep(join(root, 'missing'), '.md')).toEqual([])
    expect(existsSync(join(root, 'wiki', 'a.md'))).toBe(true)
  })
})