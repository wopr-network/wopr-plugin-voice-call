# wopr-plugin-voice-call

Voice call orchestration plugin for WOPR — coordinates TTS + STT for full voice conversations.

## Commands

```bash
npm run build     # tsc
npm run check     # biome check + tsc --noEmit (run before committing)
npm run lint:fix  # biome check --fix src/
npm run format    # biome format --write src/
npm test          # vitest run
```

## Architecture

```
src/
  index.ts          # Plugin entry — default WOPRPlugin export, orchestration
  types.ts          # Re-exports from plugin-types + local types
  voice-session.ts  # Voice session state management
  logger.ts         # Winston logger instance
tests/
  index.test.ts         # Plugin lifecycle tests
  voice-session.test.ts # Session management tests
```

## Key Details

- Orchestrates TTS and STT capability providers — does NOT implement audio directly
- Requires at least one `tts` and one `stt` capability provider to be installed
- Manages the voice conversation loop: listen (STT) → process → respond (TTS)
- Implements `ChannelProvider` (voice-call IS a channel)
- Registers A2A tools for voice session control

## Plugin Contract

Imports only from `@wopr-network/plugin-types`. Never import from `@wopr-network/wopr` core.

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-voice-call`.
