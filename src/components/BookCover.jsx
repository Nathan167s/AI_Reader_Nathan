import { FORMAT_LABELS, cx, paletteFor } from '../utils.js';

export default function BookCover({ book, size = 'md', className = '', flat = false }) {
  const palette = paletteFor(book);
  const format = FORMAT_LABELS[book?.format] || 'BOOK';
  return (
    <div
      className={cx('book-cover', `cover-${size}`, flat && 'is-flat', className)}
      style={{
        '--cover-bg': palette.bg,
        '--cover-ink': palette.ink,
        '--cover-accent': palette.accent,
        '--cover-glow': palette.glow,
      }}
      title={book?.title}
    >
      <span className="cover-spine" />
      <span className="cover-orbit" />
      <span className="cover-grain" />
      <div className="cover-top">
        <span className="cover-brand">页间 · PAGENEST</span>
        <span className="cover-format">{format}</span>
      </div>
      <div className="cover-title-wrap">
        <h3 className="cover-title">{book?.title || '未命名'}</h3>
        {book?.author ? <p className="cover-author">{book.author}</p> : null}
      </div>
      <div className="cover-foot">
        <span className="cover-rule" />
        <span>{book?.sourceType === 'wechat' ? '来自微信' : '私人藏书'}</span>
      </div>
    </div>
  );
}
