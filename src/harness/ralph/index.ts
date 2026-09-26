/**
 * RALPH Loop — Autonomous AI Harness Module
 *
 * RALPH: Reason → Act → Learn → Plan → Heal
 *
 * Exposes the complete RALPH loop API for integration with any external
 * AI harness, agent framework, CLI, or MCP client.
 */

// Core engine
export { RalphLoopEngine, createRalphEngine } from './ralphEngine';

// State machine
export { RalphStateMachine } from './ralphStateMachine';
export type { RalphTransitionListener } from './ralphStateMachine';

// Types
export type {
    // Loop phases and actions
    RalphPhase,
    RalphActionType,

    // Task definition
    RalphTask,
    RalphSubtask,

    // Loop state
    RalphLoopState,

    // REASON phase
    RalphHypothesis,
    RalphEvidence,

    // PLAN phase
    RalphExecutionPlan,
    RalphPlanStep,

    // ACT phase
    RalphActionResult,

    // LEARN phase
    RalphInsight,

    // HEAL phase
    RalphHealAttempt,

    // Events
    RalphEventType,
    RalphEvent,
    RalphEventListener,

    // Configuration & Hooks
    RalphConfig,
    RalphHooks,

    // Report
    RalphReport,

    // Transitions
    RalphTransition,
} from './types';
