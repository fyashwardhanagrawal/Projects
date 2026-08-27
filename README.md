# Our Recipes PWA v0.9

A mobile-first shared recipe PWA for two people using Supabase + Vercel. v0.9 improves article/newsletter importing and adds free local photo/screenshot recipe import.

## v0.9: Better web import + Photo/Screenshot import

- Keeps all v0.8 navigation, shared-cookbook, serving-scaling, Ask, and video features.
- URL importer now looks for recipe sections buried inside long article/newsletter pages when no Recipe JSON-LD or WordPress recipe card exists.
- Supports common newsletter layouts with a recipe title, **Ingredients** heading, ingredient sub-sections/lists, and ordered cooking steps.
- For source serving ranges such as **serves 2–4**, uses the larger number as the scaling baseline and records the original range in Notes.
- Adds **Photo** as an Add Recipe mode.
- From Photo mode, the phone can take/choose a photo or screenshot of printed recipe text.
- OCR runs locally in the browser with Tesseract.js; no paid OCR/AI API is required.
- Extracted photo text is shown for review before it becomes a recipe.
- Pasted text and photo OCR now share a more structured recipe parser that recognizes Ingredients / Directions / Method / numbered steps and serving counts.

## Important photo-import boundary

This feature reads **recipe text visible in an image** (cookbook page, recipe card, screenshot, printed recipe). It does not reliably identify an unknown dish from a food-only photograph and invent the exact recipe.

## Database

**No new Supabase SQL is required for v0.9.** Existing accounts, cookbooks, and saved recipes stay unchanged.

## Deployment

Replace the current GitHub repo files with this folder, keep `api/import-recipe.js` inside `api/`, commit to the Vercel-connected production branch, and Vercel should deploy automatically. Fully close/reopen the installed PWA after deployment so the `v0.9` service-worker cache replaces the older shell.
