// fs — 文件即真相的底层读写
//
// 两条纪律：
// 1. 写入一律「临时文件 + rename」，避免半截文件；
// 2. 追加型文件先按标题去重，重复写入不会写第二遍。

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

/** 递归创建目录。 */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

/** 读文本；不存在或读失败都返回 null（调用方不含异常分支）。 */
export function readText(file: string): string | null {
  try {
    if (!existsSync(file)) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** 原子写文本：先写同目录临时文件，再 rename 覆盖。 */
export function writeText(file: string, content: string): void {
  ensureDir(dirname(file))
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

/** 读 JSON；损坏或不存在返回 null，单条坏记录不该拖垮整库。 */
export function readJson<T>(file: string): T | null {
  const text = readText(file)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** 原子写 JSON（两空格缩进，便于人读与 diff）。 */
export function writeJson(file: string, value: unknown): void {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** 列出目录下指定后缀的文件（非递归），目录不存在返回空数组。 */
export function listFiles(dir: string, ext: string): string[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith(ext))
      .sort()
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

/** 递归列出目录下指定后缀的文件。 */
export function listFilesDeep(dir: string, ext: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    try {
      if (!existsSync(current)) return
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(ext)) out.push(full)
      }
    } catch {
      // 单个目录不可读不影响其他分支
    }
  }
  walk(dir)
  return out.sort()
}

/** 列出目录下的子目录名（非递归）。 */
export function listDirs(dir: string): string[] {
  try {
    if (!existsSync(dir)) return []
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) out.push(entry.name)
    }
    return out.sort()
  } catch {
    return []
  }
}

/** frontmatter 解析结果。 */
export interface Front {
  fields: Record<string, string | string[]>
  body: string
}

/**
 * 解析 `---` 包裹的 frontmatter。
 * 只支持 mesync 自己写的那点 YAML：`key: value`、`key: [a, b]`、以及
 * `key:` 换行后跟 `  - item` 的块列表。不引入 YAML 依赖。
 * 键允许中文（场景卡用 `验收:` 这种写法）。
 */
export function parseFront(text: string): Front {
  const fields: Record<string, string | string[]> = {}
  const normalized = text.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---')) return { fields, body: normalized }

  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return { fields, body: normalized }

  const head = normalized.slice(3, end)
  const body = normalized.slice(end + 4).replace(/^\r?\n/, '')

  let pendingKey: string | null = null
  for (const rawLine of head.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.trim() === '') continue

    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && pendingKey) {
      const current = fields[pendingKey]
      const value = item[1].trim()
      fields[pendingKey] = Array.isArray(current) ? [...current, value] : [value]
      continue
    }

    const kv = /^([^\s:][^:]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]
    const value = kv[2].trim()
    if (value === '') {
      pendingKey = key
      fields[key] = []
      continue
    }
    pendingKey = null
    if (value.startsWith('[') && value.endsWith(']')) {
      fields[key] = value
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    } else {
      fields[key] = value.replace(/^["']|["']$/g, '')
    }
  }

  return { fields, body }
}

/** 取 frontmatter 里的标量字段。 */
export function frontString(front: Front, key: string): string {
  const value = front.fields[key]
  if (Array.isArray(value)) return value.join(' / ')
  return value ?? ''
}

/** 取 frontmatter 里的列表字段。 */
export function frontList(front: Front, key: string): string[] {
  const value = front.fields[key]
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()]
  return []
}

/**
 * 往「一文件多条」的文件里追加一个块。
 * 已存在同标题的块时跳过——派生是幂等的，重复写不等于记了两次。
 */
export function appendBlock(file: string, header: string, block: string): boolean {
  const existing = readText(file)
  const firstLine = block.split('\n', 1)[0] ?? ''
  if (existing && existing.includes(`\n${firstLine}\n`)) return false
  if (existing && existing.trimStart().startsWith(firstLine)) return false

  ensureDir(dirname(file))
  const chunk = existing ? `\n\n${block}\n` : `${header}\n\n${block}\n`
  if (existing) {
    appendFileSync(file, chunk, 'utf8')
  } else {
    writeText(file, chunk)
  }
  return true
}