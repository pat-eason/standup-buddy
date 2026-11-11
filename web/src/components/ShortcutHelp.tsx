import { useEffect, useRef } from 'react';
import { SHORTCUT_GROUPS } from '../shortcuts';
import { Icon } from './Icon';

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="help-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 className="card-title">Keyboard shortcuts</h3>
          <span className="spacer" />
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={17} /></button>
        </div>
        <div className="muted small" style={{ marginBottom: 14 }}>
          Single keys work anywhere except while typing in a field. They avoid browser shortcuts like ⌘N, ⌘T, ⌘S and ⌘J.
        </div>
        <div className="help-grid">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>{g.title}</div>
              <dl>
                {g.items.map((it) => (
                  <div key={it.label + it.keys.join('+')} className="help-row">
                    <dt>{it.label}</dt>
                    <dd>
                      {it.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="plus">+</span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
