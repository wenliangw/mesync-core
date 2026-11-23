# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-11-24

从「纯内容包」变成「内容 + 机制」。**心法仍是 md，机制搬进来了。**

### 破坏性变更

- **性质变了**：不再是 `main`/`bin`/`dependencies` 全无的纯内容包。新增 `main`、`type: module`、编译产物 `lib/`、`tsconfig.json`、`vitest`。**仍然没有运行期依赖**（只用 Node 内置模块），也仍然没有 `bin`。
- **接入方不再需要自己实现存储与工具**：`resolveRoot` / `residentText` / `TOOLS` / `findTool` 等现在从这里导出。原先每个接入方都要实现一遍存储布局与八个工具，现在退化成「把 `TOOLS` 注册成自己的工具 + 把 `residentText()` 的文本送到自己的注入通道」。
- **`content.test.mjs` 的「纯内容」守卫随之改写**：原断言 `main === undefined` 与新定位互斥。改为三条等价约束——md 导出齐全、无 `bin`、无运行期依赖。

### 新增

- `src/`（14 个模块，约 1700 行）从 `dsh-mesync` 原样搬入：`host` 接缝定义、`paths` 布局、`fs`/`memory` 读写、`search` 查找、`coverage` 覆盖度、`scenario` 场景卡、`state` 运行期状态、`meta` 心法解析、`resident` 注入文本拼装、`tools` 八个工具、`assets` 模板定位、`types`、以及库入口 `index.ts`。
- `assets.ts` 的模板定位从 `createRequire('mesync-core/package.json')` 改为基于 `import.meta.url` 找包根——它现在在包内部，不需要再「从外面看进来」。

### 搬迁原则

判据：**一条代码放哪，只看它需不需要知道「框架叫什么」。** 不需要 → 这里；需要 → 适配层。
搬过来的 13 个文件里有 12 个与搬迁前逐字节相同，只改了 `assets.ts`（模板定位）。

## [0.1.0] - 2026-11-22

定形为**纯内容包**：只有 Markdown，没有代码。

### 内容

- **判断链** `mesync-use.md`：`M0 → M1 → M2 → M3 → M4 → M5`，约 690 字符。心法、场景说明、判断分支、记忆正文全部按需读，常驻体积不随记忆增长。
- **五块心法** `meta/`：认知 / 决策 / 品味 / 纠错 / 工具。分工是「`chain-judge.md` 回答记成哪一块，心法只回答这一块怎么写得对」。
- **判断分支** `chain-judge.md`：五个叶子 + 用哪个工具写 + 落在哪一层。
- **维护规则** `chain-rules.md`：确定度、掉落与修正、节点状态、可读与可查。
- **三个场景** `scenarios/{code,design,prd}`：场景卡带 `判据 / 产出 / 验收`，工作说明 `AGENT.md`。
- **设计文档** `docs/`：架构、链、判断、五块心法。

### 边界

- **零代码、零依赖**：没有 `bin`、没有 `main`、没有 `dependencies`，有测试守着。
- **md 里的路径是规范**：`meta/<kind>.md`、该层 `rules.md`、`records/<kind>/` 这些路径，接入方要实现。
- **平台事实不进 md**：像「数据根在沙箱之外」这类某平台独有的事实由接入方在执行时补充，md 只写纪律。

### 从 0.0.x 的变化

上一版把存储模型与八个工具的语义也放在这个包里（以 `ToolSpec` 导出）。0.1.0 把它们全部移回各平台的实现——**这个包只回答「记什么、怎么记」，不回答「怎么存」**。

理由：机制一旦共享，就会长出配置、迁就、例外，最后反过来绑住心法；而心法的价值恰恰在于它不依赖任何实现。代价明确：跨平台复用的只有心法，实现要各写一遍。

### 同期修正（漂移守卫发现）

- 常驻链从未让 Agent 调 `mesync_context`（判不准场景时的入口）——已补进 M0。
- 常驻链从未提到 `memory_read`，而它要求 Agent「读 chain-judge.md」「读 meta/<kind>.md」——补进 M4。
- `_pending/` 只有写入没有出口：临时答案升格与删除的步骤缺失——补进 `chain-judge.md`。