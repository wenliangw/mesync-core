// coverage — 产物覆盖度
//
// 它回答「Agent 现在知道多少」。没有它，Agent 会以为记忆是空的而重复探索，
// 或者以为记忆很满而漏掉该读的东西。
//
// 两层都要数：场景级（跨项目通用）和项目级。只数项目级会让「向上」记的那部分
// 变成隐形的——写进去了，但注入里看不见，Agent 就以为没有。

import { join } from 'node:path'

import { listDirs } from './fs.js'
import { listRecords } from './memory.js'
import { scenarioDir } from './paths.js'
import { listScenarios } from './scenario.js'
import type { Coverage } from './types.js'

function countsFor(
  root: string,
  scope: 'scenario' | 'project',
  scenario: string,
  project: string,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of listRecords(root, scope, scenario, project)) {
    counts[record.kind] = (counts[record.kind] ?? 0) + 1
  }
  return counts
}

function row(
  root: string,
  scope: 'scenario' | 'project',
  scenario: string,
  project: string,
): Coverage {
  const counts = countsFor(root, scope, scenario, project)
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  return { scenario, project, scope, counts, total }
}

/** 全部覆盖度，可按场景过滤。场景层排在它的项目层之前。 */
export function coverageAll(root: string, scenario?: string): Coverage[] {
  const rows: Coverage[] = []
  for (const card of listScenarios(root)) {
    if (scenario && card.id !== scenario) continue
    rows.push(row(root, 'scenario', card.id, ''))
    for (const project of listDirs(join(scenarioDir(root, card.id), 'features'))) {
      rows.push(row(root, 'project', card.id, project))
    }
  }
  return rows
}

const LABELS: Array<[string, string]> = [
  ['cognition', '认知'],
  ['decision', '决策'],
  ['taste', '品味'],
  ['correction', '纠错'],
  ['tool', '工具'],
]

function describe(counts: Record<string, number>): string {
  const parts = LABELS.filter(([key]) => (counts[key] ?? 0) > 0).map(
    ([key, label]) => `${label} ${counts[key]}`,
  )
  return parts.join(' · ')
}

/** 渲染成注入用的几行；只列有内容的，按总量降序。 */
export function formatCoverage(rows: Coverage[], max = 8): string[] {
  const used = rows.filter((item) => item.total > 0)
  if (used.length === 0) return ['- 还没有任何产物：从认知开始建立。']
  return used
    .sort((a, b) => b.total - a.total)
    .slice(0, max)
    .map((item) => {
      const where = item.scope === 'scenario' ? `${item.scenario}（场景级）` : `${item.scenario} / ${item.project}`
      return `- ${where}：${describe(item.counts)}`
    })
}