import { useState } from 'react';
import { SOURCE_META, normalizeWeights, weightsSum } from '../utils/format.js';
import { Chevron } from './common.jsx';

// The correlation threshold is not here: it is a fixed, validated system setting applied by the backend.
export const DEFAULT_PARAMS = {
  window_before: 300,
  window_after: 1800,
  weights: { entity: 0.4, temporal: 0.3, rule: 0.3 },
  temporal_decay: 300,
  max_hops: 3,
  max_nodes: 60,
  source_types: ['auth', 'proc', 'dns', 'flow'],
};

const WINDOWS = [
  { id: 'w1', label: '1 min before · 5 min after', before: 60, after: 300 },
  { id: 'w2', label: '5 min before · 30 min after', before: 300, after: 1800 },
  { id: 'w3', label: '15 min before · 1 hour after', before: 900, after: 3600 },
  { id: 'w4', label: '3 hours either side', before: 10800, after: 10800 },
];

const inRange = (v, min, max) => v !== '' && Number.isFinite(Number(v)) && v >= min && v <= max;

export function paramsValid(p) {
  return (
    Math.abs(weightsSum(p.weights) - 1) < 1e-6 &&
    p.source_types.length > 0 &&
    inRange(p.window_before, 0, 86400) &&
    inRange(p.window_after, 0, 86400) &&
    inRange(p.temporal_decay, 1, 86400) &&
    inRange(p.max_hops, 1, 6) &&
    inRange(p.max_nodes, 1, 500)
  );
}

function NumberInput({ label, hint, value, onChange, min, max, testId }) {
  return (
    <label className="small-label" title={hint}>
      {label}
      <input
        className={`input mono ${inRange(value, min, max) ? '' : 'invalid'}`}
        type="number"
        min={min}
        max={max}
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </label>
  );
}

export default function SettingsForm({ params, onChange, idPrefix = 'settings' }) {
  const set = (patch) => onChange({ ...params, ...patch });
  const preset = WINDOWS.find((w) => w.before === params.window_before && w.after === params.window_after);
  const [customMode, setCustomMode] = useState(!preset);
  const custom = customMode || !preset;
  const sum = weightsSum(params.weights);
  const sumOk = Math.abs(sum - 1) < 1e-6;
  const toggleSource = (s) =>
    set({
      source_types: params.source_types.includes(s)
        ? params.source_types.filter((x) => x !== s)
        : [...params.source_types, s],
    });

  return (
    <div className="form">
      <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-window`}>How far to search around the event</label>
        <select
          id={`${idPrefix}-window`}
          className="select"
          data-testid="window-preset"
          value={custom ? 'custom' : preset.id}
          onChange={(e) => {
            const w = WINDOWS.find((x) => x.id === e.target.value);
            setCustomMode(!w);
            if (w) set({ window_before: w.before, window_after: w.after });
          }}
        >
          {WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        <p className="hint">Activity outside this time range is ignored.</p>
        {custom && (
          <div className="two">
            <NumberInput label="Seconds before" value={params.window_before} min={0} max={86400}
              testId="window-before" onChange={(v) => set({ window_before: v })} />
            <NumberInput label="Seconds after" value={params.window_after} min={0} max={86400}
              testId="window-after" onChange={(v) => set({ window_after: v })} />
          </div>
        )}
      </div>

      <details className="advanced" data-testid="advanced">
        <summary><Chevron />Advanced settings <span className="subtle">(optional, defaults work well)</span></summary>
        <div className="advanced-body">
          <div className="field">
            <div className="field-label">
              What matters most when scoring <span className={`weights-sum ${sumOk ? 'subtle' : 'bad'}`}>total {sum.toFixed(2)}</span>
            </div>
            <p className="hint">The score mixes three clues. These sliders set how much each clue counts and must add up to 1.</p>
            {[
              ['entity', 'Same user or computer'],
              ['temporal', 'Close in time'],
              ['rule', 'Fits a known attack pattern'],
            ].map(([k, label]) => (
              <label className="small-label" key={k}>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  {label} <span className="mono">{Number(params.weights[k]).toFixed(2)}</span>
                </span>
                <input type="range" min="0" max="1" step="0.05" value={params.weights[k]} data-testid={`weight-${k}`}
                  onChange={(e) => set({ weights: { ...params.weights, [k]: Number(e.target.value) } })} />
              </label>
            ))}
            {!sumOk && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="error-text">Weights must add up to 1.</span>
                <button type="button" className="btn small" onClick={() => set({ weights: normalizeWeights(params.weights) })}>
                  Fix automatically
                </button>
              </div>
            )}
          </div>

          <div className="field">
            <div className="field-label">Which kinds of activity to look at</div>
            <div className="chips">
              {['auth', 'proc', 'dns', 'flow'].map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={params.source_types.includes(s)}
                  onClick={() => toggleSource(s)} data-testid={`source-${s}`}>
                  <span className="dot" style={{ background: SOURCE_META[s].color }} />
                  {SOURCE_META[s].name}
                </button>
              ))}
            </div>
            {params.source_types.length === 0 && <span className="error-text">Select at least one source.</span>}
          </div>

          <div className="three">
            <NumberInput label="Time fade (s)" hint="How quickly 'close in time' drops off. Smaller means only very close events score well." value={params.temporal_decay} min={1} max={86400}
              onChange={(v) => set({ temporal_decay: v })} />
            <NumberInput label="Max chain length" hint="How many steps away from the starting event to keep following links." value={params.max_hops} min={1} max={6}
              onChange={(v) => set({ max_hops: v })} />
            <NumberInput label="Max activities" hint="Stop after this many connected activities." value={params.max_nodes} min={1} max={500}
              onChange={(v) => set({ max_nodes: v })} />
          </div>
        </div>
      </details>
    </div>
  );
}
