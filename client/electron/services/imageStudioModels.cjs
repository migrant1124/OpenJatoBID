const MODELS = Object.freeze([
  { key: 'gpt2', name: 'GPT Image 2', requestModelId: 'gpt-image-2', protocol: 'jinlong-image', profile: 'gpt-image', actions: ['generate', 'reference', 'edit'] },
  { key: 'gpt2_1k', name: 'GPT Image 2 · 1K 渠道版', requestModelId: 'gpt-image-2-1k', protocol: null, profile: 'gpt-image', actions: [] },
  { key: 'sunburst', name: 'GPT Image 2.5 Sunburst', requestModelId: 'gpt-image-2.5-sunburst', protocol: 'jinlong-image', profile: 'gpt-image-sunburst', actions: ['generate'] },
  { key: 'flare', name: 'GPT Image 2.5 Flare', requestModelId: 'gpt-image-2.5-flare', protocol: 'jinlong-image', profile: 'gpt-image-flare', actions: ['generate'] },
  { key: 'banana_pro', name: 'Nano Banana Pro', requestModelId: 'Nano Banana Pro', protocol: null, profile: 'nano-banana-pro', actions: [] },
  { key: 'banana2', name: 'Nano Banana 2', requestModelId: 'Nano Banana 2', protocol: null, profile: 'nano-banana-2', actions: [] },
]);

function getModel(key) {
  const model = MODELS.find((item) => item.key === key);
  if (!model) throw new Error('生图模型不在本轮批准范围内。');
  return model;
}

module.exports = { MODELS, getModel };
