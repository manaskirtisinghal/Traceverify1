import { useEffect, useRef, useState } from 'react';
import Glossary from './Glossary.jsx';

export default function Header({ view, resultsHref, apiStatus, dataset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const synthetic = dataset?.some((d) => d.dataset_label.startsWith('SYNTHETIC'));

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="8" cy="16" r="3.2" fill="#d08474" />
          <circle cx="23" cy="8" r="2.8" fill="#5fb4c4" />
          <circle cx="24" cy="24" r="2.8" fill="#a198cc" />
          <path d="M10.8 14.6 L20.4 9.4 M10.8 17.4 L21.4 22.6" stroke="#808a9b" strokeWidth="1.6" />
        </svg>
        <span className="brand-name">TRACE<span>VERIFY</span></span>
      </a>
      <nav className="nav" aria-label="Main">
        <a href="#/" className={view === 'setup' ? 'active' : ''}>New investigation</a>
        {resultsHref ? (
          <a href={resultsHref} className={view === 'results' ? 'active' : ''} data-testid="nav-results">Results</a>
        ) : (
          <span className="nav-disabled" aria-disabled="true" title="Run an investigation to see results" data-testid="nav-results">
            Results
          </span>
        )}
      </nav>
      <div className="topbar-right" ref={ref}>
        <Glossary />
        {synthetic && (
          <>
            <button className="data-pill" aria-expanded={open} aria-controls="data-note" onClick={() => setOpen((o) => !o)}>
              Synthetic evidence data
            </button>
            {open && (
              <div className="data-popover" id="data-note" role="dialog" aria-label="About the data">
                <p>
                  <strong>SYNTHETIC / LANL-FORMAT-COMPATIBLE DATA.</strong> The authentication, process, DNS and
                  network-flow events were generated for this project in the LANL dataset format. They are not real
                  LANL observations.
                </p>
                <p>The investigation starting events are real LANL red-team records.</p>
              </div>
            )}
          </>
        )}
        <span className={`api-status ${apiStatus}`}>
          {apiStatus === 'ok' ? 'Connected' : apiStatus === 'down' ? 'Backend offline' : 'Connecting…'}
        </span>
      </div>
    </header>
  );
}
