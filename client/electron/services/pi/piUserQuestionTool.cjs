const AGENT_USER_QUESTION_TOOL_NAME = 'ask-user';

function createPiUserQuestionTool({ Type, requestUserQuestion }) {
  return {
    name: AGENT_USER_QUESTION_TOOL_NAME,
    label: '询问用户',
    description: '当任务材料无法确定且不同选择会实质影响结果时，暂停执行并向用户提出一个简单易懂的问题。提供 2 至 5 个互斥选项，将推荐选项放在第一项。',
    promptSnippet: '关键事项无法从材料中确定时，使用简单中文向用户提问并等待回答。',
    promptGuidelines: [
      '已有材料足以判断时自主执行，不要调用 ask-user。',
      '每次只问一个会实质影响结果的问题，提供 2 至 5 个互斥选项，第一项为推荐项。',
      '问题和选项使用普通用户能理解的中文，不得展示字段名、文件名或内部实现术语。',
      '普通选项设置 custom=false；需要用户补充具体要求时设置 custom=true，最多一个。',
    ],
    executionMode: 'sequential',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, description: '需要用户确认的业务问题，使用简单自然的中文。' }),
      options: Type.Array(Type.Object({
        label: Type.String({ minLength: 1, description: '用户可直接判断的简短选项。' }),
        description: Type.Optional(Type.String({ description: '该选项的业务结果或影响。' })),
        custom: Type.Boolean({ description: '选中后是否需要用户补充具体要求。' }),
      }, { additionalProperties: false }), { minItems: 2, maxItems: 5, description: '候选选项，第一项为推荐项。' }),
    }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal) => {
      if (typeof requestUserQuestion !== 'function') throw new Error('用户提问通道未初始化');
      if (params.options.filter((option) => option.custom === true).length > 1) {
        throw new Error('自定义输入选项最多只能有一个，请调整选项后重新提问');
      }
      const answer = await requestUserQuestion({ tool_call_id: toolCallId, question: params.question, options: params.options }, signal);
      const result = { answered: true, ...answer };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}

module.exports = {
  AGENT_USER_QUESTION_TOOL_NAME,
  createPiUserQuestionTool,
};
