# wopr-plugin-voice-call

Voice call orchestration plugin for WOPR — coordinates TTS + STT for full voice conversations.

## Commands

```bash
npm run build     # tsc
npm run check     # biome check + tsc --noEmit (run before committing)
npm run format    # biome format --write src/
npm test          # vitest run
```

## Key Details

- Orchestrates TTS and STT capability providers — does NOT implement audio directly
- Requires at least one `tts` and one `stt` capability provider to be installed
- Manages the voice conversation loop: listen (STT) → process → respond (TTS)
- Plugin contract: imports only from `@wopr-network/plugin-types`

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-voice-call`.
