import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { renderMarkdownHtml } from '../markdown/renderMarkdownHtml';

type MarkdownImageMode = 'default' | 'preview' | 'lazy';
type MarkdownLinkMode = 'default' | 'external' | 'text';

interface MarkdownRendererProps {
  children: string;
  allowRawHtml?: boolean;
  enableGfm?: boolean;
  imageMode?: MarkdownImageMode;
  imageClassName?: string;
  linkMode?: MarkdownLinkMode;
  linkTextClassName?: string;
  previewImageTitle?: string;
  onPreviewImage?: (src: string, alt: string) => void;
}

function normalizeExternalUrl(value: string | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^www\./i.test(raw) ? `https://${raw}` : raw;
}

function isExternalHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function openExternal(url: string) {
  if (window.yibiao?.openExternal) {
    void window.yibiao.openExternal(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

function getElementClassName(element: Element) {
  return element.getAttribute('class') || undefined;
}

function childrenFromDom(nodes: ChildNode[], renderNode: (node: ChildNode, index: number) => ReactNode) {
  return nodes.map((node, index) => renderNode(node, index));
}

function MarkdownRenderer({
  children,
  allowRawHtml = true,
  enableGfm = true,
  imageMode = 'default',
  imageClassName,
  linkMode = 'external',
  linkTextClassName,
  previewImageTitle = '点击放大查看',
  onPreviewImage,
}: MarkdownRendererProps) {
  const html = useMemo(() => renderMarkdownHtml(children, { allowRawHtml, enableGfm }), [allowRawHtml, children, enableGfm]);

  const content = useMemo(() => {
    const document = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = document.body.firstElementChild;
    const renderNode = (node: ChildNode, index: number): ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return null;

      const element = node as Element;
      const tag = element.tagName.toLowerCase();
      const childNodes = Array.from(element.childNodes);
      const renderedChildren = childrenFromDom(childNodes, renderNode);
      const className = getElementClassName(element);
      const key = `${tag}-${index}`;

      if (tag === 'br') return <br key={key} />;
      if (tag === 'hr') return <hr key={key} />;
      if (tag === 'a') {
        const href = element.getAttribute('href') || '';
        const externalUrl = normalizeExternalUrl(href);
        if (linkMode === 'text') {
          return <span key={key} className={linkTextClassName}>{renderedChildren}</span>;
        }

        const isExternal = linkMode === 'external' && isExternalHttpUrl(externalUrl);
        return (
          <a
            key={key}
            className={className}
            href={isExternal ? externalUrl : href}
            rel={isExternal ? 'noreferrer' : undefined}
            target={isExternal ? '_blank' : undefined}
            onClick={(event) => {
              if (!isExternal) return;
              event.preventDefault();
              event.stopPropagation();
              openExternal(externalUrl);
            }}
          >
            {renderedChildren}
          </a>
        );
      }

      if (tag === 'img') {
        const src = element.getAttribute('src') || '';
        const alt = element.getAttribute('alt') || '正文图片';
        const previewEnabled = imageMode === 'preview' && Boolean(src) && Boolean(onPreviewImage);
        const handlePreview = () => {
          if (previewEnabled) onPreviewImage?.(src, alt);
        };
        const handleKeyDown = (event: KeyboardEvent<HTMLImageElement>) => {
          if (!previewEnabled || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          handlePreview();
        };

        return (
          <img
            key={key}
            src={src}
            alt={alt}
            className={imageClassName || className}
            loading={imageMode === 'lazy' ? 'lazy' : undefined}
            decoding={imageMode === 'lazy' ? 'async' : undefined}
            role={previewEnabled ? 'button' : undefined}
            tabIndex={previewEnabled ? 0 : undefined}
            title={previewEnabled ? previewImageTitle : undefined}
            onClick={previewEnabled ? handlePreview : undefined}
            onKeyDown={previewEnabled ? handleKeyDown : undefined}
          />
        );
      }

      if (tag === 'input' && (element.getAttribute('type') || '').toLowerCase() === 'checkbox') {
        return (
          <input
            key={key}
            id={element.getAttribute('id') || undefined}
            type="checkbox"
            checked={element.hasAttribute('checked')}
            disabled
            readOnly
            className={className}
          />
        );
      }

      const props = { className };
      if (tag === 'p') {
        const isFigureCaption = /^图[:：]/.test((element.textContent || '').trim());
        return <p key={key} className={[className, isFigureCaption ? 'markdown-figure-caption' : ''].filter(Boolean).join(' ') || undefined}>{renderedChildren}</p>;
      }

      if (tag === 'h1') return <h1 key={key} {...props}>{renderedChildren}</h1>;
      if (tag === 'h2') return <h2 key={key} {...props}>{renderedChildren}</h2>;
      if (tag === 'h3') return <h3 key={key} {...props}>{renderedChildren}</h3>;
      if (tag === 'h4') return <h4 key={key} {...props}>{renderedChildren}</h4>;
      if (tag === 'h5') return <h5 key={key} {...props}>{renderedChildren}</h5>;
      if (tag === 'h6') return <h6 key={key} {...props}>{renderedChildren}</h6>;
      if (tag === 'strong') return <strong key={key} {...props}>{renderedChildren}</strong>;
      if (tag === 'b') return <b key={key} {...props}>{renderedChildren}</b>;
      if (tag === 'em') return <em key={key} {...props}>{renderedChildren}</em>;
      if (tag === 'i') return <i key={key} {...props}>{renderedChildren}</i>;
      if (tag === 'del') return <del key={key} {...props}>{renderedChildren}</del>;
      if (tag === 's') return <s key={key} {...props}>{renderedChildren}</s>;
      if (tag === 'ul') return <ul key={key} {...props}>{renderedChildren}</ul>;
      if (tag === 'ol') return <ol key={key} {...props}>{renderedChildren}</ol>;
      if (tag === 'li') return <li key={key} {...props}>{renderedChildren}</li>;
      if (tag === 'table') {
        return (
          <div key={key} className="markdown-table-scroll">
            <table className={className}>{renderedChildren}</table>
          </div>
        );
      }
      if (tag === 'thead') return <thead key={key} {...props}>{renderedChildren}</thead>;
      if (tag === 'tbody') return <tbody key={key} {...props}>{renderedChildren}</tbody>;
      if (tag === 'tr') return <tr key={key} {...props}>{renderedChildren}</tr>;
      if (tag === 'th') return <th key={key} {...props}>{renderedChildren}</th>;
      if (tag === 'td') return <td key={key} {...props}>{renderedChildren}</td>;
      if (tag === 'blockquote') return <blockquote key={key} {...props}>{renderedChildren}</blockquote>;
      if (tag === 'pre') return <pre key={key} {...props}>{renderedChildren}</pre>;
      if (tag === 'code') return <code key={key} {...props}>{renderedChildren}</code>;
      if (tag === 'mark') return <mark key={key} {...props}>{renderedChildren}</mark>;
      if (tag === 'small') return <small key={key} {...props}>{renderedChildren}</small>;
      if (tag === 'sub') return <sub key={key} {...props}>{renderedChildren}</sub>;
      if (tag === 'sup') return <sup key={key} {...props}>{renderedChildren}</sup>;
      if (tag === 'label') return <label key={key} {...props} htmlFor={element.getAttribute('for') || undefined}>{renderedChildren}</label>;
      if (tag === 'span') return <span key={key} {...props}>{renderedChildren}</span>;
      if (tag === 'div') return <div key={key} {...props}>{renderedChildren}</div>;
      if (tag === 'section') return <section key={key} {...props}>{renderedChildren}</section>;
      if (tag === 'article') return <article key={key} {...props}>{renderedChildren}</article>;

      return <span key={key}>{renderedChildren}</span>;
    };

    return Array.from(root?.childNodes || []).map((node, index) => renderNode(node, index));
  }, [enableGfm, html, imageClassName, imageMode, linkMode, linkTextClassName, onPreviewImage, previewImageTitle]);

  return <>{content}</>;
}

export default MarkdownRenderer;
