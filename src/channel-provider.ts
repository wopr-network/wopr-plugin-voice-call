import { logger } from "./logger.js";
import type { ChannelCommand, ChannelMessageParser, ChannelProvider } from "./types.js";

const registeredCommands = new Map<string, ChannelCommand>();
const registeredParsers = new Map<string, ChannelMessageParser>();

export const voiceCallChannelProvider: ChannelProvider = {
  id: "voice-call",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name, cmd);
    logger.info({ msg: "Channel command registered", name: cmd.name });
  },
  unregisterCommand(name: string): void {
    registeredCommands.delete(name);
  },
  getCommands(): ChannelCommand[] {
    return Array.from(registeredCommands.values());
  },

  addMessageParser(parser: ChannelMessageParser): void {
    registeredParsers.set(parser.id, parser);
  },
  removeMessageParser(id: string): void {
    registeredParsers.delete(id);
  },
  getMessageParsers(): ChannelMessageParser[] {
    return Array.from(registeredParsers.values());
  },

  async send(_channelId: string, _content: string): Promise<void> {
    // For voice-call channel, "sending" a message means queueing TTS playback
    // on the active call. This is handled by the AudioBridge, not here.
    // This method exists for ChannelProvider interface compliance.
    logger.debug({ msg: "send() called on voice-call provider — TTS playback is handled by AudioBridge" });
  },

  getBotUsername(): string {
    return "voice-call";
  },
};
