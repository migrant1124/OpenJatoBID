import { useEffect, useRef, useState } from 'react';
import type { SectionId } from '../../../shared/types/navigation';
import type { ImageStudioState, ImageStudioWork, PromptGroup, PromptItem } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';

const sections: Array<{ id: SectionId; label: string }> = [
  { id: 'image-studio-create', label: 'AI 生图' },
  { id: 'image-studio-prompts', label: '提示词中心' },
  { id: 'image-studio-works', label: '我的作品' },
];

function ImageStudioPage({ section, onSectionChange }: { section: SectionId; onSectionChange: (section: SectionId) => void }) {
  const { showToast } = useToast();
  const [state, setState] = useState<ImageStudioState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [groups, setGroups] = useState<PromptGroup[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [promptTitle, setPromptTitle] = useState('');
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const revisionRef = useRef(0);
  const lastSavedRef = useRef('');
  const saveQueueRef = useRef(Promise.resolve());
  const view = section === 'image-studio-prompts' ? 'prompts' : section === 'image-studio-works' ? 'works' : 'create';

  useEffect(() => {
    let live = true;
    void window.yibiao?.imageStudio.getState().then((loaded) => {
      if (!live) return;
      setState(loaded);
      setPrompt(loaded.draft.prompt);
      revisionRef.current = loaded.draft.revision;
      lastSavedRef.current = loaded.draft.prompt;
    }).catch((error) => showToast(error instanceof Error ? error.message : '读取生图数据失败', 'error'));
    const unsubscribe = window.yibiao?.imageStudio.onEvent((event) => {
      setState((current) => current ? { ...current, tasks: event.tasks, works: event.works } : current);
    });
    return () => { live = false; unsubscribe?.(); };
  }, [showToast]);

  useEffect(() => {
    if (!state || prompt === lastSavedRef.current) return;
    const timer = window.setTimeout(() => {
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        if (prompt === lastSavedRef.current) return;
        const result = await window.yibiao!.imageStudio.saveDraft({ prompt, revision: revisionRef.current });
        if (result.conflict) {
          showToast('草稿已在其他位置更新，请检查后重新编辑。', 'info');
          return;
        }
        revisionRef.current = result.draft.revision;
        lastSavedRef.current = result.draft.prompt;
      }).catch((error) => { showToast(error instanceof Error ? error.message : '保存草稿失败', 'error'); });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [prompt, Boolean(state), showToast]);

  useEffect(() => {
    if (view !== 'prompts') return;
    void Promise.all([window.yibiao!.promptLibrary.listGroups(), window.yibiao!.promptLibrary.listPrompts()])
      .then(([nextGroups, nextPrompts]) => {
        setGroups(nextGroups);
        const imageGroup = nextGroups.find((group) => group.groupName === '生图提示词');
        setPrompts(imageGroup ? nextPrompts.filter((item) => item.groupId === imageGroup.groupId) : []);
      })
      .catch((error) => showToast(error instanceof Error ? error.message : '读取提示词失败', 'error'));
  }, [view, showToast]);

  const running = Boolean(state?.tasks.some((task) => task.status === 'queued' || task.status === 'running'));
  const currentWork = state?.works.find((work) => work.workId === selectedWorkId) || state?.works[0];
  const latestTask = state?.tasks[0];

  const start = async () => {
    try {
      await window.yibiao!.imageStudio.start({ prompt });
      showToast('已提交生图任务', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '提交生图任务失败', 'error');
    }
  };

  const savePrompt = async (text: string) => {
    if (!text.trim()) return;
    try {
      const existingGroups = groups.length ? groups : await window.yibiao!.promptLibrary.listGroups();
      let group = existingGroups.find((item) => item.groupName === '生图提示词');
      if (!group) {
        group = await window.yibiao!.promptLibrary.createGroup({ groupName: '生图提示词' });
        setGroups((items) => [...items, group!]);
      }
      const created = await window.yibiao!.promptLibrary.createPrompt({
        groupId: group.groupId, title: promptTitle.trim() || text.trim().slice(0, 24), contentMarkdown: text,
      });
      setPrompts((items) => [created, ...items]);
      setPromptTitle('');
      showToast('已保存到我的提示词', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存提示词失败', 'error');
    }
  };

  const updateWorks = async (work: ImageStudioWork, action: 'favorite' | 'delete') => {
    try {
      const works = action === 'favorite'
        ? await window.yibiao!.imageStudio.setFavorite({ workId: work.workId, isFavorite: !work.isFavorite })
        : await window.yibiao!.imageStudio.deleteWork({ workId: work.workId });
      setState((current) => current ? { ...current, works } : current);
      setConfirmDeleteId(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  const exportWork = async (work: ImageStudioWork) => {
    try {
      const result = await window.yibiao!.imageStudio.exportImage({ workId: work.workId, format });
      if (!result.canceled) showToast('图片已导出', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出图片失败', 'error');
    }
  };

  return (
    <div className="image-studio-page">
      <header className="image-studio-head">
        <div><h1>生图模式</h1><p>图片创作</p></div>
        <nav aria-label="生图模式页面" className="image-studio-tabs">
          {sections.map((item) => <button key={item.id} type="button" aria-current={(section === item.id || (section === 'image-studio' && item.id === 'image-studio-create')) ? 'page' : undefined} onClick={() => onSectionChange(item.id)}>{item.label}</button>)}
        </nav>
      </header>

      {view === 'create' && <div className="image-studio-workspace">
        <section className="image-studio-compose" aria-label="创作输入">
          <label htmlFor="image-studio-prompt">图片需求</label>
          <textarea id="image-studio-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="用中文描述你想要的画面" />
          <p className="image-studio-meta">当前模型尺寸：{state?.imageModel.size || '未配置'}</p>
          <div className="image-studio-compose-actions">
            <button type="button" className="image-studio-primary" disabled={!state?.imageModel.available || !prompt.trim() || running} onClick={() => void start()}>{running ? '生成中' : '生成图片'}</button>
            <button type="button" disabled={!prompt.trim()} onClick={() => void savePrompt(prompt)}>保存提示词</button>
          </div>
          {!state?.imageModel.available && <p role="status" className="image-studio-warning">请先在设置中配置可用的生图模型。</p>}
          {latestTask?.status === 'unknown' && <p role="status" className="image-studio-warning">上次任务结果待确认，请检查作品后再决定是否重新生成。{latestTask.error ? ` ${latestTask.error}` : ''}</p>}
        </section>
        <section className="image-studio-result" aria-label="生成结果">
          {currentWork ? <>
            <img src={currentWork.assetUrl} alt="当前生成作品" />
            <div className="image-studio-result-bar">
              <span>{currentWork.width} × {currentWork.height}</span>
              <button type="button" onClick={() => { setPrompt(currentWork.prompt); onSectionChange('image-studio-create'); }}>复用提示词</button>
              <select aria-label="下载格式" value={format} onChange={(event) => setFormat(event.target.value as 'png' | 'jpg' | 'webp')}><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WEBP</option></select>
              <button type="button" onClick={() => void exportWork(currentWork)}>下载</button>
            </div>
          </> : <div className="image-studio-empty">{running ? '正在生成图片…' : '作品将在这里显示'}</div>}
        </section>
      </div>}

      {view === 'prompts' && <section className="image-studio-library">
        <div className="image-studio-library-head"><h2>我的提示词</h2><span>{prompts.length} 条</span></div>
        <div className="image-studio-prompt-save"><input aria-label="提示词名称" placeholder="名称" value={promptTitle} onChange={(event) => setPromptTitle(event.target.value)} /><button type="button" disabled={!prompt.trim()} onClick={() => void savePrompt(prompt)}>保存当前输入</button></div>
        <div className="image-studio-prompt-list">{prompts.map((item) => <article key={item.promptId} className="image-studio-prompt-item"><strong>{item.title}</strong><p>{item.contentMarkdown}</p><button type="button" onClick={() => { setPrompt(item.contentMarkdown); onSectionChange('image-studio-create'); showToast('已应用到输入框', 'success'); }}>用于生成</button></article>)}</div>
      </section>}

      {view === 'works' && <section className="image-studio-library">
        <div className="image-studio-library-head"><h2>我的作品</h2><span>{state?.works.length || 0} 张</span></div>
        <div className="image-studio-grid">{state?.works.map((work) => <article key={work.workId} className="image-studio-work-item">
          <img src={work.assetUrl} alt={work.prompt} loading="lazy" />
          <div><strong>{work.width} × {work.height}</strong><p>{work.prompt}</p></div>
          <footer>
            <button type="button" onClick={() => { setSelectedWorkId(work.workId); onSectionChange('image-studio-create'); }}>查看</button>
            <button type="button" onClick={() => void updateWorks(work, 'favorite')}>{work.isFavorite ? '取消收藏' : '收藏'}</button>
            <button type="button" onClick={() => setConfirmDeleteId(work.workId)}>删除</button>
          </footer>
          {confirmDeleteId === work.workId && <div className="image-studio-confirm"><span>从作品列表删除？</span><button type="button" onClick={() => void updateWorks(work, 'delete')}>确认</button><button type="button" onClick={() => setConfirmDeleteId(null)}>取消</button></div>}
        </article>)}</div>
      </section>}
    </div>
  );
}

export default ImageStudioPage;
