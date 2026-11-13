import { ExternalLink, Globe2 } from 'lucide-react';
import { truncate } from '../utils.js';

export default function WebSources({ sources = [], query = '' }) {
  if (!sources?.length && !query) return null;
  return (
    <div className="web-sources">
      <p className="web-sources-label">
        <Globe2 size={11} />
        联网检索
        {query ? <span>{truncate(query, 36)}</span> : null}
      </p>
      {!sources?.length ? (
        <p className="web-source-empty">没有获得有效结果，已仅使用本书素材。</p>
      ) : (
        <div className="web-source-list">
          {sources.map((source, index) => {
            let host = '';
            try {
              host = new URL(source.url).hostname.replace(/^www\./, '');
            } catch {
              host = source.url;
            }
            return (
              <a
                key={`${source.url}-${index}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="web-source-card"
              >
                <span className="web-source-index">{index + 1}</span>
                <span className="web-source-main">
                  <strong>{source.title}</strong>
                  <small>{host}</small>
                  <span>{source.snippet}</span>
                </span>
                <ExternalLink size={11} />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
