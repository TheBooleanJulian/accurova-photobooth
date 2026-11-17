import type { LocaleStrings } from '@accurova/template-engine';

/**
 * Built-in English copy. A template's locale file overrides these key by key;
 * anything a template leaves out falls back here instead of showing a blank.
 * Generic wording only: nothing client-specific belongs in this file.
 */
export const DEFAULT_STRINGS: LocaleStrings = {
  "welcome.title": "Photo Booth",
  "welcome.tagline": "",
  "welcome.start": "Start",
  "welcome.language": "Language",
  "welcome.privacy": "We take one photo to make your souvenir. It is deleted automatically after 24 hours. No account or personal details needed.",
  "instructions.title": "Get ready",
  "instructions.stand": "Stand on the marker, about 3 metres from the screen.",
  "instructions.fullBody": "Make sure we can see you from head to toe.",
  "instructions.continue": "I'm ready",
  "camera.countdown": "Smile!",
  "review.title": "Happy with this photo?",
  "review.retake": "Retake",
  "review.confirm": "Use this photo",
  "background.title": "Choose your backdrop",
  "background.confirm": "Continue",
  "processing.title": "Creating your photo",
  "result.title": "Scan to download",
  "result.expiry": "Your link works for 24 hours.",
  "complete.title": "Thank you!",
  "error.generic": "Something went wrong. Please start again.",
  "error.camera": "We can't reach the camera. Please ask a member of staff.",
  "download.title": "Your photo is ready",
  "download.save": "Save photo",
  "download.share": "Share",
  "download.hint": "You can also press and hold the photo to save it.",
  "download.expires": "Available until {time}",
  "download.invalid": "This link is invalid or has expired.",
  "instructions.back": "Back",
  "camera.guide": "Stand inside the outline",
  "camera.take": "Take photo",
  "camera.starting": "Starting the camera…",
  "camera.retry": "Try again",
  "background.back": "Back",
  "processing.session": "Getting ready…",
  "processing.upload": "Sending your photo…",
  "processing.segment": "Finding you in the picture…",
  "processing.compose": "Adding your backdrop…",
  "processing.deliver": "Finishing up…",
  "error.network": "We lost the connection. Please try again.",
  "error.timeout": "That took too long. Please try again.",
  "error.no-subject": "We couldn't see you in the photo. Let's take it again.",
  "error.processing": "We couldn't make your photo. Please try again.",
  "error.delivery": "Your photo is ready but we couldn't save it. Please try again.",
  "error.not-configured": "This booth isn't ready yet. Please ask a member of staff.",
  "action.retry": "Try again",
  "action.retake": "Retake photo",
  "action.startOver": "Start over",
  "result.done": "Done",
  "complete.note": "Enjoy your photo. This screen will reset in a moment."
};

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export function createTranslate(strings: LocaleStrings): Translate {
  return (key, values) => {
    const text = strings[key] ?? DEFAULT_STRINGS[key] ?? '';
    return values ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match)) : text;
  };
}

export const LOCALE_NAMES: Record<string, string> = { en: 'English', 'zh-CN': '中文', ms: 'Melayu', ta: 'தமிழ்' };
