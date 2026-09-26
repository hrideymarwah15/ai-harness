/**
 * AI Harness — Autonomous Agent Implementation Types
 * 
 * Provides the structure for implementing custom AI agents on top of the
 * Co-Team Orchestrator and benchmarking their performance.
 */

import { Mode, TokenUsage } from '@co-team/core';
import { RalphReport, RalphTask } from '../ralph/types';

// ─── Agent Definition ───

export interface CustomAgentDefinition {
    /** Unique identifier for the agent (e.g., 'swe-agent-v1') */
    id: string;
    /** Human readable name */
    name: string;
    /** System prompt / persona defining the agent's behavior */
    systemPrompt: string;
    /** Allowed capabilities (what Co-Team subsystems it can use) */
    capabilities: AgentCapability[];
    /** Default preferred model (e.g. 'claude-3-opus-20240229') */
    defaultModel?: string;
    /** Max autonomous iterations per task */
    maxIterations?: number;
    /** Advanced Harness Features */
    humanInTheLoop?: {
        requireApprovalForFiles?: boolean;
        requireApprovalForShell?: boolean;
    };
    sandboxing?: {
        enabled: boolean;
        containerRuntime?: 'docker' | 'bwrap' | 'mock';
    };
}

export type AgentCapability = 
    | 'read_workspace' 
    | 'modify_files' 
    | 'run_tests' 
    | 'auto_debug' 
    | 'memory_read' 
    | 'memory_write'
    | 'multi_agent_delegate'
    | 'spawn_sub_agents'; // Added capability for Claude Code style routing

// ─── Agent Runtime Execution ───

export interface AgentExecutionRequest {
    goal: string;
    testCommand?: string;
    acceptanceCriteria?: string[];
    context?: Record<string, any>;
    dryRun?: boolean;
    /** Enable append-only traceability log (DeepSeek Harness style) */
    enableTraceability?: boolean;
    traceLogPath?: string;
    /** Optional callback for human-in-the-loop approvals */
    onApprovalRequest?: (action: string, details: any) => Promise<boolean>;
}

export interface AgentExecutionResult {
    agentId: string;
    success: boolean;
    report: RalphReport;
    metrics: AgentPerformanceMetrics;
}

export interface AgentPerformanceMetrics {
    durationMs: number;
    totalTokens: TokenUsage;
    iterations: number;
    filesModified: number;
    healAttempts: number;
    successfulHeals: number;
    qualityScore: number;
}

// ─── Benchmark Suite ───

export interface BenchmarkTask {
    id: string;
    description: string;
    repositoryPath: string;
    testCommand: string;
    expectedFilesModified?: string[];
    difficulty: 'easy' | 'medium' | 'hard';
}

export interface BenchmarkRunResult {
    benchmarkId: string;
    agentId: string;
    timestamp: number;
    tasksTotal: number;
    tasksPassed: number;
    tasksFailed: number;
    totalDurationMs: number;
    averageTokensPerTask: number;
    scorePercent: number;
    taskResults: BenchmarkTaskResult[];
}

export interface BenchmarkTaskResult {
    taskId: string;
    success: boolean;
    durationMs: number;
    tokens: TokenUsage;
    error?: string;
    metrics: AgentPerformanceMetrics;
}

export interface HarnessComparison {
    harnessName: string; // e.g. "Co-Team RALPH", "LangChain", "AutoGen"
    scorePercent: number;
    averageTokens: number;
    averageDurationMs: number;
}
