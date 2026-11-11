# Camera compatibility log

Only measured results go in the tables below. Expectations are marked as such.

## What is known before testing

- Safari added the ImageCapture API in **18.4** (per caniuse / MDN data, checked 2026-11-11).
- The iPad Pro 10.5" (2017) cannot be updated past **iPadOS 17**, so on the
  reference device ImageCapture is expected to be **absent** and the kiosk is
  expected to use stream frames. Newer iPads on 18.4+ should get real stills.
- The front camera on that iPad is a 7 MP sensor, but browsers usually expose
  far less than sensor resolution through a video stream. The actual ceiling
  is unknown until measured.

## Test protocol (about 10 minutes)

On the tablet, open `/admin/diagnostics` over HTTPS in Safari, in the
orientation the booth will use (portrait).

1. Tap **Start camera** with Facing = Front and the largest size. Allow the camera.
2. Note "Track settings" and "Frame as displayed".
3. Tap **Probe all sizes** and wait for the table.
4. Tap **Capture** for *Stream frame*. If *ImageCapture* is available, capture that too.
5. Tap **Capture** for *Native camera*, take the photo, confirm it.
6. Tap **Download original** on each capture and check sharpness at 100% on a computer.
7. Switch Facing to **Rear** and repeat steps 1–4.
8. Lock and unlock the tablet, and switch apps and back; check the event log
   shows the stream restarting.
9. Add the page to the Home Screen, open it from there, and repeat steps 1 and 4
   (installed mode can behave differently from a Safari tab).
10. Export the results: **Share report** (AirDrop, Mail, Messages), **Copy report** or
    **Download report**. If none works, screenshot the **Summary** box at the top;
    it holds the numbers that decide the capture strategy.

## Results

### Physical hardware

| Date | Device | OS / browser | Mode | Camera | ImageCapture | Stream max (W×H) | Stream capture | Native capture | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _pending_ | iPad Pro 10.5" (2017) | | Safari tab | Front | | | | | |
| _pending_ | iPad Pro 10.5" (2017) | | Safari tab | Rear | | | | | |
| _pending_ | iPad Pro 10.5" (2017) | | Home Screen | Front | | | | | |

Operator notes without an exported report:

| Date | Device | What was observed | Still missing |
| --- | --- | --- | --- |
| 2026-11-12 | iPad Pro 10.5" (2017) | The diagnostics page selected **stream frames** as the capture method (so ImageCapture is unavailable, as expected). The report could not be exported; the iPad has battery problems. | Stream and capture dimensions, OS version, installed-mode behaviour. Use **Share report** or screenshot the summary box. |

### Simulated / non-target (not evidence about the iPad)

| Date | Environment | Result |
| --- | --- | --- |
| 2026-11-11 | Headless Chrome 153, Linux, fake camera device | Stream 3840×2160; ImageCapture still 3840×2160 PNG in 210 ms; stream frame JPEG in 107 ms; native input unsupported; probe delivered each requested size up to 3840×2160. Confirms the page and providers work end to end. |
