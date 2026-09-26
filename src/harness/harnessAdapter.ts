import {
    HarnessTask,
    HarnessOrchestratorConfig,
    HarnessExecutionReport,
    HarnessStageEvent,
    HarnessHooks,
} from './types';
import {
    Orchestrator,
    ProgressEvent,
    Memory,
    ConfigManager,
    getWorkspaceRoot,
    setPlatformContext,
    createNodePlatformContext,
    PerceptionResult,
    CandidateOutput,
    EvaluationResult,
    SynthesisResult,
    ModelTaskConfig,
    CodingTaskRequest,
    CodingTaskReport,
    AuditResult,
    ExecutionResult,
    AutoDebugResult,
    WorkspaceContext,
} from '@co-team/core';

/**
 * HarnessAdapter provides a programmatic, event-driven bridge between
 * any external AI agent harness / orchestrator framework and the Co-Team Multi-Agent System.
 */
export class HarnessAdapter {
    public orchestrator: Orchestrator;
    public config: HarnessOrchestratorConfig;
    private hooks: HarnessHooks;

    constructor(config: HarnessOrchestratorConfig = {}) {
        this.config = config;
        this.hooks = config.hooks || {};

        const root = config.workspaceRoot || getWorkspaceRoot() || process.cwd();
        
        // Ensure platform context is ready for Node/headless harness environments
        try {
            setPlatformContext(createNodePlatformContext(root));
        } catch {
            // Platform context may already be set
        }

        ConfigManager.load(root);
        if (config.mode) {
            ConfigManager.set({ mode: config.mode }, root);
        }

        const memory = new Memory(root);
        this.orchestrator = new Orchestrator(memory, config.corePath);
    }

    /**
     * Dispatch an event to configured lifecycle hooks
     */
    private async emitStage(event: Omit<HarnessStageEvent, 'timestamp'>): Promise<void> {
        if (!this.hooks.onStageEvent) return;
        const fullEvent: HarnessStageEvent = {
            ...event,
            timestamp: Date.now(),
        };
        try {
            await this.hooks.onStageEvent(fullEvent);
        } catch (err) {
            console.warn('[HarnessAdapter] Hook execution error on stage event:', err);
        }
    }

    /**
     * Execute an end-to-end autonomous multi-agent task
     */
    async execute(taskInput: HarnessTask | string): Promise<HarnessExecutionReport> {
        const startTime = Date.now();
        const task: HarnessTask = typeof taskInput === 'string'
            ? { goal: taskInput }
            : taskInput;

        const taskId = task.id || `task_${Date.now()}`;
        const mode = task.mode || this.config.mode || this.orchestrator.router.getMode();

        await this.emitStage({
            stage: 'perception',
            status: 'start',
            message: `Starting task ${taskId}: "${task.goal}" in ${mode} mode`,
        });

        // Bridge Orchestrator progress callbacks to harness hooks
        const progressCallback = async (event: ProgressEvent) => {
            await this.emitStage({
                stage: this.mapStepToStage(event.step),
                status: 'progress',
                role: event.role,
                message: event.message,
                tokensSoFar: event.tokensSoFar,
            });
        };

        try {
            const rawResult = await this.orchestrator.run(
                task.goal,
                progressCallback,
                mode,
                this.config.modelConfig,
            );

            // Notify candidate hooks
            if (rawResult.candidates && this.hooks.onAgentCandidate) {
                for (const cand of rawResult.candidates) {
                    await this.hooks.onAgentCandidate(cand);
                }
            }

            // Notify critique hooks
            if (rawResult.critiques && this.hooks.onCritique) {
                for (const crit of rawResult.critiques) {
                    await this.hooks.onCritique(crit);
                }
            }

            // Notify checkpoint hooks
            if (rawResult.gitCheckpoint && this.hooks.onCheckpoint) {
                await this.hooks.onCheckpoint(rawResult.gitCheckpoint);
            }

            // Notify file execution hooks
            if (rawResult.execution?.files && this.hooks.onFileOperation) {
                for (const f of rawResult.execution.files) {
                    await this.hooks.onFileOperation({
                        path: f.filePath,
                        operation: f.action === 'delete' ? 'delete' : (f.action === 'create' ? 'create' : 'update'),
                    });
                }
            }

            const success = (rawResult.execution.errors?.length ?? 0) === 0 && rawResult.qualityScore >= 50;

            await this.emitStage({
                stage: 'complete',
                status: success ? 'complete' : 'failed',
                message: success ? 'Pipeline completed successfully' : 'Pipeline completed with warnings/errors',
                details: { qualityScore: rawResult.qualityScore },
            });

            return {
                taskId,
                goal: task.goal,
                mode,
                success,
                durationMs: Date.now() - startTime,
                qualityScore: rawResult.qualityScore,
                tokenUsage: rawResult.tokenUsage,
                perception: rawResult.perception,
                candidates: rawResult.candidates,
                evaluations: rawResult.evaluations,
                critiques: rawResult.critiques,
                synthesis: rawResult.synthesis,
                execution: rawResult.execution,
                gitCheckpoint: rawResult.gitCheckpoint,
                gitCommit: rawResult.gitCommitResult,
                errors: rawResult.execution.errors,
                summary: rawResult.summary,
            };
        } catch (err: any) {
            const errorMsg = err.message || String(err);
            await this.emitStage({
                stage: 'error',
                status: 'failed',
                message: `Task execution failed: ${errorMsg}`,
                details: { error: errorMsg },
            });

            return {
                taskId,
                goal: task.goal,
                mode,
                success: false,
                durationMs: Date.now() - startTime,
                qualityScore: 0,
                tokenUsage: { ...this.orchestrator.router.usage },
                errors: [errorMsg],
                summary: `Failed to execute task: ${errorMsg}`,
            };
        }
    }

    /**
     * Delegate coding task to the Forge execution plane
     */
    async executeCoding(request: CodingTaskRequest): Promise<CodingTaskReport> {
        await this.emitStage({ stage: 'execution', status: 'start', message: `Routing coding task to Forge: "${request.goal}"` });
        const report = await this.orchestrator.forge.executeTask(request);
        await this.emitStage({
            stage: 'execution',
            status: report.status === 'completed' ? 'complete' : 'failed',
            message: `Forge completed with status: ${report.status}`,
            details: report,
        });
        return report;
    }

    /**
     * Stage 1: Perceive workspace and goals without executing changes
     */
    async perceive(goal: string): Promise<PerceptionResult> {
        await this.emitStage({ stage: 'perception', status: 'start', message: 'Analyzing workspace and symbols...' });
        const result = await this.orchestrator.perceptionEngine.perceive(goal);
        await this.emitStage({ stage: 'perception', status: 'complete', message: `Perceived complexity: ${result.complexity}`, details: result });
        return result;
    }

    /**
     * Stage 2a: Generate model execution plans based on perception
     */
    plan(perception: PerceptionResult): ModelTaskConfig[] {
        return this.orchestrator.modelPlanner.plan(perception);
    }

    /**
     * Stage 2b: Run parallel reasoning across configured models
     */
    async reason(goal: string, perception: PerceptionResult, planConfigs?: ModelTaskConfig[]): Promise<CandidateOutput[]> {
        const configs = planConfigs || this.orchestrator.modelPlanner.plan(perception);
        await this.emitStage({ stage: 'reasoning', status: 'start', message: `Executing ${configs.length} models in parallel...` });
        const candidates = await this.orchestrator.parallelEngine.executeAll(configs, perception);
        await this.emitStage({ stage: 'reasoning', status: 'complete', message: `Generated ${candidates.length} candidate outputs` });
        return candidates;
    }

    /**
     * Stage 3: Evaluate candidate solutions against multi-criteria matrix
     */
    evaluate(candidates: CandidateOutput[], perception: PerceptionResult): EvaluationResult[] {
        return this.orchestrator.evaluator.evaluateAll(candidates, perception);
    }

    /**
     * Stage 3.5: Run adversarial critique (Thesis-Antithesis-Judge)
     */
    async adversarialReview(candidate: CandidateOutput, perception: PerceptionResult): Promise<any> {
        await this.emitStage({ stage: 'adversarial_critique', status: 'start', message: `Conducting adversarial review on candidate [${candidate.modelId}]...` });
        const evaluations = this.evaluate([candidate], perception);
        const review = await this.orchestrator.adversarialEngine.challenge(evaluations, [candidate], perception.task);
        await this.emitStage({ stage: 'adversarial_critique', status: 'complete', message: `Surviving candidates: ${review.survivingCandidates.length}` });
        return review;
    }

    /**
     * Stage 4: Synthesize top candidates into an optimal change plan
     */
    synthesize(candidates: CandidateOutput[], evaluations?: EvaluationResult[]): SynthesisResult {
        const evals = evaluations || this.orchestrator.evaluator.evaluateAll(candidates, {
            task: '',
            goals: [],
            context: {} as any,
            memories: [],
            requiredDomains: [],
            complexity: 'simple',
            suggestedParallelCount: 1,
        });
        return this.orchestrator.synthesisEngine.synthesize(candidates, evals);
    }

    /**
     * Stage 5a: Pre-flight security & architecture audit
     */
    async audit(synthesis: SynthesisResult): Promise<AuditResult> {
        await this.emitStage({ stage: 'audit', status: 'start', message: 'Running executive security and syntax audit...' });
        const audit = await this.orchestrator.auditEngine.audit(synthesis.output);
        if (this.hooks.onAudit) {
            await this.hooks.onAudit(audit);
        }
        await this.emitStage({ stage: 'audit', status: 'complete', message: `Audit result: ${audit.passed ? 'PASSED' : 'FAILED'} (Score: ${audit.score}/100)` });
        return audit;
    }

    /**
     * Stage 5b: Apply changes to workspace filesystem
     */
    async executePlan(synthesis: SynthesisResult, options?: { dryRun?: boolean; autoCheckpoint?: boolean }): Promise<ExecutionResult> {
        const isDryRun = options?.dryRun ?? this.config.dryRun ?? false;
        if (isDryRun) {
            await this.emitStage({ stage: 'execution', status: 'skipped', message: 'Dry run enabled: Skipping filesystem modifications' });
            return {
                executed: false,
                files: [],
                errors: [],
                deleted: [],
            };
        }

        const autoCheckpoint = options?.autoCheckpoint ?? this.config.autoCheckpoint ?? true;
        if (autoCheckpoint) {
            try {
                await this.orchestrator.gitManager.preExecutionCheckpoint('Pre-Harness execution checkpoint');
            } catch (err) {
                console.warn('[HarnessAdapter] Git checkpoint failed (non-fatal):', err);
            }
        }

        await this.emitStage({ stage: 'execution', status: 'start', message: 'Executing file modifications...' });
        const result = await this.orchestrator.executor.execute(synthesis.output);
        await this.emitStage({ stage: 'execution', status: 'complete', message: `Modified ${result.files?.length || 0} files` });
        return result;
    }

    /**
     * AutoDebug: Self-healing error resolution loop
     */
    async heal(testCommand: string): Promise<AutoDebugResult> {
        await this.emitStage({ stage: 'debug_heal', status: 'start', message: `Running AutoDebug self-healing with command: "${testCommand}"` });
        const result = await this.orchestrator.autoDebug.debug(testCommand);
        await this.emitStage({
            stage: 'debug_heal',
            status: result.allFixed ? 'complete' : 'failed',
            message: result.allFixed ? 'Self-healing succeeded' : 'Self-healing could not resolve all errors',
            details: result,
        });
        return result;
    }

    /**
     * Search unified project memory, conventions, and vector store
     */
    async queryMemory(query: string): Promise<any> {
        return this.orchestrator.knowledgeStore.search(query);
    }

    /**
     * Scan active workspace structure and AST symbols
     */
    async getWorkspaceContext(): Promise<WorkspaceContext> {
        return this.orchestrator.scanner.scan();
    }

    private mapStepToStage(step: string): HarnessStageEvent['stage'] {
        const map: Record<string, HarnessStageEvent['stage']> = {
            perception: 'perception',
            reasoning: 'reasoning',
            evaluation: 'evaluation',
            critique: 'adversarial_critique',
            synthesis: 'synthesis',
            audit: 'audit',
            executing: 'execution',
            learning: 'learning',
            done: 'complete',
            error: 'error',
        };
        return map[step] || 'reasoning';
    }
}

/**
 * Convenient factory function to create a ready-to-use HarnessAdapter
 */
export function createHarnessAdapter(config?: HarnessOrchestratorConfig): HarnessAdapter {
    return new HarnessAdapter(config);
}
