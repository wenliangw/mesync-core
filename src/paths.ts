// paths — 数据根、两层作用域、项目标识
//
// 目录布局（文件即真相，没有索引、没有副本）：
//
//   ~/.dsh-mesync/
//     mesync-use.md                 可覆盖的常驻文本
//     meta/<五块>.md                心法（按需读）
//     chain-judge.md                M4 的判断分支（按需读）
//     chain-rules.md                修链时才读
//     scenarios/<场景>/
//       scenario.md                 场景卡
//       AGENT.md                    场景层唯一交付：怎么做 + 必须遵守的 + 默认做法
//       records/<kind>/<slug>.md    场景级记忆（所有项目通用）
//       features/<项目>/
//         AGENT.md                  项目层唯一交付
//         records/<kind>/<slug>.md  项目级记忆
//     _pending/<slug>.md            临时区：问出来但还没被验证的答案
//     _paths/<场景>-<项目>.md       走过的路径（M5 追加）
//
// 场景级是「往上」的那一层：跨项目通用的约束落这里，判据是内容里出不出现项目名。

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { LayerPaths, MemoryKind, RecordScope } from './types.js'

/** 数据根：显式配置 > 环境变量 > ~/.dsh-mesync。 */
export function resolveRoot(configured?: string): string {
  const fromConfig = configured?.trim()
  if (fromConfig) return fromConfig
  const fromEnv = process.env.MESYNC_ROOT?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.dsh-mesync')
}

/** 场景目录。 */
export function scenarioDir(root: string, scenario: string): string {
  return join(root, 'scenarios', scenario)
}

/** 项目层目录。 */
export function projectDir(root: string, scenario: string, project: string): string {
  return join(scenarioDir(root, scenario), 'features', project)
}

/** 场景层目录。它自己也是一层作用域（向上：所有项目通用）。 */
export function scenarioLayerDir(root: string, scenario: string): string {
  return scenarioDir(root, scenario)
}

/** 把任意一层目录展开成它那几个固定位置。 */
export function layerPaths(dir: string): LayerPaths {
  return {
    dir,
    agentDoc: join(dir, 'AGENT.md'),
    records: join(dir, 'records'),
  }
}

/**
 * 旧版每层独立的硬规则文件。已并入 AGENT.md，只在迁移时读一次。
 * 存在就说明这层还没整理完，scenario_load 会把它接在后面并标出来。
 */
export function legacyRulesFile(dir: string): string {
  return join(dir, 'rules.md')
}

/** 某层里某一类记忆的目录。 */
export function recordsDir(dir: string, kind: MemoryKind): string {
  return join(dir, 'records', kind)
}

/** 任意作用域对应的层目录。 */
export function scopeDir(
  root: string,
  scope: RecordScope,
  scenario: string,
  project: string,
): string {
  return scope === 'scenario' ? scenarioLayerDir(root, scenario) : projectDir(root, scenario, project)
}

/** 临时区：问出来但还没被成果验证的答案。 */
export function pendingDir(root: string): string {
  return join(root, '_pending')
}

/** 走过的路径（M5）。 */
export function pathsDir(root: string): string {
  return join(root, '_paths')
}

/** 把任意字符串收敛成文件名安全的 slug。 */
export function sanitizeId(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return cleaned.length > 0 ? cleaned : 'untitled'
}

/** 从 remote URL 抽 `owner-repo`。 */
function fromRemote(url: string): string | null {
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  if (cleaned === '') return null

  // git@host:owner/repo
  const scp = /^[^@\s]+@[^:\s]+:(.+)$/.exec(cleaned)
  if (scp) return lastTwo(scp[1])

  // https://host/owner/repo 、ssh://host/owner/repo 、git://host/owner/repo
  const url1 = /^[a-z]+:\/\/(?:[^@/]+@)?[^/]+\/(.+)$/i.exec(cleaned)
  if (url1) return lastTwo(url1[1])

  return null
}

function lastTwo(path: string): string | null {
  const parts = path.split('/').filter((part) => part.length > 0)
  if (parts.length === 0) return null
  return parts.slice(-2).join('-')
}

/**
 * 项目标识：git remote 归一化成 `owner-repo`；没有 git 就用目录名。
 * 只在解析失败时退回目录名——不做「猜仓库名」这种不可靠的事。
 */
export function projectId(cwd: string): string {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      timeout: 1500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const id = fromRemote(url)
    if (id) return sanitizeId(id)
  } catch {
    // 非 git 目录、没有 origin、或 git 不可用：都走目录名兜底
  }
  return sanitizeId(basename(cwd) || 'workspace')
}