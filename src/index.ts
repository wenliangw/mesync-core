// mesync-core — 心法内核（平台无关）
//
// 这个包只做三件事：
//   1. 心法文本：判断链、五份心法、判断分支、场景卡（templates/ 下，随包发布）
//   2. 存储模型：数据根布局、记录格式、检索、覆盖度（这一堆模块）
//   3. 工具语义：八个工具的名字、参数、行为（tools.ts，纯 JSON Schema + handler）
//
// 它**不**知道任何平台：没有 dsh、没有 systemPrompt、没有 defineTool。
// 平台适配层（如 dsh-mesync）只做两件接线的事：
//   - 把 TOOLS 注册成自己平台的工具
//   - 把 residentText() 的结果注入进对话
//
// 这条边界是可验证的：core 的源码里不出现任何平台包名。

export const VERSION = '0.1.0'

// —— 接缝 ——
export type {
  HostContext,
  ParamProperty,
  ParamType,
  ToolParameters,
  ToolSpec,
} from './host.js'

// —— 常驻正文 ——
export { INJECTION_LIMIT, residentText } from './resident.js'
export type { ResidentInput, ResidentResult } from './resident.js'

// —— 工具语义 ——
export { findTool, TOOLS } from './tools.js'

// —— 适配层会用到的环境工具 ——
export { projectId, resolveRoot } from './paths.js'

// —— 心法读取（适配层做 doctor / 调试时会用） ——
export { CHAIN_DOCS, META_NAMES, readChainDoc, readMeta, readUseDoc } from './meta.js'
export type { MetaName } from './meta.js'

// —— 场景 ——
export { listScenarios, readScenario } from './scenario.js'
export type { ScenarioCard } from './types.js'

// —— 存储（写工具之外，适配层偶尔要查） ——
export { listRecords, readRecordFile } from './memory.js'
export { coverageAll } from './coverage.js'
export { searchMemory } from './search.js'
export type { Coverage, MemoryHit, MemoryKind, MemoryRecord, RecordScope } from './types.js'