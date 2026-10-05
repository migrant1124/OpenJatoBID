import type { AppMenuItem, SectionId } from '../shared/types/navigation';

export const appMenuItems: AppMenuItem[] = [
  {
    id: 'bid-generation',
    label: '标书生成',
    description: '技术方案编制与已有方案扩写',
    children: [
      {
        id: 'technical-plan',
        label: '生成技术方案',
        description: '根据招标文件重头编写一份标书',
        icon: 'document',
      },
      {
        id: 'existing-plan-expansion',
        label: '已有方案扩写',
        description: '解决人写技术方案太薄的问题，上传写好的方案，进行优化和扩充，遵从原方案真实可落地，又能扩写出厚厚的标书',
        icon: 'expand',
      },
    ],
  },
  {
    id: 'conversation',
    label: '对话模式',
    description: '实时对话生成方案或优化',
  },
  {
    id: 'image-studio',
    label: '生图模式',
    description: '图片创作与作品管理',
    children: [
      { id: 'image-studio-create', label: 'AI 生图', description: '根据中文需求创作图片' },
      { id: 'image-studio-prompts', label: '提示词中心', description: '管理个人提示词' },
      { id: 'image-studio-works', label: '我的作品', description: '查看和导出图片' },
    ],
  },
  {
    id: 'ppt', label: 'PPT 模式', description: '项目制作、模板与技能管理',
  },
  {
    id: 'template-settings',
    label: '模板设置',
    description: '标书导出模板与排版配置',
    children: [
      {
        id: 'my-templates',
        label: '我的模板',
        description: '管理已保存的标书导出模板',
        icon: 'document',
      },
      {
        id: 'new-template',
        label: '新建模板',
        description: '配置 Word 文档排版与编号格式',
        icon: 'export',
      },
    ],
  },
  {
    id: 'knowledge-base',
    label: '知识库',
    description: '素材、模板和案例资产',
    children: [
      {
        id: 'document-knowledge-base',
        label: '文档知识库',
        description: '管理文档资料、案例素材和可复用知识条目',
        icon: 'document',
      },
    ],
  },
  {
    id: 'bid-check',
    label: '标书检查',
    description: '查重、废标项与合规检查',
    children: [
      {
        id: 'duplicate-check',
        label: '标书查重',
        description: '相似度与重复表达检测',
        icon: 'compare',
      },
      {
        id: 'rejection-check',
        label: '废标项检查',
        description: '硬性条款与响应完整性',
        icon: 'shield',
      },
    ],
  },
];

const developerMenuItems: AppMenuItem[] = [
  {
    id: 'developer-test',
    label: '测试页',
    description: '开发者验证与问题复现',
    children: [
      {
        id: 'developer-json-test',
        label: 'Json请求测试',
        description: '复用项目真实目录生成链路，验证模型 JSON 响应和修复流程。',
        icon: 'code',
      },
      {
        id: 'developer-expansion-replace-test',
        label: '扩写替换测试',
        description: '使用真实扩写 patch 应用逻辑，复现 replace 锚点未命中后的追加问题。',
        icon: 'tool',
      },
      {
        id: 'developer-pi-agent-monitor',
        label: 'Pi Agent监视器',
        description: '查看 Pi Agent 运行状态、自检结果、实时事件流和任务工作区。',
        icon: 'tool',
      },
      {
        id: 'developer-system-diagnostics',
        label: '系统诊断',
        description: '检查运行时、本地转图、DSL、存储和外部能力状态。',
        icon: 'tool',
      },
    ],
  },
];

export function getAppMenuItems(developerMode: boolean): AppMenuItem[] {
  return developerMode ? [...appMenuItems, ...developerMenuItems] : appMenuItems;
}

export function getSectionOrder(developerMode: boolean): SectionId[] {
  return getAppMenuItems(developerMode).flatMap((item) => [item.id, ...(item.children?.map((child) => child.id) ?? [])]);
}

export function getAppMenuItemById(id: SectionId, developerMode: boolean): AppMenuItem | undefined {
  return getAppMenuItems(developerMode).find((item) => item.id === id);
}

export function getParentMenuItemBySection(section: SectionId, developerMode: boolean): AppMenuItem | undefined {
  return getAppMenuItems(developerMode).find((item) => item.id === section || item.children?.some((child) => child.id === section));
}
