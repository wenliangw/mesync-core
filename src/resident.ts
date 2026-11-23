// resident — 常驻注入正文的组装
//
// 这里只**拼字符串**，不碰任何平台 API：同一个数据根，任何平台算出来的常驻正文
// 都该一模一样。适配层拿到之后自己决定怎么塞进对话（dsh 是 systemPrompt variable）。
//
// 常驻只放三样东西：判断链（骨架）、场景清单、当前状态与覆盖度。
// 心法正文、判断分支、AGENT.md、记忆正文一律不进注入——它们按需读，这样常驻体积
// 不随记忆增长而膨胀。
//
// 硬上限沿用 16000 字符；超限时按「覆盖度 → 状态 → 场景清单」的顺序丢，
// 并如实报告丢了什么，绝不静默截断。

import { coverageAll, formatCoverage } from './coverage.js'
import type { HostContext } from './host.js'
import { readUseDoc } from './meta.js'
import { listScenarios, scenarioLines } from './scenario.js'
import { readState } from './state.js'
import type { ScenarioCard } from './types.js'

/** 注入总长上限。 */
export const INJECTION_LIMIT = 16_000

/** 资源缺失时的兜底正文，保证能力声明不空。 */
const FALLBACK_USE = `## mesync 判断链（从上往下走，不要跳）

M0 这次要的是「产出」还是「回答」？
   回答 → 直接答 → M4
   产出 → 判断场景（看产出，不看输入）→ scenario_load → M1

M1 动手前 scenario_load：拿该层的做法与必须遵守的（两层 AGENT.md 一并给你）。没有就直接进 M2。

M2 做。

M3 用户评价？认可 → M4；否定 → 重走出错点 → 回 M2；无评价 → M4（标未验证）。

M4 留下了什么？先问：它有没有确定的读取路径？没有就不记。
   判断分支读 chain-judge.md，写法读 meta/<kind>.md。
   内容里出现项目名 → 项目级；不出现 → 场景级。想不清就不记。

M5 用 path_record 记下走过的路径，没产出记忆也要记。

任何一步答不出来：能查到 → 查；查不到且猜错要返工 → 问用户；其余 → 读心法自己判。

宁可少记，不记错。指向未来的（承诺、待办、还没定）一律不记。`

export interface ResidentInput extends HostContext {
  /** 当前 workspace 的项目 id（适配层算好传进来，或留空让 core 自己推）。 */
  project?: string
  limit?: number
}

export interface ResidentResult {
  text: string
  /** 因超限被丢掉的部分，供诊断排查。 */
  dropped: string[]
}

/** 组装常驻注入正文。 */
export function residentText(input: ResidentInput): ResidentResult {
  const { root, project, limit = INJECTION_LIMIT } = input

  const use = (readUseDoc(root) ?? FALLBACK_USE).trim()
  const cards: ScenarioCard[] = listScenarios(root)
  const state = readState(root)
  const dropped: string[] = []

  const stateLines: string[] = []
  if (project) stateLines.push(`- 当前 workspace 项目：${project}`)
  if (state.scenario) {
    stateLines.push(`- 上次场景：${state.scenario}${state.project ? ` / ${state.project}` : ''}`)
    stateLines.push('- 判据仍然是「这次产出什么」；产出变了就换场景，不必沿用。')
  }

  const coverageLines = formatCoverage(coverageAll(root))

  const header = '<!-- mesync:contract -->'
  const scenarioBlock = ['## 场景（按产出判断，判出后调 scenario_load）', '', ...scenarioLines(cards)]
  const stateBlock = stateLines.length > 0 ? ['', '## 当前状态', '', ...stateLines] : []
  const coverageBlock = ['', '## 记忆覆盖度（最近有哪些产物）', '', ...coverageLines]

  const compose = (parts: { scenarios: boolean; state: boolean; coverage: boolean }): string => {
    const out = [header, '', use]
    if (parts.scenarios) out.push('', ...scenarioBlock)
    if (parts.state && stateBlock.length > 0) out.push(...stateBlock)
    if (parts.coverage) out.push(...coverageBlock)
    return out.join('\n')
  }

  const plan = { scenarios: true, state: true, coverage: true }
  let text = compose(plan)

  if (text.length > limit) {
    plan.coverage = false
    dropped.push('记忆覆盖度')
    text = compose(plan)
  }
  if (text.length > limit) {
    plan.state = false
    dropped.push('当前状态')
    text = compose(plan)
  }
  if (text.length > limit) {
    plan.scenarios = false
    dropped.push('场景清单')
    text = compose(plan)
  }
  if (text.length > limit) {
    const notice = `\n\n（注入超限，已截断 ${text.length - limit} 字符；请精简 mesync-use.md）`
    text = text.slice(0, Math.max(0, limit - notice.length)) + notice
    dropped.push('正文尾段')
  }

  return { text, dropped }
}