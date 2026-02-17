import { randomUUID } from "node:crypto";
import { AudioBridge } from "./audio-bridge.js";
import { CallStateMachine } from "./call-state-machine.js";
import { logger } from "./logger.js";
import type { TelnyxClient } from "./telnyx-client.js";
import type { CallRecord, CallState, VoiceCallPluginConfig, WOPRPluginContext } from "./types.js";

interface ActiveCall {
  record: CallRecord;
  fsm: CallStateMachine;
  bridge: AudioBridge;
}

export class CallManager {
  private activeCalls = new Map<string, ActiveCall>(); // callControlId -> ActiveCall
  private maxConcurrent: number;
  private ctx: WOPRPluginContext;
  private config: VoiceCallPluginConfig;
  private telnyxClient: TelnyxClient | null;

  constructor(ctx: WOPRPluginContext, config: VoiceCallPluginConfig, telnyxClient?: TelnyxClient) {
    this.ctx = ctx;
    this.config = config;
    this.maxConcurrent = config.maxConcurrentCalls || 10;
    this.telnyxClient = telnyxClient || null;
  }

  get activeCallCount(): number {
    return this.activeCalls.size;
  }

  canAcceptCall(): boolean {
    return this.activeCalls.size < this.maxConcurrent;
  }

  /** Register a new inbound call */
  async registerInboundCall(
    callControlId: string,
    callLegId: string,
    from: string,
    to: string,
    tenantId: string,
  ): Promise<ActiveCall | null> {
    if (!this.canAcceptCall()) {
      logger.warn({ msg: "Max concurrent calls reached, rejecting", callControlId });
      return null;
    }

    const callId = randomUUID();
    const sessionId = `voice-call-${callId}`;

    const record: CallRecord = {
      id: callId,
      telnyxCallControlId: callControlId,
      telnyxCallLegId: callLegId,
      direction: "inbound",
      from,
      to,
      tenantId,
      sessionId,
      state: "ringing",
      startedAt: Date.now(),
      recording: this.config.recordByDefault || false,
    };

    const fsm = new CallStateMachine("ringing");

    const bridge = new AudioBridge({
      onTranscript: async (text: string) => {
        const response = await this.ctx.inject(sessionId, text, {
          from: `phone:${from}`,
          channel: { type: "voice-call", id: callControlId, name: from },
        });
        return response;
      },
      // When the media WS closes, Telnyx has already hung up — skip redundant hangup
      onCallEnd: () => {
        void this.endCall(callControlId, "hangup", true);
      },
      getSTT: () => this.ctx.getSTT(),
      getTTS: () => this.ctx.getTTS(),
    });

    const activeCall = { record, fsm, bridge };
    this.activeCalls.set(callControlId, activeCall);

    try {
      // Persist call record to storage
      const repo = this.ctx.storage.getRepository<Record<string, unknown>>("voice_call", "calls");
      await repo.insert(record as unknown as Record<string, unknown>);

      // Emit event
      await this.ctx.events.emitCustom("voice-call:started", {
        callId,
        direction: "inbound",
        from,
        to,
      });
    } catch (err) {
      // Clean up the orphaned ActiveCall+bridge on failure
      this.activeCalls.delete(callControlId);
      await bridge.cleanup().catch(() => {});
      logger.error({ msg: "Failed to register inbound call, cleaning up", callId, error: String(err) });
      return null;
    }

    logger.info({ msg: "Inbound call registered", callId, from, to });
    return activeCall;
  }

  /** Register and initiate an outbound call */
  async initiateOutboundCall(
    to: string,
    from: string,
    tenantId: string,
    telnyxResult: { callControlId: string; callLegId: string; callSessionId: string },
  ): Promise<ActiveCall> {
    if (!this.canAcceptCall()) {
      throw new Error(`Max concurrent calls (${this.maxConcurrent}) reached, cannot initiate outbound call`);
    }

    const callId = randomUUID();
    const sessionId = `voice-call-${callId}`;

    const record: CallRecord = {
      id: callId,
      telnyxCallControlId: telnyxResult.callControlId,
      telnyxCallLegId: telnyxResult.callLegId,
      direction: "outbound",
      from,
      to,
      tenantId,
      sessionId,
      state: "ringing",
      startedAt: Date.now(),
      recording: this.config.recordByDefault || false,
    };

    const fsm = new CallStateMachine("ringing");

    const bridge = new AudioBridge({
      onTranscript: async (text: string) => {
        const response = await this.ctx.inject(sessionId, text, {
          from: `phone:${to}`,
          channel: { type: "voice-call", id: telnyxResult.callControlId, name: to },
        });
        return response;
      },
      // When the media WS closes, Telnyx has already hung up — skip redundant hangup
      onCallEnd: () => {
        void this.endCall(telnyxResult.callControlId, "hangup", true);
      },
      getSTT: () => this.ctx.getSTT(),
      getTTS: () => this.ctx.getTTS(),
    });

    const activeCall = { record, fsm, bridge };
    this.activeCalls.set(telnyxResult.callControlId, activeCall);

    const repo = this.ctx.storage.getRepository<Record<string, unknown>>("voice_call", "calls");
    await repo.insert(record as unknown as Record<string, unknown>);

    await this.ctx.events.emitCustom("voice-call:started", {
      callId,
      direction: "outbound",
      from,
      to,
    });

    return activeCall;
  }

  /** Get an active call by callControlId */
  getCall(callControlId: string): ActiveCall | undefined {
    return this.activeCalls.get(callControlId);
  }

  /** Transition call state */
  transitionCall(callControlId: string, newState: Exclude<CallState, "ringing">): void {
    const call = this.activeCalls.get(callControlId);
    if (!call) return;
    if (!call.fsm.canTransition(newState)) {
      logger.warn({ msg: "Invalid call state transition, skipping", from: call.fsm.state, to: newState, callControlId });
      return;
    }
    call.fsm.transition(newState);
    call.record.state = call.fsm.state;

    if (newState === "connected" && !call.record.connectedAt) {
      call.record.connectedAt = Date.now();
    }
  }

  /** End a call and clean up.
   *
   * @param callControlId - Telnyx call control ID
   * @param reason - Why the call ended ("hangup", "timeout", "error", etc.)
   * @param skipTelnyxHangup - Set true when the termination was triggered by a Telnyx
   *   webhook (call.hangup) to avoid sending a redundant hangup back to Telnyx.
   *   When false (the default), a hangup is sent to Telnyx before removing the call
   *   from the active map so the call is never lost while still active on Telnyx.
   */
  async endCall(callControlId: string, reason: string, skipTelnyxHangup = false): Promise<void> {
    const call = this.activeCalls.get(callControlId);
    if (!call) return;

    // Idempotence guard: remove from map immediately so concurrent calls (e.g.,
    // hangup webhook + bridge WS close) don't both process the same call.
    this.activeCalls.delete(callControlId);

    // Transition to ended if not already terminal
    if (!call.fsm.isTerminal) {
      if (call.fsm.canTransition("ending")) {
        call.fsm.transition("ending");
      }
      if (call.fsm.canTransition("ended")) {
        call.fsm.transition("ended");
      }
    }

    call.record.state = call.fsm.state;
    call.record.endedAt = Date.now();
    call.record.endReason = reason;
    call.record.durationMs = call.record.connectedAt ? call.record.endedAt - call.record.connectedAt : 0;

    // If the call is being ended programmatically (not by a Telnyx hangup webhook),
    // tell Telnyx to hang up first. The call must remain in activeCalls until this
    // succeeds so it is never "lost" (tracked here but still active on Telnyx).
    if (!skipTelnyxHangup && this.telnyxClient) {
      await this.telnyxClient.hangup(callControlId).catch((err) => {
        logger.warn({ msg: "Telnyx hangup failed during endCall", callControlId, error: String(err) });
      });
    }

    // Clean up audio bridge
    await call.bridge.cleanup();

    // Update storage
    const repo = this.ctx.storage.getRepository<Record<string, unknown>>("voice_call", "calls");
    await repo.update(call.record.id, {
      state: call.record.state,
      endedAt: call.record.endedAt,
      endReason: call.record.endReason,
      durationMs: call.record.durationMs,
    });

    // Emit usage event for metering (duration in seconds)
    const durationSec = Math.ceil((call.record.durationMs || 0) / 1000);
    await this.ctx.events.emitCustom("voice-call:ended", {
      callId: call.record.id,
      direction: call.record.direction,
      from: call.record.from,
      to: call.record.to,
      durationMs: call.record.durationMs,
      durationSec,
      reason,
    });

    logger.info({ msg: "Call ended", callId: call.record.id, reason, durationMs: call.record.durationMs });
  }

  /** Shut down all active calls */
  async shutdownAll(): Promise<void> {
    const ids = Array.from(this.activeCalls.keys());
    await Promise.all(ids.map((id) => this.endCall(id, "shutdown")));
  }
}
