# Our Recipes PWA v0.7

A mobile-first shared recipe PWA for two people using Supabase + Vercel. v0.7 focuses on higher-quality free local social-video importing.

## v0.7: Video quality overhaul

- Replaces Whisper Tiny English with **Whisper Base multilingual** on WebGPU for better speech recognition while remaining local/free.
- Keeps the no-CPU-fallback safeguard so unsupported phones fail quickly rather than transcribing for 10+ minutes.
- On-screen OCR is now **enabled by default** because recipe quantities are frequently displayed instead of spoken.
- Ingredient extraction now rejects nutrition/time/commentary phrases such as calories, protein, days, and minutes.
- Quantity-only phrases are no longer treated as ingredients unless they include a real kitchen unit or a clearly countable food item.
- Can recover common spoken ingredients without quantities (for example tomato sauce, mozzarella, basil, salt, pepper, and seasonings).
- Instruction extraction trims creator stories/commentary and caps giant speech-recognition paragraphs into shorter cooking steps.
- Adds a low-confidence warning instead of presenting weak extraction as a finished recipe.
- Keeps the raw transcript available during review.
- Video never uploads to Supabase or a paid transcription API.

## Existing features remain

- Shared Supabase cookbook for two accounts.
- Normal recipe URL import through `/api/import-recipe`.
- Ask Your Cookbook recommendations and ingredient matching.
- Serving scaling and smart US kitchen measurements.
- Favorites, search, tags, notes, source links, manual/pasted-text entry, and PWA install support.

## Deployment

No new Supabase SQL is required. Replace the current repo files with this folder, keep `api/import-recipe.js` inside `api/`, commit to the Vercel-connected production branch, and Vercel should deploy automatically. Fully close/reopen the installed PWA after deployment so the v0.7 service-worker cache replaces the older shell.
