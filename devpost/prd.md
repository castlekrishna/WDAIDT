---
doc: prd
status: approved
---

# Why Did AI Do That? (WDAIDT) — Product Requirements

Real-time diagnostic explanations and steering prompts for ChatGPT interactions, operating natively in the Chrome Side Panel. Source: `scope.md > The Core Loop`.

## The Core Journey
1. **Discovery & Setup**: The user installs the unpacked Chrome extension, starts the local FastAPI backend (defaulting to zero-config hermetic mock mode), and navigates to `https://chatgpt.com`.
2. **Side Panel Activation**: The user clicks the pinned WDAIDT icon in the Chrome toolbar. The Obsidian pitch-black side panel opens alongside the active ChatGPT conversation. A green connectivity indicator confirms `Backend: reachable at http://localhost:8000`.
3. **Conversation Interaction**: The user submits a prompt to ChatGPT. ChatGPT generates a response.
4. **Triggering Analysis**:
   - *Manual*: The user clicks the prominent **Why?** button.
   - *Auto*: If the **Auto** toggle is switched to `ON`, WDAIDT's mutation watcher detects response stream settlement (2s debounce) and triggers automatically.
5. **DOM Capture & Context Budgeting**: The content script non-intrusively extracts the latest user prompt and assistant response, along with up to 5 preceding dialogue turns (budgeted to ≤ 30,000 characters).
6. **Diagnostic Evaluation**: The FastAPI backend evaluates the interaction against the authoritative master prompt using either local mock fixtures or Google Gemini (`gemini-3.5-flash-lite`).
7. **Document Rendering & Action**: The side panel renders an editor-like diagnostic document with high-contrast typography, highlighting overlooked constraints, assumptions, and a ready-to-use follow-up prompt.
8. **Steering the Next Turn**: The user clicks the **Copy** button on the suggested next prompt and pastes it directly into ChatGPT to steer the conversation.

## Screens and Layout
WDAIDT operates entirely within the native Chrome Side Panel (`extension/src/sidepanel/index.html`):
- **Top Header Bar**: Brand title, version indicator (`0.9.2`), Auto Analyze toggle switch (`ON`/`OFF`), Settings gear button, and Markdown copy export button.
- **Connection Status Strip**: Pulsing status dot (Connected, Checking/Analyzing, Offline/Reconnecting) and connection detail text.
- **Captured Interaction Drawer**: Collapsible accordion displaying character counts and context badge (`Current exchange only`, `Context: N previous exchanges`), with scrollable monospace previews of the prompt and assistant reply.
- **Diagnostic Document Surface**: Primary document view dynamically rendering 9 validated content block types.
- **Settings Drawer (`#settingsCard`)**: Slide-down configuration drawer with dropdowns for Response Style, Analysis Depth, Context Window, and custom instructions textarea. Dismissible via **Done** button or the `Escape` key.
- **Diagnostic Error Card (`#errorCard`)**: High-contrast error message card displaying standardized error codes, recovery instructions, and an instant **Retry** button.

## Look and Feel
- **Aesthetic**: Obsidian pitch-black (`#000000`) background, fine borders (`#303030`), high-contrast foreground text (`#F2F2F2`), and muted secondary copy (`#888888`).
- **Typography**: Clean system sans-serif stack (`Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`) paired with monospace font (`Consolas`, `Monaco`, `monospace`) for code blocks and previews.
- **Monochrome & Restrained**: No distracting animations or generic purple AI gradients. Subtle semantic status colors only (green for connected, amber for warnings, red for errors, cyan for info callouts).
- **Accessibility**: High-contrast focus rings (`var(--focus-ring)`, `#E5E5E5`), keyboard navigable (`Enter`/`Space` activation, `Escape` panel dismiss), and full ARIA attribute synchronization (`aria-expanded`, `aria-controls`).

## Features and Behavior

### Capture Engine
- Six-tier DOM extraction hierarchy (`role-attributes`, `message-id`, `conversation-turns`, `articles`, `modern-turns`, `content-blocks`) piercing open shadow roots.
- Automatic filtering of UI chrome, drag-and-drop live regions, feedback surveys (*"Is this conversation helpful so far?"*), and footer disclaimers.
- In-progress stream protection: active streaming or empty assistant nodes return honest `RESPONSE_PENDING` without firing premature requests.

### Settings System
- **Response Style**: 7 presets (Friendly and conversational [Default], Lighthearted and witty, Casual and natural, Professional and direct, Formal and precise, Academic and analytical, Custom instructions).
- **Analysis Depth**: 3 presets (Brief [Default], Balanced, Detailed).
- **Context Window**: 4 choices (0, 3, 5 [Default], 10 previous exchanges). Configured strictly as a maximum budget, never a minimum requirement.
- **Persistence**: All preferences persist in `chrome.storage.local`.

### Dynamic Analysis Renderer
- Pure DOM element construction (`textContent`) with zero `innerHTML` usage.
- Supports 9 block types: `heading` (H1–H6), `paragraph`, `list` (ordered/unordered), `code` (with language label and copy button), `quote`, responsive `table`, `callout` (6 variants), section `divider`, and `next_prompt` (with one-click copy affordance).

### Error Recovery & Resilience
- Retains `lastCapture` and context in volatile memory. If an analysis fails due to backend downtime, starting the server and clicking **Retry** re-submits the retained payload immediately without requiring tab re-selection.
- Stale-result guard (`request_id`) silently drops superseded out-of-order responses.

## States and Boundaries
- **Connected & Idle**: Green dot; ready for manual **Why?** click or auto-capture.
- **Analyzing / Loading**: Amber pulsing dot; skeleton shimmer placeholder active; buttons disabled.
- **Success**: Structured document rendered; Markdown export and prompt copy buttons active.
- **Error / Offline**: Red dot; diagnostic error card displayed with actionable advice and **Retry** button.
- **Non-ChatGPT Tab**: Informational notice guiding the user to open a supported ChatGPT conversation.

## Product Decisions
- **Side Panel over In-Page Injection**: Prevents CSS pollution, avoids breaking ChatGPT's internal React reconciliation, and complies with Chrome Web Store safety guidelines.
- **Zero Ingestion Persistence**: No user prompts or responses are written to databases, vector stores, or console logs. All processing is volatile and ephemeral.
- **Opt-in Live Gemini vs. Hermetic Mock**: Enables instant zero-cost local evaluation out-of-the-box (`MOCK_ANALYSIS=true`) while supporting live Gemini intelligence with credentials.

## What We're Building
A robust, developer-ready proof of concept consisting of the Chrome Manifest V3 extension, the local FastAPI backend, the master prompt engine, and 163 passing automated regression tests.

## Deferred From the POC
- Multi-provider support for Claude, Gemini web, and Copilot.
- Visual diagram renderers for interactive SVG architectures.
- Cloud deployment and authentication accounts.

## Non-Goals
- Modifying or rewriting ChatGPT's generated conversation bubbles.
- Claiming private access to model weights or internal activations.
- Storing or collecting user conversation transcripts.

## Open Questions
- None blocking submission. Live testing against newly deployed OpenAI DOM layout variations requires periodic review.
