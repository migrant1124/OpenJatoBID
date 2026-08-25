const assert = require('node:assert/strict');
const test = require('node:test');
const { buildConversationWorkspace, selectHistory } = require('./conversationPromptBuilder.cjs');

test('history keeps only completed user/assistant messages before the current message', () => {
  const messages = [
    { sequence: 1, role: 'user', status: 'completed', contentMarkdown: '问题一' },
    { sequence: 2, role: 'assistant', status: 'completed', contentMarkdown: '回答一' },
    { sequence: 3, role: 'assistant', status: 'canceled', contentMarkdown: '取消回答' },
    { sequence: 4, role: 'assistant', status: 'error', contentMarkdown: '错误回答' },
    { sequence: 5, role: 'user', status: 'completed', contentMarkdown: '当前问题' },
  ];
  assert.deepEqual(selectHistory(messages, 5, 48000).map((item) => item.contentMarkdown), ['问题一', '回答一']);
});

test('workspace exposes attachment content as files instead of inlining it into the prompt', () => {
  const result = buildConversationWorkspace({
    messages: [],
    currentMessage: { sequence: 1, contentMarkdown: '请总结附件' },
    attachments: [{ attachmentId: 'a1', fileName: '材料.docx', markdownChars: 4, contentMarkdown: '机密正文' }],
    contextLengthLimit: 48000,
  });
  assert.doesNotMatch(result.prompt, /机密正文/);
  assert.equal(result.files.find((item) => item.path === 'attachments/a1/content.md').content, '机密正文');
  assert.match(result.files.find((item) => item.path === 'attachment-manifest.md').content, /材料\.docx/);
});

test('workspace sends images separately from text files and keeps base64 out of the prompt workspace', () => {
  const result = buildConversationWorkspace({
    messages: [],
    currentMessage: { sequence: 1, contentMarkdown: '识别图片' },
    attachments: [{ attachmentId: 'i1', fileName: '现场.webp', mimeType: 'image/jpeg', imageData: 'base64-secret' }],
    contextLengthLimit: 48000,
  });
  assert.deepEqual(result.images, [{ type: 'image', data: 'base64-secret', mimeType: 'image/jpeg' }]);
  assert.doesNotMatch(JSON.stringify(result.files), /base64-secret/);
  assert.match(result.files.find((item) => item.path === 'attachment-manifest.md').content, /multimodal_image_index: 1/);
});
