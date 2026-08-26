# Our Recipes PWA v0.4

A mobile-first shared recipe PWA for two people using Supabase + Vercel.

## v0.4 adds
- **Ask Your Cookbook** natural-language-style suggestions using only saved recipes
- Prompts like `Give me 2 dinners this week`
- Prompts like `Give me 2 lunches this week`
- Time-aware prompts like `Show me quick meals under 30 minutes`
- Ingredient matching like `What can I make with paneer, peppers and tortillas?`
- Click any suggestion to open the full saved recipe
- No paid AI/API is required for cookbook suggestions; matching runs in the browser against the recipes already synced from Supabase
- Hardened URL import with both Recipe JSON-LD extraction and a WordPress Recipe Maker fallback

## Existing features
- Separate sign-in accounts for two people
- One shared cookbook + join code
- Cloud-synced recipes, favorites and deletes
- Recipe website URL import
- Best-effort social URL import
- Manual/pasted recipe entry
- Search by recipe, tag and ingredient
- PWA installation on Android and iPhone

## Upgrade from v0.2/v0.3
No database migration is required. Deploy this folder over the existing Vercel project. Existing Supabase users and recipes stay unchanged.

## URL import behavior
Normal recipe sites are checked first for Schema.org Recipe JSON-LD. If that is absent, the importer also checks common WP Recipe Maker recipe-card markup. Social platforms may still expose only partial data.

## Cookbook assistant behavior
The assistant is intentionally free and private: it scores and filters your saved recipe records locally. It understands common requests for meal type, number of suggestions, time limits, favorites, and ingredients. It is not a general-purpose cloud LLM in this version.
