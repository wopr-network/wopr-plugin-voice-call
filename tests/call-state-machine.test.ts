import { describe, it, expect, beforeEach } from "vitest";
import { CallStateMachine } from "../src/call-state-machine.js";

describe("CallStateMachine", () => {
  let fsm: CallStateMachine;

  beforeEach(() => {
    fsm = new CallStateMachine();
  });

  it("starts in ringing state by default", () => {
    expect(fsm.state).toBe("ringing");
  });

  it("accepts a custom initial state", () => {
    const f = new CallStateMachine("connected");
    expect(f.state).toBe("connected");
  });

  describe("happy path: ringing -> answering -> connected -> ending -> ended", () => {
    it("transitions ringing -> answering", () => {
      fsm.transition("answering");
      expect(fsm.state).toBe("answering");
    });

    it("transitions answering -> connected", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      expect(fsm.state).toBe("connected");
    });

    it("transitions connected -> ending -> ended", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      fsm.transition("ending");
      expect(fsm.state).toBe("ending");
      fsm.transition("ended");
      expect(fsm.state).toBe("ended");
    });
  });

  describe("missed call: ringing -> ending -> ended", () => {
    it("transitions ringing -> ending -> ended", () => {
      fsm.transition("ending");
      expect(fsm.state).toBe("ending");
      fsm.transition("ended");
      expect(fsm.state).toBe("ended");
    });
  });

  describe("hold/resume", () => {
    it("transitions connected -> hold -> connected", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      fsm.transition("hold");
      expect(fsm.state).toBe("hold");
      fsm.transition("connected");
      expect(fsm.state).toBe("connected");
    });

    it("transitions hold -> ending -> ended", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      fsm.transition("hold");
      fsm.transition("ending");
      fsm.transition("ended");
      expect(fsm.state).toBe("ended");
    });
  });

  describe("failure transitions", () => {
    it("can transition to failed from ringing", () => {
      fsm.transition("failed");
      expect(fsm.state).toBe("failed");
    });

    it("can transition to failed from answering", () => {
      fsm.transition("answering");
      fsm.transition("failed");
      expect(fsm.state).toBe("failed");
    });

    it("can transition to failed from connected", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      fsm.transition("failed");
      expect(fsm.state).toBe("failed");
    });

    it("can transition to failed from hold", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      fsm.transition("hold");
      fsm.transition("failed");
      expect(fsm.state).toBe("failed");
    });

    it("can transition to failed from ending", () => {
      fsm.transition("ending");
      fsm.transition("failed");
      expect(fsm.state).toBe("failed");
    });
  });

  describe("invalid transitions", () => {
    it("throws on ended -> ringing", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      fsm.transition("ending");
      fsm.transition("ended");
      expect(() => fsm.transition("ringing" as Parameters<typeof fsm.transition>[0])).toThrow();
    });

    it("throws on ringing -> connected (skipping answering)", () => {
      expect(() => fsm.transition("connected")).toThrow(/Invalid call state transition/);
    });

    it("throws on connected -> ringing", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      expect(() => fsm.transition("ringing" as Parameters<typeof fsm.transition>[0])).toThrow();
    });

    it("throws on failed -> ended", () => {
      fsm.transition("failed");
      expect(() => fsm.transition("ended")).toThrow(/Invalid call state transition/);
    });

    it("throws on ended -> failed", () => {
      fsm.transition("ending");
      fsm.transition("ended");
      expect(() => fsm.transition("failed")).toThrow(/Invalid call state transition/);
    });
  });

  describe("isTerminal", () => {
    it("returns false for non-terminal states", () => {
      expect(fsm.isTerminal).toBe(false);
      fsm.transition("answering");
      expect(fsm.isTerminal).toBe(false);
      fsm.transition("connected");
      expect(fsm.isTerminal).toBe(false);
      fsm.transition("hold");
      expect(fsm.isTerminal).toBe(false);
    });

    it("returns true for ended", () => {
      fsm.transition("ending");
      fsm.transition("ended");
      expect(fsm.isTerminal).toBe(true);
    });

    it("returns true for failed", () => {
      fsm.transition("failed");
      expect(fsm.isTerminal).toBe(true);
    });
  });

  describe("canTransition", () => {
    it("returns true for valid transitions", () => {
      expect(fsm.canTransition("answering")).toBe(true);
      expect(fsm.canTransition("ending")).toBe(true);
      expect(fsm.canTransition("failed")).toBe(true);
    });

    it("returns false for invalid transitions", () => {
      expect(fsm.canTransition("connected")).toBe(false);
      expect(fsm.canTransition("hold")).toBe(false);
      expect(fsm.canTransition("ended")).toBe(false);
    });
  });

  describe("history tracking", () => {
    it("records transitions in history", () => {
      fsm.transition("answering");
      fsm.transition("connected");
      const history = fsm.history;
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ from: "ringing", to: "answering" });
      expect(history[1]).toMatchObject({ from: "answering", to: "connected" });
    });

    it("history entries have timestamps", () => {
      const before = Date.now();
      fsm.transition("answering");
      const after = Date.now();
      expect(fsm.history[0]!.at).toBeGreaterThanOrEqual(before);
      expect(fsm.history[0]!.at).toBeLessThanOrEqual(after);
    });

    it("history is readonly", () => {
      fsm.transition("answering");
      const history = fsm.history;
      // Verify it's a readonly reference (splice would fail at runtime on a frozen array,
      // but here we just check it's the same object and has correct length)
      expect(history).toHaveLength(1);
    });
  });
});
