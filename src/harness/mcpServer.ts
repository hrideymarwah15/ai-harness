import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { HarnessAdapter } from './harnessAdapter';
import { HarnessOrchestratorConfig } from './types';

const TOOLS: Tool[] = [
    {
        name: 'coteam_orchestrate',
        description: 'Execute an autonomous multi-agent software engineering task across the 6-stage Co-Team pipeline (Perception -> Parallel Reasoning -> Evaluation -> Adversarial Critique -> Synthesis -> Verification & Execution -> Self-Healing).',
        inputSchema: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'The task description, engineering requirement, or bugfix goal.',
                },
                mode: {
                    type: 'string',
                    enum: ['turbo', 'balanced', 'full', 'free', 'local'],
                    description: 'Operating mode: turbo (<5s single pass), balanced (smart router), full (multi-agent council + adversarial), free (zero-cost models), local (Ollama offline).',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, simulates execution, generates plan and code diffs without modifying files on disk.',
                },
            },
            required: ['task'],
        },
    },
    {
        name: 'coteam_plan',
        description: 'Analyze the workspace, extract active symbols, classify complexity, and generate a decomposed multi-agent execution plan.',
        inputSchema: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'The task or engineering goal to plan.',
                },
            },
            required: ['task'],
        },
    },
    {
        name: 'coteam_review_and_critique',
        description: 'Run adversarial thesis-antithesis-judge critique and executive security/syntax audit on proposed code.',
        inputSchema: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'Source code or diff to evaluate.',
                },
                context: {
                    type: 'string',
                    description: 'Additional task or architectural context for the review.',
                },
            },
            required: ['code'],
        },
    },
    {
        name: 'coteam_auto_heal',
        description: 'Run self-healing compiler/test diagnostic loop: parses test or build failures, synthesizes targeted diff patches, and applies fixes iteratively.',
        inputSchema: {
            type: 'object',
            properties: {
                testCommand: {
                    type: 'string',
                    description: 'The test or build command to run and verify (e.g. "npm test", "npm run build").',
                },
            },
            required: ['testCommand'],
        },
    },
    {
        name: 'coteam_memory_query',
        description: 'Query Co-Team unified memory, project conventions, architectural decisions, and indexed code symbols.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search phrase or question regarding project context or conventions.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'coteam_workspace_status',
        description: 'Retrieve current workspace structure, language breakdown, and active configuration settings.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'coteam_ralph',
        description: 'Execute an autonomous RALPH loop (Reason → Act → Learn → Plan → Heal). Iteratively reasons about the task, builds and executes a plan, extracts insights, and self-heals on failure. Routes coding tasks to the Forge deterministic pipeline automatically.',
        inputSchema: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'The task description, engineering requirement, or goal.',
                },
                testCommand: {
                    type: 'string',
                    description: 'Test or build command for verification (e.g. "npm test").',
                },
                acceptanceCriteria: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of acceptance criteria that must be met for completion.',
                },
                maxIterations: {
                    type: 'number',
                    description: 'Maximum RALPH loop iterations (default: 5).',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, reason and plan without modifying files.',
                },
            },
            required: ['task'],
        },
    },
];

export class OrchestratorMcpServer {
    private server: Server;
    private adapter: HarnessAdapter;

    constructor(config: HarnessOrchestratorConfig = {}) {
        this.adapter = new HarnessAdapter(config);
        this.server = new Server(
            {
                name: 'coteam-orchestrator',
                version: '0.5.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            },
        );

        this.registerHandlers();
    }

    private registerHandlers(): void {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return { tools: TOOLS };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                switch (name) {
                    case 'coteam_orchestrate': {
                        const task = String(args?.task || '');
                        const mode = args?.mode as any;
                        const dryRun = Boolean(args?.dryRun);

                        const result = await this.adapter.execute({
                            goal: task,
                            mode,
                            dryRun,
                        });

                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
                        };
                    }

                    case 'coteam_plan': {
                        const task = String(args?.task || '');
                        const perception = await this.adapter.perceive(task);
                        const plan = this.adapter.plan(perception);

                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(
                                        {
                                            complexity: perception.complexity,
                                            goals: perception.goals,
                                            plans: plan,
                                        },
                                        null,
                                        2,
                                    ),
                                },
                            ],
                        };
                    }

                    case 'coteam_review_and_critique': {
                        const code = String(args?.code || '');
                        const context = String(args?.context || '');

                        const critiqueResult = this.adapter.orchestrator.codeCritic.analyze(code, 'typescript');
                        const audit = await this.adapter.orchestrator.auditEngine.audit(code);

                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(
                                        {
                                            critique: critiqueResult,
                                            audit,
                                        },
                                        null,
                                        2,
                                    ),
                                },
                            ],
                        };
                    }

                    case 'coteam_auto_heal': {
                        const testCommand = String(args?.testCommand || 'npm test');
                        const healResult = await this.adapter.heal(testCommand);

                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(healResult, null, 2),
                                },
                            ],
                        };
                    }

                    case 'coteam_memory_query': {
                        const query = String(args?.query || '');
                        const results = await this.adapter.queryMemory(query);

                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(results, null, 2),
                                },
                            ],
                        };
                    }

                    case 'coteam_workspace_status': {
                        const context = await this.adapter.getWorkspaceContext();
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(
                                        {
                                            rootPath: context.rootPath,
                                            projectType: context.projectType,
                                            languages: context.languages,
                                            filesCount: context.relevantFiles.length,
                                            mode: this.adapter.orchestrator.router.getMode(),
                                        },
                                        null,
                                        2,
                                    ),
                                },
                            ],
                        };
                    }

                    case 'coteam_ralph': {
                        const task = String(args?.task || '');
                        const testCommand = args?.testCommand ? String(args.testCommand) : undefined;
                        const acceptanceCriteria = Array.isArray(args?.acceptanceCriteria)
                            ? (args.acceptanceCriteria as string[])
                            : undefined;
                        const maxIterations = typeof args?.maxIterations === 'number' ? args.maxIterations : 5;
                        const dryRun = Boolean(args?.dryRun);

                        const { createRalphEngine } = await import('./ralph/index.js');
                        const ralph = createRalphEngine({
                            workspaceRoot: this.adapter.config.workspaceRoot,
                            mode: this.adapter.config.mode,
                            maxIterations,
                            dryRun,
                            autoHeal: true,
                            autoCheckpoint: true,
                        });

                        // Re-use the adapter's orchestrator to avoid double-initialization
                        ralph.orchestrator = this.adapter.orchestrator;

                        const report = await ralph.execute({
                            id: `mcp_ralph_${Date.now()}`,
                            goal: task,
                            testCommand,
                            acceptanceCriteria,
                            maxIterations,
                            dryRun,
                            autoHeal: true,
                        });

                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(report, null, 2),
                                },
                            ],
                        };
                    }

                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (err: any) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Error executing ${name}: ${err.message || String(err)}`,
                        },
                    ],
                };
            }
        });
    }

    /**
     * Start the MCP server using stdio transport
     */
    async startStdio(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
}

export async function startOrchestratorMcpServer(config?: HarnessOrchestratorConfig): Promise<OrchestratorMcpServer> {
    const server = new OrchestratorMcpServer(config);
    await server.startStdio();
    return server;
}
