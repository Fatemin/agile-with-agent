这是当前几乎所有 Agent 项目都会遇到的问题。

如果把整个 Story、所有历史对话、所有文档、所有代码、所有决策记录不断塞进 Context Window，那么无论是 Claude、GPT 还是 Gemini，都会出现：

推理速度下降
Token 成本指数增长
上下文污染（Context Pollution）
注意力稀释（Lost in the Middle）
Agent 开始遗忘真正重要的信息

因此现代 Agent Framework（如 OpenAI Agents SDK、LangGraph、Mastra 等）基本都在做同一件事：

不让 Agent 持有全部上下文，而是动态构建上下文。

不要管理 Context，管理 State

这是很多项目的第一个误区。

传统聊天：

Human
↓
Conversation
↓
LLM

Agent 系统：

State
↓
Context Builder
↓
LLM

LLM永远只看到：

当前任务需要的内容

而不是：

整个项目
Story 不应该直接喂给 Agent

假设有一个 Story：

作为用户
我希望支持邮箱登录
以便访问系统

很多系统会这样：

Story
+
Acceptance Criteria
+
Epic
+
Sprint
+
项目文档
+
历史聊天
+
代码

然后一起送进去。

实际上应该拆成：

Story
↓
Task Graph
↓
Agent

例如：

Story
 ├── 设计DB
 ├── 设计API
 ├── 实现Backend
 ├── 实现Frontend
 └── 编写测试

Agent一次只拿：

当前Task

例如：

Task:
设计登录API

上下文立即缩小几十倍。

建立 Artifact System

我认为这是最重要的一步。

不要把结果留在对话里。

要留在 Artifact 里。

例如：

Story
 ├── PRD.md
 ├── API.yaml
 ├── DB.sql
 ├── Decision.md
 └── TestCases.md

Agent工作时：

读取Artifact
↓
修改Artifact
↓
输出Artifact

而不是：

读取聊天记录
↓
继续聊天
↓
输出聊天记录

这样 Context 变成：

当前Task
+
相关Artifact

而不是：

6小时历史对话
引入 Working Memory 和 Long-term Memory

类似人的记忆结构。

Working Memory

当前 Sprint

例如：

{
  "story":"AUTH-001",
  "current_task":"Design Login API",
  "status":"In Progress"
}

可能只有几KB。

Long-term Memory

向量库

例如：

Architecture Decision
Coding Guideline
Product Knowledge
Past Stories

Agent需要时检索。

而不是全部加载。

类似 RAG。

Decision Compression

很多项目有个问题：

Agent A

决定采用JWT

Agent B

为什么采用JWT？

然后把前面5000 token历史对话搬进来。

实际上应该生成：

Decision #15

Topic:
Authentication

Decision:
Use JWT

Reason:
Stateless architecture

Date:
2026-06-07

Agent只读取：

Decision #15

几十 Token。

Story Summary Snapshot

每个 Story 维护一个 Snapshot。

例如：

story_id: AUTH-001

goal:
实现邮箱登录

completed:
- DB设计
- API设计

in_progress:
- Backend开发

blocked:
- 无

decisions:
- JWT
- Refresh Token

Agent启动时：

读取Snapshot

而不是：

读取整个Story历史
使用 Planner Agent

很多 Agent Framework 最大的问题是：

一个 Agent 什么都做。

实际上应该：

Planner
 ↓
Task Queue
 ↓
Worker Agents

Planner：

负责拆任务

Worker：

负责执行

Worker 根本不需要知道整个项目。

只需要：

Task
Acceptance Criteria
Relevant Artifacts

即可。

类似 Git 的 Context Management

如果是我设计你的系统，我会这么做：

Project
 ├── Epics
 ├── Stories
 ├── Tasks
 ├── Artifacts
 ├── Decisions
 └── Knowledge Base

Agent执行时：

Task
+
Task Dependency
+
Relevant Artifacts
+
Relevant Decisions

动态构造 Prompt。

永远不要：

加载整个 Story

更不要：

加载整个 Sprint
对于你这个「Scrum + Agents」项目

我觉得最值得借鉴的其实不是 Jira，而是 Git。

Jira 的思维是：

Issue 驱动

而 Agent 世界更适合：

Artifact 驱动

也就是：

Story
 ↓
Task Graph
 ↓
Artifact
 ↓
Review
 ↓
Merge

Agent 的上下文来源于 Artifact，而不是来源于历史聊天。

这样即使一个 Story 执行了两周：

Prompt 大小仍然稳定
Token 成本接近恒定
Agent 速度不会越来越慢
新 Agent 可以随时接管

很多成熟 Agent 系统最终都会演化到这个方向：把 Conversation 变成 State，把 State 落到 Artifact，然后按需重建 Context。 这通常比继续优化 Prompt 压缩带来的收益大得多。