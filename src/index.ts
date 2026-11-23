// index — mesync-core 的库入口
//
// core 提供机制：数据布局、存储与检索、常驻正文组装、工具的纯语义定义，
// 外加上层接口的两种形态。平台相关的那一层留在适配层（dsh 是 dsh-mesync 的
// index.ts / register.ts）：
//
//   resolveRoot / projectId   数据根与项目标识
//   residentText              每轮注入用的常驻正文，怎么塞进对话由适配层定
//   TOOLS / findTool          工具定义，怎么注册给平台由适配层定
//
// 两种接法，适配层选一种就够了，都不用理解内部：
//   hookOutput                hook 形态：一次会话开始送一段文本（bin: mesync hook）
//   handleMcpMessage          MCP 形态：八个工具走标准协议（bin: mesync mcp）
//
// 心法 md 仍在包根的 templates/ 里，由 assets.ts 定位，适配层不用关心它装在哪。

export type { HostContext, ParamProperty, ParamType, ToolParameters, ToolSpec } from './host.js'
export { projectId, resolveRoot } from './paths.js'
export type { ResidentInput, ResidentResult } from './resident.js'
export { residentText } from './resident.js'
export { findTool, TOOLS } from './tools.js'
export type { HookInput, HookOptions } from './hook.js'
export { hookOutput, normalizeEvent, shouldInject } from './hook.js'
export type { McpContext } from './mcp.js'
export { handleMcpMessage } from './mcp.js'
