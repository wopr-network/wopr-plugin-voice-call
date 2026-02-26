import { beforeEach, describe, expect, it } from "vitest";
import {
  createVoiceSession,
  endAllVoiceSessions,
  endVoiceSession,
  getAllVoiceSessions,
  getVoiceSession,
} from "../src/voice-session.js";

describe("voice-session", () => {
  beforeEach(() => {
    endAllVoiceSessions();
  });

  it("should create a voice session", () => {
    const session = createVoiceSession("session-1", "channel-1");
    expect(session.sessionId).toBe("session-1");
    expect(session.channelId).toBe("channel-1");
    expect(session.state).toBe("idle");
  });

  it("should retrieve a session by id", () => {
    const session = createVoiceSession("session-1", "channel-1");
    const found = getVoiceSession(session.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(session.id);
  });

  it("should return undefined for unknown session", () => {
    expect(getVoiceSession("nonexistent")).toBeUndefined();
  });

  it("should end a session", () => {
    const session = createVoiceSession("session-1", "channel-1");
    const ended = endVoiceSession(session.id);
    expect(ended).toBe(true);
    expect(getVoiceSession(session.id)).toBeUndefined();
  });

  it("should return false when ending nonexistent session", () => {
    expect(endVoiceSession("nonexistent")).toBe(false);
  });

  it("should list all sessions", () => {
    createVoiceSession("s1", "c1");
    createVoiceSession("s2", "c2");
    expect(getAllVoiceSessions()).toHaveLength(2);
  });

  it("should end all sessions", () => {
    createVoiceSession("s1", "c1");
    createVoiceSession("s2", "c2");
    endAllVoiceSessions();
    expect(getAllVoiceSessions()).toHaveLength(0);
  });
});
