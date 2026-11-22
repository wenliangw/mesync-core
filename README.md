# mesync-core

同频记忆引擎的**心法内核**：一份纯 Markdown 的判断链、五块心法、判断分支与场景卡。

**没有代码。** 没有 `bin`、没有 `main`、没有 `dependencies`。这就是一个内容包——接入方拿来读，然后按自己插件环境的机制注入提示词、实现 md 里描述的那几个工具。

```
mesync-core      纯 md 心法（规范 + 内容）      ← 这个包
dsh-mesync       DeepSeek Harness 的实现（存储、工具、注入）
其他平台适配      同样读这些 md，自己实现
```

---

## 为什么只有 md

心法回答的是「该记什么、记成哪块、怎么写」。这部分**跨平台通用**，而且它的正确性靠的是措辞，不是代码——把它写成代码，就变成了「用程序机制解决判断问题」，那正是要避免的东西。

所以这里只留文本。存储、检索、注入这些**机制**留给各平台实现：机制可以不同，心法必须一致。

代价要说清楚：**跨平台复用的是心法，不是实现。** 每个平台都要自己实现一遍存储布局与那几个工具；反过来，md 里写的路径（`meta/<kind>.md`、该层 `rules.md`）就成了实现必须遵守的规范。

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
      AGENT.md         场景层工作说明
docs/                  设计文档（架构、链、判断、五块心法）
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

`chain-judge.md` 回答「记成哪一块」，五份心法只回答「这一块怎么写得对」。判据集中在链上，不散落在各份心法里。

---

## 接入方要做什么

### 1. 读文件的两种方式

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
| `scenario_load` | 交付该层 `AGENT.md`、`rules.md`、两层路径 |
| `memory_write` | 写一条记忆（kind + scope） |
| `memory_search` | 按关键词弱匹配检索 |
| `memory_read` | 按相对路径读任意 md（心法、链、记录） |
| `doc_write` | 写层文档（`rules.md` / `AGENT.md` / 场景卡） |
| `memory_discard` | 删一个文件（临时答案升格后清掉，或丢弃错答案） |
| `path_record` | M5：追加一行走过的路径 |

### 4. 实现 md 所假设的布局

心法里写的路径不是举例，是规范。接入方要么照做，要么**同步改 md**（改了就要在 CHANGELOG 里说明，因为别的平台按旧布局实现了）。

```
<数据根>/
  mesync-use.md              可选：用户覆盖常驻正文
  meta/<kind>.md             可选：用户覆盖心法
  scenarios/<场景>/
    rules.md                 场景层硬规则（M1 交付）
    AGENT.md                 场景层工作说明
    records/<kind>/          场景级记忆（所有项目通用）
    features/<项目>/
      rules.md  AGENT.md
      records/<kind>/        项目级记忆
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
npm test    # 8 个检查，零依赖，用 node 自带测试
```

只查「文件在、非空、链引用的路径都存在、常驻体积没超预算」。文案怎么写归心法管，测试不做文字审查。

## License

[MIT](./LICENSE) © 2026 wenliangw