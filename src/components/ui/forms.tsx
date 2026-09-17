'use client';

/* Design 360 — form controls.

   STYLING ONLY. These are thin wrappers around native elements: every prop
   passes straight through, so validation, submission and state stay exactly
   where they already are. Adopting them changes how a form looks, never how
   it behaves. */

import './ui.css';

function FieldFrame({ label, required, hint, error, htmlFor, children }: {
  label?: string; required?: boolean; hint?: string; error?: string;
  htmlFor?: string; children: React.ReactNode;
}) {
  return (
    <div className="u-field">
      {label && (
        <label className="u-label" htmlFor={htmlFor}>
          {label}{required && <span className="req" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error
        ? <p className="u-err"><span aria-hidden="true">⚠</span>{error}</p>
        : hint ? <p className="u-hint">{hint}</p> : null}
    </div>
  );
}

export function Input({ label, required, hint, error, id, ...rest }: {
  label?: string; required?: boolean; hint?: string; error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldFrame label={label} required={required} hint={hint} error={error} htmlFor={id}>
      <input id={id} className={`u-input${error ? ' is-err' : ''}`}
             aria-invalid={error ? true : undefined} required={required} {...rest} />
    </FieldFrame>
  );
}

export function Textarea({ label, required, hint, error, id, ...rest }: {
  label?: string; required?: boolean; hint?: string; error?: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldFrame label={label} required={required} hint={hint} error={error} htmlFor={id}>
      <textarea id={id} className={`u-textarea${error ? ' is-err' : ''}`}
                aria-invalid={error ? true : undefined} required={required} {...rest} />
    </FieldFrame>
  );
}

export function Select({ label, required, hint, error, id, children, ...rest }: {
  label?: string; required?: boolean; hint?: string; error?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldFrame label={label} required={required} hint={hint} error={error} htmlFor={id}>
      <select id={id} className={`u-select${error ? ' is-err' : ''}`}
              aria-invalid={error ? true : undefined} required={required} {...rest}>
        {children}
      </select>
    </FieldFrame>
  );
}

/** Native date input — same value semantics, new styling. */
export function DateInput(props: Parameters<typeof Input>[0]) {
  return <Input type="date" {...props} />;
}

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
            className={`u-toggle${checked ? ' is-on' : ''}`}
            onClick={() => onChange(!checked)}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit' }}>
      <span className="u-toggle-t" aria-hidden="true" />
      {label && <span className="u-toggle-l">{label}</span>}
    </button>
  );
}
