import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// =========================================================================
// GATHERING THE MAGIC — vertical-slice prototype
// Pokemon-style overworld + turn-based duels with MTG-inspired creatures
// All creatures are original designs inspired by MTG's 5-color mana wheel.
// =========================================================================

// ---------- Color wheel ----------
const COLOR_HEX = { W: '#f3e3a8', U: '#6cb8e0', B: '#8a7a92', R: '#e06d5a', G: '#6fb06f' };
const COLOR_DEEP = { W: '#a8923f', U: '#235b82', B: '#2b1e31', R: '#8a2a1e', G: '#2e5c30' };
const COLOR_NAME = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
// Directional wheel: cycle W → U → B → R → G → (back to W). Each color beats the two
// that follow it, and loses to the two that precede it. This gives every matchup
// a clear winner (no reciprocal wins).
const STRONG_VS = {
  W: ['U', 'B'],
  U: ['B', 'R'],
  B: ['R', 'G'],
  R: ['G', 'W'],
  G: ['W', 'U'],
};
// Inverse of STRONG_VS: the two colors that beat you.
const WEAK_TO = {
  W: ['R', 'G'],
  U: ['G', 'W'],
  B: ['W', 'U'],
  R: ['U', 'B'],
  G: ['B', 'R'],
};

// ---------- Multi-color support ----------
// A creature's color identity is stored as a string like 'W', 'UB', 'WUBRG', etc.
// Each character is one of W/U/B/R/G. Helper functions treat this as a list.

// Returns an array of single-color chars from an identity string.
function colorsOf(id) {
  if (!id) return [];
  return id.split('');
}
// Primary color is the first char — used for single-color fallbacks (stat calc, sprite base).
function primaryColor(id) {
  return id ? id[0] : 'W';
}
// True if identityA's colors are all contained in identityB (subset check).
// Used for Commander's color-identity rule: creature's colors must be a subset of commander's.
function isSubsetIdentity(creatureId, commanderId) {
  const cmdr = new Set(colorsOf(commanderId));
  return colorsOf(creatureId).every(c => cmdr.has(c));
}
// For multi-color matchup: compute the single best multiplier across the defender's colors.
// If ANY of the defender's colors is strong-vs'd by the move, use 1.5. If ALL are weak-to, use 0.7.
// For mixed (some strong, some weak), take the average of relevant effects.
function matchupMultiplier(moveColor, defenderIdentity) {
  if (!moveColor) return 1;
  const defColors = colorsOf(defenderIdentity);
  if (defColors.length === 0) return 1;
  let sum = 0;
  for (const dc of defColors) {
    if (STRONG_VS[moveColor]?.includes(dc)) sum += 1.5;
    else if (WEAK_TO[moveColor]?.includes(dc)) sum += 0.7;
    else sum += 1.0;
  }
  return sum / defColors.length;
}
// Strong-vs list for a color identity: union of what each of our colors beats, minus our own colors.
// For multi-color creatures, a color may appear in both strongVs and weakTo lists — that's accurate
// (e.g., a W/U creature vs a Red attacker: R beats W but W/U has nuance against R).
function strongVsList(identity) {
  const ours = new Set(colorsOf(identity));
  const strong = new Set();
  for (const c of ours) {
    for (const s of STRONG_VS[c] || []) strong.add(s);
  }
  for (const c of ours) strong.delete(c);
  return [...strong];
}
function weakToList(identity) {
  const ours = new Set(colorsOf(identity));
  const weak = new Set();
  for (const c of ours) {
    for (const w of WEAK_TO[c] || []) weak.add(w);
  }
  for (const c of ours) weak.delete(c);
  return [...weak];
}

// ---------- Moves ----------
const MOVES = {
  tackle:         { name: 'Tackle',         c: null, p: 6,  a: 100 },
  smite:          { name: 'Smite',          c: 'W',  p: 9,  a: 95 },
  divine_light:   { name: 'Divine Light',   c: 'W',  p: 12, a: 85, status: { kind: 'stun', chance: 20 } },
  mend:           { name: 'Mend',           c: 'W',  p: 0,  a: 100, heal: 0.35 },
  wrath:          { name: 'Wrath',          c: 'W',  p: 16, a: 75, status: { kind: 'stun', chance: 30 } },
  tide_slap:      { name: 'Tide Slap',      c: 'U',  p: 9,  a: 95 },
  mind_wrack:     { name: 'Mind Wrack',     c: 'U',  p: 11, a: 90, status: { kind: 'freeze', chance: 15 } },
  counterspell:   { name: 'Counterspell',   c: 'U',  p: 14, a: 75 },
  whirlpool:      { name: 'Whirlpool',      c: 'U',  p: 16, a: 75, status: { kind: 'freeze', chance: 30 } },
  drain_life:     { name: 'Drain Life',     c: 'B',  p: 9,  a: 90, drain: 0.5 },
  dark_bite:      { name: 'Dark Bite',      c: 'B',  p: 10, a: 90, status: { kind: 'poison', chance: 25 } },
  terror:         { name: 'Terror',         c: 'B',  p: 15, a: 70 },
  oblivion:       { name: 'Oblivion',       c: 'B',  p: 17, a: 70, status: { kind: 'poison', chance: 40 } },
  ember:          { name: 'Ember',          c: 'R',  p: 9,  a: 95, status: { kind: 'burn', chance: 20 } },
  fireball:       { name: 'Fireball',       c: 'R',  p: 14, a: 80, status: { kind: 'burn', chance: 25 } },
  lightning_bolt: { name: 'Lightning Bolt', c: 'R',  p: 12, a: 90 },
  inferno:        { name: 'Inferno',        c: 'R',  p: 17, a: 70, status: { kind: 'burn', chance: 50 } },
  thorn_lash:     { name: 'Thorn Lash',     c: 'G',  p: 9,  a: 95, status: { kind: 'entangle', chance: 25 } },
  trample:        { name: 'Trample',        c: 'G',  p: 13, a: 85 },
  natures_might:  { name: "Nature's Might", c: 'G',  p: 16, a: 70, status: { kind: 'entangle', chance: 40 } },
  wildgrowth:     { name: 'Wildgrowth',     c: 'G',  p: 0,  a: 100, heal: 0.5 },
  // ---- Legendary boss signature moves (used by mono-color bosses inside their shrines) ----
  celestial_judgment: { name: 'Celestial Judgment', c: 'W', p: 22, a: 90, status: { kind: 'stun', chance: 30 } },
  sunken_tempest:     { name: 'Sunken Tempest',     c: 'U', p: 22, a: 85, status: { kind: 'freeze', chance: 35 } },
  soul_reap:          { name: 'Soul Reap',          c: 'B', p: 23, a: 80, drain: 0.5 },
  dragons_wrath:      { name: "Dragon's Wrath",     c: 'R', p: 24, a: 80, status: { kind: 'burn', chance: 45 } },
  world_crush:        { name: 'World Crush',        c: 'G', p: 25, a: 85, status: { kind: 'entangle', chance: 50 } },
  // ---- Planeswalker (final boss) signature ----
  spark_burst:        { name: 'Spark Burst',        c: null, p: 20, a: 100 },
  planar_collapse:    { name: 'Planar Collapse',    c: null, p: 28, a: 75 },
};

// ---------- Creature index (the "Codex") ----------
const DEX = {
  plains_acolyte:  { name: 'Plains Acolyte',  c: 'W', t: 'Human Cleric', hp: 22, atk: 6,  m: ['smite','mend'], evo: { to: 'aven_sentinel', at: 6 }, learnset: { 8: 'divine_light' } },
  aven_sentinel:   { name: 'Aven Sentinel',   c: 'W', t: 'Bird Soldier', hp: 28, atk: 9,  m: ['divine_light','mend'], evo: { to: 'radiant_seraph', at: 7 }, learnset: { 8: 'smite' } },
  radiant_seraph:  { name: 'Radiant Seraph',  c: 'W', t: 'Angel',        hp: 38, atk: 12, m: ['divine_light','mend'], learnset: { 8: 'wrath' } },
  tideling:        { name: 'Tideling',        c: 'U', t: 'Merfolk',      hp: 22, atk: 7,  m: ['tide_slap','mind_wrack'], evo: { to: 'storm_leviathan', at: 6 }, learnset: { 8: 'counterspell' } },
  phantom_sprite:  { name: 'Phantom Sprite',  c: 'U', t: 'Spirit',       hp: 24, atk: 9,  m: ['mind_wrack','counterspell'], learnset: { 8: 'tide_slap' } },
  storm_leviathan: { name: 'Storm Leviathan', c: 'U', t: 'Leviathan',    hp: 42, atk: 11, m: ['tide_slap','counterspell'], learnset: { 8: 'whirlpool' } },
  shade_whelp:     { name: 'Shade Whelp',     c: 'B', t: 'Shade',        hp: 24, atk: 7,  m: ['drain_life','dark_bite'], evo: { to: 'nightfall_wraith', at: 6 }, learnset: { 8: 'terror' } },
  blood_imp:       { name: 'Blood Imp',       c: 'B', t: 'Imp',          hp: 22, atk: 9,  m: ['drain_life','terror'], learnset: { 8: 'dark_bite' } },
  nightfall_wraith:{ name: 'Nightfall Wraith',c: 'B', t: 'Wraith',       hp: 36, atk: 11, m: ['dark_bite','terror'], learnset: { 8: 'oblivion' } },
  emberkin:        { name: 'Emberkin',        c: 'R', t: 'Elemental',    hp: 21, atk: 8,  m: ['ember','lightning_bolt'], evo: { to: 'cinder_drake', at: 6 }, learnset: { 8: 'fireball' } },
  goblin_raider:   { name: 'Goblin Raider',   c: 'R', t: 'Goblin',       hp: 23, atk: 9,  m: ['ember','fireball'], learnset: { 8: 'lightning_bolt' } },
  cinder_drake:    { name: 'Cinder Drake',    c: 'R', t: 'Dragon',       hp: 34, atk: 12, m: ['fireball','lightning_bolt'], learnset: { 8: 'inferno' } },
  forest_runt:     { name: 'Forest Runt',     c: 'G', t: 'Beast',        hp: 26, atk: 6,  m: ['thorn_lash','tackle'], evo: { to: 'grove_wurm', at: 6 }, learnset: { 8: 'trample' } },
  elfling_scout:   { name: 'Elfling Scout',   c: 'G', t: 'Elf Scout',    hp: 25, atk: 8,  m: ['thorn_lash','trample'], learnset: { 8: 'tackle' } },
  grove_wurm:      { name: 'Grove Wurm',      c: 'G', t: 'Wurm',         hp: 44, atk: 11, m: ['trample','natures_might'], learnset: { 8: 'wildgrowth' } },

  // ---- Two-color creatures (10 guild pairs) ----
  skybinder:       { name: 'Skybinder',        c: 'WU', t: 'Azorius Sage',   hp: 30, atk: 9,  m: ['divine_light','counterspell'], learnset: { 10: 'mend' } },
  mind_reaver:     { name: 'Mind Reaver',      c: 'UB', t: 'Dimir Agent',    hp: 28, atk: 10, m: ['mind_wrack','drain_life'], learnset: { 10: 'terror' } },
  hellraiser:      { name: 'Hellraiser',       c: 'BR', t: 'Rakdos Cultist', hp: 30, atk: 11, m: ['dark_bite','fireball'], learnset: { 10: 'oblivion' } },
  warbeast:        { name: 'Warbeast',         c: 'RG', t: 'Gruul Brute',    hp: 34, atk: 11, m: ['ember','trample'], learnset: { 10: 'natures_might' } },
  verdant_paladin: { name: 'Verdant Paladin',  c: 'GW', t: 'Selesnya Knight',hp: 34, atk: 10, m: ['thorn_lash','smite'], learnset: { 10: 'wildgrowth' } },
  grim_priest:     { name: 'Grim Priest',      c: 'WB', t: 'Orzhov Acolyte', hp: 30, atk: 9,  m: ['mend','drain_life'], learnset: { 10: 'divine_light' } },
  stormwright:     { name: 'Stormwright',      c: 'UR', t: 'Izzet Mage',     hp: 28, atk: 10, m: ['mind_wrack','lightning_bolt'], learnset: { 10: 'fireball' } },
  fungal_creeper:  { name: 'Fungal Creeper',   c: 'BG', t: 'Golgari Horror', hp: 34, atk: 10, m: ['drain_life','thorn_lash'], learnset: { 10: 'dark_bite' } },
  blazing_knight:  { name: 'Blazing Knight',   c: 'RW', t: 'Boros Legion',   hp: 32, atk: 11, m: ['fireball','smite'], learnset: { 10: 'ember' } },
  reef_prowler:    { name: 'Reef Prowler',     c: 'GU', t: 'Simic Hybrid',   hp: 30, atk: 10, m: ['thorn_lash','tide_slap'], learnset: { 10: 'counterspell' } },

  // ---- Three-color: Shards (allied colors flowing on the wheel) ----
  arcane_sphinx:   { name: 'Arcane Sphinx',    c: 'WUB', t: 'Esper Sphinx',    hp: 36, atk: 11, m: ['divine_light','mind_wrack','drain_life'], learnset: { 12: 'oblivion' } },
  void_lich:       { name: 'Void Lich',        c: 'UBR', t: 'Grixis Necromancer', hp: 34, atk: 12, m: ['mind_wrack','dark_bite','fireball'], learnset: { 12: 'terror' } },
  apex_predator:   { name: 'Apex Predator',    c: 'BRG', t: 'Jund Beast',      hp: 38, atk: 13, m: ['dark_bite','ember','trample'], learnset: { 12: 'natures_might' } },
  blooming_titan:  { name: 'Blooming Titan',   c: 'RGW', t: 'Naya Behemoth',   hp: 42, atk: 12, m: ['ember','thorn_lash','smite'], learnset: { 12: 'inferno' } },
  silver_pegasus:  { name: 'Silver Pegasus',   c: 'GWU', t: 'Bant Knight',     hp: 36, atk: 11, m: ['thorn_lash','divine_light','tide_slap'], learnset: { 12: 'mend' } },

  // ---- Three-color: Wedges (a color flanked by its two enemies) ----
  abzan_warden:    { name: 'Abzan Warden',     c: 'WBG', t: 'Abzan Champion',  hp: 40, atk: 11, m: ['smite','drain_life','thorn_lash'], learnset: { 12: 'wildgrowth' } },
  jeskai_monk:     { name: 'Jeskai Monk',      c: 'URW', t: 'Jeskai Ascetic',  hp: 32, atk: 12, m: ['mind_wrack','fireball','smite'], learnset: { 12: 'whirlpool' } },
  sultai_assassin: { name: 'Sultai Assassin',  c: 'BGU', t: 'Sultai Slayer',   hp: 34, atk: 12, m: ['drain_life','thorn_lash','mind_wrack'], learnset: { 12: 'dark_bite' } },
  mardu_warlord:   { name: 'Mardu Warlord',    c: 'RWB', t: 'Mardu Raider',    hp: 38, atk: 13, m: ['fireball','smite','dark_bite'], learnset: { 12: 'ember' } },
  temur_shaman:    { name: 'Temur Shaman',     c: 'GUR', t: 'Temur Mystic',    hp: 36, atk: 12, m: ['thorn_lash','tide_slap','ember'], learnset: { 12: 'lightning_bolt' } },

  // ---- Four-color (named after color excluded) ----
  yore_tiller:     { name: 'Yore-Tiller Nephilim', c: 'WUBR', t: 'Nephilim',   hp: 44, atk: 13, m: ['divine_light','mind_wrack','drain_life','fireball'], learnset: { 14: 'wrath' } },
  glint_eye:       { name: 'Glint-Eye Nephilim',   c: 'UBRG', t: 'Nephilim',   hp: 42, atk: 13, m: ['mind_wrack','dark_bite','fireball','thorn_lash'], learnset: { 14: 'whirlpool' } },
  dune_brood:      { name: 'Dune-Brood Nephilim',  c: 'BRGW', t: 'Nephilim',   hp: 46, atk: 14, m: ['dark_bite','fireball','thorn_lash','smite'], learnset: { 14: 'oblivion' } },
  ink_treader:     { name: 'Ink-Treader Nephilim', c: 'RGWU', t: 'Nephilim',   hp: 42, atk: 13, m: ['ember','thorn_lash','smite','tide_slap'], learnset: { 14: 'inferno' } },
  witch_maw:       { name: 'Witch-Maw Nephilim',   c: 'GWUB', t: 'Nephilim',   hp: 44, atk: 13, m: ['thorn_lash','smite','tide_slap','dark_bite'], learnset: { 14: 'wildgrowth' } },

  // ---- Five-color commander (easy mode) ----
  prismatic_avatar:{ name: 'Prismatic Avatar', c: 'WUBRG', t: 'Avatar',      hp: 38, atk: 10, m: ['smite','tide_slap','drain_life','ember','thorn_lash'], learnset: {} },

  // ---- Legendary shrine bosses (mono-color, much higher base stats than normal creatures) ----
  // These never appear in wild pools — they're spawned only inside their respective shrines.
  // Stats roughly 2x a final-stage normal mono creature, plus a signature legendary move.
  vigil_avatar:    { name: 'Vigil, Angelic Avatar',  c: 'W', t: 'Legendary Angel',     hp: 78,  atk: 19, m: ['celestial_judgment','divine_light','wrath','mend'], learnset: {} },
  tidewarden:      { name: 'Tidewarden Colossus',    c: 'U', t: 'Legendary Leviathan', hp: 84,  atk: 18, m: ['sunken_tempest','whirlpool','counterspell','mind_wrack'], learnset: {} },
  voidlord:        { name: "Voidlord Bel'arrak",     c: 'B', t: 'Legendary Demon',     hp: 80,  atk: 20, m: ['soul_reap','oblivion','terror','drain_life'], learnset: {} },
  pyreclaw:        { name: 'Pyreclaw the Eternal',   c: 'R', t: 'Legendary Dragon',    hp: 86,  atk: 21, m: ['dragons_wrath','inferno','lightning_bolt','fireball'], learnset: {} },
  patriarch_wurm:  { name: 'Verdant Patriarch',      c: 'G', t: 'Legendary Wurm',      hp: 92,  atk: 22, m: ['world_crush','natures_might','trample','wildgrowth'], learnset: {} },

  // ---- Final boss (Planeswalker) — WUBRG, the ultimate challenge ----
  // Its kit pulls one signature attack from each color shrine, plus its own planar specials.
  the_planeswalker: { name: 'The Planeswalker',      c: 'WUBRG', t: 'Legendary Avatar', hp: 130, atk: 24, m: ['planar_collapse','spark_burst','dragons_wrath','sunken_tempest'], learnset: {} },
};

// ---------- Encounter pool for wilds ----------
// ---------- Wild encounter pools (per-zone, color-biased) ----------
// Each zone has a primary color. The pool only includes creatures whose color identity
// contains that color. Weights are scaled by how many colors the creature has:
//   mono = 50% share, 2-color = 30%, 3-color = 12%, 4-color = 5%, 5-color = 3%.
// Levels are scaled by zone difficulty.
const ZONE_COLOR = {
  wilds:   'G', // easiest
  sanctum: 'U',
  ashen:   'R',
  umbral:  'B',
  plains:  'W', // hardest
};
const ZONE_LEVEL = {
  wilds:   [2, 6],
  sanctum: [6, 10],
  ashen:   [5, 9],
  umbral:  [8, 12],
  plains:  [10, 14],
};
// Per-color-count weights, tuned so that after normalization within a typical zone pool
// we land near the target distribution: ~50% mono, ~30% two-color, ~12% three-color,
// ~5% four-color, ~3% five-color.
const COLOR_COUNT_WEIGHT = { 1: 100, 2: 38, 3: 10, 4: 4, 5: 0 };
// Wilds is the starter zone — players need approachable mono-color encounters early on.
// Multi-color is much rarer here so the player can build a base team without facing
// dual/tri-color foes constantly.
const WILDS_COLOR_WEIGHT = { 1: 100, 2: 18, 3: 4, 4: 1, 5: 0 };

// ---------- Legendary shrine data ----------
// Each zone has one boss building, themed to the zone's color.
// Buildings are entered by walking onto the building's entrance tile (after the gate is unlocked).
// Boss difficulty is INVERSE to the zone's normal difficulty:
//   - Plains is the hardest zone for normal play, but its legendary (Vigil) is the easiest boss.
//   - Wilds is the easiest zone, but its legendary (Patriarch Wurm) is the hardest boss.
// Levels are tuned so each legendary is ~5+ levels above its zone's wild trainer, ramping up.
const SHRINE_DATA = {
  wilds:   { mapId: 'shrine_green', label: 'Earthen Burrow',    color: 'G', bossId: 'patriarch_wurm', bossLv: 27, dialog: "A spiral tunnel descends into rooty dark. Something colossal stirs within." },
  sanctum: { mapId: 'shrine_blue',  label: 'Tidehut Sanctum',   color: 'U', bossId: 'tidewarden',     bossLv: 25, dialog: "A small reed hut on a sunken islet. The water around it pulses, alive." },
  ashen:   { mapId: 'shrine_red',   label: 'Cinder Cave',       color: 'R', bossId: 'pyreclaw',       bossLv: 23, dialog: "A maw of obsidian. Heat washes over you in slow, patient breaths." },
  umbral:  { mapId: 'shrine_black', label: 'Withered Shack',    color: 'B', bossId: 'voidlord',       bossLv: 21, dialog: "A leaning shack. The door is open. The dark inside has weight." },
  plains:  { mapId: 'shrine_white', label: 'Heavenly Gates',    color: 'W', bossId: 'vigil_avatar',   bossLv: 19, dialog: "A pair of marble gates inscribed with old script. Light pours through the seams." },
};
// Reverse lookup: which zone an interior map belongs to (for exit transitions).
const SHRINE_TO_ZONE = {};
for (const [zone, data] of Object.entries(SHRINE_DATA)) SHRINE_TO_ZONE[data.mapId] = zone;
// Set of all legendary creature ids — used to skip them in wild encounters and to detect boss fights.
const LEGENDARY_IDS = new Set(['vigil_avatar','tidewarden','voidlord','pyreclaw','patriarch_wurm','the_planeswalker']);

function buildZonePool(zoneId) {
  const col = ZONE_COLOR[zoneId];
  const [lvLo, lvHi] = ZONE_LEVEL[zoneId];
  const weights = zoneId === 'wilds' ? WILDS_COLOR_WEIGHT : COLOR_COUNT_WEIGHT;
  const evolvedForms = new Set();
  for (const d of Object.values(DEX)) {
    if (d.evo?.to) evolvedForms.add(d.evo.to);
  }
  const pool = [];
  for (const [id, d] of Object.entries(DEX)) {
    if (evolvedForms.has(id)) continue;
    if (LEGENDARY_IDS.has(id)) continue;     // legendaries never spawn in the wild
    const cols = colorsOf(d.c);
    if (!cols.includes(col)) continue;
    if (cols.length >= 5) continue;
    const w = weights[cols.length] || 1;
    pool.push({ id, lv: [lvLo, lvHi], w });
  }
  return pool;
}
const ZONE_POOLS = {
  wilds:   buildZonePool('wilds'),
  sanctum: buildZonePool('sanctum'),
  ashen:   buildZonePool('ashen'),
  umbral:  buildZonePool('umbral'),
  plains:  buildZonePool('plains'),
};

// ---------- Items ----------
// kind: 'heal' (restores HP), 'revive' (restores fainted), 'card' (adds catch tokens)
const ITEMS = {
  potion: {
    name: 'Minor Potion', kind: 'heal', amount: 15, price: 30,
    desc: 'Restores 15 HP to one creature.', icon: '♥',
  },
  elixir: {
    name: 'Elixir', kind: 'heal', amount: 40, price: 80,
    desc: 'Restores 40 HP to one creature.', icon: '♥',
  },
  fullheal: {
    name: 'Full Heal', kind: 'heal', amount: 999, price: 160,
    desc: 'Fully restores one creature.', icon: '✚',
  },
  revive: {
    name: 'Revive', kind: 'revive', amount: 0.5, price: 150,
    desc: 'Restores a fainted creature to 50% HP.', icon: '✦',
  },
  card: {
    name: 'Creature Card', kind: 'card', amount: 1, price: 40,
    desc: 'Bind a wild creature to your team.', icon: '◆',
  },
};
// Shop keeps a fixed stock order (display only)
const SHOP_STOCK = ['potion', 'elixir', 'fullheal', 'revive', 'card'];

// ---------- Status effects ----------
// Each status has an icon, a tint for the card badge, and an `onTurnEnd` or `onTurnStart` hook.
// Applied statuses live on the creature as `creature.status = { kind, turns }`.
const STATUSES = {
  burn:     { name: 'Burn',     icon: '🔥', color: '#e06d5a', c: 'R',
    desc: 'Takes damage at end of turn.' },
  freeze:   { name: 'Freeze',   icon: '❄',  color: '#6cb8e0', c: 'U',
    desc: 'Chance to skip turn. 30% to thaw each turn.' },
  poison:   { name: 'Poison',   icon: '☠',  color: '#8a7a92', c: 'B',
    desc: 'Takes scaling damage at end of turn.' },
  stun:     { name: 'Stun',     icon: '✦',  color: '#f3e3a8', c: 'W',
    desc: 'Skips next turn, then clears.' },
  entangle: { name: 'Entangle', icon: '❦',  color: '#6fb06f', c: 'G',
    desc: 'Deals 30% less damage.' },
};

function weightedPick(pool) {
  const total = pool.reduce((s, p) => s + p.w, 0);
  let r = Math.random() * total;
  for (const p of pool) { r -= p.w; if (r <= 0) return p; }
  return pool[0];
}

// ---------- Creature helpers ----------
function createCreature(id, level) {
  const d = DEX[id];
  const maxHp = Math.floor(d.hp + (level - 1) * 4);
  return {
    uid: Math.random().toString(36).slice(2, 9),
    id, name: d.name, c: d.c, t: d.t,
    level, xp: 0,
    hp: maxHp, maxHp,
    baseAtk: d.atk,
    moves: d.m.slice(),
  };
}
// Transform a creature into its evolved form, preserving identity/level/XP/HP ratio.
// Adds any moves from the new form's default kit that weren't already known (up to 4 total).
function evolveCreature(c, newId) {
  const d = DEX[newId];
  if (!d) return c;
  const ratio = c.hp / Math.max(c.maxHp, 1);
  const newMax = Math.floor(d.hp + (c.level - 1) * 4);
  const mset = new Set(c.moves);
  for (const m of d.m) {
    if (mset.size >= 4) break;
    mset.add(m);
  }
  return {
    ...c,
    id: newId,
    name: d.name,
    c: d.c,
    t: d.t,
    baseAtk: d.atk,
    maxHp: newMax,
    hp: Math.max(1, Math.ceil(newMax * ratio)),
    moves: Array.from(mset).slice(0, 4),
    flashUntil: Date.now() + 1400, // for sprite glow pulse
  };
}
const atkOf = (c) => c.baseAtk + Math.floor((c.level - 1) * 1.5);
const xpToNext = (lv) => lv * 18;

// ---------- Status helpers ----------
// A creature is immune to a status matching any of its colors (red+blue can't burn OR freeze).
function isImmuneToStatus(creature, statusKind) {
  const s = STATUSES[statusKind];
  return !!(s && colorsOf(creature.c).includes(s.c));
}
// Returns a new creature object with status applied, or the original if immune/already statused.
function applyStatus(creature, kind, turns = 4) {
  if (creature.status) return creature; // one status at a time
  if (isImmuneToStatus(creature, kind)) return creature;
  return { ...creature, status: { kind, turns } };
}
// Process end-of-turn status tick. Returns { newCreature, lines, prevented }.
// `prevented` indicates the status skipped this creature's turn (freeze/stun).
function tickStatusStart(creature) {
  if (!creature.status || creature.hp <= 0) return { newCreature: creature, lines: [], prevented: false };
  const { kind, turns } = creature.status;
  const st = STATUSES[kind];
  if (kind === 'freeze') {
    // 30% to thaw
    if (Math.random() < 0.3) {
      return { newCreature: { ...creature, status: null }, lines: [`${creature.name} thawed out!`], prevented: false };
    }
    return { newCreature: creature, lines: [`${creature.name} is frozen solid!`], prevented: true };
  }
  if (kind === 'stun') {
    // Stun prevents this turn, then clears
    return { newCreature: { ...creature, status: null }, lines: [`${creature.name} is stunned!`], prevented: true };
  }
  return { newCreature: creature, lines: [], prevented: false };
}
function tickStatusEnd(creature) {
  if (!creature.status || creature.hp <= 0) return { newCreature: creature, lines: [] };
  const { kind, turns } = creature.status;
  const lines = [];
  let hp = creature.hp;
  let newStatus = { kind, turns: turns - 1 };
  if (kind === 'burn') {
    const dmg = Math.max(1, Math.floor(creature.maxHp * 0.08));
    hp = Math.max(0, hp - dmg);
    lines.push(`${creature.name} is hurt by its burn! (-${dmg})`);
  } else if (kind === 'poison') {
    // Poison scales up each turn
    const stacks = 5 - Math.max(0, newStatus.turns);
    const dmg = Math.max(1, Math.floor(creature.maxHp * (0.05 + 0.02 * stacks)));
    hp = Math.max(0, hp - dmg);
    lines.push(`${creature.name} suffers from poison! (-${dmg})`);
  }
  // entangle: no end-tick damage, just lingers
  if (newStatus.turns <= 0) {
    newStatus = null;
    if (kind !== 'stun') lines.push(`${creature.name} recovered from ${STATUSES[kind].name.toLowerCase()}.`);
  }
  if (hp <= 0) lines.push(`${creature.name} fainted from status!`);
  return { newCreature: { ...creature, hp, status: newStatus }, lines };
}

function calcDamage(attacker, defender, move) {
  if (move.p === 0) return { dmg: 0, mult: 1, crit: false, missed: false };
  if (Math.random() * 100 > move.a) return { dmg: 0, mult: 1, crit: false, missed: true };
  let mult = matchupMultiplier(move.c, defender.c);
  // Entangled attackers deal 30% less damage
  if (attacker.status?.kind === 'entangle') mult *= 0.7;
  // Color-graft penalty: if the attacker has per-color penalties (commander mode) and the
  // move's color has been displaced, apply the multiplier (e.g., 0.9 for first displacement).
  if (attacker.colorPenalties && move.c && attacker.colorPenalties[move.c] !== undefined) {
    mult *= attacker.colorPenalties[move.c];
  }
  const crit = Math.random() < 0.08;
  const variance = 0.85 + Math.random() * 0.3;
  let dmg = Math.floor((move.p + atkOf(attacker) * 0.6) * mult * variance * (crit ? 1.7 : 1));
  return { dmg: Math.max(1, dmg), mult, crit, missed: false };
}

// ---------- Maps ----------
// Tile codes:
//   . grass (safe), g tall-grass (green encounter)
//   a ash-ground (safe, Ashen),     l lava-vent (red encounter)
//   u shallow-water (safe, Sanctum), o pool (blue encounter)
//   m moss-ground (safe, Umbral),   v vines (black encounter)
//   p path, t tree, r roof, w wall, d door, s shrine, E exit, k rock (blocking)
function makeTown() {
  const W = 16, H = 13;
  const m = Array.from({ length: H }, () => Array(W).fill('.'));
  for (let x = 0; x < W; x++) { m[0][x] = 't'; m[H-1][x] = 't'; }
  for (let y = 0; y < H; y++) { m[y][0] = 't'; m[y][W-1] = 't'; }
  // top houses
  const h = (hx, hy) => {
    for (let dx = 0; dx < 3; dx++) { m[hy][hx+dx] = 'r'; m[hy+1][hx+dx] = 'w'; }
    m[hy+1][hx+1] = 'd';
  };
  h(3, 2); h(10, 2); h(5, 8);
  // shrine (healing altar)
  m[6][7] = 's';
  // path south to Mana Wilds (center)
  for (let x = 6; x <= 9; x++) m[11][x] = 'p';
  m[12][7] = 'E'; m[12][8] = 'E'; m[12][6] = 'E';
  // path southwest to Plains of Light (white)
  for (let y = 9; y <= 11; y++) m[y][2] = 'p';
  m[12][1] = 'E'; m[12][2] = 'E'; m[12][3] = 'E';
  // path east to Ashen Wastes
  for (let x = 13; x < W - 1; x++) m[6][x] = 'p';
  m[6][W-1] = 'E';
  // path west to Sunken Sanctum
  for (let x = 1; x <= 2; x++) m[6][x] = 'p';
  m[6][0] = 'E';
  // path north to Umbral Grove
  for (let y = 5; y >= 1; y--) m[y][7] = 'p';
  m[0][7] = 'E';
  return m;
}

function makeWilds() {
  const W = 16, H = 15;
  const m = Array.from({ length: H }, () => Array(W).fill('g'));
  for (let x = 0; x < W; x++) { m[0][x] = 't'; m[H-1][x] = 't'; }
  for (let y = 0; y < H; y++) { m[y][0] = 't'; m[y][W-1] = 't'; }
  m[0][6] = 'E'; m[0][7] = 'E'; m[0][8] = 'E';
  const path = [[7,1],[7,2],[7,3],[6,3],[5,3],[5,4],[5,5],[5,6],[6,6],[7,6],[8,6],[8,7],[8,8],[8,9],[9,9],[10,9],[10,10],[10,11],[10,12],[10,13]];
  for (const [x, y] of path) m[y][x] = 'p';
  const safe = [[6,1],[8,1],[6,2],[8,2]];
  for (const [x, y] of safe) m[y][x] = '.';
  const trees = [[3,3],[12,3],[3,7],[12,7],[2,10],[13,11],[4,12],[11,13]];
  for (const [x, y] of trees) m[y][x] = 't';
  // Earthen Burrow entrance — a hole in the ground tucked into the deep wilds.
  m[5][13] = '.';     // small clearing in front
  m[5][14] = 'B';     // burrow entrance (door tile)
  m[4][13] = 't'; m[4][14] = 't'; m[6][14] = 't';  // surround with trees so it feels hidden
  return m;
}

// Ashen Wastes — rocky, with lava vents as encounter tiles. Connects to town on the WEST.
function makeAshen() {
  const W = 16, H = 13;
  const m = Array.from({ length: H }, () => Array(W).fill('a'));
  // Border of rocks
  for (let x = 0; x < W; x++) { m[0][x] = 'k'; m[H-1][x] = 'k'; }
  for (let y = 0; y < H; y++) { m[y][0] = 'k'; m[y][W-1] = 'k'; }
  // Entry from town on west side
  m[6][0] = 'E';
  // Lava vent pockets scattered around
  const vents = [
    [3,3],[4,3],[5,3],[3,4],[4,4],
    [10,2],[11,2],[12,2],[10,3],[11,3],
    [2,8],[3,8],[2,9],[3,9],[4,9],
    [10,8],[11,8],[12,8],[11,9],[12,9],[10,10],[11,10],
    [7,10],[8,10],[7,11],[8,11],
  ];
  for (const [x, y] of vents) m[y][x] = 'l';
  // Winding path through
  const path = [[1,6],[2,6],[3,6],[4,6],[5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6]];
  for (const [x, y] of path) m[y][x] = 'p';
  // Scattered rocks (obstacles)
  const rocks = [[6,2],[9,3],[7,4],[5,8],[9,7],[3,11],[12,11]];
  for (const [x, y] of rocks) m[y][x] = 'k';
  // Cinder Cave entrance — a dark mouth in the eastern wall, just off the main path.
  m[5][13] = 'a'; m[4][13] = 'B';   // small clear approach + cave mouth
  return m;
}

// Sunken Sanctum — watery ruins. Pools are encounter tiles. Connects to town on the EAST.
function makeSanctum() {
  const W = 16, H = 13;
  const m = Array.from({ length: H }, () => Array(W).fill('u'));
  // Border of walls (ruined stone)
  for (let x = 0; x < W; x++) { m[0][x] = 'w'; m[H-1][x] = 'w'; }
  for (let y = 0; y < H; y++) { m[y][0] = 'w'; m[y][W-1] = 'w'; }
  // Entry on east
  m[6][W-1] = 'E';
  // Deep pools (encounter)
  const pools = [
    [3,3],[4,3],[5,3],[3,4],[4,4],[5,4],
    [10,3],[11,3],[12,3],[10,4],[11,4],[12,4],
    [2,8],[3,8],[4,8],[2,9],[3,9],[4,9],
    [10,8],[11,8],[12,8],[10,9],[11,9],[12,9],
    [7,10],[8,10],
  ];
  for (const [x, y] of pools) m[y][x] = 'o';
  // Path
  const path = [[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,6],[7,6],[6,6],[5,6],[4,6],[3,6],[2,6],[1,6]];
  for (const [x, y] of path) m[y][x] = 'p';
  // Broken pillars (wall tiles scattered)
  const pillars = [[6,2],[9,2],[3,7],[12,7],[6,11],[9,11]];
  for (const [x, y] of pillars) m[y][x] = 'w';
  // Tidehut Sanctum entrance — a small reed hut on a sunken islet to the west.
  m[2][2] = 'u'; m[1][2] = 'B';
  return m;
}

// Umbral Grove — dark overgrowth. Vine tiles are encounter. Connects to town on the SOUTH (north edge of grove).
function makeUmbral() {
  const W = 16, H = 13;
  const m = Array.from({ length: H }, () => Array(W).fill('m'));
  // Dead trees border
  for (let x = 0; x < W; x++) { m[0][x] = 't'; m[H-1][x] = 't'; }
  for (let y = 0; y < H; y++) { m[y][0] = 't'; m[y][W-1] = 't'; }
  // Entry from town — south into grove means player enters from north edge of grove
  m[H-1][6] = 'E'; m[H-1][7] = 'E'; m[H-1][8] = 'E';
  // Vine thickets
  const vines = [
    [2,2],[3,2],[4,2],[2,3],[3,3],[4,3],
    [11,2],[12,2],[13,2],[11,3],[12,3],[13,3],
    [2,8],[3,8],[2,9],[3,9],[4,9],
    [10,8],[11,8],[12,8],[13,8],[11,9],[12,9],
    [6,5],[7,5],[8,5],[6,6],[9,6],[6,7],[7,7],[8,7],[9,7],
    [5,10],[9,10],[10,10],
  ];
  for (const [x, y] of vines) m[y][x] = 'v';
  // Narrow path from entry winding down
  const path = [[7,11],[7,10],[7,9],[7,8],[6,8],[5,8],[5,7],[5,6],[5,5],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[10,5],[10,6],[10,7]];
  for (const [x, y] of path) m[y][x] = 'p';
  // Dead trees scattered inside
  const trees = [[3,5],[13,5],[12,10],[3,11]];
  for (const [x, y] of trees) m[y][x] = 't';
  // Withered Shack entrance — a leaning hovel deep in the grove.
  m[2][8] = 'm'; m[1][8] = 'B';
  return m;
}

// Plains of Light — bright grassland with flower fields. Connects to town on the SOUTHWEST.
function makePlains() {
  const W = 16, H = 13;
  const m = Array.from({ length: H }, () => Array(W).fill('c'));
  // Border of low stone walls
  for (let x = 0; x < W; x++) { m[0][x] = 'k'; m[H-1][x] = 'k'; }
  for (let y = 0; y < H; y++) { m[y][0] = 'k'; m[y][W-1] = 'k'; }
  // Entry from town at top-right (player came from the southwest path of town)
  m[0][13] = 'E'; m[0][14] = 'E';
  // Flower-field encounter patches
  const flowers = [
    [2,3],[3,3],[4,3],[2,4],[3,4],[4,4],[5,4],
    [10,2],[11,2],[12,2],[10,3],[11,3],[12,3],[13,3],
    [2,8],[3,8],[4,8],[2,9],[3,9],[4,9],[5,9],
    [10,8],[11,8],[12,8],[13,8],[10,9],[11,9],[12,9],
    [7,10],[8,10],[7,11],[8,11],[9,11],
  ];
  for (const [x, y] of flowers) m[y][x] = 'f';
  // Path winding from entry through the plains
  const path = [[13,1],[12,1],[11,1],[10,1],[9,1],[8,1],[7,1],[6,1],[6,2],[6,3],[7,3],[8,3],[8,4],[8,5],[8,6],[8,7],[7,7],[6,7],[5,7],[5,8],[6,8],[7,8],[8,8],[9,8]];
  for (const [x, y] of path) m[y][x] = 'p';
  // A few decorative columns/cairns inside
  const cairns = [[6,5],[10,5],[3,11],[12,11],[6,11]];
  for (const [x, y] of cairns) m[y][x] = 'k';
  // Heavenly Gates entrance — pearlescent gates at the southern edge of the plains.
  m[10][2] = 'c'; m[11][2] = 'B';
  return m;
}

// =============================================================================
// SHRINE INTERIORS (legendary boss arenas)
// Each is a small chamber themed to its color. The player walks toward the center
// where the boss tile ('L') triggers the legendary fight on contact.
// =============================================================================

// Earthen Burrow (Green) — root-walled tunnel descending to the Patriarch's chamber.
function makeShrineGreen() {
  const W = 11, H = 11;
  const m = Array.from({ length: H }, () => Array(W).fill('m'));
  for (let x = 0; x < W; x++) { m[0][x] = 't'; m[H-1][x] = 't'; }
  for (let y = 0; y < H; y++) { m[y][0] = 't'; m[y][W-1] = 't'; }
  m[H-1][5] = 'E';                     // exit (back to wilds)
  for (let y = 1; y < H-1; y++) m[y][5] = 'F'; // dirt floor central column
  m[2][5] = 'L';                       // Patriarch boss tile
  // Some scattered roots/leaves
  m[4][3] = 'v'; m[4][7] = 'v'; m[6][3] = 'v'; m[6][7] = 'v';
  m[8][2] = 'v'; m[8][8] = 'v';
  return m;
}

// Tidehut Sanctum (Blue) — a small island chamber surrounded by water.
function makeShrineBlue() {
  const W = 11, H = 11;
  const m = Array.from({ length: H }, () => Array(W).fill('o'));
  for (let x = 0; x < W; x++) { m[0][x] = 'w'; m[H-1][x] = 'w'; }
  for (let y = 0; y < H; y++) { m[y][0] = 'w'; m[y][W-1] = 'w'; }
  m[H-1][5] = 'E';
  // Stone walkway to a small island in the center
  for (let y = H-2; y >= 5; y--) m[y][5] = 'F';
  // The island itself — a 3x3 pad
  for (let y = 3; y <= 5; y++) for (let x = 4; x <= 6; x++) m[y][x] = 'F';
  m[3][5] = 'L';                       // Tidewarden boss tile
  // Decorative pillars
  m[4][2] = 'w'; m[4][8] = 'w'; m[6][2] = 'w'; m[6][8] = 'w';
  return m;
}

// Cinder Cave (Red) — dark cavern with lava veins, dragon at the back.
function makeShrineRed() {
  const W = 11, H = 11;
  const m = Array.from({ length: H }, () => Array(W).fill('a'));
  for (let x = 0; x < W; x++) { m[0][x] = 'k'; m[H-1][x] = 'k'; }
  for (let y = 0; y < H; y++) { m[y][0] = 'k'; m[y][W-1] = 'k'; }
  m[H-1][5] = 'E';
  // Stone floor approach
  for (let y = 1; y < H-1; y++) m[y][5] = 'F';
  m[2][5] = 'L';                       // Pyreclaw boss tile
  // Lava veins to the sides
  m[4][2] = 'l'; m[4][8] = 'l';
  m[6][3] = 'l'; m[6][7] = 'l';
  m[8][2] = 'l'; m[8][8] = 'l';
  // Loose rocks
  m[3][3] = 'k'; m[3][7] = 'k'; m[7][4] = 'k'; m[7][6] = 'k';
  return m;
}

// Withered Shack (Black) — gloomy hovel where the Voidlord waits.
function makeShrineBlack() {
  const W = 11, H = 11;
  const m = Array.from({ length: H }, () => Array(W).fill('m'));
  for (let x = 0; x < W; x++) { m[0][x] = 'w'; m[H-1][x] = 'w'; }
  for (let y = 0; y < H; y++) { m[y][0] = 'w'; m[y][W-1] = 'w'; }
  m[H-1][5] = 'E';
  // Wood plank floor
  for (let y = 1; y < H-1; y++) for (let x = 3; x <= 7; x++) m[y][x] = 'F';
  m[2][5] = 'L';                       // Voidlord boss tile
  // Vine creep around the edges
  m[4][2] = 'v'; m[4][8] = 'v'; m[6][2] = 'v'; m[6][8] = 'v';
  m[8][3] = 'v'; m[8][7] = 'v';
  return m;
}

// Heavenly Gates (White) — marble courtyard ascending to Vigil.
function makeShrineWhite() {
  const W = 11, H = 11;
  const m = Array.from({ length: H }, () => Array(W).fill('c'));
  for (let x = 0; x < W; x++) { m[0][x] = 'w'; m[H-1][x] = 'w'; }
  for (let y = 0; y < H; y++) { m[y][0] = 'w'; m[y][W-1] = 'w'; }
  m[H-1][5] = 'E';
  // Marble path
  for (let y = 1; y < H-1; y++) m[y][5] = 'F';
  // A wider altar platform near the top
  for (let y = 1; y <= 3; y++) for (let x = 3; x <= 7; x++) m[y][x] = 'F';
  m[2][5] = 'L';                       // Vigil boss tile
  // Decorative columns
  m[4][3] = 'w'; m[4][7] = 'w'; m[7][3] = 'w'; m[7][7] = 'w';
  // Flower beds
  m[6][2] = 'f'; m[6][8] = 'f'; m[8][4] = 'f'; m[8][6] = 'f';
  return m;
}

const MAPS = {
  town:    { tiles: makeTown(),    name: 'Runesmith Hollow' },
  wilds:   { tiles: makeWilds(),   name: 'The Mana Wilds' },
  ashen:   { tiles: makeAshen(),   name: 'Ashen Wastes' },
  sanctum: { tiles: makeSanctum(), name: 'Sunken Sanctum' },
  umbral:  { tiles: makeUmbral(),  name: 'Umbral Grove' },
  plains:  { tiles: makePlains(),  name: 'Plains of Light' },
  shrine_green: { tiles: makeShrineGreen(), name: 'Earthen Burrow' },
  shrine_blue:  { tiles: makeShrineBlue(),  name: 'Tidehut Sanctum' },
  shrine_red:   { tiles: makeShrineRed(),   name: 'Cinder Cave' },
  shrine_black: { tiles: makeShrineBlack(), name: 'Withered Shack' },
  shrine_white: { tiles: makeShrineWhite(), name: 'Heavenly Gates' },
};

// ---------- NPCs ----------
const NPCS_TOWN = [
  { id: 'bran', x: 4, y: 5, face: 'down', color: '#8b5a3c',
    name: 'Dueler Bran',
    dialog: "First time in Runesmith Hollow? I read every newcomer's mana. Show me yours.",
    team: [{ id: 'forest_runt', lv: 3 }, { id: 'elfling_scout', lv: 4 }],
    reward: 40 },
  { id: 'ria', x: 11, y: 10, face: 'left', color: '#4a6ea0',
    name: 'Spellbinder Ria',
    dialog: "The currents whisper your arrival. They also whisper your defeat. Care to disprove them?",
    team: [{ id: 'tideling', lv: 4 }, { id: 'phantom_sprite', lv: 5 }],
    reward: 70 },
  { id: 'dax', x: 7, y: 9, face: 'up', color: '#a04030',
    name: 'Pyromancer Dax',
    dialog: "I've burned through every challenger this week. Step up — let's see if you light or smolder.",
    team: [{ id: 'emberkin', lv: 5 }, { id: 'goblin_raider', lv: 5 }, { id: 'cinder_drake', lv: 6 }],
    reward: 120 },
  { id: 'guide', x: 2, y: 11, face: 'right', color: '#c4a664', noBattle: true,
    name: 'Old Wanderer',
    dialog: "Five planes touch this hollow. South: the Mana Wilds, soft-spoken and green. Southwest: the Plains of Light — beautiful, and merciless. East: the Ashen Wastes, all teeth and embers. West: the Sunken Sanctum, where the deep keeps its secrets. North: the Umbral Grove, where shadows have weight. Each breeds its own color — bring what the wheel favors. The shrine restores any creature you've bound." },
  { id: 'merle', x: 11, y: 4, face: 'down', color: '#9a6e3a', noBattle: true, isShop: true,
    name: 'Merle the Provisioner',
    dialog: "Potions, revives, fresh Creature Cards — whatever a planeswalker-in-training needs for the road." },
  // ---- Lorekeeper hints at the shrine bosses (gating becomes lore exposition) ----
  { id: 'lorekeeper', x: 5, y: 5, face: 'right', color: '#7050a0', noBattle: true,
    name: 'Lorekeeper Vey',
    dialog: "Old stories say each color has a sleeping warden — Avatar, Colossus, Voidlord, Dragon, Wurm. They wake only for those who've proved themselves to all five guardians of the wheel. Bring back five medallions and the Hollow's central shrine will sing for the first time in an age." },
  // ---- Easter egg: Yugi and Ash arguing about whose card game is correct ----
  { id: 'yugi', x: 12, y: 8, face: 'right', color: '#7a4a8a', noBattle: true,
    name: 'Spiky-Haired Tourist',
    dialog: "You don't get it — in REAL card games, the heart of the cards decides the outcome. Tribute summon a Blue-Eyes and the universe BENDS. This 'mana' system is just... bookkeeping." },
  { id: 'ash', x: 13, y: 8, face: 'left', color: '#3a6a3a', noBattle: true,
    name: 'Cap-Wearing Tourist',
    dialog: "It do be what it do, Yugi. My buddy Pikachu doesn't need 'tributes' — just love, loyalty, and a thunderbolt. You're overcomplicating it, dude." },
  // ---- A notice board with dynamic flavor (kept as noBattle NPC for simplicity) ----
  { id: 'board', x: 9, y: 6, face: 'down', color: '#7a5a40', noBattle: true,
    name: 'Town Notice Board',
    dialog: "Pinned: 'Five challengers patrol the zones — defeat them all and they'll return, hungrier.' / Scrawled below: 'When five medallions hang at the shrine, the Hollow's heart will wake.'" },
];

// Per-zone NPCs (mini-boss trainers). Key by map id.
const NPCS_ZONE = {
  wilds: [
    { id: 'mira', x: 10, y: 11, face: 'up', color: '#4a8030',
      name: 'Ranger Mira',
      dialog: "The wilds have taught me patience — and my creatures, ferocity. Prove yourself.",
      team: [{ id: 'forest_runt', lv: 6 }, { id: 'elfling_scout', lv: 7 }, { id: 'grove_wurm', lv: 8 }],
      reward: 150 },
  ],
  ashen: [
    { id: 'kalr', x: 13, y: 6, face: 'left', color: '#c04828',
      name: 'Pyromancer Kalr',
      dialog: "The flame answers only the worthy. Let's see if it answers to you.",
      team: [{ id: 'emberkin', lv: 9 }, { id: 'goblin_raider', lv: 10 }, { id: 'cinder_drake', lv: 11 }],
      reward: 220 },
  ],
  sanctum: [
    { id: 'selin', x: 1, y: 6, face: 'right', color: '#3a68a0',
      name: 'Tidecaller Selin',
      dialog: "The deep remembers what the shore forgets. Show me your current.",
      team: [{ id: 'tideling', lv: 10 }, { id: 'phantom_sprite', lv: 11 }, { id: 'storm_leviathan', lv: 12 }],
      reward: 260 },
  ],
  umbral: [
    { id: 'vesh', x: 10, y: 7, face: 'down', color: '#5a3070',
      name: 'Shadewalker Vesh',
      dialog: "Light flees this grove. Your creatures must learn to see in the dark.",
      team: [{ id: 'shade_whelp', lv: 12 }, { id: 'blood_imp', lv: 13 }, { id: 'nightfall_wraith', lv: 14 }],
      reward: 340 },
  ],
  plains: [
    { id: 'auriel', x: 8, y: 7, face: 'down', color: '#d8c060',
      name: 'Sun Cleric Auriel',
      dialog: "The light reveals all weakness — including yours. Step forward and be measured.",
      team: [{ id: 'plains_acolyte', lv: 14 }, { id: 'aven_sentinel', lv: 15 }, { id: 'radiant_seraph', lv: 16 }],
      reward: 420 },
  ],
};

// Set of all zone-trainer NPC ids — used to detect when a full cycle is cleared
// and to gate the team-rerolling logic. Town trainers (Bran/Ria/Dax) don't rotate.
const ZONE_TRAINER_IDS = new Set();
for (const list of Object.values(NPCS_ZONE)) {
  for (const n of list) ZONE_TRAINER_IDS.add(n.id);
}
// Quick lookup: which zone a trainer belongs to
const TRAINER_ZONE = {};
for (const [zoneId, list] of Object.entries(NPCS_ZONE)) {
  for (const n of list) TRAINER_ZONE[n.id] = zoneId;
}
// Generate a fresh 3-creature team for a zone trainer.
// Levels scale with cycles cleared: each cycle adds 2 levels to the entire team.
// Picks 3 distinct creatures from the zone's pool, skewed toward higher color counts
// (so trainers feel meaningfully different from random wild encounters).
function generateTrainerTeam(npc, cycles) {
  const zoneId = TRAINER_ZONE[npc.id];
  const pool = (zoneId && ZONE_POOLS[zoneId]) || [];
  // Compute base levels from the npc's original team — first member's level is the floor.
  const baseLvs = (npc.team || []).map(c => c.lv);
  const levelBoost = cycles * 2;
  const picks = [];
  const usedIds = new Set();
  // Pick 3 from pool without repeats.
  for (let attempt = 0; attempt < 30 && picks.length < 3; attempt++) {
    const e = weightedPick(pool);
    if (!e || usedIds.has(e.id)) continue;
    usedIds.add(e.id);
    const baseLv = baseLvs[picks.length] ?? (baseLvs[baseLvs.length - 1] ?? 8);
    picks.push({ id: e.id, lv: baseLv + levelBoost });
  }
  // Fallback if pool ran dry — repeat the original team with level boost.
  if (picks.length < 3 && npc.team) {
    for (const c of npc.team) {
      if (picks.length >= 3) break;
      picks.push({ id: c.id, lv: c.lv + levelBoost });
    }
  }
  return picks;
}

// ---------- Tile walk/interact helpers ----------
function tileAt(map, x, y) {
  const tiles = MAPS[map].tiles;
  if (y < 0 || y >= tiles.length || x < 0 || x >= tiles[0].length) return 't';
  return tiles[y][x];
}
function isWalkable(tile) {
  // 'B' = building entrance (steppable, triggers transition)
  // 'F' = shrine floor (interior)
  // 'L' = legendary boss tile (steppable, triggers boss fight on contact)
  return ['.', 'g', 'p', 'd', 'E', 's', 'a', 'l', 'u', 'o', 'm', 'v', 'c', 'f', 'B', 'F', 'L'].includes(tile);
}
function hasEncounter(tile) {
  return ['g', 'l', 'o', 'v', 'f'].includes(tile);
}

// ---------- Audio engine ----------
// A tiny synth-style SFX/music system using the Web Audio API. No external assets — every
// sound is generated on the fly so the file stays self-contained. The engine lazily creates
// its AudioContext on the first user-driven sound (browsers block autoplay otherwise).
// Volume is read from localStorage so the player's mute preference survives reloads.
// Failure is silent: if Web Audio is unavailable the engine becomes a no-op.
const AUDIO_PREF_KEY = 'gtm:audio:v1';
const audio = (() => {
  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  // Music track state — a single chained-oscillator loop we can mute/swap without re-allocating.
  const music = { stopFn: null, key: null };
  // Read initial mute preference. Default = unmuted.
  let muted = false;
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(AUDIO_PREF_KEY);
      if (v === '0') muted = true;
    }
  } catch { /* ignore storage errors */ }

  // ---- User-gesture gating ----
  // Browsers (especially in embedded/iframe contexts like shared artifact links) block
  // AudioContext creation/resume until a user has actually interacted with the page. If we
  // create the context preemptively on page load, it can get stuck in 'suspended' and
  // subsequent resume() calls may silently fail. So we wait for the first real gesture.
  // Until that happens, all sound calls are no-ops, and any music start request is queued.
  let userHasInteracted = false;
  let pendingMusicKey = null;

  const ensureCtx = () => {
    if (ctx) return ctx;
    // Don't create the context until the user has actually interacted — see comment above.
    if (!userHasInteracted) return null;
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.55;
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = muted ? 0 : 0.18; // music sits well below SFX
      musicGain.connect(masterGain);
    } catch {
      ctx = null;
    }
    return ctx;
  };
  // Called on every user gesture (and from specific buttons that wake audio).
  // First call: flips the gate, creates the context, drains the queued music.
  // Subsequent calls: a cheap idempotent resume() if the context happens to be suspended
  // (e.g., if the tab was backgrounded).
  const wake = () => {
    if (!userHasInteracted) {
      userHasInteracted = true;
      ensureCtx();
      // If music was requested before the user interacted, it was queued — start it now.
      if (pendingMusicKey && !music.stopFn) {
        const key = pendingMusicKey;
        pendingMusicKey = null;
        startMusicInternal(key);
      }
    }
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  };

  // Schedule a single oscillator note with an envelope. All SFX are built from chains of these.
  const note = (opts) => {
    const c = ensureCtx();
    if (!c || muted) return;
    const {
      freq = 440,
      freqEnd = null,                 // when set, linear ramp from freq → freqEnd
      type = 'sine',                  // 'sine' | 'square' | 'sawtooth' | 'triangle'
      start = 0,                      // seconds offset from "now"
      attack = 0.005,
      hold = 0,
      decay = 0.1,
      release = 0.05,
      gain = 0.25,
      dest = masterGain,
    } = opts;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) {
      osc.frequency.linearRampToValueAtTime(freqEnd, t0 + attack + hold + decay);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.linearRampToValueAtTime(gain * 0.7, t0 + attack + hold);
    g.gain.linearRampToValueAtTime(0, t0 + attack + hold + decay + release);
    osc.connect(g); g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + attack + hold + decay + release + 0.05);
  };

  // Very short noise buffer reused for percussive impacts.
  let noiseBuf = null;
  const getNoiseBuf = () => {
    const c = ensureCtx(); if (!c) return null;
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(c.sampleRate * 0.4);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  };
  const noise = ({ start = 0, gain = 0.3, attack = 0.005, decay = 0.1, lowpass = 800, dest = null } = {}) => {
    const c = ensureCtx(); if (!c || muted) return;
    const buf = getNoiseBuf(); if (!buf) return;
    const t0 = c.currentTime + start;
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.linearRampToValueAtTime(0, t0 + attack + decay);
    src.connect(lp); lp.connect(g); g.connect(dest || masterGain);
    src.start(t0); src.stop(t0 + attack + decay + 0.05);
  };

  // Public mute/unmute — also persists the preference.
  const setMuted = (m) => {
    muted = !!m;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(AUDIO_PREF_KEY, muted ? '0' : '1');
    } catch { /* ignore */ }
    if (masterGain && ctx) {
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
    }
    if (musicGain && ctx) {
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setTargetAtTime(muted ? 0 : 0.18, ctx.currentTime, 0.05);
    }
  };
  const isMuted = () => muted;

  // Shared color → frequency cluster for spell-color flavor.
  const COLOR_FREQ = {
    W: [880, 1320, 1760],   // bright bell
    U: [392, 523, 659],     // cool minor triad
    R: [220, 277, 330],     // warm low growl
    B: [165, 196, 247],     // dark dissonance
    G: [293, 440, 587],     // organic open chord
  };

  // === SFX: catalog of named effects =========================================
  const sfx = {
    // UI
    menuOpen: () => { wake(); note({ freq: 660, freqEnd: 880, type: 'square', attack: 0.005, decay: 0.06, gain: 0.18 }); },
    menuClose:() => { wake(); note({ freq: 880, freqEnd: 440, type: 'square', attack: 0.005, decay: 0.06, gain: 0.18 }); },
    blip:     () => { wake(); note({ freq: 720, type: 'square', attack: 0.003, decay: 0.04, gain: 0.14 }); },
    confirm:  () => { wake(); note({ freq: 523, type: 'triangle', decay: 0.05, gain: 0.18 }); note({ freq: 784, type: 'triangle', start: 0.06, decay: 0.08, gain: 0.18 }); },
    deny:     () => { wake(); note({ freq: 220, type: 'square', decay: 0.12, gain: 0.18 }); },
    // Movement
    step: (() => {
      let toggle = false;
      return () => { wake(); toggle = !toggle; note({ freq: toggle ? 180 : 200, type: 'square', attack: 0.002, hold: 0.005, decay: 0.02, release: 0.01, gain: 0.06 }); };
    })(),
    // Battle: attack flavor by color, plus a percussive impact stinger
    attack: (color) => {
      wake();
      const arr = COLOR_FREQ[color] || [330, 440, 550];
      arr.forEach((f, i) => note({
        freq: f, freqEnd: f * (color === 'R' ? 0.7 : 1.05),
        type: color === 'R' ? 'sawtooth' : (color === 'U' ? 'sine' : 'triangle'),
        start: i * 0.03, attack: 0.005, hold: 0.02, decay: 0.12, gain: 0.16
      }));
    },
    hit:        () => { wake(); noise({ gain: 0.35, decay: 0.09, lowpass: 1200 }); note({ freq: 110, freqEnd: 70, type: 'square', decay: 0.08, gain: 0.18 }); },
    crit:       () => { wake(); noise({ gain: 0.45, decay: 0.16, lowpass: 2400 }); note({ freq: 880, freqEnd: 220, type: 'sawtooth', decay: 0.20, gain: 0.22 }); },
    miss:       () => { wake(); note({ freq: 240, freqEnd: 180, type: 'sine', decay: 0.10, gain: 0.14 }); },
    notVeryEffective: () => { wake(); note({ freq: 200, type: 'sine', decay: 0.12, gain: 0.12 }); },
    superEffective:   () => { wake(); note({ freq: 880, freqEnd: 1320, type: 'square', decay: 0.10, gain: 0.18 }); note({ freq: 660, freqEnd: 990, type: 'triangle', start: 0.05, decay: 0.10, gain: 0.18 }); },
    heal:       () => { wake(); [523, 659, 784, 1047].forEach((f, i) => note({ freq: f, type: 'sine', start: i * 0.04, decay: 0.18, gain: 0.16 })); },
    statusApply:() => { wake(); note({ freq: 392, type: 'square', decay: 0.05, gain: 0.14 }); note({ freq: 466, type: 'square', start: 0.05, decay: 0.06, gain: 0.14 }); },
    faint:      () => { wake(); note({ freq: 440, freqEnd: 110, type: 'sawtooth', attack: 0.01, decay: 0.45, gain: 0.22 }); },
    catchTry:   () => {
      wake();
      // Three rising clicks
      [0, 0.18, 0.36].forEach((t, i) => note({ freq: 660 + i * 80, type: 'square', start: t, attack: 0.004, decay: 0.05, gain: 0.18 }));
    },
    catchSuccess: () => {
      wake();
      [523, 659, 784, 1047, 1319].forEach((f, i) => note({ freq: f, type: 'triangle', start: i * 0.07, decay: 0.16, gain: 0.20 }));
    },
    catchFail: () => { wake(); note({ freq: 440, freqEnd: 220, type: 'square', decay: 0.18, gain: 0.18 }); },
    // Progression
    levelUp:   () => { wake(); [523, 659, 784, 1047].forEach((f, i) => note({ freq: f, type: 'square', start: i * 0.06, decay: 0.10, gain: 0.20 })); },
    learnMove: () => { wake(); [659, 784, 988].forEach((f, i) => note({ freq: f, type: 'triangle', start: i * 0.05, decay: 0.14, gain: 0.18 })); },
    grafted:   () => { wake(); [440, 554, 659, 880].forEach((f, i) => note({ freq: f, type: 'sine', start: i * 0.05, decay: 0.18, gain: 0.18 })); },
    // World events
    victory:   () => {
      wake();
      const m = [523, 659, 784, 1047, 1319, 1568];
      m.forEach((f, i) => note({ freq: f, type: 'square', start: i * 0.10, decay: 0.14, gain: 0.20 }));
    },
    defeat:    () => { wake(); [440, 392, 349, 294, 220].forEach((f, i) => note({ freq: f, type: 'sawtooth', start: i * 0.12, decay: 0.30, gain: 0.20 })); },
    medallion: (color) => {
      wake();
      const arr = COLOR_FREQ[color] || [880, 1320];
      arr.forEach((f, i) => note({ freq: f, type: 'sine', start: i * 0.08, decay: 0.50, gain: 0.22 }));
      // a sparkly tail
      [1760, 2093, 2637].forEach((f, i) => note({ freq: f, type: 'triangle', start: 0.25 + i * 0.05, decay: 0.20, gain: 0.14 }));
    },
    bossEntrance: () => {
      wake();
      // Low descending rumble + dissonant overtones
      note({ freq: 110, freqEnd: 55, type: 'sawtooth', decay: 0.7, gain: 0.30 });
      note({ freq: 73, freqEnd: 36, type: 'square', start: 0.05, decay: 0.7, gain: 0.18 });
      noise({ gain: 0.20, decay: 0.6, lowpass: 600 });
    },
    // ---- Battle entrance jingles (Pokémon-style "DOO DOO DOO da DAH!" stings) ----
    // 'wild' is shorter and brighter; 'trainer' is longer and more dramatic.
    // Boss/Planeswalker fights use bossEntrance / planarBurst instead.
    battleStart: (kind) => {
      wake();
      if (kind === 'wild') {
        // Quick ascending arpeggio → bright "ta-da" chord, ~700ms total
        // Bass thump on the downbeat
        note({ freq: 130, type: 'sawtooth', start: 0, decay: 0.15, gain: 0.22 });
        noise({ start: 0, gain: 0.25, decay: 0.08, lowpass: 500 });
        // Rising lead line (G–C–E–G)
        [392, 523, 659, 784].forEach((f, i) =>
          note({ freq: f, type: 'square', start: 0.04 + i * 0.07, attack: 0.005, hold: 0.02, decay: 0.06, gain: 0.20 })
        );
        // Final chord stab (C-major triad held briefly)
        [523, 659, 784].forEach(f =>
          note({ freq: f, type: 'square', start: 0.36, attack: 0.005, hold: 0.05, decay: 0.28, gain: 0.20 })
        );
        // Bass landing note on the chord
        note({ freq: 196, type: 'sawtooth', start: 0.36, decay: 0.30, gain: 0.20 });
      } else {
        // Trainer: longer fanfare with a held final chord, ~1100ms total
        // Two percussive hits frame the phrase
        noise({ start: 0, gain: 0.30, decay: 0.10, lowpass: 400 });
        noise({ start: 0.48, gain: 0.30, decay: 0.14, lowpass: 400 });
        // Bass progression (i → V → i)
        note({ freq: 147, type: 'sawtooth', start: 0,    decay: 0.18, gain: 0.22 });
        note({ freq: 196, type: 'sawtooth', start: 0.24, decay: 0.18, gain: 0.20 });
        note({ freq: 147, type: 'sawtooth', start: 0.48, decay: 0.45, gain: 0.22 });
        // Lead line: descending then ascending fanfare with a final flourish
        [784, 659, 523, 659, 880, 1047].forEach((f, i) =>
          note({ freq: f, type: 'square', start: 0.05 + i * 0.07, attack: 0.005, hold: 0.02, decay: 0.07, gain: 0.20 })
        );
        // Final triumphant chord (Am-ish: A-C-E)
        [440, 523, 659, 880].forEach(f =>
          note({ freq: f, type: 'triangle', start: 0.55, attack: 0.01, hold: 0.10, decay: 0.40, gain: 0.20 })
        );
        // High sparkle on top of the final chord
        note({ freq: 1319, type: 'square', start: 0.65, decay: 0.25, gain: 0.14 });
      }
    },
    planarBurst: () => {
      wake();
      // The Planeswalker's signature: all five color clusters layered in fast succession
      ['W', 'U', 'B', 'R', 'G'].forEach((col, i) => {
        const arr = COLOR_FREQ[col] || [440];
        arr.forEach((f, j) => note({ freq: f * 1.5, type: 'triangle', start: i * 0.04 + j * 0.01, decay: 0.18, gain: 0.10 }));
      });
      noise({ gain: 0.30, decay: 0.4, lowpass: 3000, start: 0.1 });
    },
    fanfare: () => {
      wake();
      [392, 523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) =>
        note({ freq: f, type: 'square', start: i * 0.09, decay: 0.16, gain: 0.22 })
      );
    },
  };

  // === MUSIC: very simple loop-per-zone, layered triangle/square arp =========
  // Each track is a sequence of (freq, dur) tuples. We schedule them in batches with a
  // setInterval and a stop function. Switching tracks re-creates the schedule.
  const TRACKS = {
    town:    { tempo: 120, notes: [392, 0, 523, 0, 659, 0, 587, 0, 523, 0, 440, 0, 523, 0, 587, 0], type: 'triangle' },
    wilds:   { tempo: 96,  notes: [294, 0, 392, 0, 440, 0, 392, 0, 349, 0, 294, 0, 262, 0, 294, 0], type: 'triangle' },
    plains:  { tempo: 110, notes: [523, 659, 784, 659, 523, 659, 880, 659, 784, 659, 523, 392, 440, 523, 659, 784], type: 'sine' },
    sanctum: { tempo: 80,  notes: [262, 0, 311, 0, 392, 0, 466, 0, 392, 0, 311, 0, 262, 0, 233, 0], type: 'sine' },
    ashen:   { tempo: 130, notes: [220, 277, 330, 277, 220, 277, 330, 415, 330, 277, 220, 165, 196, 220, 277, 330], type: 'square' },
    umbral:  { tempo: 70,  notes: [196, 0, 233, 0, 277, 0, 233, 0, 196, 0, 175, 0, 196, 0, 220, 0], type: 'sawtooth' },
    boss:    { tempo: 140, notes: [110, 165, 196, 165, 110, 165, 220, 247, 220, 165, 110, 87, 110, 131, 165, 196], type: 'sawtooth' },
    final:   { tempo: 150, notes: [220, 261, 311, 392, 466, 392, 311, 261, 220, 196, 165, 196, 220, 261, 311, 392], type: 'square' },
    // ---- Title medley ----
    // 32-note main theme in C major. Four 8-step phrases:
    //   A. Statement — climbing from C up to C, quoting the town opening (C-E-G-C)
    //   B. Development — F-major detour echoing the plains lift
    //   C. Rising climax — G-mixolydian ascent reaching the high G
    //   D. Resolution — graceful descent back to root with a breath at the end
    // Triangle wave keeps it warm; tempo 105 gives a confident heroic pace (~9s loop).
    title:   { tempo: 105, notes: [
      // A — statement: "C-E-G-C-B-A-G-E"
      523, 659, 784, 1047, 988, 880, 784, 659,
      // B — development: "F-A-C-A-F-D-C-rest"
      698, 880, 1047, 880, 698, 587, 523, 0,
      // C — rising: "G-B-D-B-E-D-B-G" (climax on the high E)
      784, 988, 1175, 988, 1319, 1175, 988, 784,
      // D — resolution: "A-G-F-D-C-D-F-rest"
      880, 784, 698, 587, 523, 587, 698, 0,
    ], type: 'triangle' },
  };
  // Internal version — assumes the user has interacted and the context is available.
  const startMusicInternal = (key) => {
    if (music.key === key) return;
    stopMusic();
    const track = TRACKS[key];
    if (!track) return;
    const c = ensureCtx(); if (!c) return;
    music.key = key;
    const stepSec = 60 / track.tempo / 2; // 8th-note resolution
    let stepIdx = 0;
    let nextTime = c.currentTime + 0.05;
    // Schedule a window of 16 notes ahead at a time so we never starve.
    const tick = () => {
      // Stale-time recovery: if `nextTime` is behind the audio clock (e.g., the context was
      // suspended for a while or the tab was backgrounded), snap forward so we don't waste
      // schedules trying to play notes "in the past" — those silently get dropped, which used
      // to leave a long gap of silence after the user finally clicked. This is the bug fix.
      if (nextTime < c.currentTime) nextTime = c.currentTime + 0.05;
      const horizon = c.currentTime + 0.5;
      while (nextTime < horizon) {
        const f = track.notes[stepIdx % track.notes.length];
        if (f > 0) {
          note({ freq: f, type: track.type, start: nextTime - c.currentTime, attack: 0.01, hold: 0.01, decay: stepSec * 0.6, release: 0.02, gain: 0.18, dest: musicGain });
        }
        stepIdx++;
        nextTime += stepSec;
      }
    };
    tick();
    const id = setInterval(tick, 250);
    music.stopFn = () => clearInterval(id);
  };
  // Public — gracefully handles being called before any user interaction by queuing the
  // request. The queued track will start the moment wake() is called from the first gesture.
  const startMusic = (key) => {
    if (!userHasInteracted) {
      pendingMusicKey = key;
      return;
    }
    startMusicInternal(key);
  };
  const stopMusic = () => {
    if (music.stopFn) { music.stopFn(); music.stopFn = null; }
    music.key = null;
    // Also clear any queued pending music so we don't surprise-play an old track on next wake.
    pendingMusicKey = null;
  };

  return { sfx, wake, setMuted, isMuted, startMusic, stopMusic };
})();

// ---------- Persistent storage ----------
const SAVE_KEY = 'gtm:save:v1';
let lastSaveFailure = null;
let rateLimitBackoffUntil = 0;
async function saveGame(state) {
  lastSaveFailure = null;
  if (typeof window === 'undefined' || !window.storage) {
    lastSaveFailure = 'storage API unavailable';
    return false;
  }
  if (Date.now() < rateLimitBackoffUntil) {
    const secs = Math.ceil((rateLimitBackoffUntil - Date.now()) / 1000);
    lastSaveFailure = `rate limit cooldown (${secs}s left)`;
    return false;
  }

  // Build payload defensively — if anything in `state` can't be serialized, catch it here.
  let payload;
  try {
    payload = JSON.stringify(state);
  } catch (e) {
    lastSaveFailure = `payload not serializable: ${e?.message || e}`;
    console.error('[GtM]', lastSaveFailure, state);
    return false;
  }

  if (payload.length > 4_500_000) {
    lastSaveFailure = `payload too large (${payload.length} bytes)`;
    return false;
  }

  console.log('[GtM] saving payload, size:', payload.length);
  try {
    const r = await window.storage.set(SAVE_KEY, payload);
    console.log('[GtM] storage.set returned:', r);
    // Per docs: set returns {key, value, shared} on success, or null on failure.
    // We accept any object response with the matching key as success — the API may
    // not always echo back the full value for large payloads.
    if (r && typeof r === 'object' && r.key === SAVE_KEY) return true;
    if (r === null || r === undefined) {
      lastSaveFailure = 'rate limited';
      rateLimitBackoffUntil = Date.now() + 10 * 60 * 1000;
      return false;
    }
    // Got something else — try reading back to confirm the write happened.
    try {
      const verify = await window.storage.get(SAVE_KEY);
      if (verify?.value === payload) return true;
    } catch (e) { /* fall through */ }
    lastSaveFailure = `unexpected response: ${JSON.stringify(r).slice(0, 80)}`;
    return false;
  } catch (e) {
    const msg = e?.message || String(e);
    lastSaveFailure = msg;
    if (/rate[ -]?limit|too many|429/i.test(msg)) {
      rateLimitBackoffUntil = Date.now() + 10 * 60 * 1000;
    }
    console.error('[GtM] saveGame threw:', e);
    return false;
  }
}
function getLastSaveFailure() { return lastSaveFailure; }
function isRateLimited() { return Date.now() < rateLimitBackoffUntil; }
async function loadGame() {
  try {
    if (typeof window !== 'undefined' && window.storage) {
      const r = await window.storage.get(SAVE_KEY);
      if (r?.value) return JSON.parse(r.value);
    }
  } catch (e) {
    console.error('[GtM] loadGame failed:', e);
  }
  return null;
}
async function clearSave() {
  try {
    if (typeof window !== 'undefined' && window.storage) {
      await window.storage.delete(SAVE_KEY);
    }
  } catch (e) {
    console.error('[GtM] clearSave failed:', e);
  }
}

// =========================================================================
// COMPONENT
// =========================================================================
export default function GatheringTheMagic() {
  // ---- meta ----
  const [scene, setScene] = useState('title'); // title | world | battle | menu | dialog | starter
  const [loaded, setLoaded] = useState(false);
  const [hasSave, setHasSave] = useState(false);
  const [storageBroken, setStorageBroken] = useState(false);
  const [storageDiag, setStorageDiag] = useState([]); // diagnostic lines from probe

  // ---- world state ----
  const [currentMap, setCurrentMap] = useState('town');
  const [player, setPlayer] = useState({ x: 7, y: 11, face: 'down' });
  const [team, setTeam] = useState([]);
  const [codex, setCodex] = useState({}); // { id: { caught: n, seen: n } }
  const [defeated, setDefeated] = useState([]); // npc ids
  // How many times the player has cleared all five zone trainers. Each cycle the trainer
  // teams reroll fresh from the zone pool with levels = base + (2 × cycles).
  const [trainerCycles, setTrainerCycles] = useState(0);
  // Color medallions earned by defeating each shrine boss (e.g. ['G','U']).
  const [medallions, setMedallions] = useState([]);
  // True after defeating The Planeswalker. Unlocks the Champion badge on the commander
  // and grants a one-time "learn any move" event.
  const [planeswalkerDefeated, setPlaneswalkerDefeated] = useState(false);
  // Pending: when set, the player is choosing a single attack to permanently learn
  // (post-Planeswalker reward). Closed by the championLearn UI.
  const [championLearnPending, setChampionLearnPending] = useState(false);
  const [tokens, setTokens] = useState(5); // Creature Cards (used to catch creatures)
  const [gold, setGold] = useState(0);
  const [items, setItems] = useState({ potion: 2 }); // consumable items inventory
  const [mode, setMode] = useState('classic'); // 'classic' | 'commander'
  const [commanderColor, setCommanderColor] = useState(''); // color identity string of chosen starter, e.g. 'W', 'WU', 'WUBRG'

  // ---- transient ----
  const [battle, setBattle] = useState(null);
  const [dialog, setDialog] = useState(null); // { lines: [], onDone }
  const [toast, setToast] = useState(null);

  // ---- canvas ref ----
  const canvasRef = useRef(null);
  const stepLock = useRef(false);

  // ---------- Initial load ----------
  useEffect(() => {
    (async () => {
      const diag = [];
      const log = (s) => { console.log('[GtM]', s); diag.push(s); };
      let broken = false;
      try {
        if (typeof window === 'undefined' || !window.storage) {
          log('window.storage: NOT PRESENT');
          broken = true;
        } else {
          log('window.storage: present');
          // Examine the API surface
          const methods = ['set', 'get', 'delete', 'list'].filter(m => typeof window.storage[m] === 'function');
          log(`Methods available: ${methods.join(', ') || 'NONE'}`);
          const testKey = 'gtm:probe';
          const testVal = 'hello-' + Date.now();
          log(`Trying: set('${testKey}', '${testVal}')`);
          let setResult;
          try {
            setResult = await window.storage.set(testKey, testVal);
            log(`set returned: ${JSON.stringify(setResult)?.slice(0, 120)}`);
            log(`typeof setResult: ${typeof setResult}`);
          } catch (e) {
            log(`set threw: ${e?.message || e}`);
            broken = true;
          }
          if (!broken) {
            try {
              const readResult = await window.storage.get(testKey);
              log(`get returned: ${JSON.stringify(readResult)?.slice(0, 120)}`);
              if (readResult?.value === testVal) {
                log('Round-trip OK — storage is working.');
              } else {
                log(`Round-trip MISMATCH (expected ${testVal})`);
                broken = true;
              }
            } catch (e) {
              log(`get threw: ${e?.message || e}`);
              broken = true;
            }
          }
        }
      } catch (e) {
        log(`Outer error: ${e?.message || e}`);
        broken = true;
      }
      setStorageDiag(diag);
      setStorageBroken(broken);
      if (!broken) {
        try {
          const s = await loadGame();
          if (s) setHasSave(true);
        } catch (e) { /* no save yet, fine */ }
      }
      setLoaded(true);
    })();
  }, []);

  // ---------- Saves ----------
  // Saves fire only at meaningful milestones: battle end, map change, and explicit Save & Quit.
  // No state-change or periodic autosave — Claude's storage API is rate-limited (~100 writes/hour),
  // so we stay well under by saving only at events the player actually cares about persisting.
  const currentStateRef = useRef(null);
  // Keep a ref of the latest state so save callbacks always grab fresh values.
  useEffect(() => {
    currentStateRef.current = { currentMap, player, team, codex, defeated, tokens, gold, items, mode, commanderColor, trainerCycles, medallions, planeswalkerDefeated };
  }, [currentMap, player, team, codex, defeated, tokens, gold, items, mode, commanderColor, trainerCycles, medallions, planeswalkerDefeated]);

  const performSave = async () => {
    const snap = currentStateRef.current;
    if (!snap) return false;
    return await saveGame({ ...snap, scene: 'world' });
  };

  // ---------- Start new / continue ----------
  const startNew = () => {
    audio.wake();
    setCurrentMap('town'); setPlayer({ x: 7, y: 11, face: 'down' });
    setTeam([]); setCodex({}); setDefeated([]); setTokens(5); setGold(60); setItems({ potion: 2 });
    setMode('classic'); setCommanderColor(""); setTrainerCycles(0);
    setMedallions([]); setPlaneswalkerDefeated(false); setChampionLearnPending(false);
    setScene('modeSelect');
  };
  const pickMode = (chosenMode) => {
    setMode(chosenMode);
    setScene('starter');
  };
  const continueSave = async () => {
    audio.wake();
    try {
      const s = await loadGame();
      if (!s) {
        showToast('No save found.');
        return;
      }
      if (!s.team || s.team.length === 0) {
        showToast('Save has no team.');
        return;
      }
      setCurrentMap(s.currentMap || 'town');
      setPlayer(s.player || { x: 7, y: 11, face: 'down' });
      setTeam(s.team);
      setCodex(s.codex || {});
      setDefeated(s.defeated || []);
      setTokens(s.tokens ?? 5);
      setGold(s.gold ?? 0);
      setItems(s.items ?? { potion: 2 });
      setMode(s.mode || 'classic');
      setCommanderColor(s.commanderColor || "");
      setTrainerCycles(s.trainerCycles || 0);
      setMedallions(s.medallions || []);
      setPlaneswalkerDefeated(!!s.planeswalkerDefeated);
      setScene(s.scene === 'battle' ? 'world' : (s.scene || 'world'));
    } catch (err) {
      showToast('Load failed: ' + (err?.message || 'unknown error'));
    }
  };

  const pickStarter = (id) => {
    // Starter level 4 (was 5) so commander-mode players actually hit the level-5 graft milestone.
    const starter = createCreature(id, 4);
    if (mode === 'commander') {
      // Initialize commander grafting state on the starter creature
      const startColors = colorsOf(DEX[id].c);
      starter.colorAddOrder = startColors;        // order in which colors joined the identity
      starter.colorPenalties = {};                // per-color damage multipliers
      for (const c of startColors) starter.colorPenalties[c] = 1.0;
      starter.graftLocked = startColors.length >= 5;  // 5-color avatar is locked from the start
      setCommanderColor(DEX[id].c);
    }
    setTeam([starter]);
    setCodex({ [id]: { caught: 1, seen: 1 } });
    setScene('world');
    showToast(`Summoned ${starter.name}! (Progress autosaves.)`);
  };

  // ---------- Toast ----------
  const toastTimer = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  // ---------- Movement ----------
  const move = useCallback((dir) => {
    if (scene !== 'world' || stepLock.current) return;
    stepLock.current = true;
    setTimeout(() => { stepLock.current = false; }, 120);

    setPlayer((pp) => {
      let nx = pp.x, ny = pp.y, face = dir;
      if (dir === 'up') ny--;
      if (dir === 'down') ny++;
      if (dir === 'left') nx--;
      if (dir === 'right') nx++;
      const t = tileAt(currentMap, nx, ny);
      if (!isWalkable(t)) return { ...pp, face };

      // Block on NPCs
      const npcList = currentMap === 'town' ? NPCS_TOWN : (NPCS_ZONE[currentMap] || []);
      if (npcList.some(n => n.x === nx && n.y === ny)) return { ...pp, face };

      // ---- Building entrance ('B') — only enterable after first full zone-trainer clear ----
      if (t === 'B') {
        const shrineData = SHRINE_DATA[currentMap];
        if (!shrineData) return { ...pp, face };
        if (trainerCycles < 1) {
          // First-clear gating: dialog instead of free entry.
          setTimeout(() => setDialog({
            lines: [`The way is sealed by an unseen ward. The Lorekeeper says these gates open only for those who have proven themselves to all five zone challengers.`],
            onDone: () => setDialog(null),
          }), 50);
          return { ...pp, face };
        }
        // Already collected this medallion? Let the player wander in and out freely.
        const enteringDialog = medallions.includes(shrineData.color)
          ? `${shrineData.label} stands silent. The warden has been laid to rest.`
          : shrineData.dialog;
        setTimeout(() => setDialog({
          lines: [enteringDialog],
          onDone: () => {
            setDialog(null);
            setCurrentMap(shrineData.mapId);
            // Place player just inside the entrance (tile above the 'E' exit at row H-1).
            const im = MAPS[shrineData.mapId].tiles;
            setPlayer({ x: 5, y: im.length - 2, face: 'up' });
            if (!isRateLimited()) setTimeout(() => performSave(), 250);
          },
        }), 50);
        return { ...pp, face };
      }

      // ---- Legendary boss tile ('L') — inside a shrine only ----
      if (t === 'L') {
        const zoneId = SHRINE_TO_ZONE[currentMap];
        const sd = zoneId && SHRINE_DATA[zoneId];
        if (!sd) return { ...pp, face };
        // If medallion already taken, treat L as a normal floor tile (walk through).
        if (medallions.includes(sd.color)) {
          return { x: nx, y: ny, face };
        }
        // Otherwise: trigger the legendary fight. Player visually steps onto the tile first.
        setTimeout(() => triggerLegendaryBattle(zoneId), 100);
        return { x: nx, y: ny, face };
      }

      // Exit transitions — route based on the edge of the current map
      if (t === 'E') {
        const mapDef = MAPS[currentMap];
        const mw = mapDef.tiles[0].length, mh = mapDef.tiles.length;
        // Schedule a save after the map transition settles.
        const saveAfterTransition = () => {
          if (!isRateLimited()) setTimeout(() => performSave(), 250);
        };
        // From town, route by which edge we stepped onto
        if (currentMap === 'town') {
          if (ny >= mh - 1) {
            // Two south exits: SW (cols 1-3) → Plains, S (cols 6-8) → Wilds
            if (nx <= 3) { setCurrentMap('plains'); saveAfterTransition(); return { x: 13, y: 1, face: 'down' }; }
            setCurrentMap('wilds');   saveAfterTransition(); return { x: 7, y: 1, face: 'down' };
          }
          if (ny <= 0)           { setCurrentMap('umbral');  saveAfterTransition(); return { x: 7, y: mh - 2, face: 'up' }; }
          if (nx >= mw - 1)      { setCurrentMap('ashen');   saveAfterTransition(); return { x: 1, y: 6, face: 'right' }; }
          if (nx <= 0)           { setCurrentMap('sanctum'); saveAfterTransition(); return { x: mw - 2, y: 6, face: 'left' }; }
        }
        // From any zone back to town, use the reciprocal entry point
        if (currentMap === 'wilds')   { setCurrentMap('town'); saveAfterTransition(); return { x: 7, y: 11, face: 'up' }; }
        if (currentMap === 'ashen')   { setCurrentMap('town'); saveAfterTransition(); return { x: 14, y: 6, face: 'left' }; }
        if (currentMap === 'sanctum') { setCurrentMap('town'); saveAfterTransition(); return { x: 1, y: 6, face: 'right' }; }
        if (currentMap === 'umbral')  { setCurrentMap('town'); saveAfterTransition(); return { x: 7, y: 1, face: 'down' }; }
        if (currentMap === 'plains')  { setCurrentMap('town'); saveAfterTransition(); return { x: 2, y: 11, face: 'up' }; }
        // ---- From a shrine interior, step out to the parent zone, just below its 'B' tile ----
        const parentZone = SHRINE_TO_ZONE[currentMap];
        if (parentZone) {
          // Find the 'B' coords in the parent zone map and place the player one tile away from it.
          const parentTiles = MAPS[parentZone].tiles;
          let bx = -1, by = -1;
          for (let yy = 0; yy < parentTiles.length && bx < 0; yy++) {
            for (let xx = 0; xx < parentTiles[0].length && bx < 0; xx++) {
              if (parentTiles[yy][xx] === 'B') { bx = xx; by = yy; }
            }
          }
          // Pick a walkable tile adjacent to (bx,by). We try the four cardinal neighbors.
          let outX = 7, outY = 7;
          if (bx >= 0) {
            const tries = [[bx, by + 1], [bx, by - 1], [bx - 1, by], [bx + 1, by]];
            for (const [tx, ty] of tries) {
              if (ty < 0 || ty >= parentTiles.length) continue;
              if (tx < 0 || tx >= parentTiles[0].length) continue;
              const tt = parentTiles[ty][tx];
              if (isWalkable(tt) && tt !== 'B' && tt !== 'E') {
                outX = tx; outY = ty;
                break;
              }
            }
          }
          setCurrentMap(parentZone); saveAfterTransition();
          return { x: outX, y: outY, face: 'down' };
        }
      }

      // Encounter? (Skip in shrine interiors — those have no ambient encounters; only the boss.)
      if (!SHRINE_TO_ZONE[currentMap] && hasEncounter(t) && Math.random() < 0.16) {
        setTimeout(() => triggerWildEncounter(), 100);
      }
      // Soft step click — quiet enough not to fatigue, alternates pitch via the closure inside audio.
      audio.sfx.step();
      return { x: nx, y: ny, face };
    });
  }, [scene, currentMap, trainerCycles, medallions]);

  // ---------- Interact ----------
  const interact = useCallback(() => {
    if (scene !== 'world') return;
    const p = player;
    let tx = p.x, ty = p.y;
    if (p.face === 'up') ty--;
    if (p.face === 'down') ty++;
    if (p.face === 'left') tx--;
    if (p.face === 'right') tx++;
    const t = tileAt(currentMap, tx, ty);

    // Shrine — heals normally, but if the player has all 5 medallions, becomes the
    // gateway to The Planeswalker (the final boss).
    if (t === 's') {
      const allMedallions = ['W','U','B','R','G'].every(c => medallions.includes(c));
      if (allMedallions && !planeswalkerDefeated) {
        // Final boss prompt
        setDialog({
          lines: [
            "Five medallions, five wakings. The shrine flares to life beneath your fingertips.",
            "A figure crystallizes at the heart of the light — eyes burning with all five colors.",
            "\"You've gathered the magic. Now spend it.\" — The Planeswalker draws its spark.",
          ],
          onDone: () => { setDialog(null); startPlaneswalkerBattle(); },
        });
        return;
      }
      if (allMedallions && planeswalkerDefeated) {
        // Champion shrine — flavor + heal
        setTeam((tm) => tm.map(c => ({ ...c, hp: c.maxHp, status: null })));
        audio.sfx.heal();
        showToast('The shrine hums in recognition. Your team is restored.');
        return;
      }
      setTeam((tm) => tm.map(c => ({ ...c, hp: c.maxHp, status: null })));
      audio.sfx.heal();
      showToast('The shrine restores your team.');
      return;
    }

    // NPC interaction (town or zone)
    const npcList = currentMap === 'town' ? NPCS_TOWN : (NPCS_ZONE[currentMap] || []);
    const n = npcList.find(n => n.x === tx && n.y === ty);
    if (n) {
      if (n.isShop) {
        setDialog({
          lines: [`${n.name}: "${n.dialog}"`],
          onDone: () => { setDialog(null); setScene('shop'); }
        });
      } else if (n.noBattle) {
        setDialog({ lines: [`${n.name}: "${n.dialog}"`], onDone: () => setDialog(null) });
      } else if (defeated.includes(n.id)) {
        const isZone = ZONE_TRAINER_IDS.has(n.id);
        const line = isZone
          ? `${n.name}: "I'll be ready next time you make the rounds. Beat all five of us and we'll meet again, sharper."`
          : `${n.name}: "You already bested me, friend. Safe travels."`;
        setDialog({ lines: [line], onDone: () => setDialog(null) });
      } else {
        setDialog({
          lines: [`${n.name}: "${n.dialog}"`],
          onDone: () => { setDialog(null); startTrainerBattle(n); }
        });
      }
    }
  }, [scene, player, currentMap, defeated, medallions, planeswalkerDefeated]);

  // ---------- Battle refs (always read latest state) ----------
  const battleRef = useRef(null);
  const teamRef = useRef([]);
  useEffect(() => { battleRef.current = battle; }, [battle]);
  useEffect(() => { teamRef.current = team; }, [team]);

  // ---- Global audio wake on first user gesture ----
  // Browsers gate audio on user interaction. We listen at the document level for any tap/
  // click/key event (capture phase + passive where allowed) and fire audio.wake() — which
  // creates the AudioContext on the first gesture and resumes it on subsequent ones if the
  // tab was backgrounded. Without this, opening the game via a shared link (where the user
  // might wait a beat before clicking anything) could leave audio permanently disabled.
  useEffect(() => {
    const handler = () => audio.wake();
    const opts = { capture: true };
    document.addEventListener('pointerdown', handler, opts);
    document.addEventListener('touchstart', handler, { capture: true, passive: true });
    document.addEventListener('keydown', handler, opts);
    return () => {
      document.removeEventListener('pointerdown', handler, opts);
      document.removeEventListener('touchstart', handler, { capture: true });
      document.removeEventListener('keydown', handler, opts);
    };
  }, []);

  // ---- Music selection ----
  // When in battle, music depends on what kind of fight; in the world it depends on the map.
  // Boss music (legendary/planeswalker) overrides everything else. Deps are intentionally narrow
  // so this only fires when the track *should* change — startMusic() is also idempotent on key match.
  // While `battle.intro` is true the music is suppressed so the entrance jingle can play uncluttered;
  // when the intro flips to false this effect re-fires and the appropriate battle theme starts.
  const battleKind = battle?.kind || null;
  const battleIntro = !!battle?.intro;
  useEffect(() => {
    if (scene === 'battle' && battleKind) {
      if (battleIntro) {
        // Hold music — the entrance toon owns this moment.
        audio.stopMusic();
        return;
      }
      if (battleKind === 'planeswalker') audio.startMusic('final');
      else if (battleKind === 'legendary') audio.startMusic('boss');
      else audio.startMusic(SHRINE_TO_ZONE[currentMap] ? 'boss' : (currentMap === 'town' ? 'wilds' : currentMap));
      return;
    }
    if (scene === 'world') {
      // Shrine interiors share boss-music tension even before encountering the boss.
      if (SHRINE_TO_ZONE[currentMap]) audio.startMusic('boss');
      else audio.startMusic(currentMap);
      return;
    }
    // Pre-game scenes (title, mode select, starter) all share the title medley for a
    // continuous lead-in. Note: browsers block audio until the first user gesture, so
    // a brand-new player sees a silent title screen, but as soon as they click any
    // button the track starts (and continues uninterrupted through modeSelect → starter).
    if (scene === 'title' || scene === 'modeSelect' || scene === 'starter') {
      audio.startMusic('title');
      return;
    }
    // Pause menu and shop: silence is intentional — they're brief modal states.
    audio.stopMusic();
  }, [scene, currentMap, battleKind, battleIntro]);

  const firstAlive = (tm) => tm.findIndex(c => c.hp > 0);

  const triggerWildEncounter = () => {
    const tm = teamRef.current;
    if (tm.length === 0 || firstAlive(tm) < 0) return;
    const pool = ZONE_POOLS[currentMap] || ZONE_POOLS.wilds;
    const pick = weightedPick(pool);
    const lv = pick.lv[0] + Math.floor(Math.random() * (pick.lv[1] - pick.lv[0] + 1));
    const enemy = createCreature(pick.id, lv);
    setCodex((cx) => ({ ...cx, [pick.id]: { caught: cx[pick.id]?.caught || 0, seen: (cx[pick.id]?.seen || 0) + 1 }}));
    setBattle({
      kind: 'wild',
      enemyTeam: [enemy],
      enemyIdx: 0,
      myIdx: firstAlive(tm),
      log: [`A wild ${enemy.name} appeared!`],
      turn: 'player',
      intro: true,
    });
    setScene('battle');
    // Wild battle entrance jingle (~700ms) — plays solo while music is suppressed by the intro flag.
    audio.sfx.battleStart('wild');
    // After ~1s, drop the intro flag so move buttons activate AND battle music fades in.
    setTimeout(() => {
      setBattle(b => b ? { ...b, intro: false } : b);
    }, 1000);
  };

  const startTrainerBattle = (npc) => {
    const tm = teamRef.current;
    // Zone trainers get a fresh team each fight (rerolled from zone pool, scaled by cycles).
    // Town trainers (Bran/Ria/Dax) keep their fixed teams as a stable starter benchmark.
    const teamSpec = ZONE_TRAINER_IDS.has(npc.id) ? generateTrainerTeam(npc, trainerCycles) : npc.team;
    const et = teamSpec.map(c => createCreature(c.id, c.lv));
    et.forEach(e => {
      setCodex((cx) => ({ ...cx, [e.id]: { caught: cx[e.id]?.caught || 0, seen: (cx[e.id]?.seen || 0) + 1 }}));
    });
    setBattle({
      kind: 'trainer',
      npc,
      enemyTeam: et,
      enemyIdx: 0,
      myIdx: Math.max(0, firstAlive(tm)),
      log: [`${npc.name} wants to duel!`, `${npc.name} sends out ${et[0].name}!`],
      turn: 'player',
      intro: true,
    });
    setScene('battle');
    // Trainer entrance jingle (~1100ms) — slightly longer/more dramatic than wild.
    audio.sfx.battleStart('trainer');
    // Hold the intro a bit longer than wild so the trainer fanfare plays out before music.
    setTimeout(() => {
      setBattle(b => b ? { ...b, intro: false } : b);
    }, 1300);
  };

  // ---------- Legendary boss battle (single mono-color creature, awards a medallion on win) ----------
  const triggerLegendaryBattle = (zoneId) => {
    const sd = SHRINE_DATA[zoneId];
    if (!sd) return;
    const tm = teamRef.current;
    const boss = createCreature(sd.bossId, sd.bossLv);
    setCodex((cx) => ({ ...cx, [boss.id]: { caught: cx[boss.id]?.caught || 0, seen: (cx[boss.id]?.seen || 0) + 1 }}));
    setBattle({
      kind: 'legendary',
      zoneId,
      shrineColor: sd.color,
      enemyTeam: [boss],
      enemyIdx: 0,
      myIdx: Math.max(0, firstAlive(tm)),
      log: [
        `${boss.name} stirs from its long sleep!`,
        `Its eyes lock on you — there's no walking away from this.`,
      ],
      turn: 'player',
      intro: true,
      bossKind: 'legendary',
    });
    setScene('battle');
    audio.sfx.bossEntrance();
    setTimeout(() => {
      setBattle(b => b ? { ...b, intro: false } : b);
    }, 1200);
  };

  // ---------- Final boss: The Planeswalker (WUBRG) ----------
  const startPlaneswalkerBattle = () => {
    const tm = teamRef.current;
    // Final boss draws power from all five medallions — bumped slightly above any legendary.
    const boss = createCreature('the_planeswalker', 32);
    setCodex((cx) => ({ ...cx, [boss.id]: { caught: cx[boss.id]?.caught || 0, seen: (cx[boss.id]?.seen || 0) + 1 }}));
    setBattle({
      kind: 'planeswalker',
      enemyTeam: [boss],
      enemyIdx: 0,
      myIdx: Math.max(0, firstAlive(tm)),
      log: [
        `THE PLANESWALKER manifests in a halo of five colors!`,
        `"Show me the magic you've gathered."`,
      ],
      turn: 'player',
      intro: true,
      bossKind: 'planeswalker',
    });
    setScene('battle');
    audio.sfx.bossEntrance();
    setTimeout(() => audio.sfx.planarBurst(), 600);
    setTimeout(() => {
      setBattle(b => b ? { ...b, intro: false } : b);
    }, 1500);
  };

  // ---------- Pure move application (no setState) ----------
  function applyMove(b, t, side, moveKey) {
    let attacker, defender;
    const newTeam = [...t];
    const newEnemyTeam = [...b.enemyTeam];
    if (side === 'player') { attacker = t[b.myIdx]; defender = b.enemyTeam[b.enemyIdx]; }
    else { attacker = b.enemyTeam[b.enemyIdx]; defender = t[b.myIdx]; }
    const move = MOVES[moveKey];
    const lines = [`${attacker.name} used ${move.name}!`];

    if (move.heal) {
      const h = Math.floor(attacker.maxHp * move.heal);
      const healed = { ...attacker, hp: Math.min(attacker.maxHp, attacker.hp + h) };
      if (side === 'player') newTeam[b.myIdx] = healed;
      else newEnemyTeam[b.enemyIdx] = healed;
      lines.push(`Restored ${h} HP.`);
      audio.sfx.heal();
      return { newTeam, newEnemyTeam, lines };
    }

    // Cue the spell-color flavor as soon as the move is resolved.
    audio.sfx.attack(move.c);
    const res = calcDamage(attacker, defender, move);
    if (res.missed) {
      lines.push('It missed!');
      audio.sfx.miss();
      return { newTeam, newEnemyTeam, lines };
    }
    const hurt = { ...defender, hp: Math.max(0, defender.hp - res.dmg) };
    if (side === 'player') newEnemyTeam[b.enemyIdx] = hurt;
    else newTeam[b.myIdx] = hurt;
    // Layer the impact stinger; crits and super-effectives get a louder one.
    if (res.crit) audio.sfx.crit();
    else audio.sfx.hit();
    if (res.mult > 1) { lines.push("It's devastatingly effective!"); audio.sfx.superEffective(); }
    else if (res.mult < 1) { lines.push('It barely lands.'); audio.sfx.notVeryEffective(); }
    if (res.crit) lines.push('A critical hit!');
    lines.push(`${defender.name} took ${res.dmg} damage.`);
    if (move.drain) {
      const drainAmt = Math.floor(res.dmg * move.drain);
      const current = side === 'player' ? newTeam[b.myIdx] : newEnemyTeam[b.enemyIdx];
      const atkHealed = { ...current, hp: Math.min(current.maxHp, current.hp + drainAmt) };
      if (side === 'player') newTeam[b.myIdx] = atkHealed;
      else newEnemyTeam[b.enemyIdx] = atkHealed;
      lines.push(`${attacker.name} drained ${drainAmt} HP.`);
    }
    // Status infliction (only if defender still alive)
    if (move.status && hurt.hp > 0 && !hurt.status) {
      if (Math.random() * 100 < move.status.chance) {
        if (isImmuneToStatus(hurt, move.status.kind)) {
          lines.push(`${hurt.name} is immune to ${STATUSES[move.status.kind].name.toLowerCase()}.`);
        } else {
          const withStatus = applyStatus(hurt, move.status.kind);
          if (side === 'player') newEnemyTeam[b.enemyIdx] = withStatus;
          else newTeam[b.myIdx] = withStatus;
          lines.push(`${hurt.name} was afflicted with ${STATUSES[move.status.kind].name}!`);
          audio.sfx.statusApply();
        }
      }
    }
    return { newTeam, newEnemyTeam, lines };
  }

  // Apply XP and any resulting level-ups to a single creature.
  // Returns { creature, lines, pendingLearns, pendingGrafts }.
  // `treatAsCommander` controls whether commander graft milestones fire — true only for
  // the commander (slot 0 in commander mode) regardless of whether they were the active fighter.
  function applyXpToCreature(c, gain, treatAsCommander) {
    let cur = { ...c, xp: c.xp + gain };
    const lines = [];
    const pendingLearns = [];
    const pendingGrafts = [];
    while (cur.xp >= xpToNext(cur.level)) {
      cur.xp -= xpToNext(cur.level);
      cur.level += 1;
      const hpGain = 4;
      cur.maxHp += hpGain;
      // Heal for the level-up gain ONLY if the creature is still conscious. Fainted creatures
      // gain max HP and the new level, but stay at 0 — they still need a revive to be useful.
      if (cur.hp > 0) cur.hp = Math.min(cur.maxHp, cur.hp + hpGain);
      lines.push(`${cur.name} grew to Lv. ${cur.level}!`);
      // Evolution check (skipped for commander — they evolve via grafting)
      const evo = DEX[cur.id]?.evo;
      if (evo && cur.level >= evo.at && !treatAsCommander) {
        const oldName = cur.name;
        cur = evolveCreature(cur, evo.to);
        lines.push(`✨ ${oldName} evolved into ${cur.name}!`);
      }
      // Learnset check (uses current form id, which may have just changed via evo)
      const moveKey = DEX[cur.id]?.learnset?.[cur.level];
      if (moveKey && !cur.moves.includes(moveKey)) {
        if (cur.moves.length < 4) {
          cur = { ...cur, moves: [...cur.moves, moveKey] };
          lines.push(`${cur.name} learned ${MOVES[moveKey].name}!`);
        } else {
          pendingLearns.push({ uid: cur.uid, move: moveKey });
          lines.push(`${cur.name} wants to learn ${MOVES[moveKey].name}...`);
        }
      }
      // Commander color-graft milestones (5/10/15/20)
      if (treatAsCommander && !cur.graftLocked && [5, 10, 15, 20].includes(cur.level)) {
        const cols = colorsOf(cur.c);
        if (cols.length < 5) {
          pendingGrafts.push({ uid: cur.uid, level: cur.level, kind: 'color' });
          lines.push(`✦ ${cur.name} stands at a crossroads...`);
        }
      }
      // Commander attack-graft milestones (6/11/16/21)
      if (treatAsCommander && [6, 11, 16, 21].includes(cur.level)) {
        pendingGrafts.push({ uid: cur.uid, level: cur.level, kind: 'attack' });
        lines.push(`✦ ${cur.name} feels new magic stirring...`);
      }
    }
    return { creature: cur, lines, pendingLearns, pendingGrafts };
  }

  // Grant battle XP. The active fighter takes 70% (rounded up) and the rest splits evenly
  // across the other party members (alive or fainted). If the player has no other creatures,
  // the active fighter takes 100%. Any rounding leftover from the floored split is rolled
  // back to the active fighter so no XP is "lost".
  function grantXP(t, myIdx, enemy) {
    const totalGain = 8 + enemy.level * 4;
    const otherIndices = t.map((_, i) => i).filter(i => i !== myIdx);
    const winnerShare = Math.ceil(totalGain * 0.7);
    const sharedPool = totalGain - winnerShare;
    const perOther = otherIndices.length > 0 ? Math.floor(sharedPool / otherIndices.length) : 0;
    const leftover = otherIndices.length > 0 ? sharedPool - (perOther * otherIndices.length) : sharedPool;
    const winnerGain = winnerShare + leftover;
    const newTeam = [...t];
    const lines = [`${t[myIdx].name} gained ${winnerGain} XP.`];
    const pendingLearns = [];
    const pendingGrafts = [];

    // --- Winner ---
    {
      const isCommander = mode === 'commander' && myIdx === 0;
      const r = applyXpToCreature(t[myIdx], winnerGain, isCommander);
      newTeam[myIdx] = r.creature;
      lines.push(...r.lines);
      pendingLearns.push(...r.pendingLearns);
      pendingGrafts.push(...r.pendingGrafts);
    }

    // --- Others (XP share) ---
    if (perOther > 0 && otherIndices.length > 0) {
      // Concise summary line so the battle log doesn't drown in per-creature XP messages.
      lines.push(`Other party members each gained ${perOther} XP.`);
      for (const i of otherIndices) {
        const isCommanderSlot = mode === 'commander' && i === 0;
        const r = applyXpToCreature(t[i], perOther, isCommanderSlot);
        newTeam[i] = r.creature;
        // Only surface notable events (level-ups, evolutions, learns, grafts) — XP gain
        // itself is already covered by the summary line above.
        lines.push(...r.lines);
        pendingLearns.push(...r.pendingLearns);
        pendingGrafts.push(...r.pendingGrafts);
      }
    }

    return { newTeam, lines, pendingLearns, pendingGrafts };
  }

  // After applying a move, handle faints/victory/switch-prompt, and enqueue next turn
  function postStep(newBattle, newTeam, sideActing) {
    // End-of-turn status tick on the creature that just acted
    let b = newBattle;
    let t = newTeam;
    const lines = [...newBattle.log];
    if (sideActing === 'player') {
      const actor = t[b.myIdx];
      const { newCreature, lines: tickLines } = tickStatusEnd(actor);
      if (tickLines.length > 0) lines.push(...tickLines);
      if (newCreature !== actor) {
        t = [...t]; t[b.myIdx] = newCreature;
      }
    } else {
      const actor = b.enemyTeam[b.enemyIdx];
      const { newCreature, lines: tickLines } = tickStatusEnd(actor);
      if (tickLines.length > 0) lines.push(...tickLines);
      if (newCreature !== actor) {
        const newEnemyTeam = [...b.enemyTeam]; newEnemyTeam[b.enemyIdx] = newCreature;
        b = { ...b, enemyTeam: newEnemyTeam };
      }
    }
    b = { ...b, log: lines };
    const enemy = b.enemyTeam[b.enemyIdx];
    const me = t[b.myIdx];

    if (enemy.hp <= 0) {
      lines.push(`${enemy.name} fainted!`);
      audio.sfx.faint();
      const { newTeam: afterXP, lines: xpLines, pendingLearns, pendingGrafts } = grantXP(t, b.myIdx, enemy);
      lines.push(...xpLines);
      // Distinct cues for level/learn/graft milestones — ordered by importance.
      if (pendingGrafts.length > 0) setTimeout(() => audio.sfx.grafted(), 250);
      else if (pendingLearns.length > 0) setTimeout(() => audio.sfx.learnMove(), 250);
      else if (xpLines.some(l => /grew to Lv\.|leveled up/i.test(l))) setTimeout(() => audio.sfx.levelUp(), 200);
      const allPending = [...(b.pendingLearns || []), ...pendingLearns];
      const allGrafts = [...(b.pendingGrafts || []), ...pendingGrafts];
      const nextIdx = b.enemyIdx + 1;
      if (b.kind === 'trainer' && nextIdx < b.enemyTeam.length) {
        const next = b.enemyTeam[nextIdx];
        lines.push(`${b.npc.name} sends out ${next.name}!`);
        setBattle({ ...b, enemyIdx: nextIdx, log: lines, turn: 'player', pendingLearns: allPending, pendingGrafts: allGrafts });
        setTeam(afterXP);
        return;
      }
      if (b.kind === 'trainer') {
        // Zone trainers pay more on repeat clears (cycles increase difficulty AND reward)
        const cyclesBonus = ZONE_TRAINER_IDS.has(b.npc.id) ? trainerCycles * Math.floor(b.npc.reward * 0.5) : 0;
        const totalReward = b.npc.reward + cyclesBonus;
        lines.push(`You won! +${totalReward} gold.`);
        setGold(g => g + totalReward);
        setTimeout(() => audio.sfx.victory(), 400);
        setDefeated(d => {
          // Add this trainer to the defeated list
          const next = d.includes(b.npc.id) ? d : [...d, b.npc.id];
          // Check if all five zone trainers are now defeated
          if (ZONE_TRAINER_IDS.has(b.npc.id)) {
            const allCleared = [...ZONE_TRAINER_IDS].every(id => next.includes(id));
            if (allCleared) {
              // Cycle complete: bump counter and remove zone trainers from defeated
              // so the player can fight them again with stronger teams.
              setTrainerCycles(c => c + 1);
              const filtered = next.filter(id => !ZONE_TRAINER_IDS.has(id));
              // Use a microtask to show the toast after state settles
              setTimeout(() => showToast(`All zone challengers cleared! They've returned, stronger.`), 50);
              setTimeout(() => showToast(`The shrine gates have opened — five sealed buildings now beckon.`), 2000);
              setTimeout(() => audio.sfx.fanfare(), 1200);
              return filtered;
            }
          }
          return next;
        });
      } else if (b.kind === 'legendary') {
        // Legendary boss victory — award medallion + big gold purse.
        const reward = 400 + enemy.level * 20;
        lines.push(`The ${enemy.name} crumbles into a beam of light...`);
        lines.push(`You receive the ${COLOR_NAME[b.shrineColor]} Medallion!`);
        lines.push(`+${reward} gold.`);
        setGold(g => g + reward);
        setMedallions(arr => arr.includes(b.shrineColor) ? arr : [...arr, b.shrineColor]);
        // Cue: medallion sting first, then victory chord, all timed after the faint sound.
        setTimeout(() => audio.sfx.medallion(b.shrineColor), 500);
        setTimeout(() => audio.sfx.victory(), 1300);
        // After the win flag flashes, also let the player know about the meta-progress.
        setTimeout(() => {
          const haveAfter = [...new Set([...medallions, b.shrineColor])];
          const remaining = ['W','U','B','R','G'].filter(c => !haveAfter.includes(c));
          if (remaining.length === 0) showToast('All five medallions gathered. The town shrine awaits...');
          else showToast(`Medallion gained. ${remaining.length} more to go.`);
        }, 80);
      } else if (b.kind === 'planeswalker') {
        // Final boss victory — Champion badge + ability-learning prompt.
        const reward = 2000;
        lines.push(`THE PLANESWALKER bows its head. "The spark... is yours."`);
        lines.push(`Your commander absorbs a fragment of planar power!`);
        lines.push(`+${reward} gold.`);
        setGold(g => g + reward);
        setPlaneswalkerDefeated(true);
        setChampionLearnPending(true);
        setTimeout(() => audio.sfx.planarBurst(), 400);
        setTimeout(() => audio.sfx.fanfare(), 1500);
      } else {
        const wildGold = 5 + enemy.level * 2;
        lines.push(`Victory! +${wildGold} gold.`);
        setGold(g => g + wildGold);
        setTimeout(() => audio.sfx.victory(), 300);
      }
      setBattle({ ...b, log: lines, turn: 'end', result: 'win', pendingLearns: allPending, pendingGrafts: allGrafts });
      setTeam(afterXP);
      return;
    }

    if (me.hp <= 0) {
      lines.push(`${me.name} fainted!`);
      audio.sfx.faint();
      const aliveIdx = t.findIndex(c => c.hp > 0);
      if (aliveIdx < 0) {
        lines.push('You have no creatures left. You black out...');
        setBattle({ ...b, log: lines, turn: 'end', result: 'lose' });
        setTeam(t);
        setTimeout(() => audio.sfx.defeat(), 200);
        return;
      }
      lines.push('Choose another creature.');
      setBattle({ ...b, log: lines, turn: 'player', needSwitch: true });
      setTeam(t);
      return;
    }

    // Normal turn flip
    if (sideActing === 'player') {
      setBattle({ ...b, log: lines, turn: 'enemy' });
      setTeam(t);
      setTimeout(() => enemyAction(), 650);
    } else {
      setBattle({ ...b, log: lines, turn: 'player' });
      setTeam(t);
    }
  }

  const doPlayerMove = (moveKey) => {
    const b = battleRef.current;
    const t = teamRef.current;
    if (!b || b.turn !== 'player') return;
    // Check if status prevents turn (freeze/stun)
    const me = t[b.myIdx];
    const { newCreature, lines: tickLines, prevented } = tickStatusStart(me);
    if (prevented || newCreature !== me) {
      const newTeam = [...t]; newTeam[b.myIdx] = newCreature;
      const newBattle = { ...b, log: [...b.log, ...tickLines] };
      if (prevented) {
        // Skip turn → enemy gets to act
        postStep(newBattle, newTeam, 'player');
        return;
      }
      // status cleared (thaw) but didn't skip: proceed with move on updated team
      const { newTeam: afterMoveTeam, newEnemyTeam, lines } = applyMove(newBattle, newTeam, 'player', moveKey);
      const finalBattle = { ...newBattle, enemyTeam: newEnemyTeam, log: [...newBattle.log, ...lines] };
      postStep(finalBattle, afterMoveTeam, 'player');
      return;
    }
    const { newTeam, newEnemyTeam, lines } = applyMove(b, t, 'player', moveKey);
    const newBattle = { ...b, enemyTeam: newEnemyTeam, log: [...b.log, ...lines] };
    postStep(newBattle, newTeam, 'player');
  };

  const enemyAction = () => {
    const b = battleRef.current;
    const t = teamRef.current;
    if (!b || b.turn === 'end') return;
    const enemy = b.enemyTeam[b.enemyIdx];
    if (enemy.hp <= 0) return;
    const me = t[b.myIdx];
    if (!me || me.hp <= 0) return;

    // Check if status prevents enemy's turn
    const { newCreature, lines: tickLines, prevented } = tickStatusStart(enemy);
    if (prevented || newCreature !== enemy) {
      const newEnemyTeam = [...b.enemyTeam]; newEnemyTeam[b.enemyIdx] = newCreature;
      const newBattle = { ...b, enemyTeam: newEnemyTeam, log: [...b.log, ...tickLines] };
      if (prevented) {
        postStep(newBattle, t, 'enemy');
        return;
      }
      // thaw: proceed on updated enemy team
      const candidates = newCreature.moves.map(k => ({ k, m: MOVES[k] }));
      let pickedKey;
      if (newCreature.hp / newCreature.maxHp < 0.4 && candidates.some(x => x.m.heal)) {
        pickedKey = candidates.find(x => x.m.heal).k;
      } else {
        const attacks = candidates.filter(x => !x.m.heal);
        pickedKey = attacks[Math.floor(Math.random() * attacks.length)].k;
      }
      const { newTeam, newEnemyTeam: nnet, lines } = applyMove(newBattle, t, 'enemy', pickedKey);
      const finalBattle = { ...newBattle, enemyTeam: nnet, log: [...newBattle.log, ...lines] };
      postStep(finalBattle, newTeam, 'enemy');
      return;
    }

    const candidates = enemy.moves.map(k => ({ k, m: MOVES[k] }));
    let pickedKey;
    if (enemy.hp / enemy.maxHp < 0.4 && candidates.some(x => x.m.heal)) {
      pickedKey = candidates.find(x => x.m.heal).k;
    } else {
      const attacks = candidates.filter(x => !x.m.heal);
      pickedKey = attacks[Math.floor(Math.random() * attacks.length)].k;
    }
    const { newTeam, newEnemyTeam, lines } = applyMove(b, t, 'enemy', pickedKey);
    const newBattle = { ...b, enemyTeam: newEnemyTeam, log: [...b.log, ...lines] };
    postStep(newBattle, newTeam, 'enemy');
  };

  const tryCatch = () => {
    const b = battleRef.current;
    const t = teamRef.current;
    if (!b || b.kind === 'trainer' || b.kind === 'legendary' || b.kind === 'planeswalker' || b.turn !== 'player') return;
    if (tokens <= 0) {
      setBattle({ ...b, log: [...b.log, 'No Creature Cards left!'] });
      return;
    }
    // Commander mode: the target must share color identity (subset rule)
    const enemyNow = b.enemyTeam[b.enemyIdx];
    if (mode === 'commander' && commanderColor && !isSubsetIdentity(enemyNow.c, commanderColor)) {
      setBattle({ ...b, log: [...b.log, `${enemyNow.name} cannot be bound — its colors are outside your commander's identity.`] });
      return;
    }
    // Phase 1: show throwing card animation, freeze inputs
    setBattle({ ...b, turn: 'catching', throwing: true, log: [...b.log, `You hurl a Creature Card at ${b.enemyTeam[b.enemyIdx].name}!`] });
    setTokens(v => v - 1);
    audio.sfx.catchTry();
    // Phase 2 (after ~750ms): resolve catch outcome
    setTimeout(() => {
      const b2 = battleRef.current;
      if (!b2) return;
      const enemy = b2.enemyTeam[b2.enemyIdx];
      const hpRatio = enemy.hp / enemy.maxHp;
      const chance = Math.min(0.9, (1 - hpRatio) * 0.65 + 0.15);
      const success = Math.random() < chance;
      const t2 = teamRef.current;
      const lines = [];
      if (success) {
        lines.push(`${enemy.name} was bound to your service!`);
        const caught = { ...enemy, hp: Math.max(1, enemy.hp) };
        if (t2.length < 6) setTeam(tt => [...tt, caught]);
        else lines.push(`(Team full — ${enemy.name} drifts away.)`);
        setCodex(cx => ({ ...cx, [enemy.id]: { caught: (cx[enemy.id]?.caught || 0) + 1, seen: cx[enemy.id]?.seen || 1 }}));
        setBattle({ ...b2, log: [...b2.log, ...lines], turn: 'end', result: 'catch', throwing: false });
        audio.sfx.catchSuccess();
      } else {
        lines.push('It broke free!');
        setBattle({ ...b2, log: [...b2.log, ...lines], turn: 'enemy', throwing: false });
        audio.sfx.catchFail();
        setTimeout(() => enemyAction(), 550);
      }
    }, 750);
  };

  const tryFlee = () => {
    const b = battleRef.current;
    if (!b || b.turn !== 'player') return;
    if (b.kind === 'trainer') {
      setBattle({ ...b, log: [...b.log, "Can't flee from a duel!"] });
      return;
    }
    if (b.kind === 'legendary' || b.kind === 'planeswalker') {
      setBattle({ ...b, log: [...b.log, "There's no escape from this fight."] });
      return;
    }
    const ok = Math.random() < 0.7;
    if (ok) {
      setBattle({ ...b, log: [...b.log, 'Got away safely!'], turn: 'end', result: 'flee' });
    } else {
      setBattle({ ...b, log: [...b.log, "Couldn't escape!"], turn: 'enemy' });
      setTimeout(() => enemyAction(), 550);
    }
  };

  const switchTo = (i) => {
    const b = battleRef.current;
    const t = teamRef.current;
    if (!b) return;
    if (t[i].hp <= 0 || i === b.myIdx) return;
    const wasForced = !!b.needSwitch;
    setBattle({ ...b, myIdx: i, log: [...b.log, `Go, ${t[i].name}!`], turn: wasForced ? 'player' : 'enemy', needSwitch: false });
    if (!wasForced) setTimeout(() => enemyAction(), 550);
  };

  // Resolve a pending move-learn choice. forgetIdx === -1 means skip (don't learn).
  // ---------- Items: buy/use ----------
  const buyItem = (key) => {
    const it = ITEMS[key];
    if (!it) return false;
    if (gold < it.price) { showToast('Not enough gold.'); audio.sfx.deny(); return false; }
    setGold(g => g - it.price);
    audio.sfx.confirm();
    if (it.kind === 'card') {
      setTokens(v => v + it.amount);
      showToast(`+${it.amount} Creature Card`);
    } else {
      setItems(inv => ({ ...inv, [key]: (inv[key] || 0) + 1 }));
      showToast(`Bought ${it.name}`);
    }
    return true;
  };

  // Apply a consumable item to a team creature. Returns true if used.
  // When called from battle, `fromBattle` is true and we append to battle log + enemy gets free turn.
  const useItemOn = (key, teamIdx, fromBattle = false) => {
    const it = ITEMS[key];
    const t = teamRef.current;
    const target = t[teamIdx];
    if (!it || !target) return false;
    if ((items[key] || 0) <= 0) return false;
    // Validate target for item kind
    if (it.kind === 'heal') {
      if (target.hp <= 0) { showToast('Target has fainted.'); return false; }
      if (target.hp >= target.maxHp) { showToast('Already at full HP.'); return false; }
    } else if (it.kind === 'revive') {
      if (target.hp > 0) { showToast('Target is not fainted.'); return false; }
    }
    // Apply
    let newHp = target.hp;
    let msg = '';
    if (it.kind === 'heal') {
      const amt = Math.min(it.amount, target.maxHp - target.hp);
      newHp = Math.min(target.maxHp, target.hp + it.amount);
      msg = `${target.name} recovered ${amt} HP.`;
    } else if (it.kind === 'revive') {
      newHp = Math.max(1, Math.floor(target.maxHp * it.amount));
      msg = `${target.name} was revived!`;
    }
    const nt = [...t]; nt[teamIdx] = { ...target, hp: newHp };
    setTeam(nt);
    setItems(inv => ({ ...inv, [key]: inv[key] - 1 }));
    audio.sfx.heal();
    if (fromBattle) {
      const b = battleRef.current;
      if (b) {
        // Using an item costs your turn; enemy responds.
        setBattle({ ...b, log: [...b.log, `You used ${it.name}.`, msg], turn: 'enemy' });
        setTimeout(() => enemyAction(), 600);
      }
    } else {
      showToast(msg);
    }
    return true;
  };

  const resolveLearn = (forgetIdx) => {
    const b = battleRef.current;
    if (!b || !b.pendingLearns?.length) return;
    const [next, ...rest] = b.pendingLearns;
    const t = teamRef.current;
    const ci = t.findIndex(c => c.uid === next.uid);
    const newLines = [...b.log];
    if (ci >= 0) {
      const creature = t[ci];
      if (forgetIdx < 0) {
        newLines.push(`${creature.name} did not learn ${MOVES[next.move].name}.`);
      } else {
        const forgotten = creature.moves[forgetIdx];
        const newMoves = creature.moves.slice();
        newMoves[forgetIdx] = next.move;
        const nt = [...t]; nt[ci] = { ...creature, moves: newMoves };
        setTeam(nt);
        newLines.push(`${creature.name} forgot ${MOVES[forgotten].name} and learned ${MOVES[next.move].name}!`);
      }
    }
    setBattle({ ...b, log: newLines, pendingLearns: rest });
  };

  // Apply a graft-milestone choice.
  // choice = { action: 'add', color } | { action: 'lock' } | { action: 'skip' } | { action: 'learn', move } | { action: 'skip-attack' }
  // The creature carries a transient flag `lastGraftAddedColor` set when a color is grafted at a
  // 5/10/15/20 milestone. The follow-up 6/11/16/21 milestone consumes that flag to focus the move
  // pool on the new color. Any other graft action (lock/skip/learn/skip-attack) clears the flag.
  const resolveGraft = (choice) => {
    const b = battleRef.current;
    if (!b || !b.pendingGrafts?.length) return;
    const [next, ...rest] = b.pendingGrafts;
    const t = teamRef.current;
    const ci = t.findIndex(c => c.uid === next.uid);
    const newLines = [...b.log];
    let newPendingLearns = b.pendingLearns || [];
    if (ci >= 0) {
      const creature = t[ci];
      if (choice.action === 'lock') {
        const nt = [...t]; nt[ci] = { ...creature, graftLocked: true, lastGraftAddedColor: null };
        setTeam(nt);
        newLines.push(`${creature.name}'s color identity is locked. No further color grafts will be offered.`);
      } else if (choice.action === 'skip') {
        // Color milestone declined for now — don't lock, just defer to the next color milestone.
        // Clear the new-color flag so the follow-up attack milestone falls back to "any color".
        const nt = [...t]; nt[ci] = { ...creature, lastGraftAddedColor: null };
        setTeam(nt);
        newLines.push(`${creature.name} resists the call — for now.`);
      } else if (choice.action === 'add') {
        const newColor = choice.color;
        const order = [...(creature.colorAddOrder || colorsOf(creature.c))];
        const penalties = { ...(creature.colorPenalties || {}) };
        const lastAdded = order[order.length - 1];
        if (lastAdded) {
          const cur = penalties[lastAdded] ?? 1.0;
          penalties[lastAdded] = Math.max(0.5, cur - 0.1);
        }
        order.push(newColor);
        penalties[newColor] = 1.0;
        const newC = order.join('');
        // Tag the creature so the next attack milestone (level X+1) knows to draw moves from this color.
        const nt = [...t]; nt[ci] = { ...creature, c: newC, colorAddOrder: order, colorPenalties: penalties, lastGraftAddedColor: newColor };
        setTeam(nt);
        setCommanderColor(newC);
        newLines.push(`✦ ${creature.name} grafted ${COLOR_NAME[newColor]} onto its identity!`);
        if (lastAdded && lastAdded !== newColor) {
          newLines.push(`(${COLOR_NAME[lastAdded]} attacks now do ${Math.round(penalties[lastAdded] * 100)}% damage.)`);
        }
      } else if (choice.action === 'learn') {
        // Auto-learn if there's a free slot, otherwise queue a learn prompt that fires after grafts.
        if (creature.moves.length < 4) {
          const nt = [...t]; nt[ci] = { ...creature, moves: [...creature.moves, choice.move], lastGraftAddedColor: null };
          setTeam(nt);
          newLines.push(`${creature.name} learned ${MOVES[choice.move].name}!`);
        } else {
          // Keep the flag clear regardless of whether the player chooses to forget or skip the queued learn.
          const nt = [...t]; nt[ci] = { ...creature, lastGraftAddedColor: null };
          setTeam(nt);
          newPendingLearns = [...newPendingLearns, { uid: creature.uid, move: choice.move }];
          newLines.push(`${creature.name} wants to learn ${MOVES[choice.move].name}...`);
        }
      } else if (choice.action === 'skip-attack') {
        // Player declined the attack offer. Clear flag.
        const nt = [...t]; nt[ci] = { ...creature, lastGraftAddedColor: null };
        setTeam(nt);
        newLines.push(`${creature.name} held back the new magic.`);
      }
    }
    setBattle({ ...b, log: newLines, pendingGrafts: rest, pendingLearns: newPendingLearns });
  };

  const endBattle = () => {
    setBattle(null);
    setScene('world');
    // Status effects clear when battle ends
    setTeam(tm => tm.map(c => c.status ? { ...c, status: null } : c));
    if (battle?.result === 'lose') {
      // "faint" → restore to shrine
      setTeam(tm => tm.map(c => ({ ...c, hp: Math.ceil(c.maxHp * 0.5), status: null })));
      setCurrentMap('town');
      setPlayer({ x: 7, y: 6, face: 'down' });
      showToast('You were revived at the shrine.');
    }
    // Save after each battle — but skip if rate-limited.
    if (!isRateLimited()) {
      setTimeout(() => performSave(), 200);
    }
  };

  // ---------- Keyboard ----------
  useEffect(() => {
    const handler = (e) => {
      if (scene === 'world') {
        if (e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); move('up'); }
        else if (e.key === 'ArrowDown' || e.key === 's') { e.preventDefault(); move('down'); }
        else if (e.key === 'ArrowLeft' || e.key === 'a') { e.preventDefault(); move('left'); }
        else if (e.key === 'ArrowRight' || e.key === 'd') { e.preventDefault(); move('right'); }
        else if (e.key === 'Enter' || e.key === ' ' || e.key === 'z') { e.preventDefault(); interact(); }
        else if (e.key === 'Escape' || e.key === 'x') { e.preventDefault(); audio.sfx.menuOpen(); setScene('menu'); }
      } else if (scene === 'dialog' || dialog) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'z') dialog?.onDone?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scene, move, interact, dialog]);

  // ---------- Canvas draw ----------
  useEffect(() => {
    if (scene !== 'world') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const TILE = 32;
    const map = MAPS[currentMap].tiles;
    const W = map[0].length, H = map.length;
    const VW = 10, VH = 10;

    // camera centered on player
    let camX = Math.max(0, Math.min(player.x - Math.floor(VW / 2), W - VW));
    let camY = Math.max(0, Math.min(player.y - Math.floor(VH / 2), H - VH));

    canvas.width = VW * TILE;
    canvas.height = VH * TILE;

    // background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const drawTile = (t, px, py) => {
      const x = px * TILE, y = py * TILE;
      switch (t) {
        case '.':
          ctx.fillStyle = '#4a7a3a'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#3d6a30';
          for (let i = 0; i < 3; i++) {
            const px2 = x + ((px * 7 + py * 13 + i * 11) % TILE);
            const py2 = y + ((px * 11 + py * 5 + i * 7) % TILE);
            ctx.fillRect(px2, py2, 2, 2);
          }
          break;
        case 'g':
          ctx.fillStyle = '#2e5a22'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#1c3a14';
          for (let i = 0; i < 6; i++) {
            const gx = x + ((px * 3 + i * 5) % TILE);
            const gy = y + ((py * 7 + i * 11) % TILE);
            ctx.fillRect(gx, gy, 2, 4);
          }
          ctx.strokeStyle = '#3a7028'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 8, y + 22); ctx.lineTo(x + 12, y + 14);
          ctx.moveTo(x + 20, y + 26); ctx.lineTo(x + 24, y + 18);
          ctx.stroke();
          break;
        case 'p':
          ctx.fillStyle = '#c9a96a'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#a08850';
          for (let i = 0; i < 4; i++) {
            const px2 = x + ((px * 7 + i * 9) % TILE);
            const py2 = y + ((py * 11 + i * 5) % TILE);
            ctx.fillRect(px2, py2, 3, 2);
          }
          break;
        case 't':
          ctx.fillStyle = '#4a7a3a'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#3a2616'; ctx.fillRect(x + 14, y + 20, 4, 10);
          ctx.fillStyle = '#1f4a1a';
          ctx.beginPath(); ctx.arc(x + 16, y + 14, 11, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2b6024';
          ctx.beginPath(); ctx.arc(x + 12, y + 12, 6, 0, Math.PI * 2); ctx.fill();
          break;
        case 'r':
          ctx.fillStyle = '#8a3a2a'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#6a2818';
          for (let i = 0; i < TILE; i += 4) ctx.fillRect(x, y + i, TILE, 1);
          break;
        case 'w':
          ctx.fillStyle = '#b59a7a'; ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = '#7a6040'; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          break;
        case 'd':
          ctx.fillStyle = '#b59a7a'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#3a2414'; ctx.fillRect(x + 8, y + 6, 16, 22);
          ctx.fillStyle = '#d4b060'; ctx.fillRect(x + 20, y + 16, 2, 3);
          break;
        case 's':
          ctx.fillStyle = '#4a7a3a'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#b8a070'; ctx.fillRect(x + 6, y + 10, 20, 18);
          ctx.fillStyle = '#e8d080'; ctx.fillRect(x + 10, y + 6, 12, 6);
          ctx.fillStyle = '#fff5c0'; ctx.fillRect(x + 14, y + 14, 4, 8);
          // glow
          const grad = ctx.createRadialGradient(x + 16, y + 14, 2, x + 16, y + 14, 18);
          grad.addColorStop(0, 'rgba(255,240,180,0.6)');
          grad.addColorStop(1, 'rgba(255,240,180,0)');
          ctx.fillStyle = grad; ctx.fillRect(x - 4, y - 4, TILE + 8, TILE + 8);
          break;
        case 'E':
          ctx.fillStyle = '#c9a96a'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#7a5a20'; ctx.fillRect(x + 12, y + 8, 8, 4);
          ctx.fillRect(x + 12, y + 20, 8, 4);
          break;
        case 'a':
          // ash ground (safe, in Ashen Wastes)
          ctx.fillStyle = '#6a5a52'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#544842';
          for (let i = 0; i < 4; i++) {
            const px2 = x + ((px * 13 + py * 7 + i * 11) % TILE);
            const py2 = y + ((px * 5 + py * 11 + i * 9) % TILE);
            ctx.fillRect(px2, py2, 2, 1);
          }
          break;
        case 'l':
          // lava vent (encounter, Ashen Wastes)
          ctx.fillStyle = '#6a5a52'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#e06020';
          ctx.fillRect(x + 6, y + 6, 20, 20);
          ctx.fillStyle = '#ffa040';
          for (let i = 0; i < 5; i++) {
            const gx = x + 6 + ((px * 3 + i * 7) % 18);
            const gy = y + 6 + ((py * 5 + i * 11) % 18);
            ctx.fillRect(gx, gy, 2, 2);
          }
          ctx.fillStyle = '#ffee60';
          ctx.fillRect(x + 14, y + 12, 3, 3);
          break;
        case 'u':
          // shallow water (safe, Sanctum)
          ctx.fillStyle = '#3a6a90'; ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = '#4a88b0'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 8); ctx.lineTo(x + 14, y + 10); ctx.moveTo(x + 18, y + 18); ctx.lineTo(x + 28, y + 20);
          ctx.stroke();
          break;
        case 'o':
          // deep pool (encounter, Sanctum)
          ctx.fillStyle = '#1a3a60'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#2b5088';
          for (let i = 0; i < 4; i++) {
            const gx = x + ((px * 7 + i * 9) % TILE);
            const gy = y + ((py * 5 + i * 11) % TILE);
            ctx.fillRect(gx, gy, 3, 2);
          }
          ctx.strokeStyle = '#6cb8e0'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x + 16, y + 16, 6, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'm':
          // moss ground (safe, Umbral)
          ctx.fillStyle = '#2a3a26'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#1a2818';
          for (let i = 0; i < 4; i++) {
            const px2 = x + ((px * 7 + i * 5) % TILE);
            const py2 = y + ((py * 11 + i * 7) % TILE);
            ctx.fillRect(px2, py2, 2, 2);
          }
          break;
        case 'v':
          // vine thicket (encounter, Umbral)
          ctx.fillStyle = '#1a2814'; ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = '#4a2a5a'; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + 16, y + 14); ctx.lineTo(x + 12, y + 26);
          ctx.moveTo(x + 28, y + 6); ctx.lineTo(x + 22, y + 18); ctx.lineTo(x + 26, y + 28);
          ctx.stroke();
          ctx.fillStyle = '#6a3a80';
          ctx.fillRect(x + 14, y + 12, 3, 3);
          ctx.fillRect(x + 22, y + 18, 3, 3);
          break;
        case 'k':
          // rock (blocking)
          ctx.fillStyle = '#6a5a52'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#3a3028';
          ctx.beginPath();
          ctx.moveTo(x + 6, y + 22); ctx.lineTo(x + 10, y + 8); ctx.lineTo(x + 20, y + 6);
          ctx.lineTo(x + 26, y + 14); ctx.lineTo(x + 24, y + 26); ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#8a7870';
          ctx.fillRect(x + 12, y + 12, 5, 3);
          break;
        case 'c':
          // chalky plains (safe, white-tinted ground)
          ctx.fillStyle = '#d8cca0'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#c8b88c';
          for (let i = 0; i < 4; i++) {
            const px2 = x + ((px * 5 + i * 7) % TILE);
            const py2 = y + ((py * 11 + i * 9) % TILE);
            ctx.fillRect(px2, py2, 2, 1);
          }
          break;
        case 'f':
          // flower field (encounter, white-biased)
          ctx.fillStyle = '#bccc88'; ctx.fillRect(x, y, TILE, TILE);
          // tall grass marks
          ctx.fillStyle = '#8aa050';
          for (let i = 0; i < 5; i++) {
            const gx = x + ((px * 7 + i * 5) % TILE);
            const gy = y + ((py * 11 + i * 9) % TILE);
            ctx.fillRect(gx, gy, 1, 3);
          }
          // bright flowers
          const flowerColors = ['#fff8c8', '#f8d8e8', '#e8f4ff', '#ffe8a8'];
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = flowerColors[(px + py + i) % 4];
            const fx = x + 4 + ((px * 13 + i * 11) % 22);
            const fy = y + 4 + ((py * 7 + i * 13) % 22);
            ctx.fillRect(fx, fy, 3, 3);
            ctx.fillStyle = '#e8c860';
            ctx.fillRect(fx + 1, fy + 1, 1, 1);
          }
          break;
        case 'B': {
          // Building entrance — appearance depends on which zone we're in.
          // First paint the surrounding ground so the door blends in naturally.
          if (currentMap === 'wilds') { ctx.fillStyle = '#4a7a3a'; }
          else if (currentMap === 'ashen') { ctx.fillStyle = '#6a5a52'; }
          else if (currentMap === 'sanctum') { ctx.fillStyle = '#3a6a90'; }
          else if (currentMap === 'umbral') { ctx.fillStyle = '#2a3a26'; }
          else if (currentMap === 'plains') { ctx.fillStyle = '#d8cca0'; }
          else { ctx.fillStyle = '#444'; }
          ctx.fillRect(x, y, TILE, TILE);
          // Building silhouette — themed per zone
          if (currentMap === 'wilds') {
            // Burrow — a dark mound with a black hole in the front
            ctx.fillStyle = '#3a2616';
            ctx.beginPath(); ctx.ellipse(x + 16, y + 22, 13, 9, 0, Math.PI, 0); ctx.fill();
            ctx.fillStyle = '#0a0608';
            ctx.beginPath(); ctx.ellipse(x + 16, y + 22, 7, 5, 0, Math.PI, 0); ctx.fill();
            // grass tufts on top
            ctx.fillStyle = '#1f4a1a';
            ctx.fillRect(x + 8, y + 12, 2, 3); ctx.fillRect(x + 22, y + 11, 2, 4);
          } else if (currentMap === 'ashen') {
            // Cave mouth — jagged dark opening in stone
            ctx.fillStyle = '#1a1410';
            ctx.beginPath();
            ctx.moveTo(x + 6, y + 28); ctx.lineTo(x + 8, y + 12);
            ctx.lineTo(x + 12, y + 6); ctx.lineTo(x + 20, y + 6);
            ctx.lineTo(x + 24, y + 12); ctx.lineTo(x + 26, y + 28);
            ctx.closePath(); ctx.fill();
            // glowing embers inside
            ctx.fillStyle = '#e06020';
            ctx.fillRect(x + 14, y + 22, 2, 2); ctx.fillRect(x + 18, y + 24, 2, 2);
            // outer rock texture
            ctx.fillStyle = '#3a3028';
            ctx.fillRect(x + 2, y + 14, 3, 3); ctx.fillRect(x + 27, y + 16, 3, 3);
          } else if (currentMap === 'sanctum') {
            // Reed hut on a small island
            ctx.fillStyle = '#5a8aa8'; ctx.fillRect(x + 4, y + 22, 24, 6); // islet
            ctx.fillStyle = '#8a7048'; ctx.fillRect(x + 8, y + 14, 16, 10); // walls
            ctx.fillStyle = '#5a3018'; // door
            ctx.fillRect(x + 14, y + 18, 4, 6);
            // thatched roof
            ctx.fillStyle = '#a88040';
            ctx.beginPath();
            ctx.moveTo(x + 6, y + 14); ctx.lineTo(x + 16, y + 4); ctx.lineTo(x + 26, y + 14);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#705028'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x + 8, y + 12); ctx.lineTo(x + 24, y + 12); ctx.stroke();
          } else if (currentMap === 'umbral') {
            // Withered shack — leaning planks
            ctx.fillStyle = '#3a2818';
            ctx.fillRect(x + 6, y + 12, 20, 16);
            // plank lines
            ctx.strokeStyle = '#1a0e08'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 11, y + 12); ctx.lineTo(x + 11, y + 28);
            ctx.moveTo(x + 16, y + 12); ctx.lineTo(x + 16, y + 28);
            ctx.moveTo(x + 21, y + 12); ctx.lineTo(x + 21, y + 28);
            ctx.stroke();
            // crooked roof
            ctx.fillStyle = '#2a1a10';
            ctx.beginPath();
            ctx.moveTo(x + 4, y + 12); ctx.lineTo(x + 14, y + 4); ctx.lineTo(x + 28, y + 12);
            ctx.closePath(); ctx.fill();
            // dark doorway
            ctx.fillStyle = '#0a0608'; ctx.fillRect(x + 13, y + 18, 6, 10);
          } else if (currentMap === 'plains') {
            // Heavenly gates — pearl pillars with golden trim
            ctx.fillStyle = '#fff5e0';
            ctx.fillRect(x + 6, y + 8, 5, 22);
            ctx.fillRect(x + 21, y + 8, 5, 22);
            // golden capital
            ctx.fillStyle = '#e8c860';
            ctx.fillRect(x + 5, y + 6, 7, 3);
            ctx.fillRect(x + 20, y + 6, 7, 3);
            // arch
            ctx.strokeStyle = '#e8c860'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x + 16, y + 8, 9, Math.PI, 0); ctx.stroke();
            // light pouring through
            ctx.fillStyle = 'rgba(255,245,200,0.5)';
            ctx.fillRect(x + 12, y + 11, 8, 18);
          } else {
            // generic doorway fallback
            ctx.fillStyle = '#3a2414'; ctx.fillRect(x + 8, y + 6, 16, 22);
            ctx.fillStyle = '#d4b060'; ctx.fillRect(x + 20, y + 16, 2, 3);
          }
          break;
        }
        case 'F':
          // Shrine interior floor — neutral stone slab with a faint magic sheen
          ctx.fillStyle = '#3a3242'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#2a2230';
          ctx.fillRect(x, y, TILE, 1); ctx.fillRect(x, y + TILE - 1, TILE, 1);
          ctx.fillRect(x, y, 1, TILE); ctx.fillRect(x + TILE - 1, y, 1, TILE);
          // subtle rune speckle
          ctx.fillStyle = '#5a4a78';
          ctx.fillRect(x + 6, y + 10, 1, 1); ctx.fillRect(x + 22, y + 18, 1, 1);
          ctx.fillRect(x + 12, y + 24, 1, 1);
          break;
        case 'L': {
          // Legendary boss tile — pulsing summoning circle in the shrine's color.
          // After defeating the boss (medallion collected), the circle fades to a soft afterglow.
          const zoneId = SHRINE_TO_ZONE[currentMap];
          const sd = zoneId && SHRINE_DATA[zoneId];
          const col = sd ? COLOR_HEX[sd.color] : '#fff';
          const deep = sd ? COLOR_DEEP[sd.color] : '#444';
          const claimed = sd && medallions.includes(sd.color);
          // base floor under the circle
          ctx.fillStyle = '#3a3242'; ctx.fillRect(x, y, TILE, TILE);
          // outer rim
          ctx.strokeStyle = claimed ? '#5a4a78' : col;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x + 16, y + 16, 13, 0, Math.PI * 2); ctx.stroke();
          // inner sigil
          ctx.strokeStyle = claimed ? '#3a3050' : deep;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x + 16, y + 16, 8, 0, Math.PI * 2); ctx.stroke();
          // cross-rune
          ctx.beginPath();
          ctx.moveTo(x + 16, y + 6); ctx.lineTo(x + 16, y + 26);
          ctx.moveTo(x + 6, y + 16); ctx.lineTo(x + 26, y + 16);
          ctx.stroke();
          // glow center (only when active)
          if (!claimed) {
            const grad = ctx.createRadialGradient(x + 16, y + 16, 1, x + 16, y + 16, 14);
            grad.addColorStop(0, col + 'cc');
            grad.addColorStop(1, col + '00');
            ctx.fillStyle = grad;
            ctx.fillRect(x - 2, y - 2, TILE + 4, TILE + 4);
          }
          break;
        }
        default:
          ctx.fillStyle = '#222'; ctx.fillRect(x, y, TILE, TILE);
      }
    };

    // draw tiles
    for (let py = 0; py < VH; py++) {
      for (let px = 0; px < VW; px++) {
        const mx = camX + px, my = camY + py;
        const t = map[my]?.[mx] ?? 't';
        drawTile(t, px, py);
      }
    }

    // draw NPCs
    const npcs = currentMap === 'town' ? NPCS_TOWN : (NPCS_ZONE[currentMap] || []);
    for (const n of npcs) {
      const px = n.x - camX, py = n.y - camY;
      if (px < 0 || px >= VW || py < 0 || py >= VH) continue;
      drawCharacter(ctx, px * TILE, py * TILE, n.color, n.face, defeated.includes(n.id));
      if (n.isShop) {
        // little "♦" mark above the head
        ctx.fillStyle = '#ffd870';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('◆', px * TILE + TILE/2, py * TILE - 2);
        ctx.textAlign = 'left';
      }
    }

    // draw player
    const ppx = (player.x - camX) * TILE;
    const ppy = (player.y - camY) * TILE;
    drawCharacter(ctx, ppx, ppy, '#3a6ea5', player.face, false, true);

    // subtle vignette
    const vg = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 80, canvas.width/2, canvas.height/2, canvas.width/1.2);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [player, currentMap, scene, defeated, medallions]);

  // ----- small render helper for a person sprite -----
  function drawCharacter(ctx, x, y, bodyColor, face, faded = false, isPlayer = false) {
    const TILE = 32;
    if (faded) ctx.globalAlpha = 0.45;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x + 16, y + 28, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(x + 9, y + 14, 14, 14);
    // head
    ctx.fillStyle = '#e6c9a2';
    ctx.fillRect(x + 11, y + 6, 10, 10);
    // hat/hair
    ctx.fillStyle = isPlayer ? '#1a2a3a' : '#2a1a1a';
    ctx.fillRect(x + 10, y + 4, 12, 4);
    // eyes based on face direction
    ctx.fillStyle = '#1a1a1a';
    if (face === 'down') {
      ctx.fillRect(x + 13, y + 10, 2, 2); ctx.fillRect(x + 17, y + 10, 2, 2);
    } else if (face === 'up') {
      // back of head, no eyes
    } else if (face === 'left') {
      ctx.fillRect(x + 12, y + 10, 2, 2);
    } else {
      ctx.fillRect(x + 18, y + 10, 2, 2);
    }
    if (faded) ctx.globalAlpha = 1;
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================
  if (!loaded) {
    return (
      <div style={{ background: '#0a0910', color: '#d8c8a8', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cinzel, Georgia, serif' }}>
        Awakening the planes...
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at center, #1a1428 0%, #0a0614 100%)',
      color: '#e8dcc0',
      fontFamily: '"Cinzel", Georgia, serif',
      padding: '8px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px',
      userSelect: 'none',
      touchAction: 'manipulation',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Silkscreen&display=swap');
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }
        @keyframes fadein { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        @keyframes gtmEvoFlash {
          0%   { transform: scale(1);    filter: brightness(1); }
          100% { transform: scale(1.12); filter: brightness(1.6); }
        }
        @keyframes gtmCardThrow {
          0%   { left: 10%;  bottom: 10px; transform: rotate(0deg)    scale(0.45); opacity: 0; }
          15%  { opacity: 1; }
          55%  { left: 72%;  bottom: 55px; transform: rotate(540deg)  scale(0.9);  opacity: 1; }
          75%  { left: 78%;  bottom: 40px; transform: rotate(900deg)  scale(1.0);  opacity: 1; }
          100% { left: 78%;  bottom: 40px; transform: rotate(900deg)  scale(0.25); opacity: 0; }
        }
        @keyframes gtmCardShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        @keyframes gtmFlashFade {
          0%   { opacity: 1; }
          70%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes gtmIntroSlide {
          0%   { transform: translateX(-150%) skewX(-12deg); opacity: 0; }
          50%  { transform: translateX(0)       skewX(-12deg); opacity: 1; }
          80%  { transform: translateX(0)       skewX(0deg);   opacity: 1; }
          100% { transform: translateX(0)       skewX(0deg);   opacity: 1; }
        }
        .pixelFont { font-family: 'Silkscreen', monospace; letter-spacing: 0.5px; }
        .mtgBtn {
          font-family: 'Cinzel', serif; font-weight: 700;
          background: linear-gradient(180deg, #2a2038 0%, #1a1428 100%);
          color: #e8dcc0; border: 1.5px solid #6a5a88;
          border-radius: 4px; padding: 8px 12px;
          cursor: pointer; transition: all 0.12s;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 0 #0a0614;
        }
        .mtgBtn:active { transform: translateY(1px); box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 0 #0a0614; }
        .mtgBtn:disabled { opacity: 0.4; cursor: not-allowed; }
        .mtgBtn:hover:not(:disabled) { border-color: #9a80c0; background: linear-gradient(180deg, #342850 0%, #1f183a 100%); }
        .dpadBtn {
          width: 58px; height: 58px; background: #1a1428; border: 2px solid #4a3a68;
          color: #e8dcc0; font-size: 22px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          user-select: none; -webkit-user-select: none; cursor: pointer;
        }
        .dpadBtn:active { background: #342850; }
        .manaBadge {
          display: inline-flex; align-items: center; justify-content: center;
          width: 18px; height: 18px; border-radius: 50%; font-size: 11px;
          font-family: 'Silkscreen', monospace; font-weight: bold;
          color: #1a1428; border: 1px solid #0a0614;
        }
        .scroll::-webkit-scrollbar { width: 6px; }
        .scroll::-webkit-scrollbar-track { background: #1a1428; }
        .scroll::-webkit-scrollbar-thumb { background: #4a3a68; border-radius: 3px; }
      `}</style>

      {/* ======================= TITLE SCREEN ======================= */}
      {scene === 'title' && (
        <div style={{ width: '100%', maxWidth: 400, margin: 'auto', paddingTop: '15vh', textAlign: 'center', animation: 'fadein 0.6s' }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '2px', background: 'linear-gradient(180deg, #f4e5a8 0%, #c9a664 100%)', WebkitBackgroundClip: 'text', color: 'transparent', textShadow: '0 4px 12px rgba(200,160,80,0.25)' }}>
            GATHERING
          </div>
          <div style={{ fontSize: 22, letterSpacing: '8px', color: '#9080b0', marginTop: -4, fontStyle: 'italic' }}>
            the magic
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '20px 0 30px' }}>
            {['W','U','B','R','G'].map(c => (
              <div key={c} className="manaBadge" style={{ background: COLOR_HEX[c], width: 22, height: 22 }}>{c}</div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: '#9888b0', margin: '0 20px 30px', lineHeight: 1.6 }}>
            A vertical-slice prototype. Summon creatures, walk the wilds, duel rivals.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 40px' }}>
            {hasSave && (
              <button className="mtgBtn" onClick={continueSave} style={{ fontSize: 16, padding: '12px' }}>Continue</button>
            )}
            <button className="mtgBtn" onClick={startNew} style={{ fontSize: 16, padding: '12px' }}>
              {hasSave ? 'New Game' : 'Begin'}
            </button>
            {hasSave && (
              <button className="mtgBtn" onClick={async () => { await clearSave(); setHasSave(false); }} style={{ fontSize: 11, padding: '6px', opacity: 0.6 }}>
                Delete Save
              </button>
            )}
            {storageBroken && (
              <div style={{ fontSize: 10, color: '#c8b890', textAlign: 'center', marginTop: 4, fontStyle: 'italic' }}>
                Storage unavailable in this session — saves disabled.
              </div>
            )}
            {storageDiag.length > 0 && (
              <details style={{ marginTop: 8, fontSize: 9, color: '#9080b0', textAlign: 'left', background: '#0f0a18', border: '1px solid #3a2850', borderRadius: 4, padding: 6 }}>
                <summary style={{ cursor: 'pointer', fontSize: 10, color: '#c8b8d0' }}>Storage diagnostic</summary>
                <pre style={{ margin: '6px 0 0', fontSize: 9, color: '#a898c0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{storageDiag.join('\n')}</pre>
              </details>
            )}
          </div>
          <div style={{ marginTop: 40, fontSize: 10, color: '#5a4a70', padding: '0 30px' }}>
            All creatures are original designs inspired by the five-color mana wheel. Not affiliated with Wizards of the Coast.
          </div>
          {/* Audio status pill — small confirmation that this version of the artifact has audio
              code at all. Useful when the game is opened via a shared link, since each share
              captures a snapshot at that moment. If you don't see this on a shared link, the
              link points to an older snapshot from before audio was added — re-share to update. */}
          <TitleAudioPill />
        </div>
      )}

      {/* ======================= STARTER PICK ======================= */}
      {scene === 'modeSelect' && <ModeSelectScene onPick={pickMode} />}
      {scene === 'starter' && <StarterScene mode={mode} onPick={pickStarter} />}

      {/* ======================= WORLD / HUD ======================= */}
      {scene === 'world' && (
        <>
          <TopBar mapName={MAPS[currentMap].name} tokens={tokens} gold={gold} team={team} mode={mode} commanderColor={commanderColor} onMenu={() => { audio.sfx.menuOpen(); setScene('menu'); }} />

          <div style={{ position: 'relative' }}>
            <canvas ref={canvasRef} style={{
              width: 'min(96vw, 480px)',
              height: 'min(96vw, 480px)',
              imageRendering: 'pixelated',
              border: '2px solid #4a3a68',
              borderRadius: 6,
              boxShadow: '0 0 40px rgba(120,80,180,0.25), inset 0 0 0 1px #1a1428',
              background: '#000',
            }} />
            {/* toast moved to global overlay so it shows on any scene */}
          </div>

          <Controls onMove={move} onA={interact} onB={() => { audio.sfx.menuOpen(); setScene('menu'); }} />
        </>
      )}

      {/* ======================= BATTLE ======================= */}
      {scene === 'battle' && battle && (
        <BattleScreen
          battle={battle}
          team={team}
          tokens={tokens}
          items={items}
          mode={mode}
          commanderColor={commanderColor}
          onMove={doPlayerMove}
          onCatch={tryCatch}
          onFlee={tryFlee}
          onSwitch={switchTo}
          onEnd={endBattle}
          onResolveLearn={resolveLearn}
          onResolveGraft={resolveGraft}
          onUseBattleItem={(key, idx) => useItemOn(key, idx, true)}
        />
      )}

      {/* ======================= MENU ======================= */}
      {scene === 'menu' && (
        <MenuScreen
          team={team}
          codex={codex}
          tokens={tokens}
          gold={gold}
          items={items}
          mode={mode}
          commanderColor={commanderColor}
          storageBroken={storageBroken}
          defeated={defeated}
          trainerCycles={trainerCycles}
          medallions={medallions}
          planeswalkerDefeated={planeswalkerDefeated}
          onUseItem={useItemOn}
          onClose={() => { audio.sfx.menuClose(); setScene('world'); }}
          onRelease={(idx) => {
            const released = team[idx];
            if (!released) return;
            // Don't release the commander (slot 0 in commander mode)
            if (mode === 'commander' && idx === 0) return;
            setTeam(t => t.filter((_, i) => i !== idx));
            audio.sfx.confirm();
            showToast(`${released.name} returned to the wild.`);
          }}
          onSaveQuit={async () => {
            const ok = await performSave();
            if (ok) {
              setHasSave(true);
              setScene('title');
              showToast('Progress saved.');
            } else {
              const reason = getLastSaveFailure() || 'unknown';
              if (isRateLimited() || /rate|limit/i.test(reason)) {
                showToast('Save limit hit — wait ~10 min for it to reset.');
              } else {
                showToast(`Save failed: ${reason}`);
              }
            }
          }}
          onCheckStorage={async () => {
            const lines = [];
            if (typeof window === 'undefined' || !window.storage) {
              lines.push('Storage API: NOT PRESENT');
              lines.push('window.storage is unavailable in this environment.');
            } else {
              lines.push('Storage API: present');
              try {
                const r = await window.storage.get(SAVE_KEY);
                if (!r || !r.value) {
                  lines.push('Save record: NONE');
                  lines.push('No autosave has succeeded yet. Try winning a battle or changing zones, then check again.');
                } else {
                  let parsed;
                  try { parsed = JSON.parse(r.value); } catch { parsed = null; }
                  if (!parsed) {
                    lines.push(`Save bytes: ${r.value.length}`);
                    lines.push('Save value present but not parseable.');
                  } else {
                    const teamSummary = (parsed.team || []).map(c => `${c.name} Lv${c.level}`).join(', ') || '(empty)';
                    lines.push(`Map: ${parsed.currentMap}`);
                    lines.push(`Team: ${teamSummary}`);
                    lines.push(`Gold: ${parsed.gold}, Mode: ${parsed.mode}`);
                    lines.push(`Save bytes: ${r.value.length}`);
                  }
                }
              } catch (e) {
                lines.push(`Read error: ${e?.message || e}`);
              }
            }
            setDialog({ lines, onDone: () => setDialog(null) });
          }}
          onReset={async () => {
            await clearSave();
            setTeam([]); setCodex({}); setDefeated([]); setTokens(5); setGold(0); setItems({ potion: 2 });
            setMode('classic'); setCommanderColor(""); setTrainerCycles(0);
            setMedallions([]); setPlaneswalkerDefeated(false); setChampionLearnPending(false);
            setHasSave(false); setScene('title');
          }}
        />
      )}

      {scene === 'shop' && (
        <ShopScene
          gold={gold}
          items={items}
          tokens={tokens}
          onBuy={buyItem}
          onClose={() => { audio.sfx.menuClose(); setScene('world'); }}
        />
      )}

      {/* ======================= DIALOG ======================= */}
      {dialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,6,20,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ width: 'min(92vw, 460px)', margin: 20, background: 'linear-gradient(180deg, #2a2038, #141020)', border: '2px solid #6a5a88', borderRadius: 6, padding: 16, boxShadow: '0 8px 30px rgba(0,0,0,0.6)' }}>
            {dialog.lines.map((l, i) => <div key={i} style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 8 }}>{l}</div>)}
            <div style={{ textAlign: 'right', marginTop: 10 }}>
              <button className="mtgBtn" onClick={dialog.onDone} style={{ fontSize: 13, padding: '6px 14px' }}>▸ Continue</button>
            </div>
          </div>
        </div>
      )}

      {/* ======================= CHAMPION LEARN MODAL (post-Planeswalker reward) ======================= */}
      {championLearnPending && team[0] && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,6,20,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div style={{ width: 'min(94vw, 460px)' }}>
            <ChampionLearnPanel
              creature={team[0]}
              onLearn={(moveKey, forgetIdx) => {
                setTeam(t => {
                  const nt = [...t];
                  const c = nt[0];
                  if (forgetIdx >= 0) {
                    const newMoves = c.moves.slice();
                    newMoves[forgetIdx] = moveKey;
                    nt[0] = { ...c, moves: newMoves, championBadge: true, flashUntil: Date.now() + 1400 };
                  } else {
                    nt[0] = { ...c, moves: [...c.moves, moveKey], championBadge: true, flashUntil: Date.now() + 1400 };
                  }
                  return nt;
                });
                setChampionLearnPending(false);
                showToast(`${team[0].name} learned ${MOVES[moveKey].name}!`);
                if (!isRateLimited()) setTimeout(() => performSave(), 250);
              }}
              onSkip={() => {
                // Even if the player declines the move, the badge is still earned.
                setTeam(t => {
                  const nt = [...t];
                  nt[0] = { ...nt[0], championBadge: true };
                  return nt;
                });
                setChampionLearnPending(false);
                showToast('The spark fades — but your bond endures.');
                if (!isRateLimited()) setTimeout(() => performSave(), 250);
              }}
            />
          </div>
        </div>
      )}

      {/* ======================= GLOBAL TOAST ======================= */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(10,6,20,0.95)', border: '1px solid #6a5a88', color: '#e8dcc0',
          padding: '8px 16px', fontSize: 13, borderRadius: 4, zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.6)', animation: 'fadein 0.2s',
          maxWidth: '90vw', textAlign: 'center',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// STARTER SCENE
// =========================================================================
// ---------- Title-screen audio status pill ----------
// Small unobtrusive button that:
//   1. Confirms the loaded version actually has audio code (visual proof of version)
//   2. Provides a tap target that wakes the audio context AND toggles mute, in case the
//      user wants to silence the game from the very first screen.
// Re-renders on its own muted state — using audio.isMuted() as initial source-of-truth
// so the preference (saved in localStorage) is reflected on load.
function TitleAudioPill() {
  const [muted, setMuted] = useState(() => audio.isMuted());
  return (
    <div style={{ marginTop: 14, textAlign: 'center' }}>
      <button
        className="mtgBtn"
        onClick={() => {
          // Tapping wakes the audio context (first user gesture) and toggles mute.
          const next = !muted;
          audio.setMuted(next);
          setMuted(next);
          if (!next) audio.sfx.confirm();
        }}
        style={{
          fontSize: 10, padding: '4px 10px', opacity: 0.7,
          borderColor: '#3a2850',
        }}
        title={muted ? 'Sound is muted — tap to enable' : 'Sound is on — tap to mute'}>
        {muted ? '🔇 Sound: muted' : '🔊 Sound: on'}
      </button>
    </div>
  );
}

function ModeSelectScene({ onPick }) {
  return (
    <div style={{ width: '100%', maxWidth: 480, margin: 'auto', paddingTop: '4vh' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 14, color: '#9080b0' }}>Choose your game mode</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#e8dcc0' }}>How will you play?</div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <button className="mtgBtn" onClick={() => onPick('classic')}
          style={{ padding: 14, textAlign: 'left', border: '2px solid #4a3a68' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8dcc0', marginBottom: 4 }}>⚔ Classic</div>
          <div style={{ fontSize: 12, color: '#c8b8d0', lineHeight: 1.4 }}>
            Catch and use any creature you encounter. Five single-color starters. The straightforward experience.
          </div>
        </button>
        <button className="mtgBtn" onClick={() => onPick('commander')}
          style={{ padding: 14, textAlign: 'left', border: '2px solid #9a80c0',
            background: 'linear-gradient(180deg, #3a2850 0%, #1a1028 100%)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8dcc0', marginBottom: 4 }}>
            ✦ Commander
          </div>
          <div style={{ fontSize: 12, color: '#c8b8d0', lineHeight: 1.4 }}>
            Your starter is your <i>commander</i> — they grow with you and define your run. You can only catch creatures whose color identity fits within your commander's colors. Mono-color commanders earn the right to graft new colors at level 5/10/15/20 and learn attacks of those colors at 6/11/16/21. Pick the five-color Prismatic Avatar to skip color rules entirely (easy mode — catch anything).
          </div>
        </button>
      </div>
    </div>
  );
}

function StarterScene({ mode, onPick }) {
  // Mono starters always present; multi-color starters only in Commander mode.
  const monoStarters = [
    { id: 'plains_acolyte', quote: 'Order through light.' },
    { id: 'tideling',        quote: 'Knowledge is current.' },
    { id: 'shade_whelp',     quote: 'Ambition has a cost.' },
    { id: 'emberkin',        quote: 'Burn the path open.' },
    { id: 'forest_runt',     quote: 'Strength grows slow and true.' },
  ];
  const multiStarters = [
    { id: 'skybinder',       quote: 'Law written in the clouds.' },
    { id: 'mind_reaver',     quote: 'Your secrets, my weapon.' },
    { id: 'hellraiser',      quote: 'Burn first, laugh after.' },
    { id: 'warbeast',        quote: 'The hunt has no end.' },
    { id: 'verdant_paladin', quote: 'Both sword and seed.' },
    { id: 'grim_priest',     quote: 'Salvation for a price.' },
    { id: 'stormwright',     quote: 'Every theory needs a test.' },
    { id: 'fungal_creeper',  quote: 'All things feed the grove.' },
    { id: 'blazing_knight',  quote: 'Honor forged in fire.' },
    { id: 'reef_prowler',    quote: 'Evolve or be forgotten.' },
  ];
  const fiveColor = [
    { id: 'prismatic_avatar', quote: 'All five voices speak as one.' },
  ];

  const renderStarterBtn = (s) => {
    const d = DEX[s.id];
    return (
      <button key={s.id} className="mtgBtn" onClick={() => onPick(s.id)}
        style={{ padding: 10, textAlign: 'left',
          border: `2px solid ${COLOR_DEEP[primaryColor(d.c)]}`,
          background: `linear-gradient(180deg, ${COLOR_DEEP[primaryColor(d.c)]}55 0%, #140f22 100%)` }}>
        <CreatureCard c={{ ...d, id: s.id, level: 5, hp: d.hp + 16, maxHp: d.hp + 16, moves: d.m }} small />
        <div style={{ fontSize: 11, fontStyle: 'italic', color: '#a898c0', marginTop: 6 }}>"{s.quote}"</div>
      </button>
    );
  };

  return (
    <div style={{ width: '100%', maxWidth: 640, margin: 'auto', paddingTop: '2vh', paddingBottom: '4vh' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 14, color: '#9080b0' }}>
          {mode === 'commander' ? 'Choose your Commander' : 'Choose your first creature'}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#e8dcc0' }}>The First Summoning</div>
        {mode === 'commander' && (
          <div style={{
            fontSize: 11, color: '#c8b090', marginTop: 6,
            textAlign: 'left', padding: '8px 10px',
            background: '#1a1028', border: '1px solid #4a3a68', borderRadius: 4,
            lineHeight: 1.45,
          }}>
            <div style={{ color: '#e8dcc0', fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>
              Commander basics
            </div>
            <div style={{ marginBottom: 4 }}>
              ◆ <b>Color identity rule:</b> you can only catch creatures whose colors fit inside your commander's colors. Pick a single-color starter to keep that range narrow but deep, or the Prismatic Avatar to ignore the rule entirely.
            </div>
            <div style={{ marginBottom: 4 }}>
              ◆ <b>Color grafting (Lv 5 / 10 / 15 / 20):</b> mono-color commanders can graft a new color onto their identity. Each addition expands what you can catch but applies a 10% damage penalty to the color it displaces. You may also <i>skip</i> a milestone (asked again next time) or <i>lock</i> your identity (no more color prompts).
            </div>
            <div style={{ marginBottom: 4 }}>
              ◆ <b>Attack milestones (Lv 6 / 11 / 16 / 21):</b> the level after each color milestone you'll be offered an attack. If you grafted, the pool focuses on your new color. If you skipped or locked, the pool is drawn from your current colors. These continue forever — even at the 5-color cap.
            </div>
            <div style={{ marginBottom: 4 }}>
              ◆ <b>The endgame:</b> defeat a legendary warden in each of the five zones to gather their medallions. With all five, the town shrine becomes the gateway to The Planeswalker — defeat it to earn the Champion badge and a final attack of your choice.
            </div>
            <div>
              ◆ Your commander never evolves through normal level-ups; grafting is its evolution path.
            </div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#9080b0', margin: '8px 4px 4px' }}>Single-color</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {monoStarters.map(renderStarterBtn)}
      </div>
      {mode === 'commander' && (
        <>
          <div style={{ fontSize: 12, color: '#9080b0', margin: '16px 4px 4px' }}>Five-color (easy mode — catch anything; no color grafts, but attack milestones still fire)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {fiveColor.map(renderStarterBtn)}
          </div>
        </>
      )}
    </div>
  );
}

// =========================================================================
// TOP BAR
// =========================================================================
function TopBar({ mapName, tokens, gold, team, mode, commanderColor, onMenu }) {
  return (
    <div style={{ width: 'min(96vw, 480px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <div>
        <div style={{ fontSize: 14, letterSpacing: 1, color: '#e8dcc0', display: 'flex', alignItems: 'center', gap: 6 }}>
          {mapName}
          {mode === 'commander' && commanderColor && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 5px', background: '#2a1c40', border: '1px solid #9a80c0', borderRadius: 3, fontSize: 9 }}>
              <span style={{ color: '#c8b8e0' }}>CMDR</span>
              {colorsOf(commanderColor).map((col, i) => (
                <span key={i} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: COLOR_HEX[col], border: '1px solid #0a0614' }} />
              ))}
            </span>
          )}
        </div>
        <div className="pixelFont" style={{ fontSize: 10, color: '#9888b0' }}>
          ◆ {tokens} cards · ✦ {gold}g
        </div>
      </div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {team.slice(0, 6).map((c, i) => {
          const cols = c.hp > 0 ? colorsOf(c.c) : [];
          let bg;
          if (cols.length === 0) bg = '#444';
          else if (cols.length === 1) bg = COLOR_HEX[cols[0]];
          else {
            // Vertical gradient stops, one per color in the identity
            const stops = cols.map((col, idx) => `${COLOR_HEX[col]} ${(idx / (cols.length - 1)) * 100}%`).join(', ');
            bg = `linear-gradient(180deg, ${stops})`;
          }
          return (
            <div key={c.uid} title={`${c.name} Lv.${c.level}`} style={{
              width: 8, height: 20, background: bg,
              borderRadius: 2, border: '1px solid #000',
            }} />
          );
        })}
      </div>
      <button className="mtgBtn" onClick={onMenu} style={{ padding: '4px 10px', fontSize: 12 }}>☰</button>
    </div>
  );
}

// =========================================================================
// TOUCH CONTROLS
// =========================================================================
function Controls({ onMove, onA, onB }) {
  const press = (fn) => (e) => { e.preventDefault(); fn(); };
  return (
    <div style={{ width: 'min(96vw, 480px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', marginBottom: 'auto', padding: '0 4px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 58px)', gridTemplateRows: 'repeat(3, 58px)', gap: 4 }}>
        <div></div>
        <button className="dpadBtn" onTouchStart={press(() => onMove('up'))} onMouseDown={press(() => onMove('up'))}>▲</button>
        <div></div>
        <button className="dpadBtn" onTouchStart={press(() => onMove('left'))} onMouseDown={press(() => onMove('left'))}>◀</button>
        <div></div>
        <button className="dpadBtn" onTouchStart={press(() => onMove('right'))} onMouseDown={press(() => onMove('right'))}>▶</button>
        <div></div>
        <button className="dpadBtn" onTouchStart={press(() => onMove('down'))} onMouseDown={press(() => onMove('down'))}>▼</button>
        <div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <button className="mtgBtn" onTouchStart={press(onA)} onMouseDown={press(onA)} style={{ width: 70, height: 70, borderRadius: '50%', fontSize: 22, background: 'linear-gradient(180deg, #8a3a2a, #4a1e14)', borderColor: '#d87362' }}>A</button>
        <button className="mtgBtn" onTouchStart={press(onB)} onMouseDown={press(onB)} style={{ width: 56, height: 56, borderRadius: '50%', fontSize: 17, background: 'linear-gradient(180deg, #2a4a8a, #141e4a)', borderColor: '#6c8ce0' }}>B</button>
      </div>
    </div>
  );
}

// =========================================================================
// BATTLE SCREEN
// =========================================================================
function BattleScreen({ battle, team, tokens, items, mode, commanderColor, onMove, onCatch, onFlee, onSwitch, onEnd, onResolveLearn, onResolveGraft, onUseBattleItem }) {
  const [panel, setPanel] = useState('main'); // main | moves | team
  useEffect(() => { setPanel('main'); }, [battle.myIdx, battle.enemyIdx]);

  const me = team[battle.myIdx];
  const enemy = battle.enemyTeam[battle.enemyIdx];
  const logBoxRef = useRef(null);
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [battle.log]);

  const ended = battle.turn === 'end';

  return (
    <div style={{ width: 'min(94vw, 440px)', margin: 'auto' }}>
      {/* enemy card */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
        <CombatCard creature={enemy} enemy />
      </div>

      {/* scene */}
      <div style={{
        height: 120, background: 'radial-gradient(ellipse at center, #3a2850 0%, #140820 100%)',
        border: '2px solid #4a3a68', borderRadius: 6, display: 'flex', alignItems: 'flex-end',
        justifyContent: 'space-between', padding: '10px 20px', marginBottom: 8,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          transformOrigin: 'center',
          animation: battle.throwing ? 'gtmCardShake 0.35s ease-in-out 0.55s 2' : undefined,
        }}>
          <CreatureSprite creature={me} facing="right" />
        </div>
        <div style={{
          transformOrigin: 'center',
          animation: battle.throwing ? 'gtmCardShake 0.3s ease-in-out 0.62s 2' : undefined,
          opacity: battle.result === 'catch' ? 0 : 1,
          transform: battle.result === 'catch' ? 'scale(0.3) translateY(-10px)' : 'scale(1)',
          transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
        }}>
          <CreatureSprite creature={enemy} facing="left" />
        </div>
        {battle.throwing && (
          <div style={{
            position: 'absolute', pointerEvents: 'none',
            left: '10%', bottom: '10px',
            animation: 'gtmCardThrow 0.72s ease-out forwards',
          }}>
            <CardBack size="small" />
          </div>
        )}
        {battle.intro && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(10, 6, 20, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
            animation: 'gtmFlashFade 1s ease-out forwards',
          }}>
            <div style={{
              fontSize: 22, fontWeight: 700, letterSpacing: 4,
              color: '#f4e5a8', textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 24px rgba(244,229,168,0.6)',
              animation: 'gtmIntroSlide 0.9s ease-out',
              fontFamily: "'Cinzel', serif",
              borderTop: '2px solid #c9a664', borderBottom: '2px solid #c9a664',
              padding: '8px 24px', background: 'rgba(20, 8, 32, 0.65)',
            }}>
              {battle.kind === 'trainer' ? 'CHALLENGE!' : 'BATTLE!'}
            </div>
          </div>
        )}
      </div>

      {/* my card */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <CombatCard creature={me} />
      </div>

      {/* log */}
      <div ref={logBoxRef} className="scroll" style={{
        height: 70, overflowY: 'auto', background: '#0a0614',
        border: '2px solid #4a3a68', borderRadius: 6, padding: 8, fontSize: 13, lineHeight: 1.4, marginBottom: 8,
      }}>
        {battle.log.slice(-15).map((l, i) => <div key={i}>{l}</div>)}
      </div>

      {/* actions */}
      {ended && battle.pendingLearns?.length > 0 && (() => {
        const next = battle.pendingLearns[0];
        const creature = team.find(c => c.uid === next.uid);
        if (!creature) { onResolveLearn(-1); return null; }
        return <MoveLearnPanel creature={creature} newMove={next.move} onChoose={onResolveLearn} />;
      })()}
      {ended && !battle.pendingLearns?.length && battle.pendingGrafts?.length > 0 && (() => {
        const next = battle.pendingGrafts[0];
        const creature = team.find(c => c.uid === next.uid);
        if (!creature) { onResolveGraft(null); return null; }
        // Default kind to 'color' for any legacy pending grafts that don't carry the field.
        return <GraftPanel creature={creature} kind={next.kind || 'color'} onResolve={onResolveGraft} />;
      })()}
      {ended && !battle.pendingLearns?.length && !battle.pendingGrafts?.length && (
        <button className="mtgBtn" onClick={onEnd} style={{ width: '100%', padding: 12, fontSize: 15 }}>Continue ▸</button>
      )}
      {!ended && battle.needSwitch && (
        <TeamPicker team={team} myIdx={battle.myIdx} onPick={onSwitch} forced />
      )}
      {!ended && !battle.needSwitch && panel === 'main' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <button className="mtgBtn" onClick={() => setPanel('moves')} disabled={battle.turn !== 'player' || battle.intro} style={{ padding: '8px 4px', fontSize: 12 }}>⚔ Attack</button>
          <button className="mtgBtn" onClick={() => setPanel('items')} disabled={battle.turn !== 'player' || battle.intro} style={{ padding: '8px 4px', fontSize: 12 }}>♥ Item</button>
          <button className="mtgBtn" onClick={onCatch} disabled={battle.turn !== 'player' || battle.intro || battle.kind === 'trainer' || battle.kind === 'legendary' || battle.kind === 'planeswalker' || tokens <= 0 || (mode === 'commander' && commanderColor && !isSubsetIdentity(enemy.c, commanderColor))} style={{ padding: '8px 4px', fontSize: 12 }} title={battle.kind === 'legendary' || battle.kind === 'planeswalker' ? "This being can't be bound" : (mode === 'commander' && commanderColor && !isSubsetIdentity(enemy.c, commanderColor) ? 'Outside commander identity' : undefined)}>◆ Catch ({tokens})</button>
          <button className="mtgBtn" onClick={() => setPanel('team')} disabled={battle.turn !== 'player' || battle.intro} style={{ padding: '8px 4px', fontSize: 12, gridColumn: '1 / 3' }}>⇄ Swap Creature</button>
          <button className="mtgBtn" onClick={onFlee} disabled={battle.turn !== 'player' || battle.intro || battle.kind === 'trainer' || battle.kind === 'legendary' || battle.kind === 'planeswalker'} style={{ padding: '8px 4px', fontSize: 12 }}>➤ Flee</button>
        </div>
      )}
      {!ended && panel === 'moves' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {me.moves.map((mk) => {
              const mv = MOVES[mk];
              const st = mv.status ? STATUSES[mv.status.kind] : null;
              const penalty = me.colorPenalties?.[mv.c];
              const hasPenalty = penalty !== undefined && penalty < 1;
              return (
                <button key={mk} className="mtgBtn" onClick={() => { onMove(mk); setPanel('main'); }}
                  style={{ textAlign: 'left', borderColor: mv.c ? COLOR_DEEP[mv.c] : '#4a3a68', padding: 8 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {mv.c && <span className="manaBadge" style={{ background: COLOR_HEX[mv.c] }}>{mv.c}</span>}
                    <span style={{ fontSize: 14 }}>{mv.name}</span>
                    {st && (
                      <span style={{
                        fontSize: 10, padding: '0 4px', borderRadius: 3,
                        background: st.color, color: '#0a0614', fontWeight: 700, marginLeft: 'auto',
                      }}>{st.icon} {mv.status.chance}%</span>
                    )}
                  </div>
                  <div className="pixelFont" style={{ fontSize: 9, color: hasPenalty ? '#d8a040' : '#9888b0', marginTop: 3 }}>
                    {mv.heal ? `HEAL ${Math.round(mv.heal*100)}%` : `PWR ${mv.p} · ACC ${mv.a}`}
                    {hasPenalty && ` · ⚠ ${Math.round(penalty * 100)}%`}
                  </div>
                </button>
              );
            })}
          </div>
          <button className="mtgBtn" onClick={() => setPanel('main')} style={{ width: '100%', marginTop: 8, fontSize: 12 }}>← Back</button>
        </div>
      )}
      {!ended && panel === 'team' && (
        <div>
          <TeamPicker team={team} myIdx={battle.myIdx} onPick={(i) => { onSwitch(i); setPanel('main'); }} />
          <button className="mtgBtn" onClick={() => setPanel('main')} style={{ width: '100%', marginTop: 8, fontSize: 12 }}>← Back</button>
        </div>
      )}
      {!ended && panel === 'items' && (
        <BattleItemsPanel team={team} myIdx={battle.myIdx} items={items}
          onUse={(key, idx) => { onUseBattleItem(key, idx); setPanel('main'); }}
          onBack={() => setPanel('main')} />
      )}
    </div>
  );
}

// =========================================================================
// COMBAT CARD (HP bar, name, level)
// =========================================================================
// Displays a creature's color identity as one or more small mana pips.
// For single-color, renders one badge with the letter. For multi-color, renders
// small stacked pips (no letter — the colors are the identity).
function ManaBadge({ identity, size = 18, label = true }) {
  const cols = colorsOf(identity);
  if (cols.length === 0) return null;
  if (cols.length === 1) {
    return (
      <span className="manaBadge" style={{
        background: COLOR_HEX[cols[0]], width: size, height: size,
        fontSize: Math.round(size * 0.6), color: '#1a1428',
      }}>{label ? cols[0] : ''}</span>
    );
  }
  // Multi-color: render stacked pips at ~70% size
  const pipSize = Math.max(8, Math.round(size * 0.55));
  return (
    <span style={{
      display: 'inline-flex', gap: 1, padding: 2, borderRadius: size,
      background: '#0a0614', border: '1px solid #4a3a68', alignItems: 'center',
    }}>
      {cols.map((c, i) => (
        <span key={i} style={{
          width: pipSize, height: pipSize, borderRadius: '50%',
          background: COLOR_HEX[c], border: '1px solid #0a0614', flexShrink: 0,
        }} />
      ))}
    </span>
  );
}

function CombatCard({ creature, enemy }) {
  const pct = creature.hp / creature.maxHp;
  const barColor = pct > 0.5 ? '#5ab85a' : pct > 0.2 ? '#d8a040' : '#d84040';
  const status = creature.status ? STATUSES[creature.status.kind] : null;
  const primary = primaryColor(creature.c);
  return (
    <div style={{
      width: 180, background: 'linear-gradient(180deg, #2a2038, #141020)',
      border: `2px solid ${COLOR_DEEP[primary]}`, borderRadius: 4, padding: 8, position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creature.name}</div>
          {status && (
            <span title={status.desc} style={{
              fontSize: 11, padding: '1px 5px', borderRadius: 3,
              background: status.color, color: '#0a0614', fontWeight: 700,
              border: '1px solid #0a0614', flexShrink: 0,
            }}>{status.icon}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <ManaBadge identity={creature.c} size={16} label={colorsOf(creature.c).length === 1} />
          <span className="pixelFont" style={{ fontSize: 10 }}>Lv.{creature.level}</span>
        </div>
      </div>
      <div style={{ height: 8, background: '#0a0614', border: '1px solid #4a3a68', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct*100}%`, height: '100%', background: barColor, transition: 'width 0.4s' }} />
      </div>
      {!enemy && (
        <div className="pixelFont" style={{ fontSize: 9, color: '#9888b0', marginTop: 3 }}>
          {creature.hp}/{creature.maxHp} HP
        </div>
      )}
    </div>
  );
}

// ------- Per-creature sprite feature specs -------
// `tier` will be used later for evolution (0 = base, 1 = evolved, 2 = final).
// Features scale up with tier (bigger halo, longer ears, more flames, etc.).
const SPRITE_SPEC = {
  // --- White ---
  plains_acolyte:  { shape: 'humanoid', cloak: true,  halo: 1, staff: true },
  aven_sentinel:   { shape: 'humanoid', wings: 'bird', beak: true },
  radiant_seraph:  { shape: 'humanoid', wings: 'angel', halo: 2, regal: true },
  // --- Blue ---
  tideling:        { shape: 'merfolk',  headFin: 1, sideFins: true },
  phantom_sprite:  { shape: 'wisp',     wispTails: 2, glow: true },
  storm_leviathan: { shape: 'serpent',  dorsalFin: 2, sideFins: true, big: true },
  // --- Black ---
  shade_whelp:     { shape: 'blob',     horns: 1, ears: 'pointy' },
  blood_imp:       { shape: 'blob',     wings: 'bat', fangs: true, tailSpike: true },
  nightfall_wraith:{ shape: 'wisp',     hood: true, wispTails: 3, glow: true },
  // --- Red ---
  emberkin:        { shape: 'blob',     flames: 2, ember: true },
  goblin_raider:   { shape: 'humanoid', ears: 'pointy', fangs: true, squat: true },
  cinder_drake:    { shape: 'drake',    wings: 'dragon', horns: 2, tailSpike: true, scales: true },
  // --- Green ---
  forest_runt:     { shape: 'beast',    ears: 'round', tailBushy: true },
  elfling_scout:   { shape: 'humanoid', ears: 'long', slim: true, bow: true },
  grove_wurm:      { shape: 'serpent',  segments: true, big: true, leaves: true },

  // --- Two-color: combine color identities visually ---
  // Azorius (W+U): cleric+merfolk — staff and head fin
  skybinder:       { shape: 'humanoid', halo: 1, headFin: 1, staff: true, slim: true },
  // Dimir (U+B): wisp+hood — shadowy blue ghost
  mind_reaver:     { shape: 'wisp',     hood: true, wispTails: 2, glow: true },
  // Rakdos (B+R): imp + flames
  hellraiser:      { shape: 'blob',     wings: 'bat', flames: 2, fangs: true, horns: 1 },
  // Gruul (R+G): beast + flames/horns
  warbeast:        { shape: 'beast',    ears: 'round', horns: 2, flames: 1, tailSpike: true },
  // Selesnya (G+W): humanoid + halo + bow
  verdant_paladin: { shape: 'humanoid', halo: 1, bow: true, leaves: true, ears: 'long' },
  // Orzhov (W+B): robed figure, hood + halo
  grim_priest:     { shape: 'humanoid', hood: true, halo: 1, staff: true, slim: true },
  // Izzet (U+R): wisp-like mage with flames and fins
  stormwright:     { shape: 'wisp',     wispTails: 2, flames: 1, glow: true, sideFins: true },
  // Golgari (B+G): creepy wurm with leaves
  fungal_creeper:  { shape: 'serpent',  segments: true, leaves: true, fangs: true, glow: true },
  // Boros (R+W): armored knight
  blazing_knight:  { shape: 'humanoid', halo: 1, flames: 1, staff: true, wings: 'bird' },
  // Simic (G+U): amphibious hybrid with fin and leaves
  reef_prowler:    { shape: 'merfolk',  headFin: 1, sideFins: true, leaves: true, ears: 'pointy' },

  // --- Three-color: Shards ---
  arcane_sphinx:   { shape: 'merfolk',  wings: 'angel', halo: 1, headFin: 1, regal: true },
  void_lich:       { shape: 'wisp',     hood: true, flames: 1, glow: true, fangs: true },
  apex_predator:   { shape: 'beast',    horns: 2, fangs: true, flames: 1, tailSpike: true },
  blooming_titan:  { shape: 'humanoid', halo: 1, leaves: true, flames: 1, big: true },
  silver_pegasus:  { shape: 'beast',    wings: 'angel', halo: 1, leaves: true, ears: 'long' },

  // --- Three-color: Wedges ---
  abzan_warden:    { shape: 'humanoid', halo: 1, hood: true, leaves: true, staff: true },
  jeskai_monk:     { shape: 'humanoid', halo: 1, headFin: 1, flames: 1, slim: true },
  sultai_assassin: { shape: 'humanoid', hood: true, leaves: true, headFin: 1, fangs: true },
  mardu_warlord:   { shape: 'humanoid', halo: 1, flames: 2, fangs: true, horns: 1 },
  temur_shaman:    { shape: 'beast',    horns: 2, leaves: true, flames: 1, headFin: 1 },

  // --- Four-color: Nephilim (legendary multi-headed shapes) ---
  yore_tiller:     { shape: 'humanoid', wings: 'bat', halo: 2, headFin: 1, flames: 1, hood: true, regal: true },
  glint_eye:       { shape: 'wisp',     wings: 'bat', wispTails: 2, flames: 1, leaves: true, fangs: true, glow: true },
  dune_brood:      { shape: 'beast',    horns: 2, halo: 1, flames: 2, leaves: true, tailSpike: true, big: true },
  ink_treader:     { shape: 'merfolk',  wings: 'angel', halo: 1, leaves: true, flames: 1, headFin: 1 },
  witch_maw:       { shape: 'serpent',  segments: true, halo: 1, leaves: true, headFin: 1, fangs: true, big: true },

  // --- Five-color Prismatic Avatar (all features)
  prismatic_avatar:{ shape: 'humanoid', wings: 'angel', halo: 2, staff: true, regal: true, flames: 1 },

  // --- Legendary shrine bosses — beefy versions of their typeline with maxed features ---
  vigil_avatar:    { shape: 'humanoid', wings: 'angel', halo: 2, staff: true, regal: true, big: true },
  tidewarden:      { shape: 'serpent',  dorsalFin: 2, sideFins: true, big: true, segments: true, fangs: true },
  voidlord:        { shape: 'wisp',     hood: true, wispTails: 3, glow: true, fangs: true, horns: 2, flames: 1, big: true },
  pyreclaw:        { shape: 'drake',    wings: 'dragon', horns: 2, tailSpike: true, scales: true, flames: 2, fangs: true, big: true },
  patriarch_wurm:  { shape: 'serpent',  segments: true, big: true, leaves: true, horns: 2, fangs: true },

  // --- Final boss Planeswalker — the most ornate, all-color presence ---
  the_planeswalker: { shape: 'humanoid', wings: 'angel', halo: 2, staff: true, regal: true, flames: 2, big: true, glow: true },
};

function specFor(id) {
  return SPRITE_SPEC[id] || { shape: 'blob' };
}

function CreatureSprite({ creature, facing, scale = 1 }) {
  const s = specFor(creature.id);
  const cols = colorsOf(creature.c);
  const primary = cols[0] || 'W';
  const c = COLOR_HEX[primary];
  const d = COLOR_DEEP[primary];
  const tier = creature.tier || 0;
  const W = 72, H = 88;
  const gid = `grad_${creature.uid || creature.id || 'x'}`;
  const glowColor = `${c}88`;
  const flashing = creature.flashUntil && creature.flashUntil > Date.now();
  // Trigger a re-render at flash end so the glow clears cleanly.
  const [, force] = useState(0);
  useEffect(() => {
    if (!flashing) return;
    const remaining = creature.flashUntil - Date.now();
    const id = setTimeout(() => force(n => n + 1), remaining + 50);
    return () => clearTimeout(id);
  }, [creature.flashUntil, flashing]);
  const filter = flashing
    ? `drop-shadow(0 0 14px #ffe888) drop-shadow(0 0 20px #fff6c8)`
    : `drop-shadow(0 0 8px ${glowColor})`;
  return (
    <div style={{
      width: W * scale, height: H * scale,
      transform: facing === 'left' ? 'scaleX(-1)' : 'none',
      filter,
    }}>
      <div style={{
        width: '100%', height: '100%',
        animation: flashing ? 'gtmEvoFlash 0.7s ease-in-out infinite alternate' : undefined,
        transformOrigin: 'center',
      }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W * scale} height={H * scale}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            {cols.length <= 1 ? (
              <>
                <stop offset="0%" stopColor={c} />
                <stop offset="100%" stopColor={d} />
              </>
            ) : (
              cols.flatMap((col, i) => {
                const pct = (i / (cols.length - 1)) * 100;
                return [
                  <stop key={`l${i}`} offset={`${pct}%`} stopColor={COLOR_HEX[col]} />,
                ];
              })
            )}
          </linearGradient>
        </defs>
        <ellipse cx={W/2} cy={H-4} rx="22" ry="4" fill="rgba(0,0,0,0.55)" />
        {renderBackLayers(s, c, d, tier)}
        {renderBody(s, gid, d, tier)}
        {renderFrontLayers(s, c, d, tier)}
      </svg>
      </div>
    </div>
  );
}

function renderBody(s, gid, d, tier) {
  const stroke = '#0a0614';
  switch (s.shape) {
    case 'humanoid': {
      const slim = s.slim ? 7 : (s.squat ? 13 : 10);
      const h = s.slim ? 34 : (s.squat ? 26 : 32);
      const cy = 50;
      return (
        <g>
          <circle cx="36" cy="30" r="9" fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" />
          <path
            d={`M ${36-slim} ${cy-h/2+6} Q 36 ${cy-h/2} ${36+slim} ${cy-h/2+6} L ${36+slim+2} ${cy+h/2} L ${36-slim-2} ${cy+h/2} Z`}
            fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5"
          />
        </g>
      );
    }
    case 'merfolk':
      return (
        <g>
          <circle cx="36" cy="30" r="9" fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" />
          <path d="M 28 38 Q 36 34 44 38 L 48 62 Q 36 68 24 62 Z"
                fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" />
          <path d="M 36 62 L 28 78 L 44 78 Z" fill={d} stroke={stroke} strokeWidth="1.5" />
        </g>
      );
    case 'wisp':
      return (
        <path
          d="M 36 18 Q 20 22 20 44 Q 20 62 28 66 Q 36 72 44 66 Q 52 62 52 44 Q 52 22 36 18 Z"
          fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" opacity="0.95"
        />
      );
    case 'serpent': {
      const big = s.big;
      return (
        <g>
          <ellipse cx="36" cy="26" rx={big?12:10} ry={big?10:8}
                   fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" />
          <path
            d="M 20 44 Q 36 36 52 44 Q 60 58 44 66 Q 28 74 16 64 Q 10 52 20 44 Z"
            fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5"
          />
        </g>
      );
    }
    case 'drake':
      return (
        <g>
          <ellipse cx="36" cy="50" rx="16" ry="16" fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" />
          <ellipse cx="44" cy="34" rx="10" ry="9" fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" />
          <path d="M 22 60 Q 10 68 8 76 L 14 72 Q 20 68 26 64 Z"
                fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" />
        </g>
      );
    case 'beast':
      return (
        <g>
          <ellipse cx="36" cy="48" rx="18" ry="16" fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5" />
          <ellipse cx="36" cy="42" rx="6" ry="4" fill={d} opacity="0.7" />
        </g>
      );
    case 'blob':
    default:
      return (
        <path
          d="M 18 36 Q 36 16 54 36 Q 58 56 44 66 Q 36 70 28 66 Q 14 56 18 36 Z"
          fill={`url(#${gid})`} stroke={stroke} strokeWidth="1.5"
        />
      );
  }
}

function renderBackLayers(s, c, d, tier) {
  const stroke = '#0a0614';
  const out = [];
  if (s.wings === 'angel') {
    const spread = 20 + tier * 4;
    out.push(
      <g key="wings">
        <path d={`M 28 34 Q ${36 - spread} 20 ${36 - spread + 2} 46 Q 30 44 28 40 Z`}
              fill="#f8f0d0" stroke={stroke} strokeWidth="1.2" />
        <path d={`M 44 34 Q ${36 + spread} 20 ${36 + spread - 2} 46 Q 42 44 44 40 Z`}
              fill="#f8f0d0" stroke={stroke} strokeWidth="1.2" />
      </g>
    );
  } else if (s.wings === 'bird') {
    out.push(
      <g key="wings">
        <path d="M 28 36 Q 14 28 10 46 Q 22 46 30 42 Z" fill="#e8dcc0" stroke={stroke} strokeWidth="1.2" />
        <path d="M 44 36 Q 58 28 62 46 Q 50 46 42 42 Z" fill="#e8dcc0" stroke={stroke} strokeWidth="1.2" />
      </g>
    );
  } else if (s.wings === 'bat') {
    out.push(
      <g key="wings">
        <path d="M 26 36 Q 10 30 8 50 L 16 46 L 18 52 L 24 44 Z" fill={d} stroke={stroke} strokeWidth="1.2" />
        <path d="M 46 36 Q 62 30 64 50 L 56 46 L 54 52 L 48 44 Z" fill={d} stroke={stroke} strokeWidth="1.2" />
      </g>
    );
  } else if (s.wings === 'dragon') {
    out.push(
      <g key="wings">
        <path d="M 24 40 Q 6 30 2 52 L 14 46 L 12 54 L 22 48 Z" fill={d} stroke={stroke} strokeWidth="1.2" />
        <path d="M 48 40 Q 66 30 70 52 L 58 46 L 60 54 L 50 48 Z" fill={d} stroke={stroke} strokeWidth="1.2" />
      </g>
    );
  }
  if (s.segments) {
    out.push(
      <g key="segs" opacity="0.6">
        <ellipse cx="36" cy="46" rx="3" ry="1.5" fill={d} />
        <ellipse cx="36" cy="54" rx="3" ry="1.5" fill={d} />
        <ellipse cx="36" cy="62" rx="3" ry="1.5" fill={d} />
      </g>
    );
  }
  return out;
}

function renderFrontLayers(s, c, d, tier) {
  const stroke = '#0a0614';
  const out = [];
  let eyeY = 30, eyeDx = 3, eyeCX = 36;
  if (s.shape === 'wisp') eyeY = 36;
  if (s.shape === 'serpent') { eyeY = 26; eyeDx = 3.5; }
  if (s.shape === 'drake') { eyeY = 32; eyeCX = 44; eyeDx = 2.5; }
  if (s.shape === 'beast') { eyeY = 40; eyeDx = 4; }
  if (s.shape === 'blob') eyeY = 34;
  if (s.shape === 'merfolk') eyeY = 28;
  if (s.shape === 'humanoid') eyeY = 29;
  const eyeFill = s.glow || s.ember ? '#ffeaa0' : '#1a0a20';
  if (s.hood) {
    out.push(
      <g key="eyes">
        <ellipse cx={eyeCX - eyeDx} cy={eyeY} rx="1.8" ry="1.3" fill="#ff8844" />
        <ellipse cx={eyeCX + eyeDx} cy={eyeY} rx="1.8" ry="1.3" fill="#ff8844" />
      </g>
    );
  } else {
    out.push(
      <g key="eyes">
        <circle cx={eyeCX - eyeDx} cy={eyeY} r="1.6" fill={eyeFill} />
        <circle cx={eyeCX + eyeDx} cy={eyeY} r="1.6" fill={eyeFill} />
      </g>
    );
  }
  if (s.fangs) {
    out.push(
      <g key="fangs">
        <path d={`M ${eyeCX - 2} ${eyeY + 5} L ${eyeCX - 1} ${eyeY + 8} L ${eyeCX} ${eyeY + 5} Z`}
              fill="#fff" stroke={stroke} strokeWidth="0.6" />
        <path d={`M ${eyeCX} ${eyeY + 5} L ${eyeCX + 1} ${eyeY + 8} L ${eyeCX + 2} ${eyeY + 5} Z`}
              fill="#fff" stroke={stroke} strokeWidth="0.6" />
      </g>
    );
  }
  if (s.beak) {
    out.push(
      <path key="beak" d={`M 33 ${eyeY + 3} L 39 ${eyeY + 3} L 36 ${eyeY + 8} Z`}
            fill="#e0a040" stroke={stroke} strokeWidth="0.8" />
    );
  }
  if (s.ears === 'pointy') {
    out.push(
      <g key="ears">
        <path d="M 28 24 L 24 14 L 31 22 Z" fill={d} stroke={stroke} strokeWidth="1" />
        <path d="M 44 24 L 48 14 L 41 22 Z" fill={d} stroke={stroke} strokeWidth="1" />
      </g>
    );
  } else if (s.ears === 'long') {
    out.push(
      <g key="ears">
        <path d="M 28 24 L 20 4 L 32 22 Z" fill={d} stroke={stroke} strokeWidth="1" />
        <path d="M 44 24 L 52 4 L 40 22 Z" fill={d} stroke={stroke} strokeWidth="1" />
      </g>
    );
  } else if (s.ears === 'round') {
    out.push(
      <g key="ears">
        <circle cx="24" cy="32" r="5" fill={d} stroke={stroke} strokeWidth="1" />
        <circle cx="48" cy="32" r="5" fill={d} stroke={stroke} strokeWidth="1" />
        <circle cx="24" cy="32" r="2.5" fill={c} opacity="0.7" />
        <circle cx="48" cy="32" r="2.5" fill={c} opacity="0.7" />
      </g>
    );
  }
  if (s.horns) {
    const hh = 6 + s.horns * 4;
    out.push(
      <g key="horns">
        <path d={`M 30 24 L 27 ${24 - hh} L 33 22 Z`} fill="#d8c080" stroke={stroke} strokeWidth="1" />
        <path d={`M 42 24 L 45 ${24 - hh} L 39 22 Z`} fill="#d8c080" stroke={stroke} strokeWidth="1" />
      </g>
    );
  }
  if (s.halo) {
    const hr = 6 + s.halo * 4;
    out.push(
      <ellipse key="halo" cx="36" cy="16" rx={hr} ry={hr * 0.35}
               fill="none" stroke="#ffe888" strokeWidth={1.5 + s.halo * 0.5} opacity="0.9" />
    );
  }
  if (s.headFin) {
    out.push(
      <path key="hfin" d="M 36 22 L 34 14 L 38 14 Z" fill={d} stroke={stroke} strokeWidth="1" />
    );
  }
  if (s.sideFins) {
    const y = s.shape === 'serpent' ? 44 : 42;
    out.push(
      <g key="sfins">
        <path d={`M 22 ${y} L 14 ${y + 4} L 20 ${y + 6} Z`} fill={d} stroke={stroke} strokeWidth="1" />
        <path d={`M 50 ${y} L 58 ${y + 4} L 52 ${y + 6} Z`} fill={d} stroke={stroke} strokeWidth="1" />
      </g>
    );
  }
  if (s.dorsalFin) {
    out.push(
      <path key="dfin" d="M 36 18 L 30 6 L 34 14 L 38 6 L 42 14 L 36 18 Z"
            fill={d} stroke={stroke} strokeWidth="1" />
    );
  }
  if (s.wispTails) {
    const tails = [];
    for (let i = 0; i < s.wispTails; i++) {
      const x = 28 + i * 8;
      tails.push(
        <path key={`wt${i}`}
              d={`M ${x} 64 Q ${x + 2} 74 ${x} 82 Q ${x - 3} 76 ${x} 64 Z`}
              fill={d} opacity="0.75" />
      );
    }
    out.push(<g key="wtails">{tails}</g>);
  }
  if (s.tailSpike) {
    out.push(
      <path key="tspike" d="M 18 68 L 6 78 L 14 72 L 10 82 L 22 70 Z"
            fill={d} stroke={stroke} strokeWidth="1" />
    );
  }
  if (s.tailBushy) {
    out.push(
      <g key="btail">
        <ellipse cx="54" cy="52" rx="6" ry="10" fill={d} stroke={stroke} strokeWidth="1" />
        <ellipse cx="54" cy="52" rx="3" ry="6" fill={c} opacity="0.6" />
      </g>
    );
  }
  if (s.flames) {
    const tallness = 6 + s.flames * 3;
    out.push(
      <g key="flames">
        <path d={`M 36 22 Q 30 ${22 - tallness} 34 10 Q 36 ${18 - tallness} 38 10 Q 42 ${22 - tallness} 36 22 Z`}
              fill="#ffaa30" />
        <path d={`M 30 26 Q 26 ${26 - tallness*0.6} 30 18 Q 32 22 34 20 Q 34 ${26 - tallness*0.4} 30 26 Z`}
              fill="#ff7020" />
        <path d={`M 42 26 Q 46 ${26 - tallness*0.6} 42 18 Q 40 22 38 20 Q 38 ${26 - tallness*0.4} 42 26 Z`}
              fill="#ff7020" />
      </g>
    );
  }
  if (s.hood) {
    out.push(
      <path key="hood"
            d="M 22 18 Q 36 0 50 18 Q 48 30 44 32 L 28 32 Q 24 30 22 18 Z"
            fill="#1a0a24" stroke={stroke} strokeWidth="1.2" />
    );
  }
  if (s.staff) {
    out.push(
      <g key="staff">
        <line x1="52" y1="34" x2="56" y2="70" stroke="#8a6a40" strokeWidth="2" />
        <circle cx="52" cy="32" r="3" fill="#ffe888" stroke={stroke} strokeWidth="0.8" />
      </g>
    );
  }
  if (s.bow) {
    out.push(
      <g key="bow">
        <path d="M 52 36 Q 60 50 52 64" fill="none" stroke="#8a6a40" strokeWidth="1.5" />
        <line x1="52" y1="36" x2="52" y2="64" stroke="#c8b088" strokeWidth="0.8" />
      </g>
    );
  }
  if (s.leaves) {
    out.push(
      <g key="leaves">
        <ellipse cx="32" cy="18" rx="3" ry="5" fill="#5a9030"
                 transform="rotate(-25 32 18)" stroke={stroke} strokeWidth="0.6" />
        <ellipse cx="40" cy="18" rx="3" ry="5" fill="#5a9030"
                 transform="rotate(25 40 18)" stroke={stroke} strokeWidth="0.6" />
      </g>
    );
  }
  if (s.scales) {
    out.push(
      <g key="scales" opacity="0.5">
        <path d="M 30 48 Q 34 44 38 48 Q 42 44 46 48" fill="none" stroke={d} strokeWidth="0.8" />
        <path d="M 30 54 Q 34 50 38 54 Q 42 50 46 54" fill="none" stroke={d} strokeWidth="0.8" />
      </g>
    );
  }
  if (s.ember) {
    out.push(
      <circle key="ember" cx="36" cy="50" r="6" fill="#ffaa40" opacity="0.5" />
    );
  }
  return out;
}

function TeamPicker({ team, myIdx, onPick, forced }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
      {forced && <div style={{ fontSize: 12, color: '#d8a040' }}>Choose a creature to summon:</div>}
      {team.map((c, i) => {
        const disabled = c.hp <= 0 || i === myIdx;
        return (
          <button key={c.uid} className="mtgBtn" onClick={() => !disabled && onPick(i)} disabled={disabled}
            style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderColor: COLOR_DEEP[primaryColor(c.c)] }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ManaBadge identity={c.c} size={16} label={colorsOf(c.c).length === 1} />
              <span style={{ fontSize: 14 }}>{c.name}</span>
              <span className="pixelFont" style={{ fontSize: 10, color: '#9888b0' }}>Lv.{c.level}</span>
              {i === myIdx && <span className="pixelFont" style={{ fontSize: 9, color: '#d8a040' }}>[ACTIVE]</span>}
            </div>
            <span className="pixelFont" style={{ fontSize: 10 }}>{c.hp}/{c.maxHp}</span>
          </button>
        );
      })}
    </div>
  );
}

function BattleItemsPanel({ team, myIdx, items, onUse, onBack }) {
  const [selectedKey, setSelectedKey] = useState(null);
  const entries = Object.entries(items).filter(([k, n]) => n > 0 && ITEMS[k] && ITEMS[k].kind !== 'card');
  if (entries.length === 0) {
    return (
      <div>
        <div style={{ padding: 12, textAlign: 'center', color: '#9080b0', fontSize: 12,
          border: '1.5px solid #4a3a68', borderRadius: 4, marginBottom: 8 }}>
          No usable items. Buy some at Merle's shop.
        </div>
        <button className="mtgBtn" onClick={onBack} style={{ width: '100%', fontSize: 12 }}>← Back</button>
      </div>
    );
  }
  if (selectedKey) {
    const it = ITEMS[selectedKey];
    const valid = (c) => it.kind === 'revive' ? c.hp <= 0 : it.kind === 'heal' ? c.hp < c.maxHp && c.hp > 0 : true;
    return (
      <div>
        <div style={{ fontSize: 12, color: '#d8c890', marginBottom: 6 }}>
          Use <b>{it.name}</b> on:
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          {team.map((c, i) => (
            <button key={c.uid} className="mtgBtn" disabled={!valid(c)}
              onClick={() => onUse(selectedKey, i)}
              style={{ padding: 6, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ManaBadge identity={c.c} size={16} label={colorsOf(c.c).length === 1} />
              <span style={{ fontSize: 12, flex: 1 }}>{c.name}{i === myIdx ? ' (active)' : ''}</span>
              <span style={{ fontSize: 11, color: c.hp <= 0 ? '#d84040' : '#9888b0' }}>
                {c.hp <= 0 ? 'Fainted' : `HP ${c.hp}/${c.maxHp}`}
              </span>
            </button>
          ))}
        </div>
        <button className="mtgBtn" onClick={() => setSelectedKey(null)} style={{ width: '100%', marginTop: 8, fontSize: 12 }}>← Back</button>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'grid', gap: 4 }}>
        {entries.map(([key, count]) => {
          const it = ITEMS[key];
          return (
            <button key={key} className="mtgBtn" onClick={() => setSelectedKey(key)}
              style={{ padding: 6, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{it.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{it.name}</div>
                <div style={{ fontSize: 10, color: '#9888b0' }}>{it.desc}</div>
              </div>
              <span style={{ fontSize: 12, color: '#c8b088' }}>× {count}</span>
            </button>
          );
        })}
      </div>
      <button className="mtgBtn" onClick={onBack} style={{ width: '100%', marginTop: 8, fontSize: 12 }}>← Back</button>
    </div>
  );
}

// Color-graft prompt: shown to a Commander-mode commander at levels 5/10/15/20/25.
// Player picks one of three: add a new color, learn a new move (in current identity),
// or lock identity (no more prompts ever).
// =========================================================================
// GRAFT PANEL — used at commander milestones.
//   kind === 'color' (levels 5/10/15/20): pick a new color to add, skip, or lock
//   kind === 'attack' (levels 6/11/16/21): learn an attack
//     - if `creature.lastGraftAddedColor` is set, the pool is moves of just that color
//     - otherwise, a curated pool drawn at random from the creature's current colors
// =========================================================================
function GraftPanel({ creature, kind = 'color', onResolve }) {
  const currentCols = colorsOf(creature.c);
  const availableCols = ['W', 'U', 'B', 'R', 'G'].filter(c => !currentCols.includes(c));
  const lastAdded = creature.colorAddOrder?.[creature.colorAddOrder.length - 1];
  const knownMoves = new Set(creature.moves);
  // The focus color (if any) drives the attack-milestone move pool.
  const focusColor = creature.lastGraftAddedColor;

  // Build the attack-milestone move pool. If `focusColor` is set we narrow to that color;
  // otherwise we draw from the union of the creature's current colors. Memoize on creature
  // identity + level so the random "any color" sample doesn't reshuffle on each render.
  const attackPool = useMemo(() => {
    let pool = [];
    if (focusColor) {
      pool = Object.entries(MOVES)
        .filter(([key, m]) => m.c === focusColor && !knownMoves.has(key) && m.p > 0)
        .map(([key, m]) => ({ key, ...m }));
    }
    // Fall back (or use directly when there's no focus) to any-current-color pool.
    if (pool.length === 0) {
      pool = Object.entries(MOVES)
        .filter(([key, m]) => m.c && currentCols.includes(m.c) && !knownMoves.has(key) && m.p > 0)
        .map(([key, m]) => ({ key, ...m }));
    }
    if (focusColor) {
      // Strongest options first when the player just chose a color — feels rewarding.
      pool.sort((a, b) => (b.p || 0) - (a.p || 0));
      return pool.slice(0, 4);
    }
    // "At random within the creature's colors" — seeded by creature uid + level so it
    // remains stable while the panel is open, but feels like a fresh roll each milestone.
    const seedStr = `${creature.uid || creature.id || 'x'}-${creature.level}`;
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) | 0;
    const rng = () => { seed = (seed * 1103515245 + 12345) | 0; return ((seed >>> 0) % 1000) / 1000; };
    // Fisher–Yates with seeded RNG, then take top 3-4 entries.
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, Math.min(4, shuffled.length));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creature.uid, creature.id, creature.level, focusColor, creature.c]);

  // ============= COLOR MILESTONE PANEL =============
  if (kind === 'color') {
    return (
      <div style={{
        background: 'linear-gradient(180deg, #2a1c40 0%, #1a0e28 100%)',
        border: '2px solid #9a80c0', borderRadius: 6, padding: 12,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: '#e8dcc0' }}>
          ✦ Crossroads — Lv.{creature.level}
        </div>
        <div style={{ fontSize: 11, color: '#c8b8d0', marginBottom: 8, lineHeight: 1.4 }}>
          {creature.name} can take on a new color. Pick one to graft, skip for now, or lock the identity.
        </div>
        <div style={{ fontSize: 10, color: '#9888b0', marginBottom: 8, lineHeight: 1.3 }}>
          A grafted color expands your catch range and unlocks an attack of that color at the next milestone. The previous added color (<b>{COLOR_NAME[lastAdded] || lastAdded}</b>) loses 10% damage as it's displaced.
        </div>
        {availableCols.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 6, marginBottom: 8 }}>
            {availableCols.map(c => (
              <button key={c} className="mtgBtn" onClick={() => onResolve({ action: 'add', color: c })}
                style={{
                  padding: 8, fontSize: 11, textAlign: 'center',
                  border: `2px solid ${COLOR_DEEP[c]}`,
                  background: `linear-gradient(180deg, ${COLOR_HEX[c]}33 0%, #140820 100%)`,
                }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: COLOR_HEX[c], border: '1px solid #0a0614',
                  margin: '0 auto 3px',
                }} />
                <div style={{ fontWeight: 700 }}>+{c}</div>
                <div style={{ fontSize: 9, color: '#9888b0' }}>{COLOR_NAME[c]}</div>
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button className="mtgBtn" onClick={() => onResolve({ action: 'skip' })}
            style={{ padding: 8, fontSize: 11 }} title="Don't add a color this milestone — ask again next time.">
            ▸ Skip this time
          </button>
          <button className="mtgBtn" onClick={() => onResolve({ action: 'lock' })}
            style={{ padding: 8, fontSize: 11 }} title="Stop offering color grafts entirely. Attack milestones will still fire.">
            🔒 Lock identity
          </button>
        </div>
      </div>
    );
  }

  // ============= ATTACK MILESTONE PANEL =============
  // Always presents one or more attack options. If no moves remain in any pool, lets the
  // player acknowledge and move on.
  return (
    <div style={{
      background: 'linear-gradient(180deg, #2a1c40 0%, #1a0e28 100%)',
      border: `2px solid ${focusColor ? COLOR_DEEP[focusColor] : '#9a80c0'}`, borderRadius: 6, padding: 12,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: '#e8dcc0', display: 'flex', alignItems: 'center', gap: 6 }}>
        {focusColor && (
          <span style={{
            display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
            background: COLOR_HEX[focusColor], border: '1px solid #0a0614',
          }} />
        )}
        ✦ {focusColor ? `${COLOR_NAME[focusColor]} Awakening` : 'New Magic'} — Lv.{creature.level}
      </div>
      <div style={{ fontSize: 11, color: '#c8b8d0', marginBottom: 8, lineHeight: 1.4 }}>
        {focusColor
          ? `${creature.name} resonates with the ${COLOR_NAME[focusColor]} mana you grafted. Pick an attack of that color to learn:`
          : `${creature.name} feels new power surface. An attack from your current colors offers itself:`}
        {creature.moves.length >= 4 && ' (You\'re at 4 moves — picking one will ask which to forget.)'}
      </div>
      {attackPool.length > 0 ? (
        <div style={{ display: 'grid', gap: 4, maxHeight: 200, overflowY: 'auto' }} className="scroll">
          {attackPool.map(m => {
            const st = m.status ? STATUSES[m.status.kind] : null;
            return (
              <button key={m.key} className="mtgBtn"
                onClick={() => onResolve({ action: 'learn', move: m.key })}
                style={{
                  padding: 7, fontSize: 11, textAlign: 'left',
                  borderColor: COLOR_DEEP[m.c],
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                <span style={{
                  display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
                  background: COLOR_HEX[m.c], border: '1px solid #0a0614', flexShrink: 0,
                }} />
                <span style={{ fontWeight: 700, flex: 1 }}>{m.name}</span>
                {st && (
                  <span style={{
                    fontSize: 9, padding: '0 3px', borderRadius: 2,
                    background: st.color, color: '#0a0614', fontWeight: 700,
                  }}>{st.icon}</span>
                )}
                <span style={{ fontSize: 9, color: '#9888b0' }}>
                  {m.p} dmg · {m.a}%
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#9888b0', fontStyle: 'italic', padding: '8px 0' }}>
          No new attacks available — you already know every move in your color pool.
        </div>
      )}
      <button className="mtgBtn" onClick={() => onResolve({ action: 'skip-attack' })}
        style={{ width: '100%', marginTop: 8, padding: 8, fontSize: 11, opacity: 0.8 }}>
        ▸ Don't learn anything new
      </button>
    </div>
  );
}

function MoveLearnPanel({ creature, newMove, onChoose }) {
  const nm = MOVES[newMove];
  return (
    <div style={{
      border: `2px solid ${nm.c ? COLOR_DEEP[nm.c] : '#6a5a88'}`, borderRadius: 6,
      padding: 10, background: 'linear-gradient(180deg, #1a1428 0%, #0f0a1c 100%)',
    }}>
      <div style={{ fontSize: 13, color: '#d8c890', marginBottom: 8 }}>
        <b>{creature.name}</b> wants to learn:
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: 8,
        border: `1.5px solid ${nm.c ? COLOR_DEEP[nm.c] : '#4a3a68'}`,
        borderRadius: 4, marginBottom: 10, background: '#0a0614',
      }}>
        {nm.c && <span className="manaBadge" style={{ background: COLOR_HEX[nm.c] }}>{nm.c}</span>}
        <span style={{ fontWeight: 700, fontSize: 14 }}>{nm.name}</span>
        <span className="pixelFont" style={{ fontSize: 10, color: '#9888b0', marginLeft: 'auto' }}>
          {nm.heal ? `Heal ${Math.round(nm.heal*100)}%` : `Pwr ${nm.p}`} · Acc {nm.a}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#9080b0', marginBottom: 6 }}>Forget a move to make room:</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {creature.moves.map((mk, i) => {
          const mv = MOVES[mk];
          return (
            <button key={i} className="mtgBtn" onClick={() => onChoose(i)}
              style={{ textAlign: 'left', padding: 8, display: 'flex', alignItems: 'center', gap: 8,
                borderColor: mv.c ? COLOR_DEEP[mv.c] : '#4a3a68' }}>
              {mv.c && <span className="manaBadge" style={{ background: COLOR_HEX[mv.c] }}>{mv.c}</span>}
              <span style={{ fontSize: 13 }}>{mv.name}</span>
              <span className="pixelFont" style={{ fontSize: 10, color: '#9888b0', marginLeft: 'auto' }}>
                {mv.heal ? `Heal ${Math.round(mv.heal*100)}%` : `Pwr ${mv.p}`} · Acc {mv.a}
              </span>
            </button>
          );
        })}
        <button className="mtgBtn" onClick={() => onChoose(-1)}
          style={{ padding: 8, fontSize: 12, color: '#9080b0', marginTop: 4 }}>
          Don't learn {nm.name}
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// CHAMPION LEARN PANEL — post-Planeswalker reward.
// The commander (or main creature in Classic) gets to pick ONE attack from any
// color pool. If the creature already has 4 moves, the player must forget one.
// =========================================================================
function ChampionLearnPanel({ creature, onLearn, onSkip }) {
  const [stage, setStage] = useState('pick'); // 'pick' | 'forget'
  const [chosen, setChosen] = useState(null);
  const knownMoves = new Set(creature.moves);
  // Offer all damaging moves the creature doesn't already know, sorted by power.
  const offerings = Object.entries(MOVES)
    .filter(([key, m]) => !knownMoves.has(key) && m.p > 0)
    .map(([key, m]) => ({ key, ...m }))
    .sort((a, b) => (b.p || 0) - (a.p || 0));
  const acceptPick = (moveKey) => {
    if (creature.moves.length < 4) {
      onLearn(moveKey, -1);
      return;
    }
    setChosen(moveKey);
    setStage('forget');
  };
  return (
    <div style={{
      background: 'linear-gradient(180deg, #2a1c40 0%, #1a0e28 100%)',
      border: '2px solid #e8c860', borderRadius: 6, padding: 12,
      boxShadow: '0 0 24px rgba(232, 200, 96, 0.3)',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: '#ffe888', textShadow: '0 0 8px rgba(232, 200, 96, 0.5)' }}>
        ✦ Planar Spark — Lv.{creature.level}
      </div>
      <div style={{ fontSize: 11, color: '#e8d8b0', marginBottom: 10, lineHeight: 1.4 }}>
        {stage === 'pick'
          ? `${creature.name} has touched the spark of The Planeswalker. Choose a single attack from any color — the wheel itself will teach it.`
          : `${creature.name} already knows four moves. Which will you forget to make room for ${MOVES[chosen]?.name}?`}
      </div>
      {stage === 'pick' && (
        <>
          <div style={{ display: 'grid', gap: 4, maxHeight: 240, overflowY: 'auto' }} className="scroll">
            {offerings.map(m => {
              const st = m.status ? STATUSES[m.status.kind] : null;
              return (
                <button key={m.key} className="mtgBtn" onClick={() => acceptPick(m.key)}
                  style={{
                    padding: 7, fontSize: 11, textAlign: 'left',
                    borderColor: m.c ? COLOR_DEEP[m.c] : '#4a3a68',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  <span style={{
                    display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
                    background: m.c ? COLOR_HEX[m.c] : '#888', border: '1px solid #0a0614', flexShrink: 0,
                  }} />
                  <span style={{ fontWeight: 700, flex: 1 }}>{m.name}</span>
                  {st && (
                    <span style={{
                      fontSize: 9, padding: '0 3px', borderRadius: 2,
                      background: st.color, color: '#0a0614', fontWeight: 700,
                    }}>{st.icon}</span>
                  )}
                  <span style={{ fontSize: 9, color: '#9888b0' }}>
                    {m.p} dmg · {m.a}%
                  </span>
                </button>
              );
            })}
          </div>
          <button className="mtgBtn" onClick={onSkip}
            style={{ width: '100%', marginTop: 6, padding: 6, fontSize: 11, opacity: 0.7 }}>
            Refuse the spark
          </button>
        </>
      )}
      {stage === 'forget' && (
        <div style={{ display: 'grid', gap: 6 }}>
          {creature.moves.map((mk, i) => {
            const mv = MOVES[mk];
            return (
              <button key={i} className="mtgBtn" onClick={() => onLearn(chosen, i)}
                style={{ textAlign: 'left', padding: 8, display: 'flex', alignItems: 'center', gap: 8,
                  borderColor: mv.c ? COLOR_DEEP[mv.c] : '#4a3a68' }}>
                {mv.c && <span className="manaBadge" style={{ background: COLOR_HEX[mv.c] }}>{mv.c}</span>}
                <span style={{ fontSize: 12, flex: 1 }}>Forget {mv.name}</span>
                <span style={{ fontSize: 10, color: '#9888b0' }}>
                  {mv.heal ? `Heal ${Math.round(mv.heal*100)}%` : `Pwr ${mv.p}`}
                </span>
              </button>
            );
          })}
          <button className="mtgBtn" onClick={() => { setStage('pick'); setChosen(null); }}
            style={{ padding: 6, fontSize: 11, opacity: 0.7 }}>← Back</button>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// MENU SCREEN
// =========================================================================
function MenuScreen({ team, codex, tokens, gold, items, mode, commanderColor, storageBroken, defeated, trainerCycles, medallions, planeswalkerDefeated, onUseItem, onClose, onReset, onSaveQuit, onRelease, onCheckStorage }) {
  const [tab, setTab] = useState('team');
  const [pickingFor, setPickingFor] = useState(null); // item key to use, waiting for team pick
  const [releaseConfirm, setReleaseConfirm] = useState(null); // index of creature awaiting release confirmation
  // Audio mute toggle — read once on mount; persists via the audio engine itself.
  const [muted, setMuted] = useState(audio.isMuted());
  return (
    <div style={{ width: 'min(94vw, 440px)', margin: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Spellbook</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* Sound toggle — always visible at the top of the menu so it can't be missed
              regardless of which tab is selected. */}
          <button className="mtgBtn"
            onClick={() => {
              const next = !muted;
              audio.setMuted(next);
              setMuted(next);
              if (!next) audio.sfx.confirm();
            }}
            style={{ padding: '4px 8px', fontSize: 13 }}
            title={muted ? 'Tap to enable music & sound effects' : 'Tap to mute music & sound effects'}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="mtgBtn" onClick={onClose} style={{ padding: '4px 10px' }}>✕ Close</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {['team','codex','items'].map(t => (
          <button key={t} className="mtgBtn" onClick={() => setTab(t)} style={{ flex: 1, padding: 6, fontSize: 12, opacity: tab === t ? 1 : 0.6 }}>
            {t === 'team' ? 'Team' : t === 'codex' ? 'Codex' : 'Items'}
          </button>
        ))}
      </div>
      {tab === 'team' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, justifyItems: 'center' }}>
            {team.length === 0 && <div style={{ color: '#9080b0' }}>No creatures yet.</div>}
            {team.map((c, i) => {
              const isCommander = mode === 'commander' && i === 0;
              const canRelease = !isCommander && team.length > 1;
              return (
                <div key={c.uid} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ position: 'relative' }}>
                    <CreatureCard c={c} />
                    {isCommander && (
                      <div style={{
                        position: 'absolute', top: -6, right: -6,
                        padding: '2px 6px', fontSize: 9, fontWeight: 700,
                        background: '#9a80c0', color: '#1a0e28',
                        borderRadius: 3, border: '1.5px solid #1a0e28',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                      }}>✦ CMDR</div>
                    )}
                    {c.championBadge && (
                      <div style={{
                        position: 'absolute', top: -6, left: -6,
                        padding: '2px 6px', fontSize: 9, fontWeight: 700,
                        background: 'linear-gradient(135deg, #f3e3a8 0%, #6cb8e0 25%, #8a7a92 50%, #e06d5a 75%, #6fb06f 100%)',
                        color: '#1a0e28',
                        borderRadius: 3, border: '1.5px solid #1a0e28',
                        boxShadow: '0 0 8px rgba(232, 200, 96, 0.5)',
                      }} title="Defeated The Planeswalker">★ CHAMPION</div>
                    )}
                  </div>
                  {canRelease ? (
                    <button className="mtgBtn" onClick={() => setReleaseConfirm(i)}
                      style={{ fontSize: 10, padding: '3px 8px', opacity: 0.75 }}>
                      ✕ Release
                    </button>
                  ) : (
                    <div style={{ fontSize: 9, color: '#7a6a90', fontStyle: 'italic', height: 18 }}>
                      {isCommander ? 'Commander — bound for life' : 'Last creature — cannot release'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {releaseConfirm !== null && team[releaseConfirm] && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(10,6,20,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 50, padding: 16,
            }} onClick={() => setReleaseConfirm(null)}>
              <div onClick={e => e.stopPropagation()} style={{
                background: 'linear-gradient(180deg, #2a2038, #141020)',
                border: '2px solid #6a5a88', borderRadius: 6, padding: 18,
                maxWidth: 320, boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#e8dcc0' }}>
                  Release {team[releaseConfirm].name}?
                </div>
                <div style={{ fontSize: 12, color: '#c8b8d0', marginBottom: 14, lineHeight: 1.4 }}>
                  This creature will be removed from your team permanently. You'll still see it in your codex, and you can catch another in the wild.
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="mtgBtn" onClick={() => setReleaseConfirm(null)}
                    style={{ padding: '6px 12px', fontSize: 12 }}>Cancel</button>
                  <button className="mtgBtn" onClick={() => { onRelease(releaseConfirm); setReleaseConfirm(null); }}
                    style={{ padding: '6px 12px', fontSize: 12, borderColor: '#a04848', color: '#f0c0c0' }}>
                    Release
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {tab === 'codex' && (
        <div>
          <div style={{ fontSize: 12, color: '#9080b0', marginBottom: 8 }}>
            Seen: {Object.keys(codex).length} / {Object.keys(DEX).length}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, justifyItems: 'center' }}>
            {Object.entries(DEX).map(([id, d]) => {
              const entry = codex[id];
              const caught = entry?.caught > 0;
              // Caught: real mini card. Seen (but not caught): grayscale card silhouette. Unseen: card back.
              if (caught) {
                return (
                  <div key={id} style={{ position: 'relative' }}>
                    <CreatureCard c={{ ...d, id, level: 1, hp: d.hp, maxHp: d.hp, moves: d.m }} small />
                    <div style={{
                      position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)',
                      fontSize: 9, color: '#e8dcc0', background: '#0a0614', padding: '1px 6px',
                      borderRadius: 2, border: '1px solid #4a3a68',
                    }} className="pixelFont">caught × {entry.caught}</div>
                  </div>
                );
              }
              if (entry) {
                return (
                  <div key={id} style={{ filter: 'grayscale(1) brightness(0.5)', position: 'relative' }}>
                    <CreatureCard c={{ ...d, id, level: 1, hp: d.hp, maxHp: d.hp, moves: d.m }} small />
                    <div style={{
                      position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)',
                      fontSize: 9, color: '#e8dcc0', background: '#0a0614', padding: '1px 6px',
                      borderRadius: 2, border: '1px solid #4a3a68', filter: 'grayscale(0) brightness(2)',
                    }} className="pixelFont">seen × {entry.seen}</div>
                  </div>
                );
              }
              // Unseen: card back
              return <CardBack key={id} />;
            })}
          </div>
        </div>
      )}
      {tab === 'items' && (
        <div>
          {/* Commander banner */}
          {mode === 'commander' && commanderColor && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              padding: 8, border: '1.5px solid #9a80c0', borderRadius: 4,
              background: 'linear-gradient(180deg, #2a1c40 0%, #1a1028 100%)',
            }}>
              <span style={{ fontSize: 12, color: '#c8b8e0', fontWeight: 700 }}>✦ Commander identity</span>
              <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
                {colorsOf(commanderColor).map((col, i) => (
                  <span key={i} style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: COLOR_HEX[col], border: '1px solid #0a0614' }} title={COLOR_NAME[col]} />
                ))}
              </div>
            </div>
          )}
          {/* Resource summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
            <div style={{ padding: 8, border: '1.5px solid #4a3a68', borderRadius: 4, background: '#1a1428' }}>
              <div style={{ fontSize: 12 }}>◆ Cards</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>× {tokens}</div>
            </div>
            <div style={{ padding: 8, border: '1.5px solid #4a3a68', borderRadius: 4, background: '#1a1428' }}>
              <div style={{ fontSize: 12 }}>✦ Gold</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{gold}g</div>
            </div>
          </div>
          {/* Zone-clear progress */}
          <div style={{
            padding: 8, marginBottom: 10, border: '1.5px solid #4a3a68', borderRadius: 4,
            background: '#1a1428',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12 }}>⚔ Zone Challengers</div>
              <div style={{ fontSize: 11, color: '#9888b0' }}>
                Cycle {trainerCycles + 1}{trainerCycles > 0 ? ` (+${trainerCycles * 2} lv)` : ''}
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#9888b0', marginTop: 3 }}>
              {[...ZONE_TRAINER_IDS].filter(id => defeated.includes(id)).length} / 5 defeated this cycle
            </div>
          </div>
          {/* Medallions — earned by defeating each shrine boss. Once all 5 are gathered the
              town shrine becomes the gateway to The Planeswalker. */}
          <div style={{
            padding: 8, marginBottom: 10, border: '1.5px solid #4a3a68', borderRadius: 4,
            background: '#1a1428',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12 }}>◉ Shrine Medallions</div>
              <div style={{ fontSize: 11, color: '#9888b0' }}>
                {(medallions || []).length} / 5
                {planeswalkerDefeated && ' · ★ Champion'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 6, justifyContent: 'flex-start' }}>
              {['G','U','R','B','W'].map(col => {
                const has = (medallions || []).includes(col);
                return (
                  <div key={col} title={has ? `${COLOR_NAME[col]} medallion (collected)` : `${COLOR_NAME[col]} medallion (not yet)`}
                    style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: has ? COLOR_HEX[col] : '#0a0614',
                      border: has ? `2px solid ${COLOR_DEEP[col]}` : '2px dashed #3a2850',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: has ? '#1a0e28' : '#3a2850',
                      boxShadow: has ? `0 0 6px ${COLOR_HEX[col]}88` : 'none',
                    }}>
                    {has ? col : '?'}
                  </div>
                );
              })}
              <div style={{ flex: 1 }} />
              {planeswalkerDefeated && (
                <div title="The Planeswalker has been defeated"
                  style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #f3e3a8 0%, #6cb8e0 25%, #8a7a92 50%, #e06d5a 75%, #6fb06f 100%)',
                    border: '2px solid #1a0e28',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: '#1a0e28',
                    boxShadow: '0 0 8px rgba(232, 200, 96, 0.5)',
                  }}>★</div>
              )}
            </div>
            {(medallions || []).length === 0 && (
              <div style={{ fontSize: 9, color: '#7a6898', marginTop: 5, fontStyle: 'italic' }}>
                Each zone has a hidden building. Clear all five challengers once and the buildings open.
              </div>
            )}
          </div>
          {/* Target picker sub-mode */}
          {pickingFor && (() => {
            const it = ITEMS[pickingFor];
            const valid = (c) => it.kind === 'revive' ? c.hp <= 0 : it.kind === 'heal' ? c.hp < c.maxHp && c.hp > 0 : true;
            return (
              <div style={{ border: '2px solid #9a80c0', borderRadius: 6, padding: 10, marginBottom: 8, background: '#1a1428' }}>
                <div style={{ fontSize: 12, color: '#d8c890', marginBottom: 6 }}>
                  Use <b>{it.name}</b> on which creature?
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {team.map((c, i) => (
                    <button key={c.uid} className="mtgBtn" disabled={!valid(c)}
                      onClick={() => { onUseItem(pickingFor, i, false); setPickingFor(null); }}
                      style={{ padding: 6, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ManaBadge identity={c.c} size={16} label={colorsOf(c.c).length === 1} />
                      <span style={{ fontSize: 12, flex: 1 }}>{c.name}</span>
                      <span style={{ fontSize: 11, color: c.hp <= 0 ? '#d84040' : '#9888b0' }}>
                        {c.hp <= 0 ? 'Fainted' : `HP ${c.hp}/${c.maxHp}`}
                      </span>
                    </button>
                  ))}
                </div>
                <button className="mtgBtn" onClick={() => setPickingFor(null)}
                  style={{ marginTop: 6, width: '100%', padding: 4, fontSize: 11 }}>Cancel</button>
              </div>
            );
          })()}
          {/* Inventory list */}
          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            {Object.entries(items).filter(([, n]) => n > 0).length === 0 && (
              <div style={{ color: '#9080b0', fontSize: 12, textAlign: 'center', padding: 12 }}>
                No items. Visit Merle's shop in town.
              </div>
            )}
            {Object.entries(items).filter(([, n]) => n > 0).map(([key, count]) => {
              const it = ITEMS[key];
              if (!it) return null;
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: 8, border: '1.5px solid #4a3a68', borderRadius: 4, background: '#1a1428',
                }}>
                  <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{it.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{it.name}</div>
                    <div style={{ fontSize: 10, color: '#9888b0' }}>{it.desc}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#c8b088' }}>× {count}</span>
                  <button className="mtgBtn" onClick={() => setPickingFor(key)}
                    disabled={it.kind === 'card'}
                    style={{ padding: '4px 10px', fontSize: 11 }}>
                    Use
                  </button>
                </div>
              );
            })}
          </div>
          {storageBroken ? (
            <div style={{
              padding: 8, marginBottom: 6, fontSize: 11, color: '#c8b890',
              border: '1px dashed #6a5a48', borderRadius: 4, background: '#1f1810',
              lineHeight: 1.4,
            }}>
              ⚠ Save unavailable in this session — the storage API isn't responding. Your run is preserved while the app stays open.
            </div>
          ) : (
            <>
              <button className="mtgBtn" onClick={onSaveQuit} style={{ width: '100%', fontSize: 12, marginBottom: 6 }}>
                💾 Save & Return to Title
              </button>
              <button className="mtgBtn" onClick={onCheckStorage} style={{ width: '100%', fontSize: 11, marginBottom: 6, opacity: 0.75 }}>
                🔍 Check storage status
              </button>
            </>
          )}
          <button className="mtgBtn" onClick={onReset} style={{ width: '100%', fontSize: 11, opacity: 0.6 }}>
            Abandon run & return to title
          </button>
        </div>
      )}
    </div>
  );
}

// MTG-style card palette per color. `frame` is the beveled border, `inner` is the card body tint,
// `textBg` is the abilities parchment area, `textColor` is the body text color.
const CARD_STYLE = {
  W: { frame: 'linear-gradient(180deg, #f8ecc0 0%, #d8b060 100%)', inner: '#f0e6c8', textBg: '#faf4d8', textColor: '#2a1c08' },
  U: { frame: 'linear-gradient(180deg, #6cb8e0 0%, #1f4a80 100%)', inner: '#c8dcf0', textBg: '#e0eef8', textColor: '#0c1c30' },
  B: { frame: 'linear-gradient(180deg, #6a5878 0%, #1a0e22 100%)', inner: '#3a2e44', textBg: '#4c3e5a', textColor: '#f0e6f4' },
  R: { frame: 'linear-gradient(180deg, #e06d5a 0%, #7a1e14 100%)', inner: '#e4b2a0', textBg: '#f2d4c4', textColor: '#2a0a04' },
  G: { frame: 'linear-gradient(180deg, #6fb06f 0%, #254c28 100%)', inner: '#c4dcb8', textBg: '#dceed0', textColor: '#0e2410' },
};
// Returns a card style for any identity. Single-color → direct lookup.
// Multi-color → a blended gold-ish gradient with the full color wheel in the frame.
function styleForIdentity(identity) {
  const cols = colorsOf(identity);
  if (cols.length === 1) return CARD_STYLE[cols[0]] || CARD_STYLE.B;
  if (cols.length >= 5) {
    // 5-color: rainbow/gold frame
    return {
      frame: `linear-gradient(135deg, #f3e3a8 0%, #6cb8e0 25%, #8a7a92 50%, #e06d5a 75%, #6fb06f 100%)`,
      inner: '#ddc888', textBg: '#f8e8b8', textColor: '#2a1c08',
    };
  }
  // Multi-color (2-4): build a stepped gradient from each color's hex
  const stops = cols.map((c, i) => {
    const pct = (i / (cols.length - 1)) * 100;
    return `${COLOR_HEX[c]} ${pct}%`;
  }).join(', ');
  return {
    frame: `linear-gradient(135deg, ${stops})`,
    inner: '#c8b890', textBg: '#e8d8b0', textColor: '#2a1c08',
  };
}

// Card back shown in codex for unseen creatures, and used by the catch-throw animation.
function CardBack({ size = 'small' }) {
  const W = size === 'small' ? 130 : 180;
  const H = size === 'small' ? 195 : 260;
  return (
    <div style={{
      width: W, height: H, borderRadius: 8, padding: 4,
      background: 'linear-gradient(135deg, #3a2850 0%, #1a0e28 100%)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(200,180,240,0.2)',
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: 5,
        background: `
          repeating-linear-gradient(45deg, #2a1c40 0px, #2a1c40 6px, #231638 6px, #231638 12px),
          radial-gradient(ellipse at center, #4a3070 0%, #1a0e28 70%)
        `,
        border: '1.5px solid #6a4a90',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <div style={{
          width: '70%', aspectRatio: '1', borderRadius: '50%',
          background: 'radial-gradient(circle, #9a70d0 0%, #4a3070 50%, transparent 75%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'absolute', filter: 'blur(1px)',
        }} />
        <div style={{
          fontFamily: "'Cinzel', serif", fontSize: size === 'small' ? 28 : 40,
          fontWeight: 700, color: '#e8d888', zIndex: 1,
          textShadow: '0 0 8px #6a4a90, 0 2px 0 #1a0e28',
        }}>GtM</div>
      </div>
    </div>
  );
}

function CreatureCard({ c, small }) {
  const st = styleForIdentity(c.c);
  const primary = primaryColor(c.c);
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const xpPct = c.xp !== undefined ? Math.max(0, Math.min(100, (c.xp / xpToNext(c.level)) * 100)) : null;
  const W = small ? 130 : 180;
  const artH = small ? 74 : 100;
  const nameSize = small ? 10 : 12;
  const typeSize = small ? 8 : 10;
  const textSize = small ? 9 : 11;
  const spriteScale = small ? 0.78 : 1.05;
  const strongVs = strongVsList(c.c);
  const weakTo = weakToList(c.c);
  return (
    <div style={{
      width: W, padding: 4, borderRadius: 8,
      background: st.frame,
      boxShadow: '0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.3)',
      fontFamily: "'Cinzel', serif",
      color: st.textColor,
      flex: '0 0 auto',
    }}>
      <div style={{
        background: st.inner, borderRadius: 5, padding: 6,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {/* Title bar: name + mana cost */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: nameSize, letterSpacing: 0.2, lineHeight: 1.1, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.name}
          </span>
          <ManaBadge identity={c.c} size={small ? 14 : 16} label={colorsOf(c.c).length === 1} />
        </div>
        {/* Art box */}
        <div style={{
          height: artH, borderRadius: 3,
          background: `radial-gradient(ellipse at center, ${COLOR_HEX[primary]}55 0%, ${COLOR_DEEP[primary]} 70%, #0a0614 100%)`,
          border: `1.5px solid ${COLOR_DEEP[primary]}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          <CreatureSprite creature={c} facing="right" scale={spriteScale} />
        </div>
        {/* Type line */}
        <div style={{
          fontSize: typeSize, padding: '2px 4px', borderRadius: 2,
          background: `${COLOR_DEEP[primary]}33`, fontStyle: 'italic',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Creature — {c.t}</span>
          <span style={{ fontWeight: 700, fontStyle: 'normal' }}>Lv.{c.level}</span>
        </div>
        {/* Abilities text box */}
        {c.moves && (
          <div style={{
            background: st.textBg, borderRadius: 2, padding: '4px 6px',
            fontSize: textSize, lineHeight: 1.3,
            minHeight: small ? 36 : 52,
          }}>
            {c.moves.map((mk, i) => {
              const mv = MOVES[mk];
              const statLine = mv.heal
                ? `heal ${Math.round(mv.heal * 100)}%`
                : mv.drain
                ? `${mv.p} dmg · drain ${Math.round(mv.drain * 100)}%`
                : `${mv.p} dmg`;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {mv.c && <span style={{
                    display: 'inline-block', width: small ? 9 : 11, height: small ? 9 : 11, borderRadius: '50%',
                    background: COLOR_HEX[mv.c], border: '1px solid #0a0614', flexShrink: 0,
                  }} />}
                  <span style={{ fontWeight: 700 }}>{mv.name}</span>
                  <span style={{ opacity: 0.7, fontSize: textSize - 1 }}>— {statLine}</span>
                </div>
              );
            })}
          </div>
        )}
        {/* Matchup info row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
          fontSize: textSize - 1, fontWeight: 700,
        }}>
          <div style={{
            background: '#1a2a1a', color: '#d8f0c0',
            padding: '2px 4px', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 3,
            border: '1px solid #3a5a2a',
          }}>
            <span style={{ opacity: 0.7, fontSize: textSize - 2 }}>STR</span>
            {strongVs.length === 0 && <span style={{ opacity: 0.5, fontSize: textSize - 2 }}>—</span>}
            {strongVs.map(col => (
              <span key={col} style={{
                display: 'inline-block', width: small ? 8 : 10, height: small ? 8 : 10, borderRadius: '50%',
                background: COLOR_HEX[col], border: '1px solid #0a0614',
              }} title={COLOR_NAME[col]} />
            ))}
          </div>
          <div style={{
            background: '#2a1a1a', color: '#f0c8c0',
            padding: '2px 4px', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 3,
            border: '1px solid #5a2a2a',
          }}>
            <span style={{ opacity: 0.7, fontSize: textSize - 2 }}>WK</span>
            {weakTo.length === 0 && <span style={{ opacity: 0.5, fontSize: textSize - 2 }}>—</span>}
            {weakTo.map(col => (
              <span key={col} style={{
                display: 'inline-block', width: small ? 8 : 10, height: small ? 8 : 10, borderRadius: '50%',
                background: COLOR_HEX[col], border: '1px solid #0a0614',
              }} title={COLOR_NAME[col]} />
            ))}
          </div>
        </div>
        {/* HP bar */}
        <div style={{ height: 5, background: '#0a0614', border: `1px solid ${COLOR_DEEP[primary]}`, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct > 50 ? '#5ab85a' : pct > 20 ? '#d8a040' : '#d84040', transition: 'width 0.3s' }} />
        </div>
        {/* HP number */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: textSize, fontWeight: 700 }}>
          <span style={{ opacity: 0.75 }}>HP {c.hp}/{c.maxHp}</span>
          {c.xp !== undefined && xpPct !== null && (
            <span style={{ opacity: 0.55, fontSize: textSize - 1 }}>XP {c.xp}/{xpToNext(c.level)}</span>
          )}
        </div>
        {/* XP sliver (only when applicable) */}
        {xpPct !== null && (
          <div style={{ height: 3, background: '#0a0614', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ width: `${xpPct}%`, height: '100%', background: '#9a80c0' }} />
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// SHOP SCENE
// =========================================================================
function ShopScene({ gold, items, tokens, onBuy, onClose }) {
  return (
    <div style={{ width: 'min(94vw, 440px)', margin: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Merle's Provisions</div>
          <div style={{ fontSize: 11, color: '#9080b0', fontStyle: 'italic' }}>"Pick your poison — or your antidote."</div>
        </div>
        <button className="mtgBtn" onClick={onClose} style={{ padding: '4px 10px' }}>✕ Leave</button>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10,
        padding: 8, border: '1.5px solid #9a80c0', borderRadius: 4,
        background: 'linear-gradient(180deg, #2a1c40 0%, #1a1028 100%)',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#ffd870' }}>✦ {gold}g</span>
        <span style={{ fontSize: 12, color: '#9888b0' }}>◆ {tokens} cards in hand</span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {SHOP_STOCK.map(key => {
          const it = ITEMS[key];
          const owned = it.kind === 'card' ? tokens : (items[key] || 0);
          const afford = gold >= it.price;
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: 8, border: `1.5px solid ${afford ? '#4a3a68' : '#2a2038'}`,
              borderRadius: 4, background: '#1a1428', opacity: afford ? 1 : 0.6,
            }}>
              <span style={{ fontSize: 22, width: 30, textAlign: 'center' }}>{it.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{it.name}</div>
                <div style={{ fontSize: 10, color: '#9888b0' }}>{it.desc}</div>
                <div className="pixelFont" style={{ fontSize: 9, color: '#7a6898', marginTop: 2 }}>owned × {owned}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: afford ? '#ffd870' : '#6a5a88' }}>{it.price}g</span>
                <button className="mtgBtn" onClick={() => onBuy(key)} disabled={!afford}
                  style={{ padding: '3px 12px', fontSize: 11 }}>Buy</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

