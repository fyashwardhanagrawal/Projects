# Our Recipes PWA v0.5

A mobile-first shared recipe PWA for two people using Supabase + Vercel.

## v0.5 adds
- Recipe serving size import from structured recipe pages
- Manual serving-size field when adding a recipe
- `- / +` serving controls on recipe detail pages
- Automatic ingredient scaling as servings change
- Kitchen-friendly fractions such as 1½, 2¼, ¾
- Practical measurement normalization:
  - tsp → tbsp → cups when the conversion is clean
  - mL/L → cups/tbsp/tsp
  - grams/kg → oz/lb instead of forcing unreliable cup conversions
  - countable ingredients such as eggs, onions, chilies and tortillas scale numerically
  - quantity-free lines such as “salt to taste” are left unchanged
- Original serving size is always preserved and can be reset
- Older recipes without serving metadata can set their original servings directly from the recipe detail screen
- No Supabase migration required: serving metadata is stored as an internal hidden recipe tag so the existing database keeps working
- Improved Instagram/TikTok/YouTube/Facebook best-effort import behavior
  - reads public page/caption metadata when the platform exposes it
  - tries to recognize marked “Ingredients” / “Instructions” text in social descriptions
  - if a platform blocks automated reading, the source link is still preserved and the UI clearly asks for a caption/transcript fallback

## Existing setup
This build keeps the existing Supabase project and public key configuration. No SQL changes are required from v0.4.

## Updating Vercel
Replace the files in the connected Git repository with the contents of this folder, keeping `api/import-recipe.js` inside the `api` folder. Commit to the production branch. Vercel should deploy the commit automatically.

## Social import reality
Normal recipe websites are the strongest import path because many publish Schema.org Recipe / JSON-LD data. Social platforms may restrict what a server can read from a public post. v0.5 therefore uses a best-effort path and preserves the source even when the full caption/video transcript is unavailable.
