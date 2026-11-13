import type { Urgency } from '../types';

export const URGENCY_LEVELS: readonly Urgency[] = [1, 2, 3, 4, 5];

export const URGENCY_LABEL: Record<Urgency, string> = {
  1: 'Not urgent',
  2: 'Low',
  3: 'Medium',
  4: 'High',
  5: 'Incredibly urgent',
};

const FLAME_OUTER =
  'M12 2.4c.7 3.3 3.2 5 4.8 7.5 1.2 1.9 1.9 3.7 1.9 5.6a6.7 6.7 0 0 1-13.4 0c0-2.1.8-3.8 2.1-5.2.3 1.5 1 2.4 2.1 2.8C9.2 9.4 10.1 5.6 12 2.4z';
const FLAME_CORE =
  'M12 12.2c.4 1.4 1.8 2.3 2.4 3.6.7 1.6-.2 3.7-2.4 3.7s-3.1-2-2.4-3.6c.5-1.2 1.9-2.1 2.4-3.7z';

interface UrgencyFlameProps {
  level: Urgency;
  /** Show the level as text for assistive tech; decorative flames hide from it. */
  label?: boolean;
  className?: string;
}

/**
 * A flame that grows, heats up from yellow through orange to red, and flickers faster as
 * urgency rises. All of that is CSS keyed off `data-level`.
 */
export function UrgencyFlame({ level, label = true, className = '' }: UrgencyFlameProps) {
  const text = `Urgency ${level} of 5: ${URGENCY_LABEL[level]}`;
  return (
    <span
      className={`flame ${className}`}
      data-level={level}
      {...(label ? { role: 'img', 'aria-label': text, title: text } : { 'aria-hidden': true })}
    >
      <svg viewBox="0 0 24 24" focusable="false">
        <path className="flame-outer" d={FLAME_OUTER} />
        <path className="flame-core" d={FLAME_CORE} />
      </svg>
    </span>
  );
}

interface UrgencyPickerProps {
  value: Urgency;
  onChange: (value: Urgency) => void;
}

/** Five flames to choose from, doubling as a legend for the scale. */
export function UrgencyPicker({ value, onChange }: UrgencyPickerProps) {
  return (
    <div className="urgency-picker" role="radiogroup" aria-label="Urgency">
      {URGENCY_LEVELS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n}: ${URGENCY_LABEL[n]}`}
          title={`${n}: ${URGENCY_LABEL[n]}`}
          className={`urgency-opt ${value === n ? 'on' : ''}`}
          onClick={() => onChange(n)}
        >
          <UrgencyFlame level={n} label={false} />
        </button>
      ))}
      <span className="urgency-name small muted">{URGENCY_LABEL[value]}</span>
    </div>
  );
}
