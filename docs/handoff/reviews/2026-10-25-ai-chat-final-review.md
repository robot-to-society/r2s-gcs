# Final review: feat/ai-chat (AI chat, proposals only)

Reviewer scope: full branch diff vs main, plan header (Global Constraints, Fixed values, Rulings, Review Focus 1-5), spec 70 §4 / 10 §3.4 / 50 §2.5.

Verification run (no LLM calls, dev stack untouched):
- `cargo test -p rgcs-ai --all-features`: 20 + 14 + 12 passed
- `cargo test -p rgcs-server --test ai_chat_flow --test ai_tools_flow`: 12 + 7 passed
- `npx vitest run src/features/ai src/app/aiExecute.test.ts src/app/rightPanel.test.ts src/features/commands`: 116 passed
- `npx tsc --noEmit -p tsconfig.app.json`: clean

Counts: Critical 0 / Important 3 / Minor 13

---

## Critical

None found. Safety path checked in detail (see "Verified" at the end): no route from the agent or `ServerTools` to the queue, link, cameras or ROI. Proposal ids are single-use (`claim` under the hub mutex). Owner, sysid, command and expiry are checked server-side. `ai_proposal_id` skips neither `invalid()`, the confirm token nor `precheck`/`vtol_unknown`. The UI calls `runner.pick` only from the 実行 `onClick`.

---

## Important

### I1. An empty assistant reply is committed and breaks the conversation for good; the UI offers no way out
- **Where:**
  - `crates/rgcs-ai/src/agent.rs:91-104`: the response blocks are pushed as an assistant turn even when `resp.blocks` is empty. `finish` then returns them as `new_turns`.
  - `apps/rgcs-server/src/ai_hub.rs:292-316`: `commit` appends them.
  - `apps/rgcs-server/ui/src/features/ai/AiPanel.tsx:74,98-105`: 新しい会話 is shown only when `state.full`.
- **Scenario:**
  - The Messages API can return `content: []` with `stop_reason: "end_turn"`. This is documented, and most common right after tool results, when the model has nothing to add.
  - The turn is committed with an empty assistant message, and the operator sees an empty bot bubble.
  - Every later chat in that conversation replays it. The API answers 400 ("all messages must have non-empty content except for the optional final assistant message"), so the UI shows 502 `ai_provider_error` on every message. Only a page reload clears `conversationId`, because the 新しい会話 button exists only for `conversation_full`.
  - The same empty bubble occurs with openai_compat when `content: ""` comes with no `tool_calls`. That is not a 400 there, but the reply is still empty.
- **Fix:**
  - In `run_turn`, when the final response has no text and no tool_use, do one of two things: (a) re-ask once with tools, appending nothing, or (b) replace or append a fixed `Block::Text` (e.g. 「(応答がありませんでした)」) before committing.
  - Either way, never commit an assistant turn with zero blocks. For Anthropic, also never commit one with only opaque blocks and no text or tool_use.
  - In the UI, offer 新しい会話 after any `ai_provider_error` (or always, in the panel header).
  - Add an agent test: empty end_turn after tool results → `new_turns` has no empty assistant turn.

### I2. The history limit (200 000 chars) does not fit the per-chat token cap (60 000): long conversations truncate after one call and still burn budget
- **Where:**
  - `apps/rgcs-server/src/ai_hub.rs:17-18,277`: `MAX_HISTORY_CHARS = 200_000`.
  - `crates/rgcs-ai/src/agent.rs:105`: the cap check sums `input + output` over every call, and `input` includes the whole replayed history.
- **Scenario:**
  - Japanese text runs about one token per character, and tool-result JSON about 3-4 characters per token. A conversation of roughly 60-120k history characters therefore costs 40-60k input tokens on every call.
  - From then on, any chat whose first response is a tool use goes over 60 000 after that first call. `close_unrun` ends the turn with 「上限に達したため途中で終了しました」, and the operator gets no answer. The tokens of that call (and of the forced call, if any) are still billed.
  - This repeats for every message until `conversation_full`, which comes at 200k chars or 20 turns. With the 2 M daily budget, about 30-40 such useless chats use up the day's AI for all users. Review Focus 3 ("a runaway bill") is met only formally.
- **Fix:**
  - Bound history by tokens, not characters. Keep the last call's `input` usage on the conversation (it is returned by both adapters).
  - Refuse with `conversation_full` once that exceeds e.g. half of `max_tokens_per_chat`.
  - Alternatively, apply the per-chat cap to *incremental* tokens (output plus input growth past the first call) and keep a separate, lower history limit.
  - Add a test: a history whose replay costs > cap/2 → `409 conversation_full` before any LLM call.

### I3. There is no limit on tool calls per LLM response: one hostile or broken response fans out into hundreds of queries, audit rows and megabytes of history
- **Where:**
  - `crates/rgcs-ai/src/agent.rs:109`: `run_tools` runs every tool_use block of a response.
  - `crates/rgcs-ai/src/openai.rs:182`: every `tool_calls[]` entry is accepted.
  - `apps/rgcs-server/src/ai_tools.rs:37-55`: each call writes an audit row.
- **Scenario:**
  - A local OpenAI-compatible server, or a misbehaving model, returns e.g. 200 `search_log` calls in one response (cheap within 4096 output tokens).
  - The loop runs 200 SQLite LIKE scans and writes 200 `target=ai` audit rows. It appends up to 200 × 8 000 = 1.6 MB of tool-result text to the turn.
  - That can repeat for up to 6 iterations: about 10 MB per turn, kept in memory on commit, and the 200k-char conversation limit is checked only *before* a turn. With 64 conversations that is hundreds of MB.
  - The next LLM call carries all of it as input. The token cap stops the loop only after that call has been billed or rejected.
  - The 8 000-char cap and the 3-proposals cap are per call / per reply; nothing caps the call count per response or the total result size per turn.
- **Fix:**
  - Cap tool calls per response (e.g. 8). Answer the extra calls with `{error:"too_many_tool_calls"}` results, without running or auditing them, so the tool_use/tool_result pairing stays valid.
  - Cap the total tool-result characters per turn (e.g. 64k). After that, close with `close_unrun`.
  - Check `turn_chars(new_turns)` against the remaining history budget before committing.

---

## Minor

### M1. reqwest follows redirects and forwards `x-api-key` to the new host
- **Where:** `crates/rgcs-ai/src/anthropic.rs:28` and `crates/rgcs-ai/src/openai.rs:27` (`reqwest::Client::new()`).
- **Detail:** reqwest's default policy follows up to 10 redirects. On a cross-host redirect it strips only `Authorization`, `Cookie` and the proxy auth headers, not the custom `x-api-key`. A misconfigured `base_url` (a proxy or captive portal answering 30x) would send the Anthropic key to the redirect target.
- **Fix:** build the client with `.redirect(reqwest::redirect::Policy::none())`, and treat a 3xx as `AiError::Provider`.

### M2. `base_url` is logged whole at startup
- **Where:** `apps/rgcs-server/src/ai_api.rs:44-49`.
- **Detail:** a URL with userinfo or a query token (`https://user:key@host/v1`, `?api-key=`) lands in the log. That is against "never log keys".
- **Fix:** log only scheme + host + port, or strip userinfo and query.

### M3. The provider response body is read with no size limit
- **Where:** `crates/rgcs-ai/src/llm.rs:126` (`resp.bytes()`).
- **Detail:** a broken local server streaming a huge body is bounded only by the 30 s timeout, which can be hundreds of MB on a LAN.
- **Fix:** read in chunks up to e.g. 2 MB, then return `Malformed`.

### M4. The newer Anthropic stop reasons map to a generic 502
- **Where:** `crates/rgcs-ai/src/anthropic.rs:126-139`.
- **Detail:** `model_context_window_exceeded` (newer models) and `pause_turn` become `Malformed` → 「unexpected AI provider response」.
- **Fix:** map `model_context_window_exceeded` to `Stop::MaxTokens` (truncated) or to a `conversation_full`-style error, so the UI offers 新しい会話. Map `pause_turn` to an explicit error code.

### M5. The daily budget is checked only when a chat starts
- **Where:** `apps/rgcs-server/src/ai_hub.rs:242`.
- **Detail:** N users chatting at once all pass `spent < budget` and can overshoot by N × (60k + one oversized call). This is acceptable for a soft cap, but undocumented.
- **Fix:** have `Metered` refuse further calls once `spent >= budget`, returning a new `AiError::Budget`, or document the overshoot in spec 70 §4.

### M6. Conversation expiry and eviction can hit a running chat, and eviction crosses users
- **Where:** `apps/rgcs-server/src/ai_hub.rs:92-93,104-116,262-281,305-312`.
- **Detail:**
  - `history()` does not refresh `last_used_ms`. A conversation last used 29.9 min ago is read, and another user's `begin` can then prune it during the up-to-90 s chat. LRU eviction by another user's commit has the same effect.
  - `commit` then takes the `None` branch and silently starts a fresh conversation holding only this turn: context lost, `user_turns` reset.
  - One user creating 64 conversations (about 11 min at 6/min) evicts everyone else's.
- **Fix:**
  - Touch `last_used_ms` in `history()`.
  - Skip eviction for conversations with an in-flight owner.
  - Cap conversations per user (e.g. 4), evicting that user's oldest first.

### M7. A claimed proposal stays "executed" if the request is dropped between `claim` and `release`/`enqueue`
- **Where:** `apps/rgcs-server/src/commands.rs:154-174`.
- **Detail:**
  - The `.await` points after `claim` are the `reject` audit write and `queue.send`. If the HTTP client disconnects at one of them, the future is dropped and `release` never runs. The proposal reads `proposal_used`, although nothing was sent. This is fail-safe, but confusing.
  - Related: while one press is mid-flight (claimed), a second legitimate press gets `proposal_used` instead of waiting.
- **Fix:** hold the claim in a guard whose `Drop` releases it unless `enqueue` succeeded.

### M8. The card hides 実行 based on the browser clock
- **Where:** `apps/rgcs-server/ui/src/features/ai/ProposalCard.tsx:20-25`.
- **Detail:** `item.proposal.expires_ms < now` compares the server's clock with `Date.now()`. With a browser clock 2+ minutes fast (common on field tablets without NTP), every card shows 期限切れ at once and cannot be executed. With a slow clock, the button stays up after the server has expired the proposal; the server still refuses, so this is cosmetic.
- **Fix:** record the local receive time in the reducer. Expire at `receivedAt + (expires_ms - reply.ts)`.

### M9. A failed dismiss shows the raw server message and puts the buttons back
- **Where:** `apps/rgcs-server/ui/src/features/ai/useAiChat.ts:76-79`.
- **Detail:** the English `e.message` is shown instead of `aiErrorText`/`errorText`. For `proposal_used` (it was just executed elsewhere), the card goes to `failed` and offers 実行 / 却下 again.
- **Fix:** localise through `errorText`. Map `proposal_used` to a settled state.

### M10. A card can stay in 'sending' forever when its confirm request is replaced
- **Where:** `apps/rgcs-server/ui/src/features/commands/useCommandRunner.tsx:67-72,79-85`.
- **Detail:** `after(... needs_confirm)` calls `setPending` without resolving an earlier pending `opts.onResult`. If a second needs_confirm pick arrives while a confirm dialog is open (from another dock button, a keyboard path or a re-prompt), the first card never leaves `sending`, and its buttons stay disabled.
- **Fix:** before `setPending`, call `pending?.opts.onResult?.({kind:'needs_confirm'})` for the replaced entry.

### M11. Accessibility of the chat panel
- **Where:**
  - `apps/rgcs-server/ui/src/features/ai/AiPanel.tsx:93`;
  - `apps/rgcs-server/ui/src/features/ai/ChatItemView.tsx:35-44`;
  - `apps/rgcs-server/ui/src/features/ai/ProposalCard.tsx:47-53`.
- **Detail:**
  - The message list has no `role="log"` / `aria-live="polite"`, so new replies and proposals are not announced.
  - The thinking row has no `role="status"`.
  - The 実行 / 却下 buttons carry no context: a screen reader hears 「実行」 with no command or vehicle.
- **Fix:**
  - Add `role="log" aria-live="polite"` on `.ai-list` and `role="status"` on the thinking row.
  - Add `aria-describedby` from the buttons to the `.ai-proposal-cmd` id, or an `aria-label` such as 「実行: モード変更 → LOITER (UAV-03)」.

### M12. A `→` text glyph inside the proposal label
- **Where:** `apps/rgcs-server/ui/src/features/ai/format.ts:42-46` (`${label} → ${arg}`).
- **Detail:** it is used as a separator, not an icon, but it is borderline against the Global Constraint "never text glyphs (no →)".
- **Fix:** use 「モード変更: LOITER」, or render `IconArrowRight` from `shared/ui/icons.tsx`.

### M13. Vehicle name and mode strings reach the model outside `untrusted_text`
- **Where:**
  - `apps/rgcs-server/src/ai_tools.rs:231-266`: `name` and `mode` in `status_json` / `summary_json`;
  - `apps/rgcs-server/src/ai_api.rs:104`: `[対象機体: {name} …]` is in the user turn itself.
- **Detail:** ruling 8 lists vehicle names and mode strings as untrusted. They are GCS-assigned and table-derived today (`VehicleState::new(sysid, "UAV-03")`), so there is no current injection path. If names ever come from the vehicle or the registry UI, they become an injection vector placed in the operator's own turn.
- **Fix:** either wrap them as `untrusted_text`, or record in the plan/spec that names and modes are GCS-controlled. Keep the user-turn prefix free of any vehicle-sourced text.

---

## Verified (no finding)

**Review Focus 1: no send without a human press.**
- `ai_tools.rs`, `ai_api.rs`, `ai_hub.rs` and `crates/rgcs-ai/src/*` contain no use of `queue`, `outgoing`, `cameras`, `mav`, `roi` or `commands::command`. The only import is `commands::EXTENDED_SYS_STATE_ID`.
- `ProposalCard` calls `onExecute` only from the button `onClick`. `executeProposal(...)` in `Shell.tsx:360` only builds a closure.
- No effect calls `runner.pick`.

**The proposal on the command path.**
- `claim` checks owner (403), sysid/command (409 mismatch), status (409 used) and expiry (409 expired), then marks the proposal under one mutex hold.
- `release` runs only after a successful claim (refusal or queue down).
- `invalid()`, the confirm token (`consume_confirm` bound to sysid + cmd name) and `precheck`/`vtol_unknown` all run after the claim, so `ai_proposal_id` skips nothing.
- Every refusal is audited `rejected` with the id cut to 64 chars.
- Ids are `p-<uuid v4>`. `same_command` is a full equality check (f32 args round-trip exactly through serde_json), with set_mode compared case-insensitively.

**Validation parity.**
- `validate_proposal` runs per-airframe modes (`modes_for`), speed 0.5-40, `other` → not_allowed, `change_alt` → not_implemented, then `invalid()`, `precheck`, `vtol_unknown`.
- The parse layer also rejects `other` and any `cmd` outside the schema.
- `link_lost` is refused at proposal time and again at execution.

**Prompt injection.**
- STATUSTEXT and log text go only under `untrusted_text` (`message_json`).
- The system prompt says tool output is data, its instructions are not followed, and proposals come only from the operator's request.

**Key handling.**
- `Secret` has a redacting `Debug` and no Display/Serialize.
- `AiError` never carries a `reqwest::Error`.
- `provider_error` logs only status + error type.
- Client responses carry only the HTTP status (`ai_meter.rs:34-46`).
- `/api/ai/status` returns provider, model, reason and budget only.
- No `?config` logging.
- openai_compat has no default env var, so `ANTHROPIC_API_KEY` is never read for it (with a test).

**Budget, rate limit, busy flag.**
- `begin` is atomic.
- `InFlight` is released on Drop (also on timeout or dropped request).
- `Metered` charges each answered call immediately. `commit` adds 0, so there is no double charge.
- Rate-limit entries are counted at admission, also for chats that later fail.

**Anthropic wire format.**
- Assistant blocks are stored verbatim (thinking and unknown blocks as `Opaque`).
- All tool_results go back in one user message, with `is_error`.
- On a cap stop, `close_unrun` keeps the pairing.
- A failed or timed-out turn commits nothing.
- The forced final call keeps the `tools` definitions while the history has tool blocks and sends `tool_choice: {"type":"none"}`. `none` is an accepted tool_choice with tools present, and it is compatible with thinking (only `any`/`tool` are not).
- Cache tokens are counted in `input`.

**OpenAI parsing.**
- String, object and null arguments are handled. Invalid JSON is marked and replayed as the original string.
- A missing id or name, or a non-object message, gives `Malformed`.
- Recorded tool names are capped at 64 chars.
- `length` wins over tool calls.

**UI.**
- Confirm cancel → `needs_confirm` → back to pending.
- `proposal_expired` → expired. Other errors go through `errorText`.
- The 却下 / 実行 buttons are disabled while sending.
- Lucide icons only, apart from M12. React text rendering means no XSS from the reason.
