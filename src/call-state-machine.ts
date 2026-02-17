import type { CallState } from "./types.js";

/**
 * Valid state transitions for a call.
 *
 * ringing -> answering -> connected -> ending -> ended
 *                                   -> hold -> connected (resume)
 *                                           -> ending -> ended
 * ringing -> ending -> ended (rejected/missed)
 * * -> failed (on error from any state except ended)
 */
const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  ringing: ["answering", "ending", "failed"],
  answering: ["connected", "ending", "failed"],
  connected: ["hold", "ending", "failed"],
  hold: ["connected", "ending", "failed"],
  ending: ["ended", "failed"],
  ended: [], // Terminal
  failed: [], // Terminal
};

export class CallStateMachine {
  private _state: CallState;
  private _history: Array<{ from: CallState; to: CallState; at: number }> = [];

  constructor(initialState: CallState = "ringing") {
    this._state = initialState;
  }

  get state(): CallState {
    return this._state;
  }

  get history(): ReadonlyArray<{ from: CallState; to: CallState; at: number }> {
    return this._history;
  }

  get isTerminal(): boolean {
    return this._state === "ended" || this._state === "failed";
  }

  canTransition(to: CallState): boolean {
    return VALID_TRANSITIONS[this._state].includes(to);
  }

  transition(to: CallState): void {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid call state transition: ${this._state} -> ${to}`);
    }
    const from = this._state;
    this._state = to;
    this._history.push({ from, to, at: Date.now() });
  }
}
