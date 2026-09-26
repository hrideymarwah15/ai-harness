# Co-Team AI Harness & Orchestrator Pipeline

## Overview
The Co-Team AI Harness is an advanced, enterprise-grade runtime scaffolding built to execute and evaluate autonomous AI agents. Unlike standard language model wrappers, a harness provides the essential "execution layer" (context management, tool execution, sandboxing, and observability) to transform reasoning engines into autonomous, action-taking systems.

This architecture has evolved from a single-agent extension into a modular Agent Orchestrator Framework.

---

## 🛠 Complete Pipeline & Execution Structure

The AI Harness orchestrates the **Agentic Loop** through several tightly coupled subsystems:

### 1. Agent Sandbox & Definition (`AgentRuntime`)
The `AgentRuntime` acts as a secure execution bridge. Every agent is defined by a `CustomAgentDefinition` which strictly outlines:
*   **Persona:** The system prompt and behavioral guidelines.
*   **Capabilities (RBAC for AI):** What actions the agent is allowed to take (e.g., `modify_files`, `auto_debug`, `spawn_sub_agents`). 
*   **Sandboxing Limits:** Configurations for container runtimes (e.g., `bwrap` or `docker`) to ensure the agent operates in an isolated filesystem.

### 2. Autonomous Loop Engine (`RalphLoopEngine`)
The core orchestrator utilizes the **RALPH** methodology (Reason → Act → Learn → Plan → Heal).
*   **Reason & Plan:** The agent analyzes the goal, workspace context, and previous execution traces to formulate a plan.
*   **Act:** Tool execution via the Model Context Protocol (MCP). The engine intercepts actions through hooks (`onBeforeAction`) to enforce capability checks and Human-In-The-Loop (HITL) approval gates.
*   **Heal (Auto-Debugging):** If a test fails or a command errors out, the `onBeforeHeal` hook triggers, feeding the `stderr` back into the loop for self-correction without human intervention.

### 3. Traceability & Event Log
*   Every step the agent takes, including tool calls, plan modifications, and healing attempts, is captured in an append-only event log (`agent_trace_log.jsonl`). 
*   This provides full auditability, similar to advanced open-source harnesses, allowing developers to replay sessions, debug decision trees, and maintain compliance.

### 4. Benchmarking & Evaluation (`BenchmarkSuite`)
The framework includes a SWE-bench style evaluation suite.
*   Agents are run against standardized tasks in isolated environments (`dryRun` capabilities).
*   Metrics extracted: Total Duration, Token Consumption, Auto-Heal Success Rate, Iteration Count.
*   Leaderboard Generation: The suite natively compares the Custom Agent against industry baselines like *Claude Code*, *DeepSeek Harness*, and *SWE-Agent*.

---

## 🚀 Enhancing the Harness: Open Source Inspirations

To further elevate the Co-Team AI Harness, we can integrate primitives from the following leading open-source orchestration projects:

### 1. **SWE-bench / SWE-Agent**
*   **Repository:** [SWE-agent/SWE-agent](https://github.com/SWE-agent/mini-swe-agent)
*   **Enhancement Idea:** Adopt their Agent-Computer Interface (ACI). SWE-Agent provides highly optimized terminal and file-editing tools specifically tuned for LLMs (e.g., semantic search inside files rather than raw `cat`). We can implement similar tuned tools in our MCP server.

### 2. **DeepSeek Harness (Cordis Architecture)**
*   **Repository:** [DeepSeek Harness / Cordis](https://github.com/shigma/cordis)
*   **Enhancement Idea:** Transition to an "Everything is a plugin" architecture. Currently, our `AgentRuntime` is tightly coupled with `RalphLoopEngine`. By adopting a Cordis-style plugin system, we could swap out memory managers, execution loops (ReAct vs. RALPH), and model adapters dynamically.

### 3. **OS-Level Sandboxing (Aigate / Secure MCP)**
*   **Repository:** [AxeForging/aigate](https://github.com/AxeForging/aigate) | [datacline/secure-mcp-gateway](https://github.com/datacline/secure-mcp-gateway)
*   **Enhancement Idea:** Currently, our sandboxing relies on Node.js capabilities and boolean flags. Integrating actual OS-level isolation (like bubblewrap/bwrap or gVisor) or a secure MCP gateway will ensure that even a rogue LLM agent cannot access the host machine's root filesystem.

### 4. **MetaHarness & Workspace Agents**
*   **Repository:** [ruvnet/metaharness](https://github.com/ruvnet/metaharness) | [holaboss-ai/holaOS](https://github.com/holaboss-ai/holaOS)
*   **Enhancement Idea:** Introduce a CLI-first scaffolding engine that allows developers to spin up pre-configured, branded harnesses tailored to specific verticals (e.g., a "Data Science Harness" vs. a "React Native Harness").

---

## 🔒 Next Technical Milestones
1.  **Docker Integration:** Replace the `"mock"` container runtime with the Docker Engine API to spin up ephemeral containers per benchmark task.
2.  **Multi-Agent Routing:** Implement the `spawn_sub_agents` capability, allowing a primary "Architect" agent to dispatch coding tasks to secondary "Developer" instances, merging the results upon completion.
3.  **Human-In-The-Loop Web UI:** Bridge the `onApprovalRequest` hook with the `@co-team/server` WebSocket connection to display pending actions (e.g., file deletions) in a web dashboard for user approval.
