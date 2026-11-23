import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { handleMcpMessage, type McpContext } from '../src/mcp.js'

function context(): McpContext {
  return { root: mkdtempSync(join(tmpdir(), 'mesync-mcp-')), cwd: '/tmp/ws', version: '9.9.9' }
}

function request(method: string, params: unknown = {}, id: number | null = 1) {
  return id === null
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id, method, params }
}

/** 这些测试里 result 的形状由 MCP 协议规定，断言时给个宽松类型。 */
type AnyResult = { result: Record<string, any>; error?: { code: number; message: string } }

describe('握手', () => {
  it('回客户端报的协议版本，并声明工具能力', async () => {
    const response = (await handleMcpMessage(
      request('initialize', { protocolVersion: '2025-06-18' }),
      context(),
    )) as AnyResult

    expect(response.result.protocolVersion).toBe('2025-06-18')
    expect(response.result.capabilities.tools).toBeDefined()
    expect(response.result.serverInfo).toMatchObject({ name: 'mesync', version: '9.9.9' })
  })

  it('客户端没报版本时给一个合法兜底', async () => {
    const response = (await handleMcpMessage(request('initialize'), context())) as AnyResult
    expect(response.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // 无 id 的是通知，按 JSON-RPC 规定不能回应。回了会被某些框架当成协议错。
  it('通知不回话', async () => {
    expect(await handleMcpMessage(request('notifications/initialized', {}, null), context())).toBeNull()
  })

  it('ping 要能应答，否则框架会认为连接死了', async () => {
    const response = (await handleMcpMessage(request('ping'), context())) as AnyResult
    expect(response.result).toEqual({})
  })
})

describe('工具清单', () => {
  it('八个工具，参数直接是对象根 JSON Schema', async () => {
    const response = (await handleMcpMessage(request('tools/list'), context())) as AnyResult
    const tools = response.result.tools as Array<Record<string, any>>

    expect(tools).toHaveLength(8)

    const write = tools.find((tool) => tool.name === 'memory_write')
    expect(write?.inputSchema.type).toBe('object')
    expect(write?.inputSchema.required).toContain('kind')
    expect(typeof write?.description).toBe('string')
  })
})

describe('调用工具', () => {
  it('写入能真的落盘，随后能查回来', async () => {
    const ctx = context()

    const written = (await handleMcpMessage(
      request('tools/call', {
        name: 'memory_write',
        arguments: {
          kind: 'decision',
          title: 'mcp 能写',
          content: '走协议也落盘。',
          scenario: 'code',
        },
      }),
      ctx,
    )) as AnyResult
    expect(written.result.content[0].text).toContain('✅')

    const found = (await handleMcpMessage(
      request('tools/call', { name: 'memory_search', arguments: { query: '协议' } }),
      ctx,
    )) as AnyResult
    expect(found.result.content[0].text).toContain('mcp 能写')
  })

  // MCP 是**有状态**的：场景存在数据根里，scenario_load 之后同一根的后续调用
  // 就不必再传 scenario。这跟 dsh 那条路径的行为一致，因为状态本来就落在根上，
  // 不落在进程内存里——server 重启也不会丢。
  it('先 scenario_load 再写，可以不显式传 scenario', async () => {
    const ctx = context()

    await handleMcpMessage(
      request('tools/call', { name: 'scenario_load', arguments: { scenario: 'code' } }),
      ctx,
    )

    const written = (await handleMcpMessage(
      request('tools/call', {
        name: 'memory_write',
        arguments: { kind: 'cognition', title: '有状态', content: '场景靠数据根里的 state 记住。' },
      }),
      ctx,
    )) as AnyResult

    expect(written.result.content[0].text).toContain('✅')
  })

  // 没有场景又没传 scenario 时，工具会明确告诉模型该怎么办——不是静默失败。
  it('缺场景时给的是可执行的指引，不是空白', async () => {
    const response = (await handleMcpMessage(
      request('tools/call', {
        name: 'memory_write',
        arguments: { kind: 'decision', title: 'x', content: 'y' },
      }),
      context(),
    )) as AnyResult

    expect(response.result.content[0].text).toContain('场景')
  })

  it('工具清单里列的每个工具都能调用，不是空壳', async () => {
    const ctx = context()
    const listed = (await handleMcpMessage(request('tools/list'), ctx)) as AnyResult
    const names = (listed.result.tools as Array<{ name: string }>).map((tool) => tool.name)

    // 缺参数会走到工具自己的校验并抛错，说明它确实进去了、在跑
    for (const name of names) {
      const response = (await handleMcpMessage(
        request('tools/call', { name, arguments: {} }),
        ctx,
      )) as AnyResult
      expect(response.result, name).toBeDefined()
      expect(response.error, name).toBeUndefined()
    }
  })

  it('没有这个工具时是工具级错误，不是协议错', async () => {
    const response = (await handleMcpMessage(
      request('tools/call', { name: 'nope', arguments: {} }),
      context(),
    )) as AnyResult

    expect(response.error).toBeUndefined()
    expect(response.result.isError).toBe(true)
    expect(response.result.content[0].text).toContain('没有这个工具')
  })

  // 工具内部抛错（越界、找不到文件）属于**执行失败**，不是协议故障。
  // 包成 JSON-RPC error 会让框架当成连接出问题，可能直接断开 server。
  it('工具抛错走 isError，不污染协议层', async () => {
    const response = (await handleMcpMessage(
      request('tools/call', { name: 'memory_read', arguments: { path: '../../etc/passwd' } }),
      context(),
    )) as AnyResult

    expect(response.error).toBeUndefined()
    expect(response.result.isError).toBe(true)
    expect(response.result.content[0].text).toContain('越界')
  })
})

describe('协议边界', () => {
  it('不支持的方法回 -32601，不装作支持', async () => {
    const response = (await handleMcpMessage(request('resources/list'), context())) as AnyResult
    expect(response.error?.code).toBe(-32601)
  })

  it('缺 method 回 -32600', async () => {
    const response = (await handleMcpMessage({ jsonrpc: '2.0', id: 1 }, context())) as AnyResult
    expect(response.error?.code).toBe(-32600)
  })
})