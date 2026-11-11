/**
 * A diagnostics report small enough to travel inside a QR code.
 *
 * A booth tablet is usually signed in to nothing, so results cannot be
 * mailed or pasted anywhere. Instead the tablet shows a QR code whose link
 * carries the report in its #fragment; a phone scans it and opens the report
 * page, which decodes it locally. The fragment is never sent to any server.
 */

export interface CompactStream {
  /** 'user' (front) or 'environment' (rear). */
  facing: string;
  label: string;
  /** Track settings as reported by the browser. */
  track: [number, number];
  /** Frame size as displayed (reflects rotation). */
  frame: [number, number] | null;
  fps: number | null;
  /** Track capability maximum, when exposed. */
  max: [number, number] | null;
}

export interface CompactProbe {
  facing: string;
  requested: [number, number];
  delivered: [number, number];
  fps: number | null;
  error?: string;
}

export interface CompactCapture {
  facing: string;
  method: string;
  size: [number, number];
  bytes: number;
  ms: number;
  mime: string;
  verdict: string;
}

export interface CompactReport {
  v: 1;
  at: string;
  userAgent: string;
  deviceHint: string;
  secure: boolean;
  imageCapture: boolean;
  nativeInput: boolean;
  wakeLock: boolean;
  standalone: boolean;
  permission: string;
  screen: [number, number, number];
  orientation: string;
  encoders: string[];
  cameras: string[];
  /** Capture method the kiosk would use. */
  use: string | null;
  streams: CompactStream[];
  probes: CompactProbe[];
  captures: CompactCapture[];
  events: string[];
}

type Bytes = Uint8Array<ArrayBuffer>;

export interface Codec {
  compress?: (bytes: Bytes) => Promise<Bytes | null>;
  decompress?: (bytes: Bytes) => Promise<Bytes>;
}

async function pipe(bytes: Bytes, transform: GenericTransformStream): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const browserCodec: Required<Codec> = {
  compress: async (bytes) => {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      return await pipe(bytes, new CompressionStream('deflate-raw'));
    } catch {
      return null; // older browsers: fall back to uncompressed
    }
  },
  decompress: (bytes) => pipe(bytes, new DecompressionStream('deflate-raw')),
};

function toBase64Url(bytes: Bytes): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Bytes {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Report -> URL-safe text. Prefix `z` = deflate-compressed JSON, `j` = plain JSON. */
export async function encodeReport(report: CompactReport, codec: Codec = browserCodec): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(report)) as Bytes;
  const compressed = await (codec.compress ?? browserCodec.compress)(json);
  return compressed && compressed.length < json.length ? `z${toBase64Url(compressed)}` : `j${toBase64Url(json)}`;
}

export async function decodeReport(text: string, codec: Codec = browserCodec): Promise<CompactReport> {
  const kind = text[0];
  if (kind !== 'z' && kind !== 'j') throw new Error('This is not a diagnostics report link.');
  let bytes: Bytes;
  try {
    bytes = fromBase64Url(text.slice(1));
    if (kind === 'z') bytes = await (codec.decompress ?? browserCodec.decompress)(bytes);
  } catch {
    throw new Error('The report link is damaged or incomplete. Scan the code again.');
  }
  let report: CompactReport;
  try {
    report = JSON.parse(new TextDecoder().decode(bytes)) as CompactReport;
  } catch {
    throw new Error('The report link is damaged or incomplete. Scan the code again.');
  }
  if (report?.v !== 1) throw new Error('This report was made by a different version of the diagnostics page.');
  return report;
}

/**
 * Longest link that still gives a QR code with modules big enough to scan
 * comfortably off a tablet screen with a phone camera.
 */
export const MAX_QR_LINK_LENGTH = 1000;

/** Keeps only the probe rows where the delivered size changes (per camera), plus errors. */
export function distinctProbes(probes: CompactProbe[]): CompactProbe[] {
  return probes.filter((probe, i) => {
    const previous = probes[i - 1];
    return (
      probe.error !== undefined ||
      !previous ||
      previous.facing !== probe.facing ||
      previous.error !== undefined ||
      previous.delivered.join() !== probe.delivered.join()
    );
  });
}

/**
 * Encodes the report for a QR code. Scannability matters more than detail, so
 * the link always carries a lean form: no event log, no camera list (stream
 * labels already name them) and only the probe rows where the result changes.
 * If that is still too long, the probe is dropped; streams and captures, the
 * numbers that decide the capture strategy, are never dropped.
 */
export async function encodeForQr(report: CompactReport, baseUrl: string, codec?: Codec): Promise<string> {
  const lean: CompactReport = { ...report, events: [], cameras: [], probes: distinctProbes(report.probes) };
  const attempts: CompactReport[] = [lean, { ...lean, probes: [] }];
  let link = '';
  for (const attempt of attempts) {
    link = `${baseUrl}#${await encodeReport(attempt, codec)}`;
    if (link.length <= MAX_QR_LINK_LENGTH) return link;
  }
  return link;
}

const side = (facing: string) => (facing === 'user' ? 'Front' : facing === 'environment' ? 'Rear' : facing);
const dims = (pair: [number, number] | null) => (pair ? `${pair[0]}×${pair[1]}` : 'n/a');

/** Plain-text rendering, written to be pasted into a chat or an issue. */
export function describeReport(report: CompactReport): string {
  const lines = [
    `Camera diagnostics · ${report.at}`,
    `Device: ${report.deviceHint}`,
    `User agent: ${report.userAgent}`,
    `Screen: ${report.screen[0]}×${report.screen[1]} @${report.screen[2]}x · ${report.orientation} · ${report.standalone ? 'installed app' : 'browser tab'}`,
    `ImageCapture: ${report.imageCapture ? 'yes' : 'no'} · native input: ${report.nativeInput ? 'yes' : 'no'} · wake lock: ${report.wakeLock ? 'yes' : 'no'} · secure: ${report.secure ? 'yes' : 'no'} · permission: ${report.permission}`,
    `Canvas encoders: ${report.encoders.join(', ') || 'none'}`,
    `Kiosk would use: ${report.use ?? 'nothing'}`,
    '',
    'Streams:',
    ...(report.streams.length
      ? report.streams.map(
          (s) =>
            `  ${side(s.facing)} (${s.label || 'unlabelled'}): track ${dims(s.track)}, frame ${dims(s.frame)}, ${s.fps ?? '?'} fps, max ${dims(s.max)}`,
        )
      : ['  none']),
    '',
    'Captures:',
    ...(report.captures.length
      ? report.captures.map(
          (c) => `  ${side(c.facing)} ${c.method}: ${dims(c.size)}, ${Math.round(c.bytes / 1024)} KB, ${c.ms} ms, ${c.mime}, ${c.verdict}`,
        )
      : ['  none']),
    '',
    'Resolution probe (requested → delivered):',
    ...(report.probes.length
      ? report.probes.map(
          (p) => `  ${side(p.facing)} ${dims(p.requested)} → ${p.error ?? `${dims(p.delivered)}${p.fps ? ` @${p.fps}fps` : ''}`}`,
        )
      : ['  not run']),
  ];
  if (report.cameras.length) lines.push('', 'Cameras:', ...report.cameras.map((c) => `  ${c}`));
  if (report.events.length) lines.push('', 'Events:', ...report.events.map((e) => `  ${e}`));
  return lines.join('\n');
}
