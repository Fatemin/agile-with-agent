# Fix Backlog

自动审计于 2026-05-30，由 Claude 维护。每完成一项更新状态。

> 下方 §1–7（HIGH/MEDIUM/LOW）为**历史归档，全部已修复 ✅**。
> 当前活跃问题见下面新增的「ACTIVE」段。

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
