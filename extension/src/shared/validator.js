/* WDAIDT V2.0.0 — Validation, Normalization, and Error Models.
 * Converted from backend/app/models/analysis.py, exceptions.py, and api/analyze.py.
 * Single source of truth for request normalization, limits, and document schema validation.
 */

(() => {
  'use strict';

  const MAX_PROMPT_CHARS = 8000;
  const MAX_RESPONSE_CHARS = 20000;
  const MAX_TITLE_CHARS = 200;
  const MAX_BLOCKS = 50;
  const MAX_CONTEXT_EXCHANGES = 20;
  const MAX_CONTEXT_TOTAL_CHARS = 40000;

  const VALID_BLOCK_TYPES = Object.freeze([
    'heading',
    'paragraph',
    'list',
    'code',
    'quote',
    'table',
    'callout',
    'divider',
    'next_prompt'
  ]);

  const VALID_CALLOUT_VARIANTS = Object.freeze([
    'info',
    'warning',
    'caution',
    'tip',
    'note',
    'important'
  ]);

  class AnalysisError extends Error {
    constructor(code, message, statusCode = 500, headers = null, stage = 'analysis') {
      super(message);
      this.name = 'AnalysisError';
      this.code = code || 'INTERNAL';
      this.message = message || 'An unexpected error occurred.';
      this.statusCode = statusCode;
      this.headers = headers || {};
      this.stage = stage;
    }

    toJSON() {
      return {
        error: {
          code: this.code,
          message: this.message
        }
      };
    }
  }

  function cleanJsonText(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    const cleaned = rawText.trim();
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      return match[1].trim();
    }
    return cleaned;
  }

  function validateAnalysisRequest(request) {
    if (!request || typeof request !== 'object') {
      throw new AnalysisError(
        'INVALID_REQUEST',
        'Request body must be a valid JSON object.',
        422,
        null,
        'request_validation'
      );
    }

    const prompt = typeof request.prompt === 'string' ? request.prompt : '';
    const response = typeof request.response === 'string' ? request.response : '';

    if (!prompt.trim() || !response.trim()) {
      throw new AnalysisError(
        'INVALID_REQUEST',
        'Prompt and response must both be non-empty strings.',
        422,
        null,
        'request_validation'
      );
    }

    const promptLen = prompt.length;
    const responseLen = response.length;

    if (promptLen > MAX_PROMPT_CHARS || responseLen > MAX_RESPONSE_CHARS) {
      throw new AnalysisError(
        'PAYLOAD_TOO_LARGE',
        'Prompt, response, or context exceeds maximum allowed length.',
        413,
        null,
        'request_validation'
      );
    }

    let normalizedContext = [];
    if (request.context != null) {
      if (!Array.isArray(request.context)) {
        throw new AnalysisError(
          'INVALID_REQUEST',
          'Context must be an array of conversation exchanges.',
          422,
          null,
          'request_validation'
        );
      }

      if (request.context.length > MAX_CONTEXT_EXCHANGES) {
        throw new AnalysisError(
          'PAYLOAD_TOO_LARGE',
          'Prompt, response, or context exceeds maximum allowed length.',
          413,
          null,
          'request_validation'
        );
      }

      let totalContextChars = 0;
      normalizedContext = request.context.map((ex, idx) => {
        if (!ex || typeof ex !== 'object') {
          throw new AnalysisError(
            'INVALID_REQUEST',
            `Context exchange at index ${idx} must be an object.`,
            422,
            null,
            'request_validation'
          );
        }
        const exPrompt = typeof ex.prompt === 'string' ? ex.prompt : '';
        const exResp = typeof ex.response === 'string' ? ex.response : '';

        if (!exPrompt.trim() || !exResp.trim()) {
          throw new AnalysisError(
            'INVALID_REQUEST',
            'Context exchange prompt and response must both be non-empty strings.',
            422,
            null,
            'request_validation'
          );
        }

        if (exPrompt.length > MAX_PROMPT_CHARS || exResp.length > MAX_RESPONSE_CHARS) {
          throw new AnalysisError(
            'PAYLOAD_TOO_LARGE',
            'Prompt, response, or context exceeds maximum allowed length.',
            413,
            null,
            'request_validation'
          );
        }

        totalContextChars += exPrompt.length + exResp.length;
        return {
          prompt: exPrompt.trim(),
          response: exResp.trim()
        };
      });

      if (totalContextChars > MAX_CONTEXT_TOTAL_CHARS) {
        throw new AnalysisError(
          'PAYLOAD_TOO_LARGE',
          'Prompt, response, or context exceeds maximum allowed length.',
          413,
          null,
          'request_validation'
        );
      }
    }

    return {
      prompt: prompt.trim(),
      response: response.trim(),
      context: normalizedContext,
      request_id: request.request_id || null,
      response_style: typeof request.response_style === 'string' ? request.response_style : null,
      custom_instructions: typeof request.custom_instructions === 'string' ? request.custom_instructions : null,
      analysis_depth: typeof request.analysis_depth === 'string' ? request.analysis_depth : null
    };
  }

  function validateBlock(block, index = 0) {
    if (!block || typeof block !== 'object') {
      throw new AnalysisError(
        'INVALID_DOCUMENT',
        `Block at index ${index} must be an object.`,
        502,
        null,
        'document_validation'
      );
    }

    const type = typeof block.type === 'string' ? block.type.toLowerCase().trim() : '';

    if (!type) {
      throw new AnalysisError(
        'INVALID_DOCUMENT',
        `Block at index ${index} is missing a valid 'type' property.`,
        502,
        null,
        'document_validation'
      );
    }

    switch (type) {
      case 'heading': {
        const rawLevel = parseInt(block.level, 10);
        const level = Number.isInteger(rawLevel) && rawLevel >= 1 && rawLevel <= 6 ? rawLevel : 2;
        const content = typeof block.content === 'string' ? block.content.trim() : '';
        if (!content) {
          throw new AnalysisError('INVALID_DOCUMENT', `Heading block at index ${index} has empty content.`, 502, null, 'document_validation');
        }
        return {
          type: 'heading',
          level,
          content: content.slice(0, 1000)
        };
      }

      case 'paragraph': {
        const content = typeof block.content === 'string' ? block.content.trim() : '';
        if (!content) {
          throw new AnalysisError('INVALID_DOCUMENT', `Paragraph block at index ${index} has empty content.`, 502, null, 'document_validation');
        }
        return {
          type: 'paragraph',
          content: content.slice(0, 5000)
        };
      }

      case 'list': {
        const style = block.style === 'ordered' ? 'ordered' : 'unordered';
        const rawItems = Array.isArray(block.items) ? block.items : [];
        const items = rawItems
          .map((item) => (item != null ? String(item).trim() : ''))
          .filter(Boolean)
          .slice(0, 50);
        return {
          type: 'list',
          style,
          items
        };
      }

      case 'code': {
        const content = typeof block.content === 'string' ? block.content.trim() : '';
        if (!content) {
          throw new AnalysisError('INVALID_DOCUMENT', `Code block at index ${index} has empty content.`, 502, null, 'document_validation');
        }
        const language = typeof block.language === 'string' && block.language.trim()
          ? block.language.trim().slice(0, 50)
          : null;
        return {
          type: 'code',
          language,
          content: content.slice(0, 10000)
        };
      }

      case 'quote': {
        const content = typeof block.content === 'string' ? block.content.trim() : '';
        if (!content) {
          throw new AnalysisError('INVALID_DOCUMENT', `Quote block at index ${index} has empty content.`, 502, null, 'document_validation');
        }
        return {
          type: 'quote',
          content: content.slice(0, 3000)
        };
      }

      case 'table': {
        const rawHeaders = Array.isArray(block.headers) ? block.headers : [];
        const headers = rawHeaders.map((h) => String(h || '').trim()).slice(0, 20);
        const rawRows = Array.isArray(block.rows) ? block.rows : [];
        const rows = rawRows
          .filter(Array.isArray)
          .map((row) => row.map((cell) => String(cell || '').trim()))
          .slice(0, 50);
        return {
          type: 'table',
          headers,
          rows
        };
      }

      case 'callout': {
        const variant = VALID_CALLOUT_VARIANTS.includes(block.variant) ? block.variant : 'info';
        const title = typeof block.title === 'string' && block.title.trim()
          ? block.title.trim().slice(0, 150)
          : null;
        const content = typeof block.content === 'string' ? block.content.trim() : '';
        if (!content) {
          throw new AnalysisError('INVALID_DOCUMENT', `Callout block at index ${index} has empty content.`, 502, null, 'document_validation');
        }
        return {
          type: 'callout',
          variant,
          title,
          content: content.slice(0, 3000)
        };
      }

      case 'divider': {
        return { type: 'divider' };
      }

      case 'next_prompt': {
        const text = (typeof block.prompt === 'string' && block.prompt.trim()) ||
          (typeof block.content === 'string' && block.content.trim()) ||
          '';
        if (!text) {
          throw new AnalysisError('INVALID_DOCUMENT', `Next prompt block at index ${index} has empty prompt/content.`, 502, null, 'document_validation');
        }
        const title = typeof block.title === 'string' && block.title.trim()
          ? block.title.trim().slice(0, 150)
          : 'Suggested Next Prompt';
        const cleanPrompt = text.slice(0, 5000);
        return {
          type: 'next_prompt',
          prompt: cleanPrompt,
          content: cleanPrompt,
          title
        };
      }

      default: {
        // Unknown block type resilience: if content exists, gracefully fall back to paragraph
        if (typeof block.content === 'string' && block.content.trim()) {
          return {
            type: 'paragraph',
            content: block.content.trim().slice(0, 5000)
          };
        }
        throw new AnalysisError(
          'INVALID_DOCUMENT',
          `Unknown block type '${type}' without content at index ${index}.`,
          502,
          null,
          'document_validation'
        );
      }
    }
  }

  function validateAnalysisDocument(data) {
    if (!data || typeof data !== 'object') {
      throw new AnalysisError(
        'INVALID_DOCUMENT',
        'Analysis document payload must be an object.',
        502,
        null,
        'document_validation'
      );
    }

    const doc = (data.analysis && typeof data.analysis === 'object') ? data.analysis : data;

    const title = typeof doc.title === 'string' ? doc.title.trim() : '';
    if (!title) {
      throw new AnalysisError(
        'INVALID_DOCUMENT',
        "Analysis document is missing a non-empty 'title'.",
        502,
        null,
        'document_validation'
      );
    }

    if (!Array.isArray(doc.blocks) || doc.blocks.length === 0) {
      throw new AnalysisError(
        'INVALID_DOCUMENT',
        "Analysis document must contain a non-empty 'blocks' array.",
        502,
        null,
        'document_validation'
      );
    }

    if (doc.blocks.length > MAX_BLOCKS) {
      throw new AnalysisError(
        'INVALID_DOCUMENT',
        `Analysis document exceeds maximum allowed blocks (${MAX_BLOCKS}).`,
        502,
        null,
        'document_validation'
      );
    }

    const validatedBlocks = doc.blocks.map((b, i) => validateBlock(b, i));

    return {
      title: title.slice(0, MAX_TITLE_CHARS),
      blocks: validatedBlocks
    };
  }

  function parseAndValidateAnalysis(rawText, requestId = null) {
    const cleaned = cleanJsonText(rawText);
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new AnalysisError(
        'AI_PROVIDER_ERROR',
        `Failed to parse JSON analysis document: ${e.message}`,
        502,
        null,
        'json_parse'
      );
    }

    const doc = validateAnalysisDocument(parsed);
    return {
      request_id: requestId,
      analysis: doc
    };
  }

  const WDAIDT_VALIDATOR = Object.freeze({
    MAX_PROMPT_CHARS,
    MAX_RESPONSE_CHARS,
    MAX_TITLE_CHARS,
    MAX_BLOCKS,
    MAX_CONTEXT_EXCHANGES,
    MAX_CONTEXT_TOTAL_CHARS,
    VALID_BLOCK_TYPES,
    VALID_CALLOUT_VARIANTS,
    AnalysisError,
    cleanJsonText,
    validateAnalysisRequest,
    validateBlock,
    validateAnalysisDocument,
    parseAndValidateAnalysis
  });

  if (typeof self !== 'undefined') {
    self.WDAIDT_VALIDATOR = WDAIDT_VALIDATOR;
    self.AnalysisError = AnalysisError;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.WDAIDT_VALIDATOR = WDAIDT_VALIDATOR;
    globalThis.AnalysisError = AnalysisError;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WDAIDT_VALIDATOR;
  }
})();
