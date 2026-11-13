import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export default function Markdown({ content, className = '' }) {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(content || '');
      return DOMPurify.sanitize(raw, { FORBID_ATTR: ['target'] });
    } catch {
      return DOMPurify.sanitize(String(content || ''));
    }
  }, [content]);
  return (
    <div
      className={`markdown ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
