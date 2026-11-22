// 内容守卫：这几份 md 是接入方唯一依赖的东西，缺一份整条链就断。
//
// 零依赖，用 node 自带的测试跑：npm test
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

test('包是纯内容：没有可执行代码', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.bin, undefined, '内容包不该有 bin')
  assert.equal(pkg.main, undefined, '内容包不该有 main')
  assert.equal(pkg.dependencies, undefined, '内容包不该有依赖')
})