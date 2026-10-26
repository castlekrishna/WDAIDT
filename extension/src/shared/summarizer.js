/**
 * @file summarizer.js
 * @description WDAIDT V3 Incremental Conversation Summarizer.
 *
 * Responsibilities:
 *  1. Generates compact, structured summaries capturing user goals, key facts,
 *     constraints, decisions, unresolved questions, and next steps.
 *  2. Updates summaries incrementally by tracking source message checkpoints
 *     instead of reprocessing the entire conversation history from scratch.
 *  3. Inactive/no-op detection when no new messages exist.
 *  4. Invalidation handling: marks affected summaries stale upon message edits
 *     or regenerated turns.
 *  5. Concurrency & version-safety: guarantees slow asynchronous requests cannot
 *     overwrite newer summary revisions.
 *  6. Transaction isolation: never holds open IndexedDB transactions across network
 *     fetches. All IDB interactions use discrete synchronous-boundary transactions.
 *  7. Preserves the last successful summary if a new generation attempt fails.
 */

(() => {
  'use strict';

  const SUMMARIZER_SYSTEM_PROMPT = `You are the Conversation Summarizer for WDAIDT.
Your purpose is to produce a dense, compact, factual summary of conversation history to provide background context for AI interaction analysis.

CORE RULES:
1. Extract:
   - Goal: the user's primary objective or problem being solved.
   - Facts: important entities, versions, technical details, code architectures, or facts stated by user or assistant.
   - Constraints: explicit user rules, limitations, style/tool requirements.
   - Decisions: choices agreed upon or established.
   - Unresolved: open questions or issues still pending.
   - Next Steps: immediate next actions planned.
2. Be concise: Avoid pleasantries, conversational fluff, and generic descriptions. Total summary must be under 200 words.
3. Be strictly factual: Do NOT invent facts or guess intentions not present in the dialogue. If something is uncertain, state the uncertainty.
4. Output Format:
   Respond with plain text formatted with these exact section headers:
   Goal: <concise user goal>
   Facts: <bullet points or comma-separated facts>
   Constraints: <explicit rules and constraints>
   Decisions: <key decisions made>
   Unresolved: <open questions, or "None">
   Next Steps: <next steps, or "None">`;

  function parseSummarySections(rawText) {
    const text = String(rawText || '').trim();
    const constraints = [];
    const activeTopics = [];

    const goalMatch = text.match(/Goal:\s*([^\n]+)/i);
    if (goalMatch && goalMatch[1]) {
      const g = goalMatch[1].trim();
      if (g && g.toLowerCase() !== 'none') {
        activeTopics.push(g);
      }
    }

    const factsMatch = text.match(/Facts:\s*([^\n]+(?:\n(?!\b(?:Goal|Facts|Constraints|Decisions|Unresolved|Next Steps):)[^\n]+)*)/i);
    if (factsMatch && factsMatch[1]) {
      const lines = factsMatch[1].split(/[\n,;]+/).map(s => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
      for (const line of lines.slice(0, 3)) {
        if (!activeTopics.includes(line)) activeTopics.push(line);
      }
    }

    const constraintsMatch = text.match(/Constraints:\s*([^\n]+(?:\n(?!\b(?:Goal|Facts|Constraints|Decisions|Unresolved|Next Steps):)[^\n]+)*)/i);
    if (constraintsMatch && constraintsMatch[1]) {
      const lines = constraintsMatch[1].split(/[\n,;]+/).map(s => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
      for (const line of lines) {
        if (line.toLowerCase() !== 'none') constraints.push(line);
      }
    }

    return {
      compactSummary: text,
      activeTopics,
      constraints
    };
  }

  function buildIncrementalSummaryPrompt(previousSummary, newMessages) {
    let prompt = '';
    if (previousSummary) {
      prompt += `PREVIOUS SUMMARY:\n${previousSummary}\n\n`;
      prompt += `NEW CONVERSATION TURNS (to integrate incrementally into the summary):\n`;
    } else {
      prompt += `CONVERSATION TURNS TO SUMMARIZE:\n`;
    }

    newMessages.forEach((m, idx) => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      prompt += `[Turn ${idx + 1}] ${role}: ${m.content}\n`;
    });

    prompt += `\nUpdate the summary following the system instructions. Update goals, add new facts/constraints/decisions, resolve any questions answered in the new turns, and update next steps.`;
    return prompt;
  }

  function generateMockSummary(previousSummary, newMessages) {
    let goal = 'Assisting user with technical requirements and design decisions.';
    const facts = [];
    const constraints = [];
    const decisions = [];
    const unresolved = [];
    const nextSteps = [];

    // Analyze new messages
    for (const m of newMessages) {
      const c = m.content || '';
      if (m.role === 'user' && !facts.length) {
        goal = c.slice(0, 100).replace(/\n/g, ' ').trim();
      }
      if (/must|cannot|limit|require|only/i.test(c)) {
        constraints.push(c.slice(0, 80).replace(/\n/g, ' ').trim());
      }
      if (/decided|agreed|chosen|selected|approve/i.test(c)) {
        decisions.push(c.slice(0, 80).replace(/\n/g, ' ').trim());
      }
      if (/\?/.test(c)) {
        unresolved.push(c.slice(0, 80).replace(/\n/g, ' ').trim());
      }
    }

    if (previousSummary) {
      facts.push('Integrated previous discussion history.');
    }

    return [
      `Goal: ${goal}`,
      `Facts: ${facts.length ? facts.join('; ') : 'Dialogue exchanges captured and indexed.'}`,
      `Constraints: ${constraints.length ? constraints.join('; ') : 'None'}`,
      `Decisions: ${decisions.length ? decisions.join('; ') : 'None'}`,
      `Unresolved: ${unresolved.length ? unresolved.slice(-1)[0] : 'None'}`,
      `Next Steps: Continue active interaction analysis.`
    ].join('\n');
  }

  async function callGeminiForSummary(params, fetchFn) {
    const fetchImpl = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) throw new Error('No fetch implementation available for Gemini API.');

    const baseUrl = (params.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const model = String(params.model || 'gemini-3.5-flash-lite').trim().replace(/^models\//, '');
    const url = `${baseUrl}/models/${model}:generateContent`;

    const payload = {
      systemInstruction: {
        parts: [{ text: SUMMARIZER_SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: params.prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 600
      }
    };

    const controller = new AbortController();
    const timeoutMs = params.timeoutMs || 20000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': String(params.apiKey || '').trim()
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Gemini API error: HTTP ${res.status}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text || !text.trim()) {
        throw new Error('Gemini returned an empty summary.');
      }
      return text.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generates or incrementally updates the conversation summary.
   *
   * @param {Object} storage - WDAIDT storage engine
   * @param {Object} options
   * @param {string} options.conversationId - Conversation UUID
   * @param {string} [options.apiKey] - Google Gemini API key
   * @param {string} [options.model] - Gemini model identifier
   * @param {boolean} [options.mockMode=false] - Whether to use local mock summarizer
   * @param {Function} [options.generateSummary] - Custom generator override
   * @param {Function} [options.fetch] - Custom fetch override
   * @param {boolean} [options.force=false] - Skip minimum turn threshold
   * @param {number} [options.minNewMessages=2] - Minimum new messages required to trigger update
   *
   * @returns {Promise<Object>} SummarizerResult
   */
  async function summarizeConversation(storage, options = {}) {
    const conversationId = options.conversationId;
    if (!conversationId) {
      return { success: false, error: 'conversationId is required.' };
    }
    if (!storage || typeof storage.getConversationMemory !== 'function') {
      return { success: false, error: 'Valid storage engine is required.' };
    }

    // ── Phase 1: Read Database (Complete all IDB transactions before network) ──
    let conv = null;
    let mem = null;
    let messages = [];

    try {
      conv = await storage.getConversation(conversationId);
      if (!conv) {
        return { success: false, error: `Conversation "${conversationId}" not found.` };
      }
      mem = await storage.getConversationMemory(conversationId);
      messages = await storage.getMessagesByConversation(conversationId, { reverse: false });
    } catch (readErr) {
      return { success: false, error: readErr.message };
    }

    if (!messages.length) {
      return { success: true, status: 'no_op', reason: 'empty_conversation', memory: mem };
    }

    // Check if new messages exist since last checkpoint
    let newMessages = [];
    let previousSummaryText = null;
    const isStale = mem && mem.status === 'stale';

    if (mem && mem.compactSummary && !isStale && mem.sourceMessageCheckpoint) {
      const checkpointIdx = messages.findIndex(m => m.messageId === mem.sourceMessageCheckpoint);
      if (checkpointIdx >= 0) {
        newMessages = messages.slice(checkpointIdx + 1);
        previousSummaryText = mem.compactSummary;

        if (newMessages.length === 0) {
          // All messages already incorporated in summary
          return { success: true, status: 'no_op', reason: 'up_to_date', memory: mem };
        }

        const minNew = typeof options.minNewMessages === 'number' ? options.minNewMessages : 2;
        if (!options.force && newMessages.length < minNew) {
          // Below minimum threshold for incremental trigger
          return { success: true, status: 'no_op', reason: 'below_threshold', newCount: newMessages.length, memory: mem };
        }
      } else {
        // Checkpoint not found in current message stream; re-summarize full thread
        newMessages = messages;
        previousSummaryText = null;
      }
    } else {
      // First-time summary or re-building after invalidation/stale state
      newMessages = messages;
      previousSummaryText = null;
    }

    const targetCheckpoint = messages[messages.length - 1].messageId;
    const targetRevision = (mem ? (mem.summaryRevision || 0) : 0) + 1;
    const readTimestamp = Date.now();
    const generationId = `gen_${readTimestamp}_${Math.random().toString(36).slice(2, 8)}`;

    // ── Phase 2: Generate Summary via AI (Zero IDB transactions held open) ────
    let apiKey = options.apiKey;
    let mockMode = options.mockMode;
    let model = options.model;

    if (!apiKey && typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
      try {
        const stored = await chrome.storage.local.get([
          'wdaidt_gemini_api_key',
          'wdaidt_mock_mode',
          'wdaidt_gemini_model'
        ]);
        if (stored) {
          if (!apiKey && stored.wdaidt_gemini_api_key) {
            apiKey = stored.wdaidt_gemini_api_key;
          }
          if (mockMode === undefined && typeof stored.wdaidt_mock_mode === 'boolean') {
            mockMode = stored.wdaidt_mock_mode;
          }
          if (!model && stored.wdaidt_gemini_model) {
            model = stored.wdaidt_gemini_model;
          }
        }
      } catch {
        /* storage read failure non-fatal */
      }
    }

    const prompt = buildIncrementalSummaryPrompt(previousSummaryText, newMessages);
    let rawSummaryText = '';

    try {
      if (typeof options.generateSummary === 'function') {
        rawSummaryText = await options.generateSummary(prompt, SUMMARIZER_SYSTEM_PROMPT);
      } else if (mockMode || (!apiKey && typeof chrome === 'undefined')) {
        rawSummaryText = generateMockSummary(previousSummaryText, newMessages);
      } else {
        if (!apiKey) {
          throw new Error('Gemini API key is not configured.');
        }
        rawSummaryText = await callGeminiForSummary({
          apiKey,
          model,
          prompt
        }, options.fetch);
      }
    } catch (genErr) {
      // Failed generation: preserve previous summary in DB and mark error/retry state
      try {
        await storage.setConversationMemory({
          conversationId,
          schemaVersion: 1,
          summaryRevision: mem ? (mem.summaryRevision || 0) : 0,
          sourceMessageCheckpoint: mem ? mem.sourceMessageCheckpoint : null,
          generationId,
          status: (mem && mem.compactSummary) ? (isStale ? 'stale' : 'ready') : 'failed',
          updatedAt: Date.now(),
          retryCount: (mem ? (mem.retryCount || 0) : 0) + 1,
          lastError: genErr.message,
          compactSummary: mem ? mem.compactSummary : '',
          activeTopics: mem ? (mem.activeTopics || []) : [],
          constraints: mem ? (mem.constraints || []) : []
        });
      } catch {
        /* non-fatal DB write */
      }

      return {
        success: false,
        error: genErr.message,
        preservedSummary: mem ? mem.compactSummary : null
      };
    }

    // ── Phase 3: Concurrency Check & Commit (Discrete new IDB transaction) ────
    try {
      const currentMem = await storage.getConversationMemory(conversationId);

      // Concurrency check: Ensure a newer summary was not committed while awaiting AI response
      if (currentMem && currentMem.summaryRevision >= targetRevision) {
        return {
          success: true,
          status: 'stale_response',
          reason: 'superseded_by_newer_revision',
          memory: currentMem
        };
      }

      // Check if conversation was invalidated by edits while in flight
      let targetStatus = 'ready';
      if (currentMem && currentMem.status === 'stale' && currentMem.updatedAt > readTimestamp) {
        targetStatus = 'stale';
      }

      const parsed = parseSummarySections(rawSummaryText);

      const savedRecord = await storage.setConversationMemory({
        conversationId,
        schemaVersion: 1,
        summaryRevision: targetRevision,
        sourceMessageCheckpoint: targetCheckpoint,
        generationId,
        status: targetStatus,
        updatedAt: Date.now(),
        retryCount: 0,
        lastError: null,
        compactSummary: parsed.compactSummary,
        activeTopics: parsed.activeTopics,
        constraints: parsed.constraints
      });

      return {
        success: true,
        status: targetStatus === 'stale' ? 'stale_committed' : 'ready',
        memory: savedRecord
      };
    } catch (commitErr) {
      return { success: false, error: commitErr.message };
    }
  }

  const WDAIDT_SUMMARIZER = Object.freeze({
    summarizeConversation,
    parseSummarySections,
    buildIncrementalSummaryPrompt,
    generateMockSummary,
    SUMMARIZER_SYSTEM_PROMPT
  });

  if (typeof self !== 'undefined') {
    self.WDAIDT_SUMMARIZER = WDAIDT_SUMMARIZER;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.WDAIDT_SUMMARIZER = WDAIDT_SUMMARIZER;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WDAIDT_SUMMARIZER, ...WDAIDT_SUMMARIZER };
  }
})();
