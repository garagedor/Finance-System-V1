/* Design 360 shared UI layer — barrel.
   Presentation primitives only. Nothing here touches data, permissions or
   business logic; each component is a visual wrapper around content the
   calling screen already owns. */

export { Button, StatusBadge, toneForStatus, EmptyState, Skeleton, SkeletonRows,
         Tabs, Segmented, CommandEntry } from './primitives';
export type { Tone, TabDef } from './primitives';

export { MetricCard, MetricGrid, SummaryStrip, AlertCard, FilterBar, TableShell } from './data';
export type { MetricProps, StripItem, FilterChip } from './data';

export { Section, ActionBar, EntityHeader } from './layout';
export type { EntityMeta, EntityKpi } from './layout';

export { Input, Textarea, Select, DateInput, Toggle } from './forms';
export { Modal, Drawer } from './overlay';
