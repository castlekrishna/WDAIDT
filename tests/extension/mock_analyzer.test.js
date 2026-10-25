const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mockPath = path.join(__dirname, '..', '..', 'extension', 'src', 'shared', 'mock-analyzer.js');
const validatorPath = path.join(__dirname, '..', '..', 'extension', 'src', 'shared', 'validator.js');
const { generateMockAnalysis } = require(mockPath);
const { validateAnalysisDocument } = require(validatorPath);

test('mock_analyzer: factual query returns satisfactory diagnosis without manufactured criticism', () => {
  const result = generateMockAnalysis({
    prompt: 'What is the capital of France?',
    response: 'The capital of France is Paris.',
    request_id: 'mock-fact-1',
    analysis_depth: 'Brief'
  });

  assert.equal(result.request_id, 'mock-fact-1');
  assert.ok(result.analysis.title.includes('Satisfactory Factual Exchange:'));
  assert.equal(result.analysis.blocks.length, 1);
  assert.equal(result.analysis.blocks[0].type, 'paragraph');
  assert.ok(result.analysis.blocks[0].content.includes('directly and accurately satisfy'));

  // Validates cleanly against document schema
  const validated = validateAnalysisDocument(result.analysis);
  assert.equal(validated.title, result.analysis.title);
});

test('mock_analyzer: factual query with non-Brief depth adds assessment tip callout', () => {
  const result = generateMockAnalysis({
    prompt: 'Who wrote Hamlet?',
    response: 'William Shakespeare wrote Hamlet.',
    analysis_depth: 'Balanced'
  });

  assert.equal(result.analysis.blocks.length, 2);
  assert.equal(result.analysis.blocks[0].type, 'paragraph');
  assert.equal(result.analysis.blocks[1].type, 'callout');
  assert.equal(result.analysis.blocks[1].variant, 'tip');
  assert.equal(result.analysis.blocks[1].title, 'Assessment');
});

test('mock_analyzer: factual query with context adds context observed callout', () => {
  const context = [
    { prompt: 'Tell me about France.', response: 'France is a country in Western Europe.' }
  ];
  const result = generateMockAnalysis({
    prompt: 'What is the capital of France?',
    response: 'Paris.',
    context
  });

  assert.equal(result.analysis.blocks.length, 2);
  assert.equal(result.analysis.blocks[1].type, 'callout');
  assert.equal(result.analysis.blocks[1].variant, 'info');
  assert.equal(result.analysis.blocks[1].title, 'Context Observed');
  assert.ok(result.analysis.blocks[1].content.includes('Evaluated alongside 1 preceding exchange(s)'));
});

test('mock_analyzer: general query with Brief depth produces single diagnostic paragraph', () => {
  const result = generateMockAnalysis({
    prompt: 'How do I build a scalable web service in Go?',
    response: 'Use the standard net/http package and goroutines.',
    analysis_depth: 'Brief'
  });

  assert.ok(result.analysis.title.includes('Interaction Diagnosis:'));
  assert.equal(result.analysis.blocks.length, 1);
  assert.equal(result.analysis.blocks[0].type, 'paragraph');
  assert.ok(result.analysis.blocks[0].content.includes('broad, generalized interpretation'));
});

test('mock_analyzer: general query with Balanced depth produces findings and next prompt', () => {
  const result = generateMockAnalysis({
    prompt: 'How do I build a scalable web service in Go?',
    response: 'Use standard net/http and goroutines.',
    analysis_depth: 'Balanced'
  });

  assert.equal(result.analysis.blocks.length, 4);
  assert.equal(result.analysis.blocks[0].type, 'paragraph');
  assert.equal(result.analysis.blocks[1].type, 'heading');
  assert.equal(result.analysis.blocks[1].content, 'Diagnostic Findings');
  assert.equal(result.analysis.blocks[2].type, 'list');
  assert.equal(result.analysis.blocks[2].items.length, 2);
  assert.equal(result.analysis.blocks[3].type, 'next_prompt');
  assert.equal(result.analysis.blocks[3].title, 'Suggested Next Prompt');
  assert.ok(result.analysis.blocks[3].prompt.includes('Considering my specific context'));
});

test('mock_analyzer: general query with Detailed depth adds underlying assumption callout', () => {
  const result = generateMockAnalysis({
    prompt: 'How do I build a scalable web service in Go?',
    response: 'Use standard net/http and goroutines.',
    analysis_depth: 'Detailed'
  });

  assert.equal(result.analysis.blocks.length, 5);
  assert.equal(result.analysis.blocks[0].type, 'paragraph');
  assert.equal(result.analysis.blocks[1].type, 'heading');
  assert.equal(result.analysis.blocks[2].type, 'list');
  assert.equal(result.analysis.blocks[3].type, 'callout');
  assert.equal(result.analysis.blocks[3].title, 'Underlying Assumption');
  assert.equal(result.analysis.blocks[4].type, 'next_prompt');
});

test('mock_analyzer: context awareness adjusts initial diagnosis paragraph', () => {
  const context = [
    { prompt: 'I am building an embedded IoT device.', response: 'IoT requires low memory usage.' }
  ];
  const result = generateMockAnalysis({
    prompt: 'Write a web server for my project.',
    response: 'Here is a heavy Spring Boot application.',
    context,
    analysis_depth: 'Balanced'
  });

  assert.ok(result.analysis.blocks[0].content.includes('Evaluated the latest exchange alongside 1 preceding exchange(s)'));
  assert.ok(result.analysis.blocks[0].content.includes('overlooks key constraints previously discussed'));
});

test('mock_analyzer: all mock outputs conform strictly to document schema', () => {
  const testCases = [
    { prompt: 'What is the speed of light?', response: 'Approx 300,000 km/s', analysis_depth: 'Brief' },
    { prompt: 'How many days in a week?', response: '7 days', analysis_depth: 'Detailed' },
    { prompt: 'Implement OAuth in Python', response: 'Use Authlib', analysis_depth: 'Brief' },
    { prompt: 'Implement OAuth in Python', response: 'Use Authlib', analysis_depth: 'Balanced' },
    { prompt: 'Implement OAuth in Python', response: 'Use Authlib', analysis_depth: 'Detailed' }
  ];

  for (const tc of testCases) {
    const res = generateMockAnalysis(tc);
    const validated = validateAnalysisDocument(res.analysis);
    assert.ok(validated.title.length > 0);
    assert.ok(validated.blocks.length > 0);
  }
});
