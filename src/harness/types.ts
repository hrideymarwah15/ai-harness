import { Mode, TokenUsage, AgentModelConfig } from '@co-team/core';
import { PerceptionResult, CandidateOutput, EvaluationResult, SynthesisResult } from '@co-team/core';
import { CritiqueResult } from '@co-team/core';
import { ExecutionResult } from '@co-team/core';
import { PreExecutionCheckpointResult, PostExecutionCommitResult } from '@co-team/core';
import { AuditResult } from '@co-team/core';
import { AutoDebugResult } from '@co-team/core';

export type HarnessExecutionMode =
    | 'autonomous'      // Full 6-stage pipeline execution with disk modifications
    | 'dry_run'         // Run through synthesis and audit without writing files
    | 'plan_only'       // Perception + task decomposition into sub-agent prompts
    | 'reason_only'     // Perception + planning + multi-model candidate generation
    | 'critique_only'   // Adversarial critique on provided code/solution
    | 'debug_heal';     // Self-healing build/test loop on provided errors

export interface HarnessTask {
    /** Unique identifier for the harness run */
    id?: string;
    /** The objective or software engineering prompt */
    goal: string;
    /** Execution strategy mode */
    mode?: Mode;
    /** Execution target mode */
    executionMode?: HarnessExecutionMode;
    /** Specific target files or relevant paths */
    files?: string[];
    /** Additional metadata or context strings supplied by harness */
    context?: Record<string, any>;
    /** Dry run flag (do not commit or apply changes to disk) */
    dryRun?: boolean;
    /** Whether to take an automatic Git checkpoint before modifications */
    autoCheckpoint?: boolean;
    /** Whether to trigger AutoDebug self-healing if build/test fails */
    autoDebug?: boolean;
    /** Custom verification command (e.g. `npm test`, `pytest`) */
    testCommand?: string;
}

export type HarnessStage =
    | 'perception'
    | 'planning'
    | 'reasoning'
    | 'evaluation'
    | 'adversarial_critique'
    | 'synthesis'
    | 'audit'
    | 'execution'
    | 'verification'
    | 'debug_heal'
    | 'learning'
    | 'complete'
    | 'error';

export interface HarnessStageEvent {
    stage: HarnessStage;
    status: 'start' | 'progress' | 'complete' | 'skipped' | 'failed';
    message: string;
    role?: string;
    details?: any;
    tokensSoFar?: TokenUsage;
    timestamp: number;
}

export interface HarnessHooks {
    onStageEvent?: (event: HarnessStageEvent) => void | Promise<void>;
    onAgentCandidate?: (candidate: CandidateOutput) => void | Promise<void>;
    onCritique?: (critique: CritiqueResult) => void | Promise<void>;
    onAudit?: (audit: AuditResult) => void | Promise<void>;
    onCheckpoint?: (checkpoint: PreExecutionCheckpointResult) => void | Promise<void>;
    onFileOperation?: (file: { path: string; operation: 'create' | 'update' | 'delete' }) => void | Promise<void>;
    onSelfHealAttempt?: (iteration: number, error: string, patch: string) => void | Promise<void>;
}

export interface HarnessOrchestratorConfig {
    /** Active repository or workspace root directory */
    workspaceRoot?: string;
    /** Path to core package (defaults to auto-discovered path) */
    corePath?: string;
    /** Default operating mode */
    mode?: Mode;
    /** Model routing overrides */
    modelConfig?: AgentModelConfig;
    /** Event lifecycle hooks */
    hooks?: HarnessHooks;
    /** Default dry run state */
    dryRun?: boolean;
    /** Default git checkpoint behavior */
    autoCheckpoint?: boolean;
    /** Default auto-debug behavior */
    autoDebug?: boolean;
}

export interface HarnessExecutionReport {
    taskId: string;
    goal: string;
    mode: Mode;
    success: boolean;
    durationMs: number;
    qualityScore: number;
    tokenUsage: TokenUsage;
    perception?: PerceptionResult;
    candidates?: CandidateOutput[];
    evaluations?: EvaluationResult[];
    critiques?: CritiqueResult[];
    synthesis?: SynthesisResult;
    audit?: AuditResult;
    execution?: ExecutionResult;
    gitCheckpoint?: PreExecutionCheckpointResult;
    gitCommit?: PostExecutionCommitResult;
    debugResult?: AutoDebugResult;
    errors?: string[];
    summary: string;
}
