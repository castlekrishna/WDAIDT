const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const clientPath = path.join(__dirname, '..', '..', 'extension', 'src', 'shared', 'gemini-client.js');
const { callGemini, verifyApiKey, maskKey } = require(clientPath);
const { AnalysisError } = require(path.join(__dirname, '..', '..', 'extension', 'src', 'shared', 'validator.js'));

function createMockFetch(responses) {
  let callCount = 0;
  const calls = [];

  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    const resp = responses[callCount] || responses[responses.length - 1];
    callCount++;

    if (resp instanceof Error) {
      throw resp;
    }

    return {
      status: resp.status || 200,
      ok: resp.status ? resp.status >= 200 && resp.status < 300 : true,
      json: async () => resp.body
    };
  };

  fetchFn.getCalls = () => calls;
  fetchFn.getCallCount = () => callCount;
  return fetchFn;
}

test('gemini_client: callGemini throws API_KEY_MISSING when apiKey is omitted or empty', async () => {
  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: '' }),
    (err) => err instanceof AnalysisError && err.code === 'API_KEY_MISSING' && err.statusCode === 401
  );

  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A' }),
    (err) => err instanceof AnalysisError && err.code === 'API_KEY_MISSING' && err.statusCode === 401
  );
});

test('gemini_client: callGemini throws INVALID_REQUEST on empty prompt/response before network call', async () => {
  const mockFetch = createMockFetch([]);
  await assert.rejects(
    () => callGemini({ prompt: '', response: 'A', api_key: 'test-key' }, mockFetch),
    (err) => err instanceof AnalysisError && err.code === 'INVALID_REQUEST' && err.statusCode === 422
  );
  assert.equal(mockFetch.getCallCount(), 0, 'No fetch should have occurred');
});

test('gemini_client: callGemini transmits verified payload format and x-goog-api-key header', async () => {
  const dummyDoc = {
    title: 'Diagnostic Finding',
    blocks: [{ type: 'paragraph', content: 'The model omitted error handling.' }]
  };
  const mockFetch = createMockFetch([
    {
      status: 200,
      body: {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(dummyDoc) }]
            },
            finishReason: 'STOP'
          }
        ]
      }
    }
  ]);

  const result = await callGemini(
    {
      prompt: 'Write an express route',
      response: 'app.get("/users", async (req, res) => res.json(users));',
      api_key: 'AIzaSyFakeSecretKey123',
      request_id: 'req-42',
      analysis_depth: 'Brief'
    },
    mockFetch
  );

  assert.equal(result.request_id, 'req-42');
  assert.equal(result.analysis.title, 'Diagnostic Finding');
  assert.equal(result.analysis.blocks.length, 1);

  const calls = mockFetch.getCalls();
  assert.equal(calls.length, 1);
  const call = calls[0];

  // Header authentication used, NOT query parameter
  assert.equal(call.options.headers['x-goog-api-key'], 'AIzaSyFakeSecretKey123');
  assert.ok(!call.url.includes('AIzaSyFakeSecretKey123'), 'API key must NEVER be in URL query parameters');
  assert.ok(call.url.includes('/models/gemini-3.5-flash-lite:generateContent'));

  // Payload structure verification
  const parsedBody = JSON.parse(call.options.body);
  assert.ok(parsedBody.systemInstruction?.parts?.[0]?.text);
  assert.ok(parsedBody.contents?.[0]?.parts?.[0]?.text.includes('CURRENT_INTERACTION'));
  assert.equal(parsedBody.generationConfig?.responseMimeType, 'application/json');
  assert.equal(parsedBody.generationConfig?.temperature, 0.2);
});

test('gemini_client: callGemini maps 401 and 403 status to API_KEY_INVALID', async () => {
  const mockFetch401 = createMockFetch([{ status: 401, body: { error: { message: 'API key expired' } } }]);
  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'bad-key' }, mockFetch401),
    (err) => err instanceof AnalysisError && err.code === 'API_KEY_INVALID' && err.statusCode === 401
  );

  const mockFetch403 = createMockFetch([{ status: 403, body: { error: { message: 'Permission denied' } } }]);
  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'bad-key' }, mockFetch403),
    (err) => err instanceof AnalysisError && err.code === 'API_KEY_INVALID' && err.statusCode === 403
  );
});

test('gemini_client: callGemini maps 429 status to RATE_LIMITED without retrying', async () => {
  const mockFetch = createMockFetch([{ status: 429, body: { error: { message: 'Resource exhausted' } } }]);
  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch),
    (err) => err instanceof AnalysisError && err.code === 'RATE_LIMITED' && err.statusCode === 429
  );
  assert.equal(mockFetch.getCallCount(), 1, 'Rate limit must not trigger automated retries');
});

test('gemini_client: callGemini maps 400 status to INVALID_ARGUMENT', async () => {
  const mockFetch = createMockFetch([{ status: 400, body: { error: { message: 'Unsupported field in payload' } } }]);
  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch),
    (err) => err instanceof AnalysisError && err.code === 'INVALID_ARGUMENT' && err.statusCode === 400
  );
});

test('gemini_client: callGemini falls back to alternative model on 503 unavailable', async () => {
  const dummyDoc = {
    title: 'Fallback Analysis',
    blocks: [{ type: 'divider' }]
  };
  const mockFetch = createMockFetch([
    { status: 503, body: { error: { message: 'Model overloaded' } } },
    {
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: JSON.stringify(dummyDoc) }] } }]
      }
    }
  ]);

  const result = await callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch);
  assert.equal(result.analysis.title, 'Fallback Analysis');
  assert.equal(mockFetch.getCallCount(), 2);
  assert.ok(mockFetch.getCalls()[0].url.includes('gemini-3.5-flash-lite'));
  assert.ok(mockFetch.getCalls()[1].url.includes('gemini-flash-latest'));
});

test('gemini_client: callGemini falls back to alternative model on 404 model retirement/unavailable', async () => {
  const dummyDoc = {
    title: 'Fallback on 404 Analysis',
    blocks: [{ type: 'divider' }]
  };
  const mockFetch = createMockFetch([
    { status: 404, body: { error: { message: 'This model models/gemini-2.5-flash is no longer available to new users.' } } },
    {
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: JSON.stringify(dummyDoc) }] } }]
      }
    }
  ]);

  const result = await callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch);
  assert.equal(result.analysis.title, 'Fallback on 404 Analysis');
  assert.equal(mockFetch.getCallCount(), 2);
  assert.ok(mockFetch.getCalls()[0].url.includes('gemini-3.5-flash-lite'));
  assert.ok(mockFetch.getCalls()[1].url.includes('gemini-flash-latest'));
});

test('gemini_client: callGemini surfaces clear message when all model candidates fail with 404', async () => {
  const mockFetch = createMockFetch([
    { status: 404, body: { error: { message: 'Model 1 retired' } } },
    { status: 404, body: { error: { message: 'Model 2 retired' } } },
    { status: 404, body: { error: { message: 'Model 3 retired' } } },
    { status: 404, body: { error: { message: 'Model 4 retired' } } },
    { status: 404, body: { error: { message: 'Model 5 retired' } } }
  ]);

  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch),
    (err) => err instanceof AnalysisError && err.statusCode === 404 && err.message.includes('configured Gemini model is unavailable or retired')
  );
  assert.equal(mockFetch.getCallCount(), 5);
});

test('gemini_client: callGemini retries once on malformed JSON then succeeds', async () => {
  const dummyDoc = {
    title: 'Recovered Document',
    blocks: [{ type: 'paragraph', content: 'Proper JSON recovered on attempt 2.' }]
  };
  const mockFetch = createMockFetch([
    {
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: 'Here is your analysis: {malformed json' }] } }]
      }
    },
    {
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: JSON.stringify(dummyDoc) }] } }]
      }
    }
  ]);

  const result = await callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch);
  assert.equal(result.analysis.title, 'Recovered Document');
  assert.equal(mockFetch.getCallCount(), 2);
});

test('gemini_client: callGemini throws AI_PROVIDER_ERROR when retries on bad JSON are exhausted', async () => {
  const mockFetch = createMockFetch([
    {
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'Broken json 1' }] } }] }
    },
    {
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'Broken json 2' }] } }] }
    }
  ]);

  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch),
    (err) => err instanceof AnalysisError && err.code === 'AI_PROVIDER_ERROR'
  );
  assert.equal(mockFetch.getCallCount(), 2);
});

test('gemini_client: callGemini maps AbortError to TIMEOUT', async () => {
  const abortErr = new Error('The operation was aborted.');
  abortErr.name = 'AbortError';
  const mockFetch = createMockFetch([abortErr]);

  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch),
    (err) => err instanceof AnalysisError && err.code === 'TIMEOUT' && err.statusCode === 504
  );
});

test('gemini_client: callGemini maps network failure to NETWORK', async () => {
  const netErr = new TypeError('Failed to fetch');
  const mockFetch = createMockFetch([netErr]);

  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'test-key' }, mockFetch),
    (err) => err instanceof AnalysisError && err.code === 'NETWORK'
  );
});

test('gemini_client: verifyApiKey validates key status correctly', async () => {
  const okFetch = createMockFetch([{ status: 200, body: { models: [] } }]);
  const res1 = await verifyApiKey('valid-key-123', 5000, okFetch);
  assert.equal(res1.valid, true);

  const badFetch = createMockFetch([{ status: 400, body: { error: { message: 'API key not valid' } } }]);
  const res2 = await verifyApiKey('bad-key', 5000, badFetch);
  assert.equal(res2.valid, false);
  assert.equal(res2.error, 'API_KEY_INVALID');

  const emptyRes = await verifyApiKey('', 5000, okFetch);
  assert.equal(emptyRes.valid, false);
  assert.equal(emptyRes.error, 'API_KEY_MISSING');
});

test('gemini_client: maskKey masks keys safely', () => {
  assert.equal(maskKey(''), '');
  assert.equal(maskKey(null), '');
  assert.equal(maskKey('short'), '••••••••');
  assert.equal(maskKey('AIzaSyD-1234567890abcdef'), 'AIza••••cdef');
});

test('gemini_client regression: callGemini strips models/ prefix from candidate models preventing duplicate /models/models/ 404 URL', async () => {
  const dummyDoc = {
    title: 'Model Prefix Normalization',
    blocks: [{ type: 'divider' }]
  };
  const mockFetch = createMockFetch([
    {
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: JSON.stringify(dummyDoc) }] } }]
      }
    }
  ]);

  const res = await callGemini({
    prompt: 'Question with model prefix',
    response: 'Answer',
    model: 'models/gemini-3.5-flash-lite',
    api_key: 'test-key'
  }, mockFetch);

  assert.equal(res.analysis.title, 'Model Prefix Normalization');
  const calledUrl = mockFetch.getCalls()[0].url;
  assert.ok(!calledUrl.includes('/models/models/'), `URL must not contain duplicate /models/models/: ${calledUrl}`);
  assert.ok(calledUrl.endsWith('/models/gemini-3.5-flash-lite:generateContent'));
});

test('gemini_client regression: callGemini maps HTTP 400 with API_KEY_INVALID to API_KEY_INVALID error code', async () => {
  const mockFetch = createMockFetch([
    {
      status: 400,
      body: {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }]
        }
      }
    }
  ]);

  await assert.rejects(
    () => callGemini({ prompt: 'Q', response: 'A', api_key: 'bad-key-returning-400' }, mockFetch),
    (err) => err instanceof AnalysisError && err.code === 'API_KEY_INVALID' && err.stage === 'auth'
  );
});
