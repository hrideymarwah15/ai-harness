/**
 * AI Agent Benchmark Suite
 * 
 * Runs a suite of coding tasks against an agent runtime to measure performance,
 * token efficiency, and autonomous success rates. Similar to SWE-bench.
 */

import { BenchmarkTask, BenchmarkRunResult, BenchmarkTaskResult, HarnessComparison, CustomAgentDefinition } from './types';
import { AgentRuntime } from './agentRuntime';

export class BenchmarkSuite {
    private id: string;
    private tasks: BenchmarkTask[];

    constructor(id: string, tasks: BenchmarkTask[]) {
        this.id = id;
        this.tasks = tasks;
    }

    /**
     * Run the benchmark suite against a specific agent
     */
    async evaluateAgent(agentDef: CustomAgentDefinition, workspaceRoot: string): Promise<BenchmarkRunResult> {
        console.log(`\n🚀 Starting Benchmark Suite [${this.id}] for Agent [${agentDef.id}]`);
        
        const results: BenchmarkTaskResult[] = [];
        let passed = 0;
        let failed = 0;
        let totalDuration = 0;
        let totalTokens = 0;

        for (const task of this.tasks) {
            console.log(`\n  ▶ Running Task [${task.id}]: ${task.description}`);
            try {
                const request = {
                    goal: task.description,
                    testCommand: task.testCommand,
                    // Benchmarks strictly enforce test passing
                    acceptanceCriteria: ['All tests pass automatically'],
                };
                
                const runtime = new AgentRuntime(agentDef, workspaceRoot, request);
                const result = await runtime.execute(request);

                results.push({
                    taskId: task.id,
                    success: result.success,
                    durationMs: result.metrics.durationMs,
                    tokens: result.metrics.totalTokens,
                    metrics: result.metrics
                });

                if (result.success) passed++; else failed++;
                totalDuration += result.metrics.durationMs;
                totalTokens += (result.metrics.totalTokens.input + result.metrics.totalTokens.output);

                console.log(`  └─ Result: ${result.success ? '✅ PASS' : '❌ FAIL'} (${(result.metrics.durationMs / 1000).toFixed(1)}s)`);

            } catch (err: any) {
                console.log(`  └─ Result: 💥 ERROR (${err.message})`);
                results.push({
                    taskId: task.id,
                    success: false,
                    durationMs: 0,
                    tokens: { input: 0, output: 0, copilotTokens: 0, freeTokens: 0, localTokens: 0, calls: 0, totalLatencyMs: 0, totalCostUsd: 0 },
                    error: err.message,
                    metrics: {
                        durationMs: 0, totalTokens: { input: 0, output: 0, copilotTokens: 0, freeTokens: 0, localTokens: 0, calls: 0, totalLatencyMs: 0, totalCostUsd: 0 },
                        iterations: 0, filesModified: 0, healAttempts: 0, successfulHeals: 0, qualityScore: 0
                    }
                });
                failed++;
            }
        }

        const scorePercent = this.tasks.length > 0 ? (passed / this.tasks.length) * 100 : 0;
        const avgTokens = this.tasks.length > 0 ? totalTokens / this.tasks.length : 0;

        const report: BenchmarkRunResult = {
            benchmarkId: this.id,
            agentId: agentDef.id,
            timestamp: Date.now(),
            tasksTotal: this.tasks.length,
            tasksPassed: passed,
            tasksFailed: failed,
            totalDurationMs: totalDuration,
            averageTokensPerTask: avgTokens,
            scorePercent,
            taskResults: results
        };

        this.printReport(report);
        return report;
    }

    /**
     * Compare this harness run to recorded external harness benchmarks
     */
    compareWith(runResult: BenchmarkRunResult, otherHarnesses: HarnessComparison[]): void {
        console.log(`\n🏆 Benchmark Comparison Report: ${this.id}`);
        console.log('──────────────────────────────────────────────────');
        
        const all = [
            { harnessName: `Co-Team Agent (${runResult.agentId})`, scorePercent: runResult.scorePercent, averageTokens: runResult.averageTokensPerTask, averageDurationMs: runResult.totalDurationMs / (runResult.tasksTotal || 1) },
            ...otherHarnesses
        ].sort((a, b) => b.scorePercent - a.scorePercent);

        all.forEach((h, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
            console.log(`${medal} ${h.harnessName.padEnd(30)} | Score: ${h.scorePercent.toFixed(1)}% | Avg Tokens: ${Math.round(h.averageTokens)} | Avg Time: ${(h.averageDurationMs/1000).toFixed(1)}s`);
        });
        console.log('──────────────────────────────────────────────────\n');
    }

    private printReport(report: BenchmarkRunResult) {
        console.log(`\n📊 Benchmark Complete: ${report.agentId} on ${report.benchmarkId}`);
        console.log(`   Tasks: ${report.tasksPassed}/${report.tasksTotal} (${report.scorePercent.toFixed(1)}%)`);
        console.log(`   Total Time: ${(report.totalDurationMs / 1000).toFixed(1)}s`);
        console.log(`   Avg Tokens/Task: ${Math.round(report.averageTokensPerTask)}`);
    }
}
