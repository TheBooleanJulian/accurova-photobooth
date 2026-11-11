import {
  composeFinal,
  outputSize,
  type ComposeResult,
  type Drawable,
  type Size,
  type SubjectBox,
} from '@accurova/image-engine';
import type { BackgroundConfig, TemplateConfig } from '@accurova/template-engine';
import { loadDrawable } from '../frames/adapters/FrameAdapters';
import type { LoadedFrame } from '../frames/FrameEngine';

export interface CompositeRequest {
  template: TemplateConfig;
  background: BackgroundConfig;
  frame: LoadedFrame;
  /** The segmented visitor (RGBA) and the person's bounds within it. */
  foreground: Drawable<CanvasImageSource>;
  subjectBox: SubjectBox;
}

export interface CompositorDeps {
  assetUrl: (relativePath: string) => string;
  loadBackground?: (url: string, size: Size) => Promise<Drawable<CanvasImageSource>>;
  compose?: typeof composeFinal;
}

export function templateOutputSize(template: TemplateConfig): Size {
  return outputSize(template.output.aspectRatio, template.output.longestEdge);
}

/**
 * Produces the finished JPEG from the three layers. All sizes, quality and
 * placement come from the template; nothing here is client-specific.
 */
export async function renderFinalImage(request: CompositeRequest, deps: CompositorDeps): Promise<ComposeResult> {
  const { template, background, frame } = request;
  const output = templateOutputSize(template);
  const loadBackground = deps.loadBackground ?? loadDrawable;
  const image = await loadBackground(deps.assetUrl(background.image), output);
  return (deps.compose ?? composeFinal)(
    {
      output,
      window: frame.window,
      background: image,
      composition: background.composition,
      foreground: request.foreground,
      subjectBox: request.subjectBox,
      frame: frame.image,
      sponsors: frame.sponsors,
      shadowOpacity: template.output.shadowOpacity,
    },
    { jpegQuality: template.output.jpegQuality },
  );
}
