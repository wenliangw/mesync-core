// host — 工具的执行环境
//
// 八个工具都需要两样东西：数据根在哪、当前工作目录在哪。这里把这两样显式传进去，
// 而不是让 tools.ts 去读全局或配置单例——两个好处：
//
// 1. **可测**。tools.test.ts 直接 `tool.run(args, { root, cwd })`，不用模拟
//    dsh 的 ctx，也不用起插件。
// 2. **工具的语义与 dsh 解耦**。tools.ts 里没有 defineTool，换成别的工具框架时
//    只需要改 register.ts 一个文件。
//
// 参数用纯 JSON Schema，因为它是 LLM 工具调用的通用语；register.ts 负责翻成
// dsh 的属性表。返回值一律是纯文本，怎么渲染是 dsh 的事。

/** 工具的执行环境：每次调用显式传入。 */
export interface HostContext {
  /** 数据根（记忆存在哪）。由 config 解析后传进来。 */
  root: string
  /** 当前工作目录。用来推项目 id，也用来给 Agent 报路径。 */
  cwd: string
  /**
   * 宿主对「能不能直接写数据根」的说明，一两句话，可为空。
   *
   * 为什么要留这个口子：dsh 的 sandbox 把数据根挡在 workspace 之外，所以「必须用
   * mesync 的工具写」在这里是硬事实。这句话是宿主事实，不该写进心法 md 里
   * （mesync-core 的 md 是给所有平台看的）。
   */
  writeNotice?: string
}

/** 只用这三种参数类型；其余类型需要的话再扩，别提前抽象。 */
export type ParamType = 'string' | 'number' | 'boolean'

export interface ParamProperty {
  type: ParamType
  description: string
}

/** 对象根 JSON Schema。register.ts 把它翻成 dsh 的属性表。 */
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