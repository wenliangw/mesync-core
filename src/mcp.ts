// mcp — 把八个工具按 MCP（Model Context Protocol）暴露出去
//
// 为什么走 MCP：工具的跨框架通用做法只有这一个。框架支持 MCP，就能直接拿到
// mesync_context / scenario_load / memory_write …，**适配层连一行代码都不用写**，
// 只在配置里加一个 server 条目。
//
// 手写 JSON-RPC 而不引官方 SDK：core 是零运行期依赖的，为一个几百行的协议
// 引一个 SDK 不划算，而且 SDK 会把"能不能离线跑"绑到它的发布节奏上。
// 这里只实现工具需要的那几个方法，收到的其余方法一律回 -32601，不装作支持。

import { findTool, TOOLS } from './tools.js'

export interface McpContext {
  /** 数据根（已经解析好的绝对路径）。 */
  root: string
  /** 工具看到的当前工作目录。 */
  cwd: string
  /** serverInfo 里报的版本。 */
  version: string
}

type Json = Record<string, unknown>

/** 客户端没报版本时用的兜底。协议本身向后兼容，回这个不会谈崩。 */
const DEFAULT_PROTOCOL = '2024-11-05'

function result(id: unknown, value: Json): Json {
  return { jsonrpc: '2.0', id, result: value }
}

function error(id: unknown, code: number, message: string): Json {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** 工具跑成功：内容按 MCP 约定包成 text content。 */
function text(value: string): Json {
  return { content: [{ type: 'text', text: value }] }
}

/**
 * 工具自己抛错（参数不对、找不到文件）：按 MCP 约定用 isError 表达，
 * **不是** JSON-RPC error——协议层没错，是工具执行失败了。模型看得到这段文本，
 * 能自己改参数重试；包成协议错误反而会让框架当成连接故障。
 */
function toolError(message: string): Json {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * 处理一条 JSON-RPC 消息，返回要写回的消息；返回 null 表示不需要回应。
 *
 * 无 id 的是通知（notifications/initialized 之类），按协议不能回应。
 */
export async function handleMcpMessage(raw: unknown, ctx: McpContext): Promise<Json | null> {
  const message = (raw ?? {}) as Json
  const method = typeof message.method === 'string' ? message.method : ''
  const params = (message.params ?? {}) as Json
  const hasId = message.id !== undefined && message.id !== null
  const id = hasId ? message.id : null

  if (!method) return hasId ? error(id, -32600, '缺少 method') : null
  if (!hasId) return null

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return result(id, {
        // 回客户端报的版本：协议向后兼容，回它认得的最省事。
        protocolVersion: requested || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'mesync', version: ctx.version },
      })
    }

    case 'ping':
      return result(id, {})

    case 'tools/list':
      return result(id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          // core 的参数定义本来就是「对象根 JSON Schema」，MCP 要的正是这个形状，
          // 不需要翻译——这也是当初把工具语义放进 core 的一个回报。
          inputSchema: tool.parameters,
        })),
      })

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const tool = findTool(name)
      if (!tool) return result(id, toolError(`没有这个工具：${name}`))

      try {
        return result(id, text(await tool.run(args, { root: ctx.root, cwd: ctx.cwd })))
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure)
        return result(id, toolError(message))
      }
    }

    default:
      return error(id, -32601, `不支持的方法：${method}`)
  }
}