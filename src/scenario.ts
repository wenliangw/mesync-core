// scenario — 场景卡的读取与清单
//
// 场景卡是数据，不是代码：加一个目录就多一个场景，不需要改任何逻辑。
// 目录分工：预置场景随插件发布（只读），用户目录可覆盖其中的文件，
// 并承载场景自己的 AGENT.md、features/。
//
// 场景层就是定位轴上的第一层，同时也是一层作用域：跨项目通用的约束落在这里。

import { join } from 'node:path'

import { assetsDir } from './assets.js'
import { frontList, frontString, listDirs, listFiles, parseFront, readText } from './fs.js'
import { layerPaths, scenarioLayerDir } from './paths.js'
import type { ScenarioCard } from './types.js'

const CARD_FILE = 'scenario.md'
const AGENT_FILE = 'AGENT.md'

/** 从卡文件解析出场景卡；`dir` 指向该场景层（产物写在那里）。 */
function cardFromFile(file: string, dir: string, source: 'preset' | 'user'): ScenarioCard | null {
  const text = readText(file)
  if (text === null) return null
  const front = parseFront(text)
  const id = frontString(front, 'id')
  if (!id) return null
  return {
    id,
    name: frontString(front, 'name') || id,
    description: frontString(front, 'description'),
    when: frontList(front, 'when'),
    produces: frontString(front, 'produces'),
    acceptance: frontString(front, '验收'),
    source,
    dir,
  }
}

function presetCardDir(id: string): string {
  return join(assetsDir(), 'scenarios', id)
}

/** 列出全部场景：预置在前，用户覆盖在后，同 id 后者胜。 */
export function listScenarios(root: string): ScenarioCard[] {
  const byId = new Map<string, ScenarioCard>()

  for (const id of listDirs(join(assetsDir(), 'scenarios'))) {
    const dir = scenarioLayerDir(root, id)
    const card = cardFromFile(join(presetCardDir(id), CARD_FILE), dir, 'preset')
    if (card) byId.set(card.id, card)
  }

  const userBase = join(root, 'scenarios')
  for (const id of listDirs(userBase)) {
    const dir = join(userBase, id)
    const card = cardFromFile(join(dir, CARD_FILE), dir, 'user')
    if (card) {
      byId.set(card.id, card)
      continue
    }
    // 用户只加了 features/ 而没有自己的卡：沿用预置卡，不要凭空造一个
    if (byId.has(id)) continue
    byId.set(id, {
      id,
      name: id,
      description: '',
      when: [],
      produces: '',
      acceptance: '',
      source: 'user',
      dir,
    })
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** 一个场景的执行材料：场景卡 + 场景层交付文件（AGENT.md）+ 登记的工具。 */
export interface ScenarioDetail {
  card: ScenarioCard
  agentDoc: string | null
  tools: string[]
}

export function readScenario(root: string, id: string): ScenarioDetail | null {
  const card = listScenarios(root).find((item) => item.id === id)
  if (!card) return null

  const userDir = scenarioLayerDir(root, id)
  const preset = presetCardDir(id)
  const layer = layerPaths(userDir)

  const agentDoc = readText(layer.agentDoc) ?? readText(join(preset, AGENT_FILE))
  const tools = listFiles(join(userDir, 'tools'), '').map((file) => file.split('/').pop() ?? '')

  return { card, agentDoc, tools }
}

/**
 * 生成注入用的场景清单。
 * 只给「名称 + 描述 + 判断语义 + 产出」，正文一律不进注入。
 */
export function scenarioLines(cards: ScenarioCard[]): string[] {
  if (cards.length === 0) {
    return ['- 没有可用的场景：先在 ~/.dsh-mesync/scenarios/ 下建一个场景目录。']
  }
  return cards.map((card) => {
    const when = card.when.length > 0 ? `；判据 ${card.when.join(' / ')}` : ''
    const produces = card.produces ? `；产出 ${card.produces}` : ''
    const label = card.source === 'user' ? `${card.id}（自建）` : `${card.id}（${card.name}）`
    return `- ${label}：${card.description}${when}${produces}`
  })
}