import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { projectId } from '../src/paths.js'
import { hookOutput, normalizeEvent, shouldInject } from '../src/hook.js'

const root = () => mkdtempSync(join(tmpdir(), 'mesync-hook-'))

describe('该不该注入', () => {
  it('上下文可能为空的那一刻都要注入', () => {
    expect(shouldInject('SessionStart')).toBe(true)
    expect(shouldInject('PostCompact')).toBe(true)
    expect(shouldInject('resume')).toBe(true)
  })

  // 各框架对同一个事件的叫法不一样，shell 里还可能手写成 - 或 _ 分隔。
  // 认错一个字母就静默不注入，这种故障最难查——所以三种写法都要认。
  it('事件名的大小写与分隔符不影响判断', () => {
    expect(shouldInject('session-start')).toBe(true)
    expect(shouldInject('session_start')).toBe(true)
    expect(shouldInject('SESSIONSTART')).toBe(true)
    expect(normalizeEvent('Session-Start')).toBe('sessionstart')
  })

  // 这条不是「忘了支持」，是**刻意不支持**：每轮都送会吃掉上下文预算，
  // 而且需要猜「这条消息是不是新任务」——那个判断属于 Agent，不属于 hook。
  it('每次用户发话不注入', () => {
    expect(shouldInject('UserPromptSubmit')).toBe(false)
  })

  it('不认识的事件安静跳过，不报错', () => {
    expect(shouldInject('')).toBe(false)
    expect(shouldInject('Whatever')).toBe(false)
  })
})

describe('注入内容', () => {
  it('不归我管的事件返回 null，连空行都不写', () => {
    // hook 的 stdout 会被框架整段收进上下文，空行也是上下文
    expect(hookOutput('UserPromptSubmit', {}, { root: root(), cwd: '/tmp/ws' })).toBeNull()
  })

  it('输出框架认得的那层壳', () => {
    const output = hookOutput('SessionStart', { cwd: '/tmp/ws' }, { root: root(), cwd: '/tmp/ws' })
    expect(output).not.toBeNull()

    const parsed = JSON.parse(output as string) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(parsed.hookSpecificOutput.additionalContext.startsWith('<!-- mesync:contract -->')).toBe(true)
    expect(parsed.hookSpecificOutput.additionalContext).toContain('M0')
  })

  it('plain 模式直接给正文', () => {
    const output = hookOutput('SessionStart', {}, { root: root(), cwd: '/tmp/ws', format: 'plain' })

    expect(output?.startsWith('<!-- mesync:contract -->')).toBe(true)
    expect(() => JSON.parse(output as string)).toThrow()
  })

  // 注入里带着「当前项目」。用错工作目录，注入就会指向另一个项目——
  // 这种错不会报错，只会让 Agent 去查别人的记忆。
  it('优先用输入里的 cwd', () => {
    const output = hookOutput(
      'SessionStart',
      { cwd: '/tmp/ws' },
      { root: root(), cwd: '/tmp/other' },
    )
    const context = (JSON.parse(output as string) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext

    expect(context).toContain(projectId('/tmp/ws'))
  })

  it('用户在数据根覆盖 mesync-use.md 后，hook 送的是他的版本', () => {
    const dir = root()
    writeFileSync(join(dir, 'mesync-use.md'), '## 我自己的链\n\nM0 先问这轮要不要动手。\n', 'utf8')

    const output = hookOutput('SessionStart', {}, { root: dir, cwd: '/tmp/ws' })
    const context = (JSON.parse(output as string) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext

    expect(context).toContain('我自己的链')
  })
})