# mesync-core

同频记忆引擎的**内核**：一条判断链、五块心法、一套存储模型。**平台无关**——它不知道 dsh、Claude、Cursor 或任何具体宿主的工具 API 长什么样。

平台适配层（如 `dsh-mesync`）通过 npm 装这个包，只做两件接线的事：把 `TOOLS` 注册成自己平台的工具，把 `residentText()` 的结果注入进对话。

```
mesync-core      心法文本 + 存储模型 + 工具语义      ← 这个包
dsh-mesync       注入 + 工具注册（约 130 行）
```

---

## 为什么这么切

心法（该记什么、怎么记、什么算判断）是**跨平台的方法论**；注入方式和工具注册是**某个平台的机制**。混在一起，每接一个平台就要把心法复制一遍，然后各平台的心法慢慢长歪。

切干净之后，两边各有一条可验证的边界：

- **core 的源码里不出现任何平台包名**（有测试守着）
- **适配层里不出现任何心法判断**——它不做「该不该记」的决定

---

## 内核里有什么

### 1. 判断链（常驻）

Agent 拿到的第一条纪律不是「你有哪些能力」，而是一条链：

```
M0 这次要的是「产出」还是「回答」？
M1 动手前先拿硬规则与相关记忆
M2 做
M3 用户评价？认可 / 否定（重走出错点）/ 无评价
M4 这次留下了什么？判断记成哪一块
M5 记下走过的路径
```

心法、场景说明、判断分支、记忆正文全部**按需读**，所以常驻体积不随记忆增长而膨胀（约 1000 字符）。

### 2. 五块心法

| 块 | 回答什么 | 判据 |
|---|---|---|
| 认知 | 东西是什么、怎么组织 | 客观事实 |
| 决策 | 为什么这么定 | 要推翻它，需不需要先知道为什么？ |
| 品味 | 用户喜欢什么 | 来自用户对某个产物的认可 |
| 纠错 | 为什么错了、怎么不再犯 | 有代价的错，且换个情况还会再犯 |
| 工具 | 哪一步已经不需要判断了 | 输入输出说得清，且没有「看情况」 |

判断「记成哪一块」的逻辑集中在 `chain-judge.md`，五份心法只写「怎么写得对」。

### 3. 存储模型（文件即真相）

```
<数据根>/
  mesync-use.md              常驻正文（可覆盖）
  meta/<五块>.md              心法（按需读）
  chain-judge.md             M4 的判断分支
  chain-rules.md             修链时才读
  scenarios/<场景>/
    scenario.md              场景卡：判据 / 产出 / 验收
    AGENT.md                 场景层工作说明
    rules.md                 场景层硬规则 + 工具清单（M1 交付）
    records/<kind>/          场景级记忆（所有项目通用）
    features/<项目>/
      AGENT.md  rules.md
      records/<kind>/        项目级记忆
  _pending/                 临时区：问出来但还没被验证的答案
  _paths/                   走过的路径
```

一条记忆一个 Markdown：frontmatter 只放定位字段（kind / scope / scenario / project / title / created），正文是散文。**不做字段校验**——该不该记是心法的事，代码只保证存得住、找得到、不丢。

### 4. 八个工具（语义层）

`mesync_context` · `scenario_load` · `memory_write` · `memory_search` · `memory_read` · `doc_write` · `memory_discard` · `path_record`

它们以 **`ToolSpec[]`** 的形式导出：名字、描述、**纯 JSON Schema 参数**、以及一个 `run(args, host)` 函数。

---

## 写一个适配层

接缝只有两个类型（见 `src/host.ts`）：

```ts
export interface HostContext {
  root: string          // 数据根
  cwd: string           // 当前工作目录
  writeNotice?: string  // 可选：这个平台对「能否直接写数据根」的说明
}

export interface ToolSpec {
  name: string
  description: string
  parameters: { type: 'object'; properties: ...; required?: string[] }
  run(args: Record<string, unknown>, host: HostContext): Promise<string>
}
```

一个最小适配层：

```ts
import { TOOLS, residentText, resolveRoot } from 'mesync-core'

export function apply(ctx, config) {
  const root = resolveRoot(config.root)

  // 1. 工具：把 core 的规格翻成你平台的工具
  for (const tool of TOOLS) {
    ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: toYourSchema(tool.parameters),   // 纯 JSON Schema → 你的方言
      execute: (args, exec) =>
        tool.run(args, { root, cwd: cwdOf(exec) }), // exec → HostContext
    })
  }

  // 2. 注入：常驻正文由 core 组装，你只负责塞进对话
  ctx.systemPrompt.variable('mesync_resonance', () =>
    residentText({ root, cwd, project }).text,
  )
}
```

两条注意：

- **注入走占位符中转**。很多宿主会对 section 文本做 `{{变量}}` 插值，而记忆正文里天然有 `{{uri}}`、`style={{ ... }}` 这种片段——直接当 section 文本会把组装打挂。
- **`writeNotice` 请如实填**。如果你的沙箱把数据根挡在 Agent 的文件工具之外，就在这里说明；否则 Agent 会自己找路径写入而失败。

---

## 安装与构建

本包目前以源码链接方式被适配层引用：

```bash
npm install && npm run build     # 产物在 lib/
npm test                          # 80 个测试
```

## 目录

```
src/
  host.ts        ← 接缝（HostContext / ToolSpec / JSON Schema 类型）
  resident.ts    ← 常驻正文组装（纯字符串，不碰平台）
  tools.ts       ← 八个工具的平台无关实现
  memory.ts  search.ts  coverage.ts   ← 存储与检索
  scenario.ts  meta.ts  state.ts      ← 场景、心法读取、运行期状态
  paths.ts  fs.ts  types.ts  assets.ts
  templates/     ← 心法文本（随包发布）
docs/xinfa/      ← 设计文档（架构、链、判断、维护）
```

## License

[MIT](./LICENSE) © 2026 wenliangw