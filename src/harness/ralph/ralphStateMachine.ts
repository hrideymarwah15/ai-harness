/**
 * RALPH Loop State Machine
 *
 * Manages deterministic phase transitions for the RALPH autonomous loop:
 *   IDLE → REASON → PLAN → ACT → LEARN → (HEAL if needed) → back to REASON or COMPLETE
 *
 * Valid transitions:
 *   IDLE     → REASON
 *   REASON   → PLAN | COMPLETE | ABORTED
 *   PLAN     → ACT | COMPLETE | ABORTED
 *   ACT      → LEARN | HEAL | ABORTED
 *   LEARN    → REASON | PLAN | COMPLETE | ABORTED
 *   HEAL     → ACT | LEARN | ABORTED
 *   COMPLETE → (terminal)
 *   ABORTED  → (terminal)
 */

import { RalphPhase, RalphTransition } from './types';

const VALID_TRANSITIONS: Record<RalphPhase, RalphPhase[]> = {
    IDLE:     ['REASON'],
    REASON:   ['PLAN', 'COMPLETE', 'ABORTED'],
    PLAN:     ['ACT', 'COMPLETE', 'ABORTED'],
    ACT:      ['LEARN', 'HEAL', 'ABORTED'],
    LEARN:    ['REASON', 'PLAN', 'COMPLETE', 'ABORTED'],
    HEAL:     ['ACT', 'LEARN', 'ABORTED'],
    COMPLETE: [],
    ABORTED:  [],
};

export type RalphTransitionListener = (transition: RalphTransition) => void;

export class RalphStateMachine {
    private _phase: RalphPhase;
    private _transitions: RalphTransition[] = [];
    private _iteration: number = 0;
    private _listeners: RalphTransitionListener[] = [];

    constructor(initialPhase: RalphPhase = 'IDLE') {
        this._phase = initialPhase;
    }

    get phase(): RalphPhase {
        return this._phase;
    }

    get transitions(): RalphTransition[] {
        return [...this._transitions];
    }

    get iteration(): number {
        return this._iteration;
    }

    set iteration(value: number) {
        this._iteration = value;
    }

    /**
     * Register a listener for phase transitions
     */
    onTransition(listener: RalphTransitionListener): void {
        this._listeners.push(listener);
    }

    /**
     * Check if a transition to the target phase is valid
     */
    canTransitionTo(target: RalphPhase): boolean {
        const allowed = VALID_TRANSITIONS[this._phase];
        return allowed?.includes(target) ?? false;
    }

    /**
     * Transition to a new phase. Throws if the transition is invalid.
     */
    transition(to: RalphPhase, reason: string): void {
        if (!this.canTransitionTo(to)) {
            throw new Error(
                `[RALPH StateMachine] Invalid transition: ${this._phase} → ${to}. ` +
                `Valid targets from ${this._phase}: [${VALID_TRANSITIONS[this._phase].join(', ')}]`
            );
        }

        const record: RalphTransition = {
            from: this._phase,
            to,
            reason,
            iteration: this._iteration,
            timestamp: Date.now(),
        };

        this._transitions.push(record);
        this._phase = to;

        // Notify listeners
        for (const listener of this._listeners) {
            try {
                listener(record);
            } catch (err) {
                console.warn('[RALPH StateMachine] Listener error:', err);
            }
        }
    }

    /**
     * Check if the loop is in a terminal state
     */
    isTerminal(): boolean {
        return this._phase === 'COMPLETE' || this._phase === 'ABORTED';
    }

    /**
     * Reset the state machine for a new task
     */
    reset(): void {
        this._phase = 'IDLE';
        this._transitions = [];
        this._iteration = 0;
    }

    /**
     * Get a summary of the transition history
     */
    getSummary(): string {
        if (this._transitions.length === 0) return `Phase: ${this._phase} (no transitions)`;
        const trail = this._transitions.map(t => `${t.from}→${t.to}`).join(' | ');
        return `Phase: ${this._phase} | Trail: ${trail}`;
    }
}
