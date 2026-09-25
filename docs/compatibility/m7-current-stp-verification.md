# M7 Current Safari Technology Preview Compatibility Verification

## Environment

- **macOS**: macOS 27.2 (Build 26B5091g)
- **Safari Technology Preview**: Release 253
- **STP Build**: 27.0 (CFBundleVersion 22626.1.8.19.2)
- **WebKit Revision**: 320113@main...321067@main
- **Audit Date**: 2026-09-25
- **Glint Commit**: c07feaaee76cc1ee6ab4a2a2b5463c2be532b264
- **Glint Version**: 1.2.0

---

## Automated Tests

- **Test Count**: 475 total
- **Result**: 475 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo (Duration: ~45.7s)
- **TypeScript Check**: PASS (0 errors via `tsc --noEmit`)
- **Safari Production Build**: PASS (`.output/safari-mv3`, 5.66 MB total, manifest version: 1.2.0)

---

## STP Regression Matrix

| Area | Result | Evidence | Notes |
| :--- | :---: | :--- | :--- |
| **MV3** | **PASS** | `pnpm run build:safari` generates clean MV3 bundle; `.output/safari-mv3/manifest.json` matches WXT spec | Manifest V3 background service worker, options page, popup, and content script operate cleanly. Offscreen API added in STP 253 is not required. |
| **Permissions** | **PASS** | `tests/provider-network.test.ts` (Permission-01 ~ Permission-06) | Synchronous user gesture flow preserved (`browser.permissions.request`); optional origin permissions requested per-provider; unconfigured origins revoked on key deletion. |
| **Service Worker** | **PASS** | `tests/ai-port.test.ts`, background message/port dispatcher | Service worker handles `runtime.connect` port streaming and `runtime.sendMessage` dict lookup without disconnect drops. |
| **Highlight** | **PASS** | `tests/highlight.test.ts`, `tests/hover-card.test.ts` | Native `CSS.highlights` paints `glint-mark` with `Highlight(...ranges)`; zero span-per-match injection; WebKit Release 253 Range sharing bugfix (320355@main) confirmed beneficial. |
| **MutationObserver** | **PASS** | `tests/dynamic-web.test.ts` (DW-01 ~ DW-14), `tests/boundary-audit.test.ts` | 40ms batched debounce; extension container subtree excluded from loops; dirty text node and subtree containment pruning active; >250 records fallback tested. |
| **Shadow DOM** | **PASS** | `tests/boundary-audit.test.ts` (BOUNDARY-DW-01 ~ 06) | Extension container mounts into body; third-party open/closed ShadowRoots remain unpierced; tree walker boundaries preserved. |
| **iframe** | **PASS** | `tests/boundary-audit.test.ts` (BOUNDARY-DW-07, 11) | `<iframe>` treated as `OPAQUE_TAGS`; child browsing contexts remain isolated; no cross-frame traversal. |
| **SpeechSynthesis** | **PASS** | `tests/tts.test.ts` (TTS-01 ~ TTS-10) | Native Web Speech API; filters `localService === true` offline voices; pre-call `cancel()` avoids queue piling; zero network requests. |
| **Storage** | **PASS** | `tests/explanation-cache.test.ts` (CACHE-01 ~ 20) | `browser.storage.local` backing 2,000-entry sanitized LRU cache; timestamp atomic updates; well within QuotaExceededError thresholds. |
| **AI Streaming** | **PASS** | `tests/provider-adapter.test.ts` (OPENAI/DEEPSEEK/CUSTOM), `tests/ai-stream.test.ts` | SSE streaming chunk decoding; multi-byte UTF-8 split boundary assembly; 4,000-character truncation; abort signal propagation. |
| **AI Redo** | **PASS** | `tests/card-redo.test.ts` (REDO-01 ~ REDO-18), Real Safari STP E2E | Bypasses current AI cache; fetches sentence context; atomic cache overwrite on completion; old cache preserved on cancel/error; requestId race protection. |
| **Security** | **PASS** | `tests/security.test.ts`, security smoke grep | 0 `eval()`, 0 `dangerouslySetInnerHTML`, 0 innerHTML on AI data; API keys isolated in background and masked in options; error messages redacted. |

---

## Long-Running Streaming

- **> 30s Remote Stream**: `UNVERIFIED` (No active live continuous 30s+ remote network stream was executed in this offline/local environment)
- **> 60s Remote Stream**: `UNVERIFIED`
- **Test Duration**: Application-level timeout (60s) and immediate abort mechanisms verified through automated test suites.
- **Network Condition**: N/A (no live high-latency public LLM endpoint used).
- **Observed Result**: Background service worker idle timeout behavior during prolonged (>30s) live cellular or unstable remote streaming remains a documented platform boundary. No artificial keepalive hacks were added.

---

## Issues

- **None**: No regressions, breaking changes, or compatibility defects were observed on Safari Technology Preview Release 253.

---

## Production Changes

- **`src/` Changes**: `NONE`
- **Dependencies Changes**: `NONE`
- **Configuration Changes**: `NONE`

---

## Final Decision

**`PASS WITH KNOWN LIMITATIONS`**

### Summary
Glint Safari Personal Edition passed the targeted Safari Technology Preview 253 compatibility regression within the tested scope, with previously documented long-running remote streaming and low-level WebKit memory/GC limitations remaining unverified where applicable.
