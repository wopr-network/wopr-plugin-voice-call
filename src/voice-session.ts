import { randomUUID } from "node:crypto";
import type { VoiceSession } from "./types.js";

const sessions = new Map<string, VoiceSession>();

export function createVoiceSession(sessionId: string, channelId: string): VoiceSession {
  const now = Date.now();
  const session: VoiceSession = {
    id: randomUUID(),
    sessionId,
    channelId,
    state: "idle",
    startedAt: now,
    lastActivityAt: now,
  };
  sessions.set(session.id, session);
  return session;
}

export function getVoiceSession(id: string): VoiceSession | undefined {
  return sessions.get(id);
}

export function endVoiceSession(id: string): boolean {
  return sessions.delete(id);
}

export function getAllVoiceSessions(): VoiceSession[] {
  return Array.from(sessions.values());
}

export function endAllVoiceSessions(): void {
  sessions.clear();
}
