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


function servingsNumber(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const n = servingsNumber(v);
      if (n) return n;
    }
    return null;
  }
  if (typeof value === 'number') return value > 0 ? value : null;
  const text = stripTags(String(value));
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function socialHostName(host = '') {
  if (/(^|\.)instagram\.com$/i.test(host)) return 'Instagram';
  if (/(^|\.)tiktok\.com$/i.test(host)) return 'TikTok';
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(host)) return 'YouTube';
  if (/(^|\.)facebook\.com$/i.test(host)) return 'Facebook';
  return null;
}

function cleanSocialDescription(text = '') {
  let t = stripTags(text);
  // Instagram often prefixes OG descriptions with likes/comments and account/date metadata.
  const quoted = t.match(/:\s*[“\"]([\s\S]+?)[”\"]\s*$/);
  if (quoted?.[1]) t = quoted[1].trim();
  return t;
}

function parseMarkedSocialRecipe(text = '') {
  const raw = cleanSocialDescription(text);
  if (!raw) return { ingredients: [], instructions: [] };
  const ingMatch = raw.match(/ingredients?\s*[:\-]\s*([\s\S]*?)(?=\b(?:instructions?|directions?|method|steps?)\s*[:\-]|$)/i);
  const stepMatch = raw.match(/(?:instructions?|directions?|method|steps?)\s*[:\-]\s*([\s\S]*)$/i);
  const splitItems = value => String(value || '')
    .split(/\s*[•▪◦●]\s*|\s*;\s*|\s+\d+[.)]\s+/)
    .map(x => x.trim().replace(/^[-–—]\s*/, ''))
    .filter(x => x.length > 1);
  return {
    ingredients: ingMatch ? splitItems(ingMatch[1]).slice(0, 60) : [],
    instructions: stepMatch ? splitItems(stepMatch[1]).slice(0, 40) : []
  };
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
    servings: servingsNumber(recipe.recipeYield),
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
    servings: numericClassValue(html, 'wprm-recipe-servings'),
    ingredients: ingredients.slice(0, 100),
    instructions: instructions.slice(0, 100),
    tags: [...new Set([cuisine, course].filter(Boolean))],
    notes: notes ? stripTags(notes) : null,
    message: ingredients.length && instructions.length
      ? 'Recipe imported. Review it before saving.'
      : 'I found the recipe card, but some fields were missing. Review before saving.'
  };
}



function headingRecords(html = '') {
  const out = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  for (const m of html.matchAll(re)) {
    out.push({ level: Number(m[1]), text: stripTags(m[2]), index: m.index, end: m.index + m[0].length });
  }
  return out;
}

function listItemsFromBlock(block = '') {
  return [...String(block).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map(m => stripTags(m[1]).replace(/^[•*\-–—]\s*/, '').trim())
    .filter(x => x.length > 1);
}

function extractNewsletterArticleRecipe(html, url) {
  const headings = headingRecords(html);
  if (!headings.length) return null;

  const ingredientHeading = headings.find(h => /^ingredients?\b/i.test(h.text));
  if (!ingredientHeading) return null;

  // Recipe/newsletter pages often use: RECIPE! -> recipe title -> Ingredients ->
  // ingredient subsections -> ordered-list directions. Stay near that section so
  // navigation/footer lists do not get mistaken for ingredients.
  const ingredientStart = ingredientHeading.end;
  const maxEnd = Math.min(html.length, ingredientStart + 120000);
  const afterIngredients = html.slice(ingredientStart, maxEnd);
  const olMatch = afterIngredients.match(/<ol\b[^>]*>[\s\S]*?<\/ol>/i);
  let instructions = olMatch ? listItemsFromBlock(olMatch[0]) : [];
  let ingredientRegion = olMatch ? afterIngredients.slice(0, olMatch.index) : afterIngredients.slice(0, 50000);

  // If there is an explicit directions/method heading before the first <ol>, stop
  // ingredients there and look immediately after it for numbered/list steps.
  const methodHeading = ingredientRegion.match(/<h[1-6]\b[^>]*>\s*(?:<[^>]+>\s*)*(?:instructions?|directions?|method|steps?)\b[\s\S]*?<\/h[1-6]>/i);
  if (methodHeading) {
    ingredientRegion = ingredientRegion.slice(0, methodHeading.index);
    const methodStart = ingredientStart + methodHeading.index + methodHeading[0].length;
    const methodTail = html.slice(methodStart, Math.min(html.length, methodStart + 50000));
    const methodList = methodTail.match(/<(?:ol|ul)\b[^>]*>[\s\S]*?<\/(?:ol|ul)>/i);
    if (methodList) instructions = listItemsFromBlock(methodList[0]);
  }

  const ingredientLists = [...ingredientRegion.matchAll(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi)]
    .flatMap(m => listItemsFromBlock(m[0]));
  let ingredients = ingredientLists;
  if (ingredients.length < 3) ingredients = listItemsFromBlock(ingredientRegion);

  // Some newsletters render directions as plain numbered paragraphs instead of <ol>.
  if (instructions.length < 2) {
    const tail = afterIngredients.slice(Math.min(afterIngredients.length, ingredientRegion.length));
    instructions = [...tail.matchAll(/<(?:p|div)\b[^>]*>\s*(\d{1,2})[.)]\s*([\s\S]*?)<\/(?:p|div)>/gi)]
      .map(m => stripTags(m[2]))
      .filter(Boolean)
      .slice(0, 60);
  }

  ingredients = ingredients
    .map(x => x.replace(/^[-•*]\s*/, '').trim())
    .filter(x => !/^(?:share|subscribe|comment|reply|like|read more)$/i.test(x))
    .slice(0, 120);
  instructions = instructions
    .map(x => x.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 80);

  if (ingredients.length < 3 || instructions.length < 2) return null;

  const previousHeadings = headings.filter(h => h.index < ingredientHeading.index);
  let title = '';
  for (let i = previousHeadings.length - 1; i >= 0; i--) {
    const h = previousHeadings[i];
    if (/^(?:recipe!?|ingredients?|salad|dressing|sauce|filling|topping|method|directions?)$/i.test(h.text.trim())) continue;
    if (h.level <= 3) { title = h.text; break; }
  }
  title = title || titleFromHtml(html) || 'Imported recipe';

  const servesText = ingredientHeading.text;
  const servesMatch = servesText.match(/(?:serves?|servings?|yield)\s*[:()\-]?\s*(\d+(?:\.\d+)?)(?:\s*[-–—]\s*(\d+(?:\.\d+)?))?/i);
  const servings = servesMatch ? Number(servesMatch[2] || servesMatch[1]) : null;
  const servingRangeNote = servesMatch?.[2] ? `Original source says serves ${servesMatch[1]}–${servesMatch[2]}. The larger number is used as the scaling baseline.` : null;

  return {
    ok: true,
    partial: false,
    source_url: url,
    title: stripTags(title),
    prep_minutes: null,
    cook_minutes: null,
    total_minutes: null,
    servings,
    ingredients,
    instructions,
    tags: ['Newsletter'],
    notes: servingRangeNote,
    message: 'Recipe found inside the article/newsletter. Review it before saving.'
  };
}



function substackPostSlug(urlObj) {
  const m = String(urlObj?.pathname || '').match(/^\/p\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function getBodyHtmlFromPostJson(data) {
  if (!data || typeof data !== 'object') return '';
  const candidates = [
    data.body_html,
    data.bodyHtml,
    data.post?.body_html,
    data.post?.bodyHtml,
    data.data?.body_html,
    data.data?.bodyHtml
  ];
  return candidates.find(v => typeof v === 'string' && v.trim().length > 100) || '';
}

function getPostTitleFromJson(data) {
  if (!data || typeof data !== 'object') return '';
  const candidates = [data.title, data.post?.title, data.data?.title];
  return candidates.find(v => typeof v === 'string' && v.trim()) || '';
}

async function trySubstackPostApi(pageUrl) {
  const slug = substackPostSlug(pageUrl);
  if (!slug) return null;

  // Substack publications, including custom domains, expose their public post
  // body through this JSON endpoint. Non-Substack sites will simply 404 here.
  const apiUrl = new URL(`/api/v1/posts/${encodeURIComponent(slug)}`, pageUrl.origin);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(apiUrl.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OurRecipes/0.9.1; +https://vercel.app)',
        'Accept': 'application/json,text/plain;q=0.8,*/*;q=0.5'
      }
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || '';
    if (!type.includes('json')) return null;
    const data = await r.json();
    const bodyHtml = getBodyHtmlFromPostJson(data);
    if (!bodyHtml) return null;
    return { bodyHtml, title: stripTags(getPostTitleFromJson(data)), apiUrl: r.url || apiUrl.toString() };
  } catch {
    return null;
  }
}

function fallbackResult(url, html, forcedMessage = '') {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const socialName = socialHostName(host);
  const descriptionRaw = metaContent(html, ['description', 'og:description', 'twitter:description']);
  const description = socialName ? cleanSocialDescription(descriptionRaw) : descriptionRaw;
  const marked = socialName ? parseMarkedSocialRecipe(description) : { ingredients: [], instructions: [] };
  const gotRecipeText = marked.ingredients.length > 0 || marked.instructions.length > 0;
  return {
    ok: true,
    partial: true,
    source_url: url,
    title: titleFromHtml(html) || (socialName ? `${socialName} recipe` : 'Imported link'),
    prep_minutes: null,
    cook_minutes: null,
    total_minutes: null,
    servings: null,
    ingredients: marked.ingredients,
    instructions: marked.instructions,
    tags: socialName ? [socialName, 'Social'] : [],
    // For ordinary article/newsletter pages, a meta description is often a
    // subtitle or unrelated essay teaser, not recipe notes. Keep captions only
    // for social posts where they are genuinely useful source material.
    notes: socialName && description ? stripTags(description) : null,
    message: forcedMessage || (socialName
      ? (gotRecipeText
          ? `${socialName} exposed part of the caption, so I pulled the recipe text I could find. Review it before saving.`
          : `${socialName} did not expose full recipe ingredients/instructions to the importer. The source and any public caption details were kept; paste the caption/transcript when needed.`)
      : 'This page did not expose structured recipe data. The source and page details were imported; you can fill or paste the missing recipe text.')
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
        'User-Agent': 'Mozilla/5.0 (compatible; OurRecipes/0.5; +https://vercel.app)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timer);

    if (!response.ok) {
      const socialName = socialHostName(url.hostname);
      if (socialName) return send(res, 200, fallbackResult(url.toString(), '', `${socialName} blocked automated reading of this post (HTTP ${response.status}). I kept the source link; paste the caption or transcript to finish the recipe.`));
      return send(res, 422, { error: `The source returned HTTP ${response.status}.` });
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) {
      return send(res, 422, { error: 'That link did not return a web page I can import.' });
    }

    const html = (await response.text()).slice(0, 1_500_000);
    const finalUrl = response.url || url.toString();
    const recipe = extractJsonLdRecipe(html);
    if (recipe) return send(res, 200, normalizeRecipe(recipe, finalUrl, html));
    const wprm = extractWprmRecipe(html, finalUrl);
    if (wprm) return send(res, 200, wprm);

    // Try the visible page HTML first. If a Substack/custom-domain newsletter
    // keeps its post body out of the server-rendered HTML, fetch the public post
    // JSON and parse body_html instead.
    const newsletter = extractNewsletterArticleRecipe(html, finalUrl);
    if (newsletter) return send(res, 200, newsletter);

    const pageUrl = new URL(finalUrl);
    const substackPost = await trySubstackPostApi(pageUrl);
    if (substackPost) {
      const bodyRecipe = extractJsonLdRecipe(substackPost.bodyHtml);
      if (bodyRecipe) {
        const normalized = normalizeRecipe(bodyRecipe, finalUrl, substackPost.bodyHtml);
        if (substackPost.title) normalized.title = substackPost.title;
        normalized.message = 'Recipe imported from the newsletter post. Review it before saving.';
        return send(res, 200, normalized);
      }
      const bodyWprm = extractWprmRecipe(substackPost.bodyHtml, finalUrl);
      if (bodyWprm) {
        if (substackPost.title) bodyWprm.title = substackPost.title;
        bodyWprm.message = 'Recipe imported from the newsletter post. Review it before saving.';
        return send(res, 200, bodyWprm);
      }
      const bodyNewsletter = extractNewsletterArticleRecipe(substackPost.bodyHtml, finalUrl);
      if (bodyNewsletter) {
        if (substackPost.title) bodyNewsletter.title = substackPost.title;
        bodyNewsletter.message = 'Recipe found inside the Substack/newsletter post. Review it before saving.';
        return send(res, 200, bodyNewsletter);
      }
    }

    return send(res, 200, fallbackResult(finalUrl, html));
  } catch (e) {
    const socialName = socialHostName(url.hostname);
    if (socialName) {
      const reason = e?.name === 'AbortError' ? 'timed out' : 'blocked automated reading';
      return send(res, 200, fallbackResult(url.toString(), '', `${socialName} ${reason}. I kept the source link; paste the caption or transcript and the app can still turn that text into a saved recipe.`));
    }
    const message = e?.name === 'AbortError'
      ? 'That page took too long to respond.'
      : 'I could not read that page. Some sites block automated recipe imports.';
    return send(res, 422, { error: message });
  }
};
