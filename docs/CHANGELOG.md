# Changelog

All notable changes to Why Did AI Do That? are documented here. Versions are listed from newest to oldest.

## V2.1.0 — Legacy Config Cleanup & Gemini Integration Hardening

WDAIDT V2.1.0 hardens the direct Gemini API integration and cleans up legacy backend references following the retirement of the local Python service:

- **Model Identifier Normalization**: Fixed the root cause of HTTP 404 errors by stripping leading `models/` prefixes from user-provided or API-enumerated model names before constructing the REST endpoint URL (`/models/{model}:generateContent`), preventing duplicate `/models/models/...` request paths.
- **Resilient Model Candidate Fallback**: Added `gemini-2.5-flash` and `gemini-2.5-flash-lite` to the candidate fallback hierarchy (`gemini-3.5-flash-lite` -> `gemini-flash-latest` -> `gemini-3.8-flash` -> `gemini-2.5-flash` -> `gemini-2.5-flash-lite`), ensuring graceful fallback across different Google AI Studio tier allocations.
- **Accurate Auth Error Mapping**: Updated Gemini REST response handling to inspect HTTP 400 responses for `API_KEY_INVALID` payload reasons and error messages, correctly classifying invalid/expired keys as auth errors rather than generic request argument rejections.
- **Settings Lifecycle & Status Synchronization**: Eliminated premature "Gemini: API Key required" status warnings on startup by ensuring stored settings and keys are retrieved from `chrome.storage.local` before status indicator evaluation.
- **Settings Input Hardening**: Added `change` event listening and drawer-close persistence to the API key input to reliably save pasted or autofilled keys.
- **Stale Configuration Cleanup**: Removed obsolete health-check constants and helpers (`HEALTH_PATH`, `wdaidtHealthUrl`) while preserving shared test compatibility constants.
- **Packaging Verification**: Added explicit packaging instructions for PowerShell and Bash ensuring that distribution ZIP archives contain `manifest.json` directly at the archive root.
- **Test Suite Expansion**: Added regression tests covering model prefix normalization, HTTP 400 auth error mapping, and asynchronous storage restoration, bringing the automated test suite to 166 passing tests (0 failed, 0 skipped).

## V2.0.0 — Self-Contained Chrome Extension Release

WDAIDT V2.0.0 converts **Why Did AI Do That?** into a completely self-contained Chrome Manifest V3 extension. Users no longer need to install Python, run a local FastAPI server, or use a terminal. The extension communicates directly with Google's Gemini API using a user-provided API key stored securely in local browser storage, or operates completely offline using built-in Mock Mode.

- **Direct Gemini REST API Integration**: Replaced the local FastAPI backend dependency with direct HTTPS client calls to Google Generative Language API (`/v1beta/models/gemini-3.5-flash-lite:generateContent`) with automatic fallback to high-availability candidates (`gemini-flash-latest`, `gemini-3.8-flash`).
- **In-Extension Settings & Secure Storage**: Integrated an API key configuration UI directly in the side panel settings with password masking, toggle view, clear controls, and local persistence via `chrome.storage.local`.
- **Zero-Setup Mock Mode**: Included deterministic, zero-network mock analysis logic within the extension, allowing users to test explanations immediately without requiring an API key or internet access.
- **Pure JavaScript Analysis Pipeline**: Ported prompt construction (`src/shared/prompts.js`), response schema validation (`src/shared/validator.js`), and mock generation (`src/shared/mock-analyzer.js`) into modular JavaScript matching the reference Python implementation.
- **Robust Model Fallback & Error Handling**: Implemented candidate fallback for HTTP 404/503 responses, sanitized error messages preventing key leakage, and instant UI status indicator synchronization.
- **Expanded Test Coverage**: Added comprehensive Node.js unit and integration tests covering the Gemini client, schema validation, mock generation, settings lifecycle, and backend-independent analysis (162 extension tests + 61 backend reference tests, 223 total passing tests).

Detailed technical notes and verification results are preserved in [V2.0.0 technical notes](V2.0.0.md).

## V1.0.0 — Stable Release

WDAIDT V1.0.0 is the first official stable release of **Why Did AI Do That?**, establishing a fully verified, reproducible, and documented distribution baseline. This milestone locks the product scope, synchronizes canonical versioning across all components, hardens repository hygiene, expands automated regression coverage, and produces a verified, clean Chrome Extension distribution package.

- **Stable Scope Freeze**: Preserved the two-component architecture consisting of the Chrome Manifest V3 Extension (`extension/`) communicating with the local FastAPI backend (`backend/`) on `http://localhost:8000`. No external cloud databases, analytics, or unneeded abstractions were introduced.
- **Canonical Version Synchronization**: Synchronized version `1.0.0` across `extension/manifest.json`, `extension/src/content/chatgpt.js` (`VERSION = '1.0.0'`), `extension/src/sidepanel/app.js`, backend router docstrings (`backend/app/api/analyze.py`), FastAPI app metadata (`backend/app/main.py`), and repository documentation.
- **Automated Regression Expansion**: Added automated version-synchronization verification tests to both test runners (`tests/extension/day1.smoke.test.js` and `tests/backend/test_health.py`), establishing a new test baseline of **165 total passing automated tests** (104 extension tests + 61 backend tests, 0 failures, 0 skipped).
- **Clean Chrome Extension Package**: Packaged a production-ready, clean distribution archive (`WDAIDT-v1.0.0-chrome-extension.zip`) containing strictly the extension runtime files with `manifest.json` at the archive root, excluding all backend code, virtual environments, tests, and temporary artifacts.
- **Repository Hygiene & Git Exclusion**: Hardened `.gitignore` to explicitly exclude Python pytest caches (`.pytest_cache/`), archive packages (`*.zip`, `dist/`), virtual environments (`.venv/`, `env/`, `venv/`), and environment files (`.env.*`) while maintaining tracked templates (`backend/.env.example`).
- **Comprehensive Release Documentation**: Authored `docs/V1.0.0.md` providing complete architecture diagrams, component responsibilities, cross-platform local server setup commands (PowerShell and Bash), health verification, Gemini and Mock Mode configuration, and release verification checklists.

Detailed technical notes and verification results are preserved in [V1.0.0 technical notes](V1.0.0.md).

## V0.9.3 — Final Skill Pack Alignment Audit & Architectural Map

WDAIDT V0.9.3 completes the alignment audit against the official Devpost Learn AI Basics Skill Pack curriculum (`challengepost/learn-ai-basics`). This release documents the project's stage-by-stage methodology, creates an offline standalone visual architecture map, and updates the compliance verification baseline.

- **Skill Pack Usage Report (`devpost/skillpack-usage.md`)**: Fully documented the adoption, adaptation, and rationale for all Skill Pack recommendations across stages 1 through 6, detailing how WDAIDT honors spec-driven development, thin vertical slicing, mechanical test verification, and privacy-preserving architecture.
- **Standalone Visual Architecture Map (`devpost/app-map.html`)**: Implemented a self-contained, offline HTML architectural takeaway map with an inline SVG data flow diagram, a 3-stop code tour route (`chatgpt.js` &rarr; `analyze.py` &rarr; `app.js`), concrete "To change this, start here" pointers, and a reusable practice guide on epistemic modesty and passive XML delimiters.
- **Checklist Slicing & Code Tour Completion**: Appended Slice 12 to `devpost/checklist.md` tracking the visual map deliverable and verifying the 3-stop code tour route.
- **Requirements Matrix Refinement**: Updated `docs/SUBMISSION_READINESS.md` with explicit categorization distinguishing mandatory requirements from recommended artifacts and optional features (such as live cloud hosting and Discord peer reviews).
- **Metadata Synchronization**: Synchronized release version `0.9.3` across `extension/manifest.json`, `extension/src/content/chatgpt.js`, `extension/src/sidepanel/app.js`, backend router docstrings, and repository documentation.
- **Model Reference Standardization**: Corrected model-switching instructions and architecture descriptions in `devpost/app-map.html` to consistently specify `gemini-3.5-flash-lite`, matching the backend runtime configuration in `backend/app/analysis/analyzer.py` and `backend/.env.example`.

Detailed technical notes are preserved in [V0.9.3 technical notes](V0.9.3.md).

## V0.9.2 — Submission Readiness & Compliance Audit

WDAIDT V0.9.2 is a dedicated hackathon submission readiness, planning compliance, and repository audit milestone for the Devpost Build With AI: Basics hackathon. This release formalizes planning artifacts, establishes an open-source MIT license, completes a full engineering and privacy audit, and creates comprehensive submission verification reports.

- **Formal Planning Artifacts Created**: Generated canonical planning documents matching the official Devpost Learn curriculum specifications at both the repository root (`scope.md`, `prd.md`, `spec.md`) and in the `devpost/` workspace (`devpost/scope.md`, `devpost/prd.md`, `devpost/spec.md`, `devpost/checklist.md`).
- **Official Open-Source MIT License**: Formally licensed the project under the MIT License (`LICENSE`) with copyright 2026 Krishna Kumar, Lidiya.
- **Honest Skill Pack Compliance Evaluation**: Explicitly documented the project's development history—clarifying that early prototype development occurred prior to running the Devpost Learn CLI, and that V0.9.2 completes the canonical planning and alignment audit without fictional historical claims.
- **Comprehensive Submission Readiness Report**: Authored `docs/SUBMISSION_READINESS.md` detailing the official requirements matrix, eligibility verification (Oct 12 creation vs. Sept 22 hackathon start), security/privacy audit, testing evidence, and an explicit checklist of remaining owner tasks (video recording and Devpost form submission).
- **Metadata & Version Synchronization**: Synchronized release version `0.9.2` across `extension/manifest.json`, `extension/src/content/chatgpt.js`, `extension/src/sidepanel/app.js`, backend router docstrings, and documentation.
- **Regression Verification**: Confirmed 100% pass rate across the full automated regression baseline of 163 tests (103 extension unit/integration tests + 60 backend unit tests).

Detailed technical notes, compliance matrices, and audit findings are preserved in [V0.9.2 technical notes](V0.9.2.md).

## V0.9.1 — Usability Defaults & Documentation Restructure

WDAIDT V0.9.1 introduces streamlined usability defaults and an engaging, user-first documentation structure. This release sets the extension defaults to an approachable, fast diagnostic workflow and provides immediate, zero-friction onboarding for new users.

- **Default Explanation Depth Set to Brief**: Configured `DEFAULT_ANALYSIS_DEPTH` to `'Brief'` across `extension/src/shared/config.js`, `extension/src/sidepanel/app.js`, and `extension/src/sidepanel/index.html`. Users receive concise, high-impact diagnostic takeaways and primary next actions (1–2 blocks) by default, while retaining the option to select Balanced or Detailed in settings.
- **Default Tone Set to Friendly and Conversational**: Configured `DEFAULT_RESPONSE_STYLE` to `'Friendly and conversational'` across extension configuration and UI controls, ensuring warm, approachable, encouraging explanations while maintaining rigorous technical accuracy.
- **User-Centric Documentation Restructure**: Restructured `README.md` into an engaging, wizard-like product overview. Elevated "About the Project", "What the Project Does", and "Settings & Customization" above installation instructions, providing a compelling upfront walkthrough before technical architectural details.
- **Direct Download Instructions**: Added both Git clone commands and direct 1-click GitHub ZIP download instructions for immediate zero-barrier evaluation.
- **Emoji-Free Documentation**: Cleaned all decorative emojis across `README.md` and `docs/CHANGELOG.md`, adopting professional high-contrast Markdown typography.
- **Version Synchronization**: Synchronized release version `0.9.1` across `extension/manifest.json`, `extension/src/content/chatgpt.js`, `extension/src/sidepanel/app.js`, and backend API module docstrings.
- **Regression Verification**: Preserved 100% pass rate across all 163 automated regression tests (103 extension tests via Node.js built-in test runner + 60 backend tests via pytest).

## V0.9 — Submission Polish & Release Readiness

WDAIDT V0.9 focuses on submission readiness, usability auditing, and evaluator clarity prior to the V1.0 stable release. This milestone hardens user recovery flows, fixes keyboard navigation accessibility issues, refines first-run setup instructions, and establishes an end-to-end verified evaluation baseline.

- **Resilient Retry Recovery**: Implemented a smart `runRetry()` recovery workflow in `extension/src/sidepanel/app.js` that retains the most recently captured interaction (`lastCapture`) and its sanitized context in memory. If an analysis fails due to backend unavailability or transient network drop, restarting the backend and clicking **Retry** immediately re-submits the retained interaction without requiring the evaluator to refocus the ChatGPT tab or re-capture DOM elements.
- **Keyboard Navigation & Accessibility Polish**: Fixed a CSS bug in `extension/src/sidepanel/styles.css` where `.accordion-header:focus-visible` referenced an undefined variable (`var(--accent-subtle)`), restoring high-contrast focus rings (`var(--focus-ring)`). Added an accessible `Escape` key event listener in the side panel that dismisses the Settings drawer and returns focus appropriately.
- **Contract & Metadata Synchronization**: Synchronized version constants across `extension/manifest.json` (`0.9.0`), `extension/src/content/chatgpt.js` (`VERSION = '0.9.0'`), and backend router module documentation in `backend/app/api/analyze.py`.
- **First-Run Setup & Documentation Overhaul**: Clarified the first-run evaluation workflow in documentation, detailing environment configuration (`backend/.env.example`), side-by-side instructions for zero-configuration Mock Mode (`MOCK_ANALYSIS=true`) and live Gemini integration (`gemini-3.5-flash-lite`), extension installation via Chrome Developer Mode, and health verification via `GET /health` (`{"status":"ok"}`).
- **Testing & Verification**: Added integration unit test coverage for the smart retry mechanism (`tests/extension/integration.test.js`). Verified all 7 acceptance testing scenarios (A through G). Documented regression baseline expanded to 163 automated tests (103 extension tests via Node.js built-in test runner + 60 backend tests via pytest), achieving a 100% pass rate.
- **Security & Epistemic Boundaries**: Re-verified credential isolation (Gemini API keys stay on the backend and are excluded from version control via `.gitignore`), ephemeral in-memory processing without databases, lengths-only structured logging, and passive XML data demarcation (`<CURRENT_INTERACTION>` and `<CONVERSATION_HISTORY>`) against prompt injection.
- **Known Limitations**: Automated unit tests simulate DOM environments; live manual validation in Chrome against `https://chatgpt.com` is required to verify layout compatibility against new OpenAI DOM changes. Live analysis requires an active Google Gemini API key with sufficient quota.

Detailed technical notes, audit findings, and verification matrices are preserved in [V0.9 technical notes](V0.9.md).

## V0.8 — Stabilization & Reliability

WDAIDT V0.8 is a comprehensive stabilization and reliability milestone dedicated to systematically auditing, hardening, and verifying all previously introduced functionality across the Chrome extension and FastAPI backend service without introducing new product features or breaking architectural changes.

- **Systematic Functional Audit**: Completed end-to-end verification across 7 core areas: ChatGPT DOM capture, multi-context reasoning, extension-to-backend integration, backend error handling, analysis quality and epistemic boundaries, Obsidian UI accessibility, and security/privacy guarantees.
- **Resilient Prompt Building**: Enhanced `backend/app/analysis/prompts.py` (`build_analysis_user_prompt`) to safely extract prompt and response fields from both Pydantic `ContextExchange` objects and dictionary payloads, preventing runtime serialization errors in multi-context requests.
- **Standardized Error Handling**: Verified uniform error envelopes (`{"error": {"code": "...", "message": "..."}}`) across all endpoints and unhandled routes, including custom 404 `NOT_FOUND` and 405 `METHOD_NOT_ALLOWED` handlers in `backend/app/main.py`. Confirmed graceful handling of `context: null` requests for backward compatibility.
- **New Integration Test Suite**: Created `tests/extension/integration.test.js` (11 tests), covering payload construction, custom instruction gating, HTTP error status mappings (413, 422, 429, 502, network failure, abort timeout), stale result dropping, and Auto Analyze toggle messaging.
- **New Backend Quality & Safety Tests**: Added 9 regression tests in `tests/backend/test_analyze.py` verifying diagnostic detection of ignored user constraints, contradicted environment clarifications, ambiguous follow-ups, omitted trade-offs, and passive data demarcation under adversarial prompt injections.
- **Live Gemini API Verification**: Confirmed live API execution using `gemini-3.5-flash-lite` for both single-turn queries and multi-context threads, verifying structured output adherence and anti-narration compliance.
- **Testing Baseline**: Documented regression baseline increased to 162 automated tests (102 extension tests + 60 backend tests), up from the 142 baseline of V0.7.

Detailed technical notes, verification checklists, and audit results are preserved in [V0.8 technical notes](V0.8.md).

## V0.7 — Multi-Context Analysis

WDAIDT V0.7 introduces Configurable Multi-Context Analysis, enabling Gemini to analyze the latest user-AI exchange alongside preceding exchanges from the same ChatGPT conversation to detect overlooked constraints, contradicted instructions, and ambiguous references.

- **Configurable Context Window**: Added a side panel settings selector allowing users to choose the maximum number of preceding exchanges included in the analysis: 0 (current exchange only), 3, 5 (default), or 10 previous exchanges. Setting persists in `chrome.storage.local` under `wdaidt_context_window`.
- **Maximum Limit Principle (Never a Minimum)**: Analysis proceeds cleanly regardless of whether 0, 1, 2, 5, or 12 prior turns exist. The system never blocks, waits for additional turns, or manufactures synthetic turns when fewer turns exist than the configured limit.
- **Separation of Concerns**: The current exchange (`prompt` and `response`) is always extracted, budgeted, and evaluated separately from historical context, and is never duplicated inside the history payload.
- **Turn Pairing & Regeneration Support**: Historical turns are ordered chronologically (oldest to newest). When an assistant turn contains multiple drafts due to regeneration, the latest settled draft is paired with the corresponding user prompt. Active in-progress streaming replies report `paired: false` and are never submitted prematurely.
- **Deterministic Budget Enforcement**: Enforced strict size budgets on both client and backend: 30,000 total characters for extension context payload, 40,000 characters and 20 exchanges for backend acceptance. Oversized history sheds older complete exchanges first, never creating partial or fragmented turns.
- **Extended API Contract**: Extended `POST /analyze` schema with an optional `context: List[ContextExchange]` field while maintaining 100% backward compatibility for callers omitting context.
- **Multi-Context Master Prompt Guidance**: Updated the system prompt in `backend/app/analysis/prompts.py` to instruct Gemini to treat preceding turns as diagnostic evidence for missed constraints or contradictions while strictly prohibiting conversation summarization.
- **UI Transparency Badge**: Added a dynamic badge to the Captured Interaction card header indicating the exact number of included context exchanges (`"Current exchange only"`, `"Context: 1 previous exchange"`, `"Context: N previous exchanges"`).
- **Testing Baseline**: Documented automated test suite reached 142 passing tests (91 extension tests + 51 backend tests).

Detailed technical notes, schemas, and budgeting algorithms are preserved in [V0.7 technical notes](V0.7.md).

## V0.6 — Adaptive Analysis Architecture

WDAIDT V0.6 replaces the legacy fixed four-field analysis structure (`why`, `influences`, `assumptions`, `what_could_change`) with an Adaptive Analysis Architecture and an Analysis Quality Engine, delivering dynamic diagnostic documents that prioritize actionable user next steps.

- **Dynamic Document Schema**: Introduced `AnalysisDocument` envelope containing an ordered list of validated content blocks, defined via Pydantic discriminated unions on the backend and rendered safely on the frontend.
- **9 Supported Block Types**: Implemented comprehensive support for headings (levels 1-6), explanatory paragraphs, ordered/unordered lists, code snippets (with one-click copy button), blockquotes, responsive tables, semantic callouts (`info`, `warning`, `caution`, `tip`, `note`, `important`), section dividers, and suggested next prompts (`next_prompt` with one-click copy button).
- **Authoritative Master Prompt**: Consolidated backend analysis instructions into a single master system prompt in `backend/app/analysis/prompts.py`. Explicitly prohibits generic response narration and superficial summaries, enforces epistemic modesty ("appears to", "seems to"), and demarcates conversation text as passive data.
- **Runtime Prompt Composition**: Added runtime prompt assembly combining the master prompt with user-selected Response Style guidance (or custom instructions) and Analysis Depth presets at request time.
- **Settings Panel & Presets**: Added a side panel settings drawer (`#settingsCard`) offering 7 Response Style presets (Friendly, Witty, Casual, Professional [default], Formal, Academic, and Custom instructions with dedicated textarea) and 3 Analysis Depth levels (Brief, Balanced [default], Detailed). Settings persist in `chrome.storage.local`.
- **Safe Dynamic Renderer**: Implemented a pure DOM renderer in `extension/src/sidepanel/app.js` utilizing `textContent` node creation, strictly avoiding `innerHTML` to eliminate XSS risks.
- **Layout Optimization & Audit**: Collapsed the Captured Interaction card by default to prioritize analysis visibility above the fold; removed the 600-character preview truncation in the expanded view in favor of an independently scrollable, bounded container (`max-height: 240px; overflow-y: auto`). Aligned displayed preview with backend payload limits (`trimForBackend`).
- **Testing Baseline**: Documented automated test suite reached 104 passing tests (68 extension tests + 36 backend tests).

Detailed technical notes, schema definitions, and design decisions are preserved in [V0.6 technical notes](V0.6.md).

## V0.5 — UI Modernization & Polish

WDAIDT V0.5 delivers a visual and interactive redesign of the side panel interface, introducing an adaptive theme system, animated controls, and enriched presentation cards.

- **Adaptive Dual-Theme System**: Implemented an adaptive theme system in `extension/src/sidepanel/styles.css` supporting light and dark modes matching ChatGPT's aesthetic and user OS preferences (`prefers-color-scheme: dark`) with neutral palettes and subtle borders.
- **Animated Controls & Status Indicators**: Replaced native checkbox controls with an iOS/Tailwind-style sliding toggle switch for Auto Analyze. Added a multi-state pulsing status indicator dot (Connected, Analyzing/Checking, Offline/Reconnecting).
- **Hero Analysis Presentation**: Redesigned analysis display with a highlighted summary callout box and color-accented categorical cards for influences, assumptions, and change levers.
- **One-Click Markdown Export**: Added a one-click **Copy** button in the analysis header that exports the complete analysis document to formatted Markdown with temporary visual confirmation.
- **Collapsible Interaction Drawer**: Built an accordion drawer for captured interactions with distinct speech-bubble badges and monospace text previews.
- **Skeleton Loading Animation**: Added a CSS shimmer placeholder animation displayed during analysis requests to eliminate layout jumping.
- **Documentation Standardization**: Standardized milestone documentation filenames to `V0.1.md` through `V0.5.md`.
- **Testing Baseline**: Preserved 100% test integrity across all 46 extension unit tests and 20 backend unit tests (66 total passing tests).

Detailed technical notes and interface specifications are preserved in [V0.5 technical notes](V0.5.md).

## V0.4 — Capture Reliability & SPA Hardening

WDAIDT V0.4 resolves critical single-page application (SPA) capture challenges in modern ChatGPT interfaces, ensuring reliable conversation extraction across multi-turn exchanges and client-side route transitions.

- **Multi-Turn Interaction Partitioning**: Partitioned DOM node discovery in `extension/src/content/chatgpt.js` into distinct assistant containers and user message bubbles. Outermost assistant blocks are retained while selecting leaf user messages strictly outside assistant containers, eliminating `RESPONSE_PENDING` errors on subsequent conversation turns.
- **Client-Side SPA Navigation Resilience**: Updated `chatScope()` to dynamically locate the newest rendered `<main>` element and added an automatic document-wide fallback in `getLatestInteraction()` to resolve conversations cleanly when switching threads or opening new chats.
- **System Survey & Disclaimer Filtering**: Added semantic filtering (`isFeedbackOrDisclaimer`) to exclude OpenAI feedback widgets (*"Is this conversation helpful so far?"*) and system footer disclaimers (*"ChatGPT can make mistakes..."*) from being mistaken for assistant responses. Added a 200-character safeguard to preserve genuine short user messages (e.g. "hi") and full assistant roadmaps.
- **Fixed Layout Wrapper Compatibility**: Scoped `isFixed()` to inspect target nodes directly rather than traversing all ancestors up to `<body>`, allowing primary fixed full-screen layout wrappers (`class="fixed inset-0"`) to be captured while continuing to exclude overlay portals and floating tooltips.
- **Side Panel Window Targeting**: Updated `getActiveTab()` in `extension/src/sidepanel/app.js` to query `lastFocusedWindow` before `currentWindow`, ensuring the active ChatGPT browser tab is resolved even when user focus resides inside the Chrome side panel.
- **Testing Baseline**: Expanded extension regression suite to 46 unit tests (`node --test tests/extension/*.test.js`); backend suite maintained at 20 unit tests (66 total passing tests).

Detailed technical notes, root causes, and regression tests are preserved in [V0.4 technical notes](V0.4.md).

## V0.3 — Capture Reliability Improvements

WDAIDT V0.3 hardens conversation capture against modern web accessibility markup and introduces automatic analysis triggers upon response stream completion.

- **Robust 5-Strategy Capture Pipeline**: Implemented a prioritized five-tier DOM extraction engine in `extension/src/content/chatgpt.js`: role attributes (`data-message-author-role`), message identifiers with action affordances (`data-message-id`), conversation turns (`data-testid*="conversation-turn"`), article tags (`main article`), and structural content blocks. Pierces open shadow roots.
- **Accessibility & Chrome Exclusion Bug Fix**: Resolved an issue where hidden accessibility live-regions (`aria-live`, `aria-hidden`) and UI chrome (menus, toolbars, drag-and-drop announcers) leaked into captured text. Gated `textContent` fallback behind `isRendered()` checks and excluded non-conversation elements from extraction.
- **Auto Analyze Stream Watcher**: Implemented a MutationObserver-based watcher in the content script that detects response stream completion with a 2-second settle debounce, triggering automatic analysis when the Auto toggle is enabled.
- **Stale-Result Protection**: Introduced client-generated `request_id` tracking in `extension/src/shared/messages.js` and enforced in the sidebar to silently discard out-of-order or superseded backend analysis results.
- **Honesty Hardening**: Removed client-side placeholder analysis generation on network failures; unreachable backends surface explicit staged errors with a **Retry** action. Made backend mock mode strictly opt-in (`MOCK_ANALYSIS=true`); missing API keys return an actionable HTTP 502 rather than silent mocks. Replaced raw interaction logging with lengths-only structured logs.
- **Extension Assets**: Added official WDAIDT icons (16px, 48px, 128px) in `extension/assets/` wired into `manifest.json`.
- **Testing Baseline**: Expanded test coverage to 39 extension tests and 20 backend unit tests (59 total passing tests).

Detailed technical notes, root-cause analyses, and reproduction test suites are preserved in [V0.3 technical notes](V0.3.md).

## V0.2 — Backend Foundation

WDAIDT V0.2 delivers the dedicated FastAPI backend service, providing schema validation, Google Gemini integration, error envelopes, and automated unit testing.

- **FastAPI Backend Service**: Built the backend application in `backend/app/main.py` with Uvicorn server integration, open CORS configuration (`*`) with credentials disabled for Chrome extension compatibility, and centralized exception handling.
- **Endpoints & Validation**: Implemented `GET /health` (`{"status": "ok"}`) and `POST /analyze`. Enforced input size limits (prompt max 8,000 characters, response max 20,000 characters) returning HTTP 413 `PAYLOAD_TOO_LARGE` when exceeded, and empty payload rejection returning HTTP 422 `INVALID_REQUEST`.
- **Pydantic Data Models**: Created schemas in `backend/app/models/analysis.py` for request payloads, analysis results, and standardized error envelopes (`{"error": {"code": "...", "message": "..."}}`).
- **Google Gemini Analysis Engine**: Integrated the Google GenAI SDK in `backend/app/analysis/analyzer.py` utilizing `gemini-3.5-flash-lite` with automatic 1-retry on malformed JSON, a 15-second timeout, and hedged epistemic prompt guidance.
- **Hermetic Mock Mode**: Provided an opt-in mock analysis mode (`MOCK_ANALYSIS=true`) returning realistic diagnostic evaluations without requiring external API credentials.
- **Test Dataset & Suite**: Created a curated test dataset with 6 interaction archetypes in `tests/backend/sample_data.py` (recommendation, ambiguous, factual, missing context, code-heavy, non-English) and 16 unit tests in `tests/backend/test_analyze.py` and `tests/backend/test_health.py`.
- **Testing Baseline**: Documented 16 backend unit tests passing cleanly.

Detailed technical notes, schemas, and test descriptions are preserved in [V0.2 technical notes](V0.2.md).

## V0.1 — Initial Extension Foundation

WDAIDT V0.1 establishes the initial Chrome Extension foundation using Manifest V3 and defines the foundational extension-to-backend API contract.

- **Manifest V3 Architecture**: Initialized Chrome extension in `extension/manifest.json` featuring Side Panel API integration, background service worker, and content script injection targeted at `chatgpt.com` and `chat.openai.com`.
- **ChatGPT DOM Capture**: Created initial content script in `extension/src/content/chatgpt.js` to detect ChatGPT web pages and extract the latest visible user prompt and assistant response.
- **Side Panel Interface**: Built side panel interface in `extension/src/sidepanel/` with manual **Why?** action button, captured interaction preview, and structured result cards.
- **API Agreement & Call Layer**: Defined single source of truth in `extension/src/shared/config.js` and `messages.js` specifying backend communication endpoints (`GET /health`, `POST /analyze`), timeout rules (20s extension timeout), character limits, and standard error mappings.
- **Partial Capture Handling**: Configured capture handling to explicitly report `(not captured)` when one side of an exchange is missing, preventing fields from being substituted or invented.
- **Auto Toggle Interface**: Added initial Auto toggle control in the side panel header (persisted in local storage, default OFF).
- **Testing Baseline**: Built initial extension smoke test in `tests/extension/day1.smoke.test.js` (5 passing tests).

Detailed technical notes and day-one delivery specifications are preserved in [V0.1 technical notes](V0.1.md).
