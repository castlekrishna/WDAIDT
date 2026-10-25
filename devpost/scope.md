---
doc: scope
status: approved
---

# Why Did AI Do That? (WDAIDT)

Real-time response diagnostics and actionable follow-up prompt generation for ChatGPT in the Chrome browser side panel.

## The Unique Kernel
WDAIDT provides instant, evidence-based diagnostic explanations for *why* an AI response took the form it did (highlighting overlooked constraints, omitted trade-offs, and implicit assumptions) alongside concrete, copyable follow-up prompts to steer the next interaction—operating natively in the browser side panel without polluting page DOM or requiring manual prompt copy-pasting.

## Who It's For
Developers, prompt engineers, researchers, and technical power users who converse with ChatGPT for coding, architecture, and complex reasoning, and frequently encounter responses that miss unstated boundaries, ignore constraints from earlier turns, or take unhelpful paths. Today, they manually dissect outputs, argue with the model, or restart the thread from scratch.

## The Core Loop
1. The user asks ChatGPT a technical or open-ended question.
2. When the assistant completes its reply, the user clicks **Why?** in the side panel (or lets **Auto Analyze** trigger automatically on stream completion).
3. The content script extracts the interaction and preceding context without page disruption.
4. The local backend diagnoses what influenced the answer, identifies missing constraints, and generates an actionable next prompt.
5. The user reviews the structured explanation in the side panel and clicks **Copy prompt** to steer the next turn immediately.

## Inspiration & Identity
- **Visuals**: Obsidian pitch-black (`#000000`) developer aesthetic, monochrome controls, subtle semantic status accents, pure DOM rendering with zero decorative gradients.
- **Tone**: Warm, encouraging, approachable, and technically precise by default ("Friendly and conversational"), with concise, high-impact diagnostic takeaways ("Brief").
- **Epistemic Modesty**: Strictly hedged observations ("appears to", "seems to") grounded in visible evidence; zero claims of inspecting private model weights or hidden activations.

## Why This Matters to the Learner
Debugging generative AI interactions is currently opaque and frustrating. Building WDAIDT proves that coding agents and developers can build reliable, non-intrusive browser-integrated diagnostic tools that make AI behavior transparent and immediately improvable.

## What "Working" Looks Like
A user opens ChatGPT, asks for an implementation with a constraint (e.g. "quicksort for a 16KB RAM microcontroller"), receives a standard recursive quicksort, clicks **Why?** in the sidebar, and immediately sees:
- A clear diagnostic notice that the AI overlooked the 16KB stack memory boundary.
- A callout highlighting recursive call-stack exhaustion risks.
- A ready-to-use follow-up prompt: *"Can you provide an iterative version with an explicit bounded stack?"* with a one-click copy button.

## The POC Boundary
- **In-Scope**:
  - Chrome Extension (Manifest V3) using the native Side Panel API.
  - Multi-tier DOM extraction for ChatGPT conversations (`chatgpt.com` and `chat.openai.com`).
  - Stream mutation watcher for automatic analysis upon generation settle.
  - Configurable multi-context reasoning (0, 3, 5, 10 previous exchanges; default: 5).
  - FastAPI local backend supporting both hermetic zero-config Mock Mode and live Google Gemini (`gemini-3.5-flash-lite`).
  - Structured dynamic analysis documents supporting 9 validated block types (headings, paragraphs, lists, code with copy button, blockquotes, tables, callout variants, section dividers, and suggested next prompts).
  - Resilient retry recovery retaining captured interactions on network or server reconnects.
  - Obsidian pitch-black theme with keyboard accessibility and local persistence in `chrome.storage.local`.
- **Later (Post-POC)**:
  - Multi-platform support for Claude, Google Gemini web interfaces, and DeepSeek.
  - Interactive SVG diff viewers and collapsible tree explorers.
  - Vault-level export to local Markdown notes and Obsidian folders.
- **Explicitly Cut**:
  - User accounts and cloud databases: Cut to maintain zero data persistence and absolute privacy.
  - Modifying ChatGPT's live page DOM: Cut to avoid breaking OpenAI's rendering lifecycle or risking account suspension.
  - Model weight inspection or simulated private activations: Cut because external tools cannot observe hidden weights; claims must remain epistemically honest.
