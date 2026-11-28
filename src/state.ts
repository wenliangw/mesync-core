// state — 运行期状态
//
// 只记「每个项目上一次判成的场景」，供下一轮注入时提示当前所处环境。
// 它不参与判断、不是真相：判据始终是「这次要产出什么」，状态只是省一次重复推断。
//
// **按项目分键**，不按数据根存一份。一个数据根可能被多个项目、甚至多个框架共用，
// 存一份的话彼此的「上次场景」会互相覆盖，然后安静地把记忆写进错的场景层。

import { join } from 'node:path'

import { readJson, writeJson } from './fs.js'
import type { ProjectState, RuntimeState } from './types.js'

function stateFile(root: string): string {
  return join(root, '.runtime', 'state.json')
}

/** 0.2.0 之前的老形状：扁平的一份 scenario + project，只用于迁移。 */
interface LegacyState {
  scenario?: string
  project?: string
}

function normalize(raw: unknown): RuntimeState {
  const value = (raw ?? {}) as Partial<RuntimeState> & LegacyState

  if (value.projects && typeof value.projects === 'object') {
    return { projects: value.projects }
  }

  // 老文件只有一份场景，把它记到当时那个项目名下——升级后提示不丢，也不会
  // 让别的项目误以为那是自己的。
  if (value.scenario && value.project) {
    return { projects: { [value.project]: { scenario: value.scenario } } }
  }

  return { projects: {} }
}

/** 读整个状态；不存在或损坏都返回空对象。 */
export function readState(root: string): RuntimeState {
  return normalize(readJson<unknown>(stateFile(root)))
}

/** 某个项目的状态。项目未知（空串）时一律当作「没记过」——宁可不猜，也不要拿别人的。 */
export function readStateFor(root: string, project: string): ProjectState {
  if (!project) return {}
  return readState(root).projects[project] ?? {}
}

/** 合并写入某个项目的状态。项目未知时不写：没有归属的场景记下来只会误导下一轮。 */
export function patchStateFor(root: string, project: string, patch: ProjectState): ProjectState {
  if (!project) return patch

  const state = readState(root)
  const next: ProjectState = {
    ...(state.projects[project] ?? {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  state.projects[project] = next
  writeJson(stateFile(root), state)
  return next
}
