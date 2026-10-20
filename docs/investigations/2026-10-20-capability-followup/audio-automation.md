# Audio automation retest, 2026-10-20

[English](audio-automation.md) | [简体中文](audio-automation.zh-CN.md) · [Earlier results](recovery.md) · [Compatibility](../../native-tools-compatibility.md)

## Conclusion

Two distinct recordings passed ordinary BrowserWorker questions and real Codex native tool-result continuation: four authenticated DEV cases passed. All used the product implementation present at the start of this round, without additional waits, retries, transcription services or model substitution. This demonstrates current operation for these inputs and paths; **it does not establish the cause or repair of the earlier failures**. Earlier failed runs remain unchanged.

The user's successful manual submissions in local Chrome and the embedded DEV browser narrowed the investigation to the standard automatic workflow. An earlier ordinary DEV UI control also passed with the same English transcription prompt. The evidence does not support a blanket claim that the embedded browser, temporary chats or that prompt cannot handle audio.

## Authenticated acceptance

Requests selected `chatgpt-web/gpt-6-sol` with `xhigh`; every observed Web submission used `gpt-6-thinking` with `max`. Ordinary questions used the shared BrowserWorker. Native tasks used standard `dev:codex`, separate workspaces, a `read-only` sandbox and normal native approval policy. MCP Bridge remained disabled; an independently owned stdio MCP server supplied each recording.

| Case | Input and execution evidence | Result |
| --- | --- | --- |
| B, ordinary automatic question | Original 144,870-byte WAV, same English transcription prompt, temporary chat, one submission | Correctly transcribed “The red bicycle is beside the green door.” |
| B, native audio continuation | One real outer Code Mode/MCP call; native `input_audio`, browser-selected file and reference hashes matched; two Web generations requested the tool and continued from its result | Correct transcription and acceptance marker; zero commands, unchanged fixture |
| C, ordinary automatic question | Distinct 162,946-byte WAV, same prompt and mode, one submission | Correctly transcribed “Three silver keys are inside the yellow box.” |
| C, native audio continuation | Separate thread, one real outer Code Mode/MCP call; original bytes and call/attachment binding verified | Correct transcription and acceptance marker; zero commands, unchanged fixture |

Reference text was used only for offline synthesis and result assertions, never in model prompts, tool descriptions or textual tool results. No ASR substitution was used. Both files are 22,050 Hz, mono, 16-bit PCM WAV:

- B: SHA-256 `7ccfeec59db12f930fbb7e6b495eb93b38de34092a63abd4d8876b35c2cddd6c`, approximately 3.28 seconds.
- C: SHA-256 `65f68d44dd7de9a0acec21fb54a6875d2b38276e7fbc41a8fd485cca6e380a67`, approximately 3.69 seconds.

Each native audit verified twelve conditions: call count, original bytes, browser-selected bytes, completed processing, submitted `call_id`/`attachment_ref` and attachment identity, actual model/effort, correct content, no leaked answer, native final/CLI agreement, successful termination, no commands and an unchanged fixture. These are actual tool and file checks, not an inference from exit status alone.

## Send-timing hypothesis

| Case | Processing-response completion to actual submission |
| --- | --- |
| B ordinary automatic question | 4.181 seconds |
| C ordinary automatic question | 3.846 seconds |
| B native audio continuation | 14.361 seconds |
| C native audio continuation | 15.710 seconds |

These are naturally observed intervals, not newly configured delays. Processing responses had already ended before Send was activated in every case. This round therefore does not support the proposed explanation that the worker sends prematurely after `file.processing.completed`; no timeout or readiness rule was changed on that assumption.

The planned operator-release experiment was conditional on reproducing failure. Since the unchanged baseline passed, that extra experiment was not run and accepted requests were not resent. Attribution of the earlier intermittent failures still requires a comparable failing sample.

## Environment limitations and evidence

Offline synthesis of C initially failed because a restricted process could not access the installed voice. Only that task command used the automatically approved execution environment to access existing Zira; no components, system settings or network settings were changed. Native Apps MCP startup reported connection failures and continued with its existing tool cache; the independently owned audio MCP actually executed successfully. Those environment events remain recorded separately and were not presented as repaired Web2Harness defects.

Raw evidence is under ignored `output/2026-10-20-audio-automation/`:

| Scope | Evidence |
| --- | --- |
| Ordinary answers, actual requests and processing timing | `baseline/proof.private.json`, `sample-c/proof.private.json` |
| Native B thread, tools, files and final messages | `native-audio-recheck-b/`, thread `01a158c7-8429-7713-8feb-01e9645cf009` |
| Native C thread, tools, files and final messages | `native-audio-recheck-c/`, thread `01a158ce-cd43-7e43-a96f-67a7c16409fe` |
| Native upload and request observation | `audio-v1-observer.private.json`, `audio-v2-observer.private.json` |
| Valid sample waveforms | `waveform-check.private.json` |
| Previous evidence preservation | `prior-dev-traces/`: 208 files copied and hash-verified before testing |
| Final evidence preservation | `final-dev-traces/` and `final-dev-traces-manifest.private.json`: 243 files copied and hash-verified; each native thread also saved as `native-rollout.private.jsonl` |
| Production boundary and DEV completion | `boundary-before.private.json`, `boundary-after.private.json`, `boundary-ownership.private.json`, `dev-final-status.log` |
| Results and file digests | `evidence-index.private.json` |

All three production configuration/authentication hashes and relevant services were unchanged. All 58 original process identities remained unchanged; the three added processes belonged to verified DEV ancestry. DEV remained authenticated with zero active or waiting tasks. Production routes and authentication were not changed or copied, and the user's successful conversations were not closed. These preservation copies do not recover the historical screenshots already disclosed as missing.

Not executed: other audio formats, long recordings, noise/multiple-speaker cases, other accounts or models, installers, a full regression suite or verification of a repair for the original naturally occurring failure. This round updates evidence and capability documentation only; no product-code changes, release or push occurred. These four passes do not close encrypted-context, external hosted-tool or other media-format gaps.
