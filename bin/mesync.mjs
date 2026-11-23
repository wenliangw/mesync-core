#!/usr/bin/env node
// mesync — 命令入口
//
// 存在的理由：core 提供的是库，但很多框架根本没有「插件」这种东西，只有
// hook 配置和 MCP server 配置。有了这个入口，那些框架的适配层就是**一份配置**，
// 不是一份代码：
//
//   mesync hook <event>   会话开始时注入常驻正文（读 stdin 的 hook JSON）
//   mesync mcp            MCP stdio 服务，把八个工具暴露出去
//
// 刻意不做的事：
//   - 不缓存任何东西。改数据根里的 md 就该立刻改变行为，缓存会毁掉这个性质。
//   - hook 分支里任何异常都吞掉并退出 0。框架会把非零退出当成 hook 故障，
//     用户看到的是「会话卡住了」，而我们只是没注入一段提示词。
//
// 依赖 lib/（`npm run build`）。从源码直接跑请先构建。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hookOutput } from '../lib/hook.js'
import { handleMcpMessage } from '../lib/mcp.js'
import { resolveRoot } from '../lib/paths.js'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const { version } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

const USAGE = `mesync ${version}

用法：
  mesync hook <event> [--format json|plain]   把常驻正文写进 stdout（读 stdin 的 hook JSON）
  mesync mcp                                  启动 MCP stdio 服务

通用选项：
  --root <path>        数据根（优先级最高）
  --dir-name <name>    主目录下的目录名，缺省 .mesync
                       —— 框架想沿用自己的老目录就传这个

退出码：hook 永远 0（失败也不能影响用户会话）；用法错误为 2。`

/** 极简参数解析：core 的命令行只有这几个开关，不引依赖。 */
function parseFlags(argv) {
  const flags = { root: '', dirName: '', format: 'json', positionals: [] }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') flags.root = argv[(i += 1)] ?? ''
    else if (arg === '--dir-name') flags.dirName = argv[(i += 1)] ?? ''
    else if (arg === '--format') flags.format = argv[(i += 1)] ?? 'json'
    else if (arg === '-h' || arg === '--help') flags.help = true
    else if (arg.startsWith('--')) {
      /* 不认识的开关忽略：新版本加了参数，老配置不该因此报错 */
    } else flags.positionals.push(arg)
  }

  return flags
}

/**
 * 读完 stdin。
 *
 * 没有管道时（比如用户手敲 `mesync hook SessionStart`）必须立刻返回，
 * 否则会一直等 EOF，看起来就是卡死。
 */
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('')

  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

function rootOf(flags) {
  return resolveRoot({ configured: flags.root, dirName: flags.dirName })
}

async function runHook(argv) {
  const flags = parseFlags(argv)
  const event = flags.positionals[0] ?? ''
  const raw = await readStdin()

  let input = {}
  try {
    input = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    // 输入不是 JSON：当成空输入，仍然按事件名决定要不要注入。
    input = {}
  }

  const output = hookOutput(event, input, {
    root: rootOf(flags),
    cwd: process.cwd(),
    format: flags.format === 'plain' ? 'plain' : 'json',
  })

  // null 表示这个事件不归我管：一个字都不写，连换行也不写——
  // hook 的标准输出会被框架整段收进上下文，空行也是上下文。
  if (output) process.stdout.write(`${output}\n`)
}

async function runMcp(argv) {
  const flags = parseFlags(argv)
  const context = { root: rootOf(flags), cwd: process.cwd(), version }

  const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

  process.stdin.setEncoding('utf8')
  let buffer = ''

  for await (const chunk of process.stdin) {
    buffer += chunk

    // MCP 的 stdio 传输是「一行一条消息」，所以按换行切，半条留到下一轮。
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (!line) continue

      let message
      try {
        message = JSON.parse(line)
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } })
        continue
      }

      const response = await handleMcpMessage(message, context)
      if (response) write(response)
    }
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)

  if (command === 'hook') {
    try {
      await runHook(rest)
    } catch (failure) {
      // hook 出任何问题都不能让用户的会话看起来像卡住了。
      process.stderr.write(`mesync hook 失败：${failure?.message ?? failure}\n`)
    }
    return 0
  }

  if (command === 'mcp') {
    await runMcp(rest)
    return 0
  }

  if (command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  process.stderr.write(`${USAGE}\n`)
  return 2
}

process.exitCode = await main()