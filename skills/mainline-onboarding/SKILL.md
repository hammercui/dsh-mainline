---
name: mainline-onboarding
description: Use when the user asks to onboard the current project to the 主线 (dsh-mainline) roadmap dashboard, to create or update .dsh/mainline.json, to import an existing roadmap.md into the dashboard, to split work into milestones/tasks with acceptance criteria, or says 接入主线 / 建 roadmap / 配置主线 / mainline 配置 / 把 roadmap.md 导入为主线. Walks through interviewing the user (or reading the existing plan doc), writing the roadmap config, and verifying the panel picked it up.
---

# 主线（dsh-mainline）项目接入

把当前项目接入「主线」仪表盘 = 在项目里放一份 `.dsh/mainline.json` 路线图。插件本身**只读**（观察 Agent 动作、判定偏离、渲染 roadmap），配置由你（Agent）代表用户写出，这是正常文件写入，不违反插件的只读边界。

## 步骤

1. **摸底**：看仓库结构、README、现有任务（todo/issue/goal），判断项目处于什么阶段。
   **已有 `roadmap.md`（或 `docs/roadmap.md`）时**：先读它——它就是计划纲领，里程碑/任务直接从里面提炼，跳过第 2 步的问询，只在拆分拿不准处和用户确认（这就是「把 roadmap.md 导入为主线」）。文档保持原样，不代写不回写。
2. **规划路线图**（没有计划文档时）：和用户对齐（拿不准就问一句）：
   - 项目名 `project`、根目录 `root`（之后配置里可用 `$WS` 指代）；
   - 里程碑拆分（建议 2–5 个可见里程碑，每个 1–6 个任务）；
   - 哪个里程碑/任务是「当前」（`activeMilestone` / `activeTask`）；
   - 最重要的里程碑标 `key: true`（金色 ★，且不被自动折叠）；
   - 每个任务尽量写 `acceptance` 验收标准（面板上会显示为「未验证」灰字）；
   - 当前里程碑写 `allow`（允许写入的路径 glob，如 `$WS/src/**`）/ `forbid`，根级可写 `forbid`。
3. **写配置**：写到 `<项目根>/.dsh/mainline.json`，编码 UTF-8、无 BOM。所有任务状态用 `todo`（或如实标注），**不要虚构进度**；`status` 可选 `todo | doing | done`。
4. **验证**：配置热加载后，在当前会话的「主线」面板确认项目名、配置状态与里程碑；需要读取接口时，先从当前运行时上下文确认 GUI URL，不猜测或硬编码端口。用当前会话 id 查询 `GET /dsh-mainline/state?session=<id>`，只提取验证所需字段，不转储整个会话状态。接口不可访问时让用户确认面板，不绕过鉴权。
5. **收尾**：说明面板位置及验证结果。配置可作为 roadmap 提交，但先审查绝对路径和私有任务，并尊重项目忽略规则；不要自动强制加入 Git。以后确认任务完成再改 `status` 为 `done`；若希望修改配置被判为允许，应明确将 `$WS/.dsh/mainline.json` 纳入对应里程碑的 `allow`。

## 最小模板

```json
{
  "project": "示例项目",
  "root": ".",
  "activeMilestone": "M1",
  "activeTask": "M1-2",
  "milestones": [
    {
      "id": "M1",
      "title": "第一个里程碑",
      "key": true,
      "allow": ["$WS/src/**"],
      "forbid": ["$WS/.env*"],
      "tasks": [
        { "id": "M1-1", "title": "已有功能", "status": "done" },
        { "id": "M1-2", "title": "正在做的任务", "acceptance": ["可验证的完成标准"] },
        { "id": "M1-3", "title": "还没开始的任务" }
      ]
    }
  ],
  "forbid": ["**/node_modules/**", "**/.git/**"]
}
```

## 规则

- `root` 是相对项目根的路径或绝对路径；配置里所有 glob 可用 `$WS` 指代 `root` 解析后的目录（`~` 指用户主目录）。
- 判定语义：Agent 写文件命中 `allow` = 🟢 在范围内（不代表任务完成，也不自动推进进度）；命中 `forbid` = 🔴 告警；都不命中 = 🟡 计划外。命令与读取只展示、不判定。
- 面板展示遵循「事件发生时刻」归属：改配置不影响历史判定，只影响之后的。
- 不要把整个仓库塞进 `allow`；宁可让用户看到几条 🟡，也不让判定失去意义。
- 里程碑顺序即数组顺序，面板自上而下渲染。
