// 命令入口的接线测试。
//
// 上面那两套测的是协议实现（handleMcpMessage / hookOutput），这一套测的是
// **真正被框架调用的那个进程**：参数解析、stdin 读取、stdout 写法、退出码。
// 这些东西单测够不到，但恰恰是「配好了却不生效」最容易出问题的地方。
//
// 跑之前需要 lib/（npm test 的 pretest 会构建）。

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const bin = join(here, '..', 'bin', 'mesync.mjs')

function run(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))

    child.stdin.end(input)
  })
}

const tempRoot = () => mkdtempSync(join(tmpdir(), 'mesync-cli-'))

test('hook：会话开始把常驻正文写进 stdout', async () => {
  const root = tempRoot()
  const { code, stdout } = await run(
    ['hook', 'SessionStart', '--root', root],
    JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/tmp/ws' }),
  )

  assert.equal(code, 0)
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(parsed.hookSpecificOutput.additionalContext, /mesync:contract/)
  assert.match(parsed.hookSpecificOutput.additionalContext, /M0/)
})

test('hook：每次发话的事件一个字都不写', async () => {
  const { code, stdout } = await run(
    ['hook', 'UserPromptSubmit', '--root', tempRoot()],
    JSON.stringify({ hook_event_name: 'UserPromptSubmit' }),
  )

  // 必须完全为空：hook 的 stdout 会被整段收进上下文
  assert.equal(code, 0)
  assert.equal(stdout, '')
})

test('hook：输入不是 JSON 也不崩（框架可能发空 stdin）', async () => {
  const { code, stdout } = await run(['hook', 'SessionStart', '--root', tempRoot()], '')

  assert.equal(code, 0)
  assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /M0/)
})

test('hook：--root 指向用户改过的心法时，送的是他的版本', async () => {
  const root = tempRoot()
  writeFileSync(join(root, 'mesync-use.md'), '## 我自己的链\n\nM0 先问这轮要不要动手。\n', 'utf8')

  const { stdout } = await run(['hook', 'SessionStart', '--root', root], '{}')
  assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /我自己的链/)
})

test('hook：plain 模式直接输出正文', async () => {
  const { stdout } = await run(['hook', 'SessionStart', '--root', tempRoot(), '--format', 'plain'], '{}')

  assert.match(stdout, /^<!-- mesync:contract -->/)
  assert.throws(() => JSON.parse(stdout))
})

test('hook：未知事件安静退出，不影响会话', async () => {
  const { code, stdout } = await run(['hook', 'NoSuchEvent', '--root', tempRoot()], '{}')

  assert.equal(code, 0)
  assert.equal(stdout, '')
})

// MCP 的 stdio 传输是「一行一条消息」。这里把两条消息一次喂进去再关 stdin，
// 看它是否按顺序回了两条——顺带验证了半条/整条的切分没出错。
test('mcp：握手与工具清单', async () => {
  const root = tempRoot()
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]

  const { code, stdout } = await run(
    ['mcp', '--root', root],
    `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`,
  )

  assert.equal(code, 0)

  const responses = stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))

  assert.equal(responses.length, 2)
  assert.equal(responses[0].result.protocolVersion, '2025-06-18')
  assert.equal(responses[1].result.tools.length, 8)
})

test('mcp：工具调用能落盘并查回', async () => {
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'memory_write',
        arguments: { kind: 'decision', title: 'cli 能写', content: '走进程也落盘。', scenario: 'code' },
      },
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'memory_search', arguments: { query: '进程' } },
    },
  ]

  const { stdout } = await run(
    ['mcp', '--root', tempRoot()],
    `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`,
  )

  const responses = stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))

  assert.match(responses[0].result.content[0].text, /✅/)
  assert.match(responses[1].result.content[0].text, /cli 能写/)
})

test('mcp：坏 JSON 回 -32700 而不是挂掉', async () => {
  const { code, stdout } = await run(['mcp', '--root', tempRoot()], '{这不是 json}\n')

  assert.equal(code, 0)
  const [response] = stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.equal(response.error.code, -32700)
})

test('帮助与用法错误', async () => {
  const help = await run(['--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /mesync hook/)
  assert.match(help.stdout, /mesync mcp/)

  const bad = await run(['nonsense'])
  assert.equal(bad.code, 2)
  assert.match(bad.stderr, /用法/)
})