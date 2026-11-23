// assets — 心法 md 的定位
//
// 心法、判断分支、mesync-use、预置场景都**在本包的 templates/ 里**，只读、不拷进
// 数据根：拷进项目正是 0.1.x「模板副本陈旧、改了不生效」的根因。用户要改就在数据根
// 放同名文件覆盖，预置资源永远保持干净。
//
// 所以这里只需要回答一个问题：包根在哪。

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readText } from './fs.js'

/** 包根：编译后本文件在 lib/，源码直跑时在 src/，两者都是包根下一层。 */
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * 内核内容目录（本包的 templates/）。
 *
 * 模板始终在包根的 templates/ 下，所以从 import.meta.url 往上退一层就是包根——
 * 编译产物（lib/）和源码直跑（src/）落在同一个位置，打包、软链、pnpm 的 hoist
 * 都不影响，不猜 node_modules 布局。
 */
export function assetsDir(): string {
  return join(packageRoot, 'templates')
}

/** 资源内某个文件的绝对路径。 */
export function assetFile(relative: string): string {
  return join(assetsDir(), relative)
}

/**
 * 读一份「数据根可覆盖」的资源：先找数据根，找不到再用 core 里的。
 * 心法、链、场景卡都走这条——这样用户能在不改插件的情况下覆盖任何一份。
 */
export function readOverride(root: string, relative: string): string | null {
  return readText(join(root, relative)) ?? readText(assetFile(relative))
}