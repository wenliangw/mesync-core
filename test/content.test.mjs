// 内容守卫：这几份 md 是接入方唯一依赖的东西，缺一份整条链就断。
//
// 零依赖，用 node 自带的测试跑：npm test（连同 vitest 那套一起）
// 这里只检查「文件在、非空、链引用的路径都存在」——内容怎么写归心法管，
// 测试不做文字审查。

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const templates = join(root, 'templates')

const read = (rel) => readFileSync(join(templates, rel), 'utf8')

const META = ['cognition', 'decision', 'taste', 'correction', 'tool']
const CHAIN = ['chain-judge.md', 'chain-rules.md']
const SCENARIOS = ['code', 'design', 'prd']

test('常驻主文件在，且体量有预算', () => {
  const use = read('mesync-use.md')
  assert.ok(use.length > 200, 'mesync-use.md 太短')
  assert.ok(use.length < 1200, `常驻正文超预算：${use.length} 字符`)
  for (const node of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5']) {
    assert.ok(use.includes(node), `常驻文本缺 ${node}`)
  }
})

test('五份心法齐备且非空', () => {
  for (const name of META) {
    const text = read(`meta/${name}.md`)
    assert.ok(text.trim().length > 300, `meta/${name}.md 太短`)
  }
})

test('两份链文件齐备', () => {
  for (const name of CHAIN) {
    assert.ok(read(name).trim().length > 300, `${name} 太短`)
  }
})

test('三个场景都有场景卡与工作说明', () => {
  for (const id of SCENARIOS) {
    assert.ok(read(`scenarios/${id}/scenario.md`).includes('验收'), `${id} 缺验收`)
    assert.ok(read(`scenarios/${id}/AGENT.md`).trim().length > 100, `${id} 的 AGENT.md 太短`)
  }
})

test('判断分支的五个叶子都指向真实心法', () => {
  const judge = read('chain-judge.md')
  const leaves = new Set([...judge.matchAll(/meta\/([a-z]+)\.md/g)].map((m) => m[1]))
  assert.equal(leaves.size, 5, `叶子数应为 5，实际 ${[...leaves].join(',')}`)
  for (const name of leaves) assert.ok(META.includes(name), `引用了不存在的 meta/${name}.md`)
})

test('常驻文本引用的模板都存在', () => {
  const use = read('mesync-use.md')
  // 只校验「模板内」的路径。rules.md / AGENT.md 是数据根里的路径，由各平台实现，
  // 不该在这里检查；meta/<kind>.md 这种带尖括号的写法会被正则切出残片，跳过。
  const referenced = new Set([...use.matchAll(/[A-Za-z0-9_./-]+\.md/g)].map((m) => m[0]))
  for (const rel of referenced) {
    if (!rel.startsWith('meta/') && !rel.startsWith('chain-')) continue
    assert.ok(existsSync(join(templates, rel)), `常驻文本引用了不存在的 ${rel}`)
  }
})

test('不出现别的代的工具名', () => {
  const stale = ['decision_remember', 'wiki_write', 'recall_detail', 'mesync_sync_wiki']
  const files = [
    'mesync-use.md',
    'chain-judge.md',
    'chain-rules.md',
    ...META.map((m) => `meta/${m}.md`),
  ]
  for (const rel of files) {
    const text = read(rel)
    for (const name of stale) assert.ok(!text.includes(name), `${rel} 还提到旧工具 ${name}`)
  }
})

test('包形状：md 导出、机制入口、命令入口都在，且没有运行期依赖', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  // 零依赖是刻意的：core 只绑 Node 内置模块。接一个 SDK 就会把「能不能离线跑」
  // 绑到别人的发布节奏上，而那正是这个包想避免的。
  assert.equal(pkg.dependencies, undefined, '不该有运行期依赖')

  // 机制入口与内容入口并存：机制编译到 lib/，md 仍是接入方直接读的那一份。
  assert.match(pkg.exports['.'].default, /^\.\/lib\/[^/]+\.js$/, '机制入口应指向编译产物')
  for (const key of ['./use.md', './chain-judge.md', './chain-rules.md', './meta/*.md']) {
    assert.ok(pkg.exports[key], `md 导出缺 ${key}`)
  }

  // 命令入口：没有插件 API 的框架靠它接进来（hook 形态 / MCP 形态）。
  // 声明了就得真的在包里，否则 `npm i` 之后 mesync 命令指向一个不存在的文件。
  assert.ok(pkg.bin?.mesync, '应声明 mesync 命令')
  assert.ok(existsSync(join(root, pkg.bin.mesync)), `bin 指向的文件不存在：${pkg.bin.mesync}`)
})