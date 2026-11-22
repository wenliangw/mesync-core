// assets — 插件内置资源的定位
//
// 心法、判断分支、mesync-use、预置场景都随插件发布，**只读、不拷进数据根**：
// 拷进项目正是 0.1.x「模板副本陈旧、改了不生效」的根因。
// 用户要改就在数据根放同名文件覆盖，预置资源永远保持干净。

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readText } from './fs.js'

/** 内置资源目录。源码时是 src/templates，构建后是 lib/templates。 */
export function assetsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'templates')
}

/** 资源内某个文件的绝对路径。 */
export function assetFile(relative: string): string {
  return join(assetsDir(), relative)
}
/**
 * 读一份「数据根可覆盖」的资源：先找数据根，找不到再用打包的。
 * 心法、链、场景卡都走这条——这样用户能在不改插件的情况下覆盖任何一份。
 */
export function readOverride(root: string, relative: string): string | null {
  return readText(join(root, relative)) ?? readText(assetFile(relative))
}
