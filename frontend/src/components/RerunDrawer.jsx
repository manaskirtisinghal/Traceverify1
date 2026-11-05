import { useEffect, useRef, useState } from 'react';
import SettingsForm, { paramsValid } from './SettingsForm.jsx';

export default function RerunDrawer({ initial, busy, error, onRerun, onClose }) {
  // The threshold is a fixed system setting, so it is never sent; the backend always applies its own value.
  const [params, setParams] = useState(() => {
    const { threshold: _fixed, ...adjustable } = initial;
    return adjustable;
  });
  const panelRef = useRef(null);

  useEffect(() => {
    panelRef.current?.querySelector('select, input, button')?.focus();
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={() => !busy && onClose()} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="rerun-title" ref={panelRef} data-testid="rerun-drawer">
        <div className="drawer-head">
          <h2 id="rerun-title">Adjust and re-run</h2>
          <button className="btn ghost small" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">
          <SettingsForm params={params} onChange={setParams} idPrefix="rerun" />
        </div>
        <div className="drawer-foot" style={{ flexWrap: 'wrap' }}>
          {error && <div className="notice error" role="alert" style={{ flexBasis: '100%' }}>{error.message}</div>}
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy || !paramsValid(params)} onClick={() => onRerun(params)} data-testid="rerun">
            {busy ? <><span className="spinner" /> Re-running…</> : 'Re-run investigation'}
          </button>
        </div>
      </aside>
    </>
  );
}
