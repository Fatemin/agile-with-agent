# Fix Backlog

自动审计于 2026-05-30，由 Claude 维护。每完成一项更新状态。

---

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
