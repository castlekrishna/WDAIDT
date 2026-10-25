---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast

## Slices

- [x] **1. Extension Foundation & Visible Capture (V0.1)**
  Becomes usable: Chrome extension loaded in side panel captures latest visible prompt and response from ChatGPT and previews in sidebar.
  Why now: Proves the whole client path end to end on the first slice — MV3 manifest, content script, side panel UI.
  PRD ref: `prd.md > The Core Journey` (steps 1–3)
  Spec ref: `spec.md > Components > Content Script`, `spec.md > Components > Side Panel Controller`
  Build: Scaffolded extension directory, added `manifest.json`, `chatgpt.js`, and side panel controller with manual **Why?** trigger.
  Verify (mechanical): Ran `node --test tests/extension/day1.smoke.test.js` (5 passing).
  Learner check: Opened ChatGPT, verified side panel opens and captures text.
  Commit: `Day 1 (V0.1): Lidiya extension - MV3 setup, ChatGPT capture, sidebar + manual Why?`

- [x] **2. FastAPI Backend & Gemini Analysis Engine (V0.2)**
  Becomes usable: Local backend receives prompt/response, evaluates via Gemini or mock mode, and returns structured diagnosis.
  Why now: Establishes the server contract and enables hermetic offline testing without external costs.
  PRD ref: `prd.md > The Core Journey` (step 6)
  Spec ref: `spec.md > Components > FastAPI Service`, `spec.md > Components > Master Prompt & Analysis Engine`
  Build: Built FastAPI app with CORS, Pydantic schemas, Gemini client with 15s timeout and automatic retry, and mock fallback.
  Verify (mechanical): Ran `python -m pytest tests/backend/ -v` (16 passing).
  Learner check: Verified `GET /health` returns `{"status":"ok"}`.
  Commit: `Day 2 (V0.2): Krishna backend - FastAPI service, Gemini analyzer, contract compliance & unit tests`

- [x] **3. Capture Reliability & Auto Analyze Watcher (V0.3)**
  Becomes usable: Streaming completion automatically triggers analysis; accessibility chrome and toolbars are filtered out.
  Why now: Prevents spurious captures from corrupting analysis and automates repetitive manual clicks.
  PRD ref: `prd.md > Features and Behavior > Capture Engine`
  Spec ref: `spec.md > Components > Content Script`
  Build: Added MutationObserver stream watcher (2s debounce), stale-result guard (`request_id`), and excluded `aria-hidden`/live announcer text.
  Verify (mechanical): Ran 39 extension tests and 20 backend tests cleanly.
  Learner check: Verified live announcer text is never captured as a prompt.
  Commit: `Fix capture: exclude overlay/a11y chrome, require complete pairs in structural fallback`

- [x] **4. SPA Multi-Turn Hardening & Container Scoping (V0.4)**
  Becomes usable: Reliable turn extraction across multi-turn exchanges, route changes, and fixed SPA container layouts.
  Why now: Real-world ChatGPT usage is multi-turn; previous turns must not swallow child user messages.
  PRD ref: `prd.md > Features and Behavior > Capture Engine`
  Spec ref: `spec.md > Components > Content Script`
  Build: Partitioned assistant and user containers, added survey filter (`isFeedbackOrDisclaimer`), and scoped active `<main>` element.
  Verify (mechanical): Ran 46 extension tests and 20 backend tests cleanly.
  Learner check: Executed 5 consecutive back-and-forth turns in ChatGPT without dropped turns.
  Commit: `feat(day4): harden multi-turn SPA capture, exclude surveys/disclaimers, and update docs`

- [x] **5. Obsidian Theme & Interactive Side Panel (V0.5)**
  Becomes usable: Polished developer aesthetic, collapsible interaction accordion drawer, and one-click Markdown export.
  Why now: Transforms raw developer output into a focused, distraction-free analysis workspace.
  PRD ref: `prd.md > Look and Feel`, `prd.md > Screens and Layout`
  Spec ref: `spec.md > Look and Feel`
  Build: Pitch-black styling (`#000000`), status pulsing dot, skeleton shimmer loading, and formatted clipboard export.
  Verify (mechanical): Verified DOM ID preservation across all unit tests.
  Learner check: Copied full analysis document to clipboard in clean Markdown format.
  Commit: `feat(v0.5): modernize UI with dark/light theme, toggle switch, and version docs`

- [x] **6. Adaptive Document Architecture & 9 Block Types (V0.6)**
  Becomes usable: Gemini outputs variable dynamic documents with 9 block types including copyable code and suggested next prompts.
  Why now: Rigid 4-field forms failed to express rich technical diagnoses and actionable steering prompts.
  PRD ref: `prd.md > Features and Behavior > Dynamic Analysis Renderer`
  Spec ref: `spec.md > Components > Side Panel Controller`, `spec.md > Data Model`
  Build: Pydantic discriminated union blocks, pure DOM `textContent` renderer, master anti-narration prompt, tone/depth settings.
  Verify (mechanical): Ran 104 automated tests (68 extension + 36 backend).
  Learner check: Rendered code snippets and verified one-click copy functionality.
  Commit: `feat: WDAIDT V0.6 — Adaptive Analysis Architecture, Dynamic Document Renderer & Quality Overhaul`

- [x] **7. Multi-Context Analysis & Sizing Budgets (V0.7)**
  Becomes usable: Configurable context window (0, 3, 5, 10 previous exchanges) detects overlooked constraints across turns.
  Why now: Models frequently overlook constraints set early in a long conversation.
  PRD ref: `prd.md > The Core Journey` (step 5)
  Spec ref: `spec.md > Data Model`, `spec.md > Components > Content Script`
  Build: Added context window selector, 30k char extension budget enforcement, chronological turn pairing, and context UI badge.
  Verify (mechanical): Ran 142 automated tests (91 extension + 51 backend).
  Learner check: Submitted 16KB microcontroller constraint in turn 1 and verified diagnosis in turn 2.
  Commit: `feat: WDAIDT V0.7 — Multi-Context Analysis & Configurable Context Window`

- [x] **8. Stabilization & Live Gemini Verification (V0.8)**
  Becomes usable: Standardized 404/405 envelopes, prompt injection isolation, and confirmed live Gemini API execution.
  Why now: Hardens edge cases, ensures security boundaries, and proves live provider compatibility.
  PRD ref: `prd.md > Features and Behavior > Error Recovery & Resilience`
  Spec ref: `spec.md > External Services and Dependencies`
  Build: Standardized error handlers, passive XML delimiters, live Gemini test verification (`gemini-3.5-flash-lite`).
  Verify (mechanical): Ran 162 automated tests (102 extension + 60 backend).
  Learner check: Verified live Gemini call with real API key generated context-aware title.
  Commit: `feat: WDAIDT V0.8 — Stabilization & Reliability Release`

- [x] **9. Submission Polish & Smart Retry Recovery (V0.9)**
  Becomes usable: Instant retry without tab re-selection upon server recovery; high-contrast keyboard navigation; escape dismissal.
  Why now: Eliminates friction during evaluation and ensures keyboard accessibility.
  PRD ref: `prd.md > Features and Behavior > Error Recovery & Resilience`
  Spec ref: `spec.md > Important Failure Modes`
  Build: Added `runRetry()` using `lastCapture`, fixed `:focus-visible` ring variable, added `Escape` key listener.
  Verify (mechanical): Ran 163 automated tests (103 extension + 60 backend).
  Learner check: Stopped server, observed error card, restarted server, clicked Retry &rarr; succeeded instantly.
  Commit: `feat: WDAIDT V0.9 — Submission Polish & Release Readiness`

- [x] **10. Usability Defaults & Documentation Elevation (V0.9.1)**
  Becomes usable: Default tone is Friendly, default explanation is Brief; user-facing README with setup wizard and zero emojis.
  Why now: Reduces evaluator cognitive load and delivers fast, approachable diagnostic results immediately.
  PRD ref: `prd.md > Features and Behavior > Settings System`
  Spec ref: `spec.md > Stack`
  Build: Updated `DEFAULT_RESPONSE_STYLE` and `DEFAULT_ANALYSIS_DEPTH`, restructured README, scrubbed emojis.
  Verify (mechanical): Ran 163 tests; verified zero emojis and valid links.
  Learner check: Evaluator opens side panel &rarr; Friendly & Brief are selected by default.
  Commit: `feat: WDAIDT V0.9.1 — Usability Defaults & Documentation Restructure`

- [x] **11. Hackathon Compliance, Planning Artifacts & Audit (V0.9.2)**
  Becomes usable: Canonical planning artifacts (`scope.md`, `prd.md`, `spec.md`, `checklist.md`), MIT license, and submission readiness audit.
  Why now: Formally fulfills hackathon documentation standards and provides evidence-based compliance verification.
  PRD ref: `prd.md > What We're Building`
  Spec ref: `spec.md > File Structure`
  Build: Added root and devpost planning docs, MIT LICENSE, submission readiness report, synchronized V0.9.2 metadata.
  Verify (mechanical): Syntax checks, manifest validation, full test suites (163 passing), zero-emoji audit.
  Learner check: Inspect `docs/SUBMISSION_READINESS.md` and verify all requirements.
  Commit: `Release V0.9.2: Hackathon compliance, planning artifacts, licensing, and submission readiness`

- [x] **12. Final Skill Pack Alignment & Visual App Map (V0.9.3)**
  Becomes usable: Official Skill Pack alignment documentation (`devpost/skillpack-usage.md`) and standalone visual architectural map (`devpost/app-map.html`).
  Why now: Delivers the formal visual code tour artifact and transparently audits adopted vs adapted Skill Pack recommendations.
  PRD ref: `prd.md > What We're Building`
  Spec ref: `spec.md > Architecture Diagram & Components`
  Build: Added `devpost/skillpack-usage.md`, `devpost/app-map.html`, updated submission readiness audit matrix.
  Verify (mechanical): Automated test suite verified (163 passing), zero-dependency offline rendering check.
  Learner check: Open `devpost/app-map.html` in browser and verify SVG diagram and code stops.
  Commit: `feat: WDAIDT V0.9.3 — Final Skill Pack Alignment & Architectural Map`

- [x] **13. Final Stabilization, Verification & Release Preparation (V1.0.0)**
  Becomes usable: Production-ready V1.0.0 release of the Chrome Extension and FastAPI backend, standalone extension distribution package, and release documentation.
  Why now: Final stable release milestone establishing canonical 1.0.0 versioning, verified test baselines, clean release deliverables, and reproducible local startup.
  PRD ref: `prd.md > What We're Building`
  Spec ref: `spec.md > Stack`
  Build: Synchronized version 1.0.0 across all components, created clean Chrome extension ZIP package, authored V1.0.0 release notes (`docs/V1.0.0.md`), updated README and changelog.
  Verify (mechanical): Full regression baseline executed (104 extension tests + 61 backend tests, 165 total passing), zero syntax errors, clean ZIP structure verified.
  Learner check: Verified standalone extension loads in Chrome and communicates with local FastAPI backend on `http://localhost:8000`.
  Commit: `Release WDAIDT v1.0.0: Final stabilization, verification, and release preparation`

## Hands-on Checkpoints
- [x] Early usable behavior explored — V0.1 manual capture verified in Chrome side panel.
- [x] Mid-build multi-turn checkpoint — V0.4 multi-turn conversation extraction verified live.
- [x] Final kick-the-tires exploration and feedback completed — V0.9.1/V0.9.2 end-to-end evaluation with mock mode and live Gemini.

## Final Review
- [x] Final review complete — feedback resolved and project confirmed ready for submission audit.

## Code Tour and App Map
- [x] Learning activity complete — audit of 6-tier DOM extraction pipeline, FastAPI validation envelopes, and Gemini prompt composition.
- [x] Optional edit and transfer reflection addressed — default settings tuned to Friendly and Brief.
- [x] Standalone visual architecture map generated in `devpost/app-map.html`.

Activity and evidence: 163 passing automated unit/integration tests, zero security vulnerabilities, full epistemic modesty compliance.
Route and stops: `extension/src/content/chatgpt.js` (`getLatestExchange`) &rarr; `backend/app/api/analyze.py` (`analyze_interaction`) &rarr; `extension/src/sidepanel/app.js` (`renderBlock`).
Visual artifact: [`devpost/app-map.html`](app-map.html) (standalone, zero-dependency offline architecture map).
Activity mode: live app in Chrome and local FastAPI service.

## Revisions
- Slices expanded from fixed 4-field analysis to flexible 9-block Dynamic Document Architecture (V0.6) after discovering that fixed categories forced generic narration.
- Multi-context window bounded to a maximum rather than a minimum (V0.7) after discovering that early turns in new chats should never block analysis.
- Smart retry implemented using retained `lastCapture` in memory (V0.9) to prevent tab focus loss during server disconnects.
- Default explanation depth shifted to "Brief" and tone to "Friendly and conversational" (V0.9.1) to optimize first-run evaluator experience.
- Standalone architectural map artifact and code tour generated as `devpost/app-map.html` and full Skill Pack recommendation audit documented in `devpost/skillpack-usage.md` (V0.9.3).
