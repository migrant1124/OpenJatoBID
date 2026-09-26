import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import type { TechnicalPlanStep } from '../types';

export interface TechnicalPlanProject {
  id: string;
  name: string;
  buyer: string;
  projectNumber: string;
  lot: string;
  step: TechnicalPlanStep;
  updatedAt: string;
  createdAt: string;
  unavailableReason?: string;
}

interface Props {
  projects: TechnicalPlanProject[];
  loading: boolean;
  error: string;
  onCreate: (data: { name: string; buyer?: string; projectNumber?: string; lot?: string }) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const stepNames: Record<TechnicalPlanStep, string> = {
  'document-analysis': '招标资料',
  'bid-analysis': '招标文件解析',
  'outline-generation': '目录生成',
  'global-facts': '全局事实设定',
  'content-edit': '正文生成',
  expand: '扩写改写',
};

function ProjectListPage({ projects, loading, error, onCreate, onOpen, onDelete }: Props) {
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [buyer, setBuyer] = useState('');
  const [projectNumber, setProjectNumber] = useState('');
  const [lot, setLot] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TechnicalPlanProject | null>(null);
  const [working, setWorking] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const visibleProjects = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return query ? projects.filter((project) => [project.name, project.buyer, project.projectNumber, project.lot].some((text) => text.toLowerCase().includes(query))) : projects;
  }, [keyword, projects]);

  const create = async () => {
    if (!name.trim()) return;
    setWorking(true);
    try {
      setDialogError('');
      await onCreate({ name, buyer, projectNumber, lot });
      setCreateOpen(false);
      setName(''); setBuyer(''); setProjectNumber(''); setLot('');
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '创建项目失败');
    } finally { setWorking(false); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setWorking(true);
    try {
      setDialogError('');
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '删除项目失败');
    } finally { setWorking(false); }
  };

  return (
    <div className="technical-project-list">
      <div className="technical-project-list-head">
        <div><span className="section-kicker">标书生成</span><h2>项目列表</h2><p>选择项目继续，或新建一个项目。</p></div>
        <button type="button" className="primary-action" onClick={() => setCreateOpen(true)} disabled={working}>新建项目</button>
      </div>
      <div className="technical-project-list-card">
        <input aria-label="搜索项目" placeholder="搜索项目名称、招标人、编号或标包" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        {error ? <p role="alert">{error}</p> : null}
        <div className="technical-project-list-scroll">
          <table><thead><tr><th>项目名称</th><th>招标人／标包信息</th><th>当前阶段</th><th>最近保存时间</th><th>操作</th></tr></thead>
            <tbody>{visibleProjects.map((project) => <tr key={project.id}>
              <td><button type="button" className="technical-project-name" title={project.unavailableReason || project.name} onClick={() => void onOpen(project.id)} disabled={working}>{project.name}</button></td>
              <td>{[project.buyer, project.projectNumber, project.lot].filter(Boolean).join(' · ') || '—'}</td>
              <td>{project.unavailableReason ? '—' : stepNames[project.step]}</td><td>{new Date(project.updatedAt).toLocaleString('zh-CN')}</td>
              <td><button type="button" className="technical-project-delete" aria-label={`删除项目 ${project.name}`} title="删除项目" onClick={() => setDeleteTarget(project)} disabled={working}>删除</button></td>
            </tr>)}</tbody></table>
          {!loading && !error && visibleProjects.length === 0 ? <div className="technical-project-empty">{projects.length ? '没有匹配的项目' : '暂无项目，请先新建项目'}</div> : null}
          {loading ? <div className="technical-project-empty">正在读取项目…</div> : null}
        </div>
        <p className="technical-project-hint">定期清理不用的项目，项目资料会占用C盘空间。</p>
      </div>

      <Dialog.Root open={createOpen} onOpenChange={(open) => !working && setCreateOpen(open)}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="content-regenerate-card technical-project-dialog">
        <Dialog.Title>新建项目</Dialog.Title><Dialog.Description>项目名称必填；同名项目也会分别保存。</Dialog.Description>
        <label>项目名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>招标人（可选）<input value={buyer} onChange={(event) => setBuyer(event.target.value)} /></label>
        <label>项目编号（可选）<input value={projectNumber} onChange={(event) => setProjectNumber(event.target.value)} /></label>
        <label>标包信息（可选）<input value={lot} onChange={(event) => setLot(event.target.value)} /></label>
        {dialogError ? <p role="alert">{dialogError}</p> : null}
        <div className="content-regenerate-actions"><Dialog.Close type="button" className="secondary-action" disabled={working}>取消</Dialog.Close><button type="button" className="primary-action" onClick={() => void create()} disabled={working || !name.trim()}>创建项目</button></div>
      </Dialog.Content></Dialog.Portal></Dialog.Root>

      <Dialog.Root open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !working && setDeleteTarget(null)}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="content-regenerate-card technical-project-dialog">
        <Dialog.Title>删除项目</Dialog.Title><Dialog.Description>确认删除“{deleteTarget?.name}”？这会清空该项目在本应用中的全部资料、生成内容和记录，应用内不可恢复；不会删除外部原件或其他项目。</Dialog.Description>
        {dialogError ? <p role="alert">{dialogError}</p> : null}
        <div className="content-regenerate-actions"><button type="button" className="secondary-action" autoFocus onClick={() => setDeleteTarget(null)} disabled={working}>取消</button><button type="button" className="danger-action" onClick={() => void remove()} disabled={working}>确认删除</button></div>
      </Dialog.Content></Dialog.Portal></Dialog.Root>
    </div>
  );
}

export default ProjectListPage;
