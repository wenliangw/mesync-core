// state — 运行期状态
//
// 只记「上一次判成的场景与项目」，供下一轮注入时提示 Agent 当前所处环境。
// 它不参与判断、不是真相：判据始终是「这次要产出什么」，状态只是省一次重复推断。

import { join } from 'node:path'

import { readJson, writeJson } from './fs.js'
import type { RuntimeState } from './types.js'

function stateFile(root: string): string {
  return join(root, '.runtime', 'state.json')
}

/** 读状态；不存在或损坏都返回空对象。 */
export function readState(root: string): RuntimeState {
  return readJson<RuntimeState>(stateFile(root)) ?? {}
}

/** 合并写入状态。 */
export function patchState(root: string, patch: RuntimeState): RuntimeState {
  const next: RuntimeState = {
    ...readState(root),
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  writeJson(stateFile(root), next)
  return next
}