import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  /** Mirror the picture for a selfie-style preview. Never affects captured pixels. */
  mirrored?: boolean;
  className?: string;
}

/**
 * Live preview only. Capturing is the providers' job; this component just
 * shows the stream and exposes the <video> so the stream provider can read a frame.
 */
export const CameraPreview = forwardRef<HTMLVideoElement | null, Props>(function CameraPreview(
  { stream, mirrored = false, className },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle<HTMLVideoElement | null, HTMLVideoElement | null>(ref, () => videoRef.current);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) {
      // Safari needs an explicit play() even with autoplay + muted + playsinline.
      video.play().catch(() => undefined);
    }
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className={className}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
});
