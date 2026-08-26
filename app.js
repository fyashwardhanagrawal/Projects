const $ = id => document.getElementById(id);
const lines = text => (text || '').split('\n').map(x => x.trim()).filter(Boolean);
const CONFIG = window.OUR_RECIPES_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co$/.test(CONFIG.supabaseUrl || '') && CONFIG.supabaseAnonKey && !CONFIG.supabaseAnonKey.includes('YOUR_');
const client = configured ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null;

let session = null;
let household = null;
let households = [];
let recipes = [];
let activeTag = 'all';
let favoritesOnly = false;
let viewingId = null;
let viewServingCount = null;
let activeAppPage = 'recipes';

const SERVINGS_TAG_PREFIX = '__servings:';

function showOnly(id) {
  ['setupView', 'authView', 'householdView', 'appView'].forEach(x => $(x).classList.toggle('hidden', x !== id));
}

function setStatus(id, message = '', isError = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('error', isError);
  if (id === 'recipeImportNotice') el.classList.toggle('hidden', !message);
}

function showSync(message = '') {
  $('syncBanner').textContent = message;
  $('syncBanner').classList.toggle('hidden', !message);
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
}


function visibleTags(tags = []) {
  return (tags || []).filter(t => !String(t).startsWith('__'));
}

function recipeServings(recipe) {
  const tag = (recipe?.tags || []).find(t => String(t).startsWith(SERVINGS_TAG_PREFIX));
  if (!tag) return null;
  const n = Number(String(tag).slice(SERVINGS_TAG_PREFIX.length));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tagsWithServings(tags = [], servings = null) {
  const clean = (tags || []).filter(t => !String(t).startsWith(SERVINGS_TAG_PREFIX));
  const n = Number(servings);
  if (Number.isFinite(n) && n > 0) clean.push(`${SERVINGS_TAG_PREFIX}${n}`);
  return clean;
}

const FRACTION_VALUES = [
  [0.125, '⅛'], [0.25, '¼'], [1/3, '⅓'], [0.375, '⅜'], [0.5, '½'],
  [0.625, '⅝'], [2/3, '⅔'], [0.75, '¾'], [0.875, '⅞']
];
const UNICODE_FRACTIONS = {
  '⅛': 0.125, '¼': 0.25, '⅓': 1/3, '⅜': 0.375, '½': 0.5,
  '⅝': 0.625, '⅔': 2/3, '¾': 0.75, '⅞': 0.875
};

function nearestKitchenFraction(value) {
  let best = [0, ''];
  let diff = Math.abs(value);
  for (const pair of FRACTION_VALUES) {
    const d = Math.abs(value - pair[0]);
    if (d < diff) { best = pair; diff = d; }
  }
  if (Math.abs(1 - value) < diff) return { value: 1, text: '', diff: Math.abs(1 - value) };
  return { value: best[0], text: best[1], diff };
}

function formatKitchenNumber(value, tolerance = 0.035) {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) < 0.0001) return '0';
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  if (frac < 0.035) return String(whole);
  if (1 - frac < 0.035) return String(whole + 1);
  const best = nearestKitchenFraction(frac);
  if (best.diff <= tolerance && best.text) return whole ? `${whole}${best.text}` : best.text;
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function parseNumberText(text = '') {
  let t = String(text).trim();
  if (!t) return null;
  let unicode = 0;
  for (const [symbol, value] of Object.entries(UNICODE_FRACTIONS)) {
    if (t.includes(symbol)) {
      unicode += value;
      t = t.replace(symbol, '').trim();
    }
  }
  let base = 0;
  if (t) {
    const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) base = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    else {
      const frac = t.match(/^(\d+)\/(\d+)$/);
      if (frac) base = Number(frac[1]) / Number(frac[2]);
      else if (/^\d*\.?\d+$/.test(t)) base = Number(t);
      else return null;
    }
  }
  return base + unicode;
}

function parseQuantityPrefix(line = '') {
  const text = String(line).trim();
  const numberToken = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+|\d*[⅛¼⅓⅜½⅝⅔¾⅞])`;
  const re = new RegExp(`^(${numberToken})(?:\\s*(?:-|–|—|to)\\s*(${numberToken}))?\\s+`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const low = parseNumberText(m[1]);
  const high = m[2] ? parseNumberText(m[2]) : null;
  if (!Number.isFinite(low)) return null;
  return { low, high: Number.isFinite(high) ? high : null, rest: text.slice(m[0].length).trim() };
}

const UNIT_PATTERNS = [
  { re: /^(cups?|c)\b\.?\s*/i, key: 'cup' },
  { re: /^(tablespoons?|tbsp|tbs)\b\.?\s*/i, key: 'tbsp' },
  { re: /^(teaspoons?|tsp)\b\.?\s*/i, key: 'tsp' },
  { re: /^(milliliters?|millilitres?|ml)\b\.?\s*/i, key: 'ml' },
  { re: /^(liters?|litres?|l)\b\.?\s*/i, key: 'l' },
  { re: /^(fluid\s+ounces?|fl\.?\s*oz)\b\.?\s*/i, key: 'floz' },
  { re: /^(ounces?|oz)\b\.?\s*/i, key: 'oz' },
  { re: /^(pounds?|lbs?|lb)\b\.?\s*/i, key: 'lb' },
  { re: /^(kilograms?|kilogrammes?|kg)\b\.?\s*/i, key: 'kg' },
  { re: /^(grams?|grammes?|g)\b\.?\s*/i, key: 'g' }
];

function parseUnit(rest = '') {
  for (const unit of UNIT_PATTERNS) {
    const m = rest.match(unit.re);
    if (m) return { key: unit.key, rest: rest.slice(m[0].length).trim() };
  }
  return { key: null, rest: rest.trim() };
}

function niceVolumeFromTsp(tsp) {
  const cup = tsp / 48;
  const cupWhole = cup >= 1;
  const cupFrac = cup - Math.floor(cup);
  const cupNice = cupWhole || nearestKitchenFraction(cupFrac).diff <= 0.018;
  if (tsp >= 12 && cupNice) return `${formatKitchenNumber(cup, 0.02)} ${Math.abs(cup - 1) < .02 ? 'cup' : 'cups'}`;
  const tbsp = tsp / 3;
  if (tsp >= 3) return `${formatKitchenNumber(tbsp)} ${Math.abs(tbsp - 1) < .04 ? 'tbsp' : 'tbsp'}`;
  return `${formatKitchenNumber(tsp)} tsp`;
}

function niceWeightFromOz(oz) {
  if (oz >= 16) {
    const lb = oz / 16;
    return `${formatKitchenNumber(lb, 0.03)} ${Math.abs(lb - 1) < .04 ? 'lb' : 'lb'}`;
  }
  return `${formatKitchenNumber(oz, 0.03)} oz`;
}

function formatScaledRange(low, high = null) {
  if (!Number.isFinite(high)) return formatKitchenNumber(low);
  return `${formatKitchenNumber(low)}–${formatKitchenNumber(high)}`;
}

function scaleIngredientLine(line, factor = 1) {
  if (!line || !Number.isFinite(factor) || factor <= 0) return line;
  const parsed = parseQuantityPrefix(line);
  if (!parsed) return line;
  const unit = parseUnit(parsed.rest);
  const low = parsed.low * factor;
  const high = parsed.high != null ? parsed.high * factor : null;
  const suffix = unit.rest ? ` ${unit.rest}` : '';

  const volumeTsp = { cup: 48, tbsp: 3, tsp: 1, ml: 0.202884, l: 202.884, floz: 6 };
  const weightOz = { oz: 1, lb: 16, g: 0.035274, kg: 35.274 };

  if (unit.key && volumeTsp[unit.key]) {
    if (high != null) {
      const a = niceVolumeFromTsp(low * volumeTsp[unit.key]);
      const b = niceVolumeFromTsp(high * volumeTsp[unit.key]);
      return `${a}–${b}${suffix}`;
    }
    return `${niceVolumeFromTsp(low * volumeTsp[unit.key])}${suffix}`;
  }

  if (unit.key && weightOz[unit.key]) {
    if (high != null) {
      const a = niceWeightFromOz(low * weightOz[unit.key]);
      const b = niceWeightFromOz(high * weightOz[unit.key]);
      return `${a}–${b}${suffix}`;
    }
    return `${niceWeightFromOz(low * weightOz[unit.key])}${suffix}`;
  }

  return `${formatScaledRange(low, high)} ${parsed.rest}`.trim();
}

function renderScaledIngredients(recipe) {
  const original = recipeServings(recipe);
  const target = viewServingCount || original;
  const factor = original && target ? target / original : 1;
  $('viewIngredients').innerHTML = (recipe.ingredients || []).map(x => `<li>${escapeHtml(scaleIngredientLine(x, factor))}</li>`).join('') || '<li>No ingredients added.</li>';
}

function updateServingUI(recipe) {
  const original = recipeServings(recipe);
  $('servingSection').classList.remove('hidden');
  $('servingControls').classList.toggle('hidden', !original);
  $('servingMissing').classList.toggle('hidden', !!original);
  if (!original) {
    viewServingCount = null;
    renderScaledIngredients(recipe);
    return;
  }
  if (!viewServingCount) viewServingCount = original;
  $('servingNumber').value = viewServingCount;
  $('servingCount').textContent = formatKitchenNumber(viewServingCount);
  $('servingOriginal').textContent = `Original recipe: ${formatKitchenNumber(original)} servings`;
  $('servingReset').classList.toggle('hidden', viewServingCount === original);
  renderScaledIngredients(recipe);
}

async function setOriginalServings() {
  const recipe = recipes.find(x => x.id === viewingId);
  if (!recipe) return;
  const n = Number($('baseServingsNumber').value);
  if (!Number.isFinite(n) || n <= 0) return alert('Enter the original number of servings first.');
  const nextTags = tagsWithServings(recipe.tags || [], n);
  const { error } = await client.from('recipes').update({ tags: nextTags }).eq('id', recipe.id);
  if (error) return alert(error.message);
  recipe.tags = nextTags;
  viewServingCount = n;
  $('baseServingsNumber').value = '';
  render();
  updateServingUI(recipe);
}

function changeViewServings(delta) {
  const recipe = recipes.find(x => x.id === viewingId);
  const original = recipeServings(recipe);
  if (!recipe || !original) return;
  const current = Number(viewServingCount || original);
  viewServingCount = Math.max(1, Math.round((current + delta) * 4) / 4);
  updateServingUI(recipe);
}

function setViewServings(value) {
  const recipe = recipes.find(x => x.id === viewingId);
  const original = recipeServings(recipe);
  if (!recipe || !original) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return updateServingUI(recipe);
  viewServingCount = Math.max(1, Math.round(n * 4) / 4);
  updateServingUI(recipe);
}

function emojiFor(tags = []) {
  if (tags.includes('Dessert')) return '🍰';
  if (tags.includes('Indian')) return '🍛';
  if (tags.includes('Quick')) return '⚡';
  if (tags.includes('Air Fryer')) return '🌬️';
  return '🍽️';
}

function timeText(r) {
  const total = (+r.prep_minutes || 0) + (+r.cook_minutes || 0);
  return total ? `${total} min total` : 'Time not added';
}

function render() {
  if (!$('searchInput')) return;
  const q = $('searchInput').value.trim().toLowerCase();
  const filtered = recipes.filter(r => {
    const hay = [r.title, r.notes, ...visibleTags(r.tags), ...(r.ingredients || [])].join(' ').toLowerCase();
    const tagOk = activeTag === 'all' || (r.tags || []).includes(activeTag);
    const favOk = !favoritesOnly || r.favorite;
    return hay.includes(q) && tagOk && favOk;
  });

  $('recipeCount').textContent = filtered.length;
  $('recipeGrid').innerHTML = filtered.map(r => `
    <button class="recipe-card" data-id="${r.id}">
      <span class="heart">${r.favorite ? '♥' : '♡'}</span>
      <div class="card-emoji">${emojiFor(r.tags)}</div>
      <h3>${escapeHtml(r.title)}</h3>
      <p class="card-meta">${timeText(r)}</p>
      <div class="card-tags">${visibleTags(r.tags).slice(0,3).map(t => `<span class="mini-tag">${escapeHtml(t)}</span>`).join('')}</div>
    </button>`).join('');

  $('emptyState').classList.toggle('hidden', filtered.length !== 0);
  document.querySelectorAll('.recipe-card').forEach(el => el.addEventListener('click', () => openRecipe(el.dataset.id)));
}

function recipeCacheKey(householdId) {
  return householdId ? `our-recipes-cloud-cache:${householdId}` : 'our-recipes-cloud-cache';
}

function navigateTo(page = 'recipes', scroll = true) {
  if (!['recipes', 'ask', 'more'].includes(page)) page = 'recipes';
  activeAppPage = page;
  const map = { recipes: 'recipesPage', ask: 'askPage', more: 'morePage' };
  Object.entries(map).forEach(([name, id]) => $(id)?.classList.toggle('hidden', name !== page));
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  const titles = { recipes: 'Our Recipes', ask: 'Ask Your Cookbook', more: 'More' };
  if ($('appPageTitle')) $('appPageTitle').textContent = titles[page];
  if (page === 'more') renderCookbookSettings();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCookbookSettings() {
  if (!household) return;
  $('cookbookName').textContent = (household.name || 'Our Kitchen').toUpperCase();
  $('inviteCode').textContent = household.join_code || '--------';
  $('moreCurrentCookbookName').textContent = household.name || 'Our Recipes';
  $('moreCurrentRole').textContent = household.role === 'owner' ? 'Owner' : 'Member';
  $('moreInviteCode').textContent = household.join_code || '--------';
  $('accountEmail').textContent = session?.user?.email || 'Signed in';

  $('cookbookList').innerHTML = households.map(h => {
    const current = h.id === household.id;
    return `<div class="cookbook-row ${current ? 'current' : ''}">
      <div class="cookbook-row-copy">
        <strong>${escapeHtml(h.name || 'Our Recipes')}</strong>
        <span>${h.role === 'owner' ? 'Owner' : 'Member'}${current ? ' · Current' : ''}</span>
      </div>
      <button type="button" class="${current ? 'current-cookbook-pill' : 'secondary switch-cookbook-btn'}" data-id="${h.id}" ${current ? 'disabled' : ''}>${current ? 'Current' : 'Switch'}</button>
    </div>`;
  }).join('') || '<p class="settings-copy">No cookbooks found.</p>';

  document.querySelectorAll('.switch-cookbook-btn').forEach(btn => btn.addEventListener('click', () => switchCookbook(btn.dataset.id)));
}

async function activateHousehold(id, page = 'recipes') {
  const next = households.find(h => h.id === id) || households[0];
  if (!next) return;
  household = next;
  localStorage.setItem('our-recipes-active-household', household.id);

  try {
    const cached = JSON.parse(localStorage.getItem(recipeCacheKey(household.id)) || '[]');
    recipes = Array.isArray(cached) ? cached : [];
  } catch {
    recipes = [];
  }

  renderCookbookSettings();
  render();
  navigateTo(page, false);
  await loadRecipes();
}

async function loadHousehold(preferredHouseholdId = null) {
  const { data: memberships, error } = await client
    .from('household_members')
    .select('household_id, role')
    .eq('user_id', session.user.id);

  if (error) throw error;
  if (!memberships?.length) {
    household = null;
    households = [];
    recipes = [];
    showOnly('householdView');
    return;
  }

  const membershipIds = memberships.map(m => m.household_id);
  const roleById = Object.fromEntries(memberships.map(m => [m.household_id, m.role]));
  const { data: rows, error: hError } = await client
    .from('households')
    .select('id, name, join_code')
    .in('id', membershipIds);

  if (hError) throw hError;
  households = (rows || []).map(h => ({ ...h, role: roleById[h.id] || 'member' }));
  if (!households.length) {
    household = null;
    showOnly('householdView');
    return;
  }

  const savedId = localStorage.getItem('our-recipes-active-household');
  const desiredId = [preferredHouseholdId, savedId, household?.id].find(id => id && households.some(h => h.id === id));
  showOnly('appView');
  await activateHousehold(desiredId || households[0].id, 'recipes');
}

async function switchCookbook(id) {
  if (!id || id === household?.id) return;
  setStatus('moreCookbookMessage', 'Switching cookbook…');
  try {
    await activateHousehold(id, 'recipes');
    setStatus('moreCookbookMessage', '');
  } catch (e) {
    setStatus('moreCookbookMessage', e.message || 'Could not switch cookbook.', true);
  }
}

async function loadRecipes() {
  if (!household) return;
  showSync('Syncing recipes…');
  const { data, error } = await client
    .from('recipes')
    .select('*')
    .eq('household_id', household.id)
    .order('created_at', { ascending: false });
  showSync('');
  if (error) throw error;
  recipes = data || [];
  localStorage.setItem(recipeCacheKey(household.id), JSON.stringify(recipes));
  render();
}

async function bootstrap() {
  if (!configured) {
    showOnly('setupView');
    return;
  }

  const { data } = await client.auth.getSession();
  session = data.session;
  if (!session) {
    showOnly('authView');
    return;
  }

  try {
    await loadHousehold();
  } catch (e) {
    console.error(e);
    showOnly('authView');
    setStatus('authMessage', e.message || 'Could not connect to the cookbook.', true);
  }
}

async function signIn(e) {
  e.preventDefault();
  setStatus('authMessage', 'Signing in…');
  const { error } = await client.auth.signInWithPassword({
    email: $('emailInput').value.trim(),
    password: $('passwordInput').value
  });
  if (error) return setStatus('authMessage', error.message, true);
  setStatus('authMessage', '');
}

async function signUp() {
  if (!$('authForm').reportValidity()) return;
  setStatus('authMessage', 'Creating account…');
  const { data, error } = await client.auth.signUp({
    email: $('emailInput').value.trim(),
    password: $('passwordInput').value
  });
  if (error) return setStatus('authMessage', error.message, true);
  if (!data.session) {
    setStatus('authMessage', 'Account created. Check your email to confirm it, then sign in.');
  } else {
    setStatus('authMessage', 'Account created.');
  }
}

async function createHousehold() {
  setStatus('householdMessage', 'Creating your shared cookbook…');
  const { data, error } = await client.rpc('create_household', { p_name: 'Our Recipes' });
  if (error) return setStatus('householdMessage', error.message, true);
  setStatus('householdMessage', '');
  const created = data?.[0];
  await loadHousehold(created?.household_id || null);
  if (created?.join_code) {
    $('inviteCode').textContent = created.join_code;
    $('inviteDialog').showModal();
  }
}

async function joinHouseholdByCode(rawCode, statusId = 'householdMessage') {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) {
    setStatus(statusId, 'Enter the 8-character invite code first.', true);
    return false;
  }
  setStatus(statusId, 'Joining your partner’s cookbook…');
  const { data, error } = await client.rpc('join_household', { p_code: code });
  if (error) {
    setStatus(statusId, error.message, true);
    return false;
  }
  setStatus(statusId, 'Joined. Switching you to the shared cookbook…');
  await loadHousehold(data || null);
  navigateTo('recipes');
  setTimeout(() => setStatus(statusId, ''), 900);
  return true;
}

async function joinHousehold() {
  const ok = await joinHouseholdByCode($('joinCodeInput').value, 'householdMessage');
  if (ok) $('joinCodeInput').value = '';
}

async function joinHouseholdFromMore() {
  const ok = await joinHouseholdByCode($('moreJoinCodeInput').value, 'moreCookbookMessage');
  if (ok) $('moreJoinCodeInput').value = '';
}

async function createAnotherCookbook() {
  const name = $('newCookbookNameInput').value.trim() || 'Our Recipes';
  setStatus('createCookbookMessage', 'Creating cookbook…');
  const { data, error } = await client.rpc('create_household', { p_name: name });
  if (error) return setStatus('createCookbookMessage', error.message, true);
  const created = data?.[0];
  setStatus('createCookbookMessage', 'Created.');
  $('newCookbookNameInput').value = '';
  await loadHousehold(created?.household_id || null);
  if (created?.join_code) {
    $('inviteCode').textContent = created.join_code;
    $('inviteDialog').showModal();
  }
}

function openAdd(mode = 'manual') {
  $('recipeForm').reset();
  setStatus('importLinkStatus', '');
  setStatus('recipeImportNotice', '');
  setVideoProgress('', 4);
  $('videoProgressWrap').classList.add('hidden');
  $('videoTranscriptWrap').classList.add('hidden');
  $('videoOcrDetails').classList.add('hidden');
  setMode(mode);
  $('addDialog').showModal();
  setTimeout(() => $('titleInput').focus(), 100);
}

function setMode(mode) {
  document.querySelectorAll('.mode').forEach(x => x.classList.toggle('active', x.dataset.mode === mode));
  $('linkPanel').classList.toggle('hidden', mode !== 'link');
  $('pastePanel').classList.toggle('hidden', mode !== 'paste');
  $('videoPanel').classList.toggle('hidden', mode !== 'video');
}

async function importFromLink() {
  const rawUrl = $('sourceUrl').value.trim();
  if (!rawUrl) return setStatus('importLinkStatus', 'Paste a recipe link first.', true);

  let parsed;
  try {
    parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    return setStatus('importLinkStatus', 'That does not look like a valid web link.', true);
  }

  setStatus('importLinkStatus', 'Reading the recipe…');
  $('importLinkBtn').disabled = true;
  $('importLinkBtn').textContent = 'Importing…';

  try {
    const token = session?.access_token;
    const response = await fetch(`/api/import-recipe?url=${encodeURIComponent(parsed.toString())}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not import that link.');

    $('sourceUrl').value = data.source_url || parsed.toString();
    if (data.title) $('titleInput').value = data.title;
    if (data.prep_minutes != null) $('prepInput').value = data.prep_minutes;
    if (data.cook_minutes != null) $('cookInput').value = data.cook_minutes;
    if (!data.cook_minutes && !data.prep_minutes && data.total_minutes != null) $('cookInput').value = data.total_minutes;
    if (data.servings != null) $('servingsInput').value = data.servings;
    if (Array.isArray(data.ingredients) && data.ingredients.length) $('ingredientsInput').value = data.ingredients.join('\n');
    if (Array.isArray(data.instructions) && data.instructions.length) $('instructionsInput').value = data.instructions.join('\n');
    if (Array.isArray(data.tags) && data.tags.length) $('tagsInput').value = data.tags.join(', ');
    if (data.notes) $('notesInput').value = data.notes;

    setMode('manual');
    setStatus('importLinkStatus', '');
    setStatus('recipeImportNotice', data.message || 'Recipe imported. Review it before saving.', !!data.partial);
    setTimeout(() => $('titleInput').scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  } catch (e) {
    setStatus('importLinkStatus', e.message || 'Could not import that link.', true);
  } finally {
    $('importLinkBtn').disabled = false;
    $('importLinkBtn').textContent = 'Import recipe from link';
  }
}

let localTranscriber = null;
let localOcrWorker = null;

function setVideoProgress(message, percent = null, isError = false) {
  $('videoProgressWrap').classList.remove('hidden');
  $('videoStatus').textContent = message || '';
  $('videoStatus').classList.toggle('error', isError);
  if (percent != null) $('videoProgressBar').style.width = `${Math.max(4, Math.min(100, percent))}%`;
}

function cleanVideoTitle(name = '') {
  return String(name)
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Video recipe';
}

async function decodeMediaTo16kMono(file) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioCtx || !OfflineCtx) throw new Error('This browser cannot decode video audio locally. Try Chrome/Safari updated to the latest version.');

  const ctx = new AudioCtx();
  try {
    const raw = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    if (!decoded?.duration || decoded.duration < 0.2) throw new Error('No usable audio track was found in that file.');
    if (decoded.duration > 300) throw new Error('For now, keep social recipe videos under 5 minutes so phone memory does not get roasted.');

    const targetRate = 16000;
    const frames = Math.ceil(decoded.duration * targetRate);
    const offline = new OfflineCtx(1, frames, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return { audio: new Float32Array(rendered.getChannelData(0)), duration: decoded.duration };
  } catch (e) {
    if (/decode|EncodingError|Unable to decode/i.test(String(e?.message || e))) {
      throw new Error('I could not read the audio track from this video on your browser. A downloaded MP4 usually works better than some screen-recording formats.');
    }
    throw e;
  } finally {
    try { await ctx.close(); } catch {}
  }
}

async function getLocalTranscriber() {
  if (localTranscriber) return localTranscriber;

  if (!navigator.gpu) {
    throw new Error('Fast local transcription needs WebGPU on this phone. Your browser is not exposing it, and the CPU fallback is intentionally disabled because it can take 10+ minutes. Try the latest Chrome, or use Paste transcript/caption instead.');
  }

  setVideoProgress('Starting GPU transcription engine…', 18);

  // Transformers.js v4 has a newer WebGPU runtime. Keep everything in-browser.
  const mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0');
  const { pipeline, env } = mod;
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const progress_callback = info => {
    if (!info) return;
    const p = Number(info.progress);
    if (Number.isFinite(p)) {
      setVideoProgress(`Downloading higher-accuracy speech model… ${Math.round(p)}%`, 18 + p * 0.30);
    } else if (info.status === 'ready') {
      setVideoProgress('Higher-accuracy speech model ready on GPU.', 50);
    }
  };

  try {
    localTranscriber = await pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-base',
      {
        device: 'webgpu',
        dtype: 'q4',
        progress_callback
      }
    );
    return localTranscriber;
  } catch (e) {
    console.error('WebGPU Whisper failed', e);
    throw new Error('Your browser reported WebGPU, but Whisper could not start on the GPU. I stopped instead of falling back to the very slow CPU mode. Update Chrome and try again, or use Paste transcript/caption for this video.');
  }
}

async function transcribeAudioInChunks(transcriber, audio, duration) {
  // Whisper works naturally on short windows. Doing the splitting ourselves lets the UI
  // show real progress and avoids one giant opaque inference call on mobile.
  const sampleRate = 16000;
  const chunkSeconds = 20;
  const chunkSamples = chunkSeconds * sampleRate;
  const total = Math.max(1, Math.ceil(audio.length / chunkSamples));
  const parts = [];
  const started = performance.now();

  for (let i = 0; i < total; i++) {
    const a = i * chunkSamples;
    const b = Math.min(audio.length, (i + 1) * chunkSamples);
    const chunk = audio.slice(a, b);
    const pct = 52 + Math.round((i / total) * 42);
    const elapsed = (performance.now() - started) / 1000;
    const estimate = i > 0 ? Math.max(0, Math.round((elapsed / i) * (total - i))) : null;
    const eta = estimate != null ? ` · about ${estimate}s left` : '';
    setVideoProgress(`Transcribing part ${i + 1} of ${total} on GPU${eta}`, pct);

    const out = await transcriber(chunk);
    const text = String(out?.text || '').trim();
    if (text) parts.push(text);

    // Yield so Chrome can paint the progress update and stay responsive.
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function waitForEvent(target, event) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, ok);
      target.removeEventListener('error', bad);
    };
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('Could not read frames from this video.')); };
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', bad, { once: true });
  });
}

async function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.05) return;
  video.currentTime = time;
  await waitForEvent(video, 'seeked');
}

function dedupeOcrLines(texts = []) {
  const seen = new Set();
  const out = [];
  for (const block of texts) {
    for (const raw of String(block || '').split(/\n+/)) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (line.length < 3) continue;
      const key = line.toLowerCase().replace(/[^a-z0-9¼½¾⅓⅔]+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out;
}

async function scanVisibleVideoText(file) {
  setVideoProgress('Loading local on-screen text scanner…', 72);
  const { createWorker } = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js');
  if (!localOcrWorker) {
    localOcrWorker = await createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && Number.isFinite(Number(m.progress))) {
          setVideoProgress(`Scanning on-screen text… ${Math.round(Number(m.progress) * 100)}%`, 74 + Number(m.progress) * 20);
        }
      }
    });
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    await waitForEvent(video, 'loadedmetadata');
    const duration = Math.max(1, video.duration || 1);
    const count = Math.min(7, Math.max(3, Math.ceil(duration / 10)));
    const times = Array.from({ length: count }, (_, i) => Math.min(duration - 0.1, Math.max(0, ((i + 0.5) / count) * duration)));
    const canvas = document.createElement('canvas');
    const maxWidth = 720;
    const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth || maxWidth));
    canvas.width = Math.max(1, Math.round((video.videoWidth || maxWidth) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 1280) * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const blocks = [];

    for (let i = 0; i < times.length; i++) {
      setVideoProgress(`Scanning visible text… frame ${i + 1} of ${times.length}`, 74 + (i / times.length) * 20);
      await seekVideo(video, times[i]);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = await localOcrWorker.recognize(canvas);
      if (result?.data?.text) blocks.push(result.data.text);
    }
    return dedupeOcrLines(blocks).join('\n');
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

const SPOKEN_NUMBER = String.raw`(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter)`;
const SPOKEN_UNIT = String.raw`(?:cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|grams?|g|kilograms?|kg|milliliters?|ml|liters?|l|cloves?|cans?|packages?|packets?|pinches?|handfuls?|pieces?|slices?)`;

const COUNTABLE_FOOD = /\b(?:eggs?|onions?|tomatoes?|potatoes?|tortillas?|wraps?|cloves?|peppers?|lemons?|limes?|avocados?|bananas?|apples?|carrots?|chicken\s+breasts?|chicken\s+thighs?|slices?|cans?|packages?|packets?)\b/i;
const NON_INGREDIENT = /\b(?:calories?|protein|carbs?|carbohydrates?|fat|fiber|fibre|daily|days?|hours?|minutes?|seconds?|week|weeks|month|months|servings?|followers?|views?|likes?|rating|stars?|menu|restaurant|selling point|treat|letter|row)\b/i;
const CREATOR_CHATTER = /\b(?:i(?:'|’)ve|i have|i(?:'|’)m|i am|when i|i never|oh my god|as i said|however you say|on the menu|selling point|three days in a row|you can personalize|i tried|i ate|i(?:'|’)ve eaten|my daily|this one is amazing)\b/i;

// Common recipe words used only as a second safety net when the creator says an
// ingredient without giving a quantity. This is intentionally conservative.
const INGREDIENT_TERMS = [
  'tomato sauce','pizza sauce','marinara','soy sauce','hot sauce','fish sauce','barbecue sauce','bbq sauce',
  'olive oil','vegetable oil','sesame oil','butter','ghee','milk','cream','yogurt','yoghurt',
  'mozzarella','parmesan','cheddar','cheese','paneer','tofu',
  'salt','black pepper','pepper','italian seasoning','garlic powder','onion powder','paprika','cumin','turmeric',
  'chili powder','chilli powder','red pepper flakes','oregano','thyme','rosemary','basil','cilantro','coriander','parsley',
  'garlic','onion','tomato','bell pepper','pepper','spinach','mushroom','potato','carrot','corn',
  'chicken','beef','pork','turkey','shrimp','prawn','salmon','tuna','egg','eggs',
  'flour','sugar','brown sugar','rice','pasta','noodles','bread','tortilla','tortillas','dough','broth','stock',
  'lemon juice','lime juice','vinegar','honey','maple syrup','mustard','mayonnaise','mayo'
].sort((a,b) => b.length - a.length);

function narrationSentences(text = '') {
  return String(text)
    .replace(/\r/g, '\n')
    .replace(/\b(?:and then|then|next|now|after that|we(?:'|’)re gonna|we are going to|you(?:'|’)re gonna|you are going to|all you have to do is|let(?:'|’)s)\b/gi, '. ')
    .split(/(?:\n+|(?<=[.!?])\s+)/)
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(x => x.length > 2);
}

function normalizeIngredientCandidate(line = '') {
  return String(line)
    .replace(/^[-•*]\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[,.]+$/, '')
    .trim();
}

function isPlausibleIngredient(line = '') {
  const clean = normalizeIngredientCandidate(line);
  if (clean.length < 2 || clean.length > 90) return false;
  if (NON_INGREDIENT.test(clean)) return false;
  if (CREATOR_CHATTER.test(clean)) return false;
  if (clean.split(/\s+/).length > 13) return false;
  return true;
}

function ingredientTermHits(text = '') {
  const lower = String(text).toLowerCase();
  const hits = [];
  for (const term of INGREDIENT_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(lower)) hits.push(term);
  }
  // Remove shorter terms swallowed by a better match (e.g. sauce inside tomato sauce).
  return hits.filter((x, i) => !hits.some((y, j) => j < i && y.includes(x)));
}

function ingredientCandidatesFromNarration(text = '') {
  const out = [];
  const seen = new Set();
  const add = raw => {
    const clean = normalizeIngredientCandidate(raw);
    if (!isPlausibleIngredient(clean)) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(clean); }
  };

  const linesToCheck = narrationSentences(text);
  const unitAmountRe = new RegExp(`(?:^|\\b)(${SPOKEN_NUMBER})\\s*(?:of\\s+)?(${SPOKEN_UNIT})\\s+(?:of\\s+)?([^.;!?]{2,70})`, 'ig');
  const countAmountRe = new RegExp(`(?:^|\\b)(${SPOKEN_NUMBER})\\s+([^.;!?]{2,45})`, 'ig');

  for (const line of linesToCheck) {
    let m;
    unitAmountRe.lastIndex = 0;
    while ((m = unitAmountRe.exec(line))) {
      let tail = m[3]
        .replace(/\b(?:and|then|before|after|until|into|to the|and cook|and stir|and mix|and fry|and bake|and simmer|and fold|and top)\b.*$/i, '')
        .replace(/^\s*(?:we need|you need|you(?:'|’)ll need|i use|use|using|add|adding|take|start with|with)\s*/i, '')
        .trim();
      add(`${m[1]} ${m[2]} ${tail}`);
    }

    // Quantity without a unit is accepted only for clearly countable food nouns.
    countAmountRe.lastIndex = 0;
    while ((m = countAmountRe.exec(line))) {
      const tail = m[2].replace(/\b(?:and|then|before|after|until|into|to the)\b.*$/i, '').trim();
      if (COUNTABLE_FOOD.test(tail)) add(`${m[1]} ${tail}`);
    }

    // Creators often say "some mozzarella", "add basil", etc. Pull only known
    // culinary terms, never arbitrary nearby words.
    for (const term of ingredientTermHits(line)) add(term);
  }

  // OCR is much cleaner than narration for quantities. Preserve only concise,
  // plausible lines, and reject nutrition/time overlays.
  for (const line of String(text).split(/\n+/)) {
    const clean = normalizeIngredientCandidate(line);
    if (!isPlausibleIngredient(clean)) continue;
    const hasUnitAmount = new RegExp(`^${SPOKEN_NUMBER}\\s*(?:${SPOKEN_UNIT})\\b`, 'i').test(clean);
    const hasCount = new RegExp(`^${SPOKEN_NUMBER}\\s+`, 'i').test(clean) && COUNTABLE_FOOD.test(clean);
    if (hasUnitAmount || hasCount) add(clean);
  }

  return out.slice(0, 40);
}

function cleanInstructionSegment(segment = '') {
  let s = String(segment).replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // Drop commentary after a cooking instruction instead of preserving the creator's story.
  const chatter = s.search(CREATOR_CHATTER);
  if (chatter >= 0) s = s.slice(0, chatter).trim();

  s = s
    .replace(/^\s*(?:so|then|next|now|and|okay|ok|alright)\s*[,.-]?\s*/i, '')
    .replace(/\broller pin\b/gi, 'rolling pin')
    .replace(/\bspreader? out\b/gi, 'spread it out')
    .replace(/\bhand torn\b/gi, 'hand-torn')
    .replace(/\s+/g, ' ')
    .trim();

  // A few safe cooking-specific cleanups turn common ASR rambles into usable steps
  // without inventing quantities.
  if (/rolling pin/i.test(s) && /spread/i.test(s)) {
    s = 'Use a rolling pin to gently spread it into a rounded square.';
  } else if (/pour/i.test(s) && /tomato sauce/i.test(s) && /edge/i.test(s)) {
    s = 'Pour the tomato sauce over one half, keeping it away from the edge.';
  } else if (/^fold it/i.test(s)) {
    s = 'Fold it over.';
  } else if (/flip/i.test(s) && /over/i.test(s)) {
    s = 'Flip it over.';
  } else if (/put the ingredients/i.test(s) && /fold/i.test(s) && /cook/i.test(s)) {
    const time = s.match(/\b\d+\s+minutes?\b/i)?.[0];
    s = `Add the ingredients, fold it over, and cook${time ? ` for ${time}` : ''}.`;
  }

  // Keep instructions readable. A gigantic ASR paragraph is not a recipe step.
  const words = s.split(/\s+/);
  if (words.length > 28) s = words.slice(0, 28).join(' ') + '…';
  return s;
}

function instructionCandidatesFromNarration(text = '') {
  const action = /\b(add|mix|stir|cook|heat|bake|fry|sauté|saute|boil|simmer|pour|combine|chop|dice|slice|season|whisk|blend|roast|air\s*fry|pressure\s*cook|serve|garnish|marinate|fold|toss|drain|preheat|toast|grill|place|transfer|rest|flip|sprinkle|top|reduce|spread|roll|grab)\b/i;
  const seen = new Set();
  const out = [];

  for (const raw of narrationSentences(text)) {
    // If several seasonings are spoken together, recover the seasoning action even
    // when ASR mangles the actual verb.
    const seasonTerms = ingredientTermHits(raw).filter(x => /salt|pepper|seasoning|powder|paprika|cumin|turmeric|oregano|thyme|rosemary/i.test(x));
    if (seasonTerms.length >= 2 && /\bwith\b/i.test(raw)) {
      const pretty = seasonTerms.map(x => x === 'italian seasoning' ? 'Italian seasoning' : x);
      const phrase = pretty.length === 2 ? `${pretty[0]} and ${pretty[1]}` : `${pretty.slice(0,-1).join(', ')}, and ${pretty.at(-1)}`;
      const step = `Season with ${phrase}.`;
      const key = step.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(step); }
    }

    // Split long breathless ASR runs at contrast/reason clauses when possible.
    const pieces = raw.split(/\s+(?:but|because|while)\s+/i);
    for (const piece of pieces) {
      if (!action.test(piece)) continue;
      let clean = cleanInstructionSegment(piece);
      if (!clean || clean.split(/\s+/).length < 3) continue;
      const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
  }
  return out.slice(0, 30);
}

function videoDraftQuality(transcript, ingredients, instructions) {
  let score = 100;
  const t = String(transcript || '');
  if (ingredients.length < 3) score -= 35;
  if (instructions.length < 2) score -= 30;
  if (ingredients.some(x => NON_INGREDIENT.test(x))) score -= 35;
  if (instructions.some(x => x.split(/\s+/).length > 30)) score -= 15;
  if (/\b(?:donkey|letter to|calzoni pocket things|one for treat)\b/i.test(t)) score -= 20;
  return Math.max(0, score);
}

function useVideoTranscriptAsRecipe() {
  const transcript = $('videoTranscript').value.trim();
  const ocr = $('videoOcrText').value.trim();
  if (!transcript && !ocr) return setVideoProgress('There is no transcript or on-screen text to use yet.', 100, true);

  // OCR first because visible ingredient cards are usually more trustworthy than
  // a creator speaking quickly over music.
  const combined = [ocr, transcript].filter(Boolean).join('\n');
  const ingredients = ingredientCandidatesFromNarration(combined);
  const instructions = instructionCandidatesFromNarration(transcript || combined);
  const quality = videoDraftQuality(transcript, ingredients, instructions);

  if (!$('titleInput').value) {
    const file = $('videoFileInput').files?.[0];
    $('titleInput').value = cleanVideoTitle(file?.name || 'Video recipe');
  }
  $('ingredientsInput').value = ingredients.join('\n');
  $('instructionsInput').value = instructions.join('\n');
  if ($('videoSourceUrl').value.trim()) $('sourceUrl').value = $('videoSourceUrl').value.trim();

  // If extraction looks bad, do not silently make it look authoritative.
  setMode('manual');
  if (quality < 55) {
    setStatus(
      'recipeImportNotice',
      'Low-confidence video import. I filtered obvious junk, but the speech recognition is still uncertain. Review the ingredient list and steps before saving; the raw transcript remains available if you go back to Video.',
      true
    );
  } else if (!ingredients.length || !instructions.length) {
    setStatus(
      'recipeImportNotice',
      'Video import is incomplete. Review the draft and fill any missing quantities or steps before saving.',
      true
    );
  } else {
    setStatus(
      'recipeImportNotice',
      'Video turned into a cleaner draft recipe. On-screen text was prioritized for quantities and creator commentary was trimmed. Review before saving.',
      false
    );
  }
}

async function transcribeVideoLocally() {
  const file = $('videoFileInput').files?.[0];
  if (!file) return setVideoProgress('Choose a downloaded or screen-recorded recipe video first.', 100, true);
  if (file.size > 250 * 1024 * 1024) return setVideoProgress('That file is very large. For phone-friendly processing, use a video under about 250 MB.', 100, true);

  $('transcribeVideoBtn').disabled = true;
  $('transcribeVideoBtn').textContent = 'Working locally…';
  $('videoTranscriptWrap').classList.add('hidden');
  $('videoOcrDetails').classList.add('hidden');
  $('videoProgressBar').style.width = '4%';

  try {
    if (!navigator.gpu) {
      throw new Error('Fast local transcription needs WebGPU. This browser is not exposing it, so I stopped instead of making you wait 10+ minutes on CPU. Update Chrome and try again, or use Paste transcript/caption.');
    }

    setVideoProgress('Reading the audio track on this phone…', 7);
    const { audio, duration } = await decodeMediaTo16kMono(file);
    if (duration > 180) throw new Error('For the free phone-local importer, keep videos under 3 minutes. Trim a longer video first.');

    setVideoProgress(`Audio ready (${Math.round(duration)} sec). Loading the GPU speech model…`, 15);
    const transcriber = await getLocalTranscriber();
    setVideoProgress('GPU model ready. Starting transcription…', 52);
    const transcript = await transcribeAudioInChunks(transcriber, audio, duration);
    if (!transcript) throw new Error('The model did not hear usable speech. Check that your screen recording included device audio.');
    $('videoTranscript').value = transcript;

    if ($('scanVideoText').checked && String(file.type).startsWith('video/')) {
      try {
        setVideoProgress('Transcript ready. Scanning a few frames for visible text…', 95);
        const ocr = await scanVisibleVideoText(file);
        $('videoOcrText').value = ocr;
        $('videoOcrDetails').classList.toggle('hidden', !ocr);
      } catch (e) {
        console.warn('OCR scan failed', e);
        $('videoOcrText').value = '';
      }
    } else {
      $('videoOcrText').value = '';
    }

    $('videoTranscriptWrap').classList.remove('hidden');
    setVideoProgress('Transcript ready. Review it, then turn it into a recipe.', 100);
  } catch (e) {
    console.error(e);
    setVideoProgress(e?.message || 'Local transcription failed on this device.', 100, true);
  } finally {
    $('transcribeVideoBtn').disabled = false;
    $('transcribeVideoBtn').textContent = 'Transcribe on this phone';
  }
}


function parsePastedText() {
  const raw = $('pasteText').value.trim();
  if (!raw) return;
  const all = lines(raw);
  if (!$('titleInput').value) $('titleInput').value = all[0]?.slice(0,80) || 'Imported recipe';
  const ingredientGuess = all.filter(x => /^[-•*]?\s*(\d|½|¼|¾|⅓|⅔|one|two|three|cup|tbsp|tsp)/i.test(x)).slice(0,30);
  const instructionGuess = all.filter(x => !ingredientGuess.includes(x) && x !== all[0]).slice(0,30);
  $('ingredientsInput').value = ingredientGuess.join('\n');
  $('instructionsInput').value = instructionGuess.join('\n');
  setMode('manual');
}

async function saveRecipe(e) {
  e.preventDefault();
  const title = $('titleInput').value.trim();
  if (!title || !household) return;

  const payload = {
    household_id: household.id,
    created_by: session.user.id,
    title,
    prep_minutes: $('prepInput').value ? Number($('prepInput').value) : null,
    cook_minutes: $('cookInput').value ? Number($('cookInput').value) : null,
    ingredients: lines($('ingredientsInput').value),
    instructions: lines($('instructionsInput').value),
    tags: tagsWithServings(
      $('tagsInput').value.split(',').map(x => x.trim()).filter(Boolean),
      $('servingsInput').value ? Number($('servingsInput').value) : null
    ),
    notes: $('notesInput').value.trim() || null,
    source_url: $('sourceUrl').value.trim() || null,
    favorite: false
  };

  showSync('Saving recipe…');
  const { error } = await client.from('recipes').insert(payload);
  showSync('');
  if (error) return alert(error.message);
  $('addDialog').close();
  await loadRecipes();
}

function openRecipe(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) return;
  viewingId = id;
  viewServingCount = recipeServings(r);
  $('viewTitle').textContent = r.title;
  $('viewMeta').textContent = timeText(r);
  $('viewTags').innerHTML = visibleTags(r.tags).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('');
  updateServingUI(r);
  $('viewInstructions').innerHTML = (r.instructions || []).map(x => `<li>${escapeHtml(x)}</li>`).join('') || '<li>No instructions added.</li>';
  $('viewNotes').textContent = r.notes || '';
  $('notesSection').classList.toggle('hidden', !r.notes);
  $('viewSource').classList.toggle('hidden', !r.source_url);
  if (r.source_url) $('viewSource').href = r.source_url;
  $('favoriteBtn').textContent = r.favorite ? '♥ Favorited' : '♡ Favorite';
  $('viewDialog').showModal();
}

async function toggleFavorite() {
  const r = recipes.find(x => x.id === viewingId);
  if (!r) return;
  const next = !r.favorite;
  const { error } = await client.from('recipes').update({ favorite: next }).eq('id', r.id);
  if (error) return alert(error.message);
  r.favorite = next;
  render();
  $('favoriteBtn').textContent = next ? '♥ Favorited' : '♡ Favorite';
}

async function deleteRecipe() {
  const r = recipes.find(x => x.id === viewingId);
  if (!r) return;
  if (!confirm(`Delete “${r.title}”?`)) return;
  const { error } = await client.from('recipes').delete().eq('id', r.id);
  if (error) return alert(error.message);
  $('viewDialog').close();
  await loadRecipes();
}

async function signOut() {
  await client.auth.signOut();
  household = null;
  households = [];
  recipes = [];
  showOnly('authView');
}

async function copyInvite(buttonId = 'copyInviteBtn') {
  const code = household?.join_code || $('inviteCode').textContent;
  const button = $(buttonId);
  try {
    await navigator.clipboard.writeText(code);
    if (button) {
      const original = button.textContent;
      button.textContent = 'Copied ✓';
      setTimeout(() => button.textContent = original, 1200);
    }
  } catch {
    alert(`Cookbook code: ${code}`);
  }
}


const ASSISTANT_STOPWORDS = new Set([
  'a','an','and','are','be','can','could','for','from','give','have','i','ideas','in','is','it','make','me','my','of','on','or','our','please','recipe','recipes','show','some','suggest','suggestions','that','the','this','to','us','want','we','what','with','would','you'
]);

const INGREDIENT_NOISE = new Set([
  'cup','cups','tbsp','tablespoon','tablespoons','tsp','teaspoon','teaspoons','oz','ounce','ounces','g','gram','grams','kg','ml','l','lb','lbs','pound','pounds','clove','cloves','slice','slices','piece','pieces','small','medium','large','fresh','chopped','diced','minced','sliced','optional','taste','adjust','finely','roughly','divided'
]);

function normalizeToken(word = '') {
  let w = String(word).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  return w;
}

function meaningfulTokens(text = '', extraStop = null) {
  const stop = extraStop || ASSISTANT_STOPWORDS;
  return String(text).toLowerCase().split(/[^a-z0-9]+/i)
    .map(normalizeToken)
    .filter(w => w && w.length > 1 && !stop.has(w));
}

function normalizedIngredientText(text = '') {
  const tokens = String(text)
    .replace(/[½¼¾⅓⅔⅛⅜⅝⅞\d./-]+/g, ' ')
    .split(/[^a-zA-Z]+/)
    .map(normalizeToken)
    .filter(w => w && w.length > 1 && !INGREDIENT_NOISE.has(w));
  return tokens.join(' ');
}

function ingredientMatches(recipe, wanted) {
  const q = normalizedIngredientText(wanted);
  if (!q) return false;
  const qTokens = q.split(' ').filter(Boolean);
  return (recipe.ingredients || []).some(line => {
    const lineNorm = normalizedIngredientText(line);
    const lineTokens = new Set(lineNorm.split(' ').filter(Boolean));
    if (lineNorm.includes(q) || q.includes(lineNorm)) return true;
    return qTokens.every(t => lineTokens.has(t));
  });
}

function extractWantedIngredients(query = '') {
  const q = query.trim();
  const match = q.match(/(?:\bwith\b|\busing\b|\bi have\b|\bwe have\b|\bgot\b)\s+(.+)/i);
  if (!match) return [];
  let tail = match[1]
    .replace(/\b(?:for|as)\s+(?:lunch|dinner|breakfast|dessert)\b.*$/i, '')
    .replace(/\b(?:this week|tonight|today|tomorrow)\b.*$/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  if (!tail) return [];
  return tail.split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map(x => x.replace(/^(?:some|a|an|the)\s+/i, '').trim())
    .filter(Boolean)
    .slice(0, 10);
}

function requestedCount(query = '') {
  const named = { one:1, two:2, three:3, four:4, five:5, six:6, couple:2, few:3 };
  const m = query.toLowerCase().match(/\b(one|two|three|four|five|six|couple|few|[1-6])\b/);
  if (!m) return /this week/i.test(query) ? 3 : 3;
  return named[m[1]] || Number(m[1]) || 3;
}

function requestedMeal(query = '') {
  const q = query.toLowerCase();
  if (/\bbreakfasts?\b/.test(q)) return 'breakfast';
  if (/\blunch(?:es)?\b/.test(q)) return 'lunch';
  if (/\bdinners?\b|\btonight\b/.test(q)) return 'dinner';
  if (/\bdesserts?\b|\bsweet\b/.test(q)) return 'dessert';
  return null;
}

function requestedTimeLimit(query = '') {
  const q = query.toLowerCase();
  const m = q.match(/(?:under|within|less than|no more than|max(?:imum)?\s*)\s*(\d{1,3})\s*(?:min|mins|minute|minutes)\b/);
  if (m) return Number(m[1]);
  if (/\bquick\b|\bfast\b/.test(q)) return 30;
  return null;
}

function recipeTotalMinutes(r) {
  const values = [r.prep_minutes, r.cook_minutes].map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((a,b) => a+b, 0) : null;
}

function recipeText(r) {
  return [r.title, ...(r.tags || []), ...(r.ingredients || []), ...(r.instructions || []), r.notes || ''].join(' ').toLowerCase();
}

function mealAffinity(r, meal) {
  if (!meal) return 0;
  const tags = (r.tags || []).map(t => String(t).toLowerCase());
  const text = recipeText(r);
  if (tags.some(t => t === meal || t.includes(meal))) return 5;
  if (text.includes(meal)) return 3;

  const title = String(r.title || '').toLowerCase();
  const hints = {
    breakfast: ['oat','pancake','waffle','egg','omelet','toast','smoothie','breakfast'],
    lunch: ['salad','sandwich','wrap','taco','bowl','soup','quesadilla','lunch'],
    dinner: ['curry','pasta','taco','rice','dal','paneer','chicken','stew','pizza','dinner'],
    dessert: ['cake','cookie','brownie','pudding','dessert','sweet','ice cream']
  };
  return (hints[meal] || []).some(x => title.includes(x)) ? 1.5 : 0;
}

function scoreRecipeForPrompt(r, query, ingredients, meal, timeLimit) {
  let score = 0;
  const matchedIngredients = ingredients.filter(i => ingredientMatches(r, i));
  const missingIngredients = ingredients.filter(i => !matchedIngredients.includes(i));
  score += matchedIngredients.length * 8;
  score -= missingIngredients.length * 1.5;
  score += mealAffinity(r, meal);
  if (r.favorite) score += 0.8;

  const total = recipeTotalMinutes(r);
  if (timeLimit != null) {
    if (total != null && total <= timeLimit) score += 4 + Math.max(0, (timeLimit - total) / Math.max(timeLimit, 1));
    else if (total != null) score -= 7;
    else score -= 1;
  }

  const genericTokens = meaningfulTokens(query).filter(t => !['dinner','lunch','breakfast','dessert','week','quick','fast','minute','min','couple','few'].includes(t));
  const titleTokens = new Set(meaningfulTokens(r.title || '', new Set()));
  const tagTokens = new Set(meaningfulTokens((r.tags || []).join(' '), new Set()));
  const full = recipeText(r);
  for (const token of genericTokens) {
    if (titleTokens.has(token)) score += 2.5;
    else if (tagTokens.has(token)) score += 2;
    else if (full.includes(token)) score += .4;
  }

  return { recipe: r, score, matchedIngredients, missingIngredients, total };
}

function reasonForPick(scored, { ingredients, meal, timeLimit }) {
  const r = scored.recipe;
  const bits = [];
  if (ingredients.length) {
    if (scored.matchedIngredients.length === ingredients.length) bits.push(`uses all ${ingredients.length} ingredients you listed`);
    else if (scored.matchedIngredients.length) bits.push(`uses ${scored.matchedIngredients.join(', ')}`);
  }
  if (meal && mealAffinity(r, meal) >= 3) bits.push(`saved as ${meal}`);
  if (timeLimit != null && scored.total != null && scored.total <= timeLimit) bits.push(`${scored.total} min total`);
  else if (scored.total != null) bits.push(`${scored.total} min total`);
  if (r.favorite) bits.push('one of your favorites');
  if (!bits.length && (r.tags || []).length) bits.push((r.tags || []).slice(0,2).join(' · '));
  return bits.length ? bits.join(' • ') : 'from your saved cookbook';
}

function assistantSummary(query, picks, ingredients, meal, timeLimit) {
  if (!picks.length) return 'I could not find a good match in your saved recipes yet.';
  if (ingredients.length) {
    const best = picks[0];
    const count = best.matchedIngredients.length;
    return count === ingredients.length
      ? `Best matches using ${ingredients.join(', ')}.`
      : `Closest matches from your cookbook. The top result uses ${count} of ${ingredients.length} ingredients you listed.`;
  }
  if (meal && timeLimit) return `Saved ${meal} ideas that best fit your ${timeLimit}-minute limit.`;
  if (meal) return `A few ${meal} ideas from your own recipe collection.`;
  if (/surprise/i.test(query)) return 'A little cookbook roulette, using recipes you already saved.';
  return 'Best matches from your saved cookbook.';
}

function runCookbookAssistant(query) {
  const clean = String(query || '').trim();
  if (!clean) return;
  const resultsEl = $('assistantResults');
  if (!recipes.length) {
    resultsEl.innerHTML = '<p class="assistant-empty">Add a few recipes first and I’ll have something to work with.</p>';
    resultsEl.classList.remove('hidden');
    return;
  }

  const count = Math.min(requestedCount(clean), 6);
  const meal = requestedMeal(clean);
  const timeLimit = requestedTimeLimit(clean);
  const ingredients = extractWantedIngredients(clean);
  let scored = recipes.map(r => scoreRecipeForPrompt(r, clean, ingredients, meal, timeLimit));

  if (timeLimit != null) {
    const within = scored.filter(x => x.total != null && x.total <= timeLimit);
    if (within.length >= Math.min(count, 2)) scored = within;
  }

  if (meal) {
    const explicitMeal = scored.filter(x => mealAffinity(x.recipe, meal) >= 3);
    if (explicitMeal.length) scored = explicitMeal;
  }

  if (ingredients.length) {
    const matching = scored.filter(x => x.matchedIngredients.length > 0);
    if (matching.length) scored = matching;
  }

  if (/\bfavorites?\b/i.test(clean)) {
    const favs = scored.filter(x => x.recipe.favorite);
    if (favs.length) scored = favs;
  }

  scored.sort((a,b) => b.score - a.score || (b.recipe.favorite ? 1 : 0) - (a.recipe.favorite ? 1 : 0) || String(a.recipe.title).localeCompare(String(b.recipe.title)));

  // For a surprise request, rotate the sorted list using today's date so it changes over time without any paid API.
  if (/\bsurprise\b/i.test(clean) && scored.length > count) {
    const seed = Number(new Date().toISOString().slice(0,10).replace(/-/g,''));
    const offset = seed % scored.length;
    scored = scored.slice(offset).concat(scored.slice(0, offset));
  }

  const picks = scored.slice(0, count);
  const context = { ingredients, meal, timeLimit };
  resultsEl.innerHTML = `
    <p class="assistant-summary">${escapeHtml(assistantSummary(clean, picks, ingredients, meal, timeLimit))}</p>
    <div class="assistant-result-list">
      ${picks.map(x => `
        <button type="button" class="assistant-result" data-id="${x.recipe.id}">
          <span class="assistant-result-top">
            <span class="assistant-result-title">${escapeHtml(x.recipe.title)}</span>
            <span class="assistant-result-time">${escapeHtml(timeText(x.recipe))}</span>
          </span>
          <span class="assistant-result-reason">${escapeHtml(reasonForPick(x, context))}</span>
        </button>`).join('')}
    </div>`;
  resultsEl.classList.remove('hidden');
  resultsEl.querySelectorAll('.assistant-result').forEach(el => el.addEventListener('click', () => openRecipe(el.dataset.id)));
}

function askCookbook(e) {
  e?.preventDefault();
  runCookbookAssistant($('assistantInput').value);
}

function wireEvents() {
  $('authForm').addEventListener('submit', signIn);
  $('signUpBtn').addEventListener('click', signUp);
  $('createHouseholdBtn').addEventListener('click', createHousehold);
  $('joinHouseholdBtn').addEventListener('click', joinHousehold);
  $('householdSignOutBtn').addEventListener('click', signOut);
  $('signOutBtn').addEventListener('click', signOut);
  $('recipeForm').addEventListener('submit', saveRecipe);
  $('favoriteBtn').addEventListener('click', toggleFavorite);
  $('deleteBtn').addEventListener('click', deleteRecipe);
  $('searchInput').addEventListener('input', render);
  $('assistantForm').addEventListener('submit', askCookbook);
  document.querySelectorAll('.assistant-prompt').forEach(btn => btn.addEventListener('click', () => {
    $('assistantInput').value = btn.dataset.prompt;
    runCookbookAssistant(btn.dataset.prompt);
  }));
  $('filterFavBtn').addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    $('filterFavBtn').textContent = favoritesOnly ? '♥ Favorites' : '♡ Favorites';
    render();
  });
  document.querySelectorAll('.chip[data-filter]').forEach(c => c.addEventListener('click', () => {
    activeTag = c.dataset.filter;
    document.querySelectorAll('.chip[data-filter]').forEach(x => x.classList.toggle('active', x === c));
    render();
  }));
  document.querySelectorAll('.mode').forEach(m => m.addEventListener('click', () => setMode(m.dataset.mode)));
  $('parsePasteBtn').addEventListener('click', parsePastedText);
  $('importLinkBtn').addEventListener('click', importFromLink);
  $('transcribeVideoBtn').addEventListener('click', transcribeVideoLocally);
  $('useVideoTranscriptBtn').addEventListener('click', useVideoTranscriptAsRecipe);
  $('emptyAddBtn').addEventListener('click', () => openAdd());
  $('closeDialog').addEventListener('click', () => $('addDialog').close());
  $('closeView').addEventListener('click', () => $('viewDialog').close());
  $('closeInvite').addEventListener('click', () => $('inviteDialog').close());
  $('copyInviteBtn').addEventListener('click', () => copyInvite('copyInviteBtn'));
  $('moreCopyCodeBtn').addEventListener('click', () => copyInvite('moreCopyCodeBtn'));
  $('moreJoinCookbookBtn').addEventListener('click', joinHouseholdFromMore);
  $('createAnotherCookbookBtn').addEventListener('click', createAnotherCookbook);
  $('recipesNavBtn').addEventListener('click', () => navigateTo('recipes'));
  $('askNavBtn').addEventListener('click', () => navigateTo('ask'));
  $('moreNavBtn').addEventListener('click', () => navigateTo('more'));
  $('addNavBtn').addEventListener('click', () => openAdd());
  $('servingMinus').addEventListener('click', () => changeViewServings(-1));
  $('servingPlus').addEventListener('click', () => changeViewServings(1));
  $('servingNumber').addEventListener('change', e => setViewServings(e.target.value));
  $('servingReset').addEventListener('click', () => {
    const r = recipes.find(x => x.id === viewingId);
    viewServingCount = recipeServings(r);
    if (r) updateServingUI(r);
  });
  $('setBaseServingsBtn').addEventListener('click', setOriginalServings);

  if (client) {
    client.auth.onAuthStateChange(async (_event, newSession) => {
      const wasSignedIn = !!session;
      session = newSession;
      if (!newSession) {
        household = null;
        households = [];
        recipes = [];
        showOnly('authView');
      } else if (!wasSignedIn) {
        try { await loadHousehold(); } catch (e) { setStatus('authMessage', e.message, true); }
      }
    });
  }
}

wireEvents();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
bootstrap();
