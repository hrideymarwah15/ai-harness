/**
 * RALPH Loop — Autonomous AI Harness Types
 *
 * RALPH: Reason → Act → Learn → Plan → Heal
 *
 * An autonomous agentic execution loop designed to wrap the Co-Team Orchestrator
 * and Forge subsystem into a self-improving, evidence-driven AI harness that
 * any external system (CLI, SDK, MCP, HTTP, or agent framework) can drive.
 *
 * Each RALPH iteration:
 *   1. REASON  — Perceive environment, classify intent, retrieve memory, form hypotheses
 *   2. ACT     — Execute the best plan (Forge coding, multi-agent synthesis, or tool calls)
 *   3. LEARN   — Observe outcomes, extract insights, update memory with verified facts
 *   4. PLAN    — Decompose remaining work, reprioritize, and build next-iteration strategy
 *   5. HEAL    — Self-diagnose failures, apply targeted fixes, validate recovery
 */

import { Mode, TokenUsage } from '@co-team/core';
import { PerceptionResult, CandidateOutput, EvaluationResult, SynthesisResult } from '@co-team/core';
import { CodingTaskReport, CodingTaskRequest } from '@co-team/core';
import { AutoDebugResult } from '@co-team/core';
import { AuditResult } from '@co-team/core';
import { ExecutionResult } from '@co-team/core';

// ─── RALPH Loop Phases ───

export type RalphPhase = 'REASON' | 'ACT' | 'LEARN' | 'PLAN' | 'HEAL' | 'IDLE' | 'COMPLETE' | 'ABORTED';

export type RalphActionType =
    | 'forge_coding'        // Route to Forge deterministic coding pipeline
    | 'multi_agent'         // Full multi-agent reasoning + synthesis + execution
    | 'plan_only'           // Perception + planning decomposition
    | 'review'              // Adversarial critique and audit
    | 'heal'                // Self-healing debug loop
    | 'memory_update'       // Memory promotion / knowledge indexing
    | 'tool_call'           // Direct tool invocation
    | 'noop';               // No action needed (task complete or blocked)

// ─── RALPH Task ───

export interface RalphTask {
    /** Unique task identifier */
    id: string;
    /** Human-readable goal / instruction */
    goal: string;
    /** Optional acceptance criteria for completion verification */
    acceptanceCriteria?: string[];
    /** Additional context from the external harness */
    context?: Record<string, any>;
    /** Relevant files or paths to focus on */
    files?: string[];
    /** Test/build command for verification */
    testCommand?: string;
    /** Model routing mode */
    mode?: Mode;
    /** Maximum RALPH loop iterations before forced stop */
    maxIterations?: number;
    /** Maximum wall-clock time (ms) */
    maxDurationMs?: number;
    /** Whether to create Git checkpoints automatically */
    autoCheckpoint?: boolean;
    /** Whether to allow autonomous self-healing on failure */
    autoHeal?: boolean;
    /** Dry run — reason and plan but do not modify files */
    dryRun?: boolean;
    /** Sub-tasks to decompose into (populated by PLAN phase) */
    subtasks?: RalphSubtask[];
    /** Priority (1-10, higher = more urgent) */
    priority?: number;
    /** Tags for classification and routing */
    tags?: string[];
}

export interface RalphSubtask {
    id: string;
    goal: string;
    parentId: string;
    actionType: RalphActionType;
    status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
    dependencies: string[];    // subtask IDs that must complete first
    result?: any;
}

// ─── RALPH Loop State ───

export interface RalphLoopState {
    /** Current phase in the RALPH cycle */
    phase: RalphPhase;
    /** Current iteration number (1-based) */
    iteration: number;
    /** Maximum iterations allowed */
    maxIterations: number;
    /** Accumulated evidence from all phases */
    evidence: RalphEvidence;
    /** History of all phase transitions */
    transitions: RalphTransition[];
    /** Active hypotheses from REASON phase */
    hypotheses: RalphHypothesis[];
    /** Execution plan from PLAN phase */
    plan: RalphExecutionPlan | null;
    /** Results from ACT phase */
    actionResult: RalphActionResult | null;
    /** Insights from LEARN phase */
    insights: RalphInsight[];
    /** Recovery attempts from HEAL phase */
    healAttempts: RalphHealAttempt[];
    /** Whether the task is considered complete */
    isComplete: boolean;
    /** Whether the task was aborted */
    isAborted: boolean;
    /** Abort reason if applicable */
    abortReason?: string;
    /** Cumulative token usage */
    tokenUsage: TokenUsage;
    /** Timestamp when the loop started */
    startedAt: number;
    /** Elapsed time in milliseconds */
    elapsedMs: number;
}

// ─── REASON Phase ───

export interface RalphHypothesis {
    id: string;
    description: string;
    confidence: number;        // 0-1
    actionType: RalphActionType;
    evidence: string[];
    risks: string[];
    estimatedCost: 'low' | 'medium' | 'high';
}

export interface RalphEvidence {
    perception?: PerceptionResult;
    candidates?: CandidateOutput[];
    evaluations?: EvaluationResult[];
    synthesis?: SynthesisResult;
    codingReport?: CodingTaskReport;
    execution?: ExecutionResult;
    audit?: AuditResult;
    debugResult?: AutoDebugResult;
    /** Key-value observations extracted across iterations */
    observations: Record<string, string>;
    /** Files that were read or modified */
    touchedFiles: string[];
    /** Error messages accumulated */
    errors: string[];
    /** Warnings accumulated */
    warnings: string[];
}

// ─── PLAN Phase ───

export interface RalphExecutionPlan {
    strategy: string;
    actionType: RalphActionType;
    steps: RalphPlanStep[];
    estimatedTokens: number;
    estimatedDurationMs: number;
    fallbackStrategy?: string;
    fallbackActionType?: RalphActionType;
}

export interface RalphPlanStep {
    id: string;
    description: string;
    actionType: RalphActionType;
    dependencies: string[];
    priority: number;
    metadata?: Record<string, any>;
}

// ─── ACT Phase ───

export interface RalphActionResult {
    actionType: RalphActionType;
    success: boolean;
    output: string;
    filesChanged: string[];
    tokenUsage: TokenUsage;
    durationMs: number;
    /** Structured result from the action (Forge report, Orchestration result, etc.) */
    structuredResult?: any;
    errors: string[];
    warnings: string[];
}

// ─── LEARN Phase ───

export interface RalphInsight {
    id: string;
    iteration: number;
    category: 'success_pattern' | 'failure_pattern' | 'optimization' | 'convention' | 'risk';
    description: string;
    confidence: number;
    actionable: boolean;
    /** Whether this insight should be promoted to persistent memory */
    promoteToMemory: boolean;
}

// ─── HEAL Phase ───

export interface RalphHealAttempt {
    iteration: number;
    failureEvidence: string;
    hypothesis: string;
    actionTaken: string;
    result: 'healed' | 'partial' | 'failed';
    validationCommand?: string;
    validationOutput?: string;
    durationMs: number;
}

// ─── RALPH Loop Events ───

export type RalphEventType =
    | 'loop:start'
    | 'loop:iteration_start'
    | 'phase:start'
    | 'phase:complete'
    | 'phase:failed'
    | 'hypothesis:formed'
    | 'plan:created'
    | 'action:start'
    | 'action:complete'
    | 'action:failed'
    | 'insight:discovered'
    | 'heal:attempt'
    | 'heal:success'
    | 'heal:failed'
    | 'memory:promoted'
    | 'loop:iteration_complete'
    | 'loop:complete'
    | 'loop:aborted'
    | 'loop:timeout';

export interface RalphEvent {
    type: RalphEventType;
    phase: RalphPhase;
    iteration: number;
    message: string;
    timestamp: number;
    details?: any;
    tokensSoFar?: TokenUsage;
}

export type RalphEventListener = (event: RalphEvent) => void | Promise<void>;

// ─── RALPH Hooks (for external harness integration) ───

export interface RalphHooks {
    /** Called at every phase transition */
    onEvent?: RalphEventListener;
    /** Called before ACT phase — return false to veto the action */
    onBeforeAction?: (plan: RalphExecutionPlan, state: RalphLoopState) => Promise<boolean>;
    /** Called after LEARN phase with discovered insights */
    onInsights?: (insights: RalphInsight[]) => void | Promise<void>;
    /** Called when HEAL phase starts — return false to skip healing and abort */
    onBeforeHeal?: (failureEvidence: string, state: RalphLoopState) => Promise<boolean>;
    /** Called when the loop completes (success or failure) */
    onComplete?: (report: RalphReport) => void | Promise<void>;
    /** Provide additional context to inject at REASON phase */
    onInjectContext?: (iteration: number) => Promise<Record<string, string> | undefined>;
}

// ─── RALPH Configuration ───

export interface RalphConfig {
    /** Workspace root directory */
    workspaceRoot?: string;
    /** Default operating mode */
    mode?: Mode;
    /** Maximum RALPH iterations per task (default: 5) */
    maxIterations?: number;
    /** Maximum wall-clock time in ms (default: 300_000 = 5 min) */
    maxDurationMs?: number;
    /** Auto-checkpoint before modifications (default: true) */
    autoCheckpoint?: boolean;
    /** Auto-heal on failures (default: true) */
    autoHeal?: boolean;
    /** Dry run by default */
    dryRun?: boolean;
    /** Recovery budget per HEAL phase (default: 3) */
    maxHealAttempts?: number;
    /** Quality score threshold to consider a task successful (default: 60) */
    qualityThreshold?: number;
    /** Hooks for external harness integration */
    hooks?: RalphHooks;
    /** Verbosity level */
    verbose?: boolean;
}

// ─── RALPH Final Report ───

export interface RalphReport {
    taskId: string;
    goal: string;
    status: 'completed' | 'partial' | 'failed' | 'aborted' | 'timeout';
    iterations: number;
    totalDurationMs: number;
    totalTokenUsage: TokenUsage;
    qualityScore: number;
    /** Summary of what was accomplished */
    summary: string;
    /** Files that were created, modified, or deleted */
    filesChanged: string[];
    /** All insights discovered across iterations */
    insights: RalphInsight[];
    /** All heal attempts */
    healAttempts: RalphHealAttempt[];
    /** Hypotheses that were validated */
    validatedHypotheses: RalphHypothesis[];
    /** Remaining risks or unresolved items */
    risks: string[];
    /** Recommended next actions */
    nextActions: string[];
    /** Full loop state at completion */
    finalState: RalphLoopState;
    /** Structured evidence trail */
    evidence: RalphEvidence;
}

// ─── RALPH Loop Transition ───

export interface RalphTransition {
    from: RalphPhase;
    to: RalphPhase;
    reason: string;
    iteration: number;
    timestamp: number;
}
