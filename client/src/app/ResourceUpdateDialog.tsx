import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import type { ResourceDigest } from '../shared/types/ipc';
import { ResourceThumbnail } from '../shared/ui/ResourceThumbnail';
import { useToast } from '../shared/ui';

export default function ResourceUpdateDialog({ onView }: { onView: (center: 'prompts' | 'templates', ids: string[]) => Promise<boolean> }) {
  const { showToast } = useToast();
  const [digest, setDigest] = useState<ResourceDigest | null>(null);
  const [history, setHistory] = useState<Array<{ version: number; createdAt: string; summary?: string }> | null>(null);
  const shown = useRef(false), active = useRef(true), checking = useRef(false);
  useEffect(() => {
    active.current = true;
    const sync = async () => {
      if (checking.current || !window.yibiao?.resources) return;
      checking.current = true;
      try {
        const status = await window.yibiao.database.getStatus();
        if (status.ready) { const result = await window.yibiao.resources.sync(); if (result.initialized) showToast('公共资源目录已就绪，模板和图片按使用获取', 'info'); }
      } catch { /* 同步错误留在资源状态；不将错误改成更新通知。 */ }
      finally { checking.current = false; }
    };
    const showWhenSafe = async () => {
      if (shown.current || !active.current || !window.yibiao?.resources) return;
      const target = document.activeElement as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return;
      try {
        const [agent, tasks, studio, pptBusy] = await Promise.all([window.yibiao.agent.getStatus(), window.yibiao.tasks.getActiveTasks(), window.yibiao.imageStudio.getState(), window.yibiao.ppt.busy()]);
        if (pptBusy || agent.active_task || agent.queued_count || tasks.length || studio.tasks.some((task) => ['queued', 'running', 'sent', 'downloading'].includes(task.status))) return;
        const result = await window.yibiao.resources.digest();
        if (active.current && !shown.current && result.autoEligible) { shown.current = true; setDigest(result); }
      } catch { /* 数据库准备或连接失败时等待下一观察，不推进展示游标。 */ }
    };
    void sync();
    const startupRetry = window.setTimeout(() => void sync(), 5000);
    const observer = window.setInterval(() => void showWhenSafe(), 3000);
    window.addEventListener('online', sync);
    // 局域网恢复不一定触发浏览器 online；只检查已发布目录，不触发上游全库扫描。
    const lanRetry = window.setInterval(() => void sync(), 60000);
    const showHistory = () => { void window.yibiao!.resources.history().then(setHistory).catch((error) => showToast(String(error), 'error')); };
    window.addEventListener('resource-update-history', showHistory);
    return () => { active.current = false; window.clearTimeout(startupRetry); window.clearInterval(observer); window.clearInterval(lanRetry); window.removeEventListener('online', sync); window.removeEventListener('resource-update-history', showHistory); };
  }, [showToast]);
  useEffect(() => {
    if (!digest) return;
    const rendered = requestAnimationFrame(() => { void window.yibiao!.resources.shown({ scope: digest.scope, version: digest.version }).catch((error) => showToast(`更新概括已展示，记录保存失败：${String(error)}`, 'error')); });
    return () => cancelAnimationFrame(rendered);
  }, [digest, showToast]);
  return <><Dialog.Root open={Boolean(history)} onOpenChange={(open) => { if (!open) setHistory(null); }}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="resource-update-dialog"><header><Dialog.Title>公共资源更新记录</Dialog.Title><Dialog.Close aria-label="关闭更新记录">×</Dialog.Close></header><Dialog.Description>按当前管理端、员工和设备范围查看；记录不足时不推算新增数量。</Dialog.Description>{history?.length ? history.map((item) => <p key={item.version}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.summary || '已应用资源更新'}</p>) : <p>当前范围尚无已应用记录。</p>}</Dialog.Content></Dialog.Portal></Dialog.Root><Dialog.Root open={Boolean(digest)} onOpenChange={(open) => { if (!open) setDigest(null); }}><Dialog.Portal>
    <Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="resource-update-dialog">
      <header><Dialog.Title>公共资源更新</Dialog.Title><Dialog.Close aria-label="关闭更新概括">×</Dialog.Close></header>
      <Dialog.Description>目录与公共提示词已应用。模板和图片按使用获取，下载、预览及套用验证状态分别记录。</Dialog.Description>
      {digest && (['prompts', 'templates'] as const).map((center) => {
        const items = digest.changes.filter((item) => item.center === center);
        const count = (action: string, kind?: string) => items.filter((item) => item.action === action && (!kind || item.kind === kind)).length;
        return <section key={center}><h3>{center === 'prompts' ? '生图提示词中心' : 'PPT 模板中心'}</h3>
          <p>{!digest.comparable ? '资源库已更新，历史不足以准确计算累计变化' : !items.length ? '本次暂无更新'
            : center === 'prompts' ? `新增 ${count('added')} 条 · 更新 ${count('updated')} 条 · 下架 ${count('removed')} 条`
              : `整套新增 ${count('added', 'deck')} 套 · 单页新增 ${count('added', 'layout')} 个 · 更新 ${count('updated')} 项 · 下架 ${count('removed')} 项`}</p>
          <div className="resource-featured">{items.filter((item) => item.action !== 'removed').slice(0, 3).map((item) => <article key={item.resourceId}>
            <ResourceThumbnail item={item} version={digest.version} /><strong>{item.title}</strong><small>{item.assets.some((asset) => asset.role === 'cover') ? '真实预览可用' : '图片仍需准备'}{center === 'templates' ? ['native_reuse_verified', 'mixed_reuse_verified', 'visual_reference_verified'].includes(item.capability) ? ' · 查看适用范围' : ' · 套用待验证' : ''}</small>
          </article>)}</div>
          {items.length > 0 && <button type="button" onClick={() => { void onView(center, items.map((item) => item.resourceId)).then((allowed) => { if (allowed) setDigest(null); }); }}>查看对应变更</button>}
        </section>;
      })}
      <footer><Dialog.Close className="image-studio-primary">知道了</Dialog.Close></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root></>;
}
