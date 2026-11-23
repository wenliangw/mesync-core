// meta — 心法的读取
//
// 五块心法是有且只有一份的（认知 / 决策 / 品味 / 纠错 / 工具）。场景不重定义它们，
// 只能基于它们写自己的 AGENT.md。这里只负责「把正文读出来」，注入由调用方决定。
//
// 除心法外还有两份链的按需部分：chain-judge.md（M4 才读）与 chain-rules.md（修链才读）。

import { join } from 'node:path'

import { readOverride } from './assets.js'

/** 五块心法的名字。顺序与判断链的叶子一致。 */
export const META_NAMES = ['cognition', 'decision', 'taste', 'correction', 'tool'] as const

export type MetaName = (typeof META_NAMES)[number]

/** 按需读的链文件。 */
export const CHAIN_DOCS = ['chain-judge.md', 'chain-rules.md'] as const

/** 读一份心法正文。 */
export function readMeta(root: string, name: MetaName): string | null {
  return readOverride(root, join('meta', `${name}.md`))
}

/** 读常驻注入正文（mesync-use）。 */
export function readUseDoc(root: string): string | null {
  return readOverride(root, 'mesync-use.md')
}

/** 读链的按需部分（chain-judge / chain-rules）。 */
export function readChainDoc(root: string, name: (typeof CHAIN_DOCS)[number]): string | null {
  return readOverride(root, name)
}