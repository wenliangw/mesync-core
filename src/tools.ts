// tools — 工具语义（平台无关）
//
// 八个工具，各管一件事：
//   mesync_context   判断前看一眼：有哪些场景、当前在哪、知道多少
//   scenario_load    交付一层的 AGENT.md（M1：做法 + 必须遵守的 + 默认做法）
//   memory_write     写一条记忆（kind + scope 由 Agent 判断，代码不替他判）
//   memory_search    按关键词定位一条已知存在的记忆（查找，不是召回）
//   memory_read      按相对路径读任意文件（心法、链、记录都走它）
//   doc_write        写层交付文档（AGENT.md / 场景卡），有参考线
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

import { basename, isAbsolute, normalize, resolve, sep } from 'node:path'

import { coverageAll, formatCoverage } from './coverage.js'
import { readText, writeText } from './fs.js'
import type { HostContext, ToolSpec } from './host.js'
import { appendPath, discard, readByRel, writeRecord } from './memory.js'
import { CHAIN_DOCS, META_NAMES } from './meta.js'
import { layerPaths, legacyRulesFile, projectDir, projectId, scenarioLayerDir } from './paths.js'
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

/** 交付文件的参考线：超过它就该想想要不要重新整理，但不拦截写入。 */
const DELIVERY_LINE = 2000

/** 交付文本里最长的几块，给「该压哪一条」一个具体对象。 */
function longestBlocks(text: string, max = 3): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => ({ head: block.replace(/\s+/g, ' ').slice(0, 40), size: block.length }))
    .sort((a, b) => b.size - a.size)
    .slice(0, max)
    .map((block, index) => `${index + 1}. 「${block.head}…」 ${block.size} 字符`)
}

/** 一层交付现在多大，后面跟着参考线。 */
function usageLine(dir: string): string {
  const size = (readText(layerPaths(dir).agentDoc) ?? '').length
  return `${size} / ${DELIVERY_LINE} 字符`
}

/**
 * 一层的交付文本：AGENT.md 原样；旧版 rules.md 若还在就接在后面并标出来。
 * 不自动合并——合并要判断，判断归 Agent。
 */
function deliveryText(dir: string): string {
  const doc = readText(layerPaths(dir).agentDoc)?.trim() ?? ''
  const legacy = readText(legacyRulesFile(dir))?.trim() ?? ''
  if (!legacy) return doc
  return [doc, '', '⚠ 这层还有独立的 rules.md（想留的内容并进上面后把它删掉）：', legacy]
    .join('\n')
    .trim()
}

/** 看某个作用域现在有没有东西，返回几行。 */
function layerSummary(root: string, scenario: string, project: string): string[] {
  const scenarioLayer = layerPaths(scenarioLayerDir(root, scenario))
  const projectLayer = layerPaths(projectDir(root, scenario, project))
  return [
    `- 场景层 ${scenarioLayer.dir} · 交付 ${usageLine(scenarioLayer.dir)}`,
    `- 项目层 ${projectLayer.dir} · 交付 ${usageLine(projectLayer.dir)}`,
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
      parts.push(...scenarioLines(cards, root))
      parts.push('', '## 当前', '')
      parts.push(`- workspace 项目：${projectOf(host)}`)
      parts.push(`- 上次场景：${state.scenario ?? '（无）'}`)
      parts.push('', '## 记忆覆盖度', '')
      parts.push(...coverage)
      parts.push(
        '',
        '## 下一步',
        '',
        '- 判出场景后：scenario_load(scenario) —— 它交付该层的 AGENT.md',
        '- 要写记忆：memory_write(kind, title, content, scope)',
        '- 要追一条已知存在的记忆：memory_search(query)',
      )
      return parts.join('\n')
    },
  },

  {
    name: 'scenario_load',
    description:
      'Load one scenario: its card (including how "done" is judged), the scenario-layer AGENT.md, the ' +
      'project-layer AGENT.md if it exists, and how full each delivery file is against the reference line. ' +
      'This is the M1 delivery — load it before doing the work, not after.',
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

      const scenarioDirPath = scenarioLayerDir(root, scenario)
      const projectDirPath = projectDir(root, scenario, projectUsed)

      parts.push('## 场景层交付（AGENT.md）', '')
      parts.push(
        deliveryText(scenarioDirPath) ||
          detail.agentDoc?.trim() ||
          '（这个场景还没有 AGENT.md：建议写一份——开工步骤、产物形态、必须遵守的、默认做法。）',
      )

      parts.push('', `## 项目层交付（${projectUsed}）`, '')
      parts.push(
        deliveryText(projectDirPath) ||
          '（还没有。第一次在这个项目干活，会先探索，然后把做法写进去。）',
      )

      parts.push('', '## 交付层用量（参考线，不是上限）', '')
      parts.push(...layerSummary(root, scenario, projectUsed))

      parts.push('', '## 写到哪里', '')
      parts.push(`- 跨项目通用 → scope=scenario（${scenarioDirPath}/records/）`)
      parts.push(`- 只对这个项目 → scope=project（${projectDirPath}/records/）`)
      parts.push(`- 该层的做法与硬约束 → doc_write 到 ${projectDirPath}/AGENT.md`)
      parts.push(`- 跨项目通用的 → doc_write 到 ${scenarioDirPath}/AGENT.md`)
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
        for (const file of detail.tools) parts.push(`- ${scenarioDirPath}/tools/${file}`)
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
      'Locate a record you already know exists (查找), e.g. "I know we decided something about pnpm — what was ' +
      'the reason?". Pass a word that is literally in it. This is NOT recall: it cannot tell you what is ' +
      'relevant to a new task, because substring match has no idea about meaning. The dependable path is what ' +
      'scenario_load delivers. Returns one line per hit; read full text with memory_read.',
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
      'Write a layer document under the data root: AGENT.md (how this layer works + what must be obeyed + ' +
      'defaults) or a scenario card. Use this instead of your own file tools. Do not use it for memories; ' +
      'those go through memory_write. AGENT.md has a reference line: going over it triggers a reminder to ' +
      'reconsider how it is organized — never a refusal.',
    parameters: {
      type: 'object',
      properties: {
        path: str('Path relative to the data root, e.g. "scenarios/code/AGENT.md".'),
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

      const size = args.content.length
      const base = `✅ 已写入 ${rel}（${size} 字符）`
      if (basename(rel) !== 'AGENT.md' || size <= DELIVERY_LINE) return base

      const longest = longestBlocks(args.content)
      const lines = [base, '', `⚠ 这层现在 ${size} / ${DELIVERY_LINE} 字符。要不要重新整理一下？`]
      if (longest.length > 0) lines.push('', '最长的几块：', ...longest)
      lines.push(
        '',
        '三个可以问自己：',
        '· 有两条其实在说同一件事吗？',
        '· 最长那条能不能一句话说完？',
        '· 有没有一条不该在这里——能不能变成项目里的检查，或者代码注释？',
        '',
        '想完觉得已经最简，就放着。下次再超线还会提醒。',
      )
      return lines.join('\n')
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