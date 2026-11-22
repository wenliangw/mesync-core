import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assetFile } from '../src/assets.js'
import { readText } from '../src/fs.js'
import { CHAIN_DOCS, META_NAMES, readChainDoc, readMeta, readUseDoc } from '../src/meta.js'
import { TOOLS } from '../src/tools.js'

const root = () => mkdtempSync(join(tmpdir(), 'mesync-chain-'))

/** 模板目录下的全部 markdown。 */
function templateFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) out.push(full)
    }
  }
  walk(join(process.cwd(), 'src', 'templates'))
  return out
}

/**
 * 这一组测的是「链引用的东西真的存在」。
 *
 * 链是常驻的，它上面每写一个路径，Agent 走到那里就会真去读。缺一个文件，
 * 那条路就是断的——而且断得很难发现（Agent 只会安静地按自己的理解往下走）。
 */
describe('链引用的文件都真实存在', () => {
  it('五份心法齐备且非空', () => {
    const r = root()
    for (const name of META_NAMES) {
      const text = readMeta(r, name)
      expect(text, `meta/${name}.md`).not.toBeNull()
      expect(text!.length, `meta/${name}.md 太短`).toBeGreaterThan(300)
    }
  })

  it('两份链文件齐备（判断分支 + 维护规则）', () => {
    const r = root()
    for (const name of CHAIN_DOCS) {
      const text = readChainDoc(r, name)
      expect(text, name).not.toBeNull()
      expect(text!.length, name).toBeGreaterThan(300)
    }
  })

  it('常驻文本提到的每个资源路径都能读到', () => {
    const use = readUseDoc(root())!
    const referenced = new Set<string>()
    for (const match of use.matchAll(/[A-Za-z0-9_./-]+\.md/g)) referenced.add(match[0])

    expect(referenced.size).toBeGreaterThan(0)
    for (const rel of referenced) {
      if (rel.includes('<')) continue
      const isRootDoc = rel.startsWith('meta/') || rel.startsWith('chain-')
      if (!isRootDoc) continue
      expect(readText(assetFile(rel)), `常驻文本引用了不存在的 ${rel}`).not.toBeNull()
    }
  })

  it('chain-judge 的五个叶子都指向真的心法文件', () => {
    const judge = readChainDoc(root(), 'chain-judge.md')!
    const leaves = [...judge.matchAll(/meta\/([a-z]+)\.md/g)].map((match) => match[1])
    expect(new Set(leaves).size).toBe(5)
    for (const name of leaves) expect(META_NAMES).toContain(name as never)
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
    const names = new Set(TOOLS.map((tool) => tool.name))
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
      expect([...names], `模板提到了不存在的工具 ${name}`).toContain(name)
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
})

describe('内核的平台无关性', () => {
  it('源码里没有任何平台包的 import', () => {
    const dir = join(process.cwd(), 'src')
    const files: string[] = []
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) files.push(full)
      }
    }
    walk(dir)

    const banned = [/from\s+['"]@deepseek-ai\//, /require\(\s*['"]@deepseek-ai\//, /from\s+['"]dsh-/]
    for (const file of files) {
      const text = readText(file) ?? ''
      for (const pattern of banned) {
        expect(pattern.test(text), `${file} 引用了平台包`).toBe(false)
      }
    }
  })

  it('包依赖里没有平台包', async () => {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.peerDependencies }
    for (const name of Object.keys(all)) {
      expect(name.startsWith('@deepseek-ai/'), `依赖里出现了平台包 ${name}`).toBe(false)
    }
  })
})