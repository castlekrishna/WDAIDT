/* WDAIDT V2.0.0 — Hermetic Mock Analysis Engine.
 * Converted from backend/app/analysis/analyzer.py (generate_mock_analysis).
 * Generates realistic diagnostic analysis conforming strictly to WDAIDT quality standards.
 */

(() => {
  'use strict';

  function generateMockAnalysis(params = {}) {
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    const response = typeof params.response === 'string' ? params.response : '';
    const requestId = params.request_id || params.requestId || null;
    const responseStyle = params.response_style || params.responseStyle || null;
    const analysisDepth = params.analysis_depth || params.analysisDepth || 'Brief';
    const context = Array.isArray(params.context) ? params.context : null;

    const cleanP = prompt.trim();
    const lowerP = cleanP.toLowerCase();
    const firstLine = (cleanP.split('\n')[0] || '').slice(0, 80).trim() || 'Interaction';

    const factualKeywords = ['capital of', 'who wrote', 'what is the speed of', 'how many days'];
    const isSimpleFactual = factualKeywords.some((kw) => lowerP.includes(kw)) && cleanP.length < 60;

    if (isSimpleFactual) {
      const blocks = [
        {
          type: 'paragraph',
          content: 'The response appears to directly and accurately satisfy the factual question without extraneous assumptions. ' +
            'No significant omissions or corrective actions are required.'
        }
      ];

      if (context && context.length > 0) {
        blocks.push({
          type: 'callout',
          variant: 'info',
          title: 'Context Observed',
          content: `Evaluated alongside ${context.length} preceding exchange(s) from the conversation. ` +
            'The current factual answer remains self-contained and consistent with prior turns.'
        });
      } else if (analysisDepth !== 'Brief') {
        blocks.push({
          type: 'callout',
          variant: 'tip',
          title: 'Assessment',
          content: 'The query was unambiguous, and the AI appears to have provided the verified standard answer. ' +
            'Refinements are unnecessary unless you wish to explore historical context or related data.'
        });
      }

      return {
        request_id: requestId,
        analysis: {
          title: `Satisfactory Factual Exchange: ${firstLine}`,
          blocks
        }
      };
    }

    // General diagnostic analysis: identify missing constraints and supply a concrete next prompt
    const blocks = [];
    if (context && context.length > 0) {
      blocks.push({
        type: 'paragraph',
        content: `Evaluated the latest exchange alongside ${context.length} preceding exchange(s) from the conversation. ` +
          'While the earlier dialogue establishes foundational context, the latest AI response appears to adopt a broad, ' +
          'generalized interpretation that overlooks key constraints previously discussed.'
      });
    } else {
      blocks.push({
        type: 'paragraph',
        content: 'The AI appears to have adopted a broad, generalized interpretation because the prompt lacks specific constraints ' +
          '(such as deployment environment, performance requirements, or prior background). ' +
          'While the answer covers standard industry conventions, it omits key trade-offs and edge cases relevant to targeted use.'
      });
    }

    if (analysisDepth !== 'Brief') {
      blocks.push(
        {
          type: 'heading',
          level: 2,
          content: 'Diagnostic Findings'
        },
        {
          type: 'list',
          style: 'unordered',
          items: [
            'Missing constraints: Specific scale, existing tech stack, or budget boundaries were unstated, prompting the AI to assume generic defaults.',
            'Omitted trade-offs: The answer focuses on the most popular path without detailing maintenance overhead or migration friction.'
          ]
        }
      );

      if (analysisDepth === 'Detailed') {
        blocks.push({
          type: 'callout',
          variant: 'info',
          title: 'Underlying Assumption',
          content: 'The response seems to assume greenfield development with modern standard tooling, ' +
            'which may not apply if integrating into an existing legacy architecture.'
        });
      }

      // Supply a ready-to-use follow-up prompt
      const nextPromptText = `Considering my specific context, what are the primary trade-offs and alternative approaches to '${firstLine}' when working with strict performance constraints and an existing production stack?`;
      blocks.push({
        type: 'next_prompt',
        title: 'Suggested Next Prompt',
        prompt: nextPromptText,
        content: nextPromptText
      });
    }

    return {
      request_id: requestId,
      analysis: {
        title: `Interaction Diagnosis: ${firstLine}`,
        blocks
      }
    };
  }

  const WDAIDT_MOCK = Object.freeze({
    generateMockAnalysis
  });

  if (typeof self !== 'undefined') {
    self.WDAIDT_MOCK = WDAIDT_MOCK;
    self.generateMockAnalysis = generateMockAnalysis;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.WDAIDT_MOCK = WDAIDT_MOCK;
    globalThis.generateMockAnalysis = generateMockAnalysis;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WDAIDT_MOCK;
  }
})();
