/* WDAIDT V2.0.0 — Google Gemini REST API Client.
 * Connects directly from the Chrome extension to Google's Generative Language API.
 * Uses x-goog-api-key header authentication and responseMimeType: "application/json".
 * Never exposes API keys in URLs, error messages, or logs.
 */

(() => {
  'use strict';

  function getValidator() {
    if (typeof globalThis !== 'undefined' && globalThis.WDAIDT_VALIDATOR) {
      return globalThis.WDAIDT_VALIDATOR;
    }
    if (typeof require !== 'undefined') {
      try { return require('./validator.js'); } catch { /* ignore */ }
    }
    return {};
  }

  function getPrompts() {
    if (typeof globalThis !== 'undefined' && globalThis.WDAIDT_PROMPTS) {
      return globalThis.WDAIDT_PROMPTS;
    }
    if (typeof require !== 'undefined') {
      try { return require('./prompts.js'); } catch { /* ignore */ }
    }
    return {};
  }

  function getConfig() {
    if (typeof globalThis !== 'undefined' && globalThis.WDAIDT_CONFIG) {
      return globalThis.WDAIDT_CONFIG;
    }
    if (typeof require !== 'undefined') {
      try { return require('./config.js'); } catch { /* ignore */ }
    }
    return {};
  }

  function maskKey(key) {
    if (!key || typeof key !== 'string') return '';
    const trimmed = key.trim();
    if (trimmed.length <= 8) return '••••••••';
    return trimmed.slice(0, 4) + '••••' + trimmed.slice(-4);
  }

  async function callGeminiOnce(params, modelCandidate, fetchFn) {
    const cfg = getConfig();
    const prompts = getPrompts();
    const validator = getValidator();
    const AnalysisError = validator.AnalysisError || Error;

    const base = (cfg.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const url = `${base}/models/${modelCandidate}:generateContent`;

    const systemInstruction = prompts.composeSystemInstructions
      ? prompts.composeSystemInstructions(params.response_style, params.custom_instructions, params.analysis_depth)
      : '';

    const userPrompt = prompts.buildAnalysisUserPrompt
      ? prompts.buildAnalysisUserPrompt(params.prompt, params.response, params.context)
      : `${params.prompt}\n\n${params.response}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    };

    const timeoutMs = params.timeout_ms || cfg.FETCH_TIMEOUT_MS || 20000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': params.api_key.trim()
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (res.status === 400) {
        let errMsg = 'Gemini rejected the request arguments.';
        try {
          const errData = await res.json();
          if (errData?.error?.message) {
            // Strip any sensitive reflection
            errMsg = errData.error.message.replace(/key=[^&\s]+/gi, 'key=REDACTED');
          }
        } catch { /* ignore */ }
        throw new AnalysisError('INVALID_ARGUMENT', errMsg, 400, null, 'api');
      }

      if (res.status === 401 || res.status === 403) {
        throw new AnalysisError(
          'API_KEY_INVALID',
          'Invalid or unauthorized Gemini API key. Please check your key in Settings.',
          res.status,
          null,
          'auth'
        );
      }

      if (res.status === 429) {
        throw new AnalysisError(
          'RATE_LIMITED',
          'Gemini quota exceeded or rate limited. Please wait a moment and retry.',
          429,
          null,
          'api'
        );
      }

      if (res.status === 404) {
        let notFoundMsg = 'The requested Gemini model is unavailable or retired.';
        try {
          const errData = await res.json();
          if (errData?.error?.message) {
            notFoundMsg = errData.error.message.replace(/key=[^&\s]+/gi, 'key=REDACTED');
          }
        } catch { /* ignore */ }
        const err = new AnalysisError('AI_PROVIDER_ERROR', notFoundMsg, 404, null, 'api');
        err.isTransient = true;
        err.isNotFound = true;
        throw err;
      }

      if (res.status === 500 || res.status === 503) {
        const err = new AnalysisError(
          'AI_PROVIDER_ERROR',
          `Gemini service temporarily unavailable (${res.status}).`,
          res.status,
          null,
          'api'
        );
        err.isTransient = true;
        throw err;
      }

      if (!res.ok) {
        throw new AnalysisError(
          'AI_PROVIDER_ERROR',
          `Gemini API returned HTTP ${res.status}.`,
          res.status,
          null,
          'api'
        );
      }

      const data = await res.json();
      const candidate = data?.candidates?.[0];

      if (candidate?.finishReason === 'SAFETY') {
        throw new AnalysisError(
          'AI_PROVIDER_ERROR',
          'Gemini flagged the conversation under safety policies and could not generate an analysis.',
          502,
          null,
          'safety'
        );
      }

      const text = candidate?.content?.parts?.[0]?.text;
      if (!text || !text.trim()) {
        throw new AnalysisError(
          'AI_PROVIDER_ERROR',
          'Gemini returned an empty or unparseable response.',
          502,
          null,
          'api'
        );
      }

      return text;
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new AnalysisError('TIMEOUT', 'Gemini took too long (>20s).', 504, null, 'network');
      }
      if (e instanceof (validator.AnalysisError || Error) && e.code) {
        throw e;
      }
      throw new AnalysisError(
        'NETWORK',
        'Unable to reach the Gemini API. Check your internet connection.',
        0,
        null,
        'network'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function callGemini(params, fetchFn) {
    const fn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fn) {
      throw new Error('fetch implementation is required for callGemini.');
    }

    const cfg = getConfig();
    const validator = getValidator();
    const AnalysisError = validator.AnalysisError || Error;

    // 1. Request normalization and bounds validation
    if (validator.validateAnalysisRequest) {
      validator.validateAnalysisRequest(params);
    }

    // 2. API Key presence validation
    const apiKey = typeof params.api_key === 'string' ? params.api_key.trim() : '';
    if (!apiKey) {
      throw new AnalysisError(
        'API_KEY_MISSING',
        'Gemini API key is not configured. Please add your API key in Settings, or enable Mock Mode.',
        401,
        null,
        'auth'
      );
    }

    // 3. Prepare model candidates (configured model first, then fallbacks)
    const configuredModel = params.model || cfg.GEMINI_DEFAULT_MODEL || 'gemini-3.5-flash-lite';
    const fallbackList = Array.isArray(cfg.GEMINI_FALLBACK_MODELS)
      ? cfg.GEMINI_FALLBACK_MODELS
      : ['gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];

    const candidates = [configuredModel];
    fallbackList.forEach((m) => {
      if (!candidates.includes(m)) candidates.push(m);
    });

    // 4. Deliberate 2-attempt parse/validation loop per V1.0.0 agreement
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      let rawText = null;
      let modelError = null;

      // Model candidate loop (fallback if 500 / 503 / 404 unavailable)
      for (let i = 0; i < candidates.length; i++) {
        const modelCandidate = candidates[i];
        try {
          rawText = await callGeminiOnce(params, modelCandidate, fn);
          modelError = null;
          break;
        } catch (err) {
          const isLastCandidate = i === candidates.length - 1;
          if ((err.isTransient || err.isNotFound) && !isLastCandidate) {
            modelError = err;
            continue; // try next candidate model
          }
          if (err.isNotFound) {
            throw new AnalysisError(
              'AI_PROVIDER_ERROR',
              'The configured Gemini model is unavailable or retired. Please check your model settings.',
              404,
              null,
              'api'
            );
          }
          throw err;
        }
      }

      if (!rawText && modelError) {
        if (modelError.isNotFound) {
          throw new AnalysisError(
            'AI_PROVIDER_ERROR',
            'The configured Gemini model is unavailable or retired. Please check your model settings.',
            404,
            null,
            'api'
          );
        }
        throw modelError;
      }

      try {
        if (validator.parseAndValidateAnalysis) {
          return validator.parseAndValidateAnalysis(rawText, params.request_id);
        }
        const cleaned = validator.cleanJsonText ? validator.cleanJsonText(rawText) : rawText;
        const parsed = JSON.parse(cleaned);
        const doc = validator.validateAnalysisDocument ? validator.validateAnalysisDocument(parsed) : parsed;
        return {
          request_id: params.request_id || null,
          analysis: doc
        };
      } catch (parseErr) {
        lastError = new AnalysisError(
          'AI_PROVIDER_ERROR',
          'Analysis failed. The model output could not be validated. Please try again.',
          502,
          null,
          'validation'
        );
      }
    }

    if (lastError) throw lastError;

    throw new AnalysisError(
      'AI_PROVIDER_ERROR',
      'Analysis failed. Please try again.',
      502,
      null,
      'api'
    );
  }

  async function verifyApiKey(apiKey, timeoutMs = 5000, fetchFn) {
    const fn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fn) {
      return { valid: false, error: 'NO_FETCH', message: 'No fetch function available.' };
    }

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { valid: false, error: 'API_KEY_MISSING', message: 'API key cannot be empty.' };
    }

    const cfg = getConfig();
    const base = (cfg.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const url = `${base}/models?pageSize=1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fn(url, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey.trim()
        },
        signal: controller.signal
      });

      if (res.ok) {
        return { valid: true };
      }

      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { valid: false, error: 'API_KEY_INVALID', message: 'Invalid or unauthorized API key.' };
      }

      return { valid: false, error: 'API_ERROR', message: `Server returned status ${res.status}.` };
    } catch (e) {
      if (e.name === 'AbortError') {
        return { valid: false, error: 'TIMEOUT', message: 'Verification timed out.' };
      }
      return { valid: false, error: 'NETWORK', message: 'Could not reach Gemini service.' };
    } finally {
      clearTimeout(timer);
    }
  }

  const WDAIDT_GEMINI_CLIENT = Object.freeze({
    callGemini,
    verifyApiKey,
    maskKey
  });

  if (typeof self !== 'undefined') {
    self.WDAIDT_GEMINI_CLIENT = WDAIDT_GEMINI_CLIENT;
    self.wdaidtCallGemini = callGemini;
    self.wdaidtVerifyApiKey = verifyApiKey;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.WDAIDT_GEMINI_CLIENT = WDAIDT_GEMINI_CLIENT;
    globalThis.wdaidtCallGemini = callGemini;
    globalThis.wdaidtVerifyApiKey = verifyApiKey;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WDAIDT_GEMINI_CLIENT;
  }
})();
