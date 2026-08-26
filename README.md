# Our Recipes PWA v0.6

A mobile-first shared recipe PWA for two people using Supabase + Vercel, with free local social-video transcription.

## v0.6 adds: Free Local Social Video Import

- New **Video** add mode for downloaded Instagram/TikTok/social recipe videos or screen recordings.
- Extracts the audio track in the browser and resamples it to 16 kHz.
- Runs **Whisper Tiny English locally in the browser** through Transformers.js.
- No OpenAI key, transcription API, or per-video fee.
- First use downloads the free speech model; later uses should reuse the browser cache.
- Optional experimental on-screen text scan samples a few frames with Tesseract.js.
- Turns transcript + visible text into a draft ingredient list and cooking steps for review.
- Social source URL can still be saved with the final recipe.
- Video itself is never uploaded to Supabase by this feature.

## Important limitations

- Keep the app open while a transcription is running.
- Local transcription is compute-heavy; a short Reel may take seconds to minutes depending on the phone.
- A screen recording must include device/media audio or Whisper will have nothing useful to transcribe.
- Browser support for decoding a particular MP4/audio codec varies. A downloaded MP4 is often the most compatible input.
- On-screen OCR is optional because it is slower and is best-effort.
- Recipe structuring is heuristic and intentionally asks you to review quantities/steps instead of inventing missing measurements.
- The speech model is English-focused. A multilingual Whisper model can be added later while staying free, at the cost of a larger download.

## Existing v0.5 features remain

- Shared two-account Supabase cookbook.
- Recipe URL import through `/api/import-recipe`.
- Ask Your Cookbook recommendations and ingredient matching.
- Serving-size import and serving `− / +` controls.
- Smart US kitchen measurements (cups/tbsp/tsp, oz/lb where appropriate).
- Favorites, search, tags, notes, source links, manual/pasted-text entry, and PWA install support.

## Deployment

No new Supabase SQL is required. Replace the v0.5 repo files with this folder, keep `api/import-recipe.js` inside `api/`, commit to the Vercel-connected production branch, and Vercel should deploy automatically.

Because v0.6 changes the service-worker cache name and claims clients immediately, fully closing/reopening the installed PWA after deployment should pick up the new shell more reliably.


## v0.6.1 mobile transcription hotfix
- Removes the silent CPU/WASM Whisper fallback that could take 10+ minutes on phones.
- Requires working WebGPU for local video transcription; if unavailable, fails quickly with an actionable message.
- Upgrades the browser inference runtime to Transformers.js 4.2.0.
- Uses a quantized Whisper tiny English model on WebGPU.
- Transcribes in 20-second chunks so progress reflects actual inference rather than appearing stuck at 55%.
- Caps local video transcription at 3 minutes for phone-friendly processing.
