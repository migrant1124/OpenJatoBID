'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAiImagePrompt } = require('./contentIllustrationGeneration.cjs');

test('创意 AI 生图提示词使用 Creative Brief 且禁止伪造品牌资产', () => {
  const prompt = buildAiImagePrompt({
    planItem: {
      item_id: 'creative-1',
      image_type: 'campaign_key_visual',
      title: '城市文化活动主视觉',
      creative_brief: {
        client_profile: '城市文化项目', project_goal: '形成活动主视觉方向', target_audience: ['市民'],
        campaign_theme: '城市文化', key_message: '传递文化活力', mandatory_elements: ['文化场景'],
        prohibited_elements: ['伪造 Logo'], style_keywords: ['专业'], brand_colors: [], brand_assets: [],
        deliverable_type: '主视觉概念图', aspect_ratio: '16:9', needs_user_confirmation: ['品牌资产'],
      },
    },
    reference: '活动主题和执行场景来源于技术方案正文。',
  });
  assert.match(prompt, /创意简报/);
  assert.match(prompt, /城市文化项目/);
  assert.match(prompt, /不得生成 Logo 或近似 Logo/);
  assert.match(prompt, /不得生成关键中文文案/);
});
