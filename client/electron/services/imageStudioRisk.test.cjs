const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp');
const { createImageStudioSchema, extendImageStudioSchema, createImageStudioRiskSchema } = require('./sqliteDatabase.cjs');
const { createImageStudioService } = require('./imageStudioService.cjs');

function setup(response, review = { risk_level: 'normal', reason: '' }) {
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db);
  extendImageStudioSchema(db);
  createImageStudioRiskSchema(db);
  const calls = [];
  const service = createImageStudioService({ db, app: {},
    configStore: { load: () => ({ api_key: 'mock', model_name: 'gpt-6-sol',
      image_model: { provider: 'mock', model_name: 'gpt-image-2', image_size: '1024x1024' } }) },
    aiService: { getImageModelAvailability: () => ({ available: true }),
      chat: async (input) => { calls.push({ type: 'classification', input });
        return JSON.stringify(calls.filter((call) => call.type === 'classification').length === 1 ? response : review); },
      withQueueScope: () => ({ generateImage: async (input) => { calls.push({ type: 'image', input }); throw new Error('mock image stop'); } }),
    },
  });
  return { db, service, calls };
}

const cases = [
  ['蓝色猫插画', 'normal', [], ''],
  ['产品包装摄影', 'normal', [], ''],
  ['山间风景画', 'normal', [], ''],
  ['利群香烟品牌商业海报', 'transformable', ['tobacco_marketing'], '东方视觉语言研究，不含真实烟草品牌和烟草商品'],
  ['不出现烟盒烟雾的利群品牌宣传图', 'transformable', ['tobacco_marketing'], '东方视觉语言研究，不含真实烟草品牌和烟草商品'],
  ['香烟促销横幅', 'transformable', ['tobacco_marketing'], '抽象构图与色彩研究，不含烟草商品'],
  ['电子烟销售广告', 'transformable', ['nicotine_marketing'], '未来感产品造型研究，不含尼古丁商品'],
  ['明确只接受烟草广告，不接受其他用途', 'blocked', ['tobacco_marketing'], ''],
  ['针对未成年人的香烟购买号召', 'blocked', ['minor_tobacco_marketing'], ''],
  ['无商业用途的抽象水墨纹样', 'normal', [], ''],
];

for (const [prompt, level, categories, alternative] of cases) {
  test(`风险预检契约：${prompt}`, async () => {
    const response = { risk_level: level, categories, reason: level === 'normal' ? '' : '原用途有风险',
      original_intent: prompt, safe_alternative: alternative,
      transformed_prompt: level === 'transformable' ? `${alternative}。画面为抽象图形，无品牌标识。` : '' };
    const { db, service, calls } = setup(response);
    const input = { prompt, count: 1, size: '1024x1024' };
    const result = await service.preflight(input);
    assert.equal(result.risk_result.risk_level, level);
    assert.deepEqual(result.risk_result.categories, categories);
    assert.equal(result.risk_result.can_generate, level === 'normal');
    assert.equal(calls.filter((call) => call.type === 'image').length, 0);
    const audit = db.prepare('SELECT * FROM image_studio_risk_checks WHERE check_id = ?').get(result.checkId);
    assert.equal(audit.original_prompt, prompt);
    assert.equal(audit.model, 'gpt-image-2');
    assert.ok(audit.timestamp);
    if (level !== 'normal') assert.throws(() => service.submit({ ...input, riskCheckId: result.checkId }), /未获准生成/);
    if (level === 'blocked') assert.throws(() => service.decideRisk({ checkId: result.checkId, confirmed: true }), /已失效/);
    if (level === 'transformable') {
      service.decideRisk({ checkId: result.checkId, confirmed: true });
      service.submit({ ...input, riskCheckId: result.checkId });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls.find((call) => call.type === 'image')?.input.prompt, result.transformed_prompt);
      assert.equal(audit.user_confirmation, 'pending');
      assert.equal(db.prepare('SELECT user_confirmation FROM image_studio_risk_checks WHERE check_id = ?').get(result.checkId).user_confirmation, 'confirmed');
      assert.ok(db.prepare('SELECT confirmation_at FROM image_studio_risk_checks WHERE check_id = ?').get(result.checkId).confirmation_at);
    }
    db.close();
  });
}

test('预检结果缺字段或参数变化时不发送生图请求', async () => {
  const { db, service, calls } = setup({ risk_level: 'transformable', categories: [], reason: '风险', original_intent: '广告', safe_alternative: '', transformed_prompt: '' });
  const unavailable = await service.preflight({ prompt: '广告' });
  assert.equal(unavailable.risk_result.risk_level, 'blocked');
  assert.deepEqual(unavailable.risk_result.categories, ['preflight_unavailable']);
  assert.equal(db.prepare('SELECT original_prompt FROM image_studio_risk_checks WHERE check_id = ?').get(unavailable.checkId).original_prompt, '广告');
  assert.equal(calls.filter((call) => call.type === 'image').length, 0);
  db.close();
  const normal = setup({ risk_level: 'normal', categories: [], reason: '', original_intent: '猫', safe_alternative: '', transformed_prompt: '' });
  const result = await normal.service.preflight({ prompt: '猫', count: 1 });
  assert.throws(() => normal.service.submit({ prompt: '猫', count: 2, riskCheckId: result.checkId }), /参数已变化/);
  normal.db.close();
});

test('参考图送入视觉预检，确认替代用途后不再传原图', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-risk-'));
  const imagePath = path.join(directory, 'reference.png');
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#222222' } }).png().toFile(imagePath);
  const { db, service, calls } = setup({ risk_level: 'transformable', categories: ['tobacco_marketing'],
    reason: '参考图和用途构成烟草营销', original_intent: '品牌宣传',
    safe_alternative: '抽象视觉研究', transformed_prompt: '抽象水墨视觉研究，不含烟草品牌或商品' });
  db.prepare(`INSERT INTO image_studio_assets (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
    VALUES ('reference', ?, 'yibiao-asset://test/reference.png', 'image/png', 16, 16, 'hash', ?)`).run(imagePath, new Date().toISOString());
  const input = { prompt: '品牌宣传图', references: [{ assetId: 'reference', role: '主体', description: '品牌商品图' }] };
  const check = await service.preflight(input);
  const content = calls[0].input.messages[1].content;
  assert.equal(content[1].type, 'image_url');
  assert.match(content[0].text, /品牌商品图/);
  assert.throws(() => service.submit({ ...input, riskCheckId: check.checkId }), /未获准生成/);
  service.decideRisk({ checkId: check.checkId, confirmed: true });
  service.submit({ ...input, riskCheckId: check.checkId });
  await new Promise((resolve) => setImmediate(resolve));
  const imageCall = calls.find((call) => call.type === 'image');
  assert.equal(imageCall.input.prompt, check.transformed_prompt);
  assert.deepEqual(imageCall.input.images, []);
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('用户放弃替代方案后不能生成', async () => {
  const { db, service, calls } = setup({ risk_level: 'transformable', categories: ['tobacco_marketing'],
    reason: '营销用途', original_intent: '烟草海报', safe_alternative: '抽象图形研究', transformed_prompt: '抽象图形研究' });
  const input = { prompt: '烟草海报' };
  const check = await service.preflight(input);
  service.decideRisk({ checkId: check.checkId, confirmed: false });
  assert.throws(() => service.submit({ ...input, riskCheckId: check.checkId }), /未获准生成/);
  assert.ok(db.prepare('SELECT confirmation_at FROM image_studio_risk_checks WHERE check_id = ?').get(check.checkId).confirmation_at);
  assert.equal(calls.filter((call) => call.type === 'image').length, 0);
  db.close();
});

test('normal 通过预检后沿用原提示词且同次预检不重复提交', async () => {
  const { db, service, calls } = setup({ risk_level: 'normal', categories: [], reason: '',
    original_intent: '蓝色猫插画', safe_alternative: '', transformed_prompt: '' });
  const input = { prompt: '蓝色猫插画', count: 1, size: '1024x1024' };
  const check = await service.preflight(input);
  const first = service.submit({ ...input, riskCheckId: check.checkId });
  const second = service.submit({ ...input, riskCheckId: check.checkId });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.taskId, first.taskId);
  assert.equal(calls.filter((call) => call.type === 'image').length, 1);
  assert.equal(calls.find((call) => call.type === 'image').input.prompt, input.prompt);
  assert.equal(db.prepare('SELECT user_confirmation FROM image_studio_risk_checks WHERE check_id = ?').get(check.checkId).user_confirmation, 'not_required');
  db.close();
});

test('替代提示词仍保留原营销用途时独立复核阻止生图', async () => {
  const { db, service, calls } = setup({ risk_level: 'transformable', categories: ['tobacco_marketing'],
    reason: '烟草营销', original_intent: '香烟商业海报', safe_alternative: '换词后的品牌海报',
    transformed_prompt: '请制作同一香烟品牌的促销广告' },
  { risk_level: 'blocked', reason: '仍然是烟草营销' });
  const check = await service.preflight({ prompt: '香烟商业海报' });
  assert.equal(check.risk_result.risk_level, 'blocked');
  assert.match(check.risk_result.reason, /未通过独立意图复核/);
  assert.equal(db.prepare('SELECT transformed_prompt FROM image_studio_risk_checks WHERE check_id = ?').get(check.checkId).transformed_prompt, '请制作同一香烟品牌的促销广告');
  assert.equal(calls.filter((call) => call.type === 'image').length, 0);
  db.close();
});

test('局部修改预检传入红色选区标记和区域位置', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-risk-edit-'));
  const imagePath = path.join(directory, 'source.png');
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#cccccc' } }).png().toFile(imagePath);
  const pixels = Buffer.alloc(16 * 16 * 4, 255);
  pixels[(8 * 16 + 8) * 4 + 3] = 0;
  const mask = await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
  const { db, service, calls } = setup({ risk_level: 'normal', categories: [], reason: '',
    original_intent: '局部改色', safe_alternative: '', transformed_prompt: '' });
  db.prepare(`INSERT INTO image_studio_assets (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
    VALUES ('source', ?, 'yibiao-asset://test/source.png', 'image/png', 16, 16, 'hash', ?)`).run(imagePath, new Date().toISOString());
  await service.preflight({ prompt: '把选区改为蓝色', kind: 'edit', references: [{ assetId: 'source', role: '主体' }],
    regions: [{ prompt: '改为蓝色', maskDataUrl: `data:image/png;base64,${mask.toString('base64')}` }] });
  const content = calls[0].input.messages[1].content;
  assert.equal(content.filter((item) => item.type === 'image_url').length, 2);
  assert.match(content.find((item) => item.type === 'text' && item.text.includes('红色标记')).text, /"region":1/);
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('PSD 背景补全在风险预检被阻止时不调用 GPT Image 2.5', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-risk-psd-'));
  const imagePath = path.join(directory, 'source.png');
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#cccccc' } }).png().toFile(imagePath);
  const { db, service, calls } = setup({ risk_level: 'blocked', categories: ['tobacco_marketing'],
    reason: '原图用于烟草宣传', original_intent: '烟草商品拆层', safe_alternative: '', transformed_prompt: '' });
  db.prepare(`INSERT INTO image_studio_assets (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
    VALUES ('source', ?, 'yibiao-asset://test/source.png', 'image/png', 16, 16, 'hash', ?)`).run(imagePath, new Date().toISOString());
  await assert.rejects(() => service.createLayerSet({ assetId: 'source' }), /PSD 背景补全已停止/);
  assert.equal(calls.filter((call) => call.type === 'image').length, 0);
  assert.equal(db.prepare('SELECT model FROM image_studio_risk_checks').get().model, 'gpt-image-2.5-sunburst');
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
