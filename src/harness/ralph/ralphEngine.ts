/**
 * RALPH Loop Engine — The Autonomous AI Harness
 *
 * Implements the RALPH (Reason → Act → Learn → Plan → Heal) autonomous agent loop
 * on top of the Co-Team Orchestrator and Forge execution plane.
 *
 * Design principles:
 *   - Evidence-driven: every phase produces structured evidence consumed by later phases
 *   - Self-correcting: HEAL phase applies targeted repairs, never blind retries
 *   - Observable: every transition emits structured events for external harness consumption
 *   - Composable: wraps existing Orchestrator/Forge infrastructure, never duplicates it
 *   - Bounded: enforces iteration and duration limits to prevent runaway loops
 */

import { Orchestrator, ProgressEvent } from '@co-team/core';
import { Memory } from '@co-team/core';
import { ConfigManager } from '@co-team/core';
import { getWorkspaceRoot, setPlatformContext } from '@co-team/core';
import { createNodePlatformContext } from '@co-team/core';
import { RalphStateMachine } from './ralphStateMachine';
import {
    RalphTask,
    RalphConfig,
    RalphReport,
    RalphLoopState,
    RalphEvent,
    RalphEventType,
    RalphEventListener,
    RalphHooks,
    RalphPhase,
    RalphHypothesis,
    RalphExecutionPlan,
    RalphPlanStep,
    RalphActionResult,
    RalphActionType,
    RalphInsight,
    RalphHealAttempt,
    RalphEvidence,
} from './types';
import { CodingTaskRequest } from '@co-team/core';
import { TokenUsage } from '@co-team/core';

const DEFAULT_CONFIG: Required<Omit<RalphConfig, 'hooks' | 'workspaceRoot' | 'mode'>> = {
    maxIterations: 5,
    maxDurationMs: 300_000,   // 5 minutes
    autoCheckpoint: true,
    autoHeal: true,
    dryRun: false,
    maxHealAttempts: 3,
    qualityThreshold: 60,
    verbose: false,
};

export class RalphLoopEngine {
    public orchestrator: Orchestrator;
    public stateMachine: RalphStateMachine;
    private config: Required<Omit<RalphConfig, 'hooks' | 'workspaceRoot' | 'mode'>> & { mode?: string; workspaceRoot: string };
    private hooks: RalphHooks;
    private listeners: RalphEventListener[] = [];

    constructor(config: RalphConfig = {}) {
        const root = config.workspaceRoot || getWorkspaceRoot() || process.cwd();

        // Ensure platform context for headless/CLI/SDK environments
        try {
            setPlatformContext(createNodePlatformContext(root));
        } catch {
            // Already set
        }

        ConfigManager.load(root);
        if (config.mode) {
            ConfigManager.set({ mode: config.mode }, root);
        }

        const memory = new Memory(root);
        this.orchestrator = new Orchestrator(memory);

        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
            workspaceRoot: root,
        };

        this.hooks = config.hooks || {};
        this.stateMachine = new RalphStateMachine('IDLE');

        // Wire state machine transitions to event emitter
        this.stateMachine.onTransition((transition) => {
            this.emit({
                type: transition.to === 'COMPLETE' ? 'loop:complete' :
                      transition.to === 'ABORTED' ? 'loop:aborted' :
                      'phase:start',
                phase: transition.to,
                iteration: transition.iteration,
                message: `${transition.from} → ${transition.to}: ${transition.reason}`,
                timestamp: transition.timestamp,
            });
        });
    }

    /**
     * Register an event listener
     */
    on(listener: RalphEventListener): void {
        this.listeners.push(listener);
    }

    /**
     * Execute a full RALPH loop for the given task
     */
    async execute(taskInput: RalphTask | string): Promise<RalphReport> {
        const task: RalphTask = typeof taskInput === 'string'
            ? { id: `ralph_${Date.now()}`, goal: taskInput }
            : taskInput;

        const maxIterations = task.maxIterations ?? this.config.maxIterations;
        const maxDurationMs = task.maxDurationMs ?? this.config.maxDurationMs;
        const startedAt = Date.now();

        // Initialize loop state
        const state: RalphLoopState = {
            phase: 'IDLE',
            iteration: 0,
            maxIterations,
            evidence: {
                observations: {},
                touchedFiles: [],
                errors: [],
                warnings: [],
            },
            transitions: [],
            hypotheses: [],
            plan: null,
            actionResult: null,
            insights: [],
            healAttempts: [],
            isComplete: false,
            isAborted: false,
            tokenUsage: { input: 0, output: 0, copilotTokens: 0, freeTokens: 0, localTokens: 0, calls: 0, totalLatencyMs: 0, totalCostUsd: 0 },
            startedAt,
            elapsedMs: 0,
        };

        this.stateMachine.reset();

        this.emit({
            type: 'loop:start',
            phase: 'IDLE',
            iteration: 0,
            message: `RALPH loop starting for task: "${task.goal}" (max ${maxIterations} iterations, ${maxDurationMs}ms timeout)`,
            timestamp: startedAt,
        });

        // ── Main RALPH Loop ──
        try {
            while (state.iteration < maxIterations && !state.isComplete && !state.isAborted) {
                state.iteration++;
                state.elapsedMs = Date.now() - startedAt;
                this.stateMachine.iteration = state.iteration;

                // Timeout check
                if (state.elapsedMs >= maxDurationMs) {
                    this.emit({
                        type: 'loop:timeout',
                        phase: this.stateMachine.phase,
                        iteration: state.iteration,
                        message: `RALPH loop timed out after ${state.elapsedMs}ms`,
                        timestamp: Date.now(),
                    });
                    state.isAborted = true;
                    state.abortReason = `Timeout after ${state.elapsedMs}ms`;
                    break;
                }

                this.emit({
                    type: 'loop:iteration_start',
                    phase: this.stateMachine.phase,
                    iteration: state.iteration,
                    message: `Starting RALPH iteration ${state.iteration}/${maxIterations}`,
                    timestamp: Date.now(),
                });

                // ══════════════════════════════════════════════════════════════
                // PHASE 1: REASON — Perceive, classify, hypothesize
                // ══════════════════════════════════════════════════════════════
                this.stateMachine.transition('REASON', `Iteration ${state.iteration}: Perceiving environment and forming hypotheses`);
                state.phase = 'REASON';

                const hypotheses = await this.phaseReason(task, state);
                state.hypotheses = hypotheses;

                // Check if REASON concludes the task is already done
                if (hypotheses.length === 1 && hypotheses[0].actionType === 'noop') {
                    state.isComplete = true;
                    this.stateMachine.transition('COMPLETE', 'REASON phase determined task is already satisfied');
                    break;
                }

                // ══════════════════════════════════════════════════════════════
                // PHASE 2: PLAN — Build execution strategy from hypotheses
                // ══════════════════════════════════════════════════════════════
                this.stateMachine.transition('PLAN', `Building execution plan from ${hypotheses.length} hypothesis(es)`);
                state.phase = 'PLAN';

                const plan = await this.phasePlan(task, state);
                state.plan = plan;

                // Check if PLAN determines no action is needed
                if (plan.actionType === 'noop') {
                    state.isComplete = true;
                    this.stateMachine.transition('COMPLETE', 'PLAN phase determined no action needed');
                    break;
                }

                // ══════════════════════════════════════════════════════════════
                // PHASE 3: ACT — Execute the plan
                // ══════════════════════════════════════════════════════════════

                // Hook: allow external harness to veto the action
                if (this.hooks.onBeforeAction) {
                    const proceed = await this.hooks.onBeforeAction(plan, state);
                    if (!proceed) {
                        state.isAborted = true;
                        state.abortReason = 'Action vetoed by external harness hook';
                        if (this.stateMachine.canTransitionTo('ABORTED')) {
                            this.stateMachine.transition('ABORTED', state.abortReason);
                        }
                        break;
                    }
                }

                this.stateMachine.transition('ACT', `Executing ${plan.actionType}: ${plan.strategy}`);
                state.phase = 'ACT';

                const actionResult = await this.phaseAct(task, plan, state);
                state.actionResult = actionResult;

                // Accumulate token usage
                state.tokenUsage.input += actionResult.tokenUsage.input;
                state.tokenUsage.output += actionResult.tokenUsage.output;

                // ══════════════════════════════════════════════════════════════
                // PHASE 3.5: HEAL — If action failed and autoHeal is enabled
                // ══════════════════════════════════════════════════════════════
                if (!actionResult.success && (task.autoHeal ?? this.config.autoHeal)) {
                    const shouldHeal = this.hooks.onBeforeHeal
                        ? await this.hooks.onBeforeHeal(actionResult.errors.join('\n'), state)
                        : true;

                    if (shouldHeal && state.healAttempts.length < this.config.maxHealAttempts) {
                        this.stateMachine.transition('HEAL', `Action failed. Initiating self-healing (attempt ${state.healAttempts.length + 1}/${this.config.maxHealAttempts})`);
                        state.phase = 'HEAL';

                        const healResult = await this.phaseHeal(task, actionResult, state);
                        state.healAttempts.push(healResult);

                        if (healResult.result === 'healed') {
                            // Recovery successful — go to LEARN
                            actionResult.success = true;
                            actionResult.errors = [];
                            state.evidence.observations['heal_success'] = healResult.actionTaken;
                        }
                    }
                }

                // ══════════════════════════════════════════════════════════════
                // PHASE 4: LEARN — Extract insights and update memory
                // ══════════════════════════════════════════════════════════════
                this.stateMachine.transition('LEARN', 'Extracting insights and updating evidence base');
                state.phase = 'LEARN';

                const insights = await this.phaseLearn(task, actionResult, state);
                state.insights.push(...insights);

                // Hook: notify external harness of insights
                if (this.hooks.onInsights && insights.length > 0) {
                    await this.hooks.onInsights(insights);
                }

                // ══════════════════════════════════════════════════════════════
                // LOOP DECISION: Continue or Complete?
                // ══════════════════════════════════════════════════════════════
                const isComplete = this.evaluateCompletion(task, state);
                state.isComplete = isComplete;

                this.emit({
                    type: 'loop:iteration_complete',
                    phase: this.stateMachine.phase,
                    iteration: state.iteration,
                    message: isComplete
                        ? `Iteration ${state.iteration} complete. Task satisfied.`
                        : `Iteration ${state.iteration} complete. Continuing to next cycle.`,
                    timestamp: Date.now(),
                    tokensSoFar: { ...state.tokenUsage },
                });

                if (isComplete) {
                    this.stateMachine.transition('COMPLETE', 'All acceptance criteria met and verification passed');
                } else if (state.iteration >= maxIterations) {
                    // Will exit the while loop naturally
                } else {
                    // Continue to next iteration — LEARN → REASON
                    // State machine will transition at the top of the next iteration
                }
            }
        } catch (err: any) {
            state.evidence.errors.push(err.message || String(err));
            if (!this.stateMachine.isTerminal() && this.stateMachine.canTransitionTo('ABORTED')) {
                state.isAborted = true;
                state.abortReason = `Fatal error: ${err.message || String(err)}`;
                this.stateMachine.transition('ABORTED', state.abortReason);
            }
        }

        // ── Build Final Report ──
        state.elapsedMs = Date.now() - startedAt;
        state.transitions = this.stateMachine.transitions;

        const report = this.buildReport(task, state);

        // Hook: notify completion
        if (this.hooks.onComplete) {
            await this.hooks.onComplete(report);
        }

        return report;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase Implementations
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * REASON phase: Perceive the workspace, retrieve memory, classify intent, form hypotheses.
     */
    private async phaseReason(task: RalphTask, state: RalphLoopState): Promise<RalphHypothesis[]> {
        this.emit({
            type: 'phase:start',
            phase: 'REASON',
            iteration: state.iteration,
            message: 'Perceiving workspace and forming hypotheses...',
            timestamp: Date.now(),
        });

        // Inject context from external harness if available
        if (this.hooks.onInjectContext) {
            const injected = await this.hooks.onInjectContext(state.iteration);
            if (injected) {
                Object.assign(state.evidence.observations, injected);
            }
        }

        // Use the Orchestrator's perception engine for deep workspace understanding
        const perception = await this.orchestrator.perceptionEngine.perceive(task.goal);
        state.evidence.perception = perception;

        // Classify the task and form hypotheses
        const hypotheses: RalphHypothesis[] = [];

        // Determine if this is a coding task (route to Forge) or a general task
        const isCodingTask = this.isCodingTask(task, perception);

        if (isCodingTask) {
            hypotheses.push({
                id: `hyp_forge_${state.iteration}`,
                description: `Execute coding task through Forge deterministic pipeline: "${task.goal}"`,
                confidence: 0.85,
                actionType: 'forge_coding',
                evidence: [
                    `Complexity: ${perception.complexity}`,
                    `Languages: ${perception.context.languages.join(', ')}`,
                    `Relevant files: ${perception.context.relevantFiles.slice(0, 5).join(', ')}`,
                ],
                risks: perception.complexity === 'complex' ? ['Complex task may require multiple recovery iterations'] : [],
                estimatedCost: perception.complexity === 'simple' ? 'low' : perception.complexity === 'medium' ? 'medium' : 'high',
            });
        } else {
            hypotheses.push({
                id: `hyp_multiagent_${state.iteration}`,
                description: `Execute through multi-agent reasoning pipeline: "${task.goal}"`,
                confidence: 0.75,
                actionType: 'multi_agent',
                evidence: [
                    `Task type: general multi-agent`,
                    `Domains: ${perception.requiredDomains.join(', ')}`,
                ],
                risks: [],
                estimatedCost: perception.suggestedParallelCount > 2 ? 'high' : 'medium',
            });
        }

        // If there were failures in previous iterations, add a recovery hypothesis
        if (state.iteration > 1 && state.evidence.errors.length > 0) {
            hypotheses.push({
                id: `hyp_recovery_${state.iteration}`,
                description: `Address errors from previous iteration: ${state.evidence.errors.slice(-2).join('; ')}`,
                confidence: 0.6,
                actionType: 'heal',
                evidence: state.evidence.errors.slice(-3),
                risks: ['Recovery may not fully resolve all errors'],
                estimatedCost: 'medium',
            });
        }

        for (const hyp of hypotheses) {
            this.emit({
                type: 'hypothesis:formed',
                phase: 'REASON',
                iteration: state.iteration,
                message: `Hypothesis [${hyp.actionType}] (confidence: ${hyp.confidence}): ${hyp.description}`,
                timestamp: Date.now(),
                details: hyp,
            });
        }

        this.emit({
            type: 'phase:complete',
            phase: 'REASON',
            iteration: state.iteration,
            message: `REASON complete: ${hypotheses.length} hypothesis(es) formed`,
            timestamp: Date.now(),
        });

        return hypotheses;
    }

    /**
     * PLAN phase: Select the best hypothesis and build an execution plan.
     */
    private async phasePlan(task: RalphTask, state: RalphLoopState): Promise<RalphExecutionPlan> {
        this.emit({
            type: 'phase:start',
            phase: 'PLAN',
            iteration: state.iteration,
            message: 'Building execution plan from hypotheses...',
            timestamp: Date.now(),
        });

        // Select the hypothesis with the highest confidence
        const sorted = [...state.hypotheses].sort((a, b) => b.confidence - a.confidence);
        const selected = sorted[0];

        const steps: RalphPlanStep[] = [];

        if (selected.actionType === 'forge_coding') {
            steps.push(
                { id: 'discover', description: 'Discover repository state and check Git status', actionType: 'forge_coding', dependencies: [], priority: 1 },
                { id: 'explore', description: 'Explore relevant files and symbols', actionType: 'forge_coding', dependencies: ['discover'], priority: 2 },
                { id: 'implement', description: 'Generate and apply code changes', actionType: 'forge_coding', dependencies: ['explore'], priority: 3 },
                { id: 'test', description: 'Run test/build validation', actionType: 'forge_coding', dependencies: ['implement'], priority: 4 },
                { id: 'verify', description: 'Verify acceptance criteria and inspect diff', actionType: 'forge_coding', dependencies: ['test'], priority: 5 },
            );
        } else if (selected.actionType === 'multi_agent') {
            steps.push(
                { id: 'perceive', description: 'Deep workspace analysis', actionType: 'multi_agent', dependencies: [], priority: 1 },
                { id: 'reason', description: 'Parallel multi-model reasoning', actionType: 'multi_agent', dependencies: ['perceive'], priority: 2 },
                { id: 'evaluate', description: 'Evaluate and rank candidates', actionType: 'multi_agent', dependencies: ['reason'], priority: 3 },
                { id: 'synthesize', description: 'Synthesize optimal solution', actionType: 'multi_agent', dependencies: ['evaluate'], priority: 4 },
                { id: 'execute', description: 'Apply synthesized changes', actionType: 'multi_agent', dependencies: ['synthesize'], priority: 5 },
            );
        } else if (selected.actionType === 'heal') {
            steps.push(
                { id: 'diagnose', description: 'Analyze failure evidence', actionType: 'heal', dependencies: [], priority: 1 },
                { id: 'fix', description: 'Apply targeted repair', actionType: 'heal', dependencies: ['diagnose'], priority: 2 },
                { id: 'validate', description: 'Validate the fix', actionType: 'heal', dependencies: ['fix'], priority: 3 },
            );
        }

        const plan: RalphExecutionPlan = {
            strategy: selected.description,
            actionType: selected.actionType,
            steps,
            estimatedTokens: selected.estimatedCost === 'low' ? 5000 : selected.estimatedCost === 'medium' ? 15000 : 40000,
            estimatedDurationMs: selected.estimatedCost === 'low' ? 10000 : selected.estimatedCost === 'medium' ? 30000 : 90000,
            fallbackStrategy: sorted.length > 1 ? sorted[1].description : undefined,
            fallbackActionType: sorted.length > 1 ? sorted[1].actionType : undefined,
        };

        this.emit({
            type: 'plan:created',
            phase: 'PLAN',
            iteration: state.iteration,
            message: `Plan created: ${plan.actionType} with ${plan.steps.length} steps — "${plan.strategy}"`,
            timestamp: Date.now(),
            details: plan,
        });

        this.emit({
            type: 'phase:complete',
            phase: 'PLAN',
            iteration: state.iteration,
            message: `PLAN complete: ${plan.actionType} strategy selected`,
            timestamp: Date.now(),
        });

        return plan;
    }

    /**
     * ACT phase: Execute the plan through the appropriate engine.
     */
    private async phaseAct(task: RalphTask, plan: RalphExecutionPlan, state: RalphLoopState): Promise<RalphActionResult> {
        const actStart = Date.now();

        this.emit({
            type: 'action:start',
            phase: 'ACT',
            iteration: state.iteration,
            message: `Executing ${plan.actionType} action...`,
            timestamp: actStart,
        });

        try {
            let result: RalphActionResult;

            switch (plan.actionType) {
                case 'forge_coding':
                    result = await this.actForgeCoding(task, state);
                    break;
                case 'multi_agent':
                    result = await this.actMultiAgent(task, state);
                    break;
                case 'heal':
                    result = await this.actHeal(task, state);
                    break;
                case 'review':
                    result = await this.actReview(task, state);
                    break;
                default:
                    result = {
                        actionType: plan.actionType,
                        success: true,
                        output: 'No-op action completed',
                        filesChanged: [],
                        tokenUsage: { input: 0, output: 0, copilotTokens: 0, freeTokens: 0, localTokens: 0, calls: 0, totalLatencyMs: 0, totalCostUsd: 0 },
                        durationMs: 0,
                        errors: [],
                        warnings: [],
                    };
            }

            result.durationMs = Date.now() - actStart;

            this.emit({
                type: result.success ? 'action:complete' : 'action:failed',
                phase: 'ACT',
                iteration: state.iteration,
                message: result.success
                    ? `Action ${plan.actionType} completed successfully (${result.filesChanged.length} files changed)`
                    : `Action ${plan.actionType} failed: ${result.errors.join('; ')}`,
                timestamp: Date.now(),
                tokensSoFar: { ...state.tokenUsage },
                details: { filesChanged: result.filesChanged, errors: result.errors },
            });

            // Update evidence
            state.evidence.touchedFiles.push(...result.filesChanged);
            if (result.errors.length > 0) {
                state.evidence.errors.push(...result.errors);
            }

            return result;

        } catch (err: any) {
            const errorResult: RalphActionResult = {
                actionType: plan.actionType,
                success: false,
                output: '',
                filesChanged: [],
                tokenUsage: { ...this.orchestrator.router.usage },
                durationMs: Date.now() - actStart,
                errors: [err.message || String(err)],
                warnings: [],
            };

            this.emit({
                type: 'action:failed',
                phase: 'ACT',
                iteration: state.iteration,
                message: `Action ${plan.actionType} threw: ${err.message || String(err)}`,
                timestamp: Date.now(),
            });

            state.evidence.errors.push(err.message || String(err));
            return errorResult;
        }
    }

    /**
     * LEARN phase: Extract insights, patterns, and update project memory.
     */
    private async phaseLearn(task: RalphTask, actionResult: RalphActionResult, state: RalphLoopState): Promise<RalphInsight[]> {
        this.emit({
            type: 'phase:start',
            phase: 'LEARN',
            iteration: state.iteration,
            message: 'Analyzing outcomes and extracting insights...',
            timestamp: Date.now(),
        });

        const insights: RalphInsight[] = [];

        if (actionResult.success) {
            insights.push({
                id: `insight_success_${state.iteration}`,
                iteration: state.iteration,
                category: 'success_pattern',
                description: `${actionResult.actionType} succeeded for "${task.goal}" in ${actionResult.durationMs}ms with ${actionResult.filesChanged.length} files changed`,
                confidence: 0.9,
                actionable: false,
                promoteToMemory: actionResult.filesChanged.length > 0,
            });

            // Promote verified success to project memory
            if (actionResult.filesChanged.length > 0) {
                try {
                    this.orchestrator.projectMemory.addConvention({
                        category: 'pattern',
                        rule: `${actionResult.actionType} for "${task.goal.slice(0, 60)}"`,
                        examples: actionResult.filesChanged.slice(0, 5),
                        confidence: 0.8,
                    });
                    this.emit({
                        type: 'memory:promoted',
                        phase: 'LEARN',
                        iteration: state.iteration,
                        message: `Promoted success pattern to project memory`,
                        timestamp: Date.now(),
                    });
                } catch {
                    // Non-critical
                }
            }
        } else {
            insights.push({
                id: `insight_failure_${state.iteration}`,
                iteration: state.iteration,
                category: 'failure_pattern',
                description: `${actionResult.actionType} failed: ${actionResult.errors.slice(0, 2).join('; ')}`,
                confidence: 0.8,
                actionable: true,
                promoteToMemory: false,
            });

            // Analyze if the error suggests a different approach
            if (actionResult.errors.some(e => e.includes('test') || e.includes('build'))) {
                insights.push({
                    id: `insight_heal_hint_${state.iteration}`,
                    iteration: state.iteration,
                    category: 'optimization',
                    description: 'Build/test failures detected — next iteration should prioritize auto-healing before re-implementation',
                    confidence: 0.7,
                    actionable: true,
                    promoteToMemory: false,
                });
            }
        }

        // Check for token budget insights
        const totalTokens = state.tokenUsage.input + state.tokenUsage.output;
        if (totalTokens > 50000) {
            insights.push({
                id: `insight_tokens_${state.iteration}`,
                iteration: state.iteration,
                category: 'optimization',
                description: `Token usage is high (${totalTokens}). Consider simplifying prompts or reducing parallel model count.`,
                confidence: 0.6,
                actionable: true,
                promoteToMemory: false,
            });
        }

        for (const insight of insights) {
            this.emit({
                type: 'insight:discovered',
                phase: 'LEARN',
                iteration: state.iteration,
                message: `[${insight.category}] ${insight.description}`,
                timestamp: Date.now(),
                details: insight,
            });
        }

        this.emit({
            type: 'phase:complete',
            phase: 'LEARN',
            iteration: state.iteration,
            message: `LEARN complete: ${insights.length} insight(s) extracted`,
            timestamp: Date.now(),
        });

        return insights;
    }

    /**
     * HEAL phase: Diagnose and fix failures.
     */
    private async phaseHeal(task: RalphTask, actionResult: RalphActionResult, state: RalphLoopState): Promise<RalphHealAttempt> {
        const healStart = Date.now();
        const failureEvidence = actionResult.errors.join('\n');

        this.emit({
            type: 'heal:attempt',
            phase: 'HEAL',
            iteration: state.iteration,
            message: `Healing attempt ${state.healAttempts.length + 1}: Diagnosing failures...`,
            timestamp: healStart,
        });

        try {
            const testCmd = task.testCommand || 'npm test';
            const debugResult = await this.orchestrator.autoDebug.debug(testCmd);
            state.evidence.debugResult = debugResult;

            const healed = debugResult.allFixed;

            const attempt: RalphHealAttempt = {
                iteration: state.iteration,
                failureEvidence: failureEvidence.slice(0, 500),
                hypothesis: `AutoDebug identified ${debugResult.totalIssuesFound} issue(s) and attempted targeted fixes`,
                actionTaken: debugResult.summary || 'AutoDebug self-healing cycle',
                result: healed ? 'healed' : 'failed',
                validationCommand: testCmd,
                validationOutput: debugResult.summary,
                durationMs: Date.now() - healStart,
            };

            this.emit({
                type: healed ? 'heal:success' : 'heal:failed',
                phase: 'HEAL',
                iteration: state.iteration,
                message: healed
                    ? `Self-healing succeeded: ${debugResult.summary}`
                    : `Self-healing could not resolve all issues: ${debugResult.summary}`,
                timestamp: Date.now(),
                details: attempt,
            });

            return attempt;

        } catch (err: any) {
            const attempt: RalphHealAttempt = {
                iteration: state.iteration,
                failureEvidence: failureEvidence.slice(0, 500),
                hypothesis: 'AutoDebug could not be invoked',
                actionTaken: `Heal attempt failed: ${err.message}`,
                result: 'failed',
                durationMs: Date.now() - healStart,
            };

            this.emit({
                type: 'heal:failed',
                phase: 'HEAL',
                iteration: state.iteration,
                message: `Heal phase error: ${err.message}`,
                timestamp: Date.now(),
            });

            return attempt;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Action Implementations
    // ══════════════════════════════════════════════════════════════════════════

    private async actForgeCoding(task: RalphTask, state: RalphLoopState): Promise<RalphActionResult> {
        const workspace = this.config.workspaceRoot;
        const request: CodingTaskRequest = {
            taskId: `${task.id}_forge_${state.iteration}`,
            workspace,
            goal: task.goal,
            acceptanceCriteria: task.acceptanceCriteria || [task.goal],
            constraints: [],
            mode: 'standard',
            testCommand: task.testCommand,
            relevantFiles: task.files,
            maxIterations: 3,
        };

        // Listen to Forge state transitions
        this.orchestrator.forge.stateMachine.onTransition((event) => {
            this.emit({
                type: 'action:start',
                phase: 'ACT',
                iteration: state.iteration,
                message: `[Forge] ${event.from} → ${event.to}: ${event.reason}`,
                timestamp: Date.now(),
            });
        });

        const report = await this.orchestrator.executeCodingTask(task.goal, {
            testCommand: task.testCommand,
            acceptanceCriteria: task.acceptanceCriteria,
            relevantFiles: task.files,
        });

        state.evidence.codingReport = report;

        return {
            actionType: 'forge_coding',
            success: report.status === 'completed',
            output: report.summary,
            filesChanged: report.filesChanged.map(f => f.path),
            tokenUsage: { ...this.orchestrator.router.usage },
            durationMs: 0,  // filled by caller
            structuredResult: report,
            errors: report.status !== 'completed' ? [report.summary] : [],
            warnings: report.risks,
        };
    }

    private async actMultiAgent(task: RalphTask, state: RalphLoopState): Promise<RalphActionResult> {
        const rawResult = await this.orchestrator.run(
            task.goal,
            (event: ProgressEvent) => {
                this.emit({
                    type: 'action:start',
                    phase: 'ACT',
                    iteration: state.iteration,
                    message: `[Multi-Agent] ${event.step}: ${event.message}`,
                    timestamp: Date.now(),
                    tokensSoFar: event.tokensSoFar,
                });
            },
            task.mode,
        );

        state.evidence.perception = rawResult.perception;
        state.evidence.candidates = rawResult.candidates;
        state.evidence.evaluations = rawResult.evaluations;
        state.evidence.synthesis = rawResult.synthesis;
        state.evidence.execution = rawResult.execution;

        const hasErrors = rawResult.execution.errors && rawResult.execution.errors.length > 0;
        const success = !hasErrors && rawResult.qualityScore >= this.config.qualityThreshold;

        return {
            actionType: 'multi_agent',
            success,
            output: rawResult.summary,
            filesChanged: rawResult.execution.files?.map((f: any) => f.filePath || f.path) || [],
            tokenUsage: rawResult.tokenUsage,
            durationMs: 0,
            structuredResult: rawResult,
            errors: hasErrors ? rawResult.execution.errors : [],
            warnings: [],
        };
    }

    private async actHeal(task: RalphTask, state: RalphLoopState): Promise<RalphActionResult> {
        const testCmd = task.testCommand || 'npm test';
        const result = await this.orchestrator.autoDebug.debug(testCmd);

        return {
            actionType: 'heal',
            success: result.allFixed,
            output: result.summary || 'AutoDebug cycle completed',
            filesChanged: [],
            tokenUsage: { ...this.orchestrator.router.usage },
            durationMs: 0,
            structuredResult: result,
            errors: result.allFixed ? [] : [result.summary || 'Healing incomplete'],
            warnings: [],
        };
    }

    private async actReview(task: RalphTask, state: RalphLoopState): Promise<RalphActionResult> {
        const synthesis = state.evidence.synthesis;
        const code = synthesis?.output || task.goal;

        const audit = await this.orchestrator.auditEngine.audit(code);
        state.evidence.audit = audit;

        return {
            actionType: 'review',
            success: audit.passed,
            output: `Audit score: ${audit.score}/100. ${audit.passed ? 'PASSED' : 'FAILED'}`,
            filesChanged: [],
            tokenUsage: { input: 0, output: 0, copilotTokens: 0, freeTokens: 0, localTokens: 0, calls: 0, totalLatencyMs: 0, totalCostUsd: 0 },
            durationMs: 0,
            structuredResult: audit,
            errors: audit.passed ? [] : [`Audit failed with score ${audit.score}/100`],
            warnings: audit.findings?.map((f: any) => f.message || String(f)) || [],
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Utilities
    // ══════════════════════════════════════════════════════════════════════════

    private isCodingTask(task: RalphTask, perception: any): boolean {
        const codingKeywords = [
            'implement', 'fix', 'bug', 'refactor', 'test', 'add', 'create',
            'modify', 'update', 'delete', 'remove', 'rename', 'move', 'debug',
            'build', 'compile', 'error', 'crash', 'feature', 'endpoint',
            'function', 'class', 'method', 'component', 'module', 'api',
            'route', 'handler', 'service', 'controller', 'model', 'schema',
            'migration', 'deploy', 'install', 'configure', 'setup',
        ];

        const goalLower = task.goal.toLowerCase();
        const hasCodingKeyword = codingKeywords.some(kw => goalLower.includes(kw));
        const hasCodingDomain = perception.requiredDomains?.includes('coding');
        const hasTestCommand = !!task.testCommand;
        const hasAcceptanceCriteria = (task.acceptanceCriteria?.length ?? 0) > 0;

        return hasCodingKeyword || hasCodingDomain || hasTestCommand || hasAcceptanceCriteria;
    }

    private evaluateCompletion(task: RalphTask, state: RalphLoopState): boolean {
        // If the action succeeded and there are no pending errors
        if (state.actionResult?.success && state.evidence.errors.length === 0) {
            return true;
        }

        // If we have a coding report that's completed
        if (state.evidence.codingReport?.status === 'completed') {
            return true;
        }

        // If multi-agent synthesis produced a quality score above threshold
        if (state.evidence.synthesis && state.evidence.synthesis.qualityScore >= this.config.qualityThreshold) {
            return true;
        }

        return false;
    }

    private emit(event: RalphEvent): void {
        // Notify registered listeners
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (err) {
                console.warn('[RALPH Engine] Event listener error:', err);
            }
        }

        // Also route to hooks if configured
        if (this.hooks.onEvent) {
            try {
                this.hooks.onEvent(event);
            } catch (err) {
                console.warn('[RALPH Engine] Hook event error:', err);
            }
        }

        // Verbose logging
        if (this.config.verbose) {
            const prefix = `[RALPH:${event.phase}:${event.iteration}]`;
            console.log(`${prefix} ${event.message}`);
        }
    }

    private buildReport(task: RalphTask, state: RalphLoopState): RalphReport {
        let status: RalphReport['status'];
        if (state.isAborted) {
            status = state.abortReason?.startsWith('Timeout') ? 'timeout' : 'aborted';
        } else if (state.isComplete) {
            status = 'completed';
        } else if (state.actionResult?.success) {
            status = 'partial';
        } else {
            status = 'failed';
        }

        const qualityScore = state.evidence.synthesis?.qualityScore
            ?? (state.evidence.codingReport?.status === 'completed' ? 85 : 0);

        return {
            taskId: task.id,
            goal: task.goal,
            status,
            iterations: state.iteration,
            totalDurationMs: state.elapsedMs,
            totalTokenUsage: state.tokenUsage,
            qualityScore,
            summary: state.actionResult?.output || state.evidence.codingReport?.summary || 'No output produced',
            filesChanged: [...new Set(state.evidence.touchedFiles)],
            insights: state.insights,
            healAttempts: state.healAttempts,
            validatedHypotheses: state.hypotheses.filter(h => {
                if (h.actionType === state.actionResult?.actionType && state.actionResult?.success) {
                    return true;
                }
                return false;
            }),
            risks: [
                ...(state.evidence.codingReport?.risks || []),
                ...(state.evidence.warnings),
            ],
            nextActions: state.evidence.codingReport?.nextActions || [],
            finalState: state,
            evidence: state.evidence,
        };
    }
}

/**
 * Convenience factory function
 */
export function createRalphEngine(config?: RalphConfig): RalphLoopEngine {
    return new RalphLoopEngine(config);
}
