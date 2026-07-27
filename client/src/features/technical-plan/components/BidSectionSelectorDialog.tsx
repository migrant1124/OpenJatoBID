import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { DetectedBidSection } from '../types';

interface BidSectionSelectorDialogProps {
  open: boolean;
  sections: DetectedBidSection[];
  onSelect: (sectionId: string) => void;
  onCancel: () => void;
  busy?: boolean;
}

function BidSectionSelectorDialog({
  open,
  sections,
  onSelect,
  onCancel,
  busy,
}: BidSectionSelectorDialogProps) {
  const [selectedId, setSelectedId] = useState<string>(sections[0]?.id || '');

  useEffect(() => {
    setSelectedId(open ? sections[0]?.id || '' : '');
  }, [open, sections]);

  const declaredLabel = `${sections.length} 个`;

  const getSectionDescription = (section: DetectedBidSection) => section.description || section.headLine;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="content-regenerate-modal" />
        <Dialog.Content className="bid-section-selector-card">
          <Dialog.Title className="sr-only">选择投标范围</Dialog.Title>
          <Dialog.Description className="sr-only">检测到招标文件包含多个标段或包，请选择本次投标范围。</Dialog.Description>

          <div className="bid-section-selector-head">
            <span>STEP 02</span>
            <h2>选择投标范围</h2>
            <p>检测到本招标文件共包含 <strong>{declaredLabel}</strong>，请选择您要投标的范围。后续解析和生成将只关注该范围相关内容。</p>
          </div>

          <div className="bid-section-selector-summary" aria-label="投标范围选择说明">
            <strong>共 {sections.length} 个投标包</strong>
            <span>请选择 1 个投标范围</span>
          </div>

          <div className="bid-section-selector-list" role="radiogroup" aria-label="投标范围列表">
            {sections.map((section) => {
              const isSelected = section.id === selectedId;
              const description = getSectionDescription(section);
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`bid-section-card${isSelected ? ' is-active' : ''}`}
                  onClick={() => setSelectedId(section.id)}
                  disabled={busy}
                  role="radio"
                aria-checked={isSelected}
              >
                  <span className="bid-section-card-radio" aria-hidden="true">
                    {isSelected && <span />}
                  </span>
                  <span className="bid-section-card-index">{section.unit} {String(section.index).padStart(2, '0')}</span>
                  <div className="bid-section-card-content">
                    <strong>{section.title}</strong>
                    {description && <p>{description}</p>}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="bid-section-selector-actions">
            <p>选择后将创建本次投标范围的工作副本</p>
            <Dialog.Close className="secondary-action" type="button" disabled={busy}>取消</Dialog.Close>
            <button
              type="button"
              className="primary-action"
              onClick={() => onSelect(selectedId)}
              disabled={busy || !selectedId}
            >
              {busy ? '导入中...' : '确认导入'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default BidSectionSelectorDialog;
