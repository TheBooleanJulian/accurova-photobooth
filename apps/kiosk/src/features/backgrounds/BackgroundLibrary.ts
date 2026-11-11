import type { BackgroundConfig, TemplateConfig } from '@accurova/template-engine';

/** The backgrounds a visitor may choose from: enabled only, in display order. */
export function selectableBackgrounds(template: Pick<TemplateConfig, 'backgrounds'>): BackgroundConfig[] {
  return template.backgrounds
    .filter((b) => b.enabled)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
}

/** Resolves a selection, falling back to the first available background if the id is gone. */
export function resolveBackground(
  template: Pick<TemplateConfig, 'backgrounds'>,
  backgroundId: string | null | undefined,
): BackgroundConfig {
  const available = selectableBackgrounds(template);
  const chosen = available.find((b) => b.id === backgroundId) ?? available[0];
  if (!chosen) throw new Error('The template has no enabled background');
  return chosen;
}

/** Backgrounds still using stand-in artwork; shown to administrators before an event. */
export function placeholderBackgrounds(template: Pick<TemplateConfig, 'backgrounds'>): BackgroundConfig[] {
  return selectableBackgrounds(template).filter((b) => b.placeholder);
}
