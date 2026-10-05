const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const rootBase = path.resolve(__dirname, '../.tmp/ppt184-resource-center/media-volume'); fs.mkdirSync(rootBase, { recursive: true });
const root = fs.mkdtempSync(path.join(rootBase, '隔离-')), results = [];
const runtime = require('../electron/services/pptRuntimeService.cjs').createPptRuntimeService({ app: { isPackaged: false } });
async function check(name, callback) { try { const evidence = await callback(); results.push({ name, status: 'PASS', evidence }); } catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; } }
async function main() {
  await check('真实固定FFmpeg：两页10秒配3秒本地旁白，补静音且整稿时长保持', async () => {
    const frames = path.join(root, 'exports/video-frames'); fs.mkdirSync(frames, { recursive: true }); fs.mkdirSync(path.join(root, 'assets'));
    const sharp = require('sharp');
    for (let index = 0; index < 2; index++) await sharp({ create: { width: 960, height: 720, channels: 3, background: index ? '#00b4d8' : '#0077b6' } }).png().toFile(path.join(frames, `frame_${index}.png`));
    fs.writeFileSync(path.join(frames, 'frames.txt'), "file 'frame_0.png'\nduration 5\nfile 'frame_1.png'\nduration 5\nfile 'frame_1.png'", 'utf8');
    const samples = 16000 * 3, bytes = Buffer.alloc(44 + samples * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
    for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / 16000) * 1200), 44 + index * 2);
    fs.writeFileSync(path.join(root, 'assets/合成旁白.wav'), bytes);
    const run = await runtime.video({ projectRoot: root, audio: 'assets/合成旁白.wav', aspectRatio: '4:3', duration: 10 });
    const probe = await runtime.probe({ projectRoot: root, file: 'exports/presentation.mp4' }), metadata = JSON.parse(probe.output);
    assert(metadata.streams.some((stream) => stream.codec_type === 'video')); assert(metadata.streams.some((stream) => stream.codec_type === 'audio'));
    assert(Math.abs(Number(metadata.format.duration) - 10) < .2); fs.writeFileSync(path.join(root, 'ffprobe.json'), probe.output, 'utf8');
    return { exitCode: run.exitCode, duration: metadata.format.duration, inputAudioSeconds: 3, video: 'exports/presentation.mp4' };
  });
  await check('实际卷GUID识别目录联接，不按所选路径盘符猜测系统卷', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-ppt-volume-')), junction = path.join(root, '系统卷联接');
    fs.symlinkSync(target, junction, 'junction');
    try {
      const viaJunction = runtime.volume(fs.realpathSync(junction), fs.realpathSync(process.env.SystemRoot)), direct = runtime.volume(fs.realpathSync(target), fs.realpathSync(process.env.SystemRoot));
      assert.equal(viaJunction.target, direct.target); assert.equal(viaJunction.system, direct.system);
      return { selected: junction, resolved: fs.realpathSync(junction), ...viaJunction, systemVolume: viaJunction.target === viaJunction.system };
    } finally { fs.rmdirSync(junction); fs.rmdirSync(target); }
  });
}
main().catch((error) => console.error(error.stack)).finally(async () => { await runtime.close(); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '真实Windows固定组件，合成图片与音频，不调用模型、不涉及用户素材', results }, null, 2), 'utf8'); console.log(JSON.stringify({ root, results })); process.exitCode = results.some((item) => item.status === 'FAIL') ? 1 : 0; });
