# mesync-core

同频记忆引擎的内核：判断链、五块心法、判断分支与场景卡（**内容**），加上跑它们所需的那套平台无关机制（**代码**）。

**内容 + 机制。** 有 `main`、有编译产物 `lib/`，但**没有运行期依赖**（只用 Node 内置模块），也没有 `bin`。

```
mesync-core      md 心法（规范 + 内容）+ 运行时（存储、检索、工具、注入文本）   ← 这个包
dsh-mesync       DeepSeek Harness 的适配层（约 180 行）：插件入口 + 工具注册 + 配置
其他平台适配      一份 hook 配置 / MCP 配置，通常不用写代码
```

---

## 为什么机制也在这里

心法回答「该记什么、记成哪块、怎么写」；机制回答「存到哪、怎么找、怎么送到眼前」。

原本只有前者在这个包里，后者散在每个接入方那里。代价很快显出来：`dsh-mesync` 原有 1873 行，其中只有 **176 行**真正 import 了平台包，其余 **1697 行一行都没碰过平台**——却因为打包位置的关系，别的框架想复用就得依赖整个 dsh 包，或者抄一遍。

所以判据换成：**一条代码放哪，只看它需不需要知道「框架叫什么」。** 不需要 → 这里；需要 → 适配层。

接入方现在要做的事只剩两件：把 `TOOLS` 注册成它自己的工具、把 `residentText()` 返回的文本送到它自己的注入通道。两件都不需要理解 mesync 内部。

心法本身仍然**只有 md、不是代码**——它的正确性靠措辞，写成代码就成了「用程序机制解决判断问题」，那正是要避免的。

---

## 里面有什么

```
templates/
  mesync-use.md        常驻正文：判断链 M0-M5（约 690 字符）
  meta/
    cognition.md       认知：东西是什么、怎么组织
    decision.md        决策：为什么这么定
    taste.md           品味：用户喜欢什么
    correction.md      纠错：为什么错了、怎么不再犯
    tool.md            工具：哪一步已经不需要判断了
  chain-judge.md       M4 的判断分支（走到 M4 才读）
  chain-rules.md       修链时才读：确定度、掉落与修正、节点状态
  scenarios/
    code/  design/  prd/
      scenario.md      场景卡：判据 / 产出 / 验收
      AGENT.md         场景层交付：做法 + 必须遵守的 + 工具
docs/                  设计文档（架构、链、判断、五块心法、未决设计）
```

### 判断链

```
M0 这次要的是「产出」还是「回答」？
M1 动手前先拿硬规则与相关记忆
M2 做
M3 用户评价？认可 / 否定（重走出错点）/ 无评价
M4 这次留下了什么？判断记成哪一块
M5 记下走过的路径
```

心法、场景说明、判断分支、记忆正文**全部按需读**，所以常驻体积不随记忆增长而膨胀。

### 五块心法的分工

`chain-judge.md` 回答「放到哪里」（先问出口，再问记成哪一块），五份心法只回答「这一块怎么写得对」。判据集中在链上，不散落在各份心法里。

---

## 三种接法，选一种

| 你的框架有什么 | 适配层要写的东西 |
|---|---|
| hook + MCP | **一份配置，零代码** |
| 插件 API | 三四十行：把 `TOOLS` 注册成工具、把 `residentText()` 送进提示（dsh 是这样，176 行） |
| 只能读写文件 | 直接读 `templates/` 里的 md，八个工具自己实现 |

### 接法一：只写配置

包自带一个 `mesync` 命令，两个子命令正好对应两件事：

```bash
mesync hook SessionStart     # 读 stdin 的 hook JSON → 往 stdout 写 additionalContext
mesync mcp                   # MCP stdio 服务，暴露八个工具
```

**hook 只在「上下文可能是空的」时刻注入**：`SessionStart`、`PostCompact`、
`resume`、`clear`、`compact`。事件名的大小写与分隔符**三种写法都认**
（`SessionStart` / `session_start` / `session-start`）——各框架写法本来就不一致
（hooks 配置用 snake_case、命令行传参用 kebab、事件通知用 camelCase），
而配错一个字母的后果是**静默不注入**，这是最难查的一类故障。

**刻意不接 `UserPromptSubmit`**：每次发话都送会吃掉上下文预算，而且需要猜
「这条消息是不是新任务」——那个判断属于 Agent，不属于 hook。

实测注入体积 **1145 字符**（中文约 1 字符 1 token），而 Codex 的
`additionalContext` 上限约 2500 token，留了一半余量。

MCP 那边是**有状态**的：场景记在数据根里，不是记在进程内存里，所以 server
重启不丢，同一个根上的多次调用共享同一个场景。

codex 的接法（事件键名以你那版 codex 的 hooks 文档为准）：

```jsonc
// .codex/hooks.json
{
  "session_start": [
    { "hooks": [{ "type": "command", "command": "mesync hook SessionStart" }] }
  ],
  "post_compact": [
    { "hooks": [{ "type": "command", "command": "mesync hook PostCompact" }] }
  ]
}
```

MCP server：

```toml
# ~/.codex/config.toml
[mcp_servers.mesync]
command = "mesync"
args = ["mcp"]
```

想让某个框架沿用老目录、或者**和另一个框架共用同一套记忆**：

```bash
mesync hook SessionStart --dir-name .dsh-mesync
mesync mcp --dir-name .dsh-mesync
```

三条纪律（跟接法无关，都成立）：

1. **hook 必须永远退出 0。** 非零退出会让框架把 hook 当成故障，用户看到的是
   「会话卡住了」，而我们只是没注入一段提示词。所以任何异常都被吞掉。
2. **不要缓存注入文本。** 每次现算，改数据根里的 md 就立刻改变行为；缓存会让
   这个性质消失。
3. **stdout 只能说协议。** hook 的 stdout 会被整段收进上下文（连空行也是），
   MCP 的 stdout 只能是 JSON-RPC。日志一律走 stderr。

---

## 接入方要做什么

### 1. 读文件的两种方式

**有 JS 运行时的话不用自己读文件**：`import { residentText, TOOLS } from 'mesync-core'`，
注入正文与八个工具都在里面。下面这段只给没有 Node 的环境（或者只想要裸 md 的场景）。

这个包的 `exports` 把 md 的路径暴露出来了，所以不用猜路径：

```js
// 直接解析到文件（Node 20+）
const url = import.meta.resolve('mesync-core/use.md')
```

```js
// 或者先拿包根，再自己拼
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('mesync-core/package.json'))
const use = readFileSync(join(pkgDir, 'templates/mesync-use.md'), 'utf8')
```

暴露的入口：`./use.md`、`./chain-judge.md`、`./chain-rules.md`、`./meta/*.md`、`./scenarios/<id>/scenario.md`、`./scenarios/<id>/AGENT.md`、`./templates/*`、`./docs/*`。

不是 Node 的平台，直接读包目录下的 `templates/` 即可。

### 2. 注入

把 `mesync-use.md` 的内容放进系统提示，位置尽量靠前。它自己会告诉 Agent 什么时候去读其余的 md。

**注意**：如果你的平台会对提示文本做 `{{变量}}` 之类的插值，别把这段正文直接当模板渲染——记忆内容里天然有 `{{uri}}`、`style={{ ... }}` 这样的片段，会打挂组装。走「变量替换」而不是「模板渲染」。

### 3. 实现这八个工具

md 里点了名的工具，接入方要实现（名字别改，链上写的就是这些名字）：

| 工具 | 干什么 |
|---|---|
| `mesync_context` | 列出场景（判据 / 产出 / 验收）、当前位置、记忆覆盖度 |
| `scenario_load` | 交付该层 `AGENT.md`（一份）、另一层的内容、交付层用量、写到哪里 |
| `memory_write` | 写一条记忆（kind + scope） |
| `memory_search` | 按关键词**查找**一条已知存在的记忆（不承担召回） |
| `memory_read` | 按相对路径读任意 md（心法、链、记录） |
| `doc_write` | 写层交付文档（`AGENT.md` / 场景卡）；`AGENT.md` 有 2000 字符参考线，超了只提醒不拦截 |
| `memory_discard` | 删一个文件（临时答案升格后清掉，或丢弃错答案） |
| `path_record` | M5：追加一行走过的路径 |

### 4. 数据根

```ts
resolveRoot({ configured: config.root, dirName: '.你的框架名-mesync' })
```

优先级：**显式配置 > 环境变量 `MESYNC_ROOT` > 主目录下的 `dirName` > 主目录下的 `.mesync`**。

- 缺省值是**产品名** `.mesync`，不含任何框架名——这里是共享包，不该替某个框架做决定。
- 框架想沿用自己的老目录（比如 dsh 用 `~/.dsh-mesync`），传 `dirName` 即可，用户一个文件都不用搬。
- 想让几个框架**共用同一套记忆**，让它们传同一个目录名，或者配同一个 `root`。记忆跟人走、不跟框架走，这是它可以跨框架的前提。

数据根必须在 Agent 的文件工具能写到的范围**之外**（dsh 就是这样），否则 Agent 会绕过工具直接改文件，纪律就散了。

### 5. 实现 md 所假设的布局

心法里写的路径不是举例，是规范。接入方要么照做，要么**同步改 md**（改了就要在 CHANGELOG 里说明，因为别的平台按旧布局实现了）。

```
<数据根>/
  mesync-use.md              可选：用户覆盖常驻正文
  meta/<kind>.md             可选：用户覆盖心法
  scenarios/<场景>/
    AGENT.md                 场景层唯一的交付文件（做法 + 必须遵守的 + 工具）
    records/<kind>/          场景级档案（所有项目通用）——只在被查找时读
    features/<项目>/
      AGENT.md               项目层唯一的交付文件
      records/<kind>/        项目级档案
  _pending/                  临时区：问出来但还没被验证的答案
  _paths/                    走过的路径
```

一条记忆一个 Markdown：frontmatter 只放定位字段（kind / scope / scenario / project / title / created），正文是散文。**不做字段校验**——该不该记是心法的事，代码只保证存得住、找得到、不丢。

---

## 三条给接入方的纪律

1. **八个工具全部注册，名字不许改。** 链是文本，上面写着「调 `scenario_load`」。少注册一个，Agent 走到那里就是断的，而且它不会报错，只会安静地按自己的理解绕过去。
2. **常驻正文每次组装都重新读，不要启动时读一次存起来。** 它包含「当前项目」这类随环境变的行。
3. **平台事实不要写进 md。** 比如「数据根在沙箱之外」是某个平台的事实，换个平台就是假的——那类话由接入方在执行时补充，md 里只写纪律（「一律走这几个工具」）。

---

## 内容守卫

```bash
npm test    # 两套：8 个内容守卫（零依赖，node 自带测试）+ 88 个单元与集成测试（vitest）
```

内容守卫只查「文件在、非空、链引用的路径都存在、常驻体积没超预算」。文案怎么写归心法管，测试不做文字审查。

## License

[MIT](./LICENSE) © 2026 wenliangw