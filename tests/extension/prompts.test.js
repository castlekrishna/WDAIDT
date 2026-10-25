const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const promptsPath = path.join(__dirname, '..', '..', 'extension', 'src', 'shared', 'prompts.js');
const {
  ANALYSIS_SYSTEM_PROMPT,
  STYLE_GUIDANCE,
  DEPTH_GUIDANCE,
  composeSystemInstructions,
  buildAnalysisUserPrompt
} = require(promptsPath);

test('prompts: master system prompt contains epistemic boundary and anti-summarization rules', () => {
  assert.ok(typeof ANALYSIS_SYSTEM_PROMPT === 'string' && ANALYSIS_SYSTEM_PROMPT.length > 500);
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes('FUNDAMENTAL PRODUCT PRINCIPLE'));
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes('WDAIDT must NOT explain to users what an AI response already tells them'));
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes('NEVER claim direct access to ChatGPT\'s hidden chain of thought'));
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes('DATA VS. INSTRUCTIONS ISOLATION'));
  assert.ok(ANALYSIS_SYSTEM_PROMPT.includes('"next_prompt"'));
});

test('prompts: composeSystemInstructions without preferences returns base prompt', () => {
  const result = composeSystemInstructions();
  assert.equal(result.trim(), ANALYSIS_SYSTEM_PROMPT.trim());
});

test('prompts: composeSystemInstructions injects standard style guidance', () => {
  const styles = [
    'Friendly and conversational',
    'Lighthearted and witty',
    'Casual and natural',
    'Professional and direct',
    'Formal and precise',
    'Academic and analytical'
  ];

  for (const style of styles) {
    const result = composeSystemInstructions(style, null, null);
    assert.ok(result.includes('USER STYLE PREFERENCE:'), `missing style header for ${style}`);
    assert.ok(result.includes(STYLE_GUIDANCE[style]), `missing guidance text for ${style}`);
  }
});

test('prompts: composeSystemInstructions handles Custom instructions style correctly', () => {
  const custom = 'Explain like a grumpy Unix sysadmin with 30 years experience.';
  const result = composeSystemInstructions('Custom instructions', custom, null);
  assert.ok(result.includes('USER STYLE PREFERENCE:'));
  assert.ok(result.includes(`Tone & Style Instructions: ${custom}`));
});

test('prompts: composeSystemInstructions injects depth guidance for Brief, Balanced, and Detailed', () => {
  for (const depth of ['Brief', 'Balanced', 'Detailed']) {
    const result = composeSystemInstructions(null, null, depth);
    assert.ok(result.includes('ANALYSIS_DEPTH PREFERENCE:') || result.includes('ANALYSIS DEPTH PREFERENCE:'));
    assert.ok(result.includes(DEPTH_GUIDANCE[depth]));
  }
});

test('prompts: composeSystemInstructions combines custom guidance and depth simultaneously', () => {
  const result = composeSystemInstructions(
    'Professional and direct',
    'Focus on database indexing.',
    'Detailed'
  );
  assert.ok(result.includes('Tone: Professional, direct, concise, and focused on clear actionable insights.'));
  assert.ok(result.includes('Additional User Guidance: Focus on database indexing.'));
  assert.ok(result.includes(DEPTH_GUIDANCE.Detailed));
});

test('prompts: buildAnalysisUserPrompt formats single interaction without context', () => {
  const prompt = 'Why is my React component re-rendering?';
  const response = 'It might be due to missing dependency array in useEffect.';
  const userPrompt = buildAnalysisUserPrompt(prompt, response);

  assert.ok(!userPrompt.includes('<CONVERSATION_HISTORY>'));
  assert.ok(userPrompt.includes('<CURRENT_INTERACTION>'));
  assert.ok(userPrompt.includes(`<USER_PROMPT>\n${prompt}\n</USER_PROMPT>`));
  assert.ok(userPrompt.includes(`<AI_RESPONSE>\n${response}\n</AI_RESPONSE>`));
  assert.ok(userPrompt.includes('Diagnose this interaction and produce the structured JSON analysis document'));
});

test('prompts: buildAnalysisUserPrompt isolates conversation history inside XML tags', () => {
  const history = [
    { prompt: 'What is SQLite?', response: 'SQLite is an embedded relational database.' },
    { prompt: 'Can it handle concurrent writes?', response: 'SQLite locks the database file for writes.' }
  ];
  const prompt = 'How do I scale it?';
  const response = 'You can use WAL mode or migrate to PostgreSQL.';

  const userPrompt = buildAnalysisUserPrompt(prompt, response, history);

  assert.ok(userPrompt.includes('<CONVERSATION_HISTORY>'));
  assert.ok(userPrompt.includes('[Exchange 1]\nUser: What is SQLite?\nAssistant: SQLite is an embedded relational database.'));
  assert.ok(userPrompt.includes('[Exchange 2]\nUser: Can it handle concurrent writes?\nAssistant: SQLite locks the database file for writes.'));
  assert.ok(userPrompt.includes('</CONVERSATION_HISTORY>'));
  assert.ok(userPrompt.includes('<CURRENT_INTERACTION>'));
  assert.ok(userPrompt.includes('Diagnose the CURRENT_INTERACTION using the CONVERSATION_HISTORY as context.'));
});

test('prompts: buildAnalysisUserPrompt safely coerces falsy or non-string inputs', () => {
  const userPrompt = buildAnalysisUserPrompt(null, undefined, []);
  assert.ok(userPrompt.includes('<USER_PROMPT>\n\n</USER_PROMPT>'));
  assert.ok(userPrompt.includes('<AI_RESPONSE>\n\n</AI_RESPONSE>'));
});
