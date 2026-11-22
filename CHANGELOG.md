# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-22

从 `dsh-mesync` 0.2.0 中抽出内核，形成平台无关的独立包。

### 内容

- **判断链**：`M0 → M1 → M2 → M3 → M4 → M5`，常驻约 1000 字符（含场景清单与覆盖度）。
- **五份心法**：认知 / 决策 / 品味 / 纠错 / 工具。判断「记成哪一块」集中在 `chain-judge.md`，心法只写「怎么写得对」。
- **判断分支与维护规则**：`chain-judge.md`（M4 才读）、`chain-rules.md`（修链才读）。
- **存储模型**：文件即真相，一条记忆一个 Markdown；两层作用域（场景级 / 项目级）；临时区 `_pending/`；路径记录 `_paths/`。
- **八个工具语义**：`mesync_context` / `scenario_load` / `memory_write` / `memory_search` / `memory_read` / `doc_write` / `memory_discard` / `path_record`，以纯 JSON Schema + `run(args, host)` 的形式导出。
- **三个预置场景**：`code` / `design` / `prd`，场景卡带 `验收` 字段。

### 边界

- 内核**零平台依赖**：源码里不出现任何平台包名，`dependencies` 里也没有。有测试守着这两条。
- 接缝集中在 `src/host.ts`：`HostContext`（root / cwd / writeNotice）与 `ToolSpec`。
- 平台特定的内容（如「数据根在沙箱之外」这类事实）由适配层通过 `writeNotice` 提供，不焊死在心法里。

### 设计取舍

- **决策也从 JSON 改为散文**：不做字段校验。该不该记是心法的事，代码只保证存得住、找得到、不丢。
- **参数用 JSON Schema**：它是 LLM 工具调用的通用语，不属于任何一家平台；适配层负责翻译。
