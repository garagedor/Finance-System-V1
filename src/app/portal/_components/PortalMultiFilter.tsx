'use client';

import { useState } from 'react';
import MultiSelect from '@/components/MultiSelect';

export type FilterOption = { value: string; label: string };

/**
 * Form-friendly checkbox multi-select for the portal filter bar.
 *
 * Wraps the shared MultiSelect component, owns local state for the picked
 * values, and emits a `<input type="hidden" name={...} value={...}>` for
 * each selection so the surrounding native `<form>` submits the right
 * multi-value query (`?name=a&name=b`).
 *
 * Server pages read these with `URLSearchParams.getAll(name)`.
 */
export function PortalMultiFilter({
  name,
  options,
  defaultSelected,
  placeholder = 'All',
  allLabel = 'All',
}: {
  name: string;
  options: FilterOption[];
  defaultSelected?: string[];
  placeholder?: string;
  allLabel?: string;
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected ?? []);

  // The MultiSelect's option strings are the *labels* shown in the dropdown,
  // so we need to map back to values on change and convert the selected
  // values to labels for display.
  const labelByValue = new Map(options.map((o) => [o.value, o.label]));
  const valueByLabel = new Map(options.map((o) => [o.label, o.value]));
  const allLabels = options.map((o) => o.label);
  const selectedLabels = selected
    .map((v) => labelByValue.get(v))
    .filter((l): l is string => Boolean(l));

  const handleChange = (labels: string[]) => {
    setSelected(labels.map((l) => valueByLabel.get(l) ?? l));
  };

  return (
    <div style={{ minWidth: 180 }}>
      <MultiSelect
        options={allLabels}
        selected={selectedLabels}
        onChange={handleChange}
        placeholder={placeholder}
        allLabel={allLabel}
      />
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
    </div>
  );
}
