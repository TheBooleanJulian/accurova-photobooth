import type { ZodType } from 'zod';
import {
  localeSchema,
  registryIndexSchema,
  templateSchema,
  type LocaleStrings,
  type RegistryIndex,
  type TemplateConfig,
} from './schema';

export type TemplateErrorCode = 'not-found' | 'disabled' | 'invalid' | 'network';

export class TemplateLoadError extends Error {
  constructor(
    readonly code: TemplateErrorCode,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'TemplateLoadError';
  }
}

/** Fetches and parses JSON. Must throw `TemplateLoadError('not-found')` for a 404. */
export type JsonFetcher = (url: string) => Promise<unknown>;

export const defaultJsonFetcher: JsonFetcher = async (url) => {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new TemplateLoadError('network', `Could not reach ${url}: ${(e as Error).message}`);
  }
  if (res.status === 404) throw new TemplateLoadError('not-found', `${url} was not found`);
  if (!res.ok) throw new TemplateLoadError('network', `${url} responded ${res.status}`);
  try {
    return await res.json();
  } catch {
    // Static hosts with an SPA fallback answer unknown paths with index.html.
    throw new TemplateLoadError('not-found', `${url} did not return JSON`);
  }
};

function parse<T>(schema: ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new TemplateLoadError('invalid', `${what} is invalid`, issues);
}

export interface TemplateRegistryOptions {
  /** Folder containing `index.json` and one folder per template, e.g. `/templates`. */
  baseUrl: string;
  fetchJson?: JsonFetcher;
}

/**
 * Loads templates at runtime from static JSON, so adding a client means adding
 * a folder and an index entry, never rebuilding the application.
 */
export class TemplateRegistry {
  private readonly baseUrl: string;
  private readonly fetchJson: JsonFetcher;
  private index: Promise<RegistryIndex> | null = null;
  private readonly templates = new Map<string, Promise<TemplateConfig>>();

  constructor(options: TemplateRegistryOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchJson = options.fetchJson ?? defaultJsonFetcher;
  }

  list(): Promise<RegistryIndex> {
    this.index ??= this.fetchJson(`${this.baseUrl}/index.json`)
      .then((data) => parse(registryIndexSchema, data, 'Template index'))
      .catch((e) => {
        this.index = null;
        throw e;
      });
    return this.index;
  }

  async load(templateId: string): Promise<TemplateConfig> {
    const index = await this.list();
    const entry = index.templates.find((t) => t.id === templateId);
    if (!entry) throw new TemplateLoadError('not-found', `No template "${templateId}" is registered`);
    if (!entry.enabled) throw new TemplateLoadError('disabled', `Template "${templateId}" is disabled`);

    let pending = this.templates.get(templateId);
    if (!pending) {
      pending = this.fetchJson(`${this.baseUrl}/${templateId}/template.json`)
        .then((data) => {
          const template = parse(templateSchema, data, `Template "${templateId}"`);
          if (template.id !== templateId) {
            throw new TemplateLoadError('invalid', `Template folder "${templateId}" declares id "${template.id}"`);
          }
          return template;
        })
        .catch((e) => {
          this.templates.delete(templateId);
          throw e;
        });
      this.templates.set(templateId, pending);
    }
    return pending;
  }

  async loadLocale(templateId: string, locale: string): Promise<LocaleStrings> {
    const template = await this.load(templateId);
    if (!template.locales.includes(locale)) {
      throw new TemplateLoadError('not-found', `Template "${templateId}" has no locale "${locale}"`);
    }
    const data = await this.fetchJson(`${this.baseUrl}/${templateId}/locales/${locale}.json`);
    return parse(localeSchema, data, `Locale "${locale}" of "${templateId}"`);
  }

  /** Resolves a template-relative asset path to a URL. */
  assetUrl(templateId: string, relativePath: string): string {
    return `${this.baseUrl}/${templateId}/${relativePath}`;
  }

  /** Drops cached data so the next call refetches (used after admin changes). */
  invalidate(): void {
    this.index = null;
    this.templates.clear();
  }
}
