import { z } from 'zod';

/** Normalised 0..1 coordinate or fraction. */
const unit = z.number().min(0).max(1);

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a lowercase kebab-case id');

/** Asset paths are always relative to the template folder; no absolute paths, URLs or traversal. */
const assetPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.includes('\\') && !/^[a-z][a-z0-9+.-]*:/i.test(p), {
    message: 'must be a path relative to the template folder',
  })
  .refine((p) => !p.split('/').includes('..'), { message: 'must not contain ".."' });

const aspectRatio = z.string().regex(/^[1-9]\d*:[1-9]\d*$/, 'must look like "9:16"');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');

export const compositionSchema = z.object({
  /** Where the subject's feet centre sits on the background, normalised. */
  subjectAnchorX: unit,
  subjectAnchorY: unit,
  /** Subject height as a fraction of the background height. */
  subjectScale: z.number().gt(0).max(1.5),
  horizonY: unit.optional(),
});

export const backgroundSchema = z.object({
  id: slug,
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  image: assetPath,
  thumbnail: assetPath,
  aspectRatio,
  composition: compositionSchema,
  displayOrder: z.number().int().nonnegative(),
  enabled: z.boolean(),
  /** True while the asset is a stand-in awaiting a licensed photograph. */
  placeholder: z.boolean().default(false),
  licence: z.string().optional(),
});

export const sponsorSlotSchema = z.object({
  id: slug,
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']),
  asset: assetPath,
  enabled: z.boolean().default(true),
  /** Box the logo is fitted into (aspect ratio preserved), normalised to the frame. */
  box: z.object({ x: unit, y: unit, width: unit, height: unit }),
});

export const frameSchema = z.object({
  id: slug,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be semver'),
  asset: assetPath,
  format: z.enum(['svg', 'png']),
  targetAspectRatio: aspectRatio,
  /** Transparent area of the frame the composite shows through, normalised to the frame. */
  photoWindow: z.object({ x: unit, y: unit, width: unit, height: unit }),
  branding: z.object({
    brandName: z.string().min(1),
    showBrandLogo: z.boolean(),
    showSponsors: z.boolean(),
  }),
  sponsorSlots: z.array(sponsorSlotSchema).default([]),
  placeholder: z.boolean().default(false),
});

export const captureConfigSchema = z.object({
  facingMode: z.enum(['user', 'environment']).default('user'),
  /** Admin override of the automatically selected capture provider. */
  providerOverride: z.enum(['auto', 'imagecapture', 'stream', 'native']).default('auto'),
  countdownSeconds: z.number().int().min(0).max(15).default(5),
  quality: z.object({
    preferredLongestEdge: z.number().int().positive().default(3000),
    minimumLongestEdge: z.number().int().positive().default(2000),
    /** What the kiosk does when the device cannot reach the minimum. */
    belowMinimumPolicy: z.enum(['block', 'warn']).default('warn'),
  }),
  /** Physical booth guidance shown to staff; informational, never enforced in code. */
  setup: z.object({
    cameraHeightCm: z.tuple([z.number().positive(), z.number().positive()]),
    subjectDistanceM: z.tuple([z.number().positive(), z.number().positive()]),
  }),
});

export const templateSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: slug,
    name: z.string().min(1),
    defaultLocale: z.string().min(2),
    locales: z.array(z.string().min(2)).min(1),
    branding: z.object({
      logo: assetPath,
      tagline: z.string().optional(),
      photographyCredit: z.string().optional(),
      colors: z.object({
        background: hexColor,
        surface: hexColor,
        primary: hexColor,
        text: hexColor,
      }),
    }),
    capture: captureConfigSchema,
    backgrounds: z.array(backgroundSchema).min(1),
    frames: z.array(frameSchema).min(1),
    defaultFrameId: slug,
    output: z.object({
      aspectRatio,
      /** Longest edge of the final JPEG in pixels. 1920 gives 1080×1920 at 9:16. */
      longestEdge: z.number().int().min(640).max(8000).default(1920),
      jpegQuality: z.number().min(0.5).max(1).default(0.93),
      /** Soft contact shadow under the visitor's feet. 0 disables it. */
      shadowOpacity: z.number().min(0).max(1).default(0.28),
    }),
    delivery: z.object({
      linkExpiryHours: z.number().positive().default(24),
    }),
    session: z.object({
      idleResetSeconds: z.number().int().positive().default(60),
    }),
  })
  .superRefine((t, ctx) => {
    const dup = (ids: string[]) => ids.find((id, i) => ids.indexOf(id) !== i);
    const dupBg = dup(t.backgrounds.map((b) => b.id));
    if (dupBg) ctx.addIssue({ code: 'custom', path: ['backgrounds'], message: `duplicate background id "${dupBg}"` });
    const dupFrame = dup(t.frames.map((f) => f.id));
    if (dupFrame) ctx.addIssue({ code: 'custom', path: ['frames'], message: `duplicate frame id "${dupFrame}"` });
    if (!t.frames.some((f) => f.id === t.defaultFrameId)) {
      ctx.addIssue({ code: 'custom', path: ['defaultFrameId'], message: `no frame with id "${t.defaultFrameId}"` });
    }
    if (!t.locales.includes(t.defaultLocale)) {
      ctx.addIssue({ code: 'custom', path: ['defaultLocale'], message: 'defaultLocale must be listed in locales' });
    }
    if (!t.backgrounds.some((b) => b.enabled)) {
      ctx.addIssue({ code: 'custom', path: ['backgrounds'], message: 'at least one background must be enabled' });
    }
    if (t.capture.quality.minimumLongestEdge > t.capture.quality.preferredLongestEdge) {
      ctx.addIssue({ code: 'custom', path: ['capture', 'quality'], message: 'minimumLongestEdge exceeds preferredLongestEdge' });
    }
  });

export const registryIndexSchema = z.object({
  schemaVersion: z.literal(1),
  templates: z.array(
    z.object({
      id: slug,
      name: z.string().min(1),
      enabled: z.boolean(),
    }),
  ),
});

export const localeSchema = z.record(z.string(), z.string());

export type Composition = z.infer<typeof compositionSchema>;
export type BackgroundConfig = z.infer<typeof backgroundSchema>;
export type SponsorSlot = z.infer<typeof sponsorSlotSchema>;
export type FrameConfig = z.infer<typeof frameSchema>;
export type CaptureConfig = z.infer<typeof captureConfigSchema>;
export type TemplateConfig = z.infer<typeof templateSchema>;
export type RegistryIndex = z.infer<typeof registryIndexSchema>;
export type LocaleStrings = z.infer<typeof localeSchema>;
