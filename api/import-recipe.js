const SUPABASE_URL = 'https://zpvsuvaakwsqvmnktlzp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_s4uJAkSb-3411BsU5f8kmg_zf5eTZVt';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeUrl(input) {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const h = url.hostname.toLowerCase();
    if (
      h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
    ) return null;
    return url;
  } catch {
    return null;
  }
}

async function isAuthenticated(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: auth
      }
    });
    return r.ok;
  } catch {
    return false;
  }
}

function decodeEntities(text = '') {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(text = '') {
  return decodeEntities(String(text).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1]) return decodeEntities(m[1]).trim();
    }
  }
  return '';
}

function titleFromHtml(html) {
  const og = metaContent(html, ['og:title', 'twitter:title']);
  if (og) return og;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]) : '';
}

function durationMinutes(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const mins = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + Math.round((+m[4] || 0) / 60);
  return mins || null;
}

function flattenInstructions(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    const t = stripTags(value);
    if (t) out.push(t);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(v => flattenInstructions(v, out));
    return out;
  }
  if (typeof value === 'object') {
    if (value.text) flattenInstructions(value.text, out);
    else if (value.itemListElement) flattenInstructions(value.itemListElement, out);
  }
  return out;
}

function typesOf(obj) {
  const t = obj?.['@type'];
  return Array.isArray(t) ? t : (t ? [t] : []);
}

function findRecipe(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  if (typesOf(node).some(t => String(t).toLowerCase() === 'recipe')) return node;
  if (node['@graph']) {
    const found = findRecipe(node['@graph']);
    if (found) return found;
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findRecipe(value);
      if (found) return found;
    }
  }
  return null;
}

function parseKeywords(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[,;|]/);
  return raw.map(v => stripTags(v)).filter(Boolean).slice(0, 12);
}

function mergeTags(recipe) {
  const tags = [
    ...parseKeywords(recipe.recipeCuisine),
    ...parseKeywords(recipe.recipeCategory),
    ...parseKeywords(recipe.keywords)
  ];
  return [...new Set(tags)].slice(0, 12);
}

function extractJsonLdRecipe(html) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    const raw = script[1].trim().replace(/^\uFEFF/, '');
    if (!raw) continue;
    const candidates = [raw, decodeEntities(raw)];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const recipe = findRecipe(parsed);
        if (recipe) return recipe;
      } catch {}
    }
  }
  return null;
}

function normalizeRecipe(recipe, url, html) {
  const ingredients = Array.isArray(recipe.recipeIngredient)
    ? recipe.recipeIngredient.map(stripTags).filter(Boolean)
    : [];
  const instructions = flattenInstructions(recipe.recipeInstructions).filter(Boolean);
  const description = stripTags(recipe.description || metaContent(html, ['description', 'og:description']));
  return {
    ok: true,
    partial: ingredients.length === 0 || instructions.length === 0,
    source_url: url,
    title: stripTags(recipe.name) || titleFromHtml(html) || 'Imported recipe',
    prep_minutes: durationMinutes(recipe.prepTime),
    cook_minutes: durationMinutes(recipe.cookTime),
    total_minutes: durationMinutes(recipe.totalTime),
    ingredients,
    instructions,
    tags: mergeTags(recipe),
    notes: description || null,
    message: ingredients.length && instructions.length
      ? 'Recipe imported. Review it before saving.'
      : 'I found the recipe page, but some fields were missing. Review before saving.'
  };
}


function elementsByClassToken(html, tag, classToken) {
  const escaped = classToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*(?<![\\w-])${escaped}(?=\\s|["'])[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  return [...html.matchAll(re)].map(m => stripTags(m[1])).filter(Boolean);
}

function anyTagByClassToken(html, classToken) {
  const escaped = classToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<([a-z0-9]+)\\b[^>]*class=["'][^"']*(?<![\\w-])${escaped}(?=\\s|["'])[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');
  return [...html.matchAll(re)].map(m => stripTags(m[2])).filter(Boolean);
}

function firstClassText(html, classToken) {
  return anyTagByClassToken(html, classToken)[0] || '';
}

function numericClassValue(html, classToken) {
  const t = firstClassText(html, classToken);
  const m = t.match(/\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0])) : null;
}

function extractWprmRecipe(html, url) {
  if (!/wprm-recipe/i.test(html)) return null;

  const ingredients = elementsByClassToken(html, 'li', 'wprm-recipe-ingredient')
    .map(x => x.replace(/^[•*-]\s*/, '').trim())
    .filter(Boolean);
  const instructions = anyTagByClassToken(html, 'wprm-recipe-instruction-text');

  if (!ingredients.length && !instructions.length) return null;

  const name = firstClassText(html, 'wprm-recipe-name') || titleFromHtml(html);
  const cuisine = firstClassText(html, 'wprm-recipe-cuisine');
  const course = firstClassText(html, 'wprm-recipe-course');
  const notes = firstClassText(html, 'wprm-recipe-notes') || metaContent(html, ['description', 'og:description']);

  return {
    ok: true,
    partial: !ingredients.length || !instructions.length,
    source_url: url,
    title: name || 'Imported recipe',
    prep_minutes: numericClassValue(html, 'wprm-recipe-prep_time-minutes') || numericClassValue(html, 'wprm-recipe-prep_time'),
    cook_minutes: numericClassValue(html, 'wprm-recipe-cook_time-minutes') || numericClassValue(html, 'wprm-recipe-cook_time'),
    total_minutes: numericClassValue(html, 'wprm-recipe-total_time-minutes') || numericClassValue(html, 'wprm-recipe-total_time'),
    ingredients: ingredients.slice(0, 100),
    instructions: instructions.slice(0, 100),
    tags: [...new Set([cuisine, course].filter(Boolean))],
    notes: notes ? stripTags(notes) : null,
    message: ingredients.length && instructions.length
      ? 'Recipe imported. Review it before saving.'
      : 'I found the recipe card, but some fields were missing. Review before saving.'
  };
}

function fallbackResult(url, html) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const description = metaContent(html, ['description', 'og:description', 'twitter:description']);
  const social = /(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com)$/i.test(host);
  return {
    ok: true,
    partial: true,
    source_url: url,
    title: titleFromHtml(html) || 'Imported link',
    prep_minutes: null,
    cook_minutes: null,
    total_minutes: null,
    ingredients: [],
    instructions: [],
    tags: social ? ['Social'] : [],
    notes: description ? stripTags(description) : null,
    message: social
      ? 'Saved what the social site exposed, but it did not provide full recipe ingredients/instructions. Paste the caption or transcript for now.'
      : 'This page did not expose structured recipe data. The source and page details were imported; you can fill or paste the missing recipe text.'
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
  if (!(await isAuthenticated(req))) return send(res, 401, { error: 'Please sign in again.' });

  const url = safeUrl(req.query?.url);
  if (!url) return send(res, 400, { error: 'Enter a valid public http/https URL.' });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OurRecipes/0.3; +https://vercel.app)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timer);

    if (!response.ok) return send(res, 422, { error: `The source returned HTTP ${response.status}.` });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) {
      return send(res, 422, { error: 'That link did not return a web page I can import.' });
    }

    const html = (await response.text()).slice(0, 1_500_000);
    const finalUrl = response.url || url.toString();
    const recipe = extractJsonLdRecipe(html);
    if (recipe) return send(res, 200, normalizeRecipe(recipe, finalUrl, html));
    const wprm = extractWprmRecipe(html, finalUrl);
    return send(res, 200, wprm || fallbackResult(finalUrl, html));
  } catch (e) {
    const message = e?.name === 'AbortError'
      ? 'That page took too long to respond.'
      : 'I could not read that page. Some sites block automated recipe imports.';
    return send(res, 422, { error: message });
  }
};
