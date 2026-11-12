import QRCode from 'qrcode';
import { downloadPageUrl } from '../../services/api';

/**
 * The link a visitor scans to collect their photograph. It contains only the
 * random download token: no storage path, no session id.
 */
export function deliveryLink(token: string, origin?: string): string {
  return downloadPageUrl(token, origin);
}

/** A QR code for the delivery link, as an SVG string that stays sharp at any size. */
export function deliveryQrSvg(link: string, options: { dark?: string; light?: string } = {}): Promise<string> {
  return QRCode.toString(link, {
    type: 'svg',
    // Delivery links are short, so a robust error-correction level costs little.
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: options.dark ?? '#000000', light: options.light ?? '#ffffff' },
  });
}
