// host — 平台无关的接缝
//
// 这个文件是整个拆分的核心：它定义了「适配层需要给 core 什么」和「core 给
// 适配层什么」。三条约束是故意的：
//
// 1. **参数用纯 JSON Schema**。它是 LLM 工具调用的通用语（OpenAI / Anthropic /
//    MCP 都吃这个），不属于任何一家平台。适配层负责把它翻译成自己的方言。
// 2. **handler 只收展开的参数 + HostContext**，不收平台自己的 exec 对象。
//    core 不知道也不该知道 dsh 的 ctx / systemPrompt / defineTool 长什么样。
// 3. **返回纯文本**。工具结果怎么显示是平台的事，core 只负责说什么。

/** 适配层每次调用要提供的环境。 */
export interface HostContext {
  /** 数据根（记忆存在哪）。由适配层从自己的配置解析后传进来。 */
  root: string
  /** 当前工作目录。core 用它推项目 id，也用来给 Agent 报路径。 */
  cwd: string
  /**
   * 当前平台对「能不能直接写数据根」的说明，一两句话，可为空。
   *
   * 为什么要留这个口子：dsh 的 sandbox 把数据根挡在 workspace 之外，所以「必须用
   * mesync 的工具写」在那里是硬事实；换个平台可能不是。这句话是平台事实，不该
   * 焊死在心法里。
   */
  writeNotice?: string
}

/** core 只用这三种参数类型；其余类型需要的话再扩，别提前抽象。 */
export type ParamType = 'string' | 'number' | 'boolean'

export interface ParamProperty {
  type: ParamType
  description: string
}

/** 对象根 JSON Schema。适配层把它翻成自己的工具参数格式。 */
export interface ToolParameters {
  type: 'object'
  properties: Record<string, ParamProperty>
  required?: string[]
}

/** 一个平台无关的工具定义。 */
export interface ToolSpec {
  name: string
  description: string
  parameters: ToolParameters
  /**
   * 参数已经过平台校验，但**内容不做判断**——该不该记、记成什么，是心法的事。
   * 这里只保证存得住、找得到、不丢。
   */
  run(args: Record<string, unknown>, host: HostContext): Promise<string>
}