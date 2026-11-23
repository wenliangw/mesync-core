// hook — 会话开始时把常驻正文送进框架的注入通道
//
// 框架的 hook 协议是同一套形状（Claude Code 与 Codex 共用，已成事实标准）：
//
//   stdin   一行 JSON：{ hook_event_name, session_id, cwd, transcript_path, source, ... }
//   stdout  一行 JSON：{ hookSpecificOutput: { hookEventName, additionalContext } }
//
// 所以这个模块只回答一个问题：**这个事件该不该把常驻正文送进去。**
// 解析 stdin、写 stdout 都归 bin 管，这里保持可以单独测。

import { projectId } from './paths.js'
import { residentText } from './resident.js'

export interface HookInput {
  hook_event_name?: unknown
  session_id?: unknown
  cwd?: unknown
  transcript_path?: unknown
  source?: unknown
}

export interface HookOptions {
  /** 数据根（已经解析好的绝对路径）。 */
  root: string
  /** 输入里没带 cwd 时用的工作目录。 */
  cwd: string
  /** json（默认，两个框架都认）或 plain（直接把正文写出去）。 */
  format?: 'json' | 'plain'
}

/**
 * 该注入的事件。
 *
 * 判据不是「框架把事件叫什么」，而是「这一刻上下文是不是可能是空的」：
 * 新会话、恢复、清空、压缩之后都要重新送一遍。各框架的叫法不一样，所以列全。
 *
 * **刻意不包含 UserPromptSubmit。** 每次用户发话都送一遍会吃掉上下文预算，
 * 而且需要猜「这条消息是不是新任务」——那个判断属于 Agent，不属于 hook。
 * 心法里的 M1 本来就是「判出新任务再交付」，不是「每轮都交付」。
 */
const INJECT_EVENTS = new Set([
  'sessionstart',
  'startup',
  'resume',
  'clear',
  'compact',
  'postcompact',
  'sessionresume',
])

/**
 * 事件名归一。
 *
 * Codex 写 `SessionStart`，shell 里手写可能写成 `session-start` / `session_start`，
 * 三种都得认——配错一个字母就静默不注入，那种故障最难查。
 */
export function normalizeEvent(event: string): string {
  return event.toLowerCase().replace(/[^a-z]/g, '')
}

export function shouldInject(event: string): boolean {
  return INJECT_EVENTS.has(normalizeEvent(event))
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 生成要写到 stdout 的内容；返回 null 表示「这个事件不归我管，安静退出」。
 *
 * 返回 null 而不是空字符串，是为了让 bin 连换行都不写——hook 的标准输出会被
 * 框架当成 context 收走，多一个空行也会进上下文。
 */
export function hookOutput(event: string, input: HookInput, options: HookOptions): string | null {
  if (!shouldInject(event)) return null

  const cwd = stringOf(input.cwd) || options.cwd
  const { text } = residentText({
    root: options.root,
    cwd,
    project: cwd ? projectId(cwd) : undefined,
  })

  const context = text.trim()
  if (!context) return null

  if (options.format === 'plain') return context

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: context,
    },
  })
}