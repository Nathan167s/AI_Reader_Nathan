import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Eye, EyeOff, RotateCcw, Type, X } from 'lucide-react';

const STORAGE_KEY = 'pagenest.display.v1';
const SCALES = [90, 100, 110, 120];
const DEFAULT_SETTINGS = { scale: 100, eye: false };

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const parsedScale = Number(source.scale);
  return {
    scale: SCALES.includes(parsedScale) ? parsedScale : DEFAULT_SETTINGS.scale,
    eye: source.eye === true,
  };
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(window.localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export default function DisplayControls() {
  const [settings, setSettings] = useState(readSettings);
  const [open, setOpen] = useState(false);
  const dockRef = useRef(null);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const { scale, eye } = settings;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(scale / 100));
    root.dataset.uiScale = String(scale);
    if (eye) root.dataset.eye = 'on';
    else root.removeAttribute('data-eye');
  }, [scale, eye]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // localStorage may be unavailable in private or restricted contexts.
    }
  }, [settings]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      const target = event.target;
      if (dockRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector('[data-scale-active="true"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const chooseScale = (next) => {
    setSettings((current) => ({ ...current, scale: next }));
  };

  const toggleEye = () => {
    setSettings((current) => ({ ...current, eye: !current.eye }));
  };

  const reset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
  };

  const closePanel = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return createPortal(
    <div className="display-root">
      <div className="display-dock" ref={dockRef}>
        <button
          type="button"
          className="display-eye"
          onClick={toggleEye}
          aria-pressed={eye}
          aria-label={eye ? '护眼模式已开启，点击关闭' : '护眼模式已关闭，点击开启'}
          title={eye ? '护眼模式：开' : '护眼模式：关'}
        >
          {eye ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
          <span className="display-eye-label">护眼</span>
          <span className="display-switch" data-on={eye ? 'true' : 'false'} aria-hidden="true">
            <span className="display-switch-knob" />
          </span>
          <span className="display-eye-state" aria-hidden="true">{eye ? '开' : '关'}</span>
        </button>

        <span className="display-dock-divider" aria-hidden="true" />

        <button
          type="button"
          className={`display-aa ${open ? 'is-open' : ''}`}
          ref={triggerRef}
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-haspopup="dialog"
          aria-label="打开显示控制面板"
          title="显示控制"
        >
          <Type size={15} aria-hidden="true" />
          <span className="display-aa-text" aria-hidden="true">Aa</span>
        </button>
      </div>

      {open ? (
        <section
          className="display-panel"
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label="显示控制"
        >
          <header className="display-panel-head">
            <div>
              <p className="display-kicker">READING DISPLAY</p>
              <h2>显示控制</h2>
            </div>
            <div className="display-head-actions">
              <span className="display-current" aria-live="polite">{scale}%</span>
              <button type="button" className="display-close" onClick={closePanel} aria-label="关闭显示控制">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="display-section">
            <div className="display-section-head">
              <span>全局字号</span>
              <span className="display-section-note">当前 {scale}%</span>
            </div>
            <div className="display-scale-grid" role="group" aria-label="全局字号">
              {SCALES.map((option) => {
                const active = option === scale;
                return (
                  <button
                    key={option}
                    type="button"
                    className={`display-scale ${active ? 'is-active' : ''}`}
                    data-scale-active={active ? 'true' : 'false'}
                    onClick={() => chooseScale(option)}
                    aria-pressed={active}
                    aria-label={`全局字号 ${option}%`}
                  >
                    <span>{option}%</span>
                    {active ? <Check size={12} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className={`display-eye-row ${eye ? 'is-on' : ''}`}
            onClick={toggleEye}
            aria-pressed={eye}
          >
            <span className="display-eye-row-icon" aria-hidden="true">
              {eye ? <Eye size={16} /> : <EyeOff size={16} />}
            </span>
            <span className="display-eye-row-copy">
              <strong>护眼模式</strong>
              <small>柔化整体色调，降低阅读刺激</small>
            </span>
            <span className={`display-state ${eye ? 'is-on' : ''}`}>
              {eye ? '已开启' : '已关闭'}
            </span>
          </button>

          <div className="display-panel-foot">
            <button type="button" className="display-reset" onClick={reset}>
              <RotateCcw size={14} aria-hidden="true" />
              恢复默认
            </button>
            <span className="display-hint">Esc 关闭</span>
          </div>
        </section>
      ) : null}
    </div>,
    document.body,
  );
}
