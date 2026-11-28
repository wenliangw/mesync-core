import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { HostContext } from '../src/host.js'
import { projectId } from '../src/paths.js'
import { readStateFor } from '../src/state.js'
import { findTool, TOOLS } from '../src/tools.js'

interface Harness extends HostContext {
  run(name: string, args?: Record<string, unknown>): Promise<string>
}

/** core 的工具是普通函数：给 root + cwd 就能调，不需要模拟任何平台对象。 */
function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'mesync-core-'))
  const cwd = mkdtempSync(join(tmpdir(), 'mesync-ws-'))
  const host: HostContext = { root, cwd }
  return {
    ...host,
    async run(name, args = {}) {
      const tool = findTool(name)
      if (!tool) throw new Error(`没有工具 ${name}`)
      return tool.run(args, host)
    },
  }
}

/** 当前 harness 所属项目的运行期状态（状态是按项目分键的）。 */
function stateOf(h: Harness) {
  return readStateFor(h.root, projectId(h.cwd))
}

/** 写记忆前先把场景定下来（链上 M0/M1 的产物）。 */
async function inCode(h: Harness, name: string, args: Record<string, unknown> = {}) {
  if (!stateOf(h).scenario) await h.run('scenario_load', { scenario: 'code' })
  return h.run(name, args)
}

describe('工具面', () => {
  it('八个工具，名字稳定', () => {
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual([
      'doc_write',
      'memory_discard',
      'memory_read',
      'memory_search',
      'memory_write',
      'mesync_context',
      'path_record',
      'scenario_load',
    ])
  })

  it('参数是纯 JSON Schema（对象根 + required 数组）', () => {
    for (const tool of TOOLS) {
      expect(tool.parameters.type, tool.name).toBe('object')
      expect(typeof tool.parameters.properties, tool.name).toBe('object')
      if (tool.parameters.required) {
        for (const key of tool.parameters.required) {
          expect(Object.keys(tool.parameters.properties), tool.name).toContain(key)
        }
      }
    }
  })

  it('必需参数都标在 required 里', () => {
    const required = Object.fromEntries(
      TOOLS.map((tool) => [tool.name, tool.parameters.required ?? []]),
    )
    expect(required.scenario_load).toEqual(['scenario'])
    expect(required.memory_write).toEqual(['kind', 'title', 'content'])
    expect(required.memory_read).toEqual(['path'])
    expect(required.doc_write).toEqual(['path', 'content'])
    expect(required.memory_discard).toEqual(['path'])
    expect(required.path_record).toEqual(['line'])
  })
})

describe('mesync_context', () => {
  it('列出场景并给出下一步', async () => {
    const h = harness()
    const text = await h.run('mesync_context')
    expect(text).toContain('## 场景')
    expect(text).toContain('code（代码开发）')
    expect(text).toContain('## 下一步')
    expect(text).toContain('还没有任何产物')
  })
})

describe('scenario_load', () => {
  it('交付场景卡、两层 AGENT.md 与用量', async () => {
    const h = harness()
    const text = await h.run('scenario_load', { scenario: 'code' })
    expect(text).toContain('## 场景 code')
    expect(text).toContain('验收：')
    expect(text).toContain('## 场景层交付（AGENT.md）')
    expect(text).toContain('## 项目层交付')
    expect(text).toContain('## 交付层用量（参考线，不是上限）')
    expect(text).toContain('/ 2000 字符')
    expect(text).toContain('scope=scenario')
    expect(text).toContain('chain-judge.md')
  })

  it('把场景记进运行期状态', async () => {
    const h = harness()
    await h.run('scenario_load', { scenario: 'code' })
    expect(stateOf(h).scenario).toBe('code')
  })

  it('未知场景报错并给出可用清单', async () => {
    const h = harness()
    await expect(h.run('scenario_load', { scenario: 'nope' })).rejects.toThrow(/可用场景/)
  })

  it('旧版 rules.md 会被接进交付并标出来（迁移用）', async () => {
    const h = harness()
    const dir = join(h.root, 'scenarios', 'code')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'rules.md'), '- 出稿前 grep 组件库版本\n', 'utf8')

    const text = await h.run('scenario_load', { scenario: 'code' })
    expect(text).toContain('grep 组件库版本')
    expect(text).toContain('还有独立的 rules.md')
  })

  it('平台可以把自己的写入说明塞进来', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mesync-core-'))
    const cwd = mkdtempSync(join(tmpdir(), 'mesync-ws-'))
    const tool = findTool('scenario_load')!
    const text = await tool.run(
      { scenario: 'code' },
      { root, cwd, writeNotice: '- 这个平台的数据根在你的文件工具之外。' },
    )
    expect(text).toContain('这个平台的数据根在你的文件工具之外')
  })
})

// 这一组测的是**真会发生的损坏**：一个数据根被多个项目共用（现在还会被多个
// 框架共用）时，A 定过的场景不该被 B 悄悄沿用——以前会安静地写进错的场景层。
describe('共用数据根时场景不串', () => {
  function sharedRoot(): { root: string; hostA: HostContext; hostB: HostContext } {
    const root = mkdtempSync(join(tmpdir(), 'mesync-shared-'))
    return {
      root,
      hostA: { root, cwd: mkdtempSync(join(tmpdir(), 'mesync-wsA-')) },
      hostB: { root, cwd: mkdtempSync(join(tmpdir(), 'mesync-wsB-')) },
    }
  }

  it('B 没定场景时明确报错，不拿 A 的', async () => {
    const { hostA, hostB } = sharedRoot()
    await findTool('scenario_load')!.run({ scenario: 'design' }, hostA)

    await expect(
      findTool('memory_write')!.run({ kind: 'cognition', title: 'B 的', content: 'x' }, hostB),
    ).rejects.toThrow(/还没有确定场景/)
  })

  it('各自定过之后互不影响', async () => {
    const { root, hostA, hostB } = sharedRoot()
    await findTool('scenario_load')!.run({ scenario: 'design' }, hostA)
    await findTool('scenario_load')!.run({ scenario: 'code' }, hostB)

    expect(readStateFor(root, projectId(hostA.cwd)).scenario).toBe('design')
    expect(readStateFor(root, projectId(hostB.cwd)).scenario).toBe('code')
  })
})

describe('memory_write', () => {
  it('写项目级记录', async () => {
    const h = harness()
    const out = await inCode(h, 'memory_write', {
      kind: 'cognition',
      title: '检索是子串匹配',
      content: 'search.ts 用 includes，不是语义检索。',
    })
    expect(out).toContain('✅')

    const file = join(
      h.root,
      'scenarios',
      'code',
      'features',
      projectId(h.cwd),
      'records',
      'cognition',
      '检索是子串匹配.md',
    )
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('kind: cognition')
  })

  it('写场景级记录时不带项目字段', async () => {
    const h = harness()
    await inCode(h, 'memory_write', {
      kind: 'taste',
      title: '不喜欢纯黑背景',
      content: '用深灰。',
      scope: 'scenario',
    })
    const text = readFileSync(join(h.root, 'scenarios', 'code', 'records', 'taste', '不喜欢纯黑背景.md'), 'utf8')
    expect(text).toContain('scope: scenario')
    expect(text).not.toContain('project:')
  })

  it('pending 落进临时区，不进正式记录', async () => {
    const h = harness()
    const out = await inCode(h, 'memory_write', {
      kind: 'pending',
      title: '优先 v3.2',
      content: '优先 3.2，缺的组件用 3.1 兜底。',
    })
    expect(out).toContain('临时区')
    expect(existsSync(join(h.root, '_pending', '优先-v3.2.md'))).toBe(true)
  })

  it('空标题报错', async () => {
    const h = harness()
    await inCode(h, 'memory_write', { kind: 'cognition', title: 't', content: 'x' })
    await expect(h.run('memory_write', { kind: 'cognition', title: '  ', content: 'x' })).rejects.toThrow(
      /title/,
    )
  })

  it('未知 kind 报错', async () => {
    const h = harness()
    await inCode(h, 'memory_write', { kind: 'cognition', title: 't', content: 'x' })
    await expect(h.run('memory_write', { kind: 'nope', title: 't', content: 'x' })).rejects.toThrow(/kind/)
  })

  it('同标题不覆盖，换一个 slug', async () => {
    const h = harness()
    await inCode(h, 'memory_write', { kind: 'cognition', title: '同名', content: '第一版' })
    await h.run('memory_write', { kind: 'cognition', title: '同名', content: '第二版' })
    const dir = join(h.root, 'scenarios', 'code', 'features', projectId(h.cwd), 'records', 'cognition')
    expect(existsSync(join(dir, '同名.md'))).toBe(true)
    expect(existsSync(join(dir, '同名-2.md'))).toBe(true)
  })
})

describe('memory_search', () => {
  it('命中关键词并给出相对路径', async () => {
    const h = harness()
    await inCode(h, 'memory_write', {
      kind: 'decision',
      title: '用子串匹配',
      content: '不建索引，避免副本。',
    })
    const text = await h.run('memory_search', { query: '索引' })
    expect(text).toContain('用子串匹配')
    expect(text).toContain('records/decision/')
  })

  it('场景级与项目级都能搜到', async () => {
    const h = harness()
    await inCode(h, 'memory_write', { kind: 'taste', title: '跨项目偏好', content: '都用 pnpm', scope: 'scenario' })
    await h.run('memory_write', { kind: 'taste', title: '本项目偏好', content: '带 --filter' })

    const all = await h.run('memory_search', { query: '偏好' })
    expect(all).toContain('跨项目偏好')
    expect(all).toContain('本项目偏好')
    expect(all).toContain('（场景级）')
  })

  it('没有命中时如实说没有', async () => {
    const h = harness()
    expect(await h.run('memory_search', { query: '不存在的词' })).toContain('没有命中')
  })
})

describe('memory_read', () => {
  it('读得到 meta 心法', async () => {
    const h = harness()
    expect(await h.run('memory_read', { path: 'meta/decision.md' })).toContain('决策')
  })

  it('读得到 chain-judge', async () => {
    const h = harness()
    expect(await h.run('memory_read', { path: 'chain-judge.md' })).toContain('Q1')
  })

  it('拒绝越界路径', async () => {
    const h = harness()
    await expect(h.run('memory_read', { path: '../../etc/passwd' })).rejects.toThrow(/越界/)
  })

  // 覆盖优先于内置：数据根有就用数据根的，没有才回落到包里。
  // 「回落」方向已有测试（空数据根能读到 meta/decision.md），这里补相反的方向。
  it('数据根的同名文件覆盖包内模板', async () => {
    const h = harness()
    mkdirSync(join(h.root, 'meta'), { recursive: true })
    writeFileSync(join(h.root, 'meta', 'decision.md'), '# 我改过的决策写法\n', 'utf8')

    const text = await h.run('memory_read', { path: 'meta/decision.md' })
    expect(text.trim()).toBe('# 我改过的决策写法')
  })

  it('找不到时报错', async () => {
    const h = harness()
    await expect(h.run('memory_read', { path: 'meta/nope.md' })).rejects.toThrow(/找不到/)
  })
})

describe('doc_write', () => {
  it('写入该层 AGENT.md，之后 scenario_load 能读到', async () => {
    const h = harness()
    await h.run('doc_write', {
      path: 'scenarios/code/AGENT.md',
      content: '- 出稿前 grep 组件库版本\n  来源：records/decision/组件版本.md\n',
    })
    expect(await h.run('scenario_load', { scenario: 'code' })).toContain('grep 组件库版本')
  })

  it('超参考线只提醒，不拦截', async () => {
    const h = harness()
    const big = '要压缩的一段。\n\n' + 'x'.repeat(2400)
    const out = await h.run('doc_write', { path: 'scenarios/code/AGENT.md', content: big })

    expect(out).toContain('已写入')
    expect(out).toContain('要不要重新整理')
    expect(out).toContain('最长的几块')
    // 内容确实写进去了——提醒不是拒绝
    const onDisk = readFileSync(join(h.root, 'scenarios', 'code', 'AGENT.md'), 'utf8')
    expect(onDisk).toContain('要压缩的一段')
    expect(await h.run('scenario_load', { scenario: 'code' })).toContain('要压缩的一段')
  })

  it('没超参考线就不打扰', async () => {
    const h = harness()
    const out = await h.run('doc_write', {
      path: 'scenarios/code/AGENT.md',
      content: '- 短的一条',
    })
    expect(out).toContain('已写入')
    expect(out).not.toContain('要不要重新整理')
  })

  it('场景卡不套交付参考线', async () => {
    const h = harness()
    const out = await h.run('doc_write', {
      path: 'scenarios/code/scenario.md',
      content: 'x'.repeat(2500),
    })
    expect(out).not.toContain('要不要重新整理')
  })

  it('拒绝越界路径', async () => {
    const h = harness()
    await expect(h.run('doc_write', { path: '../x.md', content: 'x' })).rejects.toThrow(/越界/)
  })
})

describe('memory_discard', () => {
  it('删掉临时答案', async () => {
    const h = harness()
    await inCode(h, 'memory_write', { kind: 'pending', title: '待验证', content: 'x' })
    expect(existsSync(join(h.root, '_pending', '待验证.md'))).toBe(true)

    expect(await h.run('memory_discard', { path: '_pending/待验证.md' })).toContain('已删除')
    expect(existsSync(join(h.root, '_pending', '待验证.md'))).toBe(false)
  })
})

describe('path_record', () => {
  it('追加一行走过的路径', async () => {
    const h = harness()
    await h.run('scenario_load', { scenario: 'code' })
    await h.run('path_record', { line: 'M0!→M1!→M2!→M3!→M4!→K! 记了一条认知' })
    expect(readFileSync(join(h.root, '_paths', `code-${projectId(h.cwd)}.md`), 'utf8')).toContain(
      'M0!→M1!→M2!→M3!→M4!→K!',
    )
  })
})

describe('路径安全', () => {
  it('场景 id 不能带 ../', async () => {
    const h = harness()
    await expect(h.run('scenario_load', { scenario: '../../etc' })).rejects.toThrow(/不合法/)
  })

  it('project 不能跳到数据根外', async () => {
    const h = harness()
    await inCode(h, 'memory_write', { kind: 'cognition', title: 't', content: 'x' })
    await expect(
      h.run('memory_write', { kind: 'cognition', title: 't2', content: 'x', project: '../../escape' }),
    ).rejects.toThrow(/不合法/)
  })

  it('正常 id 不被误伤', async () => {
    const h = harness()
    const out = await inCode(h, 'memory_write', {
      kind: 'cognition',
      title: 't',
      content: 'x',
      scenario: 'code',
      project: 'owner-repo.v2',
    })
    expect(out).toContain('✅')
  })
})

// 心法是开放式的，但只开放「内容级」：用户可以改写五份心法与常驻链的措辞，
// 甚至整份替换；**不能加第六块**。结构固定，是为了让判断链的五个叶子始终闭合。
//
// 这条边界两侧都有人守：
//   - 内容侧：mesync-core 的 content.test.mjs 断言 chain-judge.md 恰好引用 5 份心法
//   - 代码侧：这条测试——第六个 kind 会被拒绝，不会静默地多出一个没人读的目录
//
// 要放开结构级，得同时改这两处（并想清楚第六块在判断链里挂在哪）。
describe('结构边界：只支持内容级', () => {
  it('五块都能写', async () => {
    const h = harness()
    for (const kind of ['cognition', 'decision', 'taste', 'correction', 'tool']) {
      const out = await inCode(h, 'memory_write', { kind, title: `t-${kind}`, content: 'x' })
      expect(out).toContain('✅')
    }
  })

  it('第六块被明确拒绝，不静默落盘', async () => {
    const h = harness()
    await expect(
      inCode(h, 'memory_write', { kind: 'sixth', title: '第六块', content: 'x' }),
    ).rejects.toThrow(/kind 只能是/)
  })
})