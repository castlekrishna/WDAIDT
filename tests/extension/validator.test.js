const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const validatorPath = path.join(__dirname, '..', '..', 'extension', 'src', 'shared', 'validator.js');
const {
  MAX_PROMPT_CHARS,
  MAX_RESPONSE_CHARS,
  MAX_TITLE_CHARS,
  MAX_BLOCKS,
  MAX_CONTEXT_EXCHANGES,
  MAX_CONTEXT_TOTAL_CHARS,
  AnalysisError,
  cleanJsonText,
  validateAnalysisRequest,
  validateBlock,
  validateAnalysisDocument,
  parseAndValidateAnalysis
} = require(validatorPath);

test('validator: AnalysisError serializes to agreed error envelope shape', () => {
  const err = new AnalysisError('INVALID_REQUEST', 'Prompt cannot be empty.', 422);
  assert.equal(err.code, 'INVALID_REQUEST');
  assert.equal(err.message, 'Prompt cannot be empty.');
  assert.equal(err.statusCode, 422);
  const json = err.toJSON();
  assert.deepEqual(json, {
    error: {
      code: 'INVALID_REQUEST',
      message: 'Prompt cannot be empty.'
    }
  });
});

test('validator: cleanJsonText strips markdown json fences', () => {
  const input1 = '```json\n{"title": "Test", "blocks": []}\n```';
  assert.equal(cleanJsonText(input1), '{"title": "Test", "blocks": []}');

  const input2 = '```\n{"title": "Raw"}\n```';
  assert.equal(cleanJsonText(input2), '{"title": "Raw"}');

  const input3 = '  {"title": "Clean"}  ';
  assert.equal(cleanJsonText(input3), '{"title": "Clean"}');
});

test('validator: validateAnalysisRequest accepts valid input with default fields', () => {
  const req = {
    prompt: 'How does indexing work in Postgres?',
    response: 'B-tree indexes organize data into balanced tree structures.',
    request_id: 'req-abc-123'
  };
  const normalized = validateAnalysisRequest(req);
  assert.equal(normalized.prompt, req.prompt);
  assert.equal(normalized.response, req.response);
  assert.equal(normalized.request_id, 'req-abc-123');
  assert.deepEqual(normalized.context, []);
});

test('validator: validateAnalysisRequest rejects empty or whitespace-only prompt/response', () => {
  assert.throws(
    () => validateAnalysisRequest({ prompt: '', response: 'Answer' }),
    (err) => err instanceof AnalysisError && err.code === 'INVALID_REQUEST' && err.statusCode === 422
  );

  assert.throws(
    () => validateAnalysisRequest({ prompt: '   ', response: 'Answer' }),
    (err) => err instanceof AnalysisError && err.code === 'INVALID_REQUEST' && err.statusCode === 422
  );

  assert.throws(
    () => validateAnalysisRequest({ prompt: 'Question', response: '' }),
    (err) => err instanceof AnalysisError && err.code === 'INVALID_REQUEST' && err.statusCode === 422
  );
});

test('validator: validateAnalysisRequest rejects oversized prompt (>8k) or response (>20k)', () => {
  const hugePrompt = 'x'.repeat(MAX_PROMPT_CHARS + 1);
  assert.throws(
    () => validateAnalysisRequest({ prompt: hugePrompt, response: 'Ans' }),
    (err) => err instanceof AnalysisError && err.code === 'PAYLOAD_TOO_LARGE' && err.statusCode === 413
  );

  const hugeResponse = 'y'.repeat(MAX_RESPONSE_CHARS + 1);
  assert.throws(
    () => validateAnalysisRequest({ prompt: 'Q', response: hugeResponse }),
    (err) => err instanceof AnalysisError && err.code === 'PAYLOAD_TOO_LARGE' && err.statusCode === 413
  );
});

test('validator: validateAnalysisRequest rejects context when exchanges exceed 20', () => {
  const context = Array.from({ length: 21 }, (_, i) => ({
    prompt: `P${i}`,
    response: `R${i}`
  }));
  assert.throws(
    () => validateAnalysisRequest({ prompt: 'Q', response: 'A', context }),
    (err) => err instanceof AnalysisError && err.code === 'PAYLOAD_TOO_LARGE' && err.statusCode === 413
  );
});

test('validator: validateAnalysisRequest rejects context when total characters exceed 40k', () => {
  const context = [
    { prompt: 'x'.repeat(7000), response: 'y'.repeat(15000) },
    { prompt: 'x'.repeat(7000), response: 'y'.repeat(15000) } // total = 44,000 > 40,000
  ];
  assert.throws(
    () => validateAnalysisRequest({ prompt: 'Q', response: 'A', context }),
    (err) => err instanceof AnalysisError && err.code === 'PAYLOAD_TOO_LARGE' && err.statusCode === 413
  );
});

test('validator: validateAnalysisRequest accepts valid context within bounds', () => {
  const context = [
    { prompt: 'Hello', response: 'Hi there!' },
    { prompt: 'Tell me about dogs', response: 'Dogs are loyal animals.' }
  ];
  const normalized = validateAnalysisRequest({ prompt: 'What about cats?', response: 'Cats are independent.', context });
  assert.equal(normalized.context.length, 2);
  assert.equal(normalized.context[0].prompt, 'Hello');
});

test('validator: validateBlock validates all 9 supported block types', () => {
  // 1. heading
  const h = validateBlock({ type: 'heading', level: 3, content: 'Section Header' });
  assert.equal(h.type, 'heading');
  assert.equal(h.level, 3);
  assert.equal(h.content, 'Section Header');

  // 2. paragraph
  const p = validateBlock({ type: 'paragraph', content: 'Explanatory content' });
  assert.equal(p.type, 'paragraph');
  assert.equal(p.content, 'Explanatory content');

  // 3. list
  const l = validateBlock({ type: 'list', style: 'ordered', items: ['Item 1', 'Item 2'] });
  assert.equal(l.type, 'list');
  assert.equal(l.style, 'ordered');
  assert.deepEqual(l.items, ['Item 1', 'Item 2']);

  // 4. code
  const c = validateBlock({ type: 'code', language: 'python', content: 'def foo(): pass' });
  assert.equal(c.type, 'code');
  assert.equal(c.language, 'python');
  assert.equal(c.content, 'def foo(): pass');

  // 5. quote
  const q = validateBlock({ type: 'quote', content: 'Quoted excerpt' });
  assert.equal(q.type, 'quote');
  assert.equal(q.content, 'Quoted excerpt');

  // 6. table
  const t = validateBlock({ type: 'table', headers: ['A', 'B'], rows: [['1', '2']] });
  assert.equal(t.type, 'table');
  assert.deepEqual(t.headers, ['A', 'B']);
  assert.deepEqual(t.rows, [['1', '2']]);

  // 7. callout
  const callout = validateBlock({ type: 'callout', variant: 'warning', title: 'Watch out', content: 'Cautionary note' });
  assert.equal(callout.type, 'callout');
  assert.equal(callout.variant, 'warning');
  assert.equal(callout.title, 'Watch out');
  assert.equal(callout.content, 'Cautionary note');

  // 8. divider
  const d = validateBlock({ type: 'divider' });
  assert.equal(d.type, 'divider');

  // 9. next_prompt (syncs prompt and content)
  const np = validateBlock({ type: 'next_prompt', prompt: 'Next suggested prompt text' });
  assert.equal(np.type, 'next_prompt');
  assert.equal(np.prompt, 'Next suggested prompt text');
  assert.equal(np.content, 'Next suggested prompt text');
  assert.equal(np.title, 'Suggested Next Prompt');
});

test('validator: validateBlock falls back unknown block with content to paragraph', () => {
  const fallback = validateBlock({ type: 'custom_widget', content: 'Recovered paragraph text' });
  assert.equal(fallback.type, 'paragraph');
  assert.equal(fallback.content, 'Recovered paragraph text');
});

test('validator: validateBlock rejects empty content blocks', () => {
  assert.throws(() => validateBlock({ type: 'paragraph', content: '' }));
  assert.throws(() => validateBlock({ type: 'heading', content: '  ' }));
  assert.throws(() => validateBlock({ type: 'code', content: '' }));
  assert.throws(() => validateBlock({ type: 'callout', content: '' }));
  assert.throws(() => validateBlock({ type: 'next_prompt', prompt: '' }));
});

test('validator: validateAnalysisDocument validates document structure and unwraps analysis property', () => {
  const rawDoc = {
    title: 'Diagnostic Overview',
    blocks: [
      { type: 'paragraph', content: 'The model omitted constraints.' },
      { type: 'next_prompt', prompt: 'Please restrict output to JSON.' }
    ]
  };

  const validated = validateAnalysisDocument(rawDoc);
  assert.equal(validated.title, 'Diagnostic Overview');
  assert.equal(validated.blocks.length, 2);

  // Unwraps { analysis: { ... } } wrapper if passed
  const wrapped = validateAnalysisDocument({ analysis: rawDoc });
  assert.equal(wrapped.title, 'Diagnostic Overview');
  assert.equal(wrapped.blocks.length, 2);
});

test('validator: validateAnalysisDocument rejects empty title or blocks', () => {
  assert.throws(() => validateAnalysisDocument({ title: '', blocks: [{ type: 'divider' }] }));
  assert.throws(() => validateAnalysisDocument({ title: 'T', blocks: [] }));
  assert.throws(() => validateAnalysisDocument({ title: 'T', blocks: null }));
});

test('validator: parseAndValidateAnalysis handles code fences and invalid JSON', () => {
  const validJsonFence = '```json\n{"title": "Fence Test", "blocks": [{"type": "divider"}]}\n```';
  const result = parseAndValidateAnalysis(validJsonFence, 'req-999');
  assert.equal(result.request_id, 'req-999');
  assert.equal(result.analysis.title, 'Fence Test');

  const invalidJson = 'Not valid JSON at all';
  assert.throws(
    () => parseAndValidateAnalysis(invalidJson),
    (err) => err instanceof AnalysisError && err.code === 'AI_PROVIDER_ERROR' && err.statusCode === 502
  );
});
