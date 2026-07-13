const test = require('node:test');
const assert = require('node:assert/strict');

const { formatBidAnalysisFactsForPrompt: formatGlobalFactsContext } = require('./globalFactsTask.cjs');
const { formatBidAnalysisFactsForPrompt: formatContentContext } = require('./contentGenerationTask.cjs');

const storedPlan = {
  bidAnalysisTasks: {
    projectInfo: { status: 'success', content: '{"project_name":"技术项目"}' },
    partAInfo: { status: 'success', content: '{"company_name":"招标人"}' },
    deliveryAndServiceRequirements: { status: 'success', content: '{"implementation_period":"30天"}' },
    procurementList: { status: 'success', content: 'SECRET_PROCUREMENT_PRICE_888' },
    quotationRequirements: { status: 'success', content: 'SECRET_QUOTE_PRICE_999' },
  },
};

test('current procurement pricing and legacy quotation rows are excluded from technical prompt contexts', () => {
  const globalFactsContext = formatGlobalFactsContext(storedPlan);
  const contentContext = formatContentContext(storedPlan);

  for (const context of [globalFactsContext, contentContext]) {
    assert.match(context, /技术项目/);
    assert.match(context, /招标人/);
    assert.match(context, /30天/);
    assert.doesNotMatch(context, /SECRET_PROCUREMENT_PRICE_888/);
    assert.doesNotMatch(context, /SECRET_QUOTE_PRICE_999/);
  }
});
