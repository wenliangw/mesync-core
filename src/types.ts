// types — mesync 的领域类型
//
// 模型：一条判断链（M0–M5）+ 五块记忆（认知 / 决策 / 品味 / 纠错 / 工具）
// + 两层作用域（场景级 / 项目级）。
//
// 这里只放「存得住、找得到」需要的最小结构。判断（记成哪一块、写什么、
// 算不算硬规则）一律不在这里编码——那是心法的事，不是代码的事。

/** 五块记忆 + 临时区。判断链的叶子产出前五种，pending 是没验证过的答案。 */
export type MemoryKind = 'cognition' | 'decision' | 'taste' | 'correction' | 'tool' | 'pending'

/** 记录的作用域：场景级对所有项目适用，项目级只对某个项目适用。 */
export type RecordScope = 'scenario' | 'project'

/** 五块的正式种类（不含临时区）。 */
export const MEMORY_KINDS: readonly MemoryKind[] = [
  'cognition',
  'decision',
  'taste',
  'correction',
  'tool',
] as const

/** 一条记忆的定位信息：只描述「它是什么、在哪」，不描述「它为什么对」。 */
export interface MemoryRecord {
  kind: MemoryKind
  scope: RecordScope
  scenario: string
  project: string
  title: string
  created: string
  body: string
  /** 绝对路径。 */
  file: string
  /** 相对数据根的路径，交给 memory_read 用。 */
  rel: string
}

/** 检索命中的一条。 */
export interface MemoryHit {
  kind: MemoryKind
  scope: RecordScope
  scenario: string
  project: string
  title: string
  /** 相对数据根的路径。 */
  ref: string
}

/** 一层作用域的目录（场景层或项目层）。 */
export interface LayerPaths {
  dir: string
  /** 该层的工作说明。 */
  agentDoc: string
  /** 该层的硬规则（M1 交付的东西）。 */
  rules: string
  /** 该层的记录根，下面按 kind 分子目录。 */
  records: string
}

/** 一张场景卡。预置的来自插件资源，自建的来自数据根。 */
export interface ScenarioCard {
  id: string
  name: string
  description: string
  /** 场景判断语义：什么迹象说明这次要做的是这个场景。 */
  when: string[]
  /** 产出什么——场景判断的主依据：看产出，不看输入。 */
  produces: string
  /** 怎么算做完。缺了它 M2 就没有完成标准。 */
  acceptance: string
  source: 'preset' | 'user'
  /** 场景目录（含 AGENT.md、rules.md、features/）。 */
  dir: string
}

/** 覆盖度：某层有多少条各类记忆。 */
export interface Coverage {
  scenario: string
  /** 场景级记为空串。 */
  project: string
  scope: RecordScope
  counts: Record<string, number>
  total: number
}

/** 运行期状态：上一次识别出的场景与项目，供下一轮注入参考。 */
export interface RuntimeState {
  scenario?: string
  project?: string
  updatedAt?: string
}