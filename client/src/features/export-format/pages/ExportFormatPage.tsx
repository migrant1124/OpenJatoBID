import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { trackPageView } from '../../../shared/analytics/analytics';
import { FloatingToolbar, useToast } from '../../../shared/ui';
import type { FloatingToolbarGroup } from '../../../shared/ui';
import type {
  BodyTextStyleConfig,
  ExportFormatConfig,
  HeadingBorderConfig,
  HeadingNumberingFormat,
  HeadingStyleConfig,
  ImageStyleConfig,
  ListStyle,
  OrderedListStyle,
  PageSetupConfig,
  PaperSize,
  TableCellStyleConfig,
  TableStyleConfig,
} from '../../../shared/types/exportFormat';
import {
  ALIGNMENT_OPTIONS,
  DEFAULT_EXPORT_FORMAT,
  FONT_OPTIONS,
  HEADING_LEVEL_LABELS,
  HEADING_NUMBERING_FORMAT_OPTIONS,
  LIST_STYLE_OPTIONS,
  ORDERED_LIST_STYLE_OPTIONS,
  PAPER_DIMENSIONS,
  PAPER_SIZES,
  SIZE_OPTIONS,
} from '../../../shared/types/exportFormat';
import { buildExportFormatCssVars } from '../../../shared/utils/exportFormatCss';
import { formatOutlineNumber, formatOutlineTitle } from '../../../shared/utils/outlineNumbering';
import type { OutlineItem, WordExportProgressEvent } from '../../../shared/types';
import {
  EXPORT_LAYOUT_PRESETS,
  EXPORT_THEME_PRESETS,
  applyExportLayoutPreset,
  applyExportThemePreset,
} from '../exportFormatPresets';
import { TemplatePreview } from '../components/TemplatePreview';

type TemplateTab = 'quick' | 'layout' | 'cover' | 'heading' | 'body' | 'table' | 'image';
type TableCellStyleKey = 'header_row' | 'first_column' | 'body_cell';

interface ExportFormatPageProps {
  mode?: 'create' | 'edit';
  templateId?: string | null;
  onBack?: () => void;
}

const templateTabs: Array<{ id: TemplateTab; label: string }> = [
  { id: 'quick', label: '快捷设置' },
  { id: 'layout', label: '布局设置' },
  { id: 'cover', label: '封皮' },
  { id: 'heading', label: '标题样式' },
  { id: 'body', label: '正文样式' },
  { id: 'table', label: '表格样式' },
  { id: 'image', label: '图片设置' },
];

interface ExportProgressState {
  open: boolean;
  running: boolean;
  progress: number;
  message: string;
  warnings: string[];
  filePath?: string;
  error?: string;
}

const initialExportProgress: ExportProgressState = {
  open: false,
  running: false,
  progress: 0,
  message: '',
  warnings: [],
};

function collectLeafItems(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((item) => item.children?.length ? collectLeafItems(item.children) : [item]);
}

function hasGeneratedContent(items: OutlineItem[]) {
  return collectLeafItems(items).some((item) => String(item.content || '').trim());
}

function mergeFontOptions(...groups: Array<readonly string[]>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  groups.forEach((group) => {
    group.forEach((font) => {
      const name = String(font || '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      merged.push(name);
    });
  });

  return merged;
}

function collectConfigFonts(config: ExportFormatConfig): string[] {
  return [
    config.page.header_font,
    config.page.footer_font,
    ...config.headings.map((heading) => heading.font),
    config.body_text.font,
    config.table.header_row.font,
    config.table.first_column.font,
    config.table.body_cell.font,
    config.image.caption_font,
  ].filter(Boolean);
}

interface FontPickerProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

function FontPicker({ value, options, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchDirty, setSearchDirty] = useState(false);
  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!searchDirty || !query) return options;
    return options.filter((font) => font.toLowerCase().includes(query));
  }, [options, searchDirty, value]);

  const pickFont = (font: string) => {
    onChange(font);
    setSearchDirty(false);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setSearchDirty(false);
    }}>
      <div className="font-picker">
        <Popover.Anchor asChild>
          <input
            className="font-picker-input"
            type="text"
            value={value}
            onFocus={() => {
              setOpen(true);
              setSearchDirty(false);
            }}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
              setSearchDirty(true);
            }}
            placeholder="输入或选择字体"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
          />
        </Popover.Anchor>
      </div>
      <Popover.Portal>
        <Popover.Content
          className="font-picker-menu"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          role="listbox"
        >
          <div className="font-picker-summary">
            {searchDirty ? `匹配 ${filteredOptions.length} 个字体` : `共 ${options.length} 个字体，输入可搜索`}
          </div>
          {filteredOptions.length > 0 ? filteredOptions.map((font) => (
            <button
              key={font}
              type="button"
              className={`font-picker-option${font === value ? ' is-selected' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
                pickFont(font);
              }}
              role="option"
              aria-selected={font === value}
            >
              {font}
            </button>
          )) : <div className="font-picker-empty">没有匹配字体</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function headingNumberExample(index: number, heading: HeadingStyleConfig): string {
  const sampleIds = ['1', '1.1', '1.1.1', '1.1.1.1', '1.1.1.1.1', '1.1.1.1.1.1'];
  return formatOutlineNumber(sampleIds[index] || '1', heading);
}

function createDefaultExportFormat(): ExportFormatConfig {
  return {
    template_name: DEFAULT_EXPORT_FORMAT.template_name,
    page: { ...DEFAULT_EXPORT_FORMAT.page },
    heading_level1_page_break_before: DEFAULT_EXPORT_FORMAT.heading_level1_page_break_before,
    heading_border: { ...DEFAULT_EXPORT_FORMAT.heading_border, level_cell_colors: [...DEFAULT_EXPORT_FORMAT.heading_border.level_cell_colors] },
    headings: DEFAULT_EXPORT_FORMAT.headings.map((heading) => ({ ...heading })),
    body_text: { ...DEFAULT_EXPORT_FORMAT.body_text },
    table: {
      border_width: DEFAULT_EXPORT_FORMAT.table.border_width,
      border_color: DEFAULT_EXPORT_FORMAT.table.border_color,
      cell_padding_pt: DEFAULT_EXPORT_FORMAT.table.cell_padding_pt,
      full_width: DEFAULT_EXPORT_FORMAT.table.full_width,
      header_row: { ...DEFAULT_EXPORT_FORMAT.table.header_row },
      first_column: { ...DEFAULT_EXPORT_FORMAT.table.first_column },
      body_cell: { ...DEFAULT_EXPORT_FORMAT.table.body_cell },
    },
    image: { ...DEFAULT_EXPORT_FORMAT.image },
  };
}

function withExportFormatDefaults(source: ExportFormatConfig): ExportFormatConfig {
  const defaults = createDefaultExportFormat();
  return {
    ...defaults,
    ...source,
    page: { ...defaults.page, ...source.page },
    heading_border: {
      ...defaults.heading_border,
      ...source.heading_border,
      level_cell_colors: defaults.heading_border.level_cell_colors.map((color, index) => source.heading_border?.level_cell_colors?.[index] || color),
    },
    headings: defaults.headings.map((heading, index) => ({ ...heading, ...(source.headings?.[index] || {}) })),
    body_text: { ...defaults.body_text, ...source.body_text },
    table: {
      ...defaults.table,
      ...source.table,
      header_row: { ...defaults.table.header_row, ...source.table?.header_row },
      first_column: { ...defaults.table.first_column, ...source.table?.first_column },
      body_cell: { ...defaults.table.body_cell, ...source.table?.body_cell },
    },
    image: { ...defaults.image, ...source.image },
  };
}

function ExportFormatPage({ mode = 'create', templateId = null, onBack }: ExportFormatPageProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TemplateTab>('quick');
  const [config, setConfig] = useState<ExportFormatConfig>(() => createDefaultExportFormat());
  const [savedConfig, setSavedConfig] = useState<ExportFormatConfig | null>(null);
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(templateId);
  const [selectedLayoutPresetId, setSelectedLayoutPresetId] = useState('');
  const [selectedThemePresetId, setSelectedThemePresetId] = useState('');
  const [expandedHeadings, setExpandedHeadings] = useState<Set<number>>(new Set([0, 1]));
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [exportProgress, setExportProgress] = useState<ExportProgressState>(initialExportProgress);
  const [missingEvidenceRiskOpen, setMissingEvidenceRiskOpen] = useState(false);
  const [previewFullscreenOpen, setPreviewFullscreenOpen] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fonts = await window.yibiao?.systemFonts?.list?.();
        if (!cancelled && Array.isArray(fonts)) {
          setSystemFonts(fonts);
        }
      } catch (error) {
        console.warn('[export-format] 系统字体读取失败', error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    trackPageView(mode === 'edit' ? 'my-templates/edit' : 'new-template');
    let cancelled = false;
    (async () => {
      setLoaded(false);
      setLoadError('');
      try {
        if (mode === 'edit') {
          if (!templateId) {
            throw new Error('缺少要编辑的模板');
          }
          const template = await window.yibiao?.templates.get(templateId);
          if (!template) {
            throw new Error('模板不存在或已被删除');
          }
          if (cancelled) return;
          const nextConfig = withExportFormatDefaults(template.config);
          setCurrentTemplateId(template.template_id);
          setConfig(nextConfig);
          setSavedConfig(nextConfig);
          setSelectedLayoutPresetId('');
          setSelectedThemePresetId('');
          return;
        }

        const defaultConfig = createDefaultExportFormat();
        if (cancelled) return;
        setCurrentTemplateId(null);
        setConfig(defaultConfig);
        setSavedConfig(null);
        setSelectedLayoutPresetId('');
        setSelectedThemePresetId('');
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '未知错误';
        setLoadError(message);
        showToast(`加载模板失败：${message}`, 'error');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, showToast, templateId]);

  const isDirty = useMemo(() => !savedConfig || JSON.stringify(config) !== JSON.stringify(savedConfig), [config, savedConfig]);
  const previewStyle = useMemo<CSSProperties>(() => buildExportFormatCssVars(config), [config]);
  const fontOptions = useMemo(() => mergeFontOptions(FONT_OPTIONS, collectConfigFonts(config), systemFonts), [config, systemFonts]);

  const updateTemplate = useCallback((updates: Partial<ExportFormatConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const updatePage = useCallback((updates: Partial<PageSetupConfig>) => {
    setConfig((prev) => ({ ...prev, page: { ...prev.page, ...updates } }));
  }, []);

  const updateHeading = useCallback((index: number, updates: Partial<HeadingStyleConfig>) => {
    setConfig((prev) => ({
      ...prev,
      headings: prev.headings.map((heading, headingIndex) => headingIndex === index ? { ...heading, ...updates } : heading),
    }));
  }, []);

  const updateHeadingBorder = useCallback((updates: Partial<HeadingBorderConfig>) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        heading_border: { ...prev.heading_border, ...updates },
      };

      if (typeof updates.enabled === 'boolean' && selectedThemePresetId) {
        return applyExportThemePreset(next, selectedThemePresetId);
      }

      return next;
    });
  }, [selectedThemePresetId]);

  const updateHeadingBorderCellColor = useCallback((index: number, value: string) => {
    setConfig((prev) => {
      const levelCellColors = DEFAULT_EXPORT_FORMAT.heading_border.level_cell_colors.map((color, colorIndex) => prev.heading_border.level_cell_colors[colorIndex] || color);
      levelCellColors[index] = value;
      return {
        ...prev,
        heading_border: { ...prev.heading_border, level_cell_colors: levelCellColors },
      };
    });
  }, []);

  const updateBodyText = useCallback((updates: Partial<BodyTextStyleConfig>) => {
    setConfig((prev) => ({ ...prev, body_text: { ...prev.body_text, ...updates } }));
  }, []);

  const updateTable = useCallback((updates: Partial<TableStyleConfig>) => {
    setConfig((prev) => ({ ...prev, table: { ...prev.table, ...updates } }));
  }, []);

  const updateTableCell = useCallback((cellKey: TableCellStyleKey, updates: Partial<TableCellStyleConfig>) => {
    setConfig((prev) => ({
      ...prev,
      table: {
        ...prev.table,
        [cellKey]: { ...prev.table[cellKey], ...updates },
      },
    }));
  }, []);

  const updateImage = useCallback((updates: Partial<ImageStyleConfig>) => {
    setConfig((prev) => ({ ...prev, image: { ...prev.image, ...updates } }));
  }, []);

  const handleSave = useCallback(async () => {
    const templateName = config.template_name.trim();
    if (!templateName) {
      showToast('请先填写模板名称', 'info');
      return;
    }

    try {
      const nextConfig = templateName === config.template_name ? config : { ...config, template_name: templateName };
      const template = currentTemplateId
        ? await window.yibiao?.templates.update(currentTemplateId, nextConfig)
        : await window.yibiao?.templates.create(nextConfig);
      if (!template) {
        throw new Error('模板保存失败');
      }
      setCurrentTemplateId(template.template_id);
      setConfig(template.config);
      setSavedConfig(template.config);
      showToast(currentTemplateId ? '模板已保存' : '模板已创建', 'success');
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  }, [config, currentTemplateId, showToast]);

  const handleResetDefault = useCallback(() => {
    if (selectedLayoutPresetId || selectedThemePresetId) {
      setConfig((prev) => {
        const withLayout = selectedLayoutPresetId ? applyExportLayoutPreset(prev, selectedLayoutPresetId) : prev;
        return selectedThemePresetId ? applyExportThemePreset(withLayout, selectedThemePresetId) : withLayout;
      });
      showToast('已恢复当前预设样式，保存后生效', 'info');
      return;
    }

    setConfig(createDefaultExportFormat());
    showToast('已恢复默认模版设置，保存后生效', 'info');
  }, [selectedLayoutPresetId, selectedThemePresetId, showToast]);

  const handleApplyLayoutPreset = useCallback((presetId: string) => {
    if (!presetId) return;
    const preset = EXPORT_LAYOUT_PRESETS.find((item) => item.id === presetId);
    setSelectedLayoutPresetId(presetId);
    setConfig((prev) => {
      const withLayout = applyExportLayoutPreset(prev, presetId);
      return selectedThemePresetId ? applyExportThemePreset(withLayout, selectedThemePresetId) : withLayout;
    });
    showToast(`已应用版面预设：${preset?.label || '未命名预设'}，保存后生效`, 'success');
  }, [selectedThemePresetId, showToast]);

  const handleApplyThemePreset = useCallback((presetId: string) => {
    if (!presetId) return;
    const preset = EXPORT_THEME_PRESETS.find((item) => item.id === presetId);
    setSelectedThemePresetId(presetId);
    setConfig((prev) => applyExportThemePreset(prev, presetId));
    showToast(`已应用主题预设：${preset?.label || '未命名预设'}，保存后生效`, 'success');
  }, [showToast]);

  const handleExportTest = useCallback(async (acknowledgeMissingEvidence = false) => {
    let unsubscribe: (() => void) | undefined;

    try {
      const technicalPlan = await window.yibiao?.technicalPlan.loadState();
      const outlineData = technicalPlan?.outlineData;
      const outline = outlineData?.outline || [];
      if (!hasGeneratedContent(outline)) {
        showToast('无已完成标书', 'info');
        return;
      }

      const requestId = `template-export-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setExportProgress({
        open: true,
        running: true,
        progress: 2,
        message: '正在使用当前模板导出测试 Word。',
        warnings: [],
      });

      unsubscribe = window.yibiao?.export.onWordExportProgress((event: WordExportProgressEvent) => {
        if (event.requestId && event.requestId !== requestId) {
          return;
        }

        setExportProgress((prev) => ({
          ...prev,
          open: true,
          running: event.phase === 'running',
          progress: event.progress,
          message: event.message,
          warnings: event.warnings || prev.warnings,
          error: event.phase === 'error' ? event.message : undefined,
        }));
      });

      const result = await window.yibiao?.export.exportWord({
        source: 'technical-plan',
        requestId,
        export_format: config,
        acknowledgeMissingEvidence,
      });
      if (result?.canceled) {
        setExportProgress(initialExportProgress);
        showToast('已取消导出', 'info');
        return;
      }

      setExportProgress((prev) => ({
        ...prev,
        open: true,
        running: false,
        progress: 100,
        message: result?.message || 'Word 已导出，请打开文档核对版式。',
        warnings: result?.warnings || prev.warnings,
        filePath: result?.path,
      }));
      showToast(result?.message || 'Word 已导出', result?.warnings?.length ? 'info' : 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出测试失败';
      if (!acknowledgeMissingEvidence && message.includes('强制证明材料缺失，确认风险后方可导出')) {
        setExportProgress(initialExportProgress);
        setMissingEvidenceRiskOpen(true);
        return;
      }
      setExportProgress((prev) => ({
        ...prev,
        open: true,
        running: false,
        progress: 100,
        message,
        error: message,
      }));
      showToast(message, 'error');
    } finally {
      unsubscribe?.();
    }
  }, [config, showToast]);

  const handleOpenExportedFile = useCallback(async () => {
    if (!exportProgress.filePath) return;

    try {
      await window.yibiao?.export.openFile(exportProgress.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开文件失败';
      showToast(message, 'error');
    }
  }, [exportProgress.filePath, showToast]);

  const toggleHeading = useCallback((index: number) => {
    setExpandedHeadings((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const resetToolbarGroup: FloatingToolbarGroup = {
    id: 'template-reset',
    actions: [
      { id: 'reset-default', label: '重置默认', variant: 'danger', tooltip: selectedLayoutPresetId || selectedThemePresetId ? '恢复当前预设样式，保存后生效' : '恢复默认模版设置，保存后生效', onClick: handleResetDefault },
    ],
  };
  const exportTestToolbarGroup: FloatingToolbarGroup = {
    id: 'template-export-test',
    actions: [
      { id: 'export-test', label: '导出测试', variant: 'warning', disabled: exportProgress.running, onClick: () => { void handleExportTest(); } },
    ],
  };
  const previewToolbarGroup: FloatingToolbarGroup = {
    id: 'template-preview',
    actions: [
      { id: 'fullscreen-preview', label: '全屏预览', variant: 'success', tooltip: '放大右侧模板预览', onClick: () => setPreviewFullscreenOpen(true) },
    ],
  };
  const saveToolbarGroups: FloatingToolbarGroup[] = isDirty
    ? [
        {
          id: 'template-save-state',
          actions: [
            { id: 'save-indicator', label: '未保存', variant: 'ghost', disabled: true, onClick: () => {} },
          ],
        },
        {
          id: 'template-save',
          actions: [
            { id: 'save', label: '保存配置', variant: 'primary', onClick: handleSave },
          ],
        },
      ]
    : [
        {
          id: 'template-saved',
          actions: [
            { id: 'saved-indicator', label: '已保存', variant: 'ghost', disabled: true, onClick: () => {} },
          ],
        },
      ];
  const navigationToolbarGroup: FloatingToolbarGroup | null = onBack
    ? {
        id: 'template-navigation',
        actions: [
          { id: 'back', label: '返回我的模板', variant: 'secondary', onClick: onBack },
        ],
      }
    : null;
  const toolbarGroups: FloatingToolbarGroup[] = [
    ...(navigationToolbarGroup ? [navigationToolbarGroup] : []),
    previewToolbarGroup,
    resetToolbarGroup,
    exportTestToolbarGroup,
    ...saveToolbarGroups,
  ];

  const renderQuickSettings = () => (
    <>
      <div className="settings-section-title">
        <span />
        <strong>快捷设置</strong>
      </div>
      <div className="settings-list">
        <label className="settings-row">
          <div className="settings-row-copy">
            <strong>版面预设</strong>
            <span>快捷设置所有版面包括纸张、边距、标题、正文等</span>
          </div>
          <select value={selectedLayoutPresetId} onChange={(event) => handleApplyLayoutPreset(event.target.value)}>
            <option value="" disabled>选择版面预设</option>
            {EXPORT_LAYOUT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy">
            <strong>主题预设</strong>
            <span>未开启章节页框时只应用表格颜色；开启章节页框后同步应用标题、页框、页眉页脚和表格颜色。</span>
          </div>
          <select value={selectedThemePresetId} onChange={(event) => handleApplyThemePreset(event.target.value)}>
            <option value="" disabled>选择主题预设</option>
            {EXPORT_THEME_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </label>
      </div>
      <div className="export-format-preset-panel">
        <div className="export-format-preset-panel-head">
          <strong>主题色展示</strong>
          <span>主题只覆盖颜色；章节页框关闭时仅表格使用主题色。</span>
        </div>
        <div className="export-format-preset-list is-theme is-static">
          {EXPORT_THEME_PRESETS.map((preset) => (
            <div key={preset.id} className="export-format-preset-card export-format-theme-card is-static">
              <strong>{preset.label}</strong>
              <span className="export-format-preset-hint">{preset.description}</span>
              <div className="export-format-theme-swatches" aria-hidden="true">
                {preset.swatches.map((color) => <span key={color} style={{ background: color }} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const renderLayoutSettings = () => (
    <>
      <div className="settings-section-title">
        <span />
        <strong>布局设置</strong>
      </div>
      <div className="settings-list">
        <label className="settings-row">
          <div className="settings-row-copy"><strong>模板名称</strong></div>
          <input type="text" value={config.template_name} onChange={(event) => updateTemplate({ template_name: event.target.value })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>纸张</strong></div>
          <select value={config.page.paper_size} onChange={(event) => updatePage({ paper_size: event.target.value as PaperSize })}>
            {PAPER_SIZES.map((paper) => <option key={paper.value} value={paper.value}>{paper.label} - {paper.detail}</option>)}
          </select>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>方向</strong></div>
          <select value={config.page.orientation} onChange={(event) => updatePage({ orientation: event.target.value as 'portrait' | 'landscape' })}>
            <option value="portrait">纵向</option>
            <option value="landscape">横向</option>
          </select>
        </label>
        <div className="settings-row">
          <div className="settings-row-copy"><strong>页边距</strong><span>上 / 右 / 下 / 左（厘米）</span></div>
          <div className="export-format-margin-grid">
            <input type="number" min={0} max={10} step={0.1} value={config.page.margin_top_cm} onChange={(event) => updatePage({ margin_top_cm: Number(event.target.value) })} placeholder="上" />
            <input type="number" min={0} max={10} step={0.1} value={config.page.margin_right_cm} onChange={(event) => updatePage({ margin_right_cm: Number(event.target.value) })} placeholder="右" />
            <input type="number" min={0} max={10} step={0.1} value={config.page.margin_bottom_cm} onChange={(event) => updatePage({ margin_bottom_cm: Number(event.target.value) })} placeholder="下" />
            <input type="number" min={0} max={10} step={0.1} value={config.page.margin_left_cm} onChange={(event) => updatePage({ margin_left_cm: Number(event.target.value) })} placeholder="左" />
          </div>
        </div>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>页眉</strong></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.page.header_enabled} onChange={(event) => updatePage({ header_enabled: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
        {config.page.header_enabled && (
          <>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页眉文本</strong></div>
              <input type="text" value={config.page.header_text} onChange={(event) => updatePage({ header_text: event.target.value })} />
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页眉字体</strong></div>
              <FontPicker value={config.page.header_font} options={fontOptions} onChange={(font) => updatePage({ header_font: font })} />
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页眉字号</strong></div>
              <select value={config.page.header_size} onChange={(event) => updatePage({ header_size: event.target.value })}>
                {SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页眉对齐方式</strong></div>
              <select value={config.page.header_alignment} onChange={(event) => updatePage({ header_alignment: event.target.value })}>
                {ALIGNMENT_OPTIONS.map((alignment) => <option key={alignment} value={alignment}>{alignment}</option>)}
              </select>
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页眉颜色</strong></div>
              <input type="color" value={config.page.header_color} onChange={(event) => updatePage({ header_color: event.target.value })} />
            </label>
          </>
        )}
        <label className="settings-row">
          <div className="settings-row-copy"><strong>页脚</strong></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.page.footer_enabled} onChange={(event) => updatePage({ footer_enabled: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
        {config.page.footer_enabled && (
          <>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页脚文本</strong></div>
              <input type="text" value={config.page.footer_text} onChange={(event) => updatePage({ footer_text: event.target.value })} />
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页脚字体</strong></div>
              <FontPicker value={config.page.footer_font} options={fontOptions} onChange={(font) => updatePage({ footer_font: font })} />
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页脚字号</strong></div>
              <select value={config.page.footer_size} onChange={(event) => updatePage({ footer_size: event.target.value })}>
                {SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页脚对齐方式</strong></div>
              <select value={config.page.footer_alignment} onChange={(event) => updatePage({ footer_alignment: event.target.value })}>
                {ALIGNMENT_OPTIONS.map((alignment) => <option key={alignment} value={alignment}>{alignment}</option>)}
              </select>
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页脚颜色</strong></div>
              <input type="color" value={config.page.footer_color} onChange={(event) => updatePage({ footer_color: event.target.value })} />
            </label>
          </>
        )}
        {(config.page.footer_enabled || config.page.page_number_enabled) && (
          <label className="settings-row">
            <div className="settings-row-copy"><strong>距底边距离</strong><span>页脚或页码距页面底边，单位：厘米</span></div>
            <input type="number" min={0} max={5} step={0.1} value={config.page.footer_distance_cm} onChange={(event) => updatePage({ footer_distance_cm: Number(event.target.value) })} />
          </label>
        )}
        <label className="settings-row">
          <div className="settings-row-copy"><strong>页码</strong><span>是否启用页码显示</span></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.page.page_number_enabled} onChange={(event) => updatePage({ page_number_enabled: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
        {config.page.page_number_enabled && (
          <>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页码格式</strong><span>使用 {'{page}'} 表示当前页码</span></div>
              <input type="text" value={config.page.page_number_format} onChange={(event) => updatePage({ page_number_format: event.target.value })} />
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页码起始值</strong></div>
              <input type="number" min={1} max={9999} step={1} value={config.page.page_number_start} onChange={(event) => updatePage({ page_number_start: Number(event.target.value) })} />
            </label>
          </>
        )}
      </div>
    </>
  );

  const renderHeadingSettings = () => (
    <>
      <div className="settings-section-title">
        <span />
        <strong>标题样式</strong>
      </div>
      <div className="settings-list">
        <label className="settings-row">
          <div className="settings-row-copy"><strong>一级标题另起页</strong></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.heading_level1_page_break_before} onChange={(event) => updateTemplate({ heading_level1_page_break_before: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>章节页框</strong><span>会导致导航窗格失效</span></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.heading_border.enabled} onChange={(event) => updateHeadingBorder({ enabled: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
        {config.heading_border.enabled && (
          <>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>最小标题居左</strong><span>最小标题不显示序号，固定在内容左侧</span></div>
              <label className="yb-switch-control">
                <input type="checkbox" checked={config.heading_border.min_heading_left_enabled} onChange={(event) => updateHeadingBorder({ min_heading_left_enabled: event.target.checked })} />
                <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
              </label>
            </label>
            <label className="settings-row">
              <div className="settings-row-copy"><strong>页框颜色</strong></div>
              <input type="color" value={config.heading_border.border_color} onChange={(event) => updateHeadingBorder({ border_color: event.target.value })} />
            </label>
            <div className="export-format-heading-cell-colors">
              <div className="export-format-heading-cell-colors-title">
                <strong>标题单元格颜色</strong>
                <span>仅作用于章节页框内对应级别标题所在的表格单元格。</span>
              </div>
              <div className="export-format-heading-cell-color-grid">
                {HEADING_LEVEL_LABELS.map((label, index) => (
                  <label key={label}>
                    <span>{label}</span>
                    <input
                      type="color"
                      value={config.heading_border.level_cell_colors[index] || DEFAULT_EXPORT_FORMAT.heading_border.level_cell_colors[index]}
                      onChange={(event) => updateHeadingBorderCellColor(index, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <details className="export-format-heading-note">
        <summary className="export-format-heading-note-summary">
          <span className="export-format-heading-note-title">
            <strong>自定义编号说明</strong>
            <span>选择“自定义”后，可用 <code>{'{zh}'}</code>、<code>{'{num}'}</code>、<code>{'{tail2}'}</code> 等占位符组合标题编号。</span>
          </span>
          <span className="export-format-heading-note-toggle">
            <span className="is-closed">展开用法</span>
            <span className="is-open">收起说明</span>
            <span className="export-format-heading-note-chevron">▸</span>
          </span>
        </summary>
        <div className="export-format-heading-note-detail">
          <div className="export-format-heading-note-block">
            <span className="export-format-heading-note-label">怎么填写</span>
            <p>在每个标题卡片中，把“编号格式”设为“自定义”，再在“自定义格式”输入下面这些模板。</p>
          </div>
          <div className="export-format-heading-note-block">
            <span className="export-format-heading-note-label">占位符</span>
            <div className="export-format-heading-token-grid">
              <span><code>{'{zh}'}</code><small>当前级中文数字，如 一、二</small></span>
              <span><code>{'{num}'}</code><small>当前级数字，如 1、2</small></span>
              <span><code>{'{full}'}</code><small>完整编号，如 1.2.3</small></span>
              <span><code>{'{tail}'}</code><small>保留旧规则，三级起局部编号</small></span>
              <span><code>{'{tail1}'}</code><small>从一级开始，等同完整编号</small></span>
              <span><code>{'{tail2}'}</code><small>从二级开始，到当前级结束</small></span>
              <span><code>{'{tail3}'}</code><small>从三级开始，到当前级结束</small></span>
              <span><code>{'{tail4}'}</code><small>从四级开始，到当前级结束</small></span>
              <span><code>{'{tail5}'}</code><small>从五级开始，到当前级结束</small></span>
              <span><code>{'{tail6}'}</code><small>从六级开始，只保留六级编号</small></span>
              <span><code>{'{circled}'}</code><small>当前级圆圈数字，如 ①、②</small></span>
              <span><code>{'{alpha}'}</code><small>当前级小写字母，如 a、b</small></span>
              <span><code>{'{ROMAN}'}</code><small>当前级大写罗马数字，如 I、II</small></span>
            </div>
          </div>
          <div className="export-format-heading-note-block">
            <span className="export-format-heading-note-label">常见配置示例</span>
            <div className="export-format-heading-example-list">
              <span><code>（{'{zh}'}）</code><small>一级标题显示 （一）</small></span>
              <span><code>第{'{zh}'}章</code><small>一级标题显示 第一章</small></span>
              <span><code>{'{tail2}'}.</code><small>二级标题显示 1.</small></span>
              <span><code>{'{tail2}'}</code><small>三级标题显示 1.1，四级标题显示 1.1.1</small></span>
              <span><code>{'{tail3}'}</code><small>三级标题显示 1，四级标题显示 1.1</small></span>
              <span><code>{'{tail6}'}</code><small>六级标题只显示当前六级数字</small></span>
              <span><code>{'{num}'}、</code><small>当前级显示 1、</small></span>
              <span><code>（{'{num}'}）</code><small>当前级显示 （1）</small></span>
              <span><code>{'{circled}'}</code><small>当前级显示 ①</small></span>
              <span><code>{'{ALPHA}'}.</code><small>当前级显示 A.</small></span>
              <span><code>{'{roman}'}.</code><small>当前级显示 i.</small></span>
            </div>
          </div>
        </div>
      </details>
      <div className="export-format-heading-list">
        {config.headings.map((heading, index) => {
          const isExpanded = expandedHeadings.has(index);
          const numExample = headingNumberExample(index, heading);
          return (
            <div key={index} className={`export-format-heading-card${isExpanded ? ' is-expanded' : ''}`}>
              <button type="button" className="export-format-heading-header" onClick={() => toggleHeading(index)}>
                <span className="export-format-heading-label">{HEADING_LEVEL_LABELS[index]}</span>
                <span className="export-format-heading-example">{numExample || '无编号'}</span>
                <span className={`export-format-heading-chevron${isExpanded ? ' is-open' : ''}`}>▸</span>
              </button>
              {isExpanded && (
                <div className="export-format-heading-body">
                  <div className="export-format-heading-grid">
                    <label>
                      <span>编号格式</span>
                      <select value={heading.numbering_format} onChange={(event) => updateHeading(index, { numbering_format: event.target.value as HeadingNumberingFormat })}>
                        {HEADING_NUMBERING_FORMAT_OPTIONS.map((numberingFormat) => <option key={numberingFormat.value} value={numberingFormat.value}>{numberingFormat.label}</option>)}
                      </select>
                    </label>
                    {heading.numbering_format === 'custom' && (
                      <label>
                        <span>自定义格式</span>
                        <input
                          type="text"
                          value={heading.numbering_template}
                          placeholder="例如：第{zh}章、{tail2}、（{num}）"
                          onChange={(event) => updateHeading(index, { numbering_template: event.target.value })}
                        />
                      </label>
                    )}
                    <label>
                      <span>字体</span>
                      <FontPicker value={heading.font} options={fontOptions} onChange={(font) => updateHeading(index, { font })} />
                    </label>
                    <label>
                      <span>字号</span>
                      <select value={heading.size} onChange={(event) => updateHeading(index, { size: event.target.value })}>
                        {SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>对齐</span>
                      <select value={heading.alignment} onChange={(event) => updateHeading(index, { alignment: event.target.value })}>
                        {ALIGNMENT_OPTIONS.map((alignment) => <option key={alignment} value={alignment}>{alignment}</option>)}
                      </select>
                    </label>
                    <label className="export-format-heading-switch">
                      <span>加粗</span>
                      <label className="yb-switch-control">
                        <input type="checkbox" checked={heading.bold} onChange={(event) => updateHeading(index, { bold: event.target.checked })} />
                        <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
                      </label>
                    </label>
                    <label>
                      <span>文字颜色</span>
                      <input type="color" value={heading.text_color} onChange={(event) => updateHeading(index, { text_color: event.target.value })} />
                    </label>
                    <label>
                      <span>段前（磅）</span>
                      <input type="number" min={0} max={100} step={1} value={heading.spacing_before_pt} onChange={(event) => updateHeading(index, { spacing_before_pt: Number(event.target.value) })} />
                    </label>
                    <label>
                      <span>段后（磅）</span>
                      <input type="number" min={0} max={100} step={1} value={heading.spacing_after_pt} onChange={(event) => updateHeading(index, { spacing_after_pt: Number(event.target.value) })} />
                    </label>
                    <label>
                      <span>行距（倍）</span>
                      <input type="number" min={0.5} max={5} step={0.1} value={heading.line_spacing} onChange={(event) => updateHeading(index, { line_spacing: Number(event.target.value) })} />
                    </label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  const renderBodySettings = () => (
    <>
      <div className="settings-section-title">
        <span />
        <strong>正文样式</strong>
      </div>
      <div className="settings-list">
        <label className="settings-row">
          <div className="settings-row-copy"><strong>字体</strong><span>支持输入搜索系统字体，常用字体已置顶。</span></div>
          <FontPicker value={config.body_text.font} options={fontOptions} onChange={(font) => updateBodyText({ font })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>字号</strong></div>
          <select value={config.body_text.size} onChange={(event) => updateBodyText({ size: event.target.value })}>
            {SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>对齐</strong></div>
          <select value={config.body_text.alignment} onChange={(event) => updateBodyText({ alignment: event.target.value })}>
            {ALIGNMENT_OPTIONS.map((alignment) => <option key={alignment} value={alignment}>{alignment}</option>)}
          </select>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>段前（磅）</strong></div>
          <input type="number" min={0} max={100} step={1} value={config.body_text.spacing_before_pt} onChange={(event) => updateBodyText({ spacing_before_pt: Number(event.target.value) })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>段后（磅）</strong></div>
          <input type="number" min={0} max={100} step={1} value={config.body_text.spacing_after_pt} onChange={(event) => updateBodyText({ spacing_after_pt: Number(event.target.value) })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>首行缩进（字符）</strong></div>
          <input type="number" min={0} max={10} step={0.5} value={config.body_text.first_line_indent_chars} onChange={(event) => updateBodyText({ first_line_indent_chars: Number(event.target.value) })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>行间距（倍）</strong></div>
          <input type="number" min={0.5} max={5} step={0.1} value={config.body_text.line_spacing_multiple} onChange={(event) => updateBodyText({ line_spacing_multiple: Number(event.target.value) })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>无序列表符号</strong><span>Markdown “- 内容”的无序列表</span></div>
          <div className="export-bullet-library" role="radiogroup" aria-label="无序列表符号">
            {LIST_STYLE_OPTIONS.map((style) => {
              const selected = config.body_text.list_style === style.value;
              return (
                <button
                  type="button"
                  className={`export-bullet-option${selected ? ' is-active' : ''}`}
                  key={style.value}
                  role="radio"
                  aria-checked={selected}
                  title={style.label}
                  onClick={() => updateBodyText({ list_style: style.value as ListStyle })}
                >
                  <span style={{ fontFamily: style.font_family }}>{style.icon}</span>
                </button>
              );
            })}
          </div>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>有序列表序号</strong><span>Markdown “1. 内容”的有序列表</span></div>
          <select value={config.body_text.ordered_list_style} onChange={(event) => updateBodyText({ ordered_list_style: event.target.value as OrderedListStyle })}>
            {ORDERED_LIST_STYLE_OPTIONS.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
          </select>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>列表缩进（字符）</strong></div>
          <input type="number" min={0} max={10} step={0.5} value={config.body_text.list_indent_chars} onChange={(event) => updateBodyText({ list_indent_chars: Number(event.target.value) })} />
        </label>
      </div>
    </>
  );

  const renderTableCellSettings = (title: string, cellKey: TableCellStyleKey) => {
    const cell = config.table[cellKey];
    return (
      <div className="export-template-subsection">
        <strong>{title}</strong>
        <div className="export-format-heading-grid">
          <label>
            <span>字体</span>
            <FontPicker value={cell.font} options={fontOptions} onChange={(font) => updateTableCell(cellKey, { font })} />
          </label>
          <label>
            <span>字号</span>
            <select value={cell.size} onChange={(event) => updateTableCell(cellKey, { size: event.target.value })}>
              {SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <label>
            <span>对齐方式</span>
            <select value={cell.alignment} onChange={(event) => updateTableCell(cellKey, { alignment: event.target.value })}>
              {ALIGNMENT_OPTIONS.map((alignment) => <option key={alignment} value={alignment}>{alignment}</option>)}
            </select>
          </label>
          <label>
            <span>文字颜色</span>
            <input type="color" value={cell.text_color} onChange={(event) => updateTableCell(cellKey, { text_color: event.target.value })} />
          </label>
          <label>
            <span>背景色</span>
            <input type="color" value={cell.background_color} onChange={(event) => updateTableCell(cellKey, { background_color: event.target.value })} />
          </label>
        </div>
      </div>
    );
  };

  const renderTableSettings = () => (
    <>
      <div className="settings-section-title">
        <span />
        <strong>表格样式</strong>
      </div>
      <div className="settings-list">
        <label className="settings-row">
          <div className="settings-row-copy"><strong>线框宽度</strong></div>
          <input type="number" min={0} max={10} step={0.5} value={config.table.border_width} onChange={(event) => updateTable({ border_width: Number(event.target.value) })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>线框颜色</strong></div>
          <input type="color" value={config.table.border_color} onChange={(event) => updateTable({ border_color: event.target.value })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>单元格内边距</strong></div>
          <input type="number" min={0} max={50} step={1} value={config.table.cell_padding_pt} onChange={(event) => updateTable({ cell_padding_pt: Number(event.target.value) })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>表格铺满页面</strong></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.table.full_width} onChange={(event) => updateTable({ full_width: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
      </div>
      {renderTableCellSettings('首行', 'header_row')}
      {renderTableCellSettings('首列', 'first_column')}
      {renderTableCellSettings('其余单元格', 'body_cell')}
    </>
  );

  const renderImageSettings = () => (
    <>
      <div className="settings-section-title">
        <span />
        <strong>图片设置</strong>
      </div>
      <div className="settings-list">
        <label className="settings-row">
          <div className="settings-row-copy"><strong>图片最大宽度（%）</strong></div>
          <input type="number" min={10} max={100} step={1} value={config.image.max_width_percent} onChange={(event) => updateImage({ max_width_percent: Number(event.target.value) })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>图片对齐方式</strong></div>
          <select value={config.image.alignment} onChange={(event) => updateImage({ alignment: event.target.value })}>
            {ALIGNMENT_OPTIONS.map((alignment) => <option key={alignment} value={alignment}>{alignment}</option>)}
          </select>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>图题字体</strong></div>
          <FontPicker value={config.image.caption_font} options={fontOptions} onChange={(font) => updateImage({ caption_font: font })} />
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>图题字号</strong></div>
          <select value={config.image.caption_size} onChange={(event) => updateImage({ caption_size: event.target.value })}>
            {SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>图题对齐方式</strong></div>
          <select value={config.image.caption_alignment} onChange={(event) => updateImage({ caption_alignment: event.target.value })}>
            {ALIGNMENT_OPTIONS.map((alignment) => <option key={alignment} value={alignment}>{alignment}</option>)}
          </select>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>图题加粗</strong></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.image.caption_bold} onChange={(event) => updateImage({ caption_bold: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
        <label className="settings-row">
          <div className="settings-row-copy"><strong>图题斜体</strong></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.image.caption_italic} onChange={(event) => updateImage({ caption_italic: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
      </div>
    </>
  );

  const renderCoverSettings = () => (
    <>
      <div className="settings-section-title">
        <span />
        <strong>封皮</strong>
      </div>
      <div className="settings-list">
        <label className="settings-row">
          <div className="settings-row-copy"><strong>首页不同</strong><span>勾选后首页使用独立页眉页脚，适合封皮不显示页码。</span></div>
          <label className="yb-switch-control">
            <input type="checkbox" checked={config.page.first_page_different} onChange={(event) => updatePage({ first_page_different: event.target.checked })} />
            <span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span>
          </label>
        </label>
      </div>
    </>
  );

  const renderActiveSettings = () => {
    if (activeTab === 'quick') return renderQuickSettings();
    if (activeTab === 'layout') return renderLayoutSettings();
    if (activeTab === 'heading') return renderHeadingSettings();
    if (activeTab === 'body') return renderBodySettings();
    if (activeTab === 'table') return renderTableSettings();
    if (activeTab === 'image') return renderImageSettings();
    if (activeTab === 'cover') return renderCoverSettings();
    return null;
  };

  if (!loaded) {
    return <div className="settings-page export-template-page"><div className="settings-page-scroll"><div className="export-format-loading">加载中...</div></div></div>;
  }

  if (loadError) {
    return (
      <div className="settings-page export-template-page">
        <div className="settings-page-scroll">
          <div className="export-template-error-state">
            <strong>模板加载失败</strong>
            <span>{loadError}</span>
            {onBack ? <button type="button" className="secondary-action" onClick={onBack}>返回我的模板</button> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page export-template-page">
      <div className="settings-page-scroll export-template-scroll">
        <div className="settings-tab-shell" role="tablist" aria-label="模版设置分类">
          {templateTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab ${activeTab === tab.id ? 'is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="export-template-workspace">
          <section className="settings-page-section export-template-editor">
            {renderActiveSettings()}
          </section>
          <TemplatePreview config={config} previewStyle={previewStyle} />
        </div>
      </div>
      <Dialog.Root open={missingEvidenceRiskOpen} onOpenChange={setMissingEvidenceRiskOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="content-regenerate-card workflow-switch-card">
            <div className="content-regenerate-card-head">
              <span className="section-kicker">导出风险确认</span>
              <Dialog.Title>强制证明材料缺失</Dialog.Title>
              <Dialog.Description>当前技术方案存在未匹配到的强制证明材料。继续导出不会消除该风险。</Dialog.Description>
            </div>
            <div className="content-regenerate-actions">
              <Dialog.Close className="secondary-action" type="button">返回处理</Dialog.Close>
              <button
                className="primary-action"
                type="button"
                onClick={() => {
                  setMissingEvidenceRiskOpen(false);
                  void handleExportTest(true);
                }}
              >
                知悉风险并继续导出
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={exportProgress.open}
        onOpenChange={(open) => {
          if (!open && !exportProgress.running) {
            setExportProgress(initialExportProgress);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="export-progress-card">
            <div className="content-regenerate-card-head">
              <span className="section-kicker">导出测试</span>
              <Dialog.Title>{exportProgress.running ? '正在导出测试' : exportProgress.error ? '导出失败' : '导出完成'}</Dialog.Title>
              <Dialog.Description>
                正在使用当前模板导出已生成的技术方案。
              </Dialog.Description>
            </div>
            <div className="export-progress-body">
              <div className="content-generation-progress-track" aria-label={`导出测试进度 ${exportProgress.progress}%`}>
                <span style={{ width: `${exportProgress.progress}%` }} />
              </div>
              <p>{exportProgress.message || '正在处理导出任务，请稍候。'}</p>
              {exportProgress.warnings.length > 0 && (
                <div className="export-warning-list">
                  <strong>需要核对</strong>
                  {exportProgress.warnings.slice(0, 4).map((warning) => <small key={warning}>{warning}</small>)}
                  {exportProgress.warnings.length > 4 && <small>还有 {exportProgress.warnings.length - 4} 条图片提示，请打开导出的 Word 核对。</small>}
                </div>
              )}
            </div>
            {!exportProgress.running && (
              <div className="content-regenerate-actions">
                {!exportProgress.error && exportProgress.filePath && <button className="primary-action" type="button" onClick={() => { void handleOpenExportedFile(); }}>打开文件</button>}
                <Dialog.Close className={exportProgress.filePath && !exportProgress.error ? 'secondary-action' : 'primary-action'} type="button">知道了</Dialog.Close>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={previewFullscreenOpen} onOpenChange={setPreviewFullscreenOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="export-template-fullscreen-overlay" />
          <Dialog.Content className="export-template-fullscreen-dialog">
            <Dialog.Title className="export-template-fullscreen-title">全屏预览</Dialog.Title>
            <Dialog.Description className="export-template-fullscreen-description">当前模板的全屏排版预览。</Dialog.Description>
            <Dialog.Close className="export-template-fullscreen-close" type="button">退出全屏</Dialog.Close>
            <TemplatePreview config={config} previewStyle={previewStyle} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <FloatingToolbar groups={toolbarGroups} label="模版设置保存工具条" />
    </div>
  );
}

export default ExportFormatPage;
