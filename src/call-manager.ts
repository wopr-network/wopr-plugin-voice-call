import { randomUUID } from "node:crypto";
import { AudioBridge } from "./audio-bridge.js";
import { CallStateMachine } from "./call-state-machine.js";
import { logger } from "./logger.js";
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

  constructor(ctx: WOPRPluginContext, config: VoiceCallPluginConfig) {
    this.ctx = ctx;
    this.config = config;
    this.maxConcurrent = config.maxConcurrentCalls || 10;
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
      onCallEnd: () => {
        void this.endCall(callControlId, "hangup");
      },
      getSTT: () => this.ctx.getSTT(),
      getTTS: () => this.ctx.getTTS(),
    });

    const activeCall = { record, fsm, bridge };
    this.activeCalls.set(callControlId, activeCall);

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
      onCallEnd: () => {
        void this.endCall(telnyxResult.callControlId, "hangup");
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
    call.fsm.transition(newState);
    call.record.state = call.fsm.state;

    if (newState === "connected" && !call.record.connectedAt) {
      call.record.connectedAt = Date.now();
    }
  }

  /** End a call and clean up */
  async endCall(callControlId: string, reason: string): Promise<void> {
    const call = this.activeCalls.get(callControlId);
    if (!call) return;

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

    // Remove from active map
    this.activeCalls.delete(callControlId);
    logger.info({ msg: "Call ended", callId: call.record.id, reason, durationMs: call.record.durationMs });
  }

  /** Shut down all active calls */
  async shutdownAll(): Promise<void> {
    const ids = Array.from(this.activeCalls.keys());
    await Promise.all(ids.map((id) => this.endCall(id, "shutdown")));
  }
}
