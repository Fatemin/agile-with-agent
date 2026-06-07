# Fix Backlog

自动审计于 2026-05-30，由 Claude 维护。每完成一项更新状态。

> 下方 §1–7（HIGH/MEDIUM/LOW）为**历史归档，全部已修复 ✅**。
> 当前活跃问题见下面新增的「ACTIVE」段。

---

## 🟡 ACTIVE — Context/State Refactor 收尾（2026-06-07）

> 上下文/状态重做（CONTEXT.md Phases 1–6，已合入 master）落地后的遗留项。
> 核心目标已完成且有测试（prompt 体积≈恒定、decision 持久化、artifact 追踪、relevance 检索、State 可视化）；
> 下列为边角、文档/代码不一致与刻意延后项。

### [C1] 🟡 `SNAPSHOT:` marker 未实现（文档/代码不一致）
- **文件:** `server/execution.ts`（executeTask 成功分支）、`server/snapshot.ts`、`CONTEXT.md §7`
- **问题:** §7 定义了 `DECISION:` / `ARTIFACT:` / `SNAPSHOT:` 三个 marker；前两个已实现，**SNAPSHOT 未实现**。snapshot 的「一句话结果」取 `impl_summary` 首行（`firstLine`），而非 agent 自述的 SNAPSHOT 行。
- **建议:** executeTask 解析 `SNAPSHOT:` 作为 `recordTaskComplete` 的 result，无则回退首行（现状）；或把文档改为「确定性派生」。
- **状态:** 待改

### [C2] 🟡 `story_snapshot.decisions[]` 死字段
- **文件:** `server/snapshot.ts`（`SnapshotState.decisions`，注释 "Phase 2"）
- **问题:** 定义但从未写入；`renderDecisionsBlock` 直接查 decisions 表。注释也不准确。
- **建议:** 删除该字段并修正注释；若将来要「按任务 scope 决策」再引入。
- **状态:** 待改

### [C3] 🟡 设计阶段的 decision 未捕获
- **文件:** `server/execution.ts`（executeDesign）、`server/designGuide.ts`
- **问题:** `DECISION:` 仅在 executeTask 解析；design 阶段不解析，且 design 提示未要求输出 DECISION。设计期的关键决策会丢。
- **建议:** design 提示加 DECISION 说明；executeDesign 解析 result 并 `recordDecisions`（createdBy='techlead'）。
- **状态:** 待改

### [C4] 🟢 `depends_on` 只存不执行
- **文件:** `server/execution.ts`（executePipeline）
- **问题:** Planner 现在会填真实 `depends_on`，但 pipeline 仍按 `seq` 串行，不校验依赖图（靠 planner 拓扑排序的约定）。
- **建议:** 执行每个 task 前校验其 `depends_on` 全部 done（否则 block）；或做拓扑排序 + 受限并行。
- **状态:** 待改（较大增量）

### [C5] 🟢 FTS5 检索仅覆盖 context sections
- **文件:** `server/db.ts`（`context_fts`）、`server/retrieval.ts`、`server/artifacts.ts`
- **问题:** 设计 §9 说要索引 `project_contexts.content` + `artifacts.summary` + `decisions`；实际只索引了 `project_contexts`。artifact manifest 排序仍是朴素子串重叠。
- **建议:** 扩展 FTS5（或单独表）覆盖 artifacts/decisions，manifest 用 bm25 排序。
- **状态:** 待改（较大增量）

### [C6] 🟡 Phase 6（State 可视化）无自动化测试
- **文件:** `tests/`、`server/routes/stories.ts`、`src/pages/ProjectView.tsx`
- **问题:** 3 个 GET 路由（`/snapshot`、`/decisions`、`/artifacts`）+ `getSnapshotView`/`listDecisions`/`listArtifacts` + Context tab 均无测试；已测的只是 `render*`。
- **建议:** 加 route/getter 级测试（种子 story+task+decision+artifact，断言返回结构）；UI 测试可暂缓。
- **状态:** 待改

### [C7] 🟢 `context_token_budget` 未调优
- **文件:** `server/runtimeConfig.ts`
- **问题:** 默认 8000 是拍的数（设计 §12 Q4），未按真实跑量验证。
- **状态:** 待观察

> **刻意延后（非缺口）:** embeddings 检索（设计明确 "only if needed"）、`phase`/`design_output` 休眠列（SQLite 不便删列）、token 估算用 `chars/4`（设计 §6.3 已接受）。
>
> **建议批次:** 先做 C1 + C2 + C3 + C6（都是小改 + 消除文档/代码不一致）一个 PR；C4 / C5 看是否要真正 DAG 执行 / 更强检索再排期。

---

## 🔴 ACTIVE — 自动执行链路（2026-06-06 实测）

> 用 `npm run flow` 按生产路径（复刻 `orchestrator.dispatch` + `runWorker`）跑 happy flow，
> 用 fake agent 排除 LLM 因素。

### [A1] 🔴 BLOCKER — `createBranch`(checkout -b) 与 worktree 模型冲突 → ✅ 已修复
- **文件:** `server/orchestrator.ts → dispatch()`、`server/routes/stories.ts`（手动 PATCH 路径）、`server/git.ts`
- **曾经现象:** dispatch 先用 `git checkout -b feature/<key>-…` 在**主仓库**检出分支；随后第一个 impl 任务建 worktree 时报
  `fatal: '<branch>' is already used by worktree at '<主仓库>'` → 任务 `failed` → pipeline halt → story 卡在 `in_progress`，QA 永不执行。`mode=auto` 故事完全跑不通。
- **根因:** git 不允许同一分支同时被两个工作树检出；建分支用了"检出式"，执行用 worktree 模型。
- **修复:** 新增 `git.ts → createBranchNoCheckout()`（`git branch <name>`，不切换主仓库 HEAD），dispatch 与手动 PATCH 路径都改用它；sprint 集成分支仍用 `createBranch`（其分支本就该在主工作树）。
- **验证:** `npm run flow` 现已走通到 `human_review`（绿）；`tests/execution-chain.test.ts` 三个用例全绿——含 happy-path、`createBranchNoCheckout` 回归、以及保留旧 `checkout -b` 仍冲突的护栏用例。
- **状态:** ✅ 已修复（2026-06-06）

### [A2] 🟡 QA 判 FAIL 不阻断发布 → ✅ 已修复
- **文件:** `server/execution.ts → executeQA()`
- **曾经问题:** `executeQA` 在 FAIL 分支 `yield {type:"progress"}` 而非 `"error"`，导致 `executePipeline` 不认为该 QA 任务失败，仍把 story 推进到 `human_review`（仅 `qa_result='fail'`）。QA 未真正成为门禁。
- **修复:** FAIL 分支改为 `yield {type:"error"}`，pipeline 随即 halt，story 保持 `in_progress`（不进 `human_review`），QA 任务标记 `failed`，留给人/agent 修复后重跑。PASS / inconclusive 分支不变。
- **验证:** `tests/execution-chain.test.ts → "QA FAIL blocks hand-off"`（绿）：断言 `status='in_progress'`、`qa_result='fail'`、QA 任务 `failed`。
- **状态:** ✅ 已修复（2026-06-06）
- **注:** auto 模式下若 QA 持续失败，编排器会反复重试该 story（与任何失败任务一致的既有行为）；这属于"失败任务重试策略"的更大话题，未在本次处理。

### [A4] 🔴 "无限调用"止血：重试策略 + 单次 run 轮数上限 → ✅ 已实现
- **背景:** story `1-2`（一个改 3 行的需求）实测烧了 10 次 run、~$3.4——根因是 ① auto 模式撞到 `session limit` 仍盲目重试 ②单次 run 跑到 48 turn。
- **文件:** `server/orchestrator.ts`、`server/runtimeConfig.ts`、`server/claudeRunner.ts`、`server/execution.ts`
- **实现:**
  - **不可重试错误分类**（`NON_RETRYABLE`：session/quota/auth/permission/approval）→ 立即放弃，不再重试。
  - **`max_attempts`（默认 3）** → 超过后放弃，把 story 翻成 `mode='manual'`（持久，poll 与重启恢复都只挑 `auto`，从此不再自动重投）并记一条醒目日志。
  - **`max_turns`（默认 50）** → 通过 CLI `--max-turns` 封顶单次 run 的内层轮数。
- **验证:** `tests/orchestrator-giveup.test.ts`（绿）：撞 `session limit` 后 story 翻 manual、不再有 running/retry、run 数 ≤ 2。既有 retry 用例仍绿（可重试错误照常重试到成功）。
- **状态:** ✅ 已实现（2026-06-06）。**注:** 权限模式仍是设计决策（见 README 已知限制），fully-autonomous 需自行评估 `bypassPermissions`。

### [A6] 🟢 设计闸口（design 先行，人类 review）+ 默认 bypassPermissions → ✅ 已实现
- **背景:** headless 一次性执行没有人在 CLI 前回答"是否允许跑这条命令",`acceptEdits` 会卡死。结论:逐条命令审批做不到,应把"人来决定"放到应用层闸口。
- **文件:** `server/runtimeConfig.ts`、`server/execution.ts`、`server/db.ts`、`server/routes/stories.ts`、`src/types.ts`、`src/pages/ProjectView.tsx`、`src/pages/Agents.tsx`
- **实现:**
  - 默认 `permission_mode='bypassPermissions'`（隔离 worktree 内放开;人控放到闸口）。
  - 新 story 状态 **`design_review`** + `stories.design` 字段。`require_design_review`（默认 true）。
  - **`executeDesign`**:techlead agent 先探索代码、产出实现计划（read-only,fallback 用任务分解合成）+ 创建任务分解 → story 停在 `design_review`。
  - `executeStory` 闸口:无 design → 走设计并 park;design 已批 → 实现。orchestrator 天然不动 `design_review`（非 active）。
  - UI:看板新增 Design Review 列 + story 详情"Design Review"面板（Approve & Implement / Redesign）。
- **验证:** `tests/execution-chain.test.ts → "design gate"`（绿）：pass1 → design_review + design 写入 + 任务未跑;批准后 pass2 → human_review。`npm run flow` 完整演示 design→批准→实现→human_review。
- **状态:** ✅ 已实现（2026-06-06）。**注:** bypass 是设计取舍（见 README 已知限制）。

### [A8] 🟢 状态/进展不够直观 → ✅ 卡片 + Dashboard 改造
- **范围:** 按用户要求"大结构不动,主要改卡片显示 + 升级 Dashboard"。
- **文件:** `src/lib/storyStatus.ts`(新,状态视觉单一来源)、`src/pages/ProjectView.tsx`(卡片)、`src/pages/Dashboard.tsx`、`src/pages/Agents.tsx`、`server/routes/stories.ts`(聚合)、`src/types.ts`。
- **实现:**
  - **看板卡片**新增一眼可见信息:任务进度(`task_done/task_total` + 进度条)、defect 数(🐛)、QA 结果(pass/fail 彩色 chip)、`design_review` 的"needs review"提示。数据来自 stories 查询新增的 `task_total/task_done/defect_count` 聚合(避免 N+1)。
  - **Dashboard 升级为指挥中心**:`Now Running`(来自 orchestrator snapshot,显示实时轮数/token/已运行时长,带脉冲)+ `Awaiting You`(design_review/human_review 行动队列)+ 修掉过期的 `in_dev/in_qa` 样式。
  - **状态视觉统一**:`STORY_STATUS` 单一来源(label/icon/color/badge),ProjectView/Dashboard/Agents 全部改为引用,消除 3 处重复 + 过期定义。
- **验证:** `npm run lint` 通过;`npm test` 14/14;dev server(--watch)已热加载,可直接在页面查看。
- **状态:** ✅ 已实现（2026-06-06）

### [A7] 🟢 设计输出可读性差 → ✅ 加统一"设计指南"skill
- **文件:** `server/designGuide.ts`（单一来源）、`server/execution.ts`（executeDesign 注入）
- **问题:** agent 产出的 design 是一大坨无结构文本，难读；且未按 story 语言输出。
- **实现:** `buildDesignPrompt()` 规定固定结构（Summary / Affected files / Approach / Data·API changes / Risks / AC check）+ 可读性与准确性规则（用标题/要点/`code` 跨度、只引用真实文件、不编造）；`detectStoryLanguage()` 按 story 文本自动选中文/英文，并要求 agent 全程匹配 story 语言（含标题）。所有 design 运行统一走它。
- **验证:** `tests/execution-chain.test.ts → "design guide"`（绿）：中/英/混合语言检测 + 结构段落 + 保留 "Design Phase" 标记。
- **状态:** ✅ 已实现（2026-06-06）。**注:** 仅影响**新的** design 运行；旧 story 可点「Redesign」用新格式重出。

### [A5] 🟢 页面不实时（要刷新才看到变动）→ ✅ 已修复
- **文件:** `src/App.tsx`
- **问题:** QueryClient 只设了 `staleTime`，无轮询，agent 执行时看板/详情/活动不刷新就不更新。
- **修复:** 全局 `refetchInterval: 4s` + `refetchOnWindowFocus` + 后台标签页暂停轮询。变动 ~4s 内自动出现，无需手动刷新。
- **状态:** ✅ 已修复（2026-06-06）

### [A3] `inferTasks` 跨栈拆分死代码 → ✅ 已修复
- **文件:** `server/execution.ts → inferTasks()`
- **曾经问题:** `else if (isCrossStack)`（本应拆出 backend+frontend 两个 impl 任务）永不触发——所有 cross-stack 关键字也命中前/后端集合，`role` 绝不会是 `fullstack`，走不到该分支。实际每个 story 永远只产出 1 impl + 1 QA。
- **修复:** 删除 `inferTaskRole`，改为两个独立信号 `FRONTEND_SIGNAL` / `BACKEND_SIGNAL`：同时命中前后端 → 拆 `backend → frontend`（frontend `depends_on` backend）+ QA；只命中一侧 → 单 impl + QA；都不命中 → fullstack + QA。
- **验证:** `tests/execution-chain.test.ts` 两个 planner 用例（绿）：跨栈 → `[backend, frontend, qa]` 且 frontend 依赖 backend；单域 → `[frontend, qa]`。
- **状态:** ✅ 已修复（2026-06-06）

---

## 🟢 历史归档（§1–7，全部已修复 ✅）

## 🔴 HIGH

### [1] Pipeline depends_on 不生效
- **文件:** `server/execution.ts` → `executePipeline()`
- **问题:** `depends_on` 字段写入数据库但执行时从未读取，前置任务失败后后续任务仍继续执行
- **修复:** 执行每个 task 前，检查其 `depends_on` 列表中所有 task 的 `phase` 是否为 `done`，否则 yield error 并终止该任务
- **状态:** ✅ 已完成

### [2] Pipeline 无 QA task 时跳过验证
- **文件:** `server/execution.ts` → `executePipeline()`
- **问题:** pipeline 全部任务完成后，若无 role=`qa` 的 task，直接进 `in_review`，没有任何验证
- **修复:** pipeline 完成后，若无 qa task，自动调用一次 `executeQA()`
- **状态:** ✅ 已完成

---

## 🟡 MEDIUM

### [3] executeStory 无状态校验
- **文件:** `server/execution.ts` → `executeStory()`
- **问题:** 后端不校验 story 当前 status，任何状态都可以被执行
- **修复:** 执行前检查 story.status，不是 `in_dev` 时 yield error 并 return
- **状态:** ✅ 已完成

### [4] Tech Lead 规划缺少 UI 入口
- **文件:** `src/pages/ProjectView.tsx`
- **问题:** `/api/stories/:id/plan` 路由和 `api.execution.plan()` 已存在，但 UI 无触发按钮
- **修复:** 在 ExecutePanel 或任务面板中加入"Plan with Tech Lead"按钮，仅在已分配 techlead agent 时显示
- **状态:** ✅ 已完成

### [5] 单个 Task 无法单独重跑
- **文件:** `src/pages/ProjectView.tsx`
- **问题:** `/api/stories/:id/tasks/:taskId/execute` 路由存在，但 UI 无入口，task 失败后无法单独重试
- **修复:** 在 TaskPipelineView 的每个 task 行加入重跑按钮（仅对 failed/done 状态显示）
- **状态:** ✅ 已完成

### [6] 手动状态变更无 activity log
- **文件:** `server/routes/stories.ts`
- **问题:** 只有 in_dev / in_qa / released 有 side-effect log，其余手动拖动无记录
- **修复:** PATCH status 时对所有变更统一写一条 `status_change` activity
- **状态:** ✅ 已完成

---

## 🟢 LOW

### [7] QA sign-off 不阻止 release
- **文件:** `server/routes/stories.ts`
- **问题:** 没有 QA sign-off 也可以把 story 移到 released
- **修复:** status → released 时，若 qa_result 不是 pass 则返回 400 警告（soft block，前端可强制覆盖）
- **状态:** ✅ 已完成
