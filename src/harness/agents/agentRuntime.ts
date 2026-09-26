/**
 * Agent Runtime
 * 
 * Executes a CustomAgentDefinition by bridging it into the RALPH autonomous loop
 * and Co-Team Orchestrator. Acts as the sandbox and capability enforcer.
 */

import { CustomAgentDefinition, AgentExecutionRequest, AgentExecutionResult, AgentPerformanceMetrics } from './types';
import { RalphLoopEngine } from '../ralph/ralphEngine';
import { RalphTask, RalphReport } from '../ralph/types';
import { Orchestrator } from '@co-team/core';
import { Memory } from '@co-team/core';
import * as fs from 'fs';

export class AgentRuntime {
    private agent: CustomAgentDefinition;
    private ralph: RalphLoopEngine;

    constructor(agent: CustomAgentDefinition, workspaceRoot: string, executionRequest?: AgentExecutionRequest) {
        this.agent = agent;
        const enableTraceability = executionRequest?.enableTraceability ?? false;
        const traceLogPath = executionRequest?.traceLogPath;
        const onApprovalRequest = executionRequest?.onApprovalRequest;
        
        // Initialize the underlying RALPH engine for this agent
        this.ralph = new RalphLoopEngine({
            workspaceRoot,
            maxIterations: agent.maxIterations || 10,
            autoHeal: agent.capabilities.includes('auto_debug'),
            autoCheckpoint: agent.capabilities.includes('modify_files'),
            hooks: {
                onEvent: (event) => {
                    if (enableTraceability) {
                        if (traceLogPath) {
                            fs.appendFileSync(traceLogPath, JSON.stringify(event) + '\n');
                        }
                    }
                },
                onBeforeAction: async (plan, state) => {
                    // Capability enforcement
                    if (plan.actionType === 'forge_coding' && !this.agent.capabilities.includes('modify_files')) {
                        throw new Error(`Agent ${this.agent.id} lacks 'modify_files' capability`);
                    }
                    if (plan.actionType === 'multi_agent' && !this.agent.capabilities.includes('multi_agent_delegate')) {
                        throw new Error(`Agent ${this.agent.id} lacks 'multi_agent_delegate' capability`);
                    }

                    // Human-in-the-loop approval gate
                    if (this.agent.humanInTheLoop?.requireApprovalForFiles && plan.actionType === 'forge_coding') {
                        if (onApprovalRequest) {
                            const approved = await onApprovalRequest('modify_files', plan);
                            if (!approved) {
                                console.log(`[Harness] Action 'modify_files' rejected by Human-in-the-Loop`);
                                return false;
                            }
                        }
                    }
                    return true; // Allow action
                },
                onBeforeHeal: async (failureEvidence, state) => {
                    return this.agent.capabilities.includes('auto_debug');
                },
                onInjectContext: async (iteration) => {
                    return {
                        agentPersona: this.agent.systemPrompt,
                        agentId: this.agent.id,
                        sandboxing: this.agent.sandboxing ? JSON.stringify(this.agent.sandboxing) : 'none'
                    };
                }
            }
        });
    }

    /**
     * Run the agent on a specific task
     */
    async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
        const task: RalphTask = {
            id: `exec_${this.agent.id}_${Date.now()}`,
            goal: request.goal,
            testCommand: this.agent.capabilities.includes('run_tests') ? request.testCommand : undefined,
            acceptanceCriteria: request.acceptanceCriteria,
            dryRun: !this.agent.capabilities.includes('modify_files') || request.dryRun,
            context: request.context,
        };

        const report = await this.ralph.execute(task);
        const metrics = this.extractMetrics(report);

        return {
            agentId: this.agent.id,
            success: report.status === 'completed',
            report,
            metrics
        };
    }

    private extractMetrics(report: RalphReport): AgentPerformanceMetrics {
        const successfulHeals = report.healAttempts.filter(h => h.result === 'healed').length;
        
        return {
            durationMs: report.totalDurationMs,
            totalTokens: report.totalTokenUsage,
            iterations: report.iterations,
            filesModified: report.filesChanged.length,
            healAttempts: report.healAttempts.length,
            successfulHeals,
            qualityScore: report.qualityScore
        };
    }
}
