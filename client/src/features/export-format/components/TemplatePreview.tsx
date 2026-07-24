import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ExportFormatConfig } from '../../../shared/types/exportFormat';
import type { OutlineItem } from '../../../shared/types';
import { formatOutlineTitle } from '../../../shared/utils/outlineNumbering';

interface PreviewViewportSize {
  width: number;
  height: number;
}

interface PreviewBlock {
  id: string;
  content: ReactNode;
  startsNewPage?: boolean;
  fallbackHeight: number;
}

interface PreviewPaginationMetrics {
  bodyHeight: number;
  blockHeights: Record<string, number>;
}

const CSS_MM_TO_PX = 96 / 25.4;

function getPreviewPaperSize(config: ExportFormatConfig) {
  const paperSizes = {
    a3: { width: 297, height: 420 },
    a4: { width: 210, height: 297 },
    a5: { width: 148, height: 210 },
  } as const;
  const dims = paperSizes[config.page.paper_size as keyof typeof paperSizes] || paperSizes.a4;
  const landscape = config.page.orientation === 'landscape';

  return {
    widthPx: (landscape ? dims.height : dims.width) * CSS_MM_TO_PX,
    heightPx: (landscape ? dims.width : dims.height) * CSS_MM_TO_PX,
  };
}

function arePreviewBlockHeightsEqual(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

function headingPreviewTitle(config: ExportFormatConfig, level: number, id: string, title: string) {
  const heading = config.headings[level - 1];
  return formatOutlineTitle(id, title, heading);
}

interface TemplatePreviewProps {
  config: ExportFormatConfig;
  previewStyle: CSSProperties;
}

export function TemplatePreview({ config, previewStyle }: TemplatePreviewProps) {
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<PreviewViewportSize>({ width: 0, height: 0 });
  const [paginationMetrics, setPaginationMetrics] = useState<PreviewPaginationMetrics>({ bodyHeight: 0, blockHeights: {} });
  const paperSize = useMemo(() => getPreviewPaperSize(config), [config.page.orientation, config.page.paper_size]);
  const footerText = config.page.footer_enabled ? config.page.footer_text.trim() : '';
  const showFooterArea = Boolean(footerText) || config.page.page_number_enabled;
  const previewScale = useMemo(() => {
    const ratios = [1];
    if (viewportSize.width > 0 && paperSize.widthPx > 0) {
      ratios.push(viewportSize.width / paperSize.widthPx);
    }

    return Math.max(0.01, Math.min(...ratios));
  }, [paperSize.widthPx, viewportSize.width]);
  const scaleBoxStyle = useMemo<CSSProperties>(() => ({
    width: `${paperSize.widthPx * previewScale}px`,
  }), [paperSize.widthPx, previewScale]);
  const pageShellStyle = useMemo<CSSProperties>(() => ({
    width: `${paperSize.widthPx * previewScale}px`,
    height: `${paperSize.heightPx * previewScale}px`,
  }), [paperSize.heightPx, paperSize.widthPx, previewScale]);
  const paperStyle = useMemo<CSSProperties>(() => ({
    ...previewStyle,
    transform: `scale(${previewScale})`,
  }), [previewScale, previewStyle]);

  const renderPageHeader = () => (
    config.page.header_enabled && config.page.header_text.trim() ? (
      <div className="export-template-page-header">
        {config.page.header_text.trim()}
      </div>
    ) : null
  );

  const renderPageFooter = (pageIndex: number) => {
    if (!showFooterArea) return null;
    const pageNo = Math.max(1, Number(config.page.page_number_start) || 1) + pageIndex;
    const pageNumberText = String(config.page.page_number_format || '第{page}页').replace('{page}', String(pageNo));

    return (
      <div className="export-template-page-footer" style={config.page.footer_enabled ? undefined : { textAlign: 'center' }}>
        {footerText && <span>{footerText}</span>}
        {config.page.page_number_enabled && <span>{pageNumberText}</span>}
      </div>
    );
  };

  useEffect(() => {
    const node = previewStageRef.current;
    if (!node) return;

    const updateSize = (rect: DOMRectReadOnly) => {
      const nextSize = {
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      };
      setViewportSize((prev) => (
        prev.width === nextSize.width && prev.height === nextSize.height ? prev : nextSize
      ));
    };

    updateSize(node.getBoundingClientRect());
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateSize(entry.contentRect);
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const renderPreviewHeadingRow = (level: 1 | 2 | 3 | 4 | 5 | 6, id: string, title: string) => {
    const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    return (
      <div className={`export-template-chapter-heading-row is-level-${level}`}>
        <HeadingTag>{headingPreviewTitle(config, level, id, title)}</HeadingTag>
      </div>
    );
  };

  const renderPreviewContentRow = (content: ReactNode) => (
    <div className="export-template-chapter-content-row">{content}</div>
  );

  const renderPreviewLeafRow = (level: 1 | 2 | 3 | 4 | 5 | 6, id: string, title: string, content: ReactNode) => {
    if (!config.heading_border.min_heading_left_enabled) {
      return (
        <>
          {renderPreviewHeadingRow(level, id, title)}
          {renderPreviewContentRow(content)}
        </>
      );
    }

    const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    return (
      <div className={`export-template-chapter-leaf-row is-level-${level}`}>
        <div className="export-template-chapter-leaf-title">
          <HeadingTag>{title}</HeadingTag>
        </div>
        <div className="export-template-chapter-leaf-content">{content}</div>
      </div>
    );
  };

  const previewBlocks = useMemo<PreviewBlock[]>(() => {
    const serviceTable = (
      <table>
        <thead>
          <tr>
            <th>阶段</th>
            <th>内容</th>
            <th>输出</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>准备</td>
            <td>资料梳理与计划确认</td>
            <td>实施计划</td>
          </tr>
          <tr>
            <td>执行</td>
            <td>方案落地与质量检查</td>
            <td>交付成果</td>
          </tr>
        </tbody>
      </table>
    );
    const processFigure = (
      <figure className="export-template-image-figure">
        <div className="export-template-image-placeholder">图片预览</div>
        <figcaption>图 1 项目实施流程示意</figcaption>
      </figure>
    );

    if (config.heading_border.enabled) {
      const frameBlock = (id: string, content: ReactNode, fallbackHeight: number, startsNewPage = false): PreviewBlock => ({
        id,
        fallbackHeight,
        startsNewPage,
        content: <section className="export-template-chapter-frame is-fragment">{content}</section>,
      });

      return [
        frameBlock('frame-1-h1', renderPreviewHeadingRow(1, '1', '项目实施方案'), 58),
        frameBlock('frame-1-intro', renderPreviewContentRow(<p>本节展示模板设置在导出文档中的基础排版效果，包括页面边距、正文样式、标题层级和表格展示。</p>), 74),
        frameBlock('frame-1-h2', renderPreviewHeadingRow(2, '1.1', '总体目标'), 46),
        frameBlock('frame-1-goal', renderPreviewContentRow(<p>围绕项目建设目标，结合招标文件要求，形成可执行、可检查、可交付的技术实施方案。</p>), 74),
        frameBlock('frame-1-h3', renderPreviewHeadingRow(3, '1.1.1', '实施安排'), 42),
        frameBlock('frame-1-plan', renderPreviewContentRow(<p>项目团队将按阶段推进需求确认、方案设计、系统实施、联调测试和验收交付等工作。</p>), 74),
        frameBlock('frame-1-h4', renderPreviewHeadingRow(4, '1.1.1.1', '需求确认'), 38),
        frameBlock('frame-1-confirm', renderPreviewContentRow(<p>明确业务边界、交付范围和关键验收指标，形成统一的实施依据。</p>), 74),
        frameBlock('frame-1-h5', renderPreviewHeadingRow(5, '1.1.1.1.1', '资料收集'), 34),
        frameBlock('frame-1-collect', renderPreviewContentRow(<p>整理招标文件、现状资料和接口清单，支撑后续方案细化。</p>), 74),
        frameBlock('frame-1-leaf-1', renderPreviewLeafRow(6, '1.1.1.1.1.1', '记录归档', <>
                <p>对确认过程、会议纪要和问题闭环结果进行留痕归档。</p>
                <ul>
                  <li>建立项目启动、过程检查和验收交付的闭环机制。</li>
                  <li>按周同步风险、进度和资源需求，确保实施节奏可控。</li>
                </ul>
                <ol>
                  <li>完成资料接收和范围确认。</li>
                  <li>完成过程复核和成果归档。</li>
                </ol>
                {processFigure}
              </>), 250),
        frameBlock('frame-1-leaf-2', renderPreviewLeafRow(6, '1.1.1.1.1.2', '过程复核', <p>对关键节点的确认材料、实施记录和交付清单进行复核，确保过程资料完整一致。</p>), 82),
        frameBlock('frame-1-leaf-3', renderPreviewLeafRow(6, '1.1.1.1.1.3', '资料归档', <p>按项目阶段整理归档目录、会议纪要、问题闭环记录和验收支撑材料。</p>), 82),
        frameBlock('frame-2-h1', renderPreviewHeadingRow(1, '2', '运维保障方案'), 58, config.heading_level1_page_break_before),
        frameBlock('frame-2-intro', renderPreviewContentRow(<p>本章展示第二个一级目录，用于预览一级标题另起页、页眉页脚延续和章节页框跨页排版效果。</p>), 74),
        frameBlock('frame-2-leaf-1', renderPreviewLeafRow(2, '2.1', '监控中心值守', <p>值守团队按照 7×24 小时轮班机制开展监控、告警确认、事件记录和问题派单。</p>), 82),
        frameBlock('frame-2-leaf-2', renderPreviewLeafRow(2, '2.2', '故障响应机制', <><p>发现系统异常后，按照分级响应流程定位影响范围，组织软件、网络和硬件人员协同处理。</p>{serviceTable}</>), 210),
        frameBlock('frame-2-leaf-3', renderPreviewLeafRow(2, '2.3', '巡检维护计划', <p>定期检查系统运行状态、设备资源和关键链路，形成巡检记录和问题整改清单。</p>), 82),
        frameBlock('frame-2-leaf-4', renderPreviewLeafRow(2, '2.4', '质量保障措施', <p>通过交付检查、过程复盘和服务评价，持续优化运维质量和响应效率。</p>), 82),
      ];
    }

    return [
      { id: 'h1-1', fallbackHeight: 64, content: <h1>{headingPreviewTitle(config, 1, '1', '项目实施方案')}</h1> },
      { id: 'p-1', fallbackHeight: 64, content: <p>本节展示模板设置在导出文档中的基础排版效果，包括页面边距、正文样式、标题层级和表格展示。</p> },
      { id: 'h2-1', fallbackHeight: 46, content: <h2>{headingPreviewTitle(config, 2, '1.1', '总体目标')}</h2> },
      { id: 'p-2', fallbackHeight: 64, content: <p>围绕项目建设目标，结合招标文件要求，形成可执行、可检查、可交付的技术实施方案。</p> },
      { id: 'h3-1', fallbackHeight: 40, content: <h3>{headingPreviewTitle(config, 3, '1.1.1', '实施安排')}</h3> },
      { id: 'p-3', fallbackHeight: 64, content: <p>项目团队将按阶段推进需求确认、方案设计、系统实施、联调测试和验收交付等工作。</p> },
      { id: 'h4-1', fallbackHeight: 36, content: <h4>{headingPreviewTitle(config, 4, '1.1.1.1', '需求确认')}</h4> },
      { id: 'p-4', fallbackHeight: 64, content: <p>明确业务边界、交付范围和关键验收指标，形成统一的实施依据。</p> },
      { id: 'h5-1', fallbackHeight: 32, content: <h5>{headingPreviewTitle(config, 5, '1.1.1.1.1', '资料收集')}</h5> },
      { id: 'p-5', fallbackHeight: 64, content: <p>整理招标文件、现状资料和接口清单，支撑后续方案细化。</p> },
      { id: 'h6-1', fallbackHeight: 30, content: <h6>{headingPreviewTitle(config, 6, '1.1.1.1.1.1', '记录归档')}</h6> },
      { id: 'h6-2', fallbackHeight: 30, content: <h6>{headingPreviewTitle(config, 6, '1.1.1.1.1.2', '过程复核')}</h6> },
      { id: 'p-5-2', fallbackHeight: 54, content: <p>对关键节点的确认材料、实施记录和交付清单进行复核，确保过程资料完整一致。</p> },
      { id: 'h6-3', fallbackHeight: 30, content: <h6>{headingPreviewTitle(config, 6, '1.1.1.1.1.3', '资料归档')}</h6> },
      { id: 'p-5-3', fallbackHeight: 54, content: <p>按项目阶段整理归档目录、会议纪要、问题闭环记录和验收支撑材料。</p> },
      { id: 'list-1', fallbackHeight: 110, content: <ul><li>建立项目启动、过程检查和验收交付的闭环机制。</li><li>按周同步风险、进度和资源需求，确保实施节奏可控。</li><li>保留关键过程记录，便于后续审查和复盘。</li></ul> },
      { id: 'ordered-list-1', fallbackHeight: 82, content: <ol><li>完成资料接收和范围确认。</li><li>完成过程复核和成果归档。</li><li>完成验收支撑材料提交。</li></ol> },
      { id: 'figure-1', fallbackHeight: 150, content: processFigure },
      { id: 'table-1', fallbackHeight: 130, content: serviceTable },
      { id: 'h1-2', startsNewPage: config.heading_level1_page_break_before, fallbackHeight: 64, content: <h1>{headingPreviewTitle(config, 1, '2', '运维保障方案')}</h1> },
      { id: 'p-6', fallbackHeight: 82, content: <p>本章展示第二个一级目录，用于预览一级标题另起页、页眉页脚延续和多页排版效果。</p> },
      { id: 'h2-2', fallbackHeight: 46, content: <h2>{headingPreviewTitle(config, 2, '2.1', '监控中心值守')}</h2> },
      { id: 'p-7', fallbackHeight: 90, content: <p>值守团队按照 7×24 小时轮班机制开展监控、告警确认、事件记录和问题派单，确保关键系统异常能够及时发现、及时响应、及时闭环。</p> },
      { id: 'h2-3', fallbackHeight: 46, content: <h2>{headingPreviewTitle(config, 2, '2.2', '故障响应机制')}</h2> },
      { id: 'p-8', fallbackHeight: 90, content: <p>发现系统异常后，按照分级响应流程定位影响范围，组织软件、网络和硬件人员协同处理，并保留处理过程记录。</p> },
      { id: 'h2-4', fallbackHeight: 46, content: <h2>{headingPreviewTitle(config, 2, '2.3', '巡检维护计划')}</h2> },
      { id: 'p-9', fallbackHeight: 72, content: <p>定期检查系统运行状态、设备资源和关键链路，形成巡检记录和问题整改清单。</p> },
      { id: 'h2-5', fallbackHeight: 46, content: <h2>{headingPreviewTitle(config, 2, '2.4', '质量保障措施')}</h2> },
      { id: 'p-10', fallbackHeight: 72, content: <p>通过交付检查、过程复盘和服务评价，持续优化运维质量和响应效率。</p> },
      { id: 'table-2', fallbackHeight: 130, content: serviceTable },
    ];
  }, [config]);

  useEffect(() => {
    const node = measureRef.current;
    if (!node) return;

    let frameId = 0;
    const measure = () => {
      const body = node.querySelector<HTMLElement>('[data-preview-measure-body="true"]');
      if (!body) return;

      const blockHeights: Record<string, number> = {};
      node.querySelectorAll<HTMLElement>('[data-preview-block-id]').forEach((block) => {
        const blockId = block.dataset.previewBlockId;
        if (blockId) blockHeights[blockId] = Math.ceil(block.getBoundingClientRect().height);
      });

      const bodyHeight = Math.floor(body.getBoundingClientRect().height);
      setPaginationMetrics((prev) => (
        prev.bodyHeight === bodyHeight && arePreviewBlockHeightsEqual(prev.blockHeights, blockHeights)
          ? prev
          : { bodyHeight, blockHeights }
      ));
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(node);
    node.querySelectorAll<HTMLElement>('[data-preview-block-id]').forEach((block) => observer.observe(block));

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [previewBlocks, previewStyle, showFooterArea]);

  const previewPages = useMemo(() => {
    const bodyHeight = paginationMetrics.bodyHeight || Math.max(240, Math.round(paperSize.heightPx * 0.68));
    const pages: PreviewBlock[][] = [[]];
    let usedHeight = 0;

    previewBlocks.forEach((block) => {
      const measuredHeight = paginationMetrics.blockHeights[block.id] || block.fallbackHeight;
      const blockHeight = Math.max(1, Math.ceil(measuredHeight));
      const currentPage = pages[pages.length - 1];
      const shouldStartNewPage = (block.startsNewPage && currentPage.length > 0)
        || (currentPage.length > 0 && usedHeight + blockHeight > bodyHeight);

      if (shouldStartNewPage) {
        pages.push([]);
        usedHeight = 0;
      }

      pages[pages.length - 1].push(block);
      usedHeight += Math.min(blockHeight, bodyHeight);
    });

    return pages.filter((page) => page.length > 0);
  }, [paginationMetrics.blockHeights, paginationMetrics.bodyHeight, paperSize.heightPx, previewBlocks]);

  const renderPreviewBlock = (block: PreviewBlock, measure = false) => (
    <div key={block.id} className="export-template-preview-block" data-preview-block-id={measure ? block.id : undefined}>
      {block.content}
    </div>
  );

  return (
    <aside className="settings-page-section export-template-preview-panel" aria-label="模板预览">
      <div className="export-template-preview-scroll" ref={previewStageRef}>
        <div className="export-template-preview-scale-box" style={scaleBoxStyle}>
          <div className="export-template-preview-page-stack">
            {previewPages.map((page, pageIndex) => (
              <div key={pageIndex} className="export-template-preview-page-shell" style={pageShellStyle}>
                <div className="export-format-paper export-format-preview-content export-template-preview-paper" style={paperStyle}>
                  {renderPageHeader()}
                  <div className="export-template-page-body">
                    {page.map((block) => renderPreviewBlock(block))}
                  </div>
                  {renderPageFooter(pageIndex)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="export-template-preview-measure" ref={measureRef} aria-hidden="true">
        <div className="export-format-paper export-format-preview-content export-template-preview-paper" style={previewStyle}>
          {renderPageHeader()}
          <div className="export-template-page-body" data-preview-measure-body="true">
            {previewBlocks.map((block) => renderPreviewBlock(block, true))}
          </div>
          {renderPageFooter(0)}
        </div>
      </div>
    </aside>
  );
}

export default TemplatePreview;