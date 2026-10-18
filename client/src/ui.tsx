import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Island, Skill, Technician, User } from './types';

// ---- app-wide reference data ------------------------------------------------

export interface AppData {
  user: User;
  islands: Island[];
  skills: Skill[];
  techs: Technician[];
  canWrite: boolean;
  reloadRefs: () => Promise<void>;
  islandById: (id: number | null | undefined) => Island | undefined;
  skillById: (id: number) => Skill | undefined;
}

export const DataContext = createContext<AppData | null>(null);
export function useData(): AppData {
  const v = useContext(DataContext);
  if (!v) throw new Error('DataContext missing');
  return v;
}

// ---- toasts -----------------------------------------------------------------

type ToastKind = 'ok' | 'warn' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  detail?: string[];
}

const ToastContext = createContext<(kind: ToastKind, text: string, detail?: string[]) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((kind: ToastKind, text: string, detail?: string[]) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text, detail }]);
    setTimeout(() => dismiss(id), kind === 'ok' ? 2500 : 7000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            <strong>{t.text}</strong>
            {t.detail?.length ? (
              <ul>
                {t.detail.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---- modal ------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 560,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function IslandDot({ island }: { island?: Island }) {
  return <span className="dot" style={{ background: island?.color ?? '#94a3b8' }} />;
}

export function SkillPicker({
  skills,
  selected,
  onToggle,
  levels,
  onLevel,
}: {
  skills: Skill[];
  selected: number[];
  onToggle: (id: number) => void;
  levels?: Record<number, number>;
  onLevel?: (id: number, level: number) => void;
}) {
  const groups = new Map<string, Skill[]>();
  for (const s of skills) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category)!.push(s);
  }
  return (
    <div className="skill-picker">
      {[...groups].map(([cat, list]) => (
        <div key={cat} className="skill-group">
          <div className="skill-group-name">{cat}</div>
          <div className="chips">
            {list.map((s) => {
              const on = selected.includes(s.id);
              return (
                <span key={s.id} className={`chip chip-toggle${on ? ' on' : ''}`}>
                  <button type="button" onClick={() => onToggle(s.id)}>
                    {on ? '✓ ' : ''}
                    {s.name}
                  </button>
                  {on && levels && onLevel && (
                    <select
                      value={levels[s.id] ?? 2}
                      onChange={(e) => onLevel(s.id, Number(e.target.value))}
                      title="Skill level"
                    >
                      <option value={1}>Trainee</option>
                      <option value={2}>Qualified</option>
                      <option value={3}>Expert</option>
                    </select>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {!skills.length && <p className="muted">No skills defined yet. Admins can add them under Settings.</p>}
    </div>
  );
}
