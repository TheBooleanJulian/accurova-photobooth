import { TemplateRegistry } from '@accurova/template-engine';

/** One registry per page load. Templates are fetched at runtime, never bundled. */
export const templateRegistry = new TemplateRegistry({
  baseUrl: import.meta.env.VITE_TEMPLATES_BASE_URL || '/templates',
});
