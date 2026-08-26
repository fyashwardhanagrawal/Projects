# Our Recipes PWA v0.8

A mobile-first shared recipe PWA for two people using Supabase + Vercel. v0.8 adds permanent navigation and shared-cookbook management so joining is no longer a one-time onboarding decision.

## v0.8: Navigation + shared cookbook controls

- Adds mobile bottom navigation: **Recipes · Ask · Add · More**.
- Moves **Ask Your Cookbook** into its own tab so the recipe library stays uncluttered.
- Adds a permanent **More** area for account and sharing controls.
- A user who already created an account can now join a partner's cookbook later by entering the 8-character invite code under **More → Join my partner’s cookbook**.
- Joining a cookbook automatically switches to it so the shared recipes appear immediately.
- Supports multiple cookbook memberships and lets the user **Switch cookbook** from More.
- Keeps a separate local recipe cache per cookbook to avoid showing recipes from the wrong collection while switching.
- The current cookbook's invite code is always visible/copyable from More.
- Onboarding language is simplified to **Join my partner’s cookbook** or **Create a new shared cookbook**. No team terminology.
- Allows intentionally creating another cookbook from More without trapping users who made one by mistake.

## Existing features remain

- Shared Supabase cookbook for two accounts.
- Normal recipe URL import through `/api/import-recipe`.
- Free local social-video transcription with Whisper Base multilingual + optional OCR.
- Ask Your Cookbook recommendations and ingredient matching.
- Serving scaling and smart US kitchen measurements.
- Favorites, search, tags, notes, source links, manual/pasted-text entry, and installable PWA support.

## Database

**No new Supabase SQL is required for v0.8.** The existing `households`, `household_members`, `recipes`, `create_household`, and `join_household` setup is sufficient.

## Deployment

Replace the current GitHub repo files with this folder, keep `api/import-recipe.js` inside `api/`, commit to the Vercel-connected production branch, and Vercel should deploy automatically. Fully close/reopen the installed PWA after deployment so the `v0.8` service-worker cache replaces the older shell.
