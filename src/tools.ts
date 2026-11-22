// tools — 工具语义（平台无关）
//
// 八个工具，各管一件事：
//   mesync_context   判断前看一眼：有哪些场景、当前在哪、知道多少
//   scenario_load    加载场景层的执行说明与硬规则（M1 交付的东西）
//   memory_write     写一条记忆（kind + scope 由 Agent 判断，代码不替他判）
//   memory_search    检索记忆（弱匹配，够用即可）
//   memory_read      按相对路径读任意文件（心法、链、记录都走它）
//   doc_write        写层文档（rules.md / AGENT.md / 场景卡）
//   memory_discard   删一个文件（临时答案升格后清掉，或丢弃错答案）
//   path_record      M5：把这次走过的路径记一行
//
// 两条纪律：
// 1. **不校验判断**。写什么、够不够格记、算不算硬规则，全是心法的事。
//    这里只保证「存得住、找得到、不丢」——传空标题才报错，其余一律照写。
// 2. **不执行场景工具**。场景登记的工具只在 scenario_load 里被列出，执行交给
//    平台自己的命令执行能力，沿用那个平台的沙箱与审批。
//
// 这个文件不 import 任何平台包。接缝在 host.ts。

import { existsSync } from 'node:fs'
import { isAbsolute, normalize, resolve, sep } from 'node:path'

import { coverageAll, formatCoverage } from './coverage.js'
import { readText, writeText } from './fs.js'
import type { HostContext, ToolSpec } from './host.js'
import { appendPath, discard, readByRel, writeRecord } from './memory.js'
import { CHAIN_DOCS, META_NAMES } from './meta.js'
import { layerPaths, projectDir, projectId, scenarioLayerDir } from './paths.js'
import { searchMemory } from './search.js'
import { listScenarios, readScenario, scenarioLines } from './scenario.js'
import { patchState, readState } from './state.js'
import type { MemoryKind, RecordScope } from './types.js'

const KINDS: MemoryKind[] = ['cognition', 'decision', 'taste', 'correction', 'tool']

/** 场景 id 与项目 id 会直接拼进路径，必须挡住 `../`。 */
function assertSafeId(value: string, label: string): string {
  const id = value?.trim() ?? ''
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
    throw new Error(`${label} 不合法：「${value}」只能是字母、数字、点、下划线、连字符`)
  }
  return id
}

/** 解析场景：显式参数 > 运行期状态；都没有就报错让 Agent 先判断。 */
function resolveScenario(explicit: unknown, root: string): string {
  const chosen = typeof explicit === 'string' ? explicit.trim() : ''
  if (chosen) return chosen
  const remembered = readState(root).scenario
  if (remembered) return remembered
  throw new Error(
    '还没有确定场景。先按「这次要产出什么」判断场景，再把 scenario 传进来（或先调 scenario_load）。',
  )
}

/** 把相对路径钉死在数据根之内。 */
function safeUnder(root: string, rel: string): string {
  const target = resolve(root, normalize(rel))
  const base = resolve(root)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('路径越界：只能访问数据根内的文件')
  }
  return target
}

/** 看某个作用域现在有没有东西，返回几行。 */
function layerSummary(root: string, scenario: string, project: string): string[] {
  const scenarioLayer = layerPaths(scenarioLayerDir(root, scenario))
  const projectLayer = layerPaths(projectDir(root, scenario, project))
  return [
    `- 场景层 ${scenarioLayer.dir}`,
    `  工作说明 ${existsSync(scenarioLayer.agentDoc) ? '有' : '无'} · 硬规则 ${existsSync(scenarioLayer.rules) ? '有' : '无'}`,
    `- 项目层 ${projectLayer.dir}`,
    `  工作说明 ${existsSync(projectLayer.agentDoc) ? '有' : '无'} · 硬规则 ${existsSync(projectLayer.rules) ? '有' : '无'}`,
  ]
}

const str = (description: string) => ({ type: 'string' as const, description })

/** workspace 项目 id。 */
function projectOf(host: HostContext): string {
  return projectId(host.cwd)
}

/** 取显式 project 参数，否则用当前 workspace 的项目。 */
function projectArg(args: Record<string, unknown>, host: HostContext): string {
  const raw = args.project
  return typeof raw === 'string' && raw.trim() ? assertSafeId(raw, 'project') : projectOf(host)
}

export const TOOLS: readonly ToolSpec[] = [
  {
    name: 'mesync_context',
    description:
      'Look before you judge: list available scenarios (name / cue / what it produces), where the current ' +
      'scenario and project are, and how much memory already exists at both layers. Call this when you are ' +
      'unsure which scenario the current work belongs to.',
    parameters: {
      type: 'object',
      properties: {
        scenario: str('Optional: only show coverage of this scenario id.'),
      },
    },
    async run(args, host) {
      const { root } = host
      const cards = listScenarios(root)
      const state = readState(root)
      const only = typeof args.scenario === 'string' ? args.scenario.trim() : ''
      const coverage = formatCoverage(coverageAll(root, only || undefined))

      const parts = ['## 场景（按产出判断，判出后调 scenario_load）', '']
      parts.push(...scenarioLines(cards))
      parts.push('', '## 当前', '')
      parts.push(`- workspace 项目：${projectOf(host)}`)
      parts.push(`- 上次场景：${state.scenario ?? '（无）'}`)
      parts.push('', '## 记忆覆盖度', '')
      parts.push(...coverage)
      parts.push(
        '',
        '## 下一步',
        '',
        '- 判出场景后：scenario_load(scenario) —— 它交付该层的 AGENT.md 与硬规则',
        '- 要写记忆：memory_write(kind, title, content, scope)',
        '- 要查旧经验：memory_search(query)',
      )
      return parts.join('\n')
    },
  },

  {
    name: 'scenario_load',
    description:
      'Load one scenario: its card (including how "done" is judged), the scenario-layer AGENT.md and rules.md, ' +
      'the project-layer AGENT.md and rules.md if they exist, and the paths you will write to. This is the M1 ' +
      'delivery — load it before doing the work, not after.',
    parameters: {
      type: 'object',
      properties: {
        scenario: str('Scenario id, e.g. code / design / prd.'),
        project: str('Optional project id override; defaults to the current workspace project.'),
      },
      required: ['scenario'],
    },
    async run(args, host) {
      const { root, cwd } = host
      const scenario = assertSafeId(String(args.scenario ?? ''), 'scenario')
      const projectUsed = projectArg(args, host)

      const detail = readScenario(root, scenario)
      if (!detail) {
        const ids = listScenarios(root).map((card) => card.id)
        throw new Error(
          `没有场景 ${scenario}。可用场景：${ids.length > 0 ? ids.join(' / ') : '（无）'}。` +
            `可以在 ${scenarioLayerDir(root, scenario)}/ 下自建一个。`,
        )
      }

      patchState(root, { scenario, project: projectUsed })

      const parts = [`## 场景 ${scenario}（${detail.card.name}）`, '']
      if (detail.card.description) parts.push(detail.card.description, '')
      if (detail.card.produces) parts.push(`产出：${detail.card.produces}`, '')
      if (detail.card.acceptance) parts.push(`验收：${detail.card.acceptance}`, '')
      if (detail.card.when.length > 0) parts.push(`判据：${detail.card.when.join(' / ')}`, '')

      parts.push('## 场景层工作说明（AGENT.md）', '')
      parts.push(
        detail.agentDoc?.trim() ||
          '（这个场景还没有 AGENT.md：建议写一份，说明开工步骤、产物形态、纪律。）',
      )

      parts.push('', '## 场景层硬规则（rules.md）', '')
      parts.push(detail.rules?.trim() || '（还没有硬规则。有「违反会不可逆」的约束时再写。）')

      const scenarioLayer = layerPaths(scenarioLayerDir(root, scenario))
      const projectLayer = layerPaths(projectDir(root, scenario, projectUsed))
      parts.push('', `## 项目层 ${projectUsed}`, '')
      parts.push('工作说明（AGENT.md）：')
      parts.push(readText(projectLayer.agentDoc)?.trim() || '（还没有。第一次在这个项目干活，会先探索。）')
      parts.push('', '硬规则（rules.md）：')
      parts.push(readText(projectLayer.rules)?.trim() || '（还没有。）')

      parts.push('', '## 两层的位置', '')
      parts.push(...layerSummary(root, scenario, projectUsed))

      parts.push('', '## 写到哪里', '')
      parts.push(`- 跨项目通用 → scope=scenario（${scenarioLayer.records}/）`)
      parts.push(`- 只对这个项目 → scope=project（${projectLayer.records}/）`)
      parts.push(`- 硬规则 → doc_write 到 ${projectLayer.rules}`)
      parts.push(`- 跨项目通用的硬规则 → doc_write 到 ${scenarioLayer.rules}`)
      parts.push(`- 该层的工作说明 → doc_write 到 ${projectLayer.agentDoc}`)
      parts.push(
        host.writeNotice?.trim() ||
          '- 数据根里的文件一律用 mesync 的工具写，别用你自己的文件工具。',
      )

      parts.push('', '## 按需读', '')
      parts.push(`- 心法：${META_NAMES.map((name) => `meta/${name}.md`).join(' / ')}`)
      parts.push(`- M4 的判断分支：${CHAIN_DOCS[0]}`)
      parts.push(`- workspace：${cwd}`)

      if (detail.tools.length > 0) {
        parts.push('', '## 登记的工具（你自己执行，mesync 不执行）', '')
        for (const file of detail.tools) parts.push(`- ${scenarioLayer.dir}/tools/${file}`)
      }

      return parts.join('\n')
    },
  },

  {
    name: 'memory_write',
    description:
      'Write one memory. kind = cognition | decision | taste | correction | tool (or pending for an answer ' +
      'the user gave that has not been validated by an accepted artifact yet). scope = scenario (applies to ' +
      'every project) or project (only this one). Do not pass a kind you are unsure about — read meta/<kind>.md ' +
      'first. Content is prose, not fields.',
    parameters: {
      type: 'object',
      properties: {
        kind: str('cognition / decision / taste / correction / tool / pending.'),
        title: str('One line: what this memory is about.'),
        content: str('The prose body.'),
        scope: str('scenario (cross-project) or project. Judge it: does the project name appear in the content?'),
        scenario: str('Scenario id; defaults to the current scenario.'),
        project: str('Project id; defaults to the current workspace project.'),
      },
      required: ['kind', 'title', 'content'],
    },
    async run(args, host) {
      const { root } = host
      const scenario = assertSafeId(resolveScenario(args.scenario, root), 'scenario')
      const projectUsed = projectArg(args, host)

      const kindRaw = String(args.kind ?? '').trim()
      const known: MemoryKind[] = [...KINDS, 'pending']
      const kind = known.find((item) => item === kindRaw)
      if (!kind) throw new Error(`kind 只能是 ${known.join(' / ')}`)

      const title = typeof args.title === 'string' ? args.title.trim() : ''
      if (!title) throw new Error('title 不能为空：一行说明这条记忆是关于什么')
      const content = typeof args.content === 'string' ? args.content : ''
      if (!content.trim()) throw new Error('content 不能为空')

      const scopeRaw = typeof args.scope === 'string' ? args.scope.trim() : ''
      if (scopeRaw && scopeRaw !== 'scenario' && scopeRaw !== 'project') {
        throw new Error('scope 只能是 scenario 或 project')
      }
      const scope: RecordScope = scopeRaw === 'scenario' ? 'scenario' : 'project'

      const { rel } = writeRecord({
        root,
        scope,
        scenario,
        project: projectUsed,
        kind,
        title,
        content,
      })
      patchState(root, { scenario, project: projectUsed })

      if (kind === 'pending') {
        return `⏳ 已记入临时区 ${rel}\n\n这是「暂定」的答案：等产物被认可后升格为正式记忆，被否定就 memory_discard 掉。`
      }
      const where =
        scope === 'scenario'
          ? `${scenario}（场景级，所有项目通用）`
          : `${scenario} / ${projectUsed}（项目级）`
      return `✅ 已写入 ${kind}：${rel}\n\n位置：${where}`
    },
  },

  {
    name: 'memory_search',
    description:
      'Search memory by keyword. Weak substring match, not semantic — if it misses, that is expected; the ' +
      'dependable path is what scenario_load delivers, not this. Returns one line per hit; read full text ' +
      'with memory_read.',
    parameters: {
      type: 'object',
      properties: {
        query: str('Keyword (case-insensitive). Omit to list by scope.'),
        kind: str('cognition / decision / taste / correction / tool.'),
        scope: str('scenario or project.'),
        scenario: str('Only this scenario id.'),
        project: str('Only this project id.'),
        limit: { type: 'number', description: 'Max hits (default 30).' },
      },
    },
    async run(args, host) {
      const { root } = host
      const kindRaw = typeof args.kind === 'string' ? args.kind.trim() : ''
      const kind = kindRaw ? KINDS.find((item) => item === kindRaw) : undefined
      if (kindRaw && !kind) throw new Error(`kind 只能是 ${KINDS.join(' / ')}`)

      const scopeRaw = typeof args.scope === 'string' ? args.scope.trim() : ''
      const scope = scopeRaw === 'scenario' || scopeRaw === 'project' ? scopeRaw : undefined
      const scenarioRaw = typeof args.scenario === 'string' ? args.scenario.trim() : ''
      const projectRaw = typeof args.project === 'string' ? args.project.trim() : ''

      const hits = searchMemory({
        root,
        query: typeof args.query === 'string' ? args.query : undefined,
        scenario: scenarioRaw ? assertSafeId(scenarioRaw, 'scenario') : undefined,
        project: projectRaw ? assertSafeId(projectRaw, 'project') : undefined,
        kind,
        scope,
        limit: typeof args.limit === 'number' ? args.limit : 30,
      })

      if (hits.length === 0) return '没有命中的记忆。'
      const parts = ['## 命中', '']
      for (const hit of hits) {
        const where =
          hit.scope === 'scenario' ? `${hit.scenario}（场景级）` : `${hit.scenario}/${hit.project}`
        parts.push(`- [${hit.kind}] ${where} · ${hit.title} — ${hit.ref}`)
      }
      parts.push('', '用 memory_read(path) 读全文。')
      return parts.join('\n')
    },
  },

  {
    name: 'memory_read',
    description:
      'Read one file by path relative to the mesync data root. Use it for meta/<kind>.md, chain-judge.md, ' +
      'chain-rules.md, or any record path returned by memory_search.',
    parameters: {
      type: 'object',
      properties: {
        path: str('e.g. "meta/decision.md" or "scenarios/code/records/taste/x.md".'),
      },
      required: ['path'],
    },
    async run(args, host) {
      const { root } = host
      const rel = String(args.path ?? '').trim()
      if (!rel) throw new Error('path 不能为空')
      // 先钉死路径（越界直接抛），再按「数据根优先、其次打包资源」读
      safeUnder(root, rel)
      const text = readByRel(root, rel)
      if (text === null) {
        const hint = isAbsolute(rel) ? '（要相对路径，不要绝对路径）' : ''
        throw new Error(`找不到 ${rel}${hint}`)
      }
      return text
    },
  },

  {
    name: 'doc_write',
    description:
      'Write a layer document under the data root: rules.md (hard rules + tool list), AGENT.md (how this layer ' +
      'works), or a scenario card. Use this instead of your own file tools. Do not use it for memories; those ' +
      'go through memory_write.',
    parameters: {
      type: 'object',
      properties: {
        path: str('Path relative to the data root, e.g. "scenarios/code/rules.md".'),
        content: str('Full new content (replaces the file).'),
      },
      required: ['path', 'content'],
    },
    async run(args, host) {
      const { root } = host
      const rel = String(args.path ?? '').trim()
      if (!rel) throw new Error('path 不能为空')
      if (typeof args.content !== 'string') throw new Error('content 不能为空')
      writeText(safeUnder(root, rel), args.content)
      return `✅ 已写入 ${rel}（${args.content.length} 字符）`
    },
  },

  {
    name: 'memory_discard',
    description:
      'Delete one file under the data root. Two legitimate uses: drop a pending answer the user rejected, ' +
      'or remove the pending file after promoting it to a real memory. Do not delete real memories — they are ' +
      'history.',
    parameters: {
      type: 'object',
      properties: {
        path: str('Path relative to the data root.'),
      },
      required: ['path'],
    },
    async run(args, host) {
      const rel = String(args.path ?? '').trim()
      if (!rel) throw new Error('path 不能为空')
      const file = safeUnder(host.root, rel)
      return discard(file) ? `🗑 已删除 ${rel}` : `没有这个文件：${rel}`
    },
  },

  {
    name: 'path_record',
    description:
      'M5: append one line describing the path you actually walked, with certainty marks, e.g. ' +
      '"M0!→M1!→M2!→M3!→M4!→D! 把组件版本固定到 v3.2". Mark "!" when the judgement had clear grounds, ' +
      '"?" when you guessed. Record it even when no memory was written.',
    parameters: {
      type: 'object',
      properties: {
        line: str('Path plus one sentence, with !/? marks.'),
        scenario: str('Scenario id; defaults to the current scenario.'),
        project: str('Project id; defaults to the current workspace project.'),
      },
      required: ['line'],
    },
    async run(args, host) {
      const { root } = host
      const scenario = assertSafeId(resolveScenario(args.scenario, root), 'scenario')
      const projectUsed = projectArg(args, host)
      const line = typeof args.line === 'string' ? args.line.trim() : ''
      if (!line) throw new Error('line 不能为空')
      const { rel } = appendPath(root, scenario, projectUsed, line)
      return `📝 已记路径：${rel}`
    },
  },
]

/** 按名字取工具，找不到返回 undefined。 */
export function findTool(name: string): ToolSpec | undefined {
  return TOOLS.find((tool) => tool.name === name)
}