// memory — 记录的存与取
//
// 一条记录 = 一个 markdown 文件。散文是正文，frontmatter 只放定位字段
// （kind / scope / scenario / project / title / created）。
//
// 为什么不用 JSON：记录是给 Agent 读的散文，字段标签反复出现却不承载信息。
// 同一信息写成字段版贵差不多一倍，而结构化的收益（机器处理）我们不需要。
//
// 为什么不校验内容：写什么、够不够格记，是心法的事。代码只管三件——
// 存得住、找得到、不丢。

import { appendFileSync, existsSync, rmSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { readOverride } from './assets.js'
import { ensureDir, listDirs, listFiles, parseFront, readText, writeText } from './fs.js'
import {
  layerPaths,
  pathsDir,
  pendingDir,
  recordsDir,
  scopeDir,
} from './paths.js'
import type { MemoryKind, MemoryRecord, RecordScope } from './types.js'

/** 写一条记录需要的全部输入。scope 由调用方（Agent）判断，代码不猜。 */
export interface WriteRecordInput {
  root: string
  scope: RecordScope
  scenario: string
  project: string
  kind: MemoryKind
  title: string
  content: string
}

function frontmatter(fields: Array<[string, string]>): string {
  const lines = fields
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}: ${value.replace(/\n/g, ' ')}`)
  return ['---', ...lines, '---', ''].join('\n')
}

/**
 * 标题 → 文件名。
 *
 * 不能用 sanitizeId：那会把中文全剥掉，而记忆标题几乎都是中文，结果是
 * 一堆 untitled、untitled-2……所以这里只替换文件名里真正非法的字符。
 */
function slugForFile(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return cleaned.length > 0 ? cleaned : 'untitled'
}

/** 推一个不撞车的文件名：撞了就加序号。 */
function slugFor(dir: string, title: string): string {
  const base = slugForFile(title)
  let candidate = base
  let n = 2
  while (existsSync(join(dir, `${candidate}.md`))) {
    candidate = `${base}-${n}`
    n += 1
  }
  return candidate
}

/**
 * 写一条记录。返回它相对数据根的路径。
 *
 * 临时区（kind=pending）单独落在 _pending/，不进入正式记忆：
 * 问出来的答案要等成果被认可才升格，否则一条没验证的假定会变成下次的「依据」。
 */
export function writeRecord(input: WriteRecordInput): { file: string; rel: string } {
  const { root, scope, scenario, project, kind, title, content } = input
  const created = new Date().toISOString()

  if (kind === 'pending') {
    const dir = pendingDir(root)
    ensureDir(dir)
    const file = join(dir, `${slugFor(dir, title)}.md`)
    writeText(
      file,
      [
        frontmatter([
          ['kind', 'pending'],
          ['scenario', scenario],
          ['project', project],
          ['title', title],
          ['created', created],
        ]),
        `## ${title}`,
        '',
        content.trim(),
        '',
      ].join('\n'),
    )
    return { file, rel: relativeTo(root, file) }
  }

  const dir = recordsDir(scopeDir(root, scope, scenario, project), kind)
  ensureDir(dir)
  const file = join(dir, `${slugFor(dir, title)}.md`)
  writeText(
    file,
    [
      frontmatter([
        ['kind', kind],
        ['scope', scope],
        ['scenario', scenario],
        ['project', scope === 'project' ? project : ''],
        ['title', title],
        ['created', created],
      ]),
      `## ${title}`,
      '',
      content.trim(),
      '',
    ].join('\n'),
  )
  return { file, rel: relativeTo(root, file) }
}

function relativeTo(root: string, file: string): string {
  return relative(root, file)
}

/** 把一层目录下的全部记录读出来。records/<kind>/<slug>.md 两层。 */
export function listRecords(
  root: string,
  scope: RecordScope,
  scenario: string,
  project: string,
): MemoryRecord[] {
  const dir = scopeDir(root, scope, scenario, project)
  const out: MemoryRecord[] = []
  for (const kindDir of listSubdirs(layerPaths(dir).records)) {
    const kind = kindDirName(kindDir)
    if (!kind) continue
    for (const file of listFiles(kindDir, '.md')) {
      const record = readRecordFile(root, file)
      if (record) out.push({ ...record, kind, scope, scenario, project })
    }
  }
  return out
}

function listSubdirs(dir: string): string[] {
  return listDirs(dir).map((name) => join(dir, name))
}

function kindDirName(dir: string): MemoryKind | null {
  const name = basename(dir)
  const known: MemoryKind[] = ['cognition', 'decision', 'taste', 'correction', 'tool', 'pending']
  return (known.find((kind) => kind === name) as MemoryKind | undefined) ?? null
}

/** 读一个记录文件（不看目录，只看 frontmatter）。 */
export function readRecordFile(root: string, file: string): MemoryRecord | null {
  const text = readText(file)
  if (text === null) return null
  const front = parseFront(text)
  const pick = (key: string): string => {
    const raw = front.fields[key]
    return (Array.isArray(raw) ? raw[0] : raw) ?? ''
  }
  return {
    kind: (pick('kind') as MemoryKind) || 'cognition',
    scope: (pick('scope') as RecordScope) || 'project',
    scenario: pick('scenario'),
    project: pick('project'),
    title: pick('title') || basename(file).replace(/\.md$/, ''),
    created: pick('created'),
    body: front.body,
    file,
    rel: relativeTo(root, file),
  }
}

/** 读任意相对路径：数据根优先，找不到再找打包资源（心法与链都在资源里）。 */
export function readByRel(root: string, rel: string): string | null {
  return readOverride(root, rel)
}

/** 删一个文件（升格后清掉临时记录、或丢弃错答案）。 */
export function discard(file: string): boolean {
  try {
    if (!existsSync(file)) return false
    rmSync(file)
    return true
  } catch {
    return false
  }
}

/**
 * 追加一条走过的路径（M5）。
 * 路径是判据的原料：全 `!` 且产物被认可，才算一次确认。
 */
export function appendPath(
  root: string,
  scenario: string,
  project: string,
  line: string,
): { file: string; rel: string } {
  const dir = pathsDir(root)
  ensureDir(dir)
  const file = join(dir, `${scenario}-${project}.md`)
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const chunk = `${stamp}  ${line.trim()}\n`
  if (existsSync(file)) appendFileSync(file, chunk, 'utf8')
  else writeText(file, `# ${scenario} / ${project} 走过的路径\n\n${chunk}`)
  return { file, rel: relativeTo(root, file) }
}

/** 记录一次临时答案被升格（供 M5 清理时判断）。 */
export function pendingFiles(root: string): string[] {
  return listFiles(pendingDir(root), '.md')
}