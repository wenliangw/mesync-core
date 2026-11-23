// 跨仓库漂移守卫
//
// 心法 md 在 mesync-core 里，工具在 dsh-mesync 里——两边的契约是**文本**：
// 链上写着「调 scenario_load」，模板里写着「用 doc_write 记规则」。
// 这种契约没有类型检查能兜住，只能靠测试扫文本。
//
// 断掉的后果特别隐蔽：Agent 走到那一步发现工具不存在，不会报错，只会安静地
// 按自己的理解绕过去。所以这一组必须存在。

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assetsDir } from '../src/assets.js'
import { readText } from '../src/fs.js'
import { CHAIN_DOCS, META_NAMES, readChainDoc, readMeta, readUseDoc } from '../src/meta.js'
import { TOOLS } from '../src/tools.js'

const root = () => '/tmp/mesync-chain-' + process.pid

/** core 内容目录下的全部 markdown。 */
function templateFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) out.push(full)
    }
  }
  walk(assetsDir())
  return out
}

describe('内核内容可用（mesync-core 真的装上了）', () => {
  it('五份心法齐备且非空', () => {
    for (const name of META_NAMES) {
      const text = readMeta(root(), name)
      expect(text, `meta/${name}.md`).not.toBeNull()
      expect(text!.length, `meta/${name}.md 太短`).toBeGreaterThan(300)
    }
  })

  it('两份链文件齐备', () => {
    for (const name of CHAIN_DOCS) {
      const text = readChainDoc(root(), name)
      expect(text, name).not.toBeNull()
      expect(text!.length, name).toBeGreaterThan(300)
    }
  })

  it('常驻文本是链的形状，不是能力清单', () => {
    const use = readUseDoc(root())!
    for (const node of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5']) {
      expect(use, `常驻文本缺 ${node}`).toContain(node)
    }
    expect(use).toContain('问用户')
    expect(use).toContain('自己判')
  })

  it('常驻体积在预算内', () => {
    expect(readUseDoc(root())!.length).toBeLessThan(1200)
  })
})

describe('模板与工具面不漂移', () => {
  it('模板提到的工具都已实现', () => {
    const implemented = new Set(TOOLS.map((tool) => tool.name))
    const mentioned = new Set<string>()
    for (const file of templateFiles()) {
      const text = readText(file) ?? ''
      for (const match of text.matchAll(
        /\b(memory_[a-z]+|doc_write|scenario_load|mesync_context|path_record)\b/g,
      )) {
        mentioned.add(match[1])
      }
    }
    expect(mentioned.size).toBeGreaterThan(0)
    for (const name of mentioned) {
      expect([...implemented], `模板提到了未实现的工具 ${name}`).toContain(name)
    }
  })

  it('实现的所有工具都在模板里被提到过（否则就是没人用的工具）', () => {
    const all = templateFiles()
      .map((file) => readText(file) ?? '')
      .join('\n')
    for (const tool of TOOLS) {
      expect(all, `工具 ${tool.name} 在任何模板里都没出现`).toContain(tool.name)
    }
  })

  it('模板里不再出现别的代的工具名', () => {
    const stale = ['decision_remember', 'wiki_write', 'recall_detail', 'mesync_sync_wiki']
    for (const file of templateFiles()) {
      const text = readText(file) ?? ''
      for (const name of stale) {
        expect(text, `${file} 还提到旧工具 ${name}`).not.toContain(name)
      }
    }
  })

  it('judge 的五个叶子都指向真实心法', () => {
    const judge = readChainDoc(root(), 'chain-judge.md')!
    const leaves = new Set([...judge.matchAll(/meta\/([a-z]+)\.md/g)].map((match) => match[1]))
    expect(leaves.size).toBe(5)
    for (const name of leaves) expect(META_NAMES).toContain(name as never)
  })
})
