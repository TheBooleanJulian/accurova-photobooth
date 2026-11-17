import type { TemplateConfig } from '@accurova/template-engine';
import type { CSSProperties, ReactNode } from 'react';
import type { StoreApi } from 'zustand';
import type { LoadedFrame } from '../../features/frames';
import type { Translate } from '../../features/i18n/strings';
import type { SessionEvent, SessionState } from '../../features/session/sessionMachine';
import type { SessionStore } from '../../features/session/sessionStore';

/** Everything a visitor screen needs. Screens never reach for globals. */
export interface KioskContext {
  template: TemplateConfig;
  frame: LoadedFrame;
  t: Translate;
  session: SessionState;
  store: StoreApi<SessionStore>;
  send: (event: SessionEvent) => void;
  assetUrl: (relativePath: string) => string;
}

/** Template colours as CSS variables, so screens stay free of client-specific values. */
export function themeStyle(template: TemplateConfig): CSSProperties {
  const c = template.branding.colors;
  return {
    '--k-bg': c.background,
    '--k-surface': c.surface,
    '--k-primary': c.primary,
    '--k-text': c.text,
    background: c.background,
    color: c.text,
  } as CSSProperties;
}

export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`flex h-full w-full flex-col items-center px-[max(2rem,env(safe-area-inset-left))] pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] text-center ${className}`}
    >
      {children}
    </section>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">{children}</h1>;
}

interface ButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
  className?: string;
}

/** Large touch target (at least 72px tall) for use at arm's length. */
export function KioskButton({ children, onClick, disabled, variant = 'primary', className = '' }: ButtonProps) {
  const look = {
    primary: 'bg-[var(--k-primary)] text-[var(--k-surface)] shadow-lg shadow-black/10',
    secondary: 'border-2 border-[var(--k-primary)] text-[var(--k-primary)]',
    quiet: 'text-[var(--k-text)] opacity-70',
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[4.5rem] min-w-56 rounded-full px-10 text-2xl font-semibold tracking-wide transition-transform active:scale-[0.97] disabled:opacity-40 ${look} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Full-body outline with head and foot lines, drawn over the live preview.
 * Purely a guide: it never affects the captured pixels.
 */
export function PositioningGuide() {
  return (
    <svg
      viewBox="0 0 300 400"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <g fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9">
        <g strokeDasharray="7 7">
          <circle cx="150" cy="66" r="26" />
          <path d="M112 104 Q150 92 188 104 L198 214 Q150 226 102 214 Z" />
          <path d="M112 216 L106 358 M146 220 L142 358 M154 220 L158 358 M188 216 L194 358" />
        </g>
        <path d="M70 36 H230" opacity="0.7" />
        <path d="M70 364 H230" opacity="0.7" />
      </g>
    </svg>
  );
}

/** Calm, continuous indicator for the processing screen. */
export function Spinner() {
  return (
    <div
      role="progressbar"
      aria-busy="true"
      className="h-24 w-24 animate-spin rounded-full border-[6px] border-[var(--k-primary)] border-t-transparent [animation-duration:1.4s]"
    />
  );
}
