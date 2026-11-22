// search — 记忆检索
//
// 个人尺度上记忆量很小（几百条），所以直接扫文件、按关键词匹配，不建索引：
// 索引会让「文件即真相」退化成一份需要同步的副本。
//
// 这是弱匹配，不是语义检索。它的定位是「能命中就命中」——真正靠得住的是
// M1 交付的那几样（层 AGENT.md、硬规则清单、工具清单），那些不依赖检索。

import { join } from 'node:path'

import { listDirs } from './fs.js'
import { listRecords } from './memory.js'
import { scenarioDir } from './paths.js'
import { listScenarios } from './scenario.js'
import type { MemoryHit, MemoryKind, RecordScope } from './types.js'

export interface SearchOptions {
  root: string
  /** 关键词；不给就按作用域列举（相当于列清单）。 */
  query?: string
  scenario?: string
  project?: string
  kind?: MemoryKind
  scope?: RecordScope
  limit?: number
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** 检索记忆。场景层在前（跨项目通用的先给），项目层在后。 */
export function searchMemory(options: SearchOptions): MemoryHit[] {
  const { root, query, scenario, project, kind, scope, limit = 30 } = options
  const needle = query?.trim() ?? ''
  const hits: MemoryHit[] = []

  const scenarios = listScenarios(root)
    .map((card) => card.id)
    .filter((id) => !scenario || id === scenario)

  for (const scenarioId of scenarios) {
    if (!scope || scope === 'scenario') {
      for (const record of listRecords(root, 'scenario', scenarioId, '')) {
        if (kind && record.kind !== kind) continue
        if (needle && !matches(`${record.title}\n${record.body}`, needle)) continue
        hits.push({
          kind: record.kind,
          scope: 'scenario',
          scenario: scenarioId,
          project: '',
          title: record.title,
          ref: record.rel,
        })
      }
    }

    if (!scope || scope === 'project') {
      const projects = listDirs(join(scenarioDir(root, scenarioId), 'features')).filter(
        (id) => !project || id === project,
      )
      for (const projectId of projects) {
        for (const record of listRecords(root, 'project', scenarioId, projectId)) {
          if (kind && record.kind !== kind) continue
          if (needle && !matches(`${record.title}\n${record.body}`, needle)) continue
          hits.push({
            kind: record.kind,
            scope: 'project',
            scenario: scenarioId,
            project: projectId,
            title: record.title,
            ref: record.rel,
          })
        }
      }
    }
  }

  return hits.slice(0, limit)
}