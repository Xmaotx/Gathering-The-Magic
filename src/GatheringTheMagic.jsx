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
  // ---- Sleep / Confuse / Curse moves ----
  // Each new status has a flagship move so players can encounter and inflict them.
  // Lullaby: blue, low damage, high sleep chance — the textbook control opener.
  // Maddening Whisper: red, mid power, moderate confuse — blue & red overlap on chaos magic.
  // Withering Hex: black, mid power, high curse chance — slow drain to pair with poison/drain.
  lullaby:        { name: 'Lullaby',         c: 'U', p: 4,  a: 90, status: { kind: 'sleep',   chance: 55 } },
  maddening_whisper: { name: 'Maddening Whisper', c: 'R', p: 11, a: 85, status: { kind: 'confuse', chance: 35 } },
  withering_hex:  { name: 'Withering Hex',   c: 'B', p: 12, a: 85, status: { kind: 'curse',   chance: 45 } },
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
  shade_whelp:     { name: 'Shade Whelp',     c: 'B', t: 'Shade',        hp: 24, atk: 7,  m: ['drain_life','dark_bite'], evo: { to: 'nightfall_wraith', at: 6 }, learnset: { 8: 'terror', 11: 'withering_hex' } },
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
  mind_reaver:     { name: 'Mind Reaver',      c: 'UB', t: 'Dimir Agent',    hp: 28, atk: 10, m: ['mind_wrack','drain_life'], learnset: { 10: 'terror', 12: 'lullaby' } },
  hellraiser:      { name: 'Hellraiser',       c: 'BR', t: 'Rakdos Cultist', hp: 30, atk: 11, m: ['dark_bite','fireball'], learnset: { 10: 'oblivion' } },
  warbeast:        { name: 'Warbeast',         c: 'RG', t: 'Gruul Brute',    hp: 34, atk: 11, m: ['ember','trample'], learnset: { 10: 'natures_might' } },
  verdant_paladin: { name: 'Verdant Paladin',  c: 'GW', t: 'Selesnya Knight',hp: 34, atk: 10, m: ['thorn_lash','smite'], learnset: { 10: 'wildgrowth' } },
  grim_priest:     { name: 'Grim Priest',      c: 'WB', t: 'Orzhov Acolyte', hp: 30, atk: 9,  m: ['mend','drain_life'], learnset: { 10: 'divine_light' } },
  stormwright:     { name: 'Stormwright',      c: 'UR', t: 'Izzet Mage',     hp: 28, atk: 10, m: ['mind_wrack','lightning_bolt'], learnset: { 10: 'fireball', 12: 'maddening_whisper' } },
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

  // ---- Dual-zone legendary wardens (Plane 1+) — one per guild pair ----
  // These guard the mid-boss 'L' tile in each dual-color rift zone.
  // Stats sit between mono legendaries: tougher than the harder mono boss, but below the Planeswalker.
  azorius_sovereign:  { name: 'Azorius Sovereign',   c: 'WU', t: 'Legendary Sphinx',     hp: 88,  atk: 19, m: ['celestial_judgment','sunken_tempest','counterspell','mend'],             learnset: {} },
  dimir_specter:      { name: 'Dimir Specter',        c: 'UB', t: 'Legendary Shade',      hp: 86,  atk: 20, m: ['sunken_tempest','soul_reap','lullaby','terror'],                          learnset: {} },
  rakdos_lord:        { name: "Rakdos, Blood Lord",   c: 'BR', t: 'Legendary Demon',      hp: 90,  atk: 21, m: ['soul_reap','dragons_wrath','oblivion','inferno'],                        learnset: {} },
  gruul_titan:        { name: 'Gruul World-Titan',    c: 'RG', t: 'Legendary Beast',      hp: 92,  atk: 22, m: ['dragons_wrath','world_crush','inferno','natures_might'],                 learnset: {} },
  selesnya_ancient:   { name: 'Selesnya Ancient',     c: 'GW', t: 'Legendary Avatar',     hp: 90,  atk: 19, m: ['world_crush','celestial_judgment','wildgrowth','wrath'],                 learnset: {} },
  orzhov_pontiff:     { name: 'Orzhov Pontiff',       c: 'WB', t: 'Legendary Spirit',     hp: 86,  atk: 19, m: ['celestial_judgment','soul_reap','mend','withering_hex'],                 learnset: {} },
  izzet_overload:     { name: 'Izzet Overload',       c: 'UR', t: 'Legendary Drake',      hp: 84,  atk: 20, m: ['sunken_tempest','dragons_wrath','whirlpool','maddening_whisper'],         learnset: {} },
  golgari_swarm:      { name: 'Golgari Swarm-Queen',  c: 'BG', t: 'Legendary Horror',     hp: 90,  atk: 20, m: ['soul_reap','world_crush','oblivion','dark_bite'],                        learnset: {} },
  boros_legionnaire:  { name: 'Boros Legionnaire',    c: 'RW', t: 'Legendary Soldier',    hp: 88,  atk: 21, m: ['dragons_wrath','celestial_judgment','fireball','divine_light'],           learnset: {} },
  simic_leviathan:    { name: 'Simic Leviathan',      c: 'GU', t: 'Legendary Leviathan',  hp: 90,  atk: 19, m: ['world_crush','sunken_tempest','trample','counterspell'],                  learnset: {} },
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
const DUAL_BOSS_IDS = new Set(['azorius_sovereign','dimir_specter','rakdos_lord','gruul_titan','selesnya_ancient','orzhov_pontiff','izzet_overload','golgari_swarm','boros_legionnaire','simic_leviathan']);
const LEGENDARY_IDS = new Set(['vigil_avatar','tidewarden','voidlord','pyreclaw','patriarch_wurm','the_planeswalker',...DUAL_BOSS_IDS]);

// =========================================================================
// DUAL ZONE SYSTEM — guild-colored rift zones connecting pairs of mono zones
// Active in Plane 1+. Each plane generates a seeded 5-cycle: a shuffled ring
// of 5 colors where adjacent pairs become dual zones (e.g. G→R→W→U→B→G).
// Every mono zone participates in exactly TWO dual zones (one on each side of
// the ring), so each mono zone has TWO X-portal tiles at its deep end.
// =========================================================================

// Guild name lookup (normalized pair key → name)
const GUILD_NAMES = {
  WU:'Azorius', UW:'Azorius', UB:'Dimir',    BU:'Dimir',
  BR:'Rakdos',  RB:'Rakdos',  RG:'Gruul',    GR:'Gruul',
  GW:'Selesnya',WG:'Selesnya',WB:'Orzhov',   BW:'Orzhov',
  UR:'Izzet',   RU:'Izzet',   BG:'Golgari',  GB:'Golgari',
  RW:'Boros',   WR:'Boros',   GU:'Simic',    UG:'Simic',
};

// Dual boss DEX ID keyed by normalized (alpha-sorted) pair, e.g. 'GR' → 'gruul_titan'
const DUAL_BOSS_BY_PAIR = {
  WU:'azorius_sovereign', UB:'dimir_specter',  BR:'rakdos_lord',
  GR:'gruul_titan',       GW:'selesnya_ancient',WB:'orzhov_pontiff',
  UR:'izzet_overload',    BG:'golgari_swarm',  RW:'boros_legionnaire',
  GU:'simic_leviathan',
};
function getDualBossId(cA, cB) { return DUAL_BOSS_BY_PAIR[[cA,cB].sort().join('')]; }

// Inverse of ZONE_COLOR: color character → zone id
const COLOR_TO_ZONE = Object.fromEntries(Object.entries(ZONE_COLOR).map(([z,c]) => [c,z]));

// X-portal positions in each mono zone map.
// xA: where this zone is the FIRST element of its cycle pair (outgoing direction).
// xB: where this zone is the SECOND element of its cycle pair (incoming direction).
const ZONE_X_PORTALS = {
  wilds:   { xA:{x:10,y:13}, xB:{x:3,y:4}  },
  ashen:   { xA:{x:14,y:6},  xB:{x:5,y:2}  },
  sanctum: { xA:{x:1,y:6},   xB:{x:7,y:10} },
  umbral:  { xA:{x:10,y:7},  xB:{x:3,y:6}  },
  plains:  { xA:{x:9,y:8},   xB:{x:3,y:10} },
};

// IDs for all possible dual zone trainer NPCs (keyed by normalized pair)
const DUAL_TRAINER_IDS = new Set([
  'dual_trainer_WU','dual_trainer_UB','dual_trainer_BR','dual_trainer_GR',
  'dual_trainer_GW','dual_trainer_WB','dual_trainer_UR','dual_trainer_BG',
  'dual_trainer_RW','dual_trainer_GU',
]);

// Trainer data per guild pair (base team levels scaled at battle time)
const DUAL_TRAINER_DATA = {
  WU:{name:'Arbiter Olen',    color:'#8898c8', team:[{id:'skybinder',lv:20},{id:'arcane_sphinx',lv:22},{id:'jeskai_monk',lv:23}],    reward:600},
  UB:{name:'Agent Threnody',  color:'#6070a0', team:[{id:'mind_reaver',lv:20},{id:'arcane_sphinx',lv:22},{id:'sultai_assassin',lv:23}],reward:600},
  BR:{name:'Cultmaster Vrex', color:'#a05060', team:[{id:'hellraiser',lv:20},{id:'void_lich',lv:22},{id:'mardu_warlord',lv:23}],    reward:600},
  GR:{name:'Warchief Koda',   color:'#a07050', team:[{id:'warbeast',lv:20},{id:'apex_predator',lv:22},{id:'temur_shaman',lv:23}],   reward:600},
  GW:{name:'Grove-Elder Syl', color:'#78a868', team:[{id:'verdant_paladin',lv:20},{id:'blooming_titan',lv:22},{id:'silver_pegasus',lv:23}],reward:600},
  WB:{name:'Exactor Mourne',  color:'#807090', team:[{id:'grim_priest',lv:20},{id:'arcane_sphinx',lv:22},{id:'abzan_warden',lv:23}], reward:600},
  UR:{name:'Mage Zipplock',   color:'#7090b0', team:[{id:'stormwright',lv:20},{id:'void_lich',lv:22},{id:'jeskai_monk',lv:23}],    reward:600},
  BG:{name:'Rites-Keeper Val',color:'#607070', team:[{id:'fungal_creeper',lv:20},{id:'apex_predator',lv:22},{id:'sultai_assassin',lv:23}],reward:600},
  RW:{name:'Legionnaire Arro',color:'#c07858', team:[{id:'blazing_knight',lv:20},{id:'blooming_titan',lv:22},{id:'mardu_warlord',lv:23}],reward:600},
  GU:{name:'Hybridist Merya', color:'#68a898', team:[{id:'reef_prowler',lv:20},{id:'silver_pegasus',lv:22},{id:'temur_shaman',lv:23}], reward:600},
};

// Returns true if a mapId is a dual zone
function isDualZoneMap(mapId) { return !!(mapId && mapId.startsWith('dual_') && mapId.length === 7); }
// Returns [colorA, colorB] from a dual zone mapId like 'dual_GR'
function pairFromDualId(mapId) { return [mapId[5], mapId[6]]; }
// Normalized pair key (alpha-sorted) for de-duplication: 'GR' for both ['G','R'] and ['R','G']
function normPair(cA, cB) { return [cA,cB].sort().join(''); }

// Generate a seeded 5-cycle of color pairs for the given plane (plane 0 → null).
// Returns [[cA,cB],[cB,cC],[cC,cD],[cD,cE],[cE,cA]] after a seeded shuffle.
function generateDualCycle(plane) {
  if (plane === 0) return null;
  const colors = ['W','U','B','R','G'];
  const sh = [...colors];
  let seed = plane * 5_000_011 + 31_337;
  const rand = () => { seed = (seed * 1_664_525 + 1_013_904_223) >>> 0; return seed / 0x100000000; };
  for (let i = sh.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [sh[i], sh[j]] = [sh[j], sh[i]];
  }
  return sh.map((c, i) => [c, sh[(i + 1) % sh.length]]);
}

// Build an encounter pool for a dual zone from both colors' creatures.
function buildDualZonePool(cA, cB) {
  const evolved = new Set(Object.values(DEX).filter(d => d.evo?.to).map(d => d.evo.to));
  const pool = [];
  for (const [id, d] of Object.entries(DEX)) {
    if (evolved.has(id)) continue;
    if (LEGENDARY_IDS.has(id)) continue;
    const cols = colorsOf(d.c);
    if (!cols.includes(cA) && !cols.includes(cB)) continue;
    if (cols.length >= 5) continue;
    pool.push({ id, lv: [6, 12], w: COLOR_COUNT_WEIGHT[cols.length] || 1 });
  }
  return pool.length > 0 ? pool : [{ id: 'hellraiser', lv: [10, 14], w: 100 }];
}

// Generate the 11×15 corridor map for a dual zone.
function makeDualZoneMap(cA, cB) {
  const W = 11, H = 15, mid = 7;
  const encT = {W:'f',U:'o',B:'v',R:'l',G:'g'};
  const wallT = {W:'k',U:'w',B:'t',R:'k',G:'t'};
  const tA = encT[cA]||'g', tB = encT[cB]||'g';
  const wA = wallT[cA]||'t', wB = wallT[cB]||'t';
  const m = Array.from({length:H}, (_,y) => Array.from({length:W}, () => y < mid ? tA : tB));
  for (let x = 0; x < W; x++) { m[0][x] = wA; m[H-1][x] = wB; }
  for (let y = 0; y < H; y++) { m[y][0] = (y < mid ? wA : wB); m[y][W-1] = (y < mid ? wA : wB); }
  for (let y = 1; y < H-1; y++) m[y][5] = 'p';  // central path
  m[0][5] = 'E';      // top exit → colorA mono zone
  m[H-1][5] = 'E';    // bottom exit → colorB mono zone
  m[mid][5] = 'L';    // warden boss tile
  // Decorative flanking encounter tiles, color split at mid
  for (let y = 2; y <= mid-1; y++) { m[y][2] = tA; m[y][8] = tA; }
  for (let y = mid+1; y <= H-3; y++) { m[y][2] = tB; m[y][8] = tB; }
  m[mid-1][3] = tB; m[mid-1][7] = tB;
  m[mid+1][3] = tA; m[mid+1][7] = tA;
  // Trainer NPC sits at (2,4), blocking the path to encourage interaction
  return m;
}

function getDualZoneName(cA, cB) {
  return `${GUILD_NAMES[cA+cB] || (cA+cB)} Rift`;
}

// ---- Daily Encounters ----
// Once per real-world day, each zone has a chance to spawn a "phantom" variant
// of a regular creature during a specific time-of-day window. These are stat-
// boosted (+30% HP/atk), prefixed with a flavor word, and visually glowing in
// battle so the player feels something rare just appeared.
//
// Each entry:
//   id          — base DEX id to spawn (gets the variant treatment via createDailyVariant)
//   zone        — map id where this can spawn
//   hours       — [startHour, endHour) window in 24h time. Wraps midnight if start > end.
//   prefix      — display name prefix ("Phantom", "Aurora", etc.)
//   levelBonus  — bonus levels above the zone's normal range
//   lore        — flavor line shown in the encounter intro
//   glow        — hex color for the battle aura
//
// Spawn check: when triggerWildEncounter rolls and the time/zone match, AND
// the player hasn't already encountered this entry today, roll DAILY_SPAWN_CHANCE
// to upgrade the encounter into the phantom variant instead of the normal pool pick.
const DAILY_SPAWN_CHANCE = 0.06;  // 6% chance per matching wild encounter
const DAILY_ENCOUNTERS = [
  {
    key: 'phantom_sprite_rare', id: 'phantom_sprite',     // U spirit in wilds
    zone: 'wilds',  hours: [20, 5],   // night (wraps midnight)
    prefix: 'Spectral', levelBonus: 4,
    lore: "A pale shimmer drifts among the trees — only seen in deep moonlight.",
    glow: '#a8d0ff',
  },
  {
    key: 'tideling_dawn', id: 'tideling',
    zone: 'sanctum', hours: [6, 8],   // dawn
    prefix: 'Aurora', levelBonus: 4,
    lore: "Sunrise light glints across its scales — a creature of the threshold.",
    glow: '#ffc8a8',
  },
  {
    key: 'cinder_phoenix', id: 'cinder_drake',
    zone: 'ashen',   hours: [11, 14], // midday — peak heat
    prefix: 'Solar', levelBonus: 4,
    lore: "Born of noon-day flame, it circles the highest cinders.",
    glow: '#ffa848',
  },
  {
    key: 'hollow_stalker', id: 'shade_whelp',
    zone: 'umbral',  hours: [22, 4],  // deep night
    prefix: 'Hollow', levelBonus: 4,
    lore: "Eyes without pupils watch from the deepest dark.",
    glow: '#9080c0',
  },
  {
    key: 'sunsteed', id: 'aven_sentinel',
    zone: 'plains',  hours: [18, 20], // dusk
    prefix: 'Twilight', levelBonus: 4,
    lore: "Wings catch the last rays of dusk, edged in molten gold.",
    glow: '#f3d090',
  },
];
// Helper: does the given hour fall inside the (possibly wrapping) window?
function hourInWindow(hour, window) {
  const [start, end] = window;
  if (start <= end) return hour >= start && hour < end;
  // Wraps midnight (e.g. [20, 5] = 20,21,22,23,0,1,2,3,4)
  return hour >= start || hour < end;
}
// Real-world day number (UTC days since epoch). Used to lock daily encounters.
function realDayNumber() {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}
// Find the daily encounter eligible right now in the given zone, or null.
// Honors the once-per-day lock (lastDailyEncounters: { key: dayNumber }).
function findEligibleDaily(zone, hour, lastDailyEncounters) {
  const today = realDayNumber();
  for (const entry of DAILY_ENCOUNTERS) {
    if (entry.zone !== zone) continue;
    if (!hourInWindow(hour, entry.hours)) continue;
    if (lastDailyEncounters?.[entry.key] === today) continue;  // already caught/seen today
    return entry;
  }
  return null;
}

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

// =========================================================================
// NEW PLANE SYSTEM — scaling difficulty slots for New Game+
// After defeating The Planeswalker, the player is hurled into a new plane.
// All zones are rearranged (difficulty slots shuffled), and all levels are
// offset by the defeated Planeswalker's level so the easiest new zone starts
// where the old PW left off.
// =========================================================================
// Five difficulty tiers (easiest → hardest). Each tier defines a wild level
// range and a shrine boss level. These stay fixed; what changes each plane is
// which zone name is assigned to which tier.
const PLANE_DIFFICULTY_SLOTS = [
  { range: [2,6],   shrineLevel: 19 },  // tier 0 — easiest
  { range: [5,9],   shrineLevel: 21 },  // tier 1
  { range: [6,10],  shrineLevel: 23 },  // tier 2
  { range: [8,12],  shrineLevel: 25 },  // tier 3
  { range: [10,14], shrineLevel: 27 },  // tier 4 — hardest
];
// Original zone → tier index (plane 0 default)
const ZONE_DEFAULT_TIER = { wilds: 0, ashen: 1, sanctum: 2, umbral: 3, plains: 4 };
// The five zone keys in order used for shuffling
const ALL_ZONE_KEYS = ['wilds', 'ashen', 'sanctum', 'umbral', 'plains'];

// Get the tier index for a zone in the given plane's order.
// planeZoneOrder is an array of zone keys where index = tier.
// If null (original plane), fall back to ZONE_DEFAULT_TIER.
function getZoneTier(zoneId, planeZoneOrder) {
  if (!planeZoneOrder) return ZONE_DEFAULT_TIER[zoneId] ?? 0;
  const idx = planeZoneOrder.indexOf(zoneId);
  return idx >= 0 ? idx : (ZONE_DEFAULT_TIER[zoneId] ?? 0);
}

// Get the scaled wild level range for a zone.
// planeBaseLevel: level offset (0 for original plane; PW level for subsequent planes)
function getScaledZoneRange(zoneId, planeBaseLevel, planeZoneOrder) {
  const tier = getZoneTier(zoneId, planeZoneOrder);
  const { range } = PLANE_DIFFICULTY_SLOTS[tier];
  return [range[0] + planeBaseLevel, range[1] + planeBaseLevel];
}

// Get the scaled shrine boss level for a zone.
function getScaledBossLevel(zoneId, planeBaseLevel, planeZoneOrder) {
  const tier = getZoneTier(zoneId, planeZoneOrder);
  return PLANE_DIFFICULTY_SLOTS[tier].shrineLevel + planeBaseLevel;
}

// Planeswalker level scales per plane: 32 on plane 0, +30 per plane.
function getPlaneswalkerLevel(currentPlane) {
  return 32 + currentPlane * 30;
}

// Generate a shuffled zone order for a new plane. Seeded by plane number
// for reproducibility (same plane always has same layout).
function generatePlaneZoneOrder(plane) {
  // Fisher-Yates shuffle with a simple seeded RNG.
  const arr = [...ALL_ZONE_KEYS];
  let seed = plane * 1_000_003 + 7_919;
  const rand = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Flavor names for planes beyond the first (shown in UI and dialog).
const PLANE_NAMES = [
  'Runesmith Hollow',      // plane 0 — the original
  'The Shattered Rift',    // plane 1
  'Void Between Worlds',   // plane 2
  'The Aether Crucible',   // plane 3
  'Blind Eternities',      // plane 4
  'The Dark Convergence',  // plane 5+
];
function getPlaneName(plane) {
  return PLANE_NAMES[Math.min(plane, PLANE_NAMES.length - 1)];
}

// =========================================================================
// ZONE EXIT SYSTEM — dynamic zone-to-direction mapping per plane
// In Plane 0 the exits are fixed (south → wilds, east → ashen, etc.).
// In later planes the same ZONE_RANK_ORDER shuffle that sets difficulty also
// determines which physical direction leads to which zone, so the layout is
// genuinely different every run.
// =========================================================================
// Zones in difficulty order: index 0 = easiest → index 4 = hardest.
// This MUST match ZONE_DEFAULT_TIER ordering.
const ZONE_RANK_ORDER = ['wilds', 'ashen', 'sanctum', 'umbral', 'plains'];

// Exit slot names paired 1-to-1 with ZONE_RANK_ORDER.
// Plane 0: wilds→south_center, ashen→east, sanctum→west, umbral→north, plains→south_west.
const EXIT_SLOT_ORDER = ['south_center', 'east', 'west', 'north', 'south_west'];

// Where the player re-enters town from each exit slot.
const EXIT_TOWN_RETURN = {
  south_center: { x: 7,  y: 11, face: 'up'    },
  south_west:   { x: 2,  y: 11, face: 'up'    },
  north:        { x: 7,  y: 1,  face: 'down'  },
  east:         { x: 14, y: 6,  face: 'left'  },
  west:         { x: 1,  y: 6,  face: 'right' },
};

// Where the player spawns when entering a zone from town (uses the zone's own map size).
const ZONE_SPAWN_POS = {
  wilds:   (_mw, _mh) => ({ x: 7,    y: 1,      face: 'down'  }),
  plains:  (_mw, _mh) => ({ x: 13,   y: 1,      face: 'down'  }),
  umbral:  (_mw,  mh) => ({ x: 7,    y: mh - 2, face: 'up'    }),
  ashen:   (_mw, _mh) => ({ x: 1,    y: 6,      face: 'right' }),
  sanctum: ( mw, _mh) => ({ x: mw-2, y: 6,      face: 'left'  }),
};

// Returns exit-slot → zone mapping for the current plane.
function getExitZoneMap(planeZoneOrder) {
  const order = planeZoneOrder || ZONE_RANK_ORDER;
  const m = {};
  EXIT_SLOT_ORDER.forEach((slot, i) => { m[slot] = order[i]; });
  return m;
}

// Returns the exit slot that a given zone is assigned to in the current plane.
function getZoneExitSlot(zone, planeZoneOrder) {
  const order = planeZoneOrder || ZONE_RANK_ORDER;
  const i = order.indexOf(zone);
  return i >= 0 ? EXIT_SLOT_ORDER[i] : null;
}

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
  // Awarded by The Planeswalker after their defeat. A passive key item — owning
  // it surfaces an "Open Vault" button in the Spellbook menu, letting the player
  // reach the Hollow Vault from anywhere instead of trekking back to Keeper Solenne.
  // kind: 'key' so the items list won't render a "Use" button (it's not consumable).
  vault_sigil: {
    name: 'Vault Sigil', kind: 'key', amount: 0, price: 0,
    desc: 'Calls the Hollow Vault from any menu. A gift from the Planeswalker.', icon: '✦',
  },
  // Granted when the player defeats all three town duellists (Bran, Ria, Dax).
  // Owning it surfaces a "Phone" tab in the Spellbook, listing every defeated
  // trainer for a scaled-up rematch — no walking required.
  runic_phone: {
    name: 'Runic Phone', kind: 'key', amount: 0, price: 0,
    desc: 'Pooled gift from Bran, Ria & Dax. Adds a Phone tab to the Spellbook menu — call any defeated trainer for a scaled-up rematch.', icon: '☎',
  },

  // ── Held items (equippable to a creature; one slot per creature) ──────────
  // kind: 'held' — these are NOT consumed from inventory on use; they are
  // equipped onto a creature from the Team tab and live on the creature object.
  // subkind drives the mechanical effect:
  //   'once_heal'  — triggers once per battle when HP < threshold
  //   'regen'      — restores `amount` fraction of maxHp at end of each turn
  //   'atk_boost'  — passive flat multiplier on attack output
  potion_vial: {
    name: 'Potion Vial', kind: 'held', subkind: 'once_heal',
    amount: 0.20, threshold: 0.25, price: 60,
    desc: 'Once per battle: auto-heals 20% HP when HP drops below 25%.', icon: '⚗',
  },
  lifeweb_moss: {
    name: 'Lifeweb Moss', kind: 'held', subkind: 'regen',
    amount: 0.06, price: 80,
    desc: 'Restores 6% max HP at the end of each turn.', icon: '🌿',
  },
  mana_stone: {
    name: 'Mana Stone', kind: 'held', subkind: 'atk_boost',
    amount: 0.15, price: 100,
    desc: 'Passively boosts this creature\'s Attack by 15%.', icon: '💎',
  },
};
// Shop keeps a fixed stock order (display only)
const SHOP_STOCK = ['potion', 'elixir', 'fullheal', 'revive', 'card', 'potion_vial', 'lifeweb_moss', 'mana_stone'];

// ---------- Weather / Terrain ----------
// Each zone has an associated weather that's set on battle entry (via bgZone).
// Weather modifies move damage by color and may also apply a small end-of-turn
// effect to creatures of certain colors. The final boss has its own dramatic
// "planar storm" weather.
//
// Field shape:
//   name:    display label
//   icon:    short symbol shown in the battle weather badge
//   color:   border/glow tint for the badge
//   boost:   color whose moves get +20% damage   (string or null)
//   weaken:  color whose moves get -15% damage   (string or null)
//   tickKind:'damage' | 'heal' | null            — applies to all creatures during the end-of-turn tick
//   tickAmt: fraction of maxHp (e.g. 0.04)        — only used if tickKind set
//   tickAffects: array of colors affected by the tick (e.g. ['R'] for sandstorm: only R is immune)
//                semantics: 'damage' tickKind hits creatures whose primary color is NOT in tickAffects
//                            'heal'   tickKind heals creatures whose primary color IS in tickAffects
//   desc:    short flavor / mechanical line shown in the weather badge tooltip
const WEATHER = {
  sun: {
    name: 'Brilliant Sun', icon: '☀', color: '#f3e3a8',
    boost: 'W', weaken: 'U',
    tickKind: null,
    desc: 'White spells +20%. Blue spells -15%.',
  },
  rain: {
    name: 'Drizzling Rain', icon: '☂', color: '#6cb8e0',
    boost: 'U', weaken: 'R',
    tickKind: null,
    desc: 'Blue spells +20%. Red spells -15%.',
  },
  sandstorm: {
    name: 'Sandstorm', icon: '⌇', color: '#d8a040',
    boost: 'R', weaken: null,
    tickKind: 'damage', tickAmt: 0.04, tickAffects: ['R'],
    desc: 'Red spells +20%. Non-red creatures lose 4% HP each turn.',
  },
  bloom: {
    name: 'Wildbloom', icon: '✿', color: '#6fb06f',
    boost: 'G', weaken: null,
    tickKind: 'heal', tickAmt: 0.03, tickAffects: ['G'],
    desc: 'Green spells +20%. Green creatures regain 3% HP each turn.',
  },
  eclipse: {
    name: 'Umbral Eclipse', icon: '☽', color: '#9080c0',
    boost: 'B', weaken: 'W',
    tickKind: null,
    desc: 'Black spells +20%. White spells -15%.',
  },
  // Final boss — wild swings, no clean color advantage. Drama over balance.
  planar: {
    name: 'Planar Storm', icon: '✦', color: '#e8c860',
    boost: null, weaken: null,
    tickKind: 'damage', tickAmt: 0.03, tickAffects: ['W','U','B','R','G'],  // affects everyone (no color is a primary listed... wait that's inverted)
    // Note: 'damage' affects creatures whose primary color is NOT in tickAffects.
    // We instead want planar storm to chip everyone equally — set tickAffects to []
    // so the "not in" check passes for all colors. Above is a bug-prone form;
    // the actual logic uses [] below to mean "no one is immune".
    desc: 'The Planeswalker bends magic itself. All creatures lose 3% HP each turn.',
  },
};
// Fix planar's tickAffects to the intended empty list (all creatures take damage).
WEATHER.planar.tickAffects = [];
// Map zone → weather. Town and shrines get null (no weather indoors).
const ZONE_WEATHER = {
  plains: 'sun',
  sanctum: 'rain',
  ashen: 'sandstorm',
  wilds: 'bloom',
  umbral: 'eclipse',
};
// ---- Weather rolling ----
// Weather is rolled ONCE when a battle starts and stored on `battle.weathers`
// (an array, 0-2 entries). `weatherForBattle()` is a pure read — never re-rolls —
// so the weather badges, damage calc, end-of-turn ticks, and battle log all see
// the same values across the entire fight. (If this function were random per
// call, badges would flicker and the damage calc would disagree with the tick.)
//
// The data shape is always an array (even when empty) to avoid null-checks
// everywhere. A battle with no weather has `battle.weathers = []`.
const WEATHER_CHANCE = 0.2;        // 20% chance the first weather spawns
const WEATHER_DOUBLE_CHANCE = 0.2; // If a weather spawns, 20% chance a second one stacks
                                   // Net: 20% single, 4% double, 76% none

// rollWeathersForZone — called once at battle setup. Returns an array of weather keys
// (0, 1, or 2 entries).
//   - Planeswalker is hardcoded to ['planar'] (climactic, never random; never stacks)
//   - Other battles roll their zone's weather at WEATHER_CHANCE
//   - If the first roll succeeds, a SECOND distinct weather rolls at WEATHER_DOUBLE_CHANCE,
//     drawn from the four other ZONE_WEATHER entries (NOT planar — that's boss-only)
//   - Town and unmapped zones never spawn weather
function rollWeathersForZone(zone, battleKind) {
  if (battleKind === 'planeswalker') return ['planar'];
  if (!zone) return [];
  // Resolve the primary candidate (zone or shrine parent).
  let primary = ZONE_WEATHER[zone];
  if (!primary) {
    const parent = SHRINE_TO_ZONE[zone];
    if (parent) primary = ZONE_WEATHER[parent];
  }
  if (!primary) return [];
  if (Math.random() >= WEATHER_CHANCE) return [];  // base roll failed
  const result = [primary];
  // Second roll — pick a different zone weather to stack. Excludes the primary
  // (so we don't get e.g. Rain + Rain) and excludes 'planar' (boss exclusive).
  if (Math.random() < WEATHER_DOUBLE_CHANCE) {
    const others = Object.values(ZONE_WEATHER).filter(w => w !== primary);
    if (others.length > 0) {
      const second = others[Math.floor(Math.random() * others.length)];
      result.push(second);
    }
  }
  return result;
}
// Pure read — returns the array of active weather keys (always an array, possibly empty).
function weathersForBattle(battle) {
  return battle?.weathers || [];
}
// Convenience — returns the FIRST weather key (or null) for code paths that
// only care about the primary (e.g., the old badge layout). Most call sites
// should use weathersForBattle() and iterate.
function weatherForBattle(battle) {
  const arr = battle?.weathers || [];
  return arr[0] || null;
}

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
  // ---- New statuses (Sleep, Confuse, Curse) ----
  // Each has a distinct mtg-flavored color identity and a different mechanical bite:
  //   sleep   — full skip-turn (with wake chance) — blue lullaby/mind magic
  //   confuse — 50% to attack self for chip damage instead of using the chosen move
  //   curse   — burn-like end-of-turn HP loss but with a longer floor, no color-match damage
  sleep:    { name: 'Sleep',    icon: '☾',  color: '#9080c0', c: 'U',
    desc: 'Skips turns. 25% to wake each turn.' },
  confuse:  { name: 'Confused', icon: '?',  color: '#d8a040', c: 'R',
    desc: '50% chance to hit itself in confusion.' },
  curse:    { name: 'Curse',    icon: '✟',  color: '#7a5a8a', c: 'B',
    desc: 'Lingering hex — HP drains at end of turn.' },
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
    // Held item slot — null when empty, string key from ITEMS when equipped.
    // heldItemCharged tracks whether a once-per-battle item has already triggered.
    heldItem: null,
    heldItemCharged: false,
  };
}
// Build a daily-encounter variant from a DAILY_ENCOUNTERS entry. Wraps the base
// creature with a flavor prefix, +30% HP/atk, the entry's glow color (consumed
// by the BattleScene to render an aura around the sprite), and a marker so we
// can recognize it in code paths that need to (e.g., the codex doesn't double-
// count the variant — the underlying id is still the base creature).
function createDailyVariant(entry, baseLevel) {
  const lv = baseLevel + entry.levelBonus;
  const c = createCreature(entry.id, lv);
  return {
    ...c,
    name: `${entry.prefix} ${c.name}`,           // e.g., "Spectral Phantom Sprite"
    maxHp: Math.floor(c.maxHp * 1.3),
    hp: Math.floor(c.maxHp * 1.3),
    baseAtk: Math.floor(c.baseAtk * 1.3),
    isDaily: true,
    dailyKey: entry.key,
    dailyGlow: entry.glow,
    dailyLore: entry.lore,
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
      return { newCreature: { ...creature, status: null }, lines: [`${displayName(creature)} thawed out!`], prevented: false };
    }
    return { newCreature: creature, lines: [`${displayName(creature)} is frozen solid!`], prevented: true };
  }
  if (kind === 'stun') {
    // Stun prevents this turn, then clears
    return { newCreature: { ...creature, status: null }, lines: [`${displayName(creature)} is stunned!`], prevented: true };
  }
  if (kind === 'sleep') {
    // 25% to wake each turn — slightly stickier than freeze.
    if (Math.random() < 0.25) {
      return { newCreature: { ...creature, status: null }, lines: [`${displayName(creature)} woke up!`], prevented: false };
    }
    return { newCreature: creature, lines: [`${displayName(creature)} is fast asleep.`], prevented: true };
  }
  if (kind === 'confuse') {
    // 50% chance to hit self for ~12% maxHp damage. The turn is consumed either way:
    //   - hit self → damage applied here, prevented:true so no move resolves
    //   - snap out → status persists but turn proceeds normally with no self-hit
    // Confusion lifts on its own when turns runs out (handled in tickStatusEnd).
    if (Math.random() < 0.5) {
      const dmg = Math.max(1, Math.floor(creature.maxHp * 0.12));
      const hurt = { ...creature, hp: Math.max(0, creature.hp - dmg) };
      const lines = [`${displayName(creature)} is confused — it hurt itself! (-${dmg})`];
      if (hurt.hp <= 0) lines.push(`${displayName(creature)} fainted from confusion!`);
      return { newCreature: hurt, lines, prevented: true };
    }
    return { newCreature: creature, lines: [`${displayName(creature)} shakes off the confusion for a moment.`], prevented: false };
  }
  return { newCreature: creature, lines: [], prevented: false };
}

// Apply per-round weather effect to a single creature. Returns { creature, lines }.
// Sandstorm-style 'damage' tick affects creatures whose primary color is NOT in tickAffects.
// Bloom-style 'heal' tick heals creatures whose primary color IS in tickAffects.
// Planar storm uses tickAffects=[] so the "not in" check passes for all colors,
// hitting everyone equally.
function applyWeatherTick(creature, weatherKey) {
  if (!weatherKey || !creature || creature.hp <= 0) return { creature, lines: [] };
  const w = WEATHER[weatherKey];
  if (!w || !w.tickKind) return { creature, lines: [] };
  const primary = primaryColor(creature.c);
  const lines = [];
  if (w.tickKind === 'damage') {
    if (w.tickAffects.includes(primary)) return { creature, lines: [] };
    const dmg = Math.max(1, Math.floor(creature.maxHp * w.tickAmt));
    const hp = Math.max(0, creature.hp - dmg);
    lines.push(`${displayName(creature)} is buffeted by the ${w.name.toLowerCase()}! (-${dmg})`);
    if (hp <= 0) lines.push(`${displayName(creature)} fainted from the storm!`);
    return { creature: { ...creature, hp }, lines };
  }
  if (w.tickKind === 'heal') {
    if (!w.tickAffects.includes(primary)) return { creature, lines: [] };
    if (creature.hp >= creature.maxHp) return { creature, lines: [] };
    const heal = Math.max(1, Math.floor(creature.maxHp * w.tickAmt));
    const hp = Math.min(creature.maxHp, creature.hp + heal);
    lines.push(`${displayName(creature)} drinks in the ${w.name.toLowerCase()}. (+${hp - creature.hp})`);
    return { creature: { ...creature, hp }, lines };
  }
  return { creature, lines: [] };
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
    lines.push(`${displayName(creature)} is hurt by its burn! (-${dmg})`);
  } else if (kind === 'poison') {
    // Poison scales up each turn
    const stacks = 5 - Math.max(0, newStatus.turns);
    const dmg = Math.max(1, Math.floor(creature.maxHp * (0.05 + 0.02 * stacks)));
    hp = Math.max(0, hp - dmg);
    lines.push(`${displayName(creature)} suffers from poison! (-${dmg})`);
  } else if (kind === 'curse') {
    // Curse — flat 6% maxHp drain. Doesn't scale like poison; it's a slow bleed
    // that pairs nicely with confuse/sleep to deny tempo.
    const dmg = Math.max(1, Math.floor(creature.maxHp * 0.06));
    hp = Math.max(0, hp - dmg);
    lines.push(`The curse gnaws at ${displayName(creature)}! (-${dmg})`);
  }
  // entangle: no end-tick damage, just lingers
  if (newStatus.turns <= 0) {
    newStatus = null;
    if (kind !== 'stun') lines.push(`${displayName(creature)} recovered from ${STATUSES[kind].name.toLowerCase()}.`);
  }
  if (hp <= 0) lines.push(`${displayName(creature)} fainted from status!`);
  return { newCreature: { ...creature, hp, status: newStatus }, lines };
}

function calcDamage(attacker, defender, move, weatherKeys = []) {
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
  // Weather modifier — every active weather gets a chance to boost (+20%) or weaken (-15%).
  // With stacked weathers a move can be boosted by one and weakened by another (e.g. a U
  // move in Rain+Sun nets 1.2 × 0.85 ≈ 1.02, basically neutral). We track which weathers
  // hit so the log can flavor it appropriately. Colorless moves (move.c === null) are
  // unaffected. Accepts an array; legacy single-string callers still work via [].concat.
  const wKeys = Array.isArray(weatherKeys) ? weatherKeys : (weatherKeys ? [weatherKeys] : []);
  const boostedBy = [];
  const weakenedBy = [];
  if (move.c) {
    for (const k of wKeys) {
      const w = WEATHER[k];
      if (!w) continue;
      if (w.boost === move.c) { mult *= 1.2; boostedBy.push(k); }
      else if (w.weaken === move.c) { mult *= 0.85; weakenedBy.push(k); }
    }
  }
  const crit = Math.random() < 0.08;
  const variance = 0.85 + Math.random() * 0.3;
  // Mana Stone held item: passive +15% attack output on every move.
  const manaStoneBoost = attacker.heldItem === 'mana_stone' ? (1 + ITEMS.mana_stone.amount) : 1;
  let dmg = Math.floor((move.p + atkOf(attacker) * 0.6) * mult * variance * (crit ? 1.7 : 1) * manaStoneBoost);
  return {
    dmg: Math.max(1, dmg), mult, crit, missed: false,
    boostedBy, weakenedBy,
    // Back-compat fields for any caller that read these (currently used by applyMove logs)
    weatherBoosted: boostedBy.length > 0,
    weatherWeakened: weakenedBy.length > 0,
  };
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
  // X-portals to dual zones (Plane 1+). xA at path-end south; xB northwest branch area.
  m[13][10] = 'X';   // xA: this zone is first in its outgoing cycle pair
  m[4][3]   = 'X';   // xB: this zone is second in its incoming cycle pair
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
  // X-portals to dual zones (Plane 1+). xA at far-east path end; xB in north ash area.
  m[6][14] = 'X';   // xA: replaces last path tile — east end of main path
  m[2][5]  = 'X';   // xB: north ash ground, accessible from main path
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
  // X-portals to dual zones (Plane 1+). xA at far-west path end; xB south pool area.
  m[6][1]  = 'X';   // xA: far west end of main path
  m[10][7] = 'X';   // xB: south shallow-water area
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
  // X-portals to dual zones (Plane 1+). xA at path-end east; xB west vine area.
  m[7][10] = 'X';   // xA: east end of path (path ends at [10,7] = m[7][10])
  m[6][3]  = 'X';   // xB: west moss-ground, accessible from path
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
  // X-portals to dual zones (Plane 1+). xA at path end (south-center); xB west flower area.
  m[8][9]  = 'X';   // xA: path end (path ends at [9,8] = m[8][9])
  m[10][3] = 'X';   // xB: southwest cobblestone area
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

// Pre-generate all 20 ordered dual zone maps (one per ordered color pair).
// Dual zone map ID format: 'dual_XY' where X=colorA (top exit), Y=colorB (bottom exit).
// Both orderings exist so the cycle can assign either direction to any pair.
const _COLORS5 = ['W','U','B','R','G'];
for (const cA of _COLORS5) {
  for (const cB of _COLORS5) {
    if (cA === cB) continue;
    const mapId = 'dual_' + cA + cB;
    MAPS[mapId] = { tiles: makeDualZoneMap(cA, cB), name: getDualZoneName(cA, cB) };
  }
}

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
  // ---- The Hollow Vault — overflow storage for caught creatures beyond the 6-slot team ----
  // Themed as runic spirit-cages tended by a quiet keeper. Stationary, no battle, opens
  // the VaultScene where the player can swap creatures freely between team and storage.
  { id: 'vaultkeeper', x: 6, y: 10, face: 'down', color: '#5a7088', noBattle: true, isVault: true,
    name: 'Keeper Solenne',
    dialog: "Spirits whisper louder when caged in rune-iron. I tend them between your travels — if your hand is full, leave one with me. They'll keep, and they'll wait." },
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

// ---------- Hidden items (sparkle nodes) ----------
// Spread across all maps. Each entry re-appears every real-world day (via realDayNumber()).
// loot: 'potion' | 'elixir' | 'card' | 'gold'   amount: gold quantity (only for 'gold' loot)
const HIDDEN_ITEMS = [
  // ── Town ──────────────────────────────────────────────────────────────────
  { map: 'town',    x: 2,  y: 3,  loot: 'potion' },
  { map: 'town',    x: 14, y: 11, loot: 'gold',   amount: 30  },
  // ── Mana Wilds ────────────────────────────────────────────────────────────
  { map: 'wilds',   x: 2,  y: 2,  loot: 'potion' },
  { map: 'wilds',   x: 11, y: 4,  loot: 'card'   },
  { map: 'wilds',   x: 5,  y: 9,  loot: 'gold',   amount: 20  },
  // ── Ashen Wastes ──────────────────────────────────────────────────────────
  { map: 'ashen',   x: 3,  y: 9,  loot: 'potion' },
  { map: 'ashen',   x: 11, y: 3,  loot: 'elixir' },
  // ── Sunken Sanctum ────────────────────────────────────────────────────────
  { map: 'sanctum', x: 2,  y: 8,  loot: 'potion' },
  { map: 'sanctum', x: 10, y: 3,  loot: 'gold',   amount: 25  },
  // ── Umbral Grove ──────────────────────────────────────────────────────────
  { map: 'umbral',  x: 3,  y: 3,  loot: 'card'   },
  { map: 'umbral',  x: 9,  y: 9,  loot: 'potion' },
  // ── Plains of Light ───────────────────────────────────────────────────────
  { map: 'plains',  x: 4,  y: 4,  loot: 'elixir' },
  { map: 'plains',  x: 12, y: 8,  loot: 'gold',   amount: 40  },
];
// Quick lookup key for state map
const hiddenItemKey = (item) => `${item.map}:${item.x}:${item.y}`;
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

// Populate NPCS_ZONE with dual zone trainers for all 20 ordered dual maps.
// The same normalized trainer (e.g. 'dual_trainer_GR') appears in both 'dual_GR' and 'dual_RG'
// since either ordering might be used by the plane cycle. Trainer is at (2,4) off the central path.
for (const cA of _COLORS5) {
  for (const cB of _COLORS5) {
    if (cA === cB) continue;
    const pairKey = normPair(cA, cB);
    const td = DUAL_TRAINER_DATA[pairKey];
    if (!td) continue;
    const mapId = 'dual_' + cA + cB;
    const trainerId = `dual_trainer_${pairKey}`;
    const guildName = GUILD_NAMES[pairKey] || pairKey;
    NPCS_ZONE[mapId] = [{
      id: trainerId,
      x: 2, y: 4,
      face: 'right',
      color: td.color,
      name: td.name,
      dialog: `The ${guildName} rift hums with raw power. Only the worthy may approach the warden beyond.`,
      team: td.team,
      reward: td.reward,
      isDualTrainer: true,
    }];
  }
}
// Town trainers — the three duellists in Runesmith Hollow. Defeating all three
// is what unlocks the Runic Phone (a key item that opens the Phone tab in the
// Spellbook menu, allowing remote rematches with any defeated trainer).
const TOWN_TRAINER_IDS = new Set(['bran', 'ria', 'dax']);
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
// displayName — returns a creature's nickname if set, else its species name.
// Used everywhere the creature is referenced in UI or log lines so renames apply
// uniformly. The species name remains accessible as c.name for codex display.
function displayName(c) {
  return (c && c.nick) ? c.nick : (c ? c.name : '???');
}

function tileAt(map, x, y) {
  const tiles = MAPS[map].tiles;
  if (y < 0 || y >= tiles.length || x < 0 || x >= tiles[0].length) return 't';
  return tiles[y][x];
}
function isWalkable(tile) {
  // 'B' = building entrance (steppable, triggers transition)
  // 'F' = shrine floor (interior)
  // 'L' = legendary boss tile (steppable, triggers boss fight on contact)
  return ['.', 'g', 'p', 'd', 'E',      'a', 'l', 'u', 'o', 'm', 'v', 'c', 'f', 'B', 'F', 'L', 'X'].includes(tile);
}
function hasEncounter(tile) {
  // Tiles that can roll a wild encounter on step.
  //   Feature tiles (the visually distinct ones — see isFeatureTile below):
  //     g  tall grass (Wilds)        l  lava vent (Ashen)
  //     o  deep pool  (Sanctum)      v  vine thicket (Umbral)
  //     f  flower field (Plains)
  //   Ambient zone tiles (the background fill of each zone, excluding paths).
  //   Including these makes the W/U/B/R zones feel as huntable as the Wilds —
  //   creatures aren't restricted to small clusters of feature tiles, only the
  //   carved 'p'/'.' paths are truly safe.
  //     a  ash-ground (Ashen)         u  shallow water (Sanctum)
  //     m  moss-ground (Umbral)       c  cobble (Plains)
  return ['g', 'l', 'o', 'v', 'f', 'a', 'u', 'm', 'c'].includes(tile);
}
// "Feature" encounter tiles — the dramatic, visually-distinct ones. NPCs avoid
// stepping onto these so we don't have a trainer comfortably wading in lava or
// floating on a deep pool. Ambient zone tiles (a/u/m/c) are fair game for NPC
// wandering even though they can also roll encounters for the player.
function isFeatureTile(tile) {
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

  // ---- Reverb send bus -----------------------------------------------------
  // A single shared feedback-delay reverb tail. Sounds that route through `reverbIn`
  // get a smeared echo trail without the cost of a real convolution reverb.
  // Built lazily on first use so we don't pay setup cost if the engine never wakes.
  let reverbIn = null;
  let reverbOut = null;
  const ensureReverb = () => {
    const c = ensureCtx();
    if (!c || reverbIn) return reverbIn;
    reverbIn = c.createGain(); reverbIn.gain.value = 1;
    reverbOut = c.createGain(); reverbOut.gain.value = 0.32;  // wet level on the bus
    // Two parallel delays at slightly different times for stereo-ish smear
    const d1 = c.createDelay(1.0); d1.delayTime.value = 0.18;
    const d2 = c.createDelay(1.0); d2.delayTime.value = 0.27;
    const fb1 = c.createGain(); fb1.gain.value = 0.42;
    const fb2 = c.createGain(); fb2.gain.value = 0.36;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
    reverbIn.connect(d1); reverbIn.connect(d2);
    d1.connect(fb1); fb1.connect(d1);   // feedback loops
    d2.connect(fb2); fb2.connect(d2);
    d1.connect(tone); d2.connect(tone);
    tone.connect(reverbOut);
    reverbOut.connect(masterGain);
    return reverbIn;
  };

  // ---- FM synth voice ------------------------------------------------------
  // A single carrier + modulator pair. Modulator FM-modulates the carrier's freq.
  // ratio = mod_freq / carrier_freq. index = how strongly the mod swings the carrier
  // (in carrier-freq units). preset hides common combinations (bell, pluck, brass, pad).
  const FM_PRESETS = {
    bell:  { carrierType: 'sine',     modType: 'sine',     ratio: 3.5, index: 4.5, attack: 0.005, hold: 0.02, decay: 0.45, release: 0.08, indexDecay: 0.30 },
    pluck: { carrierType: 'triangle', modType: 'sine',     ratio: 2.0, index: 5.0, attack: 0.003, hold: 0.01, decay: 0.20, release: 0.04, indexDecay: 0.10 },
    brass: { carrierType: 'sawtooth', modType: 'square',   ratio: 1.0, index: 1.4, attack: 0.012, hold: 0.04, decay: 0.18, release: 0.08, indexDecay: 0.20 },
    pad:   { carrierType: 'triangle', modType: 'sine',     ratio: 0.5, index: 0.8, attack: 0.060, hold: 0.05, decay: 0.30, release: 0.20, indexDecay: 0.50 },
    bass:  { carrierType: 'sawtooth', modType: 'sine',     ratio: 1.0, index: 0.5, attack: 0.005, hold: 0.04, decay: 0.18, release: 0.05, indexDecay: 0.10 },
  };
  const fmNote = (opts) => {
    const c = ensureCtx();
    if (!c || muted) return;
    const {
      freq = 440,
      preset = 'pluck',
      start = 0,
      gain = 0.2,
      dest = masterGain,
      reverbSend = 0,           // 0..1 — how much to send to the reverb bus
      vibrato = 0,              // depth in cents (0 = no vibrato)
      vibratoRate = 5.5,        // Hz
      durationMul = 1,          // multiplier on decay (lets music shorten/lengthen notes)
    } = opts;
    const p = FM_PRESETS[preset] || FM_PRESETS.pluck;
    const t0 = c.currentTime + start;
    const carrier = c.createOscillator();
    const mod     = c.createOscillator();
    const modGain = c.createGain();
    const ampGain = c.createGain();
    carrier.type = p.carrierType;
    mod.type     = p.modType;
    carrier.frequency.setValueAtTime(freq, t0);
    mod.frequency.setValueAtTime(freq * p.ratio, t0);
    // Modulation index envelope — punchy attack that decays for natural realism
    const idxStart = freq * p.index;
    modGain.gain.setValueAtTime(idxStart, t0);
    modGain.gain.exponentialRampToValueAtTime(Math.max(idxStart * 0.18, 0.01), t0 + p.indexDecay);
    // Amp envelope (ADSR-ish)
    const attack  = p.attack;
    const hold    = p.hold;
    const decay   = p.decay * durationMul;
    const release = p.release;
    ampGain.gain.setValueAtTime(0, t0);
    ampGain.gain.linearRampToValueAtTime(gain,        t0 + attack);
    ampGain.gain.linearRampToValueAtTime(gain * 0.6,  t0 + attack + hold);
    ampGain.gain.linearRampToValueAtTime(gain * 0.3,  t0 + attack + hold + decay * 0.6);
    ampGain.gain.linearRampToValueAtTime(0,           t0 + attack + hold + decay + release);
    // Optional vibrato — separate LFO modulating carrier freq directly (in cents)
    if (vibrato > 0) {
      const lfo = c.createOscillator();
      const lfoGain = c.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = vibratoRate;
      // Center of vibrato kicks in after the attack so the initial pitch is stable
      lfoGain.gain.setValueAtTime(0, t0);
      lfoGain.gain.linearRampToValueAtTime(freq * vibrato / 1200, t0 + attack + hold + 0.05);
      lfo.connect(lfoGain); lfoGain.connect(carrier.frequency);
      lfo.start(t0); lfo.stop(t0 + attack + hold + decay + release + 0.05);
    }
    // Wire it up: mod -> modGain -> carrier.frequency, carrier -> ampGain -> dest (+reverb)
    mod.connect(modGain); modGain.connect(carrier.frequency);
    carrier.connect(ampGain); ampGain.connect(dest);
    if (reverbSend > 0) {
      const rIn = ensureReverb();
      if (rIn) {
        const sendGain = c.createGain();
        sendGain.gain.value = reverbSend;
        ampGain.connect(sendGain); sendGain.connect(rIn);
      }
    }
    mod.start(t0);     mod.stop(t0 + attack + hold + decay + release + 0.05);
    carrier.start(t0); carrier.stop(t0 + attack + hold + decay + release + 0.05);
  };

  // ---- Drum kit (synthesized, no samples) ----------------------------------
  // Kick: low sine pitch-drop + click, Snare: noise+tone, Hat: high-passed noise.
  const drum = (kind, opts = {}) => {
    const c = ensureCtx();
    if (!c || muted) return;
    const { start = 0, gain = 0.3, dest = masterGain } = opts;
    const t0 = c.currentTime + start;
    if (kind === 'kick') {
      const osc = c.createOscillator(); osc.type = 'sine';
      const g = c.createGain();
      osc.frequency.setValueAtTime(140, t0);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.10);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      osc.connect(g); g.connect(dest);
      osc.start(t0); osc.stop(t0 + 0.22);
    } else if (kind === 'snare') {
      // Tone component (200Hz pop) + filtered noise (snare crack)
      const buf = getNoiseBuf(); if (!buf) return;
      const src = c.createBufferSource(); src.buffer = buf;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0, t0);
      ng.gain.linearRampToValueAtTime(gain * 0.9, t0 + 0.003);
      ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
      src.connect(hp); hp.connect(ng); ng.connect(dest);
      src.start(t0); src.stop(t0 + 0.16);
      // Body tone
      const osc = c.createOscillator(); osc.type = 'triangle';
      const og = c.createGain();
      osc.frequency.setValueAtTime(220, t0);
      osc.frequency.exponentialRampToValueAtTime(160, t0 + 0.06);
      og.gain.setValueAtTime(0, t0);
      og.gain.linearRampToValueAtTime(gain * 0.4, t0 + 0.003);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.10);
      osc.connect(og); og.connect(dest);
      osc.start(t0); osc.stop(t0 + 0.12);
    } else if (kind === 'hat') {
      const buf = getNoiseBuf(); if (!buf) return;
      const src = c.createBufferSource(); src.buffer = buf;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain * 0.5, t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
      src.connect(hp); hp.connect(g); g.connect(dest);
      src.start(t0); src.stop(t0 + 0.07);
    } else if (kind === 'crash') {
      const buf = getNoiseBuf(); if (!buf) return;
      const src = c.createBufferSource(); src.buffer = buf;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain * 0.6, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.50);
      src.connect(hp); hp.connect(g); g.connect(dest);
      src.start(t0); src.stop(t0 + 0.55);
    }
  };

  // === SFX: catalog of named effects =========================================
  // Many of these now layer multiple voices for richer "DS-era" texture.
  const sfx = {
    // UI
    menuOpen: () => { wake(); note({ freq: 660, freqEnd: 880, type: 'square', attack: 0.005, decay: 0.06, gain: 0.18 }); },
    menuClose:() => { wake(); note({ freq: 880, freqEnd: 440, type: 'square', attack: 0.005, decay: 0.06, gain: 0.18 }); },
    blip:     () => { wake(); note({ freq: 720, type: 'square', attack: 0.003, decay: 0.04, gain: 0.14 }); },
    confirm:  () => { wake(); fmNote({ freq: 523, preset: 'bell', gain: 0.18, reverbSend: 0.2 }); fmNote({ freq: 784, preset: 'bell', start: 0.06, gain: 0.18, reverbSend: 0.2 }); },
    deny:     () => { wake(); note({ freq: 220, type: 'square', decay: 0.12, gain: 0.18 }); note({ freq: 175, type: 'sawtooth', start: 0.04, decay: 0.10, gain: 0.14 }); },
    // Movement — quiet alternating click; deliberately stays the original simple osc
    step: (() => {
      let toggle = false;
      return () => { wake(); toggle = !toggle; note({ freq: toggle ? 180 : 200, type: 'square', attack: 0.002, hold: 0.005, decay: 0.02, release: 0.01, gain: 0.06 }); };
    })(),
    // Battle: attack flavor by color — now layered with whoosh + impact
    attack: (color) => {
      wake();
      const arr = COLOR_FREQ[color] || [330, 440, 550];
      // Layer 1: noise whoosh (the spell winding up)
      noise({ gain: 0.12, attack: 0.04, decay: 0.14, lowpass: 1800 });
      // Layer 2: FM tone cluster (spell timbre — color-coded)
      const preset = color === 'R' ? 'brass' : (color === 'U' ? 'bell' : (color === 'B' ? 'pad' : (color === 'G' ? 'pluck' : 'bell')));
      arr.forEach((f, i) => fmNote({
        freq: f, preset, start: i * 0.03, gain: 0.18, reverbSend: 0.25,
      }));
      // Layer 3: bass thump on the downbeat
      drum('kick', { gain: 0.22, start: 0.02 });
    },
    hit:        () => { wake(); noise({ gain: 0.32, decay: 0.09, lowpass: 1200 }); drum('kick', { gain: 0.20 }); fmNote({ freq: 110, preset: 'bass', gain: 0.15, durationMul: 0.5 }); },
    crit:       () => { wake(); noise({ gain: 0.45, decay: 0.16, lowpass: 2400 }); drum('kick', { gain: 0.30 }); drum('snare', { gain: 0.30, start: 0.04 }); fmNote({ freq: 880, preset: 'brass', gain: 0.22, reverbSend: 0.3 }); fmNote({ freq: 220, preset: 'brass', start: 0.05, gain: 0.20 }); },
    miss:       () => { wake(); note({ freq: 240, freqEnd: 180, type: 'sine', decay: 0.10, gain: 0.14 }); noise({ gain: 0.10, decay: 0.12, lowpass: 600, start: 0.02 }); },
    notVeryEffective: () => { wake(); fmNote({ freq: 200, preset: 'pad', gain: 0.14, durationMul: 1.2 }); },
    superEffective:   () => { wake(); fmNote({ freq: 880,  preset: 'bell', gain: 0.18, reverbSend: 0.4 }); fmNote({ freq: 1320, preset: 'bell', start: 0.05, gain: 0.18, reverbSend: 0.4 }); fmNote({ freq: 1760, preset: 'bell', start: 0.10, gain: 0.16, reverbSend: 0.4 }); },
    heal:       () => { wake(); [523, 659, 784, 1047].forEach((f, i) => fmNote({ freq: f, preset: 'bell', start: i * 0.05, gain: 0.16, reverbSend: 0.5 })); },
    statusApply:() => { wake(); fmNote({ freq: 392, preset: 'pluck', gain: 0.14 }); fmNote({ freq: 466, preset: 'pluck', start: 0.05, gain: 0.14 }); },
    faint:      () => { wake(); fmNote({ freq: 440, preset: 'pad', gain: 0.22, durationMul: 2 }); note({ freq: 440, freqEnd: 110, type: 'sawtooth', attack: 0.01, decay: 0.45, gain: 0.18 }); drum('kick', { gain: 0.2, start: 0.4 }); },
    catchTry:   () => {
      wake();
      [0, 0.18, 0.36].forEach((t, i) => fmNote({ freq: 660 + i * 80, preset: 'pluck', start: t, gain: 0.18 }));
    },
    catchSuccess: () => {
      wake();
      [523, 659, 784, 1047, 1319].forEach((f, i) => fmNote({ freq: f, preset: 'bell', start: i * 0.07, gain: 0.20, reverbSend: 0.4 }));
    },
    catchFail: () => { wake(); note({ freq: 440, freqEnd: 220, type: 'square', decay: 0.18, gain: 0.18 }); drum('snare', { gain: 0.18, start: 0.10 }); },
    // Progression
    levelUp:   () => { wake(); [523, 659, 784, 1047].forEach((f, i) => fmNote({ freq: f, preset: 'bell', start: i * 0.06, gain: 0.20, reverbSend: 0.3 })); fmNote({ freq: 1568, preset: 'bell', start: 0.30, gain: 0.18, reverbSend: 0.5 }); },
    learnMove: () => { wake(); [659, 784, 988].forEach((f, i) => fmNote({ freq: f, preset: 'bell', start: i * 0.05, gain: 0.18, reverbSend: 0.4 })); },
    grafted:   () => { wake(); [440, 554, 659, 880].forEach((f, i) => fmNote({ freq: f, preset: 'bell', start: i * 0.05, gain: 0.18, reverbSend: 0.5 })); },
    // World events
    victory:   () => {
      wake();
      const m = [523, 659, 784, 1047, 1319, 1568];
      m.forEach((f, i) => fmNote({ freq: f, preset: 'brass', start: i * 0.10, gain: 0.20, reverbSend: 0.25 }));
      drum('kick', { gain: 0.22, start: 0 });
      drum('snare', { gain: 0.20, start: 0.30 });
    },
    defeat:    () => { wake(); [440, 392, 349, 294, 220].forEach((f, i) => fmNote({ freq: f, preset: 'brass', start: i * 0.12, gain: 0.20, durationMul: 1.5 })); drum('kick', { gain: 0.20, start: 0.55 }); },
    medallion: (color) => {
      wake();
      const arr = COLOR_FREQ[color] || [880, 1320];
      arr.forEach((f, i) => fmNote({ freq: f, preset: 'bell', start: i * 0.08, gain: 0.22, reverbSend: 0.6, vibrato: 8 }));
      [1760, 2093, 2637].forEach((f, i) => fmNote({ freq: f, preset: 'bell', start: 0.25 + i * 0.05, gain: 0.14, reverbSend: 0.5 }));
    },
    bossEntrance: () => {
      wake();
      // Low descending rumble + dissonant overtones + impact
      fmNote({ freq: 110, preset: 'bass', gain: 0.30, durationMul: 4 });
      fmNote({ freq: 73,  preset: 'bass', start: 0.05, gain: 0.20, durationMul: 4 });
      noise({ gain: 0.20, decay: 0.6, lowpass: 600 });
      drum('kick', { gain: 0.32, start: 0 });
      drum('crash', { gain: 0.22, start: 0.10 });
    },
    battleStart: (kind) => {
      wake();
      if (kind === 'wild') {
        // Quick ascending arpeggio → bright "ta-da" chord
        drum('kick', { gain: 0.22, start: 0 });
        drum('snare', { gain: 0.18, start: 0.06 });
        [392, 523, 659, 784].forEach((f, i) =>
          fmNote({ freq: f, preset: 'pluck', start: 0.04 + i * 0.07, gain: 0.20, reverbSend: 0.2 })
        );
        // Final chord stab
        [523, 659, 784].forEach(f =>
          fmNote({ freq: f, preset: 'brass', start: 0.36, gain: 0.18, reverbSend: 0.3, durationMul: 1.5 })
        );
        fmNote({ freq: 196, preset: 'bass', start: 0.36, gain: 0.20, durationMul: 1.5 });
        drum('crash', { gain: 0.18, start: 0.36 });
      } else {
        // Trainer: longer, more dramatic
        drum('kick',  { start: 0,    gain: 0.28 });
        drum('snare', { start: 0.24, gain: 0.22 });
        drum('kick',  { start: 0.48, gain: 0.28 });
        fmNote({ freq: 147, preset: 'bass', start: 0,    gain: 0.22, durationMul: 1.3 });
        fmNote({ freq: 196, preset: 'bass', start: 0.24, gain: 0.20, durationMul: 1.3 });
        fmNote({ freq: 147, preset: 'bass', start: 0.48, gain: 0.22, durationMul: 2 });
        [784, 659, 523, 659, 880, 1047].forEach((f, i) =>
          fmNote({ freq: f, preset: 'pluck', start: 0.05 + i * 0.07, gain: 0.20, reverbSend: 0.25 })
        );
        [440, 523, 659, 880].forEach(f =>
          fmNote({ freq: f, preset: 'brass', start: 0.55, gain: 0.20, reverbSend: 0.35, durationMul: 2 })
        );
        fmNote({ freq: 1319, preset: 'bell', start: 0.65, gain: 0.16, reverbSend: 0.5 });
        drum('crash', { gain: 0.22, start: 0.55 });
      }
    },
    planarBurst: () => {
      wake();
      ['W', 'U', 'B', 'R', 'G'].forEach((col, i) => {
        const arr = COLOR_FREQ[col] || [440];
        const preset = col === 'R' ? 'brass' : (col === 'U' ? 'bell' : (col === 'B' ? 'pad' : (col === 'G' ? 'pluck' : 'bell')));
        arr.forEach((f, j) => fmNote({ freq: f * 1.5, preset, start: i * 0.04 + j * 0.01, gain: 0.10, reverbSend: 0.5 }));
      });
      noise({ gain: 0.30, decay: 0.4, lowpass: 3000, start: 0.1 });
      drum('crash', { gain: 0.30, start: 0 });
    },
    fanfare: () => {
      wake();
      [392, 523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) =>
        fmNote({ freq: f, preset: 'brass', start: i * 0.09, gain: 0.22, reverbSend: 0.3 })
      );
      drum('crash', { gain: 0.18, start: 0 });
      drum('kick',  { gain: 0.22, start: 0.36 });
      drum('snare', { gain: 0.20, start: 0.54 });
    },
  };

  // === MUSIC ================================================================
  // Multi-track music: each track is a set of parallel layers (melody, bass, drums,
  // harmony) sharing a tempo and step grid. Each step plays whichever notes from
  // each layer fall on that step. Layers are scheduled together so they stay in sync.
  //
  // Note format:
  //   melody / bass / harmony : array of frequencies (number, or 0 for rest)
  //   drums : array of '.', 'k' (kick), 's' (snare), 'h' (hat), 'x' (crash)
  //           multiple drums on the same step encoded as combinations: 'kh', 'sh' etc.
  //
  // Each track also picks instrument presets per layer.
  const TRACKS = {
    // ============================================================================
    // Each track is structured A — B — A' — C across 64 steps (~4× the old length).
    // A   = the original 16-step phrase (the recognizable theme, preserved verbatim).
    // B   = a variation that develops the theme — usually moves to a related key.
    // A'  = the theme returning, often with small ornaments on the harmony/bass.
    // C   = a closing/climax phrase that resolves back to root in time for the loop.
    // ============================================================================

    town: {
      tempo: 120,
      // Cheerful market town. C major theme; B detours through A minor (relative);
      // A' returns; C closes with a IV-V-I cadence into the loop.
      melody: [
        // A — original theme
        523, 0, 659, 0, 784, 0, 659, 0, 587, 0, 523, 0, 440, 0, 523, 0,
        // B — A minor detour (sixth color)
        440, 0, 523, 0, 659, 0, 523, 0, 494, 0, 440, 0, 392, 0, 440, 0,
        // A' — theme returns
        523, 0, 659, 0, 784, 0, 659, 0, 587, 0, 523, 0, 440, 0, 523, 0,
        // C — IV-V-I closing flourish
        698, 0, 784, 0, 880, 0, 784, 0, 698, 0, 587, 0, 523, 0,   0, 0,
      ],
      harmony: [
        262, 0,   0, 0, 392, 0,   0, 0, 349, 0,   0, 0, 262, 0,   0, 0,
        220, 0,   0, 0, 330, 0,   0, 0, 247, 0,   0, 0, 220, 0,   0, 0,
        262, 0,   0, 0, 392, 0,   0, 0, 349, 0,   0, 0, 262, 0,   0, 0,
        349, 0,   0, 0, 392, 0,   0, 0, 262, 0,   0, 0, 262, 0,   0, 0,
      ],
      bass: [
        131, 0,   0, 0, 196, 0,   0, 0, 175, 0,   0, 0, 131, 0,   0, 0,
        110, 0,   0, 0, 165, 0,   0, 0, 123, 0,   0, 0, 110, 0,   0, 0,
        131, 0,   0, 0, 196, 0,   0, 0, 175, 0,   0, 0, 131, 0,   0, 0,
        175, 0,   0, 0, 196, 0,   0, 0, 131, 0,   0, 0, 131, 0,   0, 0,
      ],
      drums: [
        'k', '.', 'h', '.', 's', '.', 'h', '.', 'k', '.', 'h', '.', 's', '.', 'h', '.',
        'k', '.', 'h', '.', 's', '.', 'h', '.', 'k', '.', 'h', '.', 's', '.', 'h', 'h',
        'k', '.', 'h', '.', 's', '.', 'h', '.', 'k', '.', 'h', '.', 's', '.', 'h', '.',
        'k', '.', 'h', 'h', 's', '.', 'h', '.', 'k', '.', 'h', '.', 's', '.', 'h', 'x',
      ],
      melodyPreset: 'pluck', harmonyPreset: 'pad', bassPreset: 'bass',
      reverb: 0.18,
    },

    wilds: {
      tempo: 96,
      // Mysterious forest. D minor theme; B explores upper register;
      // A' returns; C resolves slowly downward into a hushed ending.
      melody: [
        // A — original
        294, 0, 0, 392, 440, 0, 0, 392, 349, 0, 0, 294, 262, 0, 0, 294,
        // B — upper register variation, F-major flavor
        349, 0, 0, 440, 523, 0, 0, 440, 392, 0, 0, 349, 294, 0, 0, 349,
        // A' — theme returns
        294, 0, 0, 392, 440, 0, 0, 392, 349, 0, 0, 294, 262, 0, 0, 294,
        // C — soft resolve back to D
        262, 0, 0, 294, 349, 0, 0, 294, 262, 0, 0, 220, 196, 0, 0,   0,
      ],
      harmony: [
        196, 0, 0,   0, 220, 0, 0,   0, 175, 0, 0,   0, 131, 0, 0,   0,
        220, 0, 0,   0, 262, 0, 0,   0, 196, 0, 0,   0, 175, 0, 0,   0,
        196, 0, 0,   0, 220, 0, 0,   0, 175, 0, 0,   0, 131, 0, 0,   0,
        131, 0, 0,   0, 175, 0, 0,   0, 131, 0, 0,   0,  98, 0, 0,   0,
      ],
      bass: [
        98,  0, 0,   0, 110, 0, 0,   0,  87, 0, 0,   0,  65, 0, 0,   0,
        87,  0, 0,   0, 110, 0, 0,   0,  98, 0, 0,   0,  87, 0, 0,   0,
        98,  0, 0,   0, 110, 0, 0,   0,  87, 0, 0,   0,  65, 0, 0,   0,
        65,  0, 0,   0,  87, 0, 0,   0,  65, 0, 0,   0,  49, 0, 0,   0,
      ],
      drums: [
        'k', '.', 'h', '.', 's', '.', 'h', '.', 'k', '.', 'h', 'h', 's', '.', 'h', '.',
        'k', '.', 'h', '.', 's', '.', 'h', 'h', 'k', '.', 'h', 'h', 's', '.', 'h', '.',
        'k', '.', 'h', '.', 's', '.', 'h', '.', 'k', '.', 'h', 'h', 's', '.', 'h', '.',
        'k', '.', '.', '.', 's', '.', '.', '.', 'k', '.', '.', '.', 'h', '.', '.', '.',
      ],
      melodyPreset: 'pluck', harmonyPreset: 'pad', bassPreset: 'bass',
      reverb: 0.32,
    },

    plains: {
      tempo: 110,
      // Heavenly bells. C major theme; B lifts through G major; A' returns;
      // C is a soaring climactic phrase ending on the high tonic.
      melody: [
        // A — original
        523, 659, 784, 659, 523, 659, 880, 659, 784, 659, 523, 392, 440, 523, 659, 784,
        // B — G major lift (V chord)
        587, 740, 880, 740, 587, 740, 988, 740, 880, 740, 587, 440, 494, 587, 740, 880,
        // A' — theme returns
        523, 659, 784, 659, 523, 659, 880, 659, 784, 659, 523, 392, 440, 523, 659, 784,
        // C — climb to high C and resolve
        880, 988, 1047, 988, 1047, 1175, 1319, 1175, 1047, 988, 880, 784, 659, 784, 1047, 0,
      ],
      harmony: [
        262, 0, 392, 0, 262, 0, 440, 0, 392, 0, 262, 0, 220, 0, 392, 0,
        294, 0, 440, 0, 294, 0, 494, 0, 440, 0, 294, 0, 247, 0, 440, 0,
        262, 0, 392, 0, 262, 0, 440, 0, 392, 0, 262, 0, 220, 0, 392, 0,
        440, 0, 523, 0, 587, 0, 659, 0, 523, 0, 440, 0, 392, 0, 523, 0,
      ],
      bass: [
        131, 0, 0, 0, 131, 0, 0, 0, 196, 0, 0, 0, 110, 0, 0, 0,
        147, 0, 0, 0, 147, 0, 0, 0, 220, 0, 0, 0, 123, 0, 0, 0,
        131, 0, 0, 0, 131, 0, 0, 0, 196, 0, 0, 0, 110, 0, 0, 0,
        220, 0, 0, 0, 262, 0, 0, 0, 196, 0, 0, 0, 131, 0, 0, 0,
      ],
      drums: [
        'k', '.', 'h', 'h', 's', '.', 'h', 'h', 'k', '.', 'h', 'h', 's', '.', 'h', '.',
        'k', '.', 'h', 'h', 's', '.', 'h', 'h', 'k', '.', 'h', 'h', 's', '.', 'h', 'h',
        'k', '.', 'h', 'h', 's', '.', 'h', 'h', 'k', '.', 'h', 'h', 's', '.', 'h', '.',
        'k', '.', 'h', 'h', 's', 'h', 'h', 'h', 'k', 'h', 'h', 'h', 's', 'h', 'h', 'x',
      ],
      melodyPreset: 'bell', harmonyPreset: 'pad', bassPreset: 'bass',
      reverb: 0.45,
    },

    sanctum: {
      tempo: 80,
      // Ethereal cathedral, slow. C minor theme; B drifts upward toward E♭ major;
      // A' returns; C settles back to C minor with a hushed final chord.
      melody: [
        // A — original
        262, 0, 311, 0, 392, 0, 466, 0, 392, 0, 311, 0, 262, 0, 233, 0,
        // B — drift up (E♭ major)
        311, 0, 392, 0, 466, 0, 587, 0, 466, 0, 392, 0, 311, 0, 277, 0,
        // A' — theme returns
        262, 0, 311, 0, 392, 0, 466, 0, 392, 0, 311, 0, 262, 0, 233, 0,
        // C — quiet resolution
        233, 0, 262, 0, 311, 0, 262, 0, 233, 0, 196, 0, 262, 0,   0, 0,
      ],
      harmony: [
        131, 0, 156, 0, 196, 0, 233, 0, 196, 0, 156, 0, 131, 0, 117, 0,
        156, 0, 196, 0, 233, 0, 294, 0, 233, 0, 196, 0, 156, 0, 138, 0,
        131, 0, 156, 0, 196, 0, 233, 0, 196, 0, 156, 0, 131, 0, 117, 0,
        117, 0, 131, 0, 156, 0, 131, 0, 117, 0,  98, 0, 131, 0,   0, 0,
      ],
      bass: [
        65,  0, 0, 0,  98, 0, 0, 0,  98, 0, 0, 0,  65, 0, 0, 0,
        78,  0, 0, 0, 117, 0, 0, 0, 117, 0, 0, 0,  78, 0, 0, 0,
        65,  0, 0, 0,  98, 0, 0, 0,  98, 0, 0, 0,  65, 0, 0, 0,
        49,  0, 0, 0,  65, 0, 0, 0,  49, 0, 0, 0,  65, 0, 0, 0,
      ],
      drums: [
        'k', '.', '.', '.', 'h', '.', '.', '.', 's', '.', '.', '.', 'h', '.', '.', '.',
        'k', '.', '.', '.', 'h', '.', '.', '.', 's', '.', '.', '.', 'h', '.', '.', '.',
        'k', '.', '.', '.', 'h', '.', '.', '.', 's', '.', '.', '.', 'h', '.', '.', '.',
        'k', '.', '.', '.', '.', '.', '.', '.', 's', '.', '.', '.', '.', '.', '.', '.',
      ],
      melodyPreset: 'bell', harmonyPreset: 'pad', bassPreset: 'pad',
      reverb: 0.55,
    },

    ashen: {
      tempo: 130,
      // Driving, industrial. A minor theme; B raises tension via diminished tones;
      // A' returns; C is a heavier driving section before looping back.
      melody: [
        // A — original
        220, 277, 330, 277, 220, 277, 330, 415, 330, 277, 220, 165, 196, 220, 277, 330,
        // B — tension build, with diminished color (E♭/F♯)
        247, 311, 370, 311, 247, 311, 370, 466, 370, 311, 247, 185, 220, 247, 311, 370,
        // A' — theme returns
        220, 277, 330, 277, 220, 277, 330, 415, 330, 277, 220, 165, 196, 220, 277, 330,
        // C — heavy descending close
        415, 330, 277, 220, 415, 330, 277, 220, 196, 165, 131, 110, 165, 196, 220, 165,
      ],
      harmony: [
        110, 0, 165, 0, 110, 0, 165, 0, 138, 0, 110, 0,  98, 0, 138, 0,
        123, 0, 185, 0, 123, 0, 185, 0, 156, 0, 123, 0, 110, 0, 156, 0,
        110, 0, 165, 0, 110, 0, 165, 0, 138, 0, 110, 0,  98, 0, 138, 0,
        165, 0, 138, 0, 165, 0, 138, 0,  98, 0,  82, 0, 110, 0, 138, 0,
      ],
      bass: [
        55, 0, 0, 0,  55, 0, 0, 0,  73, 0, 0, 0,  49, 0, 0, 0,
        62, 0, 0, 0,  62, 0, 0, 0,  82, 0, 0, 0,  55, 0, 0, 0,
        55, 0, 0, 0,  55, 0, 0, 0,  73, 0, 0, 0,  49, 0, 0, 0,
        82, 0, 0, 0,  82, 0, 0, 0,  49, 0, 0, 0,  55, 0, 0, 0,
      ],
      drums: [
        'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
        'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
        'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
        'k', 'h', 's', 'x', 'k', 'h', 's', 'x', 'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
      ],
      melodyPreset: 'brass', harmonyPreset: 'brass', bassPreset: 'bass',
      reverb: 0.2,
    },

    umbral: {
      tempo: 70,
      // Foggy, dread-laden. G minor theme; B descends further into the abyss;
      // A' returns; C drifts back up to the home note over a deep pad.
      melody: [
        // A — original
        196, 0, 233, 0, 277, 0, 233, 0, 196, 0, 175, 0, 196, 0, 220, 0,
        // B — descend further (lower octave)
        175, 0, 196, 0, 233, 0, 196, 0, 175, 0, 147, 0, 165, 0, 196, 0,
        // A' — theme returns
        196, 0, 233, 0, 277, 0, 233, 0, 196, 0, 175, 0, 196, 0, 220, 0,
        // C — drift back up
        220, 0, 247, 0, 277, 0, 247, 0, 220, 0, 196, 0, 175, 0, 196, 0,
      ],
      harmony: [
        98,  0, 117, 0, 138, 0, 117, 0,  98, 0,  87, 0,  98, 0, 110, 0,
        87,  0,  98, 0, 117, 0,  98, 0,  87, 0,  73, 0,  82, 0,  98, 0,
        98,  0, 117, 0, 138, 0, 117, 0,  98, 0,  87, 0,  98, 0, 110, 0,
        110, 0, 123, 0, 138, 0, 123, 0, 110, 0,  98, 0,  87, 0,  98, 0,
      ],
      bass: [
        49,  0, 0, 0,  65, 0, 0, 0,  49, 0, 0, 0,  43, 0, 0, 0,
        43,  0, 0, 0,  49, 0, 0, 0,  43, 0, 0, 0,  37, 0, 0, 0,
        49,  0, 0, 0,  65, 0, 0, 0,  49, 0, 0, 0,  43, 0, 0, 0,
        55,  0, 0, 0,  62, 0, 0, 0,  49, 0, 0, 0,  43, 0, 0, 0,
      ],
      drums: [
        'k', '.', '.', '.', 'h', '.', '.', '.', 'k', '.', '.', '.', 'h', '.', '.', '.',
        'k', '.', '.', '.', 'h', '.', '.', '.', 'k', '.', '.', '.', 'h', '.', '.', '.',
        'k', '.', '.', '.', 'h', '.', '.', '.', 'k', '.', '.', '.', 'h', '.', '.', '.',
        'k', '.', '.', '.', 'h', '.', '.', 'h', 'k', '.', '.', '.', 'h', '.', '.', 'x',
      ],
      melodyPreset: 'pad', harmonyPreset: 'pad', bassPreset: 'pad',
      reverb: 0.50,
    },

    boss: {
      tempo: 140,
      // Intense legendary battle. A minor theme; B raises the urgency;
      // A' returns; C is a heavier riff sweeping back to the loop.
      melody: [
        // A — original
        220, 247, 220, 165, 110, 165, 220, 247, 220, 165, 110,  87, 110, 131, 165, 196,
        // B — fifth higher (more intensity)
        330, 370, 330, 247, 165, 247, 330, 370, 330, 247, 165, 131, 165, 196, 247, 294,
        // A' — theme returns
        220, 247, 220, 165, 110, 165, 220, 247, 220, 165, 110,  87, 110, 131, 165, 196,
        // C — driving climax descent
        262, 247, 220, 196, 247, 220, 196, 165, 220, 196, 165, 131, 165, 196, 220, 247,
      ],
      harmony: [
        110,   0, 110,   0,  55,   0, 110,   0, 110,   0,  55,   0,  55,   0,  82,   0,
        165,   0, 165,   0,  82,   0, 165,   0, 165,   0,  82,   0,  82,   0, 123,   0,
        110,   0, 110,   0,  55,   0, 110,   0, 110,   0,  55,   0,  55,   0,  82,   0,
        131,   0, 110,   0,  98,   0, 110,   0, 110,   0,  82,   0,  82,   0, 110,   0,
      ],
      bass: [
        55,    0,   0,   0,  55,   0,   0,   0,  55,   0,   0,   0,  41,   0,   0,   0,
        82,    0,   0,   0,  82,   0,   0,   0,  82,   0,   0,   0,  62,   0,   0,   0,
        55,    0,   0,   0,  55,   0,   0,   0,  55,   0,   0,   0,  41,   0,   0,   0,
        65,    0,   0,   0,  49,   0,   0,   0,  55,   0,   0,   0,  41,   0,   0,   0,
      ],
      drums: [
        'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
        'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
        'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
        'k', 'h', 's', 'x', 'k', 'h', 's', 'x', 'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
      ],
      melodyPreset: 'brass', harmonyPreset: 'brass', bassPreset: 'bass',
      reverb: 0.25,
    },

    final: {
      tempo: 150,
      // Planeswalker. A minor theme that climbs; B reaches even higher;
      // A' returns; C is an epic ascending climax that resolves into the loop.
      melody: [
        // A — original
        220, 261, 311, 392, 466, 392, 311, 261, 220, 196, 165, 196, 220, 261, 311, 392,
        // B — same shape, higher (one octave up center)
        440, 523, 587, 698, 880, 698, 587, 523, 440, 392, 330, 392, 440, 523, 587, 698,
        // A' — theme returns
        220, 261, 311, 392, 466, 392, 311, 261, 220, 196, 165, 196, 220, 261, 311, 392,
        // C — epic climbing climax
        523, 587, 698, 784, 880, 988, 1047, 988, 880, 784, 698, 587, 523, 466, 392, 440,
      ],
      harmony: [
        110, 131, 156, 196, 233, 196, 156, 131, 110,  98,  82,  98, 110, 131, 156, 196,
        220, 261, 294, 349, 440, 349, 294, 261, 220, 196, 165, 196, 220, 261, 294, 349,
        110, 131, 156, 196, 233, 196, 156, 131, 110,  98,  82,  98, 110, 131, 156, 196,
        261, 294, 349, 392, 440, 494, 523, 494, 440, 392, 349, 294, 261, 233, 196, 220,
      ],
      bass: [
        55,    0,   0,   0,  73,   0,   0,   0,  55,   0,   0,   0,  49,   0,   0,   0,
        82,    0,   0,   0, 110,   0,   0,   0,  82,   0,   0,   0,  73,   0,   0,   0,
        55,    0,   0,   0,  73,   0,   0,   0,  55,   0,   0,   0,  49,   0,   0,   0,
        65,    0,   0,   0, 110,   0,   0,   0, 110,   0,   0,   0,  55,   0,   0,   0,
      ],
      drums: [
        'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'x', 's', 'x',
        'k', 'h', 's', 'h', 'k', 'h', 's', 'x', 'k', 'h', 's', 'h', 'k', 'x', 's', 'x',
        'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'h', 's', 'h', 'k', 'x', 's', 'x',
        'k', 'h', 's', 'x', 'k', 'h', 's', 'x', 'k', 'h', 's', 'x', 'k', 'x', 's', 'x',
      ],
      melodyPreset: 'brass', harmonyPreset: 'brass', bassPreset: 'bass',
      reverb: 0.30,
    },

    title: {
      tempo: 105,
      // Heroic title medley. The original was already 32 steps — we extend
      // by adding a bridge (B) before the resolution and a tag (C) after it.
      melody: [
        // A — original first half
        523, 659, 784, 1047, 988, 880, 784, 659,
        698, 880, 1047, 880, 698, 587, 523, 0,
        // B — original second half (climb + descent)
        784, 988, 1175, 988, 1319, 1175, 988, 784,
        880, 784, 698, 587, 523, 587, 698, 0,
        // A' — restate the heroic opening
        523, 659, 784, 1047, 988, 880, 784, 659,
        698, 880, 1047, 880, 698, 587, 523, 0,
        // C — triumphant tag and quiet breath
        1047, 1175, 1319, 1568, 1319, 1175, 1047, 880,
        784, 880, 698, 587, 523, 392, 523, 0,
      ],
      harmony: [
        262,   0, 392,   0, 330,   0, 262,   0,
        349,   0, 440,   0, 349,   0, 262,   0,
        392,   0, 494,   0, 440,   0, 392,   0,
        440,   0, 349,   0, 262,   0, 349,   0,
        262,   0, 392,   0, 330,   0, 262,   0,
        349,   0, 440,   0, 349,   0, 262,   0,
        523,   0, 659,   0, 523,   0, 440,   0,
        392,   0, 349,   0, 262,   0, 196,   0,
      ],
      bass: [
        131, 0, 0, 0, 0, 0, 196, 0,
        175, 0, 0, 0, 131, 0, 0, 0,
        196, 0, 0, 0, 165, 0, 0, 0,
        220, 0, 175, 0, 131, 0, 165, 0,
        131, 0, 0, 0, 0, 0, 196, 0,
        175, 0, 0, 0, 131, 0, 0, 0,
        262, 0, 0, 0, 220, 0, 0, 0,
        196, 0, 175, 0, 131, 0, 98,  0,
      ],
      drums: [
        'k', '.', 'h', '.', 's', '.', 'h', '.',
        'k', '.', 'h', '.', 's', '.', 'h', '.',
        'k', '.', 'h', 'h', 's', '.', 'h', '.',
        'k', '.', 'h', '.', 's', '.', 'h', 'x',
        'k', '.', 'h', '.', 's', '.', 'h', '.',
        'k', '.', 'h', '.', 's', '.', 'h', '.',
        'k', 'h', 's', 'h', 'k', 'h', 's', 'x',
        'k', '.', 'h', '.', 's', '.', '.', '.',
      ],
      melodyPreset: 'bell', harmonyPreset: 'pad', bassPreset: 'bass',
      reverb: 0.38,
    },
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
    const len = track.melody.length;
    // Schedule a window of notes ahead at a time so we never starve.
    const tick = () => {
      // Stale-time recovery: if `nextTime` is behind the audio clock, snap forward.
      if (nextTime < c.currentTime) nextTime = c.currentTime + 0.05;
      const horizon = c.currentTime + 0.5;
      while (nextTime < horizon) {
        const idx = stepIdx % len;
        const startOff = nextTime - c.currentTime;
        const reverbSend = track.reverb || 0;
        // Melody — full volume, reverb send for sparkle
        const m = track.melody[idx];
        if (m > 0) fmNote({ freq: m, preset: track.melodyPreset, start: startOff, gain: 0.16, durationMul: 0.9, reverbSend, dest: musicGain });
        // Harmony — quieter, longer notes
        const h = track.harmony && track.harmony[idx];
        if (h > 0) fmNote({ freq: h, preset: track.harmonyPreset, start: startOff, gain: 0.09, durationMul: 1.4, reverbSend: reverbSend * 0.7, dest: musicGain });
        // Bass — lowest layer, no reverb (keep it tight)
        const b = track.bass && track.bass[idx];
        if (b > 0) fmNote({ freq: b, preset: track.bassPreset, start: startOff, gain: 0.13, durationMul: 1.2, dest: musicGain });
        // Drums — string codes; one or two letters per step
        const d = track.drums && track.drums[idx];
        if (d && d !== '.') {
          for (const ch of d) {
            if (ch === 'k') drum('kick',  { start: startOff, gain: 0.16, dest: musicGain });
            if (ch === 's') drum('snare', { start: startOff, gain: 0.13, dest: musicGain });
            if (ch === 'h') drum('hat',   { start: startOff, gain: 0.09, dest: musicGain });
            if (ch === 'x') drum('crash', { start: startOff, gain: 0.10, dest: musicGain });
          }
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
// Per-mode save keys — classic and commander each get their own slot so
// starting a new run in one mode never overwrites the other.
// The legacy key (v1) is tried as a fallback so existing saves aren't lost.
const SAVE_KEY_CLASSIC  = 'gtm:save:classic:v1';
const SAVE_KEY_CMDR     = 'gtm:save:cmdr:v1';
const SAVE_KEY_LEGACY   = 'gtm:save:v1';
function getSaveKey(mode) {
  return mode === 'commander' ? SAVE_KEY_CMDR : SAVE_KEY_CLASSIC;
}

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

  const SAVE_KEY = getSaveKey(state.mode);

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

  console.log('[GtM] saving payload, size:', payload.length, 'key:', SAVE_KEY);
  try {
    const r = await window.storage.set(SAVE_KEY, payload);
    console.log('[GtM] storage.set returned:', r);
    if (r && typeof r === 'object' && r.key === SAVE_KEY) return true;
    if (r === null || r === undefined) {
      lastSaveFailure = 'rate limited';
      rateLimitBackoffUntil = Date.now() + 10 * 60 * 1000;
      return false;
    }
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

// loadGame(mode) — loads the save for the given mode.
// Falls back to the legacy single-slot key ONLY when its stored mode matches,
// so a legacy commander save never surfaces as a classic save and vice versa.
async function loadGame(mode) {
  const key = getSaveKey(mode);
  try {
    if (typeof window !== 'undefined' && window.storage) {
      // Try the mode-specific key first
      const r = await window.storage.get(key);
      if (r?.value) return JSON.parse(r.value);

      // No mode-specific save found — check the legacy key, but validate the
      // mode field inside it before returning. An absent mode field counts as
      // 'classic' (that was the original default before commander mode existed).
      try {
        const legacy = await window.storage.get(SAVE_KEY_LEGACY);
        if (legacy?.value) {
          const parsed = JSON.parse(legacy.value);
          const legacyMode = parsed.mode || 'classic';
          if (legacyMode === mode) return parsed;
        }
      } catch (_) {}
    }
  } catch (e) {
    console.error('[GtM] loadGame failed:', e);
  }
  return null;
}

// clearSave(mode) — deletes the save for one mode (or all saves if mode is omitted).
async function clearSave(mode) {
  try {
    if (typeof window !== 'undefined' && window.storage) {
      if (mode) {
        await window.storage.delete(getSaveKey(mode));
      } else {
        // Nuclear option: clear every slot
        for (const k of [SAVE_KEY_CLASSIC, SAVE_KEY_CMDR, SAVE_KEY_LEGACY]) {
          try { await window.storage.delete(k); } catch (_) {}
        }
      }
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

  // ---- Nickname prompt ----
  // After catching a creature, we stash its uid here. The prompt opens the
  // moment the player exits the battle (so it doesn't compete with the catch
  // animation/results). Set to null to dismiss; otherwise renders a modal.
  const [pendingNicknameUid, setPendingNicknameUid] = useState(null);
  // Generic rename target for the menu's "Rename" button. Kept separate so
  // post-catch and menu rename can coexist if needed.
  const [renameUid, setRenameUid] = useState(null);
  // After catching while the team is full, the new creature is auto-deposited
  // in the vault and its uid is stashed here. After the battle ends (iris-out),
  // endBattle() copies it to vaultSwapUid which renders the modal.
  const [pendingVaultSwapUid, setPendingVaultSwapUid] = useState(null);
  // The actual modal trigger for the post-catch "swap or keep" prompt. Set by
  // endBattle from pendingVaultSwapUid so the prompt opens AFTER the iris
  // transition, not on top of the battle results screen.
  const [vaultSwapUid, setVaultSwapUid] = useState(null);
  // Which scene the vault was opened FROM ('world' if entered via Keeper Solenne,
  // 'menu' if entered via the Vault Sigil). Drives the close-button destination.
  const [vaultOrigin, setVaultOrigin] = useState('world');

  // ---- Auto-save indicator ----
  // Brief flash shown when performSave() is called, so the player has visual
  // confirmation their progress is being persisted. Cleared after ~1s.
  const [savingFlash, setSavingFlash] = useState(false);

  // ---- Sprint mode (run shoes) ----
  // When true, the per-step movement lock duration is halved, doubling the player's
  // effective walk speed. Toggled via the on-screen sprint button or the R key,
  // and held while the B button or Shift is pressed.
  const [sprinting, setSprinting] = useState(false);
  const sprintHeldRef = useRef(false);
  // Effective sprint = toggle OR holding the sprint key/button
  const isSprintActive = () => sprinting || sprintHeldRef.current;

  // ---- NPC wandering ----
  // Each NPC periodically takes a step within a 4x4 box around their authored
  // home position, picking from up/down/left/right. Movement is gated on:
  //   - target tile is walkable
  //   - target tile isn't where the player is
  //   - target tile isn't where another NPC currently is
  //   - target tile is within ±2 tiles of the NPC's authored position
  // npcMoveState[npcId] = { dx, dy, face } where dx/dy are offsets from the
  // authored position. The renderer adds these offsets to the authored x/y.
  // Player collision and interaction logic both look up the wandered position.
  const [npcMoveState, setNpcMoveState] = useState({});
  // Helper: returns the live position of an NPC (authored + wander offset).
  const npcLivePos = (n) => {
    const off = npcMoveState[n.id];
    return off ? { x: n.x + off.dx, y: n.y + off.dy, face: off.face } : { x: n.x, y: n.y, face: n.face };
  };

  // ---- Scene transition FX ----
  // Brief overlay animation played when we change scenes. Used for battle entry/
  // exit and (lightly) map transitions. The actual scene swap happens at the
  // midpoint of the animation so the player sees the new scene as the iris opens.
  // null = no transition, otherwise: { kind: 'irisIn' | 'irisOut' | 'fade', key: number }
  const [transitionFx, setTransitionFx] = useState(null);
  // Run an iris-close transition, swap scene at the midpoint, then iris-open.
  // `swap` is a callback that performs the actual scene change.
  const playSceneTransition = (kind, swap) => {
    if (kind === 'iris') {
      setTransitionFx({ kind: 'irisIn', key: Date.now() });
      // At ~340ms (slightly past the iris-close midpoint) the screen is fully black —
      // perform the actual scene swap, then start the iris-open phase.
      setTimeout(() => {
        swap();
        setTransitionFx({ kind: 'irisOut', key: Date.now() + 1 });
      }, 340);
      // Clear after both phases complete (~720ms total)
      setTimeout(() => setTransitionFx(null), 720);
    } else if (kind === 'fade') {
      setTransitionFx({ kind: 'fade', key: Date.now() });
      setTimeout(() => { swap(); }, 200);
      setTimeout(() => setTransitionFx(null), 400);
    } else {
      swap();
    }
  };
  const [loaded, setLoaded] = useState(false);
  const [hasSaveClassic, setHasSaveClassic] = useState(false);
  const [hasSaveCommander, setHasSaveCommander] = useState(false);
  const [storageBroken, setStorageBroken] = useState(false);
  const [storageDiag, setStorageDiag] = useState([]); // diagnostic lines from probe

  // ---- world state ----
  const [currentMap, setCurrentMap] = useState('town');
  const [player, setPlayer] = useState({ x: 7, y: 11, face: 'down' });
  const [team, setTeam] = useState([]);
  // The Hollow Vault — overflow storage for caught creatures beyond the 6-slot team.
  // Unbounded; persists across saves; never auto-prunes. Players deposit/withdraw via the
  // Vault Keeper NPC in town, or auto-deposit when catching while the team is full.
  const [vaultCreatures, setVaultCreatures] = useState([]);
  const [codex, setCodex] = useState({}); // { id: { caught: n, seen: n } }
  // Daily-encounter lock — { entryKey: realDayNumber } so each phantom variant can
  // appear at most once per real-world day. Persisted in saves so quitting and
  // returning the same day doesn't re-roll the chance. Cleared on new game.
  const [lastDailyEncounters, setLastDailyEncounters] = useState({});
  // Hidden-item found log — { 'mapId:x:y': realDayNumber }. Sparkles reappear the next day.
  const [hiddenItemsFound, setHiddenItemsFound] = useState({});
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

  // ---- New Plane System ----
  // currentPlane: which plane we're on (0 = original, 1+ = new planes after beating PW)
  // planeBaseLevel: level offset applied to all wild/boss encounters (0 for plane 0)
  // planeZoneOrder: shuffled array of zone keys for difficulty assignment (null = original)
  // planePending: signals endBattle to trigger a plane-shift transition sequence
  // planeDualPairs: 5-cycle color pairs for current plane's dual zones (null = plane 0)
  // dualMedallions: array of normalized pair keys for defeated dual zone wardens (e.g. 'GR')
  const [currentPlane, setCurrentPlane] = useState(0);
  const [planeBaseLevel, setPlaneBaseLevel] = useState(0);
  const [planeZoneOrder, setPlaneZoneOrder] = useState(null);
  const [planePending, setPlanePending] = useState(false);
  const [planeDualPairs, setPlaneDualPairs] = useState(null);
  const [dualMedallions, setDualMedallions] = useState([]);
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

  // ---- animation tick ----
  // Drives water shimmer, lava flicker, idle bobs, magic-circle pulse, ambient
  // zone particles. Increments at ~9fps while in the world scene; the canvas-
  // draw effect's deps include `animFrame` so the canvas redraws each tick.
  const [animFrame, setAnimFrame] = useState(0);
  useEffect(() => {
    if (scene !== 'world') return;
    const id = setInterval(() => setAnimFrame(f => (f + 1) % 1000), 110);
    return () => clearInterval(id);
  }, [scene]);

  // ---- Day/night cycle ----
  // A virtual day is 24 real-time minutes (1 minute = 1 hour). The hour is
  // computed from real time so it's consistent across saves and continues
  // even while in a menu. Tints the world canvas with a subtle color overlay
  // and shows a phase icon in the TopBar.
  const [hourOfDay, setHourOfDay] = useState(() => {
    const minutesSinceEpoch = Date.now() / 60000;
    return Math.floor(minutesSinceEpoch % 24);
  });
  useEffect(() => {
    const id = setInterval(() => {
      const minutesSinceEpoch = Date.now() / 60000;
      setHourOfDay(Math.floor(minutesSinceEpoch % 24));
    }, 5000);  // poll every 5s — hour changes every 60s anyway
    return () => clearInterval(id);
  }, []);

  // ---- Mini-map toggle ----
  const [miniMapOpen, setMiniMapOpen] = useState(false);

  // ---- NPC wandering tick ----
  // Every 700ms, each NPC has a chance to take a step. NPCs that are defeated
  // stay put (out of politeness — and so a beaten trainer doesn't chase you).
  // Specific NPCs that should stay anchored are excluded by id (board, shrine
  // attendants, shop). Each step is validated against walkability, the player
  // position, and other NPCs' wandered positions to avoid overlap.
  const STATIONARY_NPC_IDS = new Set(['board', 'merle', 'lorekeeper', 'guide', 'vaultkeeper']);
  const WANDER_RADIUS = 2;          // ±2 tiles from home = 4x4 box
  const STEP_CHANCE = 0.22;         // per-NPC chance per tick to attempt a step
  // Refs for player + defeated so the wander effect doesn't reset every step.
  const playerRef = useRef(player);
  const defeatedRef = useRef(defeated);
  useEffect(() => { playerRef.current = player; }, [player]);
  useEffect(() => { defeatedRef.current = defeated; }, [defeated]);
  useEffect(() => {
    if (scene !== 'world') return;
    // Reset wander state on map change so we always start at authored positions.
    setNpcMoveState({});
    const id = setInterval(() => {
      setNpcMoveState(prev => {
        const npcs = currentMap === 'town' ? NPCS_TOWN : (NPCS_ZONE[currentMap] || []);
        if (npcs.length === 0) return prev;
        const next = { ...prev };
        const livePlayer = playerRef.current;
        const liveDefeated = defeatedRef.current;
        // Build a set of tiles that are CURRENTLY occupied by NPCs (using the
        // new state we're building, so within-tick changes are reflected).
        const occupied = new Set();
        for (const n of npcs) {
          const off = next[n.id];
          const px = n.x + (off ? off.dx : 0);
          const py = n.y + (off ? off.dy : 0);
          occupied.add(`${px},${py}`);
        }
        for (const n of npcs) {
          if (STATIONARY_NPC_IDS.has(n.id)) continue;
          if (liveDefeated.includes(n.id)) continue;
          if (Math.random() > STEP_CHANCE) continue;
          // Pick a random direction; if blocked, just face that way (look around)
          const dirs = [
            { dx: 0, dy: -1, face: 'up'    },
            { dx: 0, dy:  1, face: 'down'  },
            { dx:-1, dy:  0, face: 'left'  },
            { dx: 1, dy:  0, face: 'right' },
          ];
          const dir = dirs[Math.floor(Math.random() * 4)];
          const cur = next[n.id] || { dx: 0, dy: 0, face: n.face };
          const newDx = cur.dx + dir.dx;
          const newDy = cur.dy + dir.dy;
          // Stay within wander radius
          if (Math.abs(newDx) > WANDER_RADIUS || Math.abs(newDy) > WANDER_RADIUS) {
            // Out of bounds — just turn to face that direction
            next[n.id] = { dx: cur.dx, dy: cur.dy, face: dir.face };
            continue;
          }
          const targetX = n.x + newDx;
          const targetY = n.y + newDy;
          // Tile must be walkable
          const t = tileAt(currentMap, targetX, targetY);
          if (!isWalkable(t)) {
            next[n.id] = { dx: cur.dx, dy: cur.dy, face: dir.face };
            continue;
          }
          // Tile mustn't be the player
          if (livePlayer.x === targetX && livePlayer.y === targetY) {
            next[n.id] = { dx: cur.dx, dy: cur.dy, face: dir.face };
            continue;
          }
          // Tile mustn't be another NPC's current position
          const targetKey = `${targetX},${targetY}`;
          if (occupied.has(targetKey)) {
            next[n.id] = { dx: cur.dx, dy: cur.dy, face: dir.face };
            continue;
          }
          // Don't step onto a *feature* encounter tile (lava/pool/vines/grass/flowers)
          // so NPCs don't end up cosmetically wading in lava or floating on water.
          // Ambient zone tiles (ash-ground, moss, cobble, shallow water) are fine —
          // those are just terrain and look natural to walk on.
          if (isFeatureTile(t)) {
            next[n.id] = { dx: cur.dx, dy: cur.dy, face: dir.face };
            continue;
          }
          // Free up the previous tile, take the new one
          const prevKey = `${n.x + cur.dx},${n.y + cur.dy}`;
          occupied.delete(prevKey);
          occupied.add(targetKey);
          next[n.id] = { dx: newDx, dy: newDy, face: dir.face };
        }
        return next;
      });
    }, 700);
    return () => clearInterval(id);
  }, [scene, currentMap]);

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
        // Check both save slots independently so each mode shows its own Continue button.
        try {
          const [sc, sk] = await Promise.all([
            loadGame('classic').catch(() => null),
            loadGame('commander').catch(() => null),
          ]);
          if (sc) setHasSaveClassic(true);
          if (sk) setHasSaveCommander(true);
        } catch (e) { /* no saves yet, fine */ }
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
    currentStateRef.current = { currentMap, player, team, vaultCreatures, codex, lastDailyEncounters, hiddenItemsFound, defeated, tokens, gold, items, mode, commanderColor, trainerCycles, medallions, planeswalkerDefeated, currentPlane, planeBaseLevel, planeZoneOrder, planeDualPairs, dualMedallions };
  }, [currentMap, player, team, vaultCreatures, codex, lastDailyEncounters, hiddenItemsFound, defeated, tokens, gold, items, mode, commanderColor, trainerCycles, medallions, planeswalkerDefeated, currentPlane, planeBaseLevel, planeZoneOrder, planeDualPairs, dualMedallions]);

  const performSave = async () => {
    const snap = currentStateRef.current;
    if (!snap) return false;
    // Flash the auto-save indicator briefly. We only flash on successful save
    // so a failed save (rate-limited, storage broken) doesn't lie to the user.
    const ok = await saveGame({ ...snap, scene: 'world' });
    if (ok) {
      setSavingFlash(true);
      setTimeout(() => setSavingFlash(false), 1100);
    }
    return ok;
  };

  // ---------- Start new / continue ----------
  const startNew = () => {
    audio.wake();
    setCurrentMap('town'); setPlayer({ x: 7, y: 11, face: 'down' });
    setTeam([]); setVaultCreatures([]); setCodex({}); setLastDailyEncounters({}); setDefeated([]); setTokens(5); setGold(60); setItems({ potion: 2 });
    setMode('classic'); setCommanderColor(""); setTrainerCycles(0);
    setMedallions([]); setPlaneswalkerDefeated(false); setChampionLearnPending(false);
    setCurrentPlane(0); setPlaneBaseLevel(0); setPlaneZoneOrder(null); setPlanePending(false);
    setPlaneDualPairs(null); setDualMedallions([]);
    // Mark tutorial pending — the effect above will fire once the player lands
    // in the world (after picking mode + starter).
    setTutorialPending(true);
    setScene('modeSelect');
  };
  const pickMode = (chosenMode) => {
    setMode(chosenMode);
    setScene('starter');
  };
  // ---- Tutorial trigger ----
  // True for fresh games; we trip a one-shot dialog cascade after the player
  // lands in the town for the first time. Cleared after the tutorial runs so
  // it doesn't pester the player on subsequent loads.
  const [tutorialPending, setTutorialPending] = useState(false);
  // Run the tutorial once `tutorialPending` flips true and we're in the world.
  useEffect(() => {
    if (!tutorialPending) return;
    if (scene !== 'world') return;
    // Brief delay so the player sees the town for a moment first.
    const id = setTimeout(() => {
      setDialog({
        lines: [
          "Welcome to Runesmith Hollow, planeswalker.",
          "Use the d-pad to walk. Press the ⚡ button (or R on keyboard) to sprint.",
          "Press A to talk to people, examine signs, or interact with the shrine in the center of town.",
          "Tall grass, lava, and other special tiles in the wilds may spawn wild creatures. Throw a Creature Card to bind them to your team.",
          "Tap the 🗺 icon (or M) to open the map. The Spellbook menu (B button) holds your team, codex, and items.",
          "Five trainers patrol the zones — defeat them to unlock their shrine bosses. Bring back five medallions and the central shrine will sing.",
        ],
        onDone: () => {
          setDialog(null);
          setTutorialPending(false);
        },
      });
    }, 600);
    return () => clearTimeout(id);
  }, [tutorialPending, scene]);

  const continueSave = async (saveMode) => {
    audio.wake();
    try {
      const s = await loadGame(saveMode);
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
      // Vault may not exist on older saves — default to empty so loading legacy runs is safe.
      setVaultCreatures(Array.isArray(s.vaultCreatures) ? s.vaultCreatures : []);
      setCodex(s.codex || {});
      // Older saves won't have this — default to {} so the daily lock starts fresh.
      setLastDailyEncounters(s.lastDailyEncounters || {});
      setHiddenItemsFound(s.hiddenItemsFound || {});
      setDefeated(s.defeated || []);
      setTokens(s.tokens ?? 5);
      setGold(s.gold ?? 0);
      setItems(s.items ?? { potion: 2 });
      setMode(s.mode || 'classic');
      setCommanderColor(s.commanderColor || "");
      setTrainerCycles(s.trainerCycles || 0);
      setMedallions(s.medallions || []);
      setPlaneswalkerDefeated(!!s.planeswalkerDefeated);
      setCurrentPlane(s.currentPlane || 0);
      setPlaneBaseLevel(s.planeBaseLevel || 0);
      setPlaneZoneOrder(s.planeZoneOrder || null);
      setPlaneDualPairs(s.planeDualPairs || null);
      setDualMedallions(s.dualMedallions || []);
      setPlanePending(false);
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
    // Sprint halves the step lock for 2x effective walk speed
    const lockDuration = isSprintActive() ? 60 : 120;
    setTimeout(() => { stepLock.current = false; }, lockDuration);

    setPlayer((pp) => {
      let nx = pp.x, ny = pp.y, face = dir;
      if (dir === 'up') ny--;
      if (dir === 'down') ny++;
      if (dir === 'left') nx--;
      if (dir === 'right') nx++;
      const t = tileAt(currentMap, nx, ny);
      if (!isWalkable(t)) return { ...pp, face };

      // Block on NPCs (using their wandered live position, not authored)
      const npcList = currentMap === 'town' ? NPCS_TOWN : (NPCS_ZONE[currentMap] || []);
      if (npcList.some(n => {
        const off = npcMoveState[n.id];
        const lx = n.x + (off ? off.dx : 0);
        const ly = n.y + (off ? off.dy : 0);
        return lx === nx && ly === ny;
      })) return { ...pp, face };

      // ---- X portal tile — dual zone entrance (Plane 1+ only) ----
      if (t === 'X') {
        if (!planeDualPairs || currentPlane === 0) {
          setTimeout(() => setDialog({
            lines: ['The portal shimmers faintly — a rift sealed in this plane. Perhaps in another...'],
            onDone: () => setDialog(null),
          }), 50);
          return { ...pp, face };
        }
        // Determine which of this zone's two portals was stepped on, then route to the right dual zone.
        const zoneColor = ZONE_COLOR[currentMap];
        if (!zoneColor) return { ...pp, face };
        const portals = ZONE_X_PORTALS[currentMap];
        const isXA = portals && (portals.xA.x === nx && portals.xA.y === ny);
        // Find the cycle pair where this zone is first (xA) or second (xB)
        const pair = isXA
          ? planeDualPairs.find(([a]) => a === zoneColor)   // zone is first
          : planeDualPairs.find(([, b]) => b === zoneColor); // zone is second
        if (!pair) return { ...pp, face };
        const dualMapId = 'dual_' + pair[0] + pair[1];
        if (!MAPS[dualMapId]) return { ...pp, face };
        const dualH = MAPS[dualMapId].tiles.length;
        // Entering as A-side → spawn near BOTTOM of dual zone (walk north toward boss)
        // Entering as B-side → spawn near TOP of dual zone (walk south toward boss)
        const spawnY = isXA ? dualH - 2 : 1;
        const spawnFace = isXA ? 'up' : 'down';
        setCurrentMap(dualMapId);
        if (!isRateLimited()) setTimeout(() => performSave(), 250);
        return { x: 5, y: spawnY, face: spawnFace };
      }

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
          : (() => {
              const scaledLv = getScaledBossLevel(currentMap, planeBaseLevel, planeZoneOrder);
              const suffix = currentPlane > 0 ? ` (Lv. ${scaledLv} — Plane ${currentPlane})` : '';
              return shrineData.dialog + suffix;
            })();
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

      // ---- Legendary boss tile ('L') — inside a shrine OR a dual zone ----
      if (t === 'L') {
        // Dual zone boss
        if (isDualZoneMap(currentMap)) {
          const [cA, cB] = pairFromDualId(currentMap);
          const pk = normPair(cA, cB);
          if (dualMedallions.includes(pk)) return { x: nx, y: ny, face }; // already beaten, walk through
          // Gate: all current plane's dual trainers must be defeated first
          if (planeDualPairs) {
            const currentDualIds = planeDualPairs.map(([a,b]) => `dual_trainer_${normPair(a,b)}`);
            const gateOpen = currentDualIds.every(id => defeated.includes(id));
            if (!gateOpen) {
              setTimeout(() => setDialog({
                lines: [`The ${GUILD_NAMES[pk]||pk} warden stirs... but waits. Defeat all five rift guardians first.`],
                onDone: () => setDialog(null),
              }), 100);
              return { x: nx, y: ny, face };
            }
          }
          setTimeout(() => triggerDualBossLegendary(currentMap), 100);
          return { x: nx, y: ny, face };
        }
        // Mono shrine boss (original logic)
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
        // From town — use the current plane's exit→zone mapping so zones physically
        // rearrange each plane (south isn't always wilds, east isn't always ashen, etc.)
        if (currentMap === 'town') {
          const exitZone = getExitZoneMap(planeZoneOrder);
          let targetZone = null;
          if      (ny >= mh - 1) targetZone = nx <= 3 ? exitZone.south_west : exitZone.south_center;
          else if (ny <= 0)      targetZone = exitZone.north;
          else if (nx >= mw - 1) targetZone = exitZone.east;
          else if (nx <= 0)      targetZone = exitZone.west;
          if (targetZone) {
            const zt = MAPS[targetZone].tiles;
            const spawn = ZONE_SPAWN_POS[targetZone](zt[0].length, zt.length);
            setCurrentMap(targetZone); saveAfterTransition();
            return spawn;
          }
        }
        // From any zone back to town — find which slot this zone occupies and
        // return to the matching town-side position so the player exits cleanly.
        if (ALL_ZONE_KEYS.includes(currentMap)) {
          const slot = getZoneExitSlot(currentMap, planeZoneOrder);
          const returnPos = (slot && EXIT_TOWN_RETURN[slot]) || EXIT_TOWN_RETURN.south_center;
          setCurrentMap('town'); saveAfterTransition();
          return returnPos;
        }
        // From a dual zone — top 'E' (ny<=0) → colorA's mono zone; bottom 'E' → colorB's.
        if (isDualZoneMap(currentMap)) {
          const [cA, cB] = pairFromDualId(currentMap);
          const targetColor = ny <= 0 ? cA : cB;
          const targetZone = COLOR_TO_ZONE[targetColor];
          if (targetZone) {
            // Spawn near the X portal that connects to this dual zone on the target zone's side.
            const portals = ZONE_X_PORTALS[targetZone];
            const isAside = targetColor === cA;  // top exit → going to A-side zone
            const portal = isAside ? portals?.xA : portals?.xB;
            const sx = portal ? portal.x : 7;
            const sy = portal ? Math.max(1, portal.y + (isAside ? 1 : -1)) : 7;
            setCurrentMap(targetZone); saveAfterTransition();
            return { x: sx, y: sy, face: isAside ? 'down' : 'up' };
          }
        }
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
        // Capture the encounter tile so the battle scene can theme its backdrop.
        const encTile = t;
        setTimeout(() => triggerWildEncounter(encTile), 100);
      }
      // Soft step click — quiet enough not to fatigue, alternates pitch via the closure inside audio.
      audio.sfx.step();
      return { x: nx, y: ny, face };
    });
  }, [scene, currentMap, trainerCycles, medallions, npcMoveState, planeZoneOrder, planeDualPairs, currentPlane, dualMedallions, defeated]);

  // ---------- Hidden item pickup ----------
  // Declared before `interact` so the callback is initialized when interact references it.
  const checkHiddenItem = useCallback((checkX, checkY) => {
    const today = realDayNumber();
    const hit = HIDDEN_ITEMS.find(hi =>
      hi.map === currentMap && hi.x === checkX && hi.y === checkY &&
      hiddenItemsFound[hiddenItemKey(hi)] !== today
    );
    if (!hit) return false;
    setHiddenItemsFound(prev => ({ ...prev, [hiddenItemKey(hit)]: today }));
    if (hit.loot === 'gold') {
      const amt = hit.amount || 20;
      setGold(g => g + amt);
      audio.sfx.confirm();
      showToast(`✦ Found ${amt} gold!`);
    } else if (hit.loot === 'card') {
      setTokens(t => t + 1);
      audio.sfx.confirm();
      showToast('✦ Found a Creature Card!');
    } else {
      setItems(it => ({ ...it, [hit.loot]: (it[hit.loot] || 0) + 1 }));
      audio.sfx.heal();
      const itName = ITEMS[hit.loot]?.name || hit.loot;
      showToast(`✦ Found a ${itName}!`);
    }
    return true;
  }, [currentMap, hiddenItemsFound]);

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

    // Hidden item check — facing tile first, then standing tile.
    // Returns true if an item was found so we don't fall through to NPC/shrine logic.
    if (checkHiddenItem(tx, ty) || checkHiddenItem(p.x, p.y)) return;

    // Shrine — heals normally, but if the player has all medallions (5 mono + 5 dual in Plane 1+),
    // becomes the gateway to The Planeswalker (the final boss).
    if (t === 's') {
      const allMonoMedallions = ['W','U','B','R','G'].every(c => medallions.includes(c));
      const allDualMedallions = !planeDualPairs || planeDualPairs.every(([a,b]) => dualMedallions.includes(normPair(a,b)));
      const allMedallions = allMonoMedallions && allDualMedallions;
      if (allMedallions && !planeswalkerDefeated) {
        // Heal first — interacting with the shrine should always restore your
        // team, even on the run-up to the Planeswalker fight (otherwise the
        // player can't recover after losing the boss without leaving and
        // returning, which is bad UX).
        setTeam((tm) => tm.map(c => ({ ...c, hp: c.maxHp, status: null })));
        audio.sfx.heal();
        // Then show the boss prompt; Continue starts the fight.
        setDialog({
          lines: [
            "The shrine pulses with light — your team is restored to full strength.",
            currentPlane > 0
              ? "Ten medallions — five shrines, five rifts — all answered. The shrine erupts in planar fire."
              : "Five medallions, five wakings. The shrine flares to life beneath your fingertips.",
            currentPlane > 0
              ? `A figure crystallizes — more powerful than before. Eyes burning with planar fury.`
              : `A figure crystallizes at the heart of the light — eyes burning with all five colors.`,
            currentPlane > 0
              ? `"You found me again, walker. I've been growing stronger." — Level ${getPlaneswalkerLevel(currentPlane)} Planeswalker awakens.`
              : `"You've gathered the magic. Now spend it." — The Planeswalker draws its spark.`,
          ],
          onDone: () => { setDialog(null); startPlaneswalkerBattle(); },
        });
        return;
      }
      if (allMedallions && planeswalkerDefeated) {
        // Champion shrine — always heals. On Plane 0, also offer the warp for
        // players who beat the game before the new plane system existed.
        setTeam((tm) => tm.map(c => ({ ...c, hp: c.maxHp, status: null })));
        audio.sfx.heal();
        if (currentPlane === 0) {
          setDialog({
            lines: [
              "The shrine hums with recognition. Your team is restored.",
              "The Planeswalker's torn essence lingers here — a rift bleeds through the stone.",
              "You sense a doorway to a harder plane. Creatures you've never seen. Power you haven't tasted.",
              `The Shattered Rift (Plane 1) awaits — base level ${getPlaneswalkerLevel(0) + 2}, new Planeswalker at Lv. ${getPlaneswalkerLevel(1)}.`,
              "Will you step through? Your team, vault, gold and items carry over.",
            ],
            choices: [
              {
                label: '✦ Step through the rift — enter Plane 1',
                action: () => {
                  setDialog(null);
                  const { nextPlane, newPlaneName, easyZone, hardZone, defeatedPWLevel } = doPlaneShift(0);
                  setTimeout(() => setDialog({
                    lines: [
                      `The shrine shatters outward in five colors.`,
                      `You are pulled through — into ${newPlaneName}.`,
                      `${easyZone} stirs with level ${defeatedPWLevel + 2}–${defeatedPWLevel + 6} creatures. ${hardZone} holds things far worse.`,
                      `The medallion bearers have been reset. A new Planeswalker waits at level ${getPlaneswalkerLevel(nextPlane)}.`,
                    ],
                    onDone: () => setDialog(null),
                  }), 300);
                },
              },
              {
                label: '✓ Stay — remain in this plane',
                action: () => {
                  setDialog(null);
                  showToast('The shrine hums in recognition. Your team is restored.');
                },
              },
            ],
          });
        } else {
          showToast('The shrine hums in recognition. Your team is restored.');
        }
        return;
      }
      setTeam((tm) => tm.map(c => ({ ...c, hp: c.maxHp, status: null })));
      audio.sfx.heal();
      const monoCount = medallions.length;
      const dualCount = dualMedallions.length;
      const dualTotal = planeDualPairs ? planeDualPairs.length : 0;
      if (currentPlane > 0) {
        showToast(`Shrine heals your team. Medallions: ${monoCount}/5 mono, ${dualCount}/${dualTotal} rift.`);
      } else {
        showToast(monoCount > 0 ? `Shrine heals your team. ${monoCount}/5 medallions collected.` : 'The shrine restores your team.');
      }
      return;
    }

    // NPC interaction (town or zone) — match against the wandered live position.
    const npcList = currentMap === 'town' ? NPCS_TOWN : (NPCS_ZONE[currentMap] || []);
    const n = npcList.find(n => {
      const off = npcMoveState[n.id];
      const lx = n.x + (off ? off.dx : 0);
      const ly = n.y + (off ? off.dy : 0);
      return lx === tx && ly === ty;
    });
    if (n) {
      if (n.isShop) {
        setDialog({
          lines: [`${n.name}: "${n.dialog}"`],
          onDone: () => { setDialog(null); setScene('shop'); }
        });
      } else if (n.isVault) {
        setDialog({
          lines: [`${n.name}: "${n.dialog}"`],
          onDone: () => { setDialog(null); setVaultOrigin('world'); setScene('vault'); }
        });
      } else if (n.noBattle) {
        // Special case: the Old Wanderer tells you which direction leads where —
        // dynamically generated so it's accurate after zone rearrangement.
        let npcLines;
        if (n.id === 'guide') {
          const ezMap = getExitZoneMap(planeZoneOrder);
          const slotLabel = { south_center: 'South', south_west: 'Southwest', north: 'North', east: 'East', west: 'West' };
          const zoneDesc = {
            wilds:   'the Mana Wilds — soft-spoken and green',
            ashen:   'the Ashen Wastes — all teeth and embers',
            sanctum: 'the Sunken Sanctum — where the deep keeps its secrets',
            umbral:  'the Umbral Grove — where shadows have weight',
            plains:  'the Plains of Light — beautiful, and merciless',
          };
          const dirs = EXIT_SLOT_ORDER.map(slot =>
            `${slotLabel[slot]}: ${zoneDesc[ezMap[slot]] || ezMap[slot]}`
          ).join('. ');
          npcLines = [`${n.name}: "Five planes touch this hollow. ${dirs}. Each breeds its own color — bring what the wheel favors. The shrine restores any creature you've bound."`];
        } else {
          npcLines = [`${n.name}: "${n.dialog}"`];
        }
        setDialog({ lines: npcLines, onDone: () => setDialog(null) });
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
  }, [scene, player, currentMap, defeated, medallions, planeswalkerDefeated, npcMoveState, checkHiddenItem, planeZoneOrder, currentPlane]);

  // Hidden item pickup helper — checks both the facing tile and standing tile.
  // Called from the interact callback above and extracted so it can also run on tile-step
  // (we don't auto-pick on step; player always presses A intentionally).
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

  const triggerWildEncounter = (encTile = null) => {
    const tm = teamRef.current;
    if (tm.length === 0 || firstAlive(tm) < 0) return;
    // Reset once-per-battle held items so Potion Vial recharges each fight.
    const freshTm = tm.map(c => c.heldItemCharged ? { ...c, heldItemCharged: false } : c);
    if (freshTm !== tm) setTeam(freshTm);
    // Dual zone maps use a blended pool from both colors; level is above the harder mono zone.
    let pool, scaledLo, scaledHi;
    if (isDualZoneMap(currentMap) && planeDualPairs) {
      const [cA, cB] = pairFromDualId(currentMap);
      pool = buildDualZonePool(cA, cB);
      const tierA = getZoneTier(COLOR_TO_ZONE[cA], planeZoneOrder);
      const tierB = getZoneTier(COLOR_TO_ZONE[cB], planeZoneOrder);
      const harderTier = Math.max(tierA, tierB);
      const harderRange = getScaledZoneRange(COLOR_TO_ZONE[cA] || 'wilds', planeBaseLevel, planeZoneOrder);
      const hardestRange = getScaledZoneRange(COLOR_TO_ZONE[cB] || 'plains', planeBaseLevel, planeZoneOrder);
      const baseRange = PLANE_DIFFICULTY_SLOTS[harderTier];
      scaledLo = baseRange.levelLo + planeBaseLevel;
      scaledHi = baseRange.levelHi + planeBaseLevel;
    } else {
      pool = ZONE_POOLS[currentMap] || ZONE_POOLS.wilds;
      [scaledLo, scaledHi] = getScaledZoneRange(currentMap, planeBaseLevel, planeZoneOrder);
    }
    const pick = weightedPick(pool);
    const lv = scaledLo + Math.floor(Math.random() * (scaledHi - scaledLo + 1));

    // ---- Daily-encounter check ----
    // If a daily creature is eligible (right zone, right hour, hasn't appeared
    // today) and the small chance succeeds, replace this wild pick with the
    // phantom variant. The encounter log gets a flavor lore line so the player
    // knows something special is happening, and we lock the entry for the rest
    // of the real-world day.
    let enemy;
    let dailyEntry = null;
    const eligible = findEligibleDaily(currentMap, hourOfDay, lastDailyEncounters);
    if (eligible && Math.random() < DAILY_SPAWN_CHANCE) {
      dailyEntry = eligible;
      enemy = createDailyVariant(eligible, lv);
      // Lock for the rest of today regardless of catch outcome — the spawn
      // itself is the event. Using realDayNumber() so the lock survives saves.
      setLastDailyEncounters(prev => ({ ...prev, [eligible.key]: realDayNumber() }));
    } else {
      enemy = createCreature(pick.id, lv);
    }
    setCodex((cx) => ({ ...cx, [enemy.id]: { caught: cx[enemy.id]?.caught || 0, seen: (cx[enemy.id]?.seen || 0) + 1 }}));
    // Roll weather ONCE at battle start (20% single, 4% double). Result stored
    // on the battle object so badge / damage calc / tick / log all agree.
    const ws = rollWeathersForZone(currentMap, 'wild');
    const initLog = [];
    if (ws.length === 2) {
      // Stacked weather is rare and dramatic — give it its own intro line.
      initLog.push(`The ${WEATHER[ws[0]].name.toLowerCase()} and ${WEATHER[ws[1]].name.toLowerCase()} converge!`);
    } else if (ws.length === 1) {
      initLog.push(`The ${WEATHER[ws[0]].name.toLowerCase()} sweeps the field.`);
    }
    if (dailyEntry) {
      // Lead with lore for the rare encounter — then the standard "appeared!" line.
      initLog.push(dailyEntry.lore);
      initLog.push(`A ${displayName(enemy)} emerges!`);
      // Cue the catch-success jingle (lighter, mystical) to tip off "this is special".
      // Cheaper than authoring a new SFX and the player will recognize the rarity.
      setTimeout(() => audio.sfx.medallion(primaryColor(enemy.c)), 300);
    } else {
      initLog.push(`A wild ${displayName(enemy)} appeared!`);
    }
    setBattle({
      kind: 'wild',
      enemyTeam: [enemy],
      enemyIdx: 0,
      myIdx: firstAlive(tm),
      log: initLog,
      turn: 'player',
      intro: true,
      bgZone: currentMap,
      bgTile: encTile,
      weathers: ws,
    });
    playSceneTransition('iris', () => setScene('battle'));
    // Wild battle entrance jingle (~700ms) — plays solo while music is suppressed by the intro flag.
    audio.sfx.battleStart('wild');
    // After ~1s, drop the intro flag so move buttons activate AND battle music fades in.
    setTimeout(() => {
      setBattle(b => b ? { ...b, intro: false } : b);
    }, 1000);
  };

  const startTrainerBattle = (npc) => {
    const tm = teamRef.current;
    // Reset once-per-battle held items so Potion Vial recharges each fight.
    const freshTm = tm.map(c => c.heldItemCharged ? { ...c, heldItemCharged: false } : c);
    if (freshTm !== tm) setTeam(freshTm);
    // Zone trainers get a fresh team each fight (rerolled from zone pool, scaled by cycles).
    // Dual zone trainers get a team from generateDualTrainerTeam (scaled to harder mono zone + plane).
    // Town trainers (Bran/Ria/Dax) keep their fixed teams as a stable starter benchmark.
    const teamSpec = DUAL_TRAINER_IDS.has(npc.id)
      ? generateDualTrainerTeam(npc, planeDualPairs, planeBaseLevel, planeZoneOrder)
      : ZONE_TRAINER_IDS.has(npc.id)
        ? generateTrainerTeam(npc, trainerCycles)
        : npc.team;
    const et = teamSpec.map(c => createCreature(c.id, c.lv));
    et.forEach(e => {
      setCodex((cx) => ({ ...cx, [e.id]: { caught: cx[e.id]?.caught || 0, seen: (cx[e.id]?.seen || 0) + 1 }}));
    });
    const ws_t = rollWeathersForZone(currentMap, 'trainer');
    const initLog_t = [];
    if (ws_t.length === 2) {
      initLog_t.push(`The ${WEATHER[ws_t[0]].name.toLowerCase()} and ${WEATHER[ws_t[1]].name.toLowerCase()} converge!`);
    } else if (ws_t.length === 1) {
      initLog_t.push(`The ${WEATHER[ws_t[0]].name.toLowerCase()} sweeps the field.`);
    }
    initLog_t.push(`${npc.name} wants to duel!`);
    initLog_t.push(`${npc.name} sends out ${et[0].name}!`);
    setBattle({
      kind: 'trainer',
      npc,
      enemyTeam: et,
      enemyIdx: 0,
      myIdx: Math.max(0, firstAlive(tm)),
      log: initLog_t,
      turn: 'player',
      intro: true,
      bgZone: currentMap,
      weathers: ws_t,
    });
    playSceneTransition('iris', () => setScene('battle'));
    // Trainer entrance jingle (~1100ms) — slightly longer/more dramatic than wild.
    audio.sfx.battleStart('trainer');
    // Hold the intro a bit longer than wild so the trainer fanfare plays out before music.
    setTimeout(() => {
      setBattle(b => b ? { ...b, intro: false } : b);
    }, 1300);
  };

  // ---------- Phone rematch — like trainer battle but uses trainer's home zone for weather
  // and scales up by one extra cycle so it's always harder than the current cycle. ----------
  const startPhoneRematch = (npc) => {
    const tm = teamRef.current;
    // Reset once-per-battle held items
    const freshTm = tm.map(c => c.heldItemCharged ? { ...c, heldItemCharged: false } : c);
    if (freshTm !== tm) setTeam(freshTm);
    // Always one cycle ahead of the current progression so the rematch is never trivial
    const rematchCycles = trainerCycles + 1;
    let teamSpec;
    if (ZONE_TRAINER_IDS.has(npc.id)) {
      // Zone trainers — reroll a fresh 3-creature team from the zone pool, scaled up.
      teamSpec = generateTrainerTeam(npc, rematchCycles);
    } else if (TOWN_TRAINER_IDS.has(npc.id)) {
      // Town trainers — keep their original line-up (it's their identity), but apply
      // the cycle level boost so the rematch isn't trivial late-game.
      const levelBoost = rematchCycles * 2;
      teamSpec = (npc.team || []).map(c => ({ id: c.id, lv: c.lv + levelBoost }));
    } else {
      teamSpec = npc.team || [];
    }
    const et = teamSpec.map(c => createCreature(c.id, c.lv));
    et.forEach(e => {
      setCodex(cx => ({ ...cx, [e.id]: { caught: cx[e.id]?.caught || 0, seen: (cx[e.id]?.seen || 0) + 1 }}));
    });
    // Town trainers' "home zone" is the town itself — fall back to its weather pool.
    const zoneId = TRAINER_ZONE[npc.id] || (TOWN_TRAINER_IDS.has(npc.id) ? 'town' : 'wilds');
    const ws = rollWeathersForZone(zoneId, 'trainer');
    const initLog = [];
    if (ws.length === 2) {
      initLog.push(`The ${WEATHER[ws[0]].name.toLowerCase()} and ${WEATHER[ws[1]].name.toLowerCase()} converge on the line!`);
    } else if (ws.length === 1) {
      initLog.push(`The ${WEATHER[ws[0]].name.toLowerCase()} rolls in from ${MAPS[zoneId]?.name || zoneId}.`);
    }
    initLog.push(`${npc.name} answers the call — battle-ready!`);
    initLog.push(`${npc.name} sends out ${et[0].name}!`);
    setBattle({
      kind: 'trainer',
      npc,
      enemyTeam: et,
      enemyIdx: 0,
      myIdx: Math.max(0, firstAlive(tm)),
      log: initLog,
      turn: 'player',
      intro: true,
      bgZone: zoneId,
      weathers: ws,
    });
    playSceneTransition('iris', () => setScene('battle'));
    audio.sfx.battleStart('trainer');
    setTimeout(() => { setBattle(b => b ? { ...b, intro: false } : b); }, 1300);
  };

  // ---------- Dual zone trainer team generation ----------
  function generateDualTrainerTeam(npc, planeDualPairsRef, planeBaseLevelRef, planeZoneOrderRef) {
    const pairKey = npc.id.replace('dual_trainer_', ''); // e.g. 'GR'
    const [cA, cB] = [pairKey[0], pairKey[1]];
    const zoneA = COLOR_TO_ZONE[cA], zoneB = COLOR_TO_ZONE[cB];
    const tierA = getZoneTier(zoneA, planeZoneOrderRef);
    const tierB = getZoneTier(zoneB, planeZoneOrderRef);
    const harderTier = Math.max(tierA, tierB);
    const harderBossLevel = PLANE_DIFFICULTY_SLOTS[harderTier].shrineLevel + planeBaseLevelRef;
    const trainerBaseLv = harderBossLevel - 4;
    const pool = buildDualZonePool(cA, cB);
    const picks = []; const usedIds = new Set();
    for (let attempt = 0; attempt < 30 && picks.length < 3; attempt++) {
      const e = weightedPick(pool);
      if (!e || usedIds.has(e.id)) continue;
      usedIds.add(e.id);
      picks.push({ id: e.id, lv: trainerBaseLv + picks.length });
    }
    if (picks.length < 3 && npc.team) {
      return npc.team.map(c => ({ id: c.id, lv: c.lv + planeBaseLevelRef }));
    }
    return picks;
  }

  // ---------- Dual zone boss battle ----------
  const triggerDualBossLegendary = (dualMapId) => {
    const [cA, cB] = pairFromDualId(dualMapId);
    const bossId = getDualBossId(cA, cB);
    if (!bossId) return;
    const tierA = getZoneTier(COLOR_TO_ZONE[cA], planeZoneOrder);
    const tierB = getZoneTier(COLOR_TO_ZONE[cB], planeZoneOrder);
    const harderTier = Math.max(tierA, tierB);
    const harderBossLv = PLANE_DIFFICULTY_SLOTS[harderTier].shrineLevel + planeBaseLevel;
    const dualBossLv = harderBossLv + 4; // slightly above the harder mono boss
    const tm = teamRef.current;
    const boss = createCreature(bossId, dualBossLv);
    setCodex(cx => ({...cx, [bossId]: {caught: cx[bossId]?.caught||0, seen: (cx[bossId]?.seen||0)+1}}));
    const ws = rollWeathersForZone(currentMap, 'legendary');
    const initLog = [];
    if (ws.length === 2) initLog.push(`The ${WEATHER[ws[0]].name.toLowerCase()} and ${WEATHER[ws[1]].name.toLowerCase()} converge in the rift!`);
    else if (ws.length === 1) initLog.push(`The ${WEATHER[ws[0]].name.toLowerCase()} surges through the rift.`);
    const guildName = GUILD_NAMES[normPair(cA,cB)] || (cA+cB);
    initLog.push(`The ${guildName} warden rises from the rift energy!`);
    initLog.push(`${boss.name} will not yield this plane to you.`);
    setBattle({
      kind: 'legendary',
      zoneId: dualMapId,
      shrineColor: normPair(cA, cB), // normalized pair key acts as the "color" for reward logic
      isDualBoss: true,
      enemyTeam: [boss],
      enemyIdx: 0,
      myIdx: Math.max(0, firstAlive(tm)),
      log: initLog,
      turn: 'player',
      intro: true,
      bossKind: 'dual_legendary',
      bgZone: currentMap,
      weathers: ws,
    });
    playSceneTransition('iris', () => setScene('battle'));
    audio.sfx.bossEntrance();
    setTimeout(() => { setBattle(b => b ? {...b, intro: false} : b); }, 1200);
  };

  // ---------- Legendary boss battle (single mono-color creature, awards a medallion on win) ----------
  const triggerLegendaryBattle = (zoneId) => {
    const sd = SHRINE_DATA[zoneId];
    if (!sd) return;
    const tm = teamRef.current;
    // Scale boss level by current plane
    const scaledBossLv = getScaledBossLevel(zoneId, planeBaseLevel, planeZoneOrder);
    const boss = createCreature(sd.bossId, scaledBossLv);
    setCodex((cx) => ({ ...cx, [boss.id]: { caught: cx[boss.id]?.caught || 0, seen: (cx[boss.id]?.seen || 0) + 1 }}));
    const ws_lg = rollWeathersForZone(currentMap, 'legendary');
    const initLog_lg = [];
    if (ws_lg.length === 2) {
      initLog_lg.push(`The ${WEATHER[ws_lg[0]].name.toLowerCase()} and ${WEATHER[ws_lg[1]].name.toLowerCase()} converge!`);
    } else if (ws_lg.length === 1) {
      initLog_lg.push(`The ${WEATHER[ws_lg[0]].name.toLowerCase()} sweeps the field.`);
    }
    initLog_lg.push(`${boss.name} stirs from its long sleep!`);
    initLog_lg.push(`Its eyes lock on you — there's no walking away from this.`);
    setBattle({
      kind: 'legendary',
      zoneId,
      shrineColor: sd.color,
      enemyTeam: [boss],
      enemyIdx: 0,
      myIdx: Math.max(0, firstAlive(tm)),
      log: initLog_lg,
      turn: 'player',
      intro: true,
      bossKind: 'legendary',
      bgZone: currentMap,
      weathers: ws_lg,
    });
    playSceneTransition('iris', () => setScene('battle'));
    audio.sfx.bossEntrance();
    setTimeout(() => {
      setBattle(b => b ? { ...b, intro: false } : b);
    }, 1200);
  };

  // ---------- Final boss: The Planeswalker (WUBRG) ----------
  const startPlaneswalkerBattle = () => {
    const tm = teamRef.current;
    // Planeswalker scales with each plane: level 32 on plane 0, +30 per plane.
    const pwLevel = getPlaneswalkerLevel(currentPlane);
    const boss = createCreature('the_planeswalker', pwLevel);
    setCodex((cx) => ({ ...cx, [boss.id]: { caught: cx[boss.id]?.caught || 0, seen: (cx[boss.id]?.seen || 0) + 1 }}));
    const planeName = getPlaneName(currentPlane);
    setBattle({
      kind: 'planeswalker',
      enemyTeam: [boss],
      enemyIdx: 0,
      myIdx: Math.max(0, firstAlive(tm)),
      log: [
        `THE PLANESWALKER manifests in a halo of five colors!`,
        `Reality buckles — a Planar Storm engulfs ${planeName}!`,
        currentPlane === 0
          ? `"Show me the magic you've gathered."`
          : `"You found me again. I won't hold back this time."`,
      ],
      turn: 'player',
      intro: true,
      bossKind: 'planeswalker',
      bgZone: currentMap,
      weathers: ['planar'],
    });
    playSceneTransition('iris', () => setScene('battle'));
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
      const fx = { kind: 'heal', color: move.c || 'W', side, key: Date.now() + Math.random() };
      return { newTeam, newEnemyTeam, lines, fx };
    }

    // Cue the spell-color flavor as soon as the move is resolved.
    audio.sfx.attack(move.c);
    const wKeys = weathersForBattle(b);
    const res = calcDamage(attacker, defender, move, wKeys);
    if (res.missed) {
      lines.push('It missed!');
      audio.sfx.miss();
      const fx = { kind: 'miss', color: move.c || 'W', side, key: Date.now() + Math.random() };
      return { newTeam, newEnemyTeam, lines, fx };
    }
    const hurt = { ...defender, hp: Math.max(0, defender.hp - res.dmg) };
    if (side === 'player') newEnemyTeam[b.enemyIdx] = hurt;
    else newTeam[b.myIdx] = hurt;
    // Potion Vial: once-per-battle auto-heal when HP drops below 25% threshold.
    // Only triggers if the creature is still alive and hasn't used the vial yet.
    if (hurt.hp > 0 && hurt.heldItem === 'potion_vial' && !hurt.heldItemCharged &&
        hurt.hp / hurt.maxHp < ITEMS.potion_vial.threshold) {
      const vialHeal = Math.max(1, Math.floor(hurt.maxHp * ITEMS.potion_vial.amount));
      const vialHealed = { ...hurt, hp: Math.min(hurt.maxHp, hurt.hp + vialHeal), heldItemCharged: true };
      if (side === 'player') newEnemyTeam[b.enemyIdx] = vialHealed;
      else newTeam[b.myIdx] = vialHealed;
      lines.push(`${hurt.name}'s Potion Vial crackles! Restored ${vialHeal} HP.`);
      audio.sfx.heal();
    }
    // Layer the impact stinger; crits and super-effectives get a louder one.
    if (res.crit) audio.sfx.crit();
    else audio.sfx.hit();
    if (res.mult > 1) { lines.push("It's devastatingly effective!"); audio.sfx.superEffective(); }
    else if (res.mult < 1) { lines.push('It barely lands.'); audio.sfx.notVeryEffective(); }
    if (res.crit) lines.push('A critical hit!');
    // Surface weather-specific flavor — name the actual weather that boosted or
    // weakened (handles the stacked case where one boosts and another weakens).
    for (const k of res.boostedBy) {
      lines.push(`The ${WEATHER[k].name.toLowerCase()} amplifies the spell!`);
    }
    for (const k of res.weakenedBy) {
      lines.push(`The ${WEATHER[k].name.toLowerCase()} dampens the spell.`);
    }
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
    const fx = {
      kind: res.crit ? 'crit' : (res.mult > 1 ? 'super' : (res.mult < 1 ? 'weak' : 'hit')),
      color: move.c || 'W',
      side,
      dmg: res.dmg,
      key: Date.now() + Math.random(),
    };
    return { newTeam, newEnemyTeam, lines, fx };
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
      let updated = newCreature;
      // Weather tick — applies to the creature that just acted, once per turn.
      // With stacked weather, each active weather gets its own tick (e.g. Bloom
      // heals while Sandstorm chips — both fire and the log shows both).
      // Skipped if status tick already KO'd the creature, and stops mid-loop
      // if a weather KO's it (no point ticking the next weather on a corpse).
      for (const wKey of weathersForBattle(b)) {
        if (updated.hp <= 0) break;
        const { creature: w2, lines: wLines } = applyWeatherTick(updated, wKey);
        if (wLines.length > 0) lines.push(...wLines);
        updated = w2;
      }
      // Lifeweb Moss: end-of-turn regen for player side (alive + below max HP)
      if (updated.hp > 0 && updated.hp < updated.maxHp && updated.heldItem === 'lifeweb_moss') {
        const regen = Math.max(1, Math.floor(updated.maxHp * ITEMS.lifeweb_moss.amount));
        updated = { ...updated, hp: Math.min(updated.maxHp, updated.hp + regen) };
        lines.push(`${updated.name}'s Lifeweb Moss restored ${regen} HP.`);
      }
      if (updated !== actor) {
        t = [...t]; t[b.myIdx] = updated;
      }
    } else {
      const actor = b.enemyTeam[b.enemyIdx];
      const { newCreature, lines: tickLines } = tickStatusEnd(actor);
      if (tickLines.length > 0) lines.push(...tickLines);
      let updated = newCreature;
      for (const wKey of weathersForBattle(b)) {
        if (updated.hp <= 0) break;
        const { creature: w2, lines: wLines } = applyWeatherTick(updated, wKey);
        if (wLines.length > 0) lines.push(...wLines);
        updated = w2;
      }
      // Lifeweb Moss: end-of-turn regen for enemy side
      if (updated.hp > 0 && updated.hp < updated.maxHp && updated.heldItem === 'lifeweb_moss') {
        const regen = Math.max(1, Math.floor(updated.maxHp * ITEMS.lifeweb_moss.amount));
        updated = { ...updated, hp: Math.min(updated.maxHp, updated.hp + regen) };
        lines.push(`${updated.name}'s Lifeweb Moss restored ${regen} HP.`);
      }
      if (updated !== actor) {
        const newEnemyTeam = [...b.enemyTeam]; newEnemyTeam[b.enemyIdx] = updated;
        b = { ...b, enemyTeam: newEnemyTeam };
      }
    }
    b = { ...b, log: lines };
    const enemy = b.enemyTeam[b.enemyIdx];
    const me = t[b.myIdx];

    if (enemy.hp <= 0) {
      lines.push(`${displayName(enemy)} fainted!`);
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
        // ── Town trainer milestone hints ──────────────────────────────────────
        // Track the player's progress through the three town duellists. The third
        // win unlocks the Runic Phone (key item that adds a Phone tab to the menu).
        // Only fires on first-time defeat — rematches don't re-trigger.
        const isFirstDefeat = !defeated.includes(b.npc.id);
        if (isFirstDefeat && TOWN_TRAINER_IDS.has(b.npc.id)) {
          const townDefeatedCount = [...TOWN_TRAINER_IDS].filter(id => defeated.includes(id)).length + 1;
          if (townDefeatedCount === 1) {
            lines.push(`${b.npc.name}: "Sharp instincts. The other two duellists in the Hollow are also worth your time — beat all three of us, and we've pooled together a little something for you."`);
          } else if (townDefeatedCount === 2) {
            lines.push(`${b.npc.name}: "Two of us down. One left in the Hollow. Find them and our gift is yours."`);
          } else if (townDefeatedCount === 3) {
            lines.push(`${b.npc.name}: "Three of three. We've been waiting to give you this."`);
            lines.push(`✦ Received: Runic Phone — a Phone tab now lives in your Spellbook.`);
            lines.push(`Bran, Ria & Dax: "Call us anytime. We'll bring sharper teeth."`);
            setItems(it => ({ ...it, runic_phone: 1 }));
            setTimeout(() => audio.sfx.fanfare(), 900);
            setTimeout(() => showToast('☎ Runic Phone unlocked! Open Spellbook → Phone.'), 1400);
          }
        }
        setDefeated(d => {
          // Add this trainer to the defeated list
          const next = d.includes(b.npc.id) ? d : [...d, b.npc.id];
          // ── Mono zone trainer gate ──────────────────────────────────────────
          if (ZONE_TRAINER_IDS.has(b.npc.id)) {
            const allCleared = [...ZONE_TRAINER_IDS].every(id => next.includes(id));
            if (allCleared) {
              setTrainerCycles(c => c + 1);
              const filtered = next.filter(id => !ZONE_TRAINER_IDS.has(id));
              setTimeout(() => showToast(`All zone challengers cleared! They've returned, stronger.`), 50);
              setTimeout(() => showToast(`The shrine gates have opened — five sealed buildings now beckon.`), 2000);
              setTimeout(() => audio.sfx.fanfare(), 1200);
              return filtered;
            }
          }
          // ── Dual zone trainer gate ──────────────────────────────────────────
          // When all 5 current plane dual-zone trainers are beaten, unlock the warden bosses.
          if (DUAL_TRAINER_IDS.has(b.npc.id) && planeDualPairs) {
            const currentDualIds = planeDualPairs.map(([a, bv]) => `dual_trainer_${normPair(a, bv)}`);
            const allDualCleared = currentDualIds.every(id => next.includes(id));
            if (allDualCleared) {
              setTimeout(() => showToast(`All rift guardians defeated! The five warden seals have broken.`), 50);
              setTimeout(() => showToast(`Step into the rift corridors and face the warden at each center tile.`), 2200);
              setTimeout(() => audio.sfx.fanfare(), 1200);
            }
          }
          return next;
        });
      } else if (b.kind === 'legendary') {
        const reward = 400 + enemy.level * 20;
        // ── Dual zone boss win ─────────────────────────────────────────────────
        if (b.isDualBoss) {
          const pk = b.shrineColor; // normalized pair key e.g. 'GR'
          const guildName = GUILD_NAMES[pk] || pk;
          lines.push(`The ${enemy.name} dissolves back into the rift energy...`);
          lines.push(`You receive the ${guildName} Rift Medallion!`);
          lines.push(`+${reward} gold.`);
          setGold(g => g + reward);
          setDualMedallions(arr => arr.includes(pk) ? arr : [...arr, pk]);
          setTimeout(() => audio.sfx.medallion('U'), 500); // blue tone for rift
          setTimeout(() => audio.sfx.victory(), 1300);
          setTimeout(() => {
            const haveAfter = [...new Set([...(planeDualPairs||[]).map(([a,bv])=>normPair(a,bv)), pk])];
            const totalDual = planeDualPairs ? planeDualPairs.length : 0;
            const clearedDual = haveAfter.filter(k => dualMedallions.includes(k) || k === pk).length;
            const remaining = totalDual - clearedDual;
            const monoRemaining = ['W','U','B','R','G'].filter(c => !medallions.includes(c)).length;
            if (remaining === 0 && monoRemaining === 0) showToast('All 10 medallions gathered! The town shrine trembles...');
            else showToast(`Rift Medallion gained. ${remaining} rift + ${monoRemaining} mono medallion(s) remain.`);
          }, 80);
        } else {
          // ── Mono shrine boss win ───────────────────────────────────────────
          lines.push(`The ${enemy.name} crumbles into a beam of light...`);
          lines.push(`You receive the ${COLOR_NAME[b.shrineColor]} Medallion!`);
          lines.push(`+${reward} gold.`);
          setGold(g => g + reward);
          setMedallions(arr => arr.includes(b.shrineColor) ? arr : [...arr, b.shrineColor]);
          setTimeout(() => audio.sfx.medallion(b.shrineColor), 500);
          setTimeout(() => audio.sfx.victory(), 1300);
          setTimeout(() => {
            const haveAfter = [...new Set([...medallions, b.shrineColor])];
            const monoRemaining = ['W','U','B','R','G'].filter(c => !haveAfter.includes(c));
            const dualTotal = planeDualPairs ? planeDualPairs.length : 0;
            const dualCleared = dualMedallions.length;
            const dualRemaining = dualTotal - dualCleared;
            if (monoRemaining.length === 0 && dualRemaining === 0) showToast('All medallions gathered. The town shrine awaits...');
            else if (monoRemaining.length === 0) showToast(`All mono medallions gathered! ${dualRemaining} rift medallion(s) remain.`);
            else showToast(`Medallion gained. ${monoRemaining.length} mono + ${dualRemaining} rift medallion(s) remain.`);
          }, 80);
        }
      } else if (b.kind === 'planeswalker') {
        // Final boss victory — Champion badge + ability-learning prompt.
        const reward = 2000;
        if (currentPlane === 0) {
          // First defeat — standard flavor, vault sigil, champion learn
          lines.push(`THE PLANESWALKER bows its head. "The spark... is yours."`);
          lines.push(`Your commander absorbs a fragment of planar power!`);
          lines.push(`+${reward} gold.`);
          lines.push(`The Planeswalker presses a rune-iron sigil into your palm — "For the spirits that wait. Call them when you must."`);
          lines.push(`Received the Vault Sigil!`);
          setItems(it => ({ ...it, vault_sigil: 1 }));
          setChampionLearnPending(true);
        } else {
          lines.push(`THE PLANESWALKER staggers. "Again... how?"`);
          lines.push(`Its eyes burn with all five colors — then go dark.`);
          lines.push(`+${reward} gold.`);
        }
        setGold(g => g + reward);
        setPlaneswalkerDefeated(true);
        setPlanePending(true);  // triggers plane-shift in endBattle
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
      lines.push(`${displayName(me)} fainted!`);
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
      const { newTeam: afterMoveTeam, newEnemyTeam, lines, fx } = applyMove(newBattle, newTeam, 'player', moveKey);
      const finalBattle = { ...newBattle, enemyTeam: newEnemyTeam, log: [...newBattle.log, ...lines], fx };
      postStep(finalBattle, afterMoveTeam, 'player');
      if (fx) setTimeout(() => setBattle(bb => bb && bb.fx && bb.fx.key === fx.key ? { ...bb, fx: null } : bb), 700);
      return;
    }
    const { newTeam, newEnemyTeam, lines, fx } = applyMove(b, t, 'player', moveKey);
    const newBattle = { ...b, enemyTeam: newEnemyTeam, log: [...b.log, ...lines], fx };
    postStep(newBattle, newTeam, 'player');
    if (fx) setTimeout(() => setBattle(bb => bb && bb.fx && bb.fx.key === fx.key ? { ...bb, fx: null } : bb), 700);
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
      const { newTeam, newEnemyTeam: nnet, lines, fx } = applyMove(newBattle, t, 'enemy', pickedKey);
      const finalBattle = { ...newBattle, enemyTeam: nnet, log: [...newBattle.log, ...lines], fx };
      postStep(finalBattle, newTeam, 'enemy');
      if (fx) setTimeout(() => setBattle(bb => bb && bb.fx && bb.fx.key === fx.key ? { ...bb, fx: null } : bb), 700);
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
    const { newTeam, newEnemyTeam, lines, fx } = applyMove(b, t, 'enemy', pickedKey);
    const newBattle = { ...b, enemyTeam: newEnemyTeam, log: [...b.log, ...lines], fx };
    postStep(newBattle, newTeam, 'enemy');
    if (fx) setTimeout(() => setBattle(bb => bb && bb.fx && bb.fx.key === fx.key ? { ...bb, fx: null } : bb), 700);
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
    setBattle({ ...b, turn: 'catching', throwing: true, log: [...b.log, `You hurl a Creature Card at ${displayName(b.enemyTeam[b.enemyIdx])}!`] });
    setTokens(v => v - 1);
    audio.sfx.catchTry();
    // Layer additional click-clusters timed to wobble 2 and wobble 3 so each
    // shake has its own audible "tension" tick.
    setTimeout(() => audio.sfx.catchTry(), 460);
    setTimeout(() => audio.sfx.catchTry(), 880);
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
        lines.push(`${displayName(enemy)} was bound to your service!`);
        const caught = { ...enemy, hp: Math.max(1, enemy.hp) };
        if (t2.length < 6) {
          setTeam(tt => [...tt, caught]);
          // Stash this newly-caught uid so we can prompt for a nickname after
          // the battle ends (so the prompt doesn't fight the battle results screen).
          setPendingNicknameUid(caught.uid);
        } else {
          // Team full — auto-deposit to the Hollow Vault. The post-battle prompt
          // lets the player swap immediately if they'd rather keep the new bind.
          setVaultCreatures(v => [...v, caught]);
          lines.push(`(Team full — ${displayName(enemy)} sent to the Hollow Vault.)`);
          setPendingVaultSwapUid(caught.uid);
        }
        setCodex(cx => ({ ...cx, [enemy.id]: { caught: (cx[enemy.id]?.caught || 0) + 1, seen: cx[enemy.id]?.seen || 1 }}));
        setBattle({ ...b2, log: [...b2.log, ...lines], turn: 'end', result: 'catch', throwing: false });
        audio.sfx.catchSuccess();
      } else {
        lines.push('It broke free!');
        setBattle({ ...b2, log: [...b2.log, ...lines], turn: 'enemy', throwing: false });
        audio.sfx.catchFail();
        setTimeout(() => enemyAction(), 550);
      }
    }, 1700);
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
        newLines.push(`${displayName(creature)} did not learn ${MOVES[next.move].name}.`);
      } else {
        const forgotten = creature.moves[forgetIdx];
        const newMoves = creature.moves.slice();
        newMoves[forgetIdx] = next.move;
        const nt = [...t]; nt[ci] = { ...creature, moves: newMoves };
        setTeam(nt);
        newLines.push(`${displayName(creature)} forgot ${MOVES[forgotten].name} and learned ${MOVES[next.move].name}!`);
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
        newLines.push(`${displayName(creature)}'s color identity is locked. No further color grafts will be offered.`);
      } else if (choice.action === 'skip') {
        // Color milestone declined for now — don't lock, just defer to the next color milestone.
        // Clear the new-color flag so the follow-up attack milestone falls back to "any color".
        const nt = [...t]; nt[ci] = { ...creature, lastGraftAddedColor: null };
        setTeam(nt);
        newLines.push(`${displayName(creature)} resists the call — for now.`);
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
        newLines.push(`✦ ${displayName(creature)} grafted ${COLOR_NAME[newColor]} onto its identity!`);
        if (lastAdded && lastAdded !== newColor) {
          newLines.push(`(${COLOR_NAME[lastAdded]} attacks now do ${Math.round(penalties[lastAdded] * 100)}% damage.)`);
        }
      } else if (choice.action === 'learn') {
        // Auto-learn if there's a free slot, otherwise queue a learn prompt that fires after grafts.
        if (creature.moves.length < 4) {
          const nt = [...t]; nt[ci] = { ...creature, moves: [...creature.moves, choice.move], lastGraftAddedColor: null };
          setTeam(nt);
          newLines.push(`${displayName(creature)} learned ${MOVES[choice.move].name}!`);
        } else {
          // Keep the flag clear regardless of whether the player chooses to forget or skip the queued learn.
          const nt = [...t]; nt[ci] = { ...creature, lastGraftAddedColor: null };
          setTeam(nt);
          newPendingLearns = [...newPendingLearns, { uid: creature.uid, move: choice.move }];
          newLines.push(`${displayName(creature)} wants to learn ${MOVES[choice.move].name}...`);
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
    const wasPlanePending = planePending;

    // Iris-out transition back to the overworld. We clear `battle` immediately so
    // the battle UI stops animating, but the iris hides the abrupt scene swap.
    playSceneTransition('iris', () => {
      setBattle(null);
      setScene('world');
      // If we caught a creature, prompt for a nickname now (after the iris).
      if (pendingNicknameUid) {
        setRenameUid(pendingNicknameUid);
        setPendingNicknameUid(null);
      }
      // If the catch overflowed (team was full), now offer to swap a member out.
      if (pendingVaultSwapUid) {
        setVaultSwapUid(pendingVaultSwapUid);
        setPendingVaultSwapUid(null);
      }
      // Plane-shift: trigger the dramatic transition dialog after returning to world.
      if (wasPlanePending) {
        setPlanePending(false);
        const { nextPlane, newPlaneName, easyZone, hardZone, defeatedPWLevel } = doPlaneShift(currentPlane);

        setTimeout(() => {
          setDialog({
            lines: [
              `With their dying breath, the Planeswalker reaches out — and tears a rift between planes.`,
              `The sky above Runesmith Hollow peels back like burning parchment. Reality folds.`,
              `You are pulled through — dragged into a new plane. Darker. Stranger. Hungrier.`,
              `✦ You have entered: ${newPlaneName} (Plane ${nextPlane})`,
              `The creatures here remember your face. They've been waiting.`,
              `The land has shifted. ${easyZone} stirs with level ${defeatedPWLevel + 2}–${defeatedPWLevel + 6} creatures. ${hardZone} harbors things far worse.`,
              `The medallion bearers have been reset. Five new wardens have taken their place.`,
              `Somewhere in this plane, a new Planeswalker draws power — level ${getPlaneswalkerLevel(nextPlane)}.`,
            ],
            onDone: () => setDialog(null),
          });
        }, 350);
      }
    });
    // Status effects clear when battle ends
    setTeam(tm => tm.map(c => c.status ? { ...c, status: null } : c));
    if (battle?.result === 'lose') {
      // "faint" → restore to shrine
      setTeam(tm => tm.map(c => ({ ...c, hp: Math.ceil(c.maxHp * 0.5), status: null })));
      setCurrentMap('town');
      setPlayer({ x: 7, y: 7, face: 'up' });
      showToast('You were revived at the shrine.');
    }
    // Save after each battle — but skip if rate-limited.
    if (!wasPlanePending && !isRateLimited()) {
      setTimeout(() => performSave(), 200);
    }
  };

  // ---- Plane shift (shared by endBattle planePending path AND the shrine warp option) ----
  // Applies all the state transitions for entering the next plane. Safe to call
  // at any time the player is back in the world scene (not mid-battle).
  const doPlaneShift = (fromPlane) => {
    const defeatedPWLevel = getPlaneswalkerLevel(fromPlane);
    const nextPlane = fromPlane + 1;
    const newZoneOrder = generatePlaneZoneOrder(nextPlane);
    const newPlaneName = getPlaneName(nextPlane);
    const easyZone = MAPS[newZoneOrder[0]]?.name || newZoneOrder[0];
    const hardZone = MAPS[newZoneOrder[4]]?.name || newZoneOrder[4];

    setCurrentPlane(nextPlane);
    setPlaneBaseLevel(defeatedPWLevel);
    setPlaneZoneOrder(newZoneOrder);
    setPlaneDualPairs(generateDualCycle(nextPlane));
    setDualMedallions([]);
    setMedallions([]);
    setPlaneswalkerDefeated(false);
    // Reset zone trainers AND dual zone trainers so the player must re-earn them
    setDefeated(d => d.filter(id => !ZONE_TRAINER_IDS.has(id) && !DUAL_TRAINER_IDS.has(id)));
    setTeam(tm => tm.map(c => ({ ...c, hp: c.maxHp, status: null })));
    setCurrentMap('town');
    setPlayer({ x: 7, y: 7, face: 'down' });
    audio.sfx.fanfare();
    setTimeout(() => showToast(`Welcome to ${newPlaneName}. Plane ${nextPlane} begins.`), 400);
    if (!isRateLimited()) setTimeout(() => performSave(), 700);

    // Return the flavor info for the transition dialog (used by both callers)
    return { nextPlane, newPlaneName, easyZone, hardZone, defeatedPWLevel };
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
        else if (e.key === 'Shift') { sprintHeldRef.current = true; }
        else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setSprinting(v => !v); }
        else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); setMiniMapOpen(v => !v); }
      } else if (scene === 'dialog' || dialog) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'z') dialog?.onDone?.();
      }
    };
    const upHandler = (e) => {
      if (e.key === 'Shift') sprintHeldRef.current = false;
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', upHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', upHandler);
    };
  }, [scene, move, interact, dialog]);

  // ---------- Canvas draw (Top-down 2.5D / "DS-era") ----------
  // Axis-aligned tile grid (no isometric rotation) — but elevated objects (trees,
  // rocks, walls, buildings, shrines) get real depth: visible trunks, side faces,
  // height extending UP into the row above. Characters and elevated objects are
  // drawn after ground in row-by-row Y order so the player correctly walks behind
  // trees, etc. animFrame drives water shimmer, lava flicker, idle bobs, magic-
  // circle pulse, and ambient zone particles.
  useEffect(() => {
    if (scene !== 'world') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const TILE = 32;
    const map = MAPS[currentMap].tiles;
    const W = map[0].length, H = map.length;
    const VW = 10, VH = 10;

    // camera centered on player (clamped to map bounds, like the original)
    const camX = Math.max(0, Math.min(player.x - Math.floor(VW / 2), W - VW));
    const camY = Math.max(0, Math.min(player.y - Math.floor(VH / 2), H - VH));

    canvas.width = VW * TILE;
    canvas.height = VH * TILE;
    const CW = canvas.width, CH = canvas.height;

    // zone-tinted background gradient (subtle — fills any gaps at map edges)
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    if (currentMap === 'ashen')   { bg.addColorStop(0, '#1c0e08'); bg.addColorStop(1, '#080406'); }
    else if (currentMap === 'sanctum') { bg.addColorStop(0, '#0a1830'); bg.addColorStop(1, '#040814'); }
    else if (currentMap === 'umbral')  { bg.addColorStop(0, '#0c0a18'); bg.addColorStop(1, '#040208'); }
    else if (currentMap === 'wilds')   { bg.addColorStop(0, '#0e1a18'); bg.addColorStop(1, '#040806'); }
    else if (currentMap === 'plains')  { bg.addColorStop(0, '#1a1a28'); bg.addColorStop(1, '#08080e'); }
    else if (SHRINE_TO_ZONE[currentMap]) { bg.addColorStop(0, '#150f24'); bg.addColorStop(1, '#08060e'); }
    else { bg.addColorStop(0, '#0a0a14'); bg.addColorStop(1, '#060608'); }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);

    // small color helpers (for character shading)
    const hexToRgb = (hex) => {
      const h = hex.replace('#', '');
      return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
    };
    const rgbToHex = (r, g, b) => {
      const t = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
      return '#' + t(r) + t(g) + t(b);
    };
    const shade = (hex, factor) => {
      const c = hexToRgb(hex);
      return rgbToHex(c.r * factor, c.g * factor, c.b * factor);
    };

    // ---- ground tile (flat 32x32 square at tile pos) ----
    const drawGround = (t, gx, gy) => {
      const sx = (gx - camX) * TILE;
      const sy = (gy - camY) * TILE;
      switch (t) {
        case '.': {
          // HGSS-style bright walkable grass — two-tone checkerboard base + fine blade detail
          const baseG = (gx + gy) % 2 === 0 ? '#5a9040' : '#528438';
          ctx.fillStyle = baseG; ctx.fillRect(sx, sy, TILE, TILE);
          // subtle lighter stripe along top edge for depth
          ctx.fillStyle = '#68a84a';
          ctx.fillRect(sx, sy, TILE, 3);
          // small dark fleck variation
          ctx.fillStyle = '#3a6228';
          for (let i = 0; i < 4; i++) {
            const dx = (gx * 7 + gy * 13 + i * 9) % (TILE - 2);
            const dy = (gx * 11 + gy * 5 + i * 7) % (TILE - 2);
            ctx.fillRect(sx + dx, sy + dy, 2, 1);
          }
          // tiny bright highlights
          ctx.fillStyle = '#78c058';
          const hx = (gx * 5 + gy * 3) % (TILE - 2);
          const hy = (gx * 3 + gy * 7) % (TILE - 2);
          ctx.fillRect(sx + hx, sy + hy, 1, 1);
          break;
        }
        case 'g': {
          // HGSS-style tall grass — darker base with prominent upright blades
          ctx.fillStyle = '#3a6e28'; ctx.fillRect(sx, sy, TILE, TILE);
          // darker bottom shadow strip
          ctx.fillStyle = '#2a4e1a';
          ctx.fillRect(sx, sy + TILE - 6, TILE, 6);
          // blade pattern — tall vertical strokes with tips
          ctx.fillStyle = '#4a8a34';
          const bladeOffsets = [
            [2,  0], [6,  2], [10, 0], [14, 3], [18, 1], [22, 0], [26, 2],
            [4,  4], [8,  5], [12, 4], [16, 5], [20, 4], [24, 5], [28, 4],
          ];
          for (const [bx, by2] of bladeOffsets) {
            const bxr = (bx + gx * 3 + gy * 2) % TILE;
            const bladeH = 10 + ((gx * 7 + gy * 5 + bx) % 8);
            ctx.fillRect(sx + bxr, sy + by2, 2, bladeH);
          }
          // bright blade tips
          ctx.fillStyle = '#72b84a';
          for (let i = 0; i < 6; i++) {
            const tx = (gx * 11 + i * 7 + gy * 3) % (TILE - 2);
            const ty = (gy * 5 + i * 13 + gx) % 8;
            ctx.fillRect(sx + tx, sy + ty, 1, 2);
          }
          break;
        }
        case 'p': {
          // HGSS-style dirt path — warm sandy beige with subtle pebble texture
          ctx.fillStyle = '#c8a85c'; ctx.fillRect(sx, sy, TILE, TILE);
          // subtle lighter center strip
          ctx.fillStyle = '#d4b870';
          ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
          // edge darkening (depth/edge shadow)
          ctx.fillStyle = '#a88840';
          ctx.fillRect(sx, sy, TILE, 1);
          ctx.fillRect(sx, sy, 1, TILE);
          // pebble/stone speckles
          ctx.fillStyle = '#b89858';
          for (let i = 0; i < 5; i++) {
            const dx = (gx * 9 + i * 7 + gy * 3) % (TILE - 4) + 2;
            const dy = (gy * 11 + i * 5 + gx * 7) % (TILE - 4) + 2;
            ctx.fillRect(sx + dx, sy + dy, 2, 1);
          }
          ctx.fillStyle = '#e8cc80';
          const px = (gx * 5 + gy * 7) % (TILE - 4) + 2;
          const py2 = (gy * 3 + gx * 5) % (TILE - 4) + 2;
          ctx.fillRect(sx + px, sy + py2, 1, 1);
          break;
        }
        case 'a': {
          ctx.fillStyle = '#5a4e48'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#3a322e';
          for (let i = 0; i < 5; i++) {
            const dx = (gx * 13 + gy * 7 + i * 11) % TILE;
            const dy = (gx * 5 + gy * 11 + i * 9) % TILE;
            ctx.fillRect(sx + dx, sy + dy, 2, 1);
          }
          break;
        }
        case 'l': {
          // ash floor under the lava
          ctx.fillStyle = '#3a2418'; ctx.fillRect(sx, sy, TILE, TILE);
          // hot lava pool, pulsing
          const pulse = 0.6 + 0.4 * Math.abs(Math.sin((animFrame + gx * 7 + gy * 11) * 0.45));
          ctx.fillStyle = `rgba(224, 96, 32, ${pulse})`;
          ctx.fillRect(sx + 4, sy + 4, TILE - 8, TILE - 8);
          // glowing core
          ctx.fillStyle = '#ffaa40';
          ctx.fillRect(sx + 12, sy + 12, 8, 8);
          ctx.fillStyle = '#ffee80';
          ctx.fillRect(sx + 14, sy + 14, 4, 4);
          // ember sparks
          if ((gx + gy + animFrame) % 4 === 0) {
            ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
            ctx.fillRect(sx + 6 + ((animFrame + gx) % 6), sy + 4, 1, 1);
          }
          break;
        }
        case 'u': {
          // HGSS-style water — bright cobalt with animated highlight bands
          ctx.fillStyle = '#2878c8'; ctx.fillRect(sx, sy, TILE, TILE);
          // lighter strip at top (surface reflection)
          ctx.fillStyle = '#3898e8';
          ctx.fillRect(sx, sy, TILE, 6);
          // animated shimmer bands
          const phase1 = (animFrame + gx * 3 + gy * 2) % 16;
          const phase2 = (animFrame * 2 + gx * 2 + gy * 4) % 16;
          ctx.fillStyle = 'rgba(120, 200, 255, 0.5)';
          ctx.fillRect(sx + phase1,      sy + 8,  8, 2);
          ctx.fillRect(sx + 16 - phase1, sy + 16, 8, 2);
          ctx.fillRect(sx + phase2,      sy + 22, 6, 1);
          // white sparkle at crest
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          if ((animFrame + gx + gy) % 8 < 3) {
            ctx.fillRect(sx + (gx * 7 + gy * 3) % (TILE - 3), sy + (gy * 5 + gx) % 10, 2, 1);
          }
          break;
        }
        case 'o': {
          ctx.fillStyle = '#1a3a60'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#2b5088';
          for (let i = 0; i < 3; i++) {
            const dx = (gx * 7 + i * 9) % TILE;
            const dy = (gy * 5 + i * 11) % TILE;
            ctx.fillRect(sx + dx, sy + dy, 3, 2);
          }
          // expanding ripple
          const phase = (animFrame + gx + gy) % 8;
          const rad = 3 + phase;
          const alpha = Math.max(0, 1 - phase / 8);
          ctx.strokeStyle = `rgba(108, 184, 224, ${alpha * 0.7})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx + 16, sy + 16, rad, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'm': {
          ctx.fillStyle = '#2a3a26'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#1a2818';
          for (let i = 0; i < 4; i++) {
            const dx = (gx * 7 + i * 5) % TILE;
            const dy = (gy * 11 + i * 7) % TILE;
            ctx.fillRect(sx + dx, sy + dy, 2, 2);
          }
          break;
        }
        case 'v': {
          ctx.fillStyle = '#1a2814'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.strokeStyle = '#4a2a5a'; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx + 4, sy + 4); ctx.lineTo(sx + 16, sy + 14); ctx.lineTo(sx + 12, sy + 26);
          ctx.moveTo(sx + 28, sy + 6); ctx.lineTo(sx + 22, sy + 18); ctx.lineTo(sx + 26, sy + 28);
          ctx.stroke();
          ctx.fillStyle = '#7a3a98';
          ctx.fillRect(sx + 14, sy + 12, 3, 3);
          ctx.fillRect(sx + 22, sy + 18, 3, 3);
          break;
        }
        case 'c': {
          ctx.fillStyle = '#d8cca0'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#c8b88c';
          for (let i = 0; i < 4; i++) {
            const dx = (gx * 5 + i * 7) % TILE;
            const dy = (gy * 11 + i * 9) % TILE;
            ctx.fillRect(sx + dx, sy + dy, 2, 1);
          }
          break;
        }
        case 'f': {
          // HGSS-style flower field — bright green base with dense colorful blooms
          ctx.fillStyle = '#5a9840'; ctx.fillRect(sx, sy, TILE, TILE);
          // slight lighter top strip
          ctx.fillStyle = '#6aac4c';
          ctx.fillRect(sx, sy, TILE, 4);
          // grass blades between flowers
          ctx.fillStyle = '#3e7030';
          for (let i = 0; i < 5; i++) {
            const bx = (gx * 7 + i * 9 + gy * 3) % (TILE - 2);
            ctx.fillRect(sx + bx, sy + 16, 1, 8);
          }
          // Flower petals — HGSS palette: pink, white, yellow, light-blue
          const flowerData = [
            { petal: '#f4a0c0', center: '#ffe040', x: 6,  y: 4  },
            { petal: '#e8e8ff', center: '#ffc840', x: 20, y: 6  },
            { petal: '#a8d4f8', center: '#ffe880', x: 14, y: 2  },
            { petal: '#f4a0c0', center: '#ffe040', x: 26, y: 8  },
            { petal: '#ffe8a0', center: '#f0a030', x: 4,  y: 18 },
            { petal: '#e8e8ff', center: '#ffc840', x: 22, y: 20 },
            { petal: '#a8d4f8', center: '#ffe880', x: 12, y: 22 },
          ];
          for (const { petal, center, x: fx, y: fy } of flowerData) {
            // 4 petals in + pattern
            ctx.fillStyle = petal;
            ctx.fillRect(sx + fx,     sy + fy - 2, 2, 2); // top
            ctx.fillRect(sx + fx,     sy + fy + 2, 2, 2); // bottom
            ctx.fillRect(sx + fx - 2, sy + fy,     2, 2); // left
            ctx.fillRect(sx + fx + 2, sy + fy,     2, 2); // right
            // center dot
            ctx.fillStyle = center;
            ctx.fillRect(sx + fx, sy + fy, 2, 2);
            // stem pixel
            ctx.fillStyle = '#3e7030';
            ctx.fillRect(sx + fx, sy + fy + 4, 1, 4);
          }
          break;
        }
        case 'F': {
          ctx.fillStyle = '#3a3242'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#2a2230';
          ctx.fillRect(sx, sy, TILE, 1); ctx.fillRect(sx, sy + TILE - 1, TILE, 1);
          ctx.fillRect(sx, sy, 1, TILE); ctx.fillRect(sx + TILE - 1, sy, 1, TILE);
          ctx.fillStyle = '#5a4a78';
          ctx.fillRect(sx + 6, sy + 10, 1, 1);
          ctx.fillRect(sx + 22, sy + 18, 1, 1);
          ctx.fillRect(sx + 12, sy + 24, 1, 1);
          break;
        }
        case 'L': {
          // shrine floor under the magic circle
          ctx.fillStyle = '#3a3242'; ctx.fillRect(sx, sy, TILE, TILE);
          const zoneId = SHRINE_TO_ZONE[currentMap];
          const sd = zoneId && SHRINE_DATA[zoneId];
          const col = sd ? COLOR_HEX[sd.color] : '#fff';
          const deep = sd ? COLOR_DEEP[sd.color] : '#444';
          const claimed = sd && medallions.includes(sd.color);
          if (!claimed) {
            const pulse = 0.55 + 0.45 * Math.abs(Math.sin(animFrame * 0.3));
            ctx.save();
            ctx.globalAlpha = pulse;
            // outer rim
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(sx + 16, sy + 16, 13, 0, Math.PI * 2); ctx.stroke();
            // inner sigil
            ctx.strokeStyle = deep;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(sx + 16, sy + 16, 8, 0, Math.PI * 2); ctx.stroke();
            // cross-rune
            ctx.beginPath();
            ctx.moveTo(sx + 16, sy + 6); ctx.lineTo(sx + 16, sy + 26);
            ctx.moveTo(sx + 6, sy + 16); ctx.lineTo(sx + 26, sy + 16);
            ctx.stroke();
            ctx.restore();
            // glow center
            const grad = ctx.createRadialGradient(sx + 16, sy + 16, 1, sx + 16, sy + 16, 14);
            grad.addColorStop(0, col + 'aa');
            grad.addColorStop(1, col + '00');
            ctx.fillStyle = grad;
            ctx.fillRect(sx - 2, sy - 2, TILE + 4, TILE + 4);
          } else {
            // claimed — dimmed circle
            ctx.strokeStyle = '#5a4a78';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(sx + 16, sy + 16, 12, 0, Math.PI * 2); ctx.stroke();
          }
          break;
        }
        case 'E': {
          ctx.fillStyle = '#c9a96a'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#7a5a20';
          ctx.fillRect(sx + 12, sy + 8, 8, 4);
          ctx.fillRect(sx + 12, sy + 20, 8, 4);
          break;
        }
        case 'X': {
          // Dual-zone rift portal — glowing X-shaped tear in the mana fabric.
          // Only visually active in Plane 1+. Plane 0 shows as a faint sealed rune.
          ctx.fillStyle = '#1a1028'; ctx.fillRect(sx, sy, TILE, TILE);
          const active = currentPlane > 0;
          const pulse = active ? (0.5 + 0.5 * Math.abs(Math.sin(animFrame * 0.25))) : 0.25;
          // Two crossing diagonal lines form an X
          ctx.save();
          ctx.globalAlpha = pulse;
          const portalColor = active ? '#b070ff' : '#5a4070';
          const portalGlow  = active ? '#ff80ff' : '#806090';
          ctx.strokeStyle = portalColor;
          ctx.lineWidth = 2;
          ctx.shadowColor = portalGlow;
          ctx.shadowBlur = active ? 8 : 2;
          ctx.beginPath();
          ctx.moveTo(sx + 6, sy + 6); ctx.lineTo(sx + 26, sy + 26);
          ctx.moveTo(sx + 26, sy + 6); ctx.lineTo(sx + 6, sy + 26);
          ctx.stroke();
          if (active) {
            // Center energy burst
            const grad = ctx.createRadialGradient(sx + 16, sy + 16, 2, sx + 16, sy + 16, 12);
            grad.addColorStop(0, '#ffffff44');
            grad.addColorStop(1, '#b070ff00');
            ctx.fillStyle = grad;
            ctx.fillRect(sx + 4, sy + 4, 24, 24);
            // Corner sparkles
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 4;
            if ((animFrame + 0) % 8 < 4) { ctx.fillRect(sx + 5, sy + 5, 2, 2); }
            if ((animFrame + 2) % 8 < 4) { ctx.fillRect(sx + 25, sy + 25, 2, 2); }
            if ((animFrame + 4) % 8 < 4) { ctx.fillRect(sx + 25, sy + 5, 2, 2); }
            if ((animFrame + 6) % 8 < 4) { ctx.fillRect(sx + 5, sy + 25, 2, 2); }
          }
          ctx.restore();
          break;
        }
        case 'd': {
          ctx.fillStyle = '#b59a7a'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#3a2414'; ctx.fillRect(sx + 8, sy + 6, 16, 22);
          ctx.fillStyle = '#d4b060'; ctx.fillRect(sx + 20, sy + 16, 2, 3);
          break;
        }
        case 's': {
          // ground under the shrine pedestal — polished stone
          ctx.fillStyle = '#4a5a48'; ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = '#3a4a38';
          ctx.fillRect(sx + 4, sy + 4, 1, 1);
          ctx.fillRect(sx + 26, sy + 6, 1, 1);
          ctx.fillRect(sx + 8, sy + 26, 1, 1);
          break;
        }
        case 't':
        case 'k':
        case 'r':
        case 'w':
        case 'B': {
          // these get their full visual in pass 2 — paint zone-appropriate floor here
          let groundColor = '#528438';
          if (currentMap === 'ashen') groundColor = '#5a4e48';
          else if (currentMap === 'sanctum') groundColor = '#3a6a90';
          else if (currentMap === 'umbral') groundColor = '#2a3a26';
          else if (currentMap === 'plains') groundColor = '#d8cca0';
          else if (SHRINE_TO_ZONE[currentMap]) groundColor = '#3a3242';
          ctx.fillStyle = groundColor; ctx.fillRect(sx, sy, TILE, TILE);
          break;
        }
        default:
          ctx.fillStyle = '#222'; ctx.fillRect(sx, sy, TILE, TILE);
      }
    };

    // ---- elevated objects (drawn after ground in row order; can extend UP into row above) ----
    const drawObject = (t, gx, gy) => {
      const sx = (gx - camX) * TILE;
      const sy = (gy - camY) * TILE;
      const cx = sx + TILE / 2;       // tile center X
      const baseY = sy + TILE;        // tile bottom Y (where the object is anchored)
      switch (t) {
        case 't': { // tree — trunk at base, foliage extending upward into row above
          // shadow on the tile
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath(); ctx.ellipse(cx, baseY - 3, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
          // trunk — wider, more visible
          ctx.fillStyle = '#2a1808';
          ctx.fillRect(cx - 4, baseY - 18, 9, 14);
          ctx.fillStyle = '#4a2c10';
          ctx.fillRect(cx - 4, baseY - 18, 6, 14);
          ctx.fillStyle = '#6a4020';
          ctx.fillRect(cx - 4, baseY - 18, 2, 14);
          // bark texture line
          ctx.fillStyle = '#2a1808';
          ctx.fillRect(cx + 1, baseY - 14, 1, 8);
          // foliage — 3-layer HGSS-style rounded canopy
          // bottom / outer layer (darkest)
          ctx.fillStyle = '#226018';
          ctx.beginPath(); ctx.ellipse(cx, baseY - 24, 17, 13, 0, 0, Math.PI * 2); ctx.fill();
          // mid layer
          ctx.fillStyle = '#2e7820';
          ctx.beginPath(); ctx.ellipse(cx - 1, baseY - 28, 14, 11, 0, 0, Math.PI * 2); ctx.fill();
          // bright top highlight (HGSS trees have a light patch at top-left)
          ctx.fillStyle = '#44a030';
          ctx.beginPath(); ctx.ellipse(cx - 4, baseY - 32, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
          // small specular highlight
          ctx.fillStyle = '#60c040';
          ctx.fillRect(cx - 6, baseY - 36, 3, 3);
          ctx.fillRect(cx - 4, baseY - 38, 2, 2);
          // dark shadow under canopy on right
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.beginPath(); ctx.ellipse(cx + 4, baseY - 22, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'k': { // rock — chunky 3D-shaded boulder
          ctx.fillStyle = 'rgba(0,0,0,0.32)';
          ctx.beginPath(); ctx.ellipse(cx, baseY - 4, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
          // body
          ctx.fillStyle = '#5a504c';
          ctx.beginPath();
          ctx.moveTo(cx - 12, baseY - 4);
          ctx.lineTo(cx - 10, baseY - 18);
          ctx.lineTo(cx - 2, baseY - 22);
          ctx.lineTo(cx + 8, baseY - 20);
          ctx.lineTo(cx + 12, baseY - 12);
          ctx.lineTo(cx + 10, baseY - 4);
          ctx.closePath();
          ctx.fill();
          // mid tone
          ctx.fillStyle = '#7a706a';
          ctx.beginPath();
          ctx.moveTo(cx - 10, baseY - 8);
          ctx.lineTo(cx - 8, baseY - 17);
          ctx.lineTo(cx, baseY - 20);
          ctx.lineTo(cx + 8, baseY - 16);
          ctx.lineTo(cx + 8, baseY - 8);
          ctx.closePath();
          ctx.fill();
          // highlight
          ctx.fillStyle = '#9a908a';
          ctx.beginPath();
          ctx.moveTo(cx - 6, baseY - 14);
          ctx.lineTo(cx - 4, baseY - 18);
          ctx.lineTo(cx + 2, baseY - 18);
          ctx.lineTo(cx + 4, baseY - 14);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'r': { // red rock wall — taller, more imposing
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.beginPath(); ctx.ellipse(cx, baseY - 2, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
          // body (visible front face + slight top wedge)
          ctx.fillStyle = '#4a1810';
          ctx.fillRect(sx + 1, baseY - 28, TILE - 2, 26);
          ctx.fillStyle = '#6a2818';
          ctx.fillRect(sx + 1, baseY - 28, TILE - 2, 22);
          ctx.fillStyle = '#8a3a2a';
          ctx.fillRect(sx + 1, baseY - 28, TILE - 2, 4); // lighter top edge
          // texture lines
          ctx.strokeStyle = '#3a1410'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + 4, baseY - 18); ctx.lineTo(sx + 28, baseY - 18);
          ctx.moveTo(sx + 4, baseY - 8); ctx.lineTo(sx + 28, baseY - 8);
          ctx.moveTo(sx + 14, baseY - 28); ctx.lineTo(sx + 14, baseY - 18);
          ctx.moveTo(sx + 18, baseY - 18); ctx.lineTo(sx + 18, baseY - 8);
          ctx.stroke();
          break;
        }
        case 'w': { // generic stone wall
          ctx.fillStyle = 'rgba(0,0,0,0.32)';
          ctx.beginPath(); ctx.ellipse(cx, baseY - 2, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#7a6040';
          ctx.fillRect(sx + 1, baseY - 28, TILE - 2, 26);
          ctx.fillStyle = '#9a8060';
          ctx.fillRect(sx + 1, baseY - 28, TILE - 2, 22);
          ctx.fillStyle = '#b59a7a';
          ctx.fillRect(sx + 1, baseY - 28, TILE - 2, 4);
          ctx.strokeStyle = '#7a6040'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + 4, baseY - 16); ctx.lineTo(sx + 28, baseY - 16);
          ctx.moveTo(sx + 4, baseY - 8); ctx.lineTo(sx + 28, baseY - 8);
          ctx.moveTo(sx + 14, baseY - 28); ctx.lineTo(sx + 14, baseY - 16);
          ctx.moveTo(sx + 18, baseY - 16); ctx.lineTo(sx + 18, baseY - 8);
          ctx.stroke();
          break;
        }
        case 'B': { // building entrance — themed per zone, drawn extending UP from the tile
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.beginPath(); ctx.ellipse(cx, baseY - 2, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
          if (currentMap === 'wilds') {
            // Burrow — earthen mound with dark hole
            ctx.fillStyle = '#2a1408';
            ctx.beginPath(); ctx.ellipse(cx, baseY - 8, 16, 14, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#3a1e10';
            ctx.beginPath(); ctx.ellipse(cx - 2, baseY - 10, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#5a3a18';
            ctx.beginPath(); ctx.ellipse(cx - 4, baseY - 14, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
            // dark hole entrance
            ctx.fillStyle = '#0a0608';
            ctx.beginPath(); ctx.ellipse(cx, baseY - 6, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
            // grass tufts on top
            ctx.fillStyle = '#1f4a1a';
            ctx.fillRect(cx - 10, baseY - 22, 2, 3);
            ctx.fillRect(cx + 6, baseY - 23, 2, 4);
            ctx.fillRect(cx - 1, baseY - 24, 2, 3);
          } else if (currentMap === 'ashen') {
            // Cave mouth — jagged opening in cliff
            ctx.fillStyle = '#1a1410';
            ctx.fillRect(sx + 2, baseY - 30, TILE - 4, 28);
            ctx.fillStyle = '#2a2018';
            ctx.fillRect(sx + 2, baseY - 30, TILE - 4, 22);
            ctx.fillStyle = '#3a3028';
            ctx.fillRect(sx + 2, baseY - 30, TILE - 4, 4);
            // jagged dark opening
            ctx.fillStyle = '#0a0608';
            ctx.beginPath();
            ctx.moveTo(cx - 10, baseY - 2);
            ctx.lineTo(cx - 8, baseY - 18);
            ctx.lineTo(cx - 4, baseY - 22);
            ctx.lineTo(cx + 4, baseY - 22);
            ctx.lineTo(cx + 8, baseY - 18);
            ctx.lineTo(cx + 10, baseY - 2);
            ctx.closePath(); ctx.fill();
            // glowing embers inside
            const emberPulse = 0.7 + 0.3 * Math.sin(animFrame * 0.4);
            ctx.fillStyle = `rgba(224, 96, 32, ${emberPulse})`;
            ctx.fillRect(cx - 4, baseY - 8, 2, 2);
            ctx.fillRect(cx + 2, baseY - 6, 2, 2);
          } else if (currentMap === 'sanctum') {
            // Reed hut on a small island
            // islet
            ctx.fillStyle = '#5a8aa8';
            ctx.beginPath(); ctx.ellipse(cx, baseY - 2, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
            // walls
            ctx.fillStyle = '#705840';
            ctx.fillRect(cx - 11, baseY - 18, 22, 14);
            ctx.fillStyle = '#8a7048';
            ctx.fillRect(cx - 11, baseY - 18, 18, 14);
            // door
            ctx.fillStyle = '#3a2010';
            ctx.fillRect(cx - 3, baseY - 12, 6, 8);
            ctx.fillStyle = '#d4b060';
            ctx.fillRect(cx + 1, baseY - 8, 1, 1);
            // thatched roof
            ctx.fillStyle = '#a88040';
            ctx.beginPath();
            ctx.moveTo(cx - 14, baseY - 18);
            ctx.lineTo(cx, baseY - 30);
            ctx.lineTo(cx + 14, baseY - 18);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#705028'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx - 12, baseY - 20); ctx.lineTo(cx + 12, baseY - 20);
            ctx.moveTo(cx - 8, baseY - 24); ctx.lineTo(cx + 8, baseY - 24);
            ctx.stroke();
          } else if (currentMap === 'umbral') {
            // Withered shack — leaning planks
            ctx.fillStyle = '#1a0e08';
            ctx.fillRect(sx + 2, baseY - 28, TILE - 4, 26);
            ctx.fillStyle = '#2a1810';
            ctx.fillRect(sx + 2, baseY - 28, TILE - 4, 22);
            ctx.fillStyle = '#3a2818';
            ctx.fillRect(sx + 2, baseY - 28, TILE - 4, 4);
            // crooked roof
            ctx.fillStyle = '#1a0a08';
            ctx.beginPath();
            ctx.moveTo(cx - 16, baseY - 28);
            ctx.lineTo(cx - 2, baseY - 36);
            ctx.lineTo(cx + 16, baseY - 28);
            ctx.closePath(); ctx.fill();
            // plank lines
            ctx.strokeStyle = '#1a0e08'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx - 8, baseY - 24); ctx.lineTo(cx - 8, baseY - 4);
            ctx.moveTo(cx, baseY - 26); ctx.lineTo(cx, baseY - 4);
            ctx.moveTo(cx + 8, baseY - 24); ctx.lineTo(cx + 8, baseY - 4);
            ctx.stroke();
            // dark doorway
            ctx.fillStyle = '#0a0608';
            ctx.fillRect(cx - 4, baseY - 14, 8, 12);
          } else if (currentMap === 'plains') {
            // Heavenly gates — pearl pillars with golden trim and arch
            // pillars
            ctx.fillStyle = '#bfb09a';
            ctx.fillRect(cx - 13, baseY - 28, 6, 26);
            ctx.fillRect(cx + 7, baseY - 28, 6, 26);
            ctx.fillStyle = '#fff5e0';
            ctx.fillRect(cx - 13, baseY - 28, 4, 26);
            ctx.fillRect(cx + 7, baseY - 28, 4, 26);
            // golden capitals
            ctx.fillStyle = '#e8c860';
            ctx.fillRect(cx - 14, baseY - 30, 8, 3);
            ctx.fillRect(cx + 6, baseY - 30, 8, 3);
            // arch
            ctx.strokeStyle = '#e8c860'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, baseY - 28, 11, Math.PI, 0);
            ctx.stroke();
            // light pouring through
            const lpulse = 0.35 + 0.2 * Math.sin(animFrame * 0.18);
            ctx.fillStyle = `rgba(255, 240, 180, ${lpulse})`;
            ctx.fillRect(cx - 6, baseY - 28, 12, 26);
          } else {
            // HGSS-style town house — cream walls, red/orange triangular roof, dark door, window
            const houseW = TILE - 2;
            const houseTop = baseY - 38;
            const wallTop  = baseY - 26;
            // ── roof (triangle, red-orange) ──
            ctx.fillStyle = '#c83820'; // dark roof underside
            ctx.beginPath();
            ctx.moveTo(sx + 1,          wallTop);
            ctx.lineTo(cx,              houseTop);
            ctx.lineTo(sx + houseW + 1, wallTop);
            ctx.closePath(); ctx.fill();
            // lighter roof face
            ctx.fillStyle = '#e04828';
            ctx.beginPath();
            ctx.moveTo(sx + 1, wallTop);
            ctx.lineTo(cx,     houseTop + 2);
            ctx.lineTo(cx,     wallTop);
            ctx.closePath(); ctx.fill();
            // bright roof highlight
            ctx.fillStyle = '#f06040';
            ctx.beginPath();
            ctx.moveTo(cx - 6, houseTop + 6);
            ctx.lineTo(cx,     houseTop + 2);
            ctx.lineTo(cx - 2, wallTop);
            ctx.closePath(); ctx.fill();
            // ── chimney ──
            ctx.fillStyle = '#7a5040';
            ctx.fillRect(cx + 4, houseTop - 4, 5, 8);
            ctx.fillStyle = '#9a6858';
            ctx.fillRect(cx + 4, houseTop - 4, 3, 8);
            ctx.fillStyle = '#503028';
            ctx.fillRect(cx + 3, houseTop - 5, 7, 2); // cap
            // ── front wall (cream) ──
            ctx.fillStyle = '#d8d0b8';
            ctx.fillRect(sx + 1, wallTop, houseW, 26);
            // left shadow stripe
            ctx.fillStyle = '#b8aa98';
            ctx.fillRect(sx + houseW - 4, wallTop, 4, 26);
            // bright left face
            ctx.fillStyle = '#eee8d4';
            ctx.fillRect(sx + 1, wallTop, 4, 26);
            // ── door (centered, wooden brown) ──
            ctx.fillStyle = '#6a3c18';
            ctx.fillRect(cx - 4, baseY - 14, 8, 12);
            ctx.fillStyle = '#8a5228';
            ctx.fillRect(cx - 4, baseY - 14, 5, 12);
            // door knob
            ctx.fillStyle = '#e8c040';
            ctx.fillRect(cx + 2, baseY - 8, 1, 1);
            // door top arch
            ctx.fillStyle = '#8a5228';
            ctx.beginPath();
            ctx.arc(cx, baseY - 14, 4, Math.PI, 0);
            ctx.fill();
            // ── window (left of door, bright) ──
            ctx.fillStyle = '#2a3a5a';
            ctx.fillRect(sx + 5, baseY - 22, 8, 6);
            // window panes
            ctx.fillStyle = '#8ad0f8';
            ctx.fillRect(sx + 6, baseY - 21, 3, 2);
            ctx.fillRect(sx + 6, baseY - 18, 3, 2);
            ctx.fillStyle = '#c8ecff';
            ctx.fillRect(sx + 10, baseY - 21, 2, 2);
            ctx.fillRect(sx + 10, baseY - 18, 2, 2);
            // window frame
            ctx.strokeStyle = '#a09080'; ctx.lineWidth = 1;
            ctx.strokeRect(sx + 5, baseY - 22, 8, 6);
            // ── base/foundation strip ──
            ctx.fillStyle = '#a89878';
            ctx.fillRect(sx + 1, baseY - 2, houseW, 2);
          }
          break;
        }
        case 's': { // shrine pedestal — tiered altar with glowing orb
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.beginPath(); ctx.ellipse(cx, baseY - 2, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
          // base tier
          ctx.fillStyle = '#7a6438';
          ctx.fillRect(cx - 14, baseY - 10, 28, 8);
          ctx.fillStyle = '#967e50';
          ctx.fillRect(cx - 14, baseY - 10, 28, 6);
          ctx.fillStyle = '#b8a070';
          ctx.fillRect(cx - 14, baseY - 10, 28, 2);
          // upper tier
          ctx.fillStyle = '#866c40';
          ctx.fillRect(cx - 10, baseY - 22, 20, 12);
          ctx.fillStyle = '#a08858';
          ctx.fillRect(cx - 10, baseY - 22, 20, 9);
          ctx.fillStyle = '#c8b078';
          ctx.fillRect(cx - 10, baseY - 22, 20, 2);
          // orb (glowing, pulsing)
          const op = 0.7 + 0.3 * Math.sin(animFrame * 0.2);
          ctx.fillStyle = `rgba(255, 240, 180, ${op * 0.5})`;
          ctx.beginPath(); ctx.arc(cx, baseY - 26, 9, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff5c0';
          ctx.beginPath(); ctx.arc(cx, baseY - 26, 4, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
    };

    // =========================================================
    // PIXEL-ART SPRITE ENGINE  (DS / HGSS quality)
    // Each logical pixel = PX×PX screen pixels.
    // Sprite rows are strings; each char maps to a palette color.
    // '.' = transparent. Rows may differ in length (auto-centered).
    // =========================================================
    const PX = 2; // screen pixels per logical pixel

    const drawPS = (rows, pal, cx, baseY, flipH = false) => {
      const maxW = rows.reduce((m, r) => Math.max(m, r.length), 0);
      const H    = rows.length;
      const ox   = cx - Math.round(maxW * PX / 2);
      const oy   = baseY - H * PX;
      for (let r = 0; r < H; r++) {
        const row = rows[r];
        for (let ci = 0; ci < row.length; ci++) {
          const col = flipH ? row.length - 1 - ci : ci;
          const k   = row[col];
          if (k === '.' || !pal[k]) continue;
          ctx.fillStyle = pal[k];
          const screenX = flipH
            ? ox + (maxW - row.length + ci) * PX
            : ox + ci * PX;
          ctx.fillRect(screenX, oy + r * PX, PX, PX);
        }
      }
    };

    // ── Shared outline / shadow pass ─────────────────────────
    const drawShadow = (cx, baseY) => {
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath(); ctx.ellipse(cx, baseY + 1, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    };

    // ── Bob offset (2-frame idle cycle) ─────────────────────
    const BOB = (Math.floor(animFrame / 6) % 2 === 0) ? 0 : -1;

    // =========================================================
    // SPRITE DATA
    // =========================================================

    // ── PLAYER (Ethan-style protagonist) ────────────────────
    // SPRITE DATA
    // =========================================================

    // ── PLAYER (Ethan-style protagonist) ────────────────────
    // ================================================================
    //  SPRITE DATA  — strict single-char palette keys only
    //  Rows are 12 chars wide (D/U) or 10 chars (S).
    // ================================================================
    // ── PLAYER (v13) ──────────────────────────
    const palPlayer = {
      H:'#2454a8', h:'#143478', l:'#4878d8',
      A:'#d4c030', a:'#a09020',
      F:'#e8c890', f:'#c8a070', E:'#180c08',
      B:'#2868c0', b:'#184088', c:'#4488e0',
      N:'#ece4d0',
      P:'#202040', p:'#14142c', S:'#482818', s:'#281408',
    };
    const sprPlayer = {
      D:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHHlllHHHHh..',
        '.hHHHHHHHHHh..',
        '.AAAaAAAAaAAA.',
        '..FFFFFFFFF...',
        '.FFEFFFEFFF...',
        '.FFFFfffFFF...',
        '..FFffffFF....',
        '...NNNNN......',
        '..BBBBBBBBb...',
        '.BcBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBcBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      U:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHHHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '.AAAaAAAAaAAA.',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '...NNNNNNN....',
        '..BBBBBBBBb...',
        '.BBBBBBBBBBb..',
        '.BcBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      S:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHHlllHHHHh..',
        '.hHHHHHHHHHh..',
        '.AAAaAAAAaAAA.',
        '..FFFFFFFFF...',
        '.FFFEFFFFFf...',
        '.FFFFfffFFf...',
        '..FFffffFf....',
        '...NNNNNN.....',
        '..BBBBBBBBb...',
        '.BcBBBBBBBb...',
        '.BBBBBBBBBb...',
        '.BBBBBBBBBb...',
        '.BBBcBBBBBb...',
        '.BBBBBBBBBb...',
        '.PPPpPPPpPP...',
        '.PPPpPPPpPP...',
        '.PPpPPPpPP....',
        '.SSsSSSsSS....',
      ],
    };
    // ── BRAN (v13) ──────────────────────────
    const palBran = {
      H:'#1a1208', h:'#0e0a04', l:'#2a2010',
      A:'#c0a030',
      F:'#c8a070', f:'#a07050', E:'#180c08',
      B:'#487840', b:'#2e5428', c:'#68a050',
      N:'#ece4d0', V:'#5a3820',
      P:'#2a1a10', p:'#1a0e08', S:'#2a1808', s:'#180e04',
      Z:'#5a4028',
    };
    const sprBran = {
      D:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHHHlllHHHh..',
        '.hHHHHHHHHHh..',
        '..FFFFFFFFF...',
        '.FFEFFFEFFF...',
        '.FfffZZZffFf..',
        '..ZZZZZZZZ....',
        '...NNNNNN.....',
        '..BBBBBBBBb...',
        '.BcBBBBBBBBb..',
        '.BBBVAVAVBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      U:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHHHlllHHHh..',
        '.hHHHHHHHHHh..',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '...NNNNNNN....',
        '..BBBBBBBBb...',
        '.BcBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBVAVAVBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      S:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHHHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '..FFFFFFFFF...',
        '.FFFEFFFFFf...',
        '.FFffZZZffFf..',
        '..ZZZZZZZZ....',
        '...NNNNNN.....',
        '..BBBBBBBBb...',
        '.BcBBBBBBBb...',
        '.BBBVAVABBb...',
        '.BBBBBBBBBb...',
        '.BBBBBBBBBb...',
        '.PPPpPPPpPP...',
        '.PPPpPPPpPP...',
        '.PPpPPPpPP....',
        '.SSsSSSsSS....',
      ],
    };
    // ── RIA (v13) ──────────────────────────
    const palRia = {
      H:'#28b8b8', h:'#187088', l:'#58d8d8',
      A:'#d8e8f8',
      F:'#e8d0b8', f:'#c8a890', E:'#0a2040',
      B:'#384a90', b:'#1e2c5e', c:'#5878c8',
      N:'#ece4d0', V:'#1a1828',
      P:'#2c2858', p:'#181432', S:'#1a1432', s:'#0a0a1c',
    };
    const sprRia = {
      D:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHlllllllHh..',
        '.hHHHHHHHHHh..',
        '.hH.FFFFFF.Hh.',
        '.HHFFFFFFFFhh.',
        '.HHFEFFFEFFhh.',
        '..HFFfffffH...',
        '..HHffffHH....',
        '..hHHNNNHHh...',
        '..BBBBABBBb...',
        '.BcBBABABBBb..',
        '.BBBBABBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBcBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      U:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHlllllllHh..',
        '.hHHHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '..hHHNNNHHh...',
        '..BBBBBBBBb...',
        '.BcBBBBBBBBb..',
        '.BBBBABBBBBb..',
        '.BBBBABBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      S:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHlllllllHh..',
        '.hHHHHHHHHHh..',
        '.hHFFFFFFHHh..',
        '.HHFEFFFFFhh..',
        '.HHFFfffffH...',
        '..HHffffHH....',
        '..hHHNNNHH....',
        '..BBBBBBBBb...',
        '.BcBBABBBBb...',
        '.BBBBABBBBb...',
        '.BBBBBBBBBb...',
        '.BBBcBBBBBb...',
        '.BBBBBBBBBb...',
        '.PPPpPPPpPP...',
        '.PPPpPPPpPP...',
        '.PPpPPPpPP....',
        '.SSsSSSsSS....',
      ],
    };
    // ── DAX (v13) ──────────────────────────
    const palDax = {
      H:'#c84020', h:'#7a2010', l:'#f86838',
      A:'#f0c050',
      F:'#e8b888', f:'#c08868', E:'#180c08',
      B:'#702018', b:'#400e08', c:'#a04030',
      N:'#ece4d0', V:'#3a0e08',
      P:'#2a1a10', p:'#1a0e08', S:'#2a1808', s:'#180e04',
    };
    const sprDax = {
      D:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHlHHlHlHHh..',
        '.hHHHHHHHHHh..',
        '.h..FFFFFF..h.',
        '..FFFFFFFFFF..',
        '..FFEFFFEFF...',
        '..FFFfffFFF...',
        '..FFffffFF....',
        '..hHHNNNHHh...',
        '..BBBBABBBb...',
        '.BcBBBABBBBb..',
        '.BBBBABBBBBb..',
        '.BBVVVVVVVBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      U:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHlHHlHlHHh..',
        '.hHHHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '..hHHHHHHHh...',
        '..hHHNNNHHh...',
        '..BBBBBBBBb...',
        '.BcBBBBBBBBb..',
        '.BBVVVVVVVBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      S:[
        '..hHHHHHHh....',
        '.hHHHHHHHHh...',
        '.hHlHHlHlHHh..',
        '.hHHHHHHHHHh..',
        '..FFFFFFFFF...',
        '.FFFEFFFFFf...',
        '.FFFFfffFFf...',
        '..FFffffFf....',
        '..hHHNNNHH....',
        '..BBBBBBBBb...',
        '.BcBBBABBBb...',
        '.BBVVVVVBBb...',
        '.BBBBBBBBBb...',
        '.BBBcBBBBBb...',
        '.BBBBBBBBBb...',
        '.PPPpPPPpPP...',
        '.PPPpPPPpPP...',
        '.PPpPPPpPP....',
        '.SSsSSSsSS....',
      ],
    };
    // ── GUIDE (v13) ──────────────────────────
    const palGuide = {
      H:'#a8a098', h:'#787068', l:'#d8d0c8',
      A:'#c89828',
      F:'#d8b890', f:'#a89878', E:'#180c08',
      B:'#5a4028', b:'#3a2818', c:'#7a6038',
      N:'#ece4d0', V:'#3a2410',
      P:'#5a4028', p:'#3a2818', S:'#2a1808', s:'#180e04',
      Z:'#a8a098', o:'#8a6838', O:'#3a2410',
    };
    const sprGuide = {
      D:[
        '...hhHHhh.....',
        '..hHHHHHHh....',
        '..hHHlllHHh...',
        '..hHHHHHHHh...',
        '..FFFFFFFFF...',
        '.FFEFFFEFFF...',
        '.FZZZZZZZZF...',
        '.FZZZZZZZZF...',
        '..ZZZZZZZZ....',
        '...NNNNNNN..o.',
        '..BBBBBBBBb.O.',
        '.BcBBBBBBBBbO.',
        '.BBBBABBBBBbO.',
        '.BBBBBBBBBBbO.',
        '.BBBBBBBBBBbO.',
        '.BBBBBBBBBBbO.',
        '.BBBBBBBBBBbO.',
        '.BBBBBBBBBBbO.',
        '.BBBBBBBBBBbO.',
        '.PPpPPpPPpPp..',
        '.SSsSSsSSsSS..',
      ],
      U:[
        '...hhHHhh.....',
        '..hHHHHHHh....',
        '..hHHlllHHh...',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '...NNNNNNN....',
        '..BBBBBBBBb...',
        '.BcBBBBBBBBb..',
        '.BBBBABBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPpPPpPPpPp..',
        '.SSsSSsSSsSS..',
      ],
      S:[
        '...hhHHhh.....',
        '..hHHHHHHh....',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '..FFFFFFFF....',
        '.FFFEFFFFf....',
        '.FZZZZZZZF....',
        '.FZZZZZZZF....',
        '..ZZZZZZZ.....',
        '...NNNNNN..o..',
        '..BBBBBBBb.O..',
        '.BcBBBBBBb.O..',
        '.BBBBABBBb.O..',
        '.BBBBBBBBb.O..',
        '.BBBBBBBBb.O..',
        '.BBBBBBBBb.O..',
        '.BBBBBBBBb.O..',
        '.BBBBBBBBb.O..',
        '.PPpPPpPPp....',
        '.SSsSSsSSs....',
      ],
    };

    // ── MERLE (v13) ──────────────────────────
    const palMerle = {
      H:'#684020', h:'#3a2010', l:'#8a6038',
      A:'#3a2410',
      F:'#e8c8a0', f:'#c8a880', E:'#180c08',
      B:'#9a6e3a', b:'#5e3e1a', c:'#c89868',
      N:'#ece4d0', V:'#d8c890',
      P:'#3a2810', p:'#1a0e08', S:'#2a1808', s:'#180e04',
      Z:'#3a2010',
    };
    const sprMerle = {
      D:[
        '...hHHHHh.....',
        '..hHHHHHHh....',
        '..hHHlllHHh...',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '..FFFFFFFFF...',
        '.FFEFFFEFFF...',
        '.FZZZZZZZZF...',
        '..ZZZZZZZZ....',
        '...NNNNNNN....',
        '..BBBBBBBBb...',
        '.BcBVVVVVBBb..',
        '.BBBVVVVVBBb..',
        '.BBVVAAAVBBb..',
        '.BBVVVVVVVBBb.',
        '.BBBVVVVVBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      U:[
        '...hHHHHh.....',
        '..hHHHHHHh....',
        '..hHHlllHHh...',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '...NNNNNNN....',
        '..BBBBBBBBb...',
        '.BcBVVVVVBBb..',
        '.BBBVVVVVBBb..',
        '.BBBVVVVVBBb..',
        '.BBBVVVVVBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      S:[
        '...hHHHHh.....',
        '..hHHHHHHh....',
        '..hHHHHHHHh...',
        '..hHHHHHHHh...',
        '..FFFFFFFF....',
        '.FFFEFFFFf....',
        '.FZZZZZZZF....',
        '..ZZZZZZZ.....',
        '...NNNNNN.....',
        '..BBBBBBBb....',
        '.BcBVVVBBb....',
        '.BBBVVVBBb....',
        '.BBVAAVBBb....',
        '.BBVVVVBBb....',
        '.BBBVVVBBb....',
        '.PPPpPPPpP....',
        '.PPPpPPPpP....',
        '.PPpPPPpP.....',
        '.SSsSSSsS.....',
      ],
    };
    // ── KEEPER (v13) ──────────────────────────
    const palKeeper = {
      H:'#5a3068', h:'#382044', l:'#8a58a0',
      A:'#c8a058',
      F:'#d8b8a8', f:'#a88878', E:'#180c08',
      B:'#5a7088', b:'#384858', c:'#7a90a8',
      N:'#ece4d0', V:'#1a1828',
      P:'#2a1830', p:'#1a0e1c', S:'#1a1432', s:'#0a0a1c',
    };
    const sprKeeper = {
      D:[
        '..hhHHHHhh....',
        '.hHHHHHHHHh...',
        '.hHHhhhhHHHh..',
        '.hHHHHHHHHHh..',
        '.hH.FFFFFF.Hh.',
        '.HHFFFFFFFFhh.',
        '.HHFEFFFEFFhh.',
        '..HFFfffffH...',
        '..HHffffHH....',
        '..hHHNNNHHh...',
        '..BBBBABBBb...',
        '.BcBBABABBBb..',
        '.BBBBABBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBcBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      U:[
        '..hhHHHHhh....',
        '.hHHHHHHHHh...',
        '.hHHHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '..hHHNNNHHh...',
        '..BBBBBBBBb...',
        '.BcBBBBBBBBb..',
        '.BBBBABBBBBb..',
        '.BBBBABBBBBb..',
        '.BBBBBBBBBBb..',
        '.BBBBBBBBBBb..',
        '.PPPpPPPpPPp..',
        '.PPPpPPPpPPp..',
        '.PPpPPPpPPp...',
        '.SSsSSSsSSS...',
        '..sSSSSSSs....',
      ],
      S:[
        '..hhHHHHhh....',
        '.hHHHHHHHHh...',
        '.hHHhhhhHHHh..',
        '.hHHHHHHHHHh..',
        '.hHFFFFFFHHh..',
        '.HHFEFFFFFhh..',
        '.HHFFfffffH...',
        '..HHffffHH....',
        '..hHHNNNHH....',
        '..BBBBBBBBb...',
        '.BcBBABBBBb...',
        '.BBBBABBBBb...',
        '.BBBBBBBBBb...',
        '.BBBcBBBBBb...',
        '.BBBBBBBBBb...',
        '.PPPpPPPpPP...',
        '.PPPpPPPpPP...',
        '.PPpPPPpPP....',
        '.SSsSSSsSS....',
      ],
    };


    // ── YUGI (spiky hair, Millennium Puzzle) ──────────────────
    const palYugi = {
      H:'#d4c020', h:'#a09010', l:'#f0dc40',
      M:'#d02060',
      F:'#e8c890', f:'#c8a070',
      E:'#3a1040',
      B:'#1a2858', b:'#0e1838', c:'#2a3870',
      N:'#e8e0d0',
      V:'#e8c860', v:'#c0a030',
      P:'#0a1430', p:'#060c20',
      S:'#1a1020', s:'#0e080e',
    };
    const sprYugi = {
      D:[
        '..MHHhHHHMl.',
        '.MHlHHHHlHM.',
        '.lHHHHHHHHl.',
        '..HHHHHHHHh.',
        '..hHHHHHhHH.',
        '..FFFFFFfFF.',
        '.FfEFFFFEfF.',
        '.FFFfffFFFf.',
        '..NNNfNNN...',
        '.BBBBBBBBBB.',
        'bBcBBBBBBbB.',
        'BBBBBVvBBBBb',
        'BBBBBVvBBBBb',
        'BBBBBBBBBBBB',
        '.PPPpPPPpPP.',
        'PPPpPPPpPPPP',
        '.PPpPPPpPP..',
        '.SSsSSSsSSS.',
        '..sSSSSSSs..',
      ],
      U:[
        '..MHHhHHHMl.',
        '.MHlHHHHlHM.',
        '.lHHHHHHHHl.',
        '..HHHHHHHHh.',
        '..hHHHHHhHH.',
        '.BBBBBBBBBB.',
        'bBcBBBBBBbB.',
        'BBBBBBBBBBBb',
        'BBBBBVvBBBBb',
        'BBBBBVvBBBBb',
        'BBBBBBBBBBBB',
        'BBBBBBBBBBBb',
        '.PPPpPPPpPP.',
        'PPPpPPPpPPPP',
        '.PPpPPPpPP..',
        '.SSsSSSsSSS.',
        '.SSsSSSsSSS.',
        '..sSSSSSSs..',
        '..sSSSSSSs..',
      ],
      S:[
        '.MHHhHHMl.',
        'MHlHHHlHM.',
        '.lHHHHHHl.',
        '..HHHHHHh.',
        '..hHHHHhH.',
        '..FFFFfFF.',
        '.FEFfFFF..',
        '.FFFffFF..',
        '..NNfFNN..',
        '.BBBBBBBBB',
        'bBcBBBBBb.',
        'BBBBVvBBBb',
        'BBBBVvBBBb',
        'BBBBBBBBBBB',
        '.PPPpPPPpP.',
        'PPPpPPPpPPP',
        '.PPpPPPpP..',
        '.SSsSSSsSS.',
        '..sSSSSSss.',
      ],
    };

    // ── ASH (red cap Pokemon trainer) ────────────────────────
    const palAsh = {
      H:'#241410', h:'#180e08',
      F:'#e8c890', f:'#c8a070',
      E:'#241410',
      B:'#1a3878', b:'#102450', c:'#2a4898',
      N:'#f0e8d8',
      V:'#d82828', v:'#901818',
      A:'#f4d850', a:'#c0a020',
      P:'#1a3a1a', p:'#0e280e',
      S:'#282018', s:'#1a1408',
    };
    const sprAsh = {
      D:[
        '..vVVVVVvv..',
        '.VVVVVVVVVv.',
        '.vcVVVVVVvv.',
        '.VVVVVVVVV..',
        '.NnNNNNNNNn.',
        '..HhFFFFhH..',
        '.FFFEFFEFff.',
        '.FFFfffFFFf.',
        '..NnFNNNnN..',
        '.BBBBBBBBBB.',
        'bBcBBBBBBbB.',
        '.AAAAAAAAAA.',
        '.BBBBBBBBBB.',
        '.BBBBBBBBBB.',
        '.PPPpPPPpPP.',
        '.PPPpPPPpPP.',
        '..PPpPPPpPP.',
        '..SSsSSSsSS.',
        '..sSSSSSSSs.',
      ],
      U:[
        '..vVVVVVvv..',
        '.VVVVVVVVVv.',
        '.vcVVVVVVvv.',
        '.VVVVVVVVV..',
        '.NnNNNNNNNn.',
        '.BBBBBBBBBB.',
        'bBcBBBBBBbB.',
        'BBBBBBBBBBBb',
        '.AAAAAAAAAA.',
        'AAAAAAAAAAAAA',
        '.BBBBBBBBBB.',
        '.BBBBBBBBBB.',
        '.PPPpPPPpPP.',
        '.PPPpPPPpPP.',
        '..PPpPPPpPP.',
        '..SSsSSSsSS.',
        '..SSsSSSsSS.',
        '..sSSSSSSSs.',
        '..sSSSSSSSs.',
      ],
      S:[
        '..vVVVVvv.',
        '.VVVVVVVVv',
        '.vcVVVVVvv',
        '.VVVVVVVVV',
        '.NnNNNNNNn',
        '..HhFFFFhH',
        '.FFFEFFFff.',
        '.FFFfffFff.',
        '..NnFNNNn..',
        '.BBBBBBBBB.',
        'bBcBBBBBb..',
        '.AAAAAAAAA.',
        '.BBBBBBBBB.',
        '.PPPpPPPpP.',
        'PPPpPPPpPPP',
        '.PPpPPPpP..',
        '.SSsSSSsSS.',
        '..sSSSSSSSs',
      ],
    };

    // ── Generic NPC ───────────────────────────────────────────
    const makeGenericPal = (bodyHex, hairHex) => {
      const ri = parseInt(bodyHex.slice(1,3),16);
      const gi = parseInt(bodyHex.slice(3,5),16);
      const bi = parseInt(bodyHex.slice(5,7),16);
      const d = (n) => Math.max(0,n-45).toString(16).padStart(2,'0');
      const u = (n) => Math.min(255,n+35).toString(16).padStart(2,'0');
      return {
        B: bodyHex,
        b: `#${d(ri)}${d(gi)}${d(bi)}`,
        c: `#${u(ri)}${u(gi)}${u(bi)}`,
        H: hairHex||'#1a1010', h:'#0e0808', l:'#2a2020',
        F:'#e0b888', f:'#c09060', E:'#180e08',
        N:'#e0d8c0',
        P:'#1a1a30', p:'#0e0e1e',
        S:'#2a1808', s:'#180e04',
      };
    };
    const sprGenericD = [
      '..hHHHHHhH..',
      '.HHHHHHHHHh.',
      '.HHHHHHHHHh.',
      '..FFFFFFfF..',
      '.FfEFFfEFF..',
      '.FFFfffFFF..',
      '.BBBBBBBBBB.',
      'bBcBBBBBBbB.',
      'BBBBBBBBBBBb',
      '.BBBBBBBBBB.',
      '.PPPpPPPpPP.',
      'PPPpPPPpPPPP',
      '.SSsSSSsSSS.',
    ];
    const sprGenericU = [
      '..hHHHHHhH..',
      '.HHHHHHHHHh.',
      '.HHHHHHHHHh.',
      '.BBBBBBBBBB.',
      'bBcBBBBBBbB.',
      'BBBBBBBBBBBb',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '.PPPpPPPpPP.',
      'PPPpPPPpPPPP',
      '.PPpPPPpPP..',
      '.SSsSSSsSSS.',
      '..sSSSSSSs..',
    ];
    const sprGenericS = [
      '..hHHHhH..',
      '.HHHHHHHh.',
      '.HHHHHHHh.',
      '..FFFFfF..',
      '.FEFfFFF..',
      '.FFFffFF..',
      '.BBBBBBBBB',
      'bBcBBBBBb.',
      'BBBBBBBBBb',
      '.BBBBBBBb.',
      '.PPPpPPpP.',
      'PPPpPPpPPP',
      '.SSsSsSSSS',
    ];

    const getSpr = (o, face) =>
      face==='up' ? o.U : (face==='left'||face==='right') ? o.S : o.D;
    const isFlip = (face) => face === 'right';

    const drawCharacter = (gx, gy, bodyColor, face, faded, isPlayer, npcId) => {
      const sx = (gx - camX) * TILE;
      const sy = (gy - camY) * TILE;
      const cx = sx + TILE / 2;
      const baseY = sy + TILE - 2 + BOB;
      if (faded) ctx.globalAlpha = 0.38;
      drawShadow(cx, sy + TILE);
      let rows, pal;
      if (isPlayer)              { rows=getSpr(sprPlayer,face); pal=palPlayer; }
      else if (npcId==='yugi')   { rows=getSpr(sprYugi,face);  pal=palYugi;   }
      else if (npcId==='ash')    { rows=getSpr(sprAsh,face);   pal=palAsh;    }
      else if (npcId==='vaultkeeper'){ rows=getSpr(sprKeeper,face); pal=palKeeper; }
      else if (npcId==='bran')   { rows=getSpr(sprBran,face);  pal=palBran;   }
      else if (npcId==='ria')    { rows=getSpr(sprRia,face);   pal=palRia;    }
      else if (npcId==='dax')    { rows=getSpr(sprDax,face);   pal=palDax;    }
      else if (npcId==='guide')  { rows=getSpr(sprGuide,face); pal=palGuide;  }
      else if (npcId==='merle')  { rows=getSpr(sprMerle,face); pal=palMerle;  }
      else {
        pal=makeGenericPal(bodyColor||'#4a6ea0','#1a1010');
        rows = face==='up' ? sprGenericU
             : (face==='left'||face==='right') ? sprGenericS
             : sprGenericD;
      }
      drawPS(rows, pal, cx, baseY, isFlip(face));
      if (faded) ctx.globalAlpha = 1;
    };
        for (let py = 0; py < VH; py++) {
      for (let px = 0; px < VW; px++) {
        const gx = camX + px, gy = camY + py;
        const t = map[gy]?.[gx] ?? 't';
        drawGround(t, gx, gy);
      }
    }

    // ---- PASS 2: elevated objects + characters, sorted by Y row ----
    const ELEVATED = new Set(['t', 'k', 'r', 'w', 'B', 's']);
    const drawList = [];
    for (let py = 0; py < VH; py++) {
      for (let px = 0; px < VW; px++) {
        const gx = camX + px, gy = camY + py;
        const t = map[gy]?.[gx] ?? 't';
        if (!ELEVATED.has(t)) continue;
        drawList.push({ y: gy, draw: () => drawObject(t, gx, gy) });
      }
    }
    const npcs = currentMap === 'town' ? NPCS_TOWN : (NPCS_ZONE[currentMap] || []);
    for (const n of npcs) {
      // Read the wandered live position so the sprite draws where the NPC
      // actually is, not their authored home.
      const off = npcMoveState[n.id];
      const lx = n.x + (off ? off.dx : 0);
      const ly = n.y + (off ? off.dy : 0);
      const lf = off ? off.face : n.face;
      if (lx < camX || lx >= camX + VW || ly < camY || ly >= camY + VH) continue;
      drawList.push({
        y: ly + 0.4,
        draw: () => {
          drawCharacter(lx, ly, n.color, lf, defeated.includes(n.id), false, n.id);
          if (n.isShop) {
            const sx = (lx - camX) * TILE;
            const sy = (ly - camY) * TILE;
            ctx.fillStyle = '#ffd870';
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('◆', sx + TILE / 2, sy - 2);
            ctx.textAlign = 'left';
          }
        },
      });
    }
    drawList.push({
      y: player.y + 0.4,
      draw: () => drawCharacter(player.x, player.y, '#3a6ea5', player.face, false, true),
    });
    drawList.sort((a, b) => a.y - b.y);
    for (const item of drawList) item.draw();

    // ---- PASS 3: hidden item sparkles ──────────────────────────────────────
    // Pulsing gold ✦ floats above any hidden item that hasn't been found today.
    // The sparkle is drawn AFTER characters so it's always visible on top.
    const today = realDayNumber();
    for (const hi of HIDDEN_ITEMS) {
      if (hi.map !== currentMap) continue;
      if (hiddenItemsFound[hiddenItemKey(hi)] === today) continue; // already found today
      // Only draw if the tile is walkable (sparkles don't float on walls/trees)
      const hiTile = tileAt(currentMap, hi.x, hi.y);
      if (!isWalkable(hiTile)) continue;
      if (hi.x < camX || hi.x >= camX + VW || hi.y < camY || hi.y >= camY + VH) continue;
      const sx = (hi.x - camX) * TILE + TILE / 2;
      const sy = (hi.y - camY) * TILE;
      // Multi-layer pulse: outer glow + inner sparkle, breathing at different rates
      const pulse  = 0.5 + 0.5 * Math.abs(Math.sin(animFrame * 0.18 + hi.x * 1.3 + hi.y * 0.7));
      const pulse2 = 0.6 + 0.4 * Math.abs(Math.cos(animFrame * 0.28 + hi.x * 0.9));
      // Outer halo
      ctx.globalAlpha = 0.30 * pulse;
      ctx.fillStyle = '#ffe080';
      ctx.fillRect(sx - 5, sy - 9, 10, 10);
      // Middle glow pixel ring
      ctx.globalAlpha = 0.55 * pulse;
      ctx.fillStyle = '#ffd040';
      ctx.fillRect(sx - 3, sy - 7, 6, 6);
      // Bright core dot
      ctx.globalAlpha = 0.90 * pulse2;
      ctx.fillStyle = '#fff8c0';
      ctx.fillRect(sx - 1, sy - 5, 3, 3);
      // Tiny cross arms (sparkle effect)
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.70 * pulse2;
      ctx.fillRect(sx,     sy - 8, 1, 7); // vertical arm
      ctx.fillRect(sx - 3, sy - 5, 7, 1); // horizontal arm
      ctx.globalAlpha = 1;
    }

    // ---- ambient zone particles (very light, non-blocking) ----
    if (currentMap === 'ashen') {
      for (let i = 0; i < 4; i++) {
        const ex = (animFrame * 2 + i * 91) % CW;
        const ey = (CH - ((animFrame * 1.3 + i * 53) % CH));
        ctx.fillStyle = 'rgba(255, 140, 60, 0.55)';
        ctx.fillRect(ex, ey, 1, 1);
      }
    } else if (currentMap === 'plains') {
      for (let i = 0; i < 5; i++) {
        const ex = (animFrame * 1.5 + i * 71) % CW;
        const ey = (animFrame * 0.8 + i * 47) % CH;
        ctx.fillStyle = 'rgba(255, 245, 200, 0.5)';
        ctx.fillRect(ex, ey, 1, 1);
      }
    } else if (currentMap === 'umbral') {
      for (let i = 0; i < 3; i++) {
        const ex = (animFrame + i * 89) % CW;
        const ey = (animFrame * 0.7 + i * 61) % CH;
        ctx.fillStyle = 'rgba(180, 120, 220, 0.4)';
        ctx.fillRect(ex, ey, 1, 1);
      }
    } else if (SHRINE_TO_ZONE[currentMap]) {
      const zoneId = SHRINE_TO_ZONE[currentMap];
      const sd = zoneId && SHRINE_DATA[zoneId];
      const col = sd ? COLOR_HEX[sd.color] : '#fff';
      for (let i = 0; i < 4; i++) {
        const ex = (animFrame * 1.2 + i * 79) % CW;
        const ey = (animFrame * 0.6 + i * 53) % CH;
        ctx.fillStyle = col + '80';
        ctx.fillRect(ex, ey, 1, 1);
      }
    }

    // edge vignette
    const vg = ctx.createRadialGradient(CW / 2, CH / 2, 80, CW / 2, CH / 2, CW / 1.2);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, CW, CH);

    // ---- Day/night tint overlay ----
    // Indoor/shrine-interior maps don't get tinted — those are always lit.
    if (!SHRINE_TO_ZONE[currentMap]) {
      // Smooth interpolation across the day. We pick keyframe colors at
      // dawn(6), noon(12), dusk(18), midnight(0) and lerp between them.
      const dayPhase = hourOfDay; // 0..23
      let tint = null;
      if (dayPhase >= 6 && dayPhase < 12) {
        // dawn -> noon: warm orange fading to clear
        const k = (dayPhase - 6) / 6;
        tint = `rgba(255, 180, 110, ${0.20 - 0.20 * k})`;
      } else if (dayPhase >= 12 && dayPhase < 18) {
        // noon -> dusk: clear fading to amber
        const k = (dayPhase - 12) / 6;
        tint = `rgba(255, 140, 80, ${0.20 * k})`;
      } else if (dayPhase >= 18 && dayPhase < 21) {
        // dusk -> early night: amber fading to deep blue
        const k = (dayPhase - 18) / 3;
        tint = `rgba(${Math.round(255 - 215*k)}, ${Math.round(140 - 100*k)}, ${Math.round(80 + 60*k)}, ${0.22 + 0.18*k})`;
      } else {
        // night/predawn: deep blue
        // 21..23 and 0..5 — strongest tint at midnight (0/24)
        const dist = dayPhase >= 21 ? (dayPhase - 21) : dayPhase + 3;  // 0..8
        // Strongest at dist=3 (midnight = 24 mod), weakest at edges
        const intensity = 0.30 + 0.10 * (1 - Math.abs(dist - 3) / 3);
        tint = `rgba(40, 50, 110, ${intensity})`;
      }
      if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, CW, CH);
      }
    }
  }, [player, currentMap, scene, defeated, medallions, animFrame, npcMoveState, hourOfDay, hiddenItemsFound]);

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
        /* ---- Battle scene 2.5D animations ---- */
        @keyframes gtmBreathe {
          0%, 100% { transform: scale(1)      translateY(0); }
          50%      { transform: scale(1.025)  translateY(-1px); }
        }
        @keyframes gtmHitShake {
          0%   { transform: translateX(0)  rotate(0); filter: brightness(1.6) saturate(1.2); }
          15%  { transform: translateX(-5px) rotate(-3deg); filter: brightness(1.8); }
          30%  { transform: translateX(5px)  rotate(3deg);  filter: brightness(1.8); }
          45%  { transform: translateX(-4px) rotate(-2deg); filter: brightness(1.4); }
          60%  { transform: translateX(4px)  rotate(2deg);  filter: brightness(1.2); }
          80%  { transform: translateX(-2px) rotate(0);     filter: brightness(1.05); }
          100% { transform: translateX(0)    rotate(0);     filter: brightness(1); }
        }
        @keyframes gtmCastLeft {
          0%   { transform: translateX(0)    scale(1); }
          25%  { transform: translateX(-6px) scale(0.94); }
          55%  { transform: translateX(14px) scale(1.08); }
          80%  { transform: translateX(2px)  scale(1.02); }
          100% { transform: translateX(0)    scale(1); }
        }
        @keyframes gtmCastRight {
          0%   { transform: translateX(0)     scale(1); }
          25%  { transform: translateX(6px)   scale(0.94); }
          55%  { transform: translateX(-14px) scale(1.08); }
          80%  { transform: translateX(-2px)  scale(1.02); }
          100% { transform: translateX(0)     scale(1); }
        }
        @keyframes gtmProjectilePtoE {
          /* player on the left -> enemy on the right; arcs up then down */
          0%   { left: 22%; bottom: 24%; transform: scale(0.4); opacity: 0; }
          15%  { opacity: 1; }
          50%  { left: 50%; bottom: 60%; transform: scale(1.0); opacity: 1; }
          90%  { left: 76%; bottom: 30%; transform: scale(1.1); opacity: 1; }
          100% { left: 76%; bottom: 30%; transform: scale(0.6); opacity: 0; }
        }
        @keyframes gtmProjectileEtoP {
          /* enemy on the right -> player on the left; arcs up then down */
          0%   { left: 76%; bottom: 24%; transform: scale(0.4); opacity: 0; }
          15%  { opacity: 1; }
          50%  { left: 50%; bottom: 60%; transform: scale(1.0); opacity: 1; }
          90%  { left: 22%; bottom: 30%; transform: scale(1.1); opacity: 1; }
          100% { left: 22%; bottom: 30%; transform: scale(0.6); opacity: 0; }
        }
        @keyframes gtmImpact {
          0%   { transform: translate(-50%, -50%) scale(0.2); opacity: 0; }
          25%  { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          70%  { transform: translate(-50%, -50%) scale(2.2); opacity: 0.5; }
          100% { transform: translate(-50%, -50%) scale(2.8); opacity: 0; }
        }
        @keyframes gtmSpark {
          0%   { transform: translate(0,0) scale(1); opacity: 1; }
          100% { transform: translate(var(--gtm-dx, 0), var(--gtm-dy, 0)) scale(0.2); opacity: 0; }
        }
        @keyframes gtmDriftSlow {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-40px); }
        }
        @keyframes gtmDriftFast {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-90px); }
        }
        @keyframes gtmHealGlow {
          0%   { transform: scale(0.6); opacity: 0; }
          25%  { transform: scale(1.0); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        /* ---- Batch 1: scene transitions, damage numbers, catch wobble, crit shake ---- */
        /* Iris-close: shrinking circular cutout reveals black. Used when entering battle. */
        @keyframes gtmIrisClose {
          0%   { clip-path: circle(150% at 50% 50%); opacity: 1; }
          100% { clip-path: circle(0% at 50% 50%); opacity: 1; }
        }
        /* Iris-open: opens from a tight circle outward. Used on battle exit. */
        @keyframes gtmIrisOpen {
          0%   { clip-path: circle(0% at 50% 50%); opacity: 1; }
          100% { clip-path: circle(150% at 50% 50%); opacity: 1; }
        }
        /* Plain fade for map / building transitions */
        @keyframes gtmFadeBlack {
          0%   { opacity: 0; }
          50%  { opacity: 1; }
          100% { opacity: 0; }
        }
        /* Damage number floats up and fades over ~900ms */
        @keyframes gtmDmgFloat {
          0%   { transform: translate(-50%, 0)    scale(0.6); opacity: 0; }
          15%  { transform: translate(-50%, -8px) scale(1.25); opacity: 1; }
          30%  { transform: translate(-50%, -14px) scale(1.0); opacity: 1; }
          80%  { transform: translate(-50%, -36px) scale(1.0); opacity: 0.85; }
          100% { transform: translate(-50%, -48px) scale(0.9); opacity: 0; }
        }
        /* Catch card 3-wobble-with-pauses sequence (total ~1.4s) */
        @keyframes gtmCatchWobble {
          0%, 100%  { transform: rotate(0); }
          /* wobble 1 */
          5%        { transform: rotate(-12deg); }
          10%       { transform: rotate(10deg); }
          15%, 28%  { transform: rotate(0); }            /* pause */
          /* wobble 2 */
          33%       { transform: rotate(-12deg); }
          38%       { transform: rotate(10deg); }
          43%, 58%  { transform: rotate(0); }            /* pause */
          /* wobble 3 (final, slightly bigger) */
          63%       { transform: rotate(-14deg); }
          68%       { transform: rotate(12deg); }
          73%, 100% { transform: rotate(0); }
        }
        /* Critical hit: full battle scene shakes briefly (camera shake) */
        @keyframes gtmCamShake {
          0%, 100% { transform: translate(0, 0); }
          15%      { transform: translate(-3px, 2px); }
          30%      { transform: translate(3px, -2px); }
          45%      { transform: translate(-2px, -2px); }
          60%      { transform: translate(2px, 2px); }
          75%      { transform: translate(-1px, 1px); }
          90%      { transform: translate(1px, 0); }
        }
        /* ---- Batch 2: menu slide-in, dialog slide-up, sprint indicator pulse ---- */
        @keyframes gtmMenuSlideIn {
          0%   { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0);    opacity: 1; }
        }
        @keyframes gtmDialogSlideUp {
          0%   { transform: translateY(40px); opacity: 0; }
          100% { transform: translateY(0);    opacity: 1; }
        }
        @keyframes gtmSprintPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255, 200, 80, 0.6); }
          50%      { box-shadow: 0 0 0 6px rgba(255, 200, 80, 0); }
        }
        /* ---- Batch 3: XP shimmer, level-up glow, mini-map fade ---- */
        @keyframes gtmXpShimmer {
          0%   { background-position: -120% 0; }
          100% { background-position: 220% 0; }
        }
        @keyframes gtmLevelGlow {
          0%   { box-shadow: 0 0 0 0   rgba(255, 220, 120, 0); }
          25%  { box-shadow: 0 0 14px 3px rgba(255, 220, 120, 0.85); }
          100% { box-shadow: 0 0 0 0   rgba(255, 220, 120, 0); }
        }
        @keyframes gtmFadeIn {
          0%   { opacity: 0; transform: scale(0.96); }
          100% { opacity: 1; transform: scale(1); }
        }
        /* ---- Weather animations ---- */
        @keyframes gtmRainFall {
          0%   { transform: rotate(15deg) translate(0, -10px); opacity: 0; }
          15%  { opacity: 0.65; }
          85%  { opacity: 0.65; }
          100% { transform: rotate(15deg) translate(20px, 160px); opacity: 0; }
        }
        @keyframes gtmSandDrift {
          0%   { transform: translateX(0); opacity: 0; }
          15%  { opacity: 0.55; }
          85%  { opacity: 0.55; }
          100% { transform: translateX(540px); opacity: 0; }
        }
        @keyframes gtmPetalDrift {
          0%   { transform: translate(0, -10px) rotate(0deg); opacity: 0; }
          12%  { opacity: 0.7; }
          85%  { opacity: 0.7; }
          100% { transform: translate(40px, 160px) rotate(360deg); opacity: 0; }
        }
        @keyframes gtmSunPulse {
          0%, 100% { opacity: 0.65; }
          50%      { opacity: 0.95; }
        }
        @keyframes gtmEclipsePulse {
          0%, 100% { opacity: 0.85; }
          50%      { opacity: 1.0; }
        }
        @keyframes gtmPlanarRing {
          0%, 100% { opacity: 0.10; transform: translate(-50%, -50%) scale(0.95); }
          50%      { opacity: 0.30; transform: translate(-50%, -50%) scale(1.05); }
        }
        @keyframes gtmSparkle {
          0%, 100% { opacity: 0.2; transform: scale(0.7); }
          50%      { opacity: 1.0; transform: scale(1.2); }
        }
        /* Daily-encounter aura — slow pulse behind the rare phantom variant
           sprite. Pulses scale + opacity together for a "this creature is
           special" rarity shimmer. */
        @keyframes gtmDailyAura {
          0%, 100% { opacity: 0.55; transform: translateX(-50%) scale(0.9); }
          50%      { opacity: 1.0;  transform: translateX(-50%) scale(1.15); }
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
          width: 70px; height: 70px; background: #1a1428; border: 2px solid #4a3a68;
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
            {hasSaveClassic && (
              <button className="mtgBtn" onClick={() => continueSave('classic')} style={{ fontSize: 16, padding: '12px' }}>
                ▸ Continue Classic
              </button>
            )}
            {hasSaveCommander && (
              <button className="mtgBtn" onClick={() => continueSave('commander')} style={{ fontSize: 16, padding: '12px' }}>
                ▸ Continue Commander
              </button>
            )}
            <button className="mtgBtn" onClick={startNew} style={{ fontSize: 16, padding: '12px' }}>
              {(hasSaveClassic || hasSaveCommander) ? '+ New Game' : 'Begin'}
            </button>
            {(hasSaveClassic || hasSaveCommander) && (
              <div style={{ display: 'flex', gap: 6 }}>
                {hasSaveClassic && (
                  <button className="mtgBtn" onClick={async () => { await clearSave('classic'); setHasSaveClassic(false); }} style={{ flex: 1, fontSize: 10, padding: '5px', opacity: 0.55 }}>
                    Delete Classic Save
                  </button>
                )}
                {hasSaveCommander && (
                  <button className="mtgBtn" onClick={async () => { await clearSave('commander'); setHasSaveCommander(false); }} style={{ flex: 1, fontSize: 10, padding: '5px', opacity: 0.55 }}>
                    Delete Commander Save
                  </button>
                )}
              </div>
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
          <TopBar mapName={MAPS[currentMap].name} tokens={tokens} gold={gold} team={team} mode={mode} commanderColor={commanderColor} hourOfDay={hourOfDay} currentPlane={currentPlane} onMenu={() => { audio.sfx.menuOpen(); setScene('menu'); }} />

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
            {/* Auto-save indicator — flashes briefly after a successful save.
                Top-LEFT of canvas so it doesn't fight the map button on the right. */}
            {savingFlash && (
              <div style={{
                position: 'absolute', top: 4, left: 4, zIndex: 10,
                padding: '3px 8px',
                background: 'rgba(20, 12, 36, 0.85)',
                border: '1px solid #6a5a88',
                borderRadius: 4,
                fontSize: 10, color: '#c8b8e0',
                letterSpacing: 1,
                animation: 'gtmFadeIn 0.2s ease-out',
                fontFamily: "'Cinzel', serif",
                pointerEvents: 'none',
              }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6,
                  background: '#9a80c0', borderRadius: '50%',
                  marginRight: 5, verticalAlign: 'middle',
                  animation: 'pulse 0.7s ease-in-out infinite',
                }} />
                SAVED
              </div>
            )}
            {/* Mini-map toggle button — top-right corner of the canvas */}
            <button
              onClick={() => setMiniMapOpen(v => !v)}
              title={miniMapOpen ? 'Close map (M)' : 'Open map (M)'}
              style={{
                position: 'absolute', top: 4, right: 4, zIndex: 10,
                width: 28, height: 28, border: '1px solid #6a5a88',
                borderRadius: 4, background: 'rgba(20, 12, 36, 0.85)',
                color: '#e8dcc0', fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, padding: 0,
              }}
            >
              {miniMapOpen ? '✕' : '🗺'}
            </button>
            {/* Mini-map overlay — full-canvas rendering of the current map at
                low resolution with player/NPC dots. Tap anywhere to dismiss. */}
            {miniMapOpen && (
              <MiniMap
                map={MAPS[currentMap]}
                player={player}
                npcs={currentMap === 'town' ? NPCS_TOWN : (NPCS_ZONE[currentMap] || [])}
                npcMoveState={npcMoveState}
                defeated={defeated}
                onClose={() => setMiniMapOpen(false)}
              />
            )}
            {/* Scoped iris overlay — covers only the canvas viewport,
                so TopBar / dpad stay visible during the transition. */}
            {transitionFx && (
              <div key={transitionFx.key} style={{
                position: 'absolute', inset: 0, zIndex: 50,
                background: '#000',
                borderRadius: 6,
                pointerEvents: 'none',
                animation:
                  transitionFx.kind === 'irisIn'  ? 'gtmIrisClose 0.34s ease-in forwards' :
                  transitionFx.kind === 'irisOut' ? 'gtmIrisOpen 0.36s ease-out forwards' :
                  transitionFx.kind === 'fade'    ? 'gtmFadeBlack 0.4s ease-in-out forwards' :
                  undefined,
              }} />
            )}
            {/* toast moved to global overlay so it shows on any scene */}
          </div>

          <Controls onMove={move} onA={interact} onB={() => { audio.sfx.menuOpen(); setScene('menu'); }} sprinting={sprinting} onToggleSprint={() => setSprinting(v => !v)} />
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
          transitionFx={transitionFx}
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
          currentPlane={currentPlane}
          planeBaseLevel={planeBaseLevel}
          planeDualPairs={planeDualPairs}
          dualMedallions={dualMedallions}
          vaultCount={vaultCreatures.length}
          lastDailyEncounters={lastDailyEncounters}
          hourOfDay={hourOfDay}
          currentMap={currentMap}
          onOpenVault={() => {
            // Opening from the menu sets vaultOrigin so the vault's close button
            // returns to the menu instead of the world.
            audio.sfx.menuOpen();
            setVaultOrigin('menu');
            setScene('vault');
          }}
          onRename={(uid) => setRenameUid(uid)}
          onSwapMoves={(uid, fromIdx, toIdx) => {
            setTeam(tt => tt.map(c => {
              if (c.uid !== uid) return c;
              const moves = [...c.moves];
              const tmp = moves[fromIdx];
              moves[fromIdx] = moves[toIdx];
              moves[toIdx] = tmp;
              return { ...c, moves };
            }));
            audio.sfx.blip();
          }}
          onUseItem={useItemOn}
          onEquipItem={(uid, itemKey) => {
            // Move the old held item back to bag, take the new one from bag.
            setTeam(tm => {
              const creature = tm.find(c => c.uid === uid);
              if (!creature) return tm;
              const oldKey = creature.heldItem;
              setItems(it => {
                const next = { ...it };
                if (oldKey) next[oldKey] = (next[oldKey] || 0) + 1;
                if (itemKey) next[itemKey] = Math.max(0, (next[itemKey] || 0) - 1);
                return next;
              });
              return tm.map(c => c.uid === uid
                ? { ...c, heldItem: itemKey || null, heldItemCharged: false }
                : c);
            });
          }}
          onCall={(npc) => { audio.sfx.menuClose(); setScene('world'); startPhoneRematch(npc); }}
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
              if (mode === 'commander') setHasSaveCommander(true);
              else setHasSaveClassic(true);
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
              // Check both save slots
              for (const [label, m] of [['Classic', 'classic'], ['Commander', 'commander']]) {
                try {
                  const r = await window.storage.get(getSaveKey(m));
                  if (!r?.value) {
                    lines.push(`${label} save: NONE`);
                  } else {
                    let parsed; try { parsed = JSON.parse(r.value); } catch { parsed = null; }
                    if (!parsed) {
                      lines.push(`${label} save: present but not parseable (${r.value.length} bytes)`);
                    } else {
                      const teamSummary = (parsed.team || []).map(c => `${c.name} Lv${c.level}`).join(', ') || '(empty)';
                      lines.push(`${label} — Map: ${parsed.currentMap} · Gold: ${parsed.gold}`);
                      lines.push(`  Team: ${teamSummary}`);
                      if (parsed.currentPlane > 0) lines.push(`  Plane: ${parsed.currentPlane}`);
                      lines.push(`  Bytes: ${r.value.length}`);
                    }
                  }
                } catch (e) { lines.push(`${label} read error: ${e?.message || e}`); }
              }
            }
            setDialog({ lines, onDone: () => setDialog(null) });
          }}
          onReset={async () => {
            await clearSave(mode);
            setTeam([]); setVaultCreatures([]); setCodex({}); setLastDailyEncounters({}); setHiddenItemsFound({}); setDefeated([]); setTokens(5); setGold(0); setItems({ potion: 2 });
            setMode('classic'); setCommanderColor(""); setTrainerCycles(0);
            setMedallions([]); setPlaneswalkerDefeated(false); setChampionLearnPending(false);
            setCurrentPlane(0); setPlaneBaseLevel(0); setPlaneZoneOrder(null); setPlanePending(false);
            setPlaneDualPairs(null); setDualMedallions([]);
            if (mode === 'commander') setHasSaveCommander(false);
            else setHasSaveClassic(false);
            setScene('title');
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

      {scene === 'vault' && (
        <VaultScene
          team={team}
          vault={vaultCreatures}
          mode={mode}
          onDeposit={(uid) => {
            // Move from team → vault. Disallow last team member and (in commander
            // mode) the commander. Restores HP slightly while in storage so
            // returning fighters aren't perpetually wounded.
            if (mode === 'commander') {
              const idx = team.findIndex(c => c.uid === uid);
              if (idx === 0) { showToast('The commander cannot be stored.'); return; }
            }
            if (team.length <= 1) { showToast('At least one creature must stay with you.'); return; }
            const c = team.find(t => t.uid === uid);
            if (!c) return;
            setTeam(tt => tt.filter(t => t.uid !== uid));
            setVaultCreatures(v => [...v, c]);
            audio.sfx.confirm();
            showToast(`${displayName(c)} entered the Vault.`);
          }}
          onWithdraw={(uid) => {
            // Move from vault → team if there's room. If the team is full, the
            // VaultScene swap UI handles the picker — this path only fires when
            // there's open space.
            if (team.length >= 6) { showToast('Team is full — choose someone to swap.'); return; }
            const c = vaultCreatures.find(v => v.uid === uid);
            if (!c) return;
            setVaultCreatures(v => v.filter(t => t.uid !== uid));
            setTeam(tt => [...tt, c]);
            audio.sfx.confirm();
            showToast(`${displayName(c)} rejoined your party.`);
          }}
          onSwap={(teamUid, vaultUid) => {
            // Two-way swap: a team creature moves to the vault, a vault creature
            // moves into that team slot (preserving slot order).
            if (mode === 'commander') {
              const idx = team.findIndex(c => c.uid === teamUid);
              if (idx === 0) { showToast('The commander cannot be stored.'); return; }
            }
            const tIdx = team.findIndex(c => c.uid === teamUid);
            const v = vaultCreatures.find(v => v.uid === vaultUid);
            if (tIdx < 0 || !v) return;
            const departing = team[tIdx];
            setTeam(tt => tt.map((c, i) => i === tIdx ? v : c));
            setVaultCreatures(vv => [...vv.filter(x => x.uid !== vaultUid), departing]);
            audio.sfx.confirm();
            showToast(`${displayName(v)} ↔ ${displayName(departing)}`);
          }}
          onRename={(uid) => setRenameUid(uid)}
          onRelease={(uid, fromVault) => {
            const list = fromVault ? vaultCreatures : team;
            const c = list.find(x => x.uid === uid);
            if (!c) return;
            // Block release of commander and last team member (vault releases are always fine).
            if (!fromVault) {
              if (mode === 'commander') {
                const idx = team.findIndex(x => x.uid === uid);
                if (idx === 0) { showToast('The commander cannot be released.'); return; }
              }
              if (team.length <= 1) { showToast('At least one creature must stay with you.'); return; }
            }
            if (fromVault) setVaultCreatures(v => v.filter(x => x.uid !== uid));
            else setTeam(tt => tt.filter(x => x.uid !== uid));
            audio.sfx.confirm();
            showToast(`${displayName(c)} returned to the wild.`);
          }}
          onClose={() => {
            audio.sfx.menuClose();
            // Return to wherever the vault was opened from — talking to the keeper
            // sends us back to the world; the in-menu sigil shortcut sends us back
            // to the menu so the player can keep browsing items/team afterwards.
            setScene(vaultOrigin === 'menu' ? 'menu' : 'world');
          }}
        />
      )}

      {/* ======================= DIALOG (typewriter reveal) ======================= */}
      {dialog && <DialogPanel key={dialog.lines.join('|')} dialog={dialog} />}

      {/* ======================= NICKNAME / RENAME =======================
          Looks the uid up in both the team and the vault, so a creature caught
          while the team was full can still be nicknamed at catch time even if
          the player chose to leave it in storage. */}
      {renameUid && (() => {
        const inTeam = team.find(c => c.uid === renameUid);
        const inVault = !inTeam && vaultCreatures.find(c => c.uid === renameUid);
        const c = inTeam || inVault;
        if (!c) return null;
        return (
          <RenamePrompt
            creature={c}
            onConfirm={(nick) => {
              if (inTeam) {
                setTeam(tt => tt.map(t => t.uid === renameUid ? { ...t, nick: nick || undefined } : t));
              } else {
                setVaultCreatures(vv => vv.map(v => v.uid === renameUid ? { ...v, nick: nick || undefined } : v));
              }
              setRenameUid(null);
              audio.sfx.confirm();
            }}
            onCancel={() => setRenameUid(null)}
          />
        );
      })()}

      {/* ======================= POST-CATCH VAULT SWAP PROMPT =======================
          Fires after a successful catch when the team was full. The new creature
          is already in the vault by this point — this prompt offers to bring it
          out (and send a team member to the vault in its place), or leave it
          there to deal with later via the Vault Keeper. */}
      {vaultSwapUid && (() => {
        const newcomer = vaultCreatures.find(c => c.uid === vaultSwapUid);
        if (!newcomer) { setVaultSwapUid(null); return null; }
        return (
          <VaultSwapPrompt
            newcomer={newcomer}
            team={team}
            mode={mode}
            onSwap={(teamUid) => {
              const tIdx = team.findIndex(c => c.uid === teamUid);
              if (tIdx < 0) return;
              const departing = team[tIdx];
              setTeam(tt => tt.map((c, i) => i === tIdx ? newcomer : c));
              setVaultCreatures(vv => [...vv.filter(x => x.uid !== vaultSwapUid), departing]);
              setVaultSwapUid(null);
              setRenameUid(newcomer.uid);  // chain into nickname prompt for the newcomer
              audio.sfx.confirm();
              showToast(`${displayName(departing)} → Vault. ${displayName(newcomer)} → Team.`);
            }}
            onKeep={() => {
              // Even when leaving the newcomer in the vault, give the player the
              // chance to nickname it now (the rename modal handles vault uids).
              setVaultSwapUid(null);
              setRenameUid(newcomer.uid);
              audio.sfx.menuClose();
            }}
          />
        );
      })()}

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
// MINI-MAP — full-map overview at low resolution, toggleable
// =========================================================================
// Renders each tile as a 1-2 pixel square colored by tile type. The player is
// a bright pulsing dot, NPCs are dim circles (gray for defeated). Tapping
// anywhere dismisses the overlay. The viewport sits inside the canvas so it
// doesn't cover the dpad/topbar.
function MiniMap({ map, player, npcs, npcMoveState, defeated, onClose }) {
  const tiles = map.tiles;
  const H = tiles.length;
  const W = tiles[0].length;
  // Scale to fit a 280x280 box (the canvas is up to 320px); leave padding.
  const SIZE = 280;
  const cell = Math.max(1, Math.floor(Math.min(SIZE / W, SIZE / H)));
  const mapW = cell * W;
  const mapH = cell * H;

  // Color per tile type — kept simple and high-contrast for the bird's-eye view.
  const COLOR = {
    '.': '#4a7a3a', g: '#2e5a22', p: '#c9a96a', a: '#5a4e48',
    l: '#c84020', u: '#3a6a90', o: '#1a3a60',
    m: '#2a3a26', v: '#1a2814', c: '#d8cca0', f: '#bcd088',
    F: '#3a3242', L: '#a82c8a',
    E: '#7a5a20', d: '#b59a7a', s: '#b8a070',
    t: '#1a3a14', k: '#5a504c', r: '#6a2818', w: '#9a8060', B: '#3a2418',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 40,
        background: 'rgba(8, 4, 16, 0.92)',
        borderRadius: 6,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        animation: 'gtmFadeIn 0.18s ease-out',
        cursor: 'pointer',
      }}
    >
      <div style={{
        fontSize: 11, color: '#e8dcc0', letterSpacing: 1.5,
        marginBottom: 6, fontFamily: "'Cinzel', serif",
      }}>
        {map.name.toUpperCase()}
      </div>
      <div style={{
        position: 'relative',
        width: mapW, height: mapH,
        border: '1px solid #6a5a88',
        background: '#0a0614',
      }}>
        {/* Render each tile row */}
        {tiles.map((row, ty) => (
          <div key={ty} style={{ display: 'flex', height: cell }}>
            {row.map((ch, tx) => (
              <div key={tx} style={{
                width: cell, height: cell,
                background: COLOR[ch] || '#222',
              }} />
            ))}
          </div>
        ))}
        {/* NPCs as dim circles */}
        {npcs.map(n => {
          const off = npcMoveState && npcMoveState[n.id];
          const lx = n.x + (off ? off.dx : 0);
          const ly = n.y + (off ? off.dy : 0);
          const isDefeated = defeated.includes(n.id);
          return (
            <div key={n.id} style={{
              position: 'absolute',
              left: lx * cell - 1, top: ly * cell - 1,
              width: cell + 2, height: cell + 2,
              borderRadius: '50%',
              background: isDefeated ? '#605870' : '#e8dcc0',
              opacity: isDefeated ? 0.5 : 0.95,
              border: '1px solid #1a0e28',
              boxSizing: 'border-box',
            }} />
          );
        })}
        {/* Player marker — bright pulsing dot */}
        <div style={{
          position: 'absolute',
          left: player.x * cell - 1, top: player.y * cell - 1,
          width: cell + 2, height: cell + 2,
          borderRadius: '50%',
          background: '#ffd870',
          border: '1px solid #1a0e28',
          boxSizing: 'border-box',
          animation: 'pulse 1.2s ease-in-out infinite',
          boxShadow: '0 0 6px rgba(255, 216, 112, 0.9)',
        }} />
      </div>
      <div style={{
        fontSize: 9, color: '#9888b0', marginTop: 8, letterSpacing: 1,
      }}>
        TAP TO CLOSE · M
      </div>
    </div>
  );
}

// =========================================================================
// TOP BAR
// =========================================================================
function TopBar({ mapName, tokens, gold, team, mode, commanderColor, hourOfDay, currentPlane, onMenu }) {
  return (
    <div style={{ width: 'min(96vw, 480px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <div>
        <div style={{ fontSize: 14, letterSpacing: 1, color: '#e8dcc0', display: 'flex', alignItems: 'center', gap: 6 }}>
          {mapName}
          {/* Time-of-day icon: ☀ day, 🌅 dawn/dusk, 🌙 night. Title shows the hour. */}
          {hourOfDay !== undefined && (
            <span title={`${String(hourOfDay).padStart(2,'0')}:00`} style={{ fontSize: 12, opacity: 0.85 }}>
              {hourOfDay >= 6 && hourOfDay < 8   ? '🌅'
              : hourOfDay >= 8 && hourOfDay < 18 ? '☀️'
              : hourOfDay >= 18 && hourOfDay < 20 ? '🌇'
              : '🌙'}
            </span>
          )}
          {/* Plane badge — only shown from plane 1 onward */}
          {currentPlane > 0 && (
            <span title={`${getPlaneName(currentPlane)} — Plane ${currentPlane}`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 5px',
              background: `linear-gradient(90deg, #2a0c3c, #0c1a3c)`,
              border: '1px solid #c8a860',
              borderRadius: 3, fontSize: 9, color: '#f0d870', letterSpacing: 0.8,
              fontWeight: 700,
            }}>
              ✦ PLANE {currentPlane}
            </span>
          )}
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
function Controls({ onMove, onA, onB, sprinting, onToggleSprint }) {
  const press = (fn) => (e) => { e.preventDefault(); fn(); };
  return (
    <div style={{ width: 'min(96vw, 480px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', marginBottom: 'auto', padding: '0 24px 0 4px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', marginBottom: 50 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 70px)', gridTemplateRows: 'repeat(3, 70px)', gap: 4 }}>
        <div></div>
        <button className="dpadBtn" onTouchStart={press(() => onMove('up'))} onMouseDown={press(() => onMove('up'))}>▲</button>
        <div></div>
        <button className="dpadBtn" onTouchStart={press(() => onMove('left'))} onMouseDown={press(() => onMove('left'))}>◀</button>
        {/* Center cell — sprint toggle.
            We use onClick (not onTouchStart/onMouseDown like the d-pad arrows)
            because a toggle should fire once per tap, not on every touch event.
            onTouchStart fires *both* a touch event AND a synthetic mouse event
            on most mobile browsers, which toggled the state twice and netted to
            no change unless the user dragged off mid-press. onClick fires once
            and only on a clean tap. */}
        <button
          className="dpadBtn"
          onClick={(e) => { e.preventDefault(); onToggleSprint(); }}
          style={{
            fontSize: 18,
            // Strong, obvious contrast between the two states:
            //   inactive: muted gray with dimmed border
            //   active:   bright gold with darker border + glow
            background: sprinting
              ? 'linear-gradient(180deg, #ffd040 0%, #c08020 100%)'
              : 'linear-gradient(180deg, #2a2438 0%, #161020 100%)',
            color: sprinting ? '#1a0e08' : '#7a6a90',
            fontWeight: sprinting ? 800 : 500,
            borderColor: sprinting ? '#fff080' : '#3a3050',
            borderWidth: 2,
            boxShadow: sprinting
              ? '0 0 12px rgba(255,200,80,0.65), inset 0 0 4px rgba(255,255,200,0.4)'
              : 'inset 0 0 6px rgba(0,0,0,0.4)',
            animation: sprinting ? 'gtmSprintPulse 1.4s ease-in-out infinite' : undefined,
            transition: 'background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s',
          }}
          title={sprinting ? 'Sprinting — tap to walk' : 'Walking — tap to sprint'}
        >
          {sprinting ? '⚡' : 'R'}
        </button>
        <button className="dpadBtn" onTouchStart={press(() => onMove('right'))} onMouseDown={press(() => onMove('right'))}>▶</button>
        <div></div>
        <button className="dpadBtn" onTouchStart={press(() => onMove('down'))} onMouseDown={press(() => onMove('down'))}>▼</button>
        <div></div>
      </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
        <button className="mtgBtn" onTouchStart={press(onA)} onMouseDown={press(onA)} style={{ width: 80, height: 80, borderRadius: '50%', fontSize: 24,  marginRight: 12, background: 'linear-gradient(180deg, #8a3a2a, #4a1e14)', borderColor: '#d87362' }}>A</button>
        <button className="mtgBtn" onTouchStart={press(onB)} onMouseDown={press(onB)} style={{ width: 64, height: 64, borderRadius: '50%', fontSize: 19, background: 'linear-gradient(180deg, #2a4a8a, #141e4a)', borderColor: '#6c8ce0' }}>B</button>
      </div>
    </div>
  );
}

// =========================================================================
// WEATHER OVERLAY — particle effects for active battle weather
// Pure CSS; no canvas. Each weather generates a small set of absolute-positioned
// elements with a looping animation (gtmRainFall / gtmSandDrift / etc.) that's
// declared in the global stylesheet. Rain streaks fall, sand drifts horizontally,
// petals spin, sun rays radiate, eclipse darkens. Designed to read as "weather
// is active" at a glance without obscuring the fighters.
// =========================================================================
function WeatherOverlay({ weatherKey }) {
  if (!weatherKey) return null;
  // Use a stable seed so the particle layout doesn't reshuffle each frame.
  // Each weather seeds its own count.
  if (weatherKey === 'rain') {
    // 18 thin diagonal streaks of varying speeds.
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${(i * 173) % 100}%`,
            top: -10,
            width: 1, height: 14,
            background: 'linear-gradient(180deg, transparent, rgba(180,220,255,0.65))',
            transform: 'rotate(15deg)',
            animation: `gtmRainFall ${0.5 + (i % 5) * 0.1}s linear ${i * 0.07}s infinite`,
          }} />
        ))}
        {/* Bluish atmospheric tint over the scene */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(80,130,200,0.10), rgba(40,80,140,0.18))',
        }} />
      </div>
    );
  }
  if (weatherKey === 'sun') {
    // Soft golden glow + 8 thin radial rays from the upper-left.
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: '15%', top: '8%',
          width: 60, height: 60,
          background: 'radial-gradient(circle, rgba(255,240,180,0.50) 0%, rgba(255,240,180,0) 70%)',
          animation: 'gtmSunPulse 4s ease-in-out infinite',
        }} />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: '25%', top: '20%',
            width: 80, height: 1.2,
            background: 'linear-gradient(90deg, rgba(255,240,180,0.4), rgba(255,240,180,0))',
            transformOrigin: 'left center',
            transform: `rotate(${i * 18 - 5}deg)`,
            animation: `gtmSunPulse 4s ease-in-out ${i * 0.12}s infinite`,
          }} />
        ))}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(255, 230, 140, 0.06)',
        }} />
      </div>
    );
  }
  if (weatherKey === 'sandstorm') {
    // Ten horizontal sand streaks blowing left-to-right with parallax.
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: -20,
            top: `${10 + (i * 87) % 80}%`,
            width: 30, height: 1.5,
            background: `rgba(216, 160, 64, ${0.25 + (i % 3) * 0.15})`,
            animation: `gtmSandDrift ${0.7 + (i % 5) * 0.15}s linear ${i * 0.13}s infinite`,
          }} />
        ))}
        {/* Hazy orange tint */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(216, 140, 60, 0.10)',
        }} />
      </div>
    );
  }
  if (weatherKey === 'bloom') {
    // Drifting petals — slow, rotating, varied tints of green/pink/yellow.
    const petalColors = ['#a8d090', '#d8a0c8', '#f3e3a8', '#a8d090', '#90c068'];
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${(i * 211) % 100}%`,
            top: -6,
            width: 3, height: 3,
            borderRadius: '50% 50% 50% 0',
            background: petalColors[i % petalColors.length],
            opacity: 0.7,
            animation: `gtmPetalDrift ${3 + (i % 4) * 0.5}s linear ${i * 0.3}s infinite`,
          }} />
        ))}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(140, 200, 120, 0.04)',
        }} />
      </div>
    );
  }
  if (weatherKey === 'eclipse') {
    // Vignette darkening + a pulsing dark halo.
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%)',
          animation: 'gtmEclipsePulse 5s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(60, 30, 100, 0.12)',
          mixBlendMode: 'multiply',
        }} />
      </div>
    );
  }
  if (weatherKey === 'planar') {
    // Five-color shimmer — concentric rings of W/U/B/R/G that pulse.
    const colors = ['#f3e3a8', '#6cb8e0', '#8a7a92', '#e06d5a', '#6fb06f'];
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {colors.map((col, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: '50%', top: '50%',
            width: `${20 + i * 30}%`, height: `${20 + i * 30}%`,
            transform: 'translate(-50%, -50%)',
            border: `1px solid ${col}`,
            borderRadius: '50%',
            opacity: 0.18,
            animation: `gtmPlanarRing 3.6s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
        {/* Sparkles */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={`sp-${i}`} style={{
            position: 'absolute',
            left: `${(i * 137) % 100}%`,
            top: `${(i * 89) % 100}%`,
            width: 2, height: 2,
            background: colors[i % colors.length],
            borderRadius: '50%',
            boxShadow: `0 0 4px ${colors[i % colors.length]}`,
            animation: `gtmSparkle 2s ease-in-out ${i * 0.25}s infinite`,
          }} />
        ))}
      </div>
    );
  }
  return null;
}

// =========================================================================
// BATTLE SCENE — 2.5D parallax backdrop + spell FX overlay
// =========================================================================
// Renders a layered scene (sky / mid / floor / fog) themed to the active zone,
// keeps the creatures upright (billboarded) with a continuous breathing idle,
// and overlays cast lunge + projectile arc + impact burst when battle.fx fires.
// All visuals are CSS / inline SVG — no canvas, no asset files.
function BattleScene({ battle, me, enemy }) {
  const fx = battle.fx;
  const zone = battle.bgZone || 'town';

  // Per-zone color palette for the parallax layers
  const ZONE_BG = {
    town:    { sky1: '#3a2850', sky2: '#140820', far: '#2a1f3a', mid: '#1a1228', floor: '#3a2848', fog: 'rgba(120,80,180,0.18)' },
    wilds:   { sky1: '#1f3826', sky2: '#080d10', far: '#1a2a1c', mid: '#0e1a14', floor: '#1a3024', fog: 'rgba(80,160,100,0.18)' },
    ashen:   { sky1: '#4a1a14', sky2: '#1a0808', far: '#2a1410', mid: '#180806', floor: '#3a1810', fog: 'rgba(255,100,40,0.20)' },
    sanctum: { sky1: '#1a3858', sky2: '#06101e', far: '#102648', mid: '#08182a', floor: '#1a4068', fog: 'rgba(100,180,240,0.20)' },
    umbral:  { sky1: '#241a38', sky2: '#0a0612', far: '#181028', mid: '#0c0818', floor: '#221838', fog: 'rgba(160,100,200,0.18)' },
    plains:  { sky1: '#3a3858', sky2: '#181830', far: '#2a2848', mid: '#1a1a30', floor: '#3a3a5a', fog: 'rgba(255,240,180,0.16)' },
  };
  // Per-tile-type palette overlay. Wild encounters on different tile types
  // (tall grass, lava, deep water, etc) get a flavor tint over the zone palette.
  const TILE_BG = {
    g: { fog: 'rgba(80, 200, 100, 0.22)', floor: '#1a4020' },  // tall grass — saturated green
    l: { fog: 'rgba(255, 100, 40, 0.30)', floor: '#5a2010' },  // lava — molten red
    o: { fog: 'rgba(80, 160, 240, 0.28)', floor: '#1a3868' },  // deep water — cool blue
    v: { fog: 'rgba(160, 100, 200, 0.24)', floor: '#2a1a38' }, // thorny vines — purple
    f: { fog: 'rgba(255, 240, 180, 0.22)', floor: '#5a5a40' }, // flower field — pale gold
  };
  // Shrine interiors fall back to the zone they map to (if known) or town
  const basePal = ZONE_BG[zone] || ZONE_BG.town;
  const tilePal = battle.bgTile ? TILE_BG[battle.bgTile] : null;
  // Merge: tile palette overrides fog and floor when present.
  const pal = tilePal ? { ...basePal, fog: tilePal.fog, floor: tilePal.floor } : basePal;

  // Mountains/silhouettes per zone (drawn as simple SVG polygons)
  const farSilhouettes = {
    wilds:   [[0,80],[15,55],[28,70],[42,40],[56,62],[68,48],[80,68],[100,55],[100,100],[0,100]],
    ashen:   [[0,80],[10,50],[22,68],[35,35],[48,58],[62,30],[78,52],[92,40],[100,60],[100,100],[0,100]],
    sanctum: [[0,75],[18,60],[30,72],[45,55],[60,68],[75,50],[88,65],[100,58],[100,100],[0,100]],
    umbral:  [[0,82],[12,60],[24,75],[38,50],[52,68],[68,42],[82,62],[100,55],[100,100],[0,100]],
    plains:  [[0,82],[20,72],[35,80],[50,68],[65,78],[80,70],[100,75],[100,100],[0,100]],
    town:    [[0,80],[16,68],[32,76],[48,62],[64,72],[80,64],[100,72],[100,100],[0,100]],
  };
  const silhouette = farSilhouettes[zone] || farSilhouettes.town;
  const silhouettePts = silhouette.map(([x, y]) => `${x},${y}`).join(' ');

  // Color for spell FX comes from the move's mana color
  const fxColor = fx ? COLOR_HEX[fx.color] || '#fff' : '#fff';
  const fxDeep  = fx ? COLOR_DEEP[fx.color] || '#444' : '#444';

  // Determine cast direction & impact target
  // side === 'player' means PLAYER cast at ENEMY (left -> right)
  // side === 'enemy'  means ENEMY cast at PLAYER (right -> left)
  const playerCast = fx && fx.side === 'player';
  const enemyCast  = fx && fx.side === 'enemy';
  const projectileAnim = playerCast ? 'gtmProjectilePtoE' : 'gtmProjectileEtoP';

  // The cast lunge happens on the attacker; hit-shake on the target
  const playerLunge = playerCast ? `gtmCastLeft 0.6s ease-out` : '';
  const enemyLunge  = enemyCast  ? `gtmCastRight 0.6s ease-out` : '';
  // Hit-shake fires only when the move actually connected (not on miss/heal)
  const targetIsEnemy  = playerCast && fx && fx.kind !== 'miss' && fx.kind !== 'heal';
  const targetIsPlayer = enemyCast  && fx && fx.kind !== 'miss' && fx.kind !== 'heal';
  const enemyShake  = targetIsEnemy  ? `gtmHitShake 0.55s ease-out 0.42s` : '';
  const playerShake = targetIsPlayer ? `gtmHitShake 0.55s ease-out 0.42s` : '';

  // Layer animations are keyed by fx.key so they retrigger on every cast
  const fxKey = fx ? fx.key : 'idle';

  // Camera shake on critical hits — keyed by fx.key so each crit retriggers it
  const camShake = fx && fx.kind === 'crit' ? `gtmCamShake 0.45s ease-out` : undefined;
  return (
    <div key={`scene-${fx && fx.kind === 'crit' ? fx.key : 'idle'}`} style={{
      height: 140,
      background: `linear-gradient(180deg, ${pal.sky1} 0%, ${pal.sky2} 100%)`,
      border: '2px solid #4a3a68', borderRadius: 6,
      position: 'relative', overflow: 'hidden',
      marginBottom: 8,
      animation: camShake,
    }}>
      {/* Parallax layer 1: distant silhouettes (mountains/towers) */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{
        position: 'absolute', inset: 0, width: '120%', height: '100%',
        animation: 'gtmDriftSlow 30s linear infinite alternate',
        opacity: 0.7,
      }}>
        <polygon points={silhouettePts} fill={pal.far} />
      </svg>
      {/* Parallax layer 2: mid-ground silhouettes */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{
        position: 'absolute', inset: 0, width: '115%', height: '100%',
        animation: 'gtmDriftFast 18s linear infinite alternate',
        opacity: 0.85,
      }}>
        <polygon
          points="0,90 10,75 22,88 35,72 50,84 62,70 75,82 88,72 100,86 100,100 0,100"
          fill={pal.mid}
        />
      </svg>
      {/* Floor — perspective trapezoid (drawn behind creatures via z-index ordering) */}
      <div style={{
        position: 'absolute', left: '-10%', right: '-10%', bottom: 0,
        height: '38%',
        background: `linear-gradient(180deg, ${pal.floor} 0%, ${pal.sky2} 100%)`,
        clipPath: 'polygon(15% 0%, 85% 0%, 100% 100%, 0% 100%)',
        opacity: 0.85,
      }} />
      {/* Floor grid lines for depth cue */}
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        width: '100%', height: '40%', opacity: 0.18, pointerEvents: 'none',
      }}>
        {/* receding lines toward vanishing point at top-center */}
        <line x1="0"   y1="40" x2="42" y2="0" stroke="#fff" strokeWidth="0.4" />
        <line x1="20"  y1="40" x2="46" y2="0" stroke="#fff" strokeWidth="0.4" />
        <line x1="40"  y1="40" x2="49" y2="0" stroke="#fff" strokeWidth="0.4" />
        <line x1="60"  y1="40" x2="51" y2="0" stroke="#fff" strokeWidth="0.4" />
        <line x1="80"  y1="40" x2="54" y2="0" stroke="#fff" strokeWidth="0.4" />
        <line x1="100" y1="40" x2="58" y2="0" stroke="#fff" strokeWidth="0.4" />
        {/* horizontal bands */}
        <line x1="0" y1="10" x2="100" y2="10" stroke="#fff" strokeWidth="0.2" />
        <line x1="0" y1="22" x2="100" y2="22" stroke="#fff" strokeWidth="0.3" />
      </svg>
      {/* Atmospheric fog tint */}
      <div style={{
        position: 'absolute', inset: 0,
        background: pal.fog,
        pointerEvents: 'none',
        mixBlendMode: 'screen',
      }} />

      {/* Weather overlay — rendered above fog but below creatures. With stacked
          weather (rare), both particle systems render layered together — they're
          all transparent CSS so they composite cleanly (e.g. rain streaks over
          eclipse vignette = stormy darkness, sun rays + petals = lush summer). */}
      {weathersForBattle(battle).map((wKey, i) => (
        <WeatherOverlay key={`${wKey}-${i}`} weatherKey={wKey} />
      ))}

      {/* Player creature — left side, on floor */}
      <div style={{
        position: 'absolute', left: '12%', bottom: 12,
        animation: playerLunge || enemyShake_ph(playerShake) || 'gtmBreathe 3.4s ease-in-out infinite',
        transformOrigin: 'bottom center',
      }} key={`me-${fxKey}-${playerCast ? 'cast' : (targetIsPlayer ? 'hit' : 'idle')}`}>
        {/* Drop shadow under the sprite */}
        <div style={{
          position: 'absolute', left: '50%', bottom: -4,
          width: 60, height: 8,
          transform: 'translateX(-50%)',
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          animation: battle.throwing ? 'gtmCatchWobble 1.4s ease-in-out 0.55s' : undefined,
        }}>
          <CreatureSprite creature={me} facing="right" />
        </div>
      </div>

      {/* Enemy creature — right side, on floor */}
      <div style={{
        position: 'absolute', right: '12%', bottom: 12,
        animation: enemyLunge || enemyShake_ph(enemyShake) || 'gtmBreathe 3.1s ease-in-out infinite',
        transformOrigin: 'bottom center',
        opacity: battle.result === 'catch' ? 0 : 1,
        transition: 'opacity 0.5s ease-out',
      }} key={`en-${fxKey}-${enemyCast ? 'cast' : (targetIsEnemy ? 'hit' : 'idle')}`}>
        <div style={{
          position: 'absolute', left: '50%', bottom: -4,
          width: 60, height: 8,
          transform: 'translateX(-50%)',
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 70%)',
          pointerEvents: 'none',
        }} />
        {/* Daily-encounter aura — pulsing radial glow behind the enemy sprite.
            Only renders for the rare phantom variants (enemy.isDaily). The color
            comes from the daily entry's `glow` field; the keyframe animation
            creates the breathing rarity-shimmer effect. */}
        {enemy.isDaily && (
          <div style={{
            position: 'absolute',
            left: '50%', bottom: 8,
            width: 80, height: 80,
            transform: 'translateX(-50%)',
            background: `radial-gradient(circle, ${enemy.dailyGlow}66 0%, ${enemy.dailyGlow}22 40%, transparent 70%)`,
            animation: 'gtmDailyAura 2.2s ease-in-out infinite',
            pointerEvents: 'none',
          }} />
        )}
        <div style={{
          animation: battle.throwing ? 'gtmCatchWobble 1.4s ease-in-out 0.62s' : undefined,
          transform: battle.result === 'catch' ? 'scale(0.3) translateY(-10px)' : 'scale(1)',
          transition: 'transform 0.5s ease-out',
          filter: enemy.isDaily ? `drop-shadow(0 0 6px ${enemy.dailyGlow})` : undefined,
        }}>
          <CreatureSprite creature={enemy} facing="left" />
        </div>
      </div>

      {/* SPELL FX OVERLAY — projectile + impact + sparks. Gated on fx existing. */}
      {fx && fx.kind !== 'heal' && fx.kind !== 'miss' && (
        <div key={`fx-${fxKey}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {/* Projectile orb arcing from caster to target */}
          <div style={{
            position: 'absolute',
            width: 20, height: 20,
            borderRadius: '50%',
            background: `radial-gradient(circle, #fff 0%, ${fxColor} 35%, ${fxDeep} 75%, transparent 100%)`,
            boxShadow: `0 0 16px ${fxColor}, 0 0 32px ${fxColor}80`,
            animation: `${projectileAnim} 0.55s ease-out forwards`,
          }} />
          {/* Impact burst — appears at target side */}
          <div style={{
            position: 'absolute',
            left: playerCast ? '76%' : '22%',
            bottom: '38%',
            width: 50, height: 50,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${fxColor} 0%, ${fxDeep} 50%, transparent 80%)`,
            opacity: 0,
            animation: `gtmImpact 0.5s ease-out 0.45s forwards`,
            transform: 'translate(-50%, -50%)',
          }} />
          {/* Sparks radiating outward */}
          {fx.kind !== 'weak' && [0, 1, 2, 3, 4, 5].map(i => {
            const angle = (i / 6) * Math.PI * 2;
            const dist = fx.kind === 'crit' || fx.kind === 'super' ? 36 : 22;
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            return (
              <div key={i} style={{
                position: 'absolute',
                left: playerCast ? '76%' : '22%',
                bottom: '38%',
                width: 4, height: 4,
                borderRadius: '50%',
                background: fxColor,
                boxShadow: `0 0 6px ${fxColor}`,
                opacity: 0,
                ['--gtm-dx']: `${dx}px`,
                ['--gtm-dy']: `${dy}px`,
                animation: `gtmSpark 0.55s ease-out 0.5s forwards`,
              }} />
            );
          })}
          {/* Critical/super-effective screen flash */}
          {(fx.kind === 'crit' || fx.kind === 'super') && (
            <div style={{
              position: 'absolute', inset: 0,
              background: fx.kind === 'crit' ? 'rgba(255,240,160,0.4)' : `${fxColor}55`,
              animation: 'gtmFlashFade 0.4s ease-out 0.42s forwards',
              opacity: 0,
              pointerEvents: 'none',
            }} />
          )}
        </div>
      )}

      {/* Heal effect — green/white glow on the target (caster heals self) */}
      {fx && fx.kind === 'heal' && (
        <div key={`fx-${fxKey}`} style={{
          position: 'absolute',
          left: fx.side === 'player' ? '20%' : '72%',
          bottom: 18,
          width: 60, height: 60,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(255,250,200,0.9) 0%, ${fxColor}aa 50%, transparent 80%)`,
          opacity: 0,
          animation: 'gtmHealGlow 0.8s ease-out forwards',
          pointerEvents: 'none',
        }} />
      )}

      {/* Floating damage number — pops up from the target on hit/crit/super/weak.
          Color-coded: gold for crit, color-tinted for super-effective, dim white
          for not-very-effective, plain white otherwise. */}
      {fx && fx.dmg > 0 && (fx.kind === 'hit' || fx.kind === 'crit' || fx.kind === 'super' || fx.kind === 'weak') && (
        <div key={`dmg-${fxKey}`} style={{
          position: 'absolute',
          left: playerCast ? '76%' : '22%',
          bottom: 60,
          fontFamily: "'Cinzel', Georgia, serif",
          fontSize: fx.kind === 'crit' ? 26 : (fx.kind === 'super' ? 22 : 19),
          fontWeight: 800,
          color: fx.kind === 'crit'  ? '#ffd870'
               : fx.kind === 'super' ? fxColor
               : fx.kind === 'weak'  ? '#9098a0'
               : '#f4ecd8',
          textShadow: '0 2px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7), -1px -1px 0 #000, 1px 1px 0 #000',
          pointerEvents: 'none',
          animation: 'gtmDmgFloat 0.9s ease-out forwards',
          transform: 'translate(-50%, 0)',
          letterSpacing: '0.5px',
        }}>
          {fx.kind === 'crit' && <span style={{ fontSize: 12, marginRight: 3, verticalAlign: 'middle' }}>★</span>}
          -{fx.dmg}
        </div>
      )}

      {/* Card-throw catch animation (preserved) */}
      {battle.throwing && (
        <div style={{
          position: 'absolute', pointerEvents: 'none',
          left: '10%', bottom: '10px',
          animation: 'gtmCardThrow 0.72s ease-out forwards',
        }}>
          <CardBack size="small" />
        </div>
      )}

      {/* Intro banner */}
      {battle.intro && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(10, 6, 20, 0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
          animation: 'gtmFlashFade 1s ease-out forwards',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            animation: 'gtmIntroSlide 0.9s ease-out',
            fontFamily: "'Cinzel', serif",
            borderTop: '2px solid #c9a664', borderBottom: '2px solid #c9a664',
            padding: '10px 28px', background: 'rgba(20, 8, 32, 0.75)',
            minWidth: 200, textAlign: 'center',
          }}>
            <div style={{
              fontSize: 22, fontWeight: 700, letterSpacing: 4,
              color: '#f4e5a8', textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 24px rgba(244,229,168,0.6)',
            }}>
              {battle.kind === 'trainer' || battle.kind === 'legendary' ? 'CHALLENGE!' : 'BATTLE!'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#d8c890' }}>
              {battle.kind === 'trainer' ? (
                <>
                  <span style={{ fontSize: 15 }}>⚔</span>
                  <span>{battle.npc?.name}</span>
                </>
              ) : (
                <>
                  <ManaBadge identity={battle.enemyTeam?.[battle.enemyIdx]?.c} size={18} label={false} />
                  <span style={{ fontWeight: 700, letterSpacing: 1 }}>
                    {battle.enemyTeam?.[battle.enemyIdx]?.name}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// Helper: prefer non-empty animation strings (lunge > shake > breathe)
function enemyShake_ph(s) { return s || ''; }

// =========================================================================
// BATTLE SCREEN
// =========================================================================
function BattleScreen({ battle, team, tokens, items, mode, commanderColor, transitionFx, onMove, onCatch, onFlee, onSwitch, onEnd, onResolveLearn, onResolveGraft, onUseBattleItem }) {
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

      {/* ===== 2.5D Battle Scene with parallax backdrop, breathing creatures, and spell FX ===== */}
      <div style={{ position: 'relative' }}>
        <BattleScene battle={battle} me={me} enemy={enemy} />
        {/* Weather badges — top-right, one per active weather. Stacked weathers
            (rare) render two badges side-by-side so the player can read each one's
            color, icon, and effect independently. */}
        {(() => {
          const wKeys = weathersForBattle(battle);
          if (wKeys.length === 0) return null;
          return (
            <div style={{
              position: 'absolute', top: 6, right: 6, zIndex: 5,
              display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end',
              maxWidth: '60%',
            }}>
              {wKeys.map(wKey => {
                const w = WEATHER[wKey];
                return (
                  <div key={wKey} title={w.desc}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 7px',
                      background: 'rgba(10, 6, 20, 0.78)',
                      border: `1.5px solid ${w.color}`,
                      borderRadius: 12,
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      color: w.color,
                      boxShadow: `0 0 8px ${w.color}55`,
                      fontFamily: "'Cinzel', serif",
                      pointerEvents: 'auto',
                      animation: 'gtmFlashFade 0.6s ease-out',
                    }}>
                    <span style={{ fontSize: 13 }}>{w.icon}</span>
                    <span>{w.name.toUpperCase()}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
        {/* Scoped iris overlay for battle entry/exit — covers only the battle scene */}
        {transitionFx && (
          <div key={transitionFx.key} style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: '#000',
            borderRadius: 6,
            pointerEvents: 'none',
            animation:
              transitionFx.kind === 'irisIn'  ? 'gtmIrisClose 0.34s ease-in forwards' :
              transitionFx.kind === 'irisOut' ? 'gtmIrisOpen 0.36s ease-out forwards' :
              transitionFx.kind === 'fade'    ? 'gtmFadeBlack 0.4s ease-in-out forwards' :
              undefined,
          }} />
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
          <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(creature)}</div>
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
  // --- Two-color ---
  skybinder:       { shape: 'humanoid', halo: 1, headFin: 1, staff: true, slim: true },
  mind_reaver:     { shape: 'wisp',     hood: true, wispTails: 2, glow: true },
  hellraiser:      { shape: 'blob',     wings: 'bat', flames: 2, fangs: true, horns: 1 },
  warbeast:        { shape: 'beast',    ears: 'round', horns: 2, flames: 1, tailSpike: true },
  verdant_paladin: { shape: 'humanoid', halo: 1, bow: true, leaves: true, ears: 'long' },
  grim_priest:     { shape: 'humanoid', hood: true, halo: 1, staff: true, slim: true },
  stormwright:     { shape: 'wisp',     wispTails: 2, flames: 1, glow: true, sideFins: true },
  fungal_creeper:  { shape: 'serpent',  segments: true, leaves: true, fangs: true, glow: true },
  blazing_knight:  { shape: 'humanoid', halo: 1, flames: 1, staff: true, wings: 'bird' },
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
  // --- Four-color: Nephilim ---
  yore_tiller:     { shape: 'humanoid', wings: 'bat', halo: 2, headFin: 1, flames: 1, hood: true, regal: true },
  glint_eye:       { shape: 'wisp',     wings: 'bat', wispTails: 2, flames: 1, leaves: true, fangs: true, glow: true },
  dune_brood:      { shape: 'beast',    horns: 2, halo: 1, flames: 2, leaves: true, tailSpike: true, big: true },
  ink_treader:     { shape: 'merfolk',  wings: 'angel', halo: 1, leaves: true, flames: 1, headFin: 1 },
  witch_maw:       { shape: 'serpent',  segments: true, halo: 1, leaves: true, headFin: 1, fangs: true, big: true },
  // --- Five-color ---
  prismatic_avatar:{ shape: 'humanoid', wings: 'angel', halo: 2, staff: true, regal: true, flames: 1 },
  // --- Legendary shrine bosses ---
  vigil_avatar:    { shape: 'humanoid', wings: 'angel', halo: 2, staff: true, regal: true, big: true },
  tidewarden:      { shape: 'serpent',  dorsalFin: 2, sideFins: true, big: true, segments: true, fangs: true },
  voidlord:        { shape: 'wisp',     hood: true, wispTails: 3, glow: true, fangs: true, horns: 2, flames: 1, big: true },
  pyreclaw:        { shape: 'drake',    wings: 'dragon', horns: 2, tailSpike: true, scales: true, flames: 2, fangs: true, big: true },
  patriarch_wurm:  { shape: 'serpent',  segments: true, big: true, leaves: true, horns: 2, fangs: true },
  the_planeswalker:{ shape: 'humanoid', wings: 'angel', halo: 2, staff: true, regal: true, flames: 2, big: true, glow: true },
};

function specFor(id) {
  return SPRITE_SPEC[id] || { shape: 'blob' };
}

// ================================================================
//  CREATURE PIXEL-ART SPRITE SYSTEM  (DS / HGSS quality)
//  Replaces abstract SVG paths with hand-crafted pixel art.
//  PXS = logical pixel size in SVG units.
//  Sprites are centered in the 72×88 viewBox with bottom anchor.
// ================================================================

// ── Archetype pixel art data ─────────────────────────────────
// Single-char keys; '.' = transparent
// '1'=primary  '2'=primary-dark  '3'=primary-light
// 'F'=face  'f'=face-shadow  'E'=eye  'e'=eye-white
// 'G'=gold  'g'=gold-dark  'A'=light-accent  'a'=accent-shadow
// 'P'=legs  'p'=leg-shadow  'S'=shoe  's'=shoe-shadow

// ================================================================
//  CREATURE PIXEL-ART SYSTEM v3 — anatomy-driven, hand-authored
//  Each archetype has unique posture, asymmetry, species-specific
//  facial structure, and silhouette readability at small scale.
// ================================================================
//
//  Pixel-key conventions:
//  '.'  transparent
//  '1'  primary body color
//  '2'  primary dark (outline / shadow)
//  '3'  primary light (specular / highlight)
//  'A'  accent / scale highlight
//  'a'  accent dark
//  'F'  face / muzzle color (humanoid skin or body shade for animals)
//  'f'  face shadow
//  'E'  eye pupil
//  'e'  eye glow
//  'G'  gold / belt
//  'P'  legs
//  'S'  shoes / claws
//  's'  shoe shadow

// ================================================================
//  PER-CREATURE PIXEL ART  (v7 — modeled on reference sheet)
//  Hand-authored sprites for each mono-color creature.
//  Falls back to CR_SPR archetypes for any creature not listed.
//
//  KEY CONVENTIONS:
//    .  transparent
//    1  body main color        2  body outline / dark
//    3  body highlight         4  secondary accent
//    F  face/hood SHADOW       E  eye glow
//    H  halo bright            h  halo dark
//    W  feather white          w  feather mid          v  feather dark
//    M  wing membrane          m  membrane dark
//    K  flame core             k  flame mid            x  flame dark
//    o  horn/claw light        O  horn dark
//    l  leaf bright            L  leaf dark
//    P  leg                    S  foot
//    A  highlight pixel
// ================================================================

const PER_CREATURE_SPR = {
  // ---------- WHITE ----------
  plains_acolyte: [
    '....HHHHHH....',
    '...Hh....hH...',
    '....HHHHHH....',
    '......22......',
    '.....2112.....',
    '....21FF12....',
    '...21FFFF12...',
    '...21FEEFF1...',
    '...21FFFFF1...',
    '...21FFFFF1...',
    '....22FF22....',
    '....2111122...',
    '...211333112..',
    '..2111111112..',
    '..2111111112..',
    '..2113311112..',
    '..2111111112..',
    '..2111111112..',
    '...211111112..',
    '....22..22....',
    '....22..22....',
    '....22..22....',
  ],
  aven_sentinel: [
    '......22........',
    '.....2112.......',
    '....21FF12......',
    '...21FFFF12.....',
    '...21FEEFF1.....',
    '...21FFFFF1.....',
    '...21FFFFF1.....',
    '....22FF22......',
    '....2111122.....',
    'k..211333112..k.',
    'kxk1111111112kxk',
    'KxK1111111112KxK',
    'kxk1111111112kxk',
    'k...2111111122.k',
    '....2111111122..',
    '....2111111122..',
    '....211111112...',
    '.....22..22.....',
    '.....22..22.....',
    '.....22..22.....',
  ],
  radiant_seraph: [
    '......HHHHHH......',
    '.....Hh....hH.....',
    '......HHHHHH......',
    '........22........',
    '.......2112.......',
    'W.....21FF12.....W',
    'WW...21FFFF12...WW',
    'WwW..21FEEFF1..WwW',
    'WwwW.21FFFFF1.WwwW',
    'WvwwW21FFFFF1WwwvW',
    'WvwwW.22FF22.WwwvW',
    '.WvwW.2111122.WvwW',
    '.WvW.211333112.WvW',
    '..WW.2111111112.WW',
    '..W..2111111112..W',
    '.....2113311112...',
    '.....2111111112...',
    '.....2111111112...',
    '......22..22......',
    '......22..22......',
    '......22..22......',
  ],

  // ---------- BLUE ----------
  tideling: [
    '....22.22.....',
    '...2113311....',
    '...2113311....',
    '....211112....',
    '...21FFFF12...',
    '...21FEEFF1...',
    '...21FFFFF1...',
    '....22FF22....',
    '....2111122...',
    '...211333112..',
    '...2113333112.',
    '...2113333112.',
    '...2111111112.',
    '....21111112..',
    '....2111112...',
    '...2113112....',
    '..211131122...',
    '.21111312222..',
    '21113112222...',
    '.2113122......',
    '..21222.......',
    '...22.........',
  ],
  phantom_sprite: [
    '...22222222...',
    '..2111111112..',
    '.211333333112.',
    '.211333333112.',
    '.21FFFFFFFF12.',
    '.21FEEFFFEEF1.',
    '.21FFFFFFFFF1.',
    '.21FFFFFFFFF1.',
    '..21FFFFFFf2..',
    '..2111ffff112.',
    '.2111111111112',
    '.2111111111112',
    '..21111111112.',
    '...21111111A..',
    '....2A1A1A2...',
    '...2A.2A.2A...',
    '..2A...A...2..',
    '..A....A....A.',
    '.A.....A.....A',
    'A......A......',
  ],
  storm_leviathan: [
    '...22.........',
    '..2113........',
    '..21133.......',
    '...22112......',
    '....21FF22....',
    '...21FEEFF2...',
    '...21FFFFFF2..',
    '...21FFFFFF2..',
    '....2FFffff2..',
    '....2211ff22..',
    '....22113311..',
    '....2113331...',
    '...21133311...',
    '...211333112..',
    '..21133331122.',
    '..2113333112..',
    '..21133311....',
    '.21133311.....',
    '.211333112....',
    '..21133311....',
    '...211331.....',
    '....211331....',
    '.....21133....',
    '......21331...',
    '.......21311..',
    '........2113..',
    '.........212..',
  ],

  // ---------- BLACK ----------
  shade_whelp: [
    '....2222....',
    '...211112...',
    '..21FFFF12..',
    '.21FFFFFF12.',
    '.21FEEEEFF1.',
    '.21FFFFFFF1.',
    '.21FFFFFFF1.',
    '.21FFFFFFF1.',
    '.21FFFFFFF1.',
    '.211FFFFFf12',
    '.2113FFFf312',
    '.21133333312',
    '.2111333112.',
    '.2111111112.',
    '.21111111A2.',
    '.21111111A2.',
    '..2111111A..',
    '..2222222...',
  ],
  blood_imp: [
    '......22.......',
    '.....2oo2......',
    '....21FF12.....',
    '...21FFFF12....',
    '...21FEEFF1....',
    '...21FFFFF1....',
    '....22FF22.....',
    'M..2111111A2..M',
    'MmM21133312MmM.',
    'MmmM1133311MmmM',
    'MmmmM11331MmmmM',
    'MmmmM11111MmmmM',
    '.MmmM21111MmmM.',
    '..MmM21112MmM..',
    '...MM2112MM....',
    '....211112.....',
    '....221122.....',
    '....22..22.....',
  ],
  nightfall_wraith: [
    '...22222....',
    '..2111112...',
    '.21133312...',
    '.211FFFF12..',
    '.21FFFFFF1..',
    '.21FEEEEF1..',
    '.21FFFFFF1..',
    '.21FFFFFF1..',
    '..2FFFFFf12.',
    '..2111ff112.',
    '..21111111A.',
    '..211111A12.',
    '...2A11A12..',
    '...A2A1A2...',
    '..A.2A.2A...',
    '.A...A...A..',
    'A....A....A.',
    '.....A......',
  ],

  // ---------- RED ----------
  emberkin: [
    '...K....K...',
    '..KkK..KkK..',
    '.KkxkKKkxkK.',
    '..kxXxxXxk..',
    '...xXxxXx...',
    '...22xx22...',
    '..211331122.',
    '.21FFFFFF12.',
    '.21FEEEEFF1.',
    '.21FFFFFFF1.',
    '..2FFFFFf2..',
    '..211ff112..',
    '.2111333112.',
    '.211333331A2',
    '.21333333312',
    '.21333331112',
    '.2111111111A',
    '.2111111111A',
    '..21111111A.',
    '...2222222..',
  ],
  goblin_raider: [
    '............O...',
    '...........OoO..',
    '............O...',
    '...22.......O...',
    '..2112......O...',
    '.21FF12.....O...',
    '21FFFFF2....O...',
    '21FEEFFF2...O...',
    '21FFFFFF2...O...',
    '.21FFFf12...O...',
    '..22FF22....O...',
    '...211122..2O...',
    '..21133312.OO...',
    '..213333112O....',
    '..21333311112...',
    '..2111111112....',
    '..2111111112....',
    '..2111111112....',
    '...21....12.....',
    '...22....22.....',
    '...22....22.....',
  ],
  cinder_drake: [
    '..M.............',
    '.MmM............',
    'MmmmM...22......',
    'MmmmmM.2113.....',
    'MmmmmmM21F2.....',
    'MmmmmmM21FE12...',
    '.MmmmmM2FFFFF12.',
    '..MmmmM2FFFffF12',
    '..MmmmM2211ff112',
    '..MmmmM21133312.',
    '..MmmmM21333312.',
    '...MmmM2113331..',
    '....MmM21111A2..',
    '.....MM21111A2..',
    '......M2111A12..',
    '......M2A1A12...',
    '......M22A2.....',
    '.......2A2.k....',
    '......2.....k...',
    '.....22..22.k...',
    '.....2P..2P.....',
    '.....2S..2S.....',
  ],

  // ---------- GREEN ----------
  forest_runt: [
    '..22........22..',
    '.2112.......2112',
    '.2113........11.',
    '..211111111111..',
    '.21133333333112.',
    '.21FFFFFFFFFF12.',
    '.21FEEFFFFEEF12.',
    '.21FFFFFFFFFF12.',
    '..21FfffffFf12..',
    '...22FFFFFf22...',
    '...211111111....',
    '..2111111111122.',
    '..2113333333112.',
    '..21133333311A2.',
    '..21111111111A..',
    '..2111111111A2..',
    '...22..22..22...',
    '...22..22..22...',
    '...22..22..22...',
    '...22..22..22...',
  ],
  elfling_scout: [
    '...2...........',
    '..2o...........',
    '.2oo..22.......',
    '.2o..2112......',
    '.2o.21FF12.....',
    'O2.21FFFFF2....',
    'O.21FEEFFF2....',
    'O.21FFFFFF2....',
    'O..21FFFf12....',
    'O...22ff22.....',
    'O....211122....',
    'O...211333112..',
    'O..21133333112.',
    'O..21133331112.',
    'O..21111111112.',
    'O...211111112..',
    '2....211111112.',
    '2o....21....12.',
    '.2o...22....22.',
    '..2....22....22',
    '...2...22....22',
  ],
  grove_wurm: [
    '...l...l......',
    '..lLl.lLl.....',
    '...l...l......',
    '....22.22.....',
    '...2113311....',
    '..21133311....',
    '..21FFFFFF2...',
    '..21FEEFFFF2..',
    '..21FFFFFFFF2.',
    '...2FFffffFF2.',
    '...2211FFff12.',
    '....21111ff12.',
    '....21133312..',
    '...21133331...',
    '...21133311...',
    '...211333112..',
    '....21333311..',
    '....2113331...',
    '.....211331...',
    '......21331...',
    '......21331...',
    '.......21331..',
    '........2113..',
    '.........212..',
    '..........22..',
  ],

  // ── Multi-color, Nephilim, Legendaries (v13) ────────────
  skybinder: [
    '....HHHHHH....',
    '...Hh....hH...',
    '....HHHHHH....',
    '......22......',
    '.....2112.....',
    '....21FF12....',
    '...21FFFF12...',
    '...21FEEFF1...',
    '...21FFFFF1...',
    '....22FF22....',
    '....2111122...',
    '...211333112..',
    '..2111111112..',
    '..2114444112..',
    '..2114444112..',
    '..2111111112..',
    '..2111111112..',
    '...211111112..',
    '....22..22....',
    '....22..22....',
    '....22..22....',
  ],
  mind_reaver: [
    '...22222....',
    '..2111112...',
    '.21133312...',
    '.211FFFF12..',
    '.21FFFFFF1..',
    '.21FEEEEF1..',
    '.21FFFFFF1..',
    '.21FFFFFF1..',
    '..2FFFFFf12.',
    '..2114ff112.',
    '..21144441A.',
    '..211441A12.',
    '...2A11A12..',
    '...A2A1A2...',
    '..A.2A.2A...',
    '.A...A...A..',
    'A....A....A.',
    '.....A......',
  ],
  hellraiser: [
    '..K.........K..',
    '.KkK.......KkK.',
    '..xX.o...o.Xx..',
    '...22.o.o.22...',
    '..21FFFFFFFF12.',
    '..21FEEFFEEF12.',
    '..21FFFFFFFF12.',
    'M.21FFFFFFFFf2M',
    'MM2114444112MM.',
    'MM1144444411MM.',
    '.M1144444411M..',
    '.M1144444411M..',
    '..21111111112..',
    '..21111111112..',
    '...2111111A....',
    '....211111.....',
    '....22...22....',
    '....22...22....',
  ],
  warbeast: [
    '..o..........o..',
    '..oO........oO..',
    '..22........22..',
    '.2112.......2112',
    '.21133333333312.',
    '.21FFFFFFFFFF12.',
    '.21FEEFFFFEEF12.',
    '.21FFFFFFFFFF12.',
    '..21FfffffFf12..',
    '...22FFFFFf22...',
    'k..211444411..k.',
    'kxk1144444411xKk',
    'k..211444411..k.',
    '..2111111111122.',
    '..21111111111A..',
    '...22..22..22...',
    '...22..22..22...',
    '...22..22..22...',
    '...22..22..22...',
  ],
  verdant_paladin: [
    '....HHHHHH....',
    '...Hh....hH...',
    '....HHHHHH....',
    '......22......',
    '.l...2112...l.',
    'lLl.21FF12.lLl',
    '...21FFFF12...',
    '...21FEEFF1...',
    '...21FFFFF1...',
    '....22FF22....',
    '....2111122...',
    '...211333112..',
    '..2111441112..',
    '..2114444112..',
    '..2114444112..',
    '..2111111112..',
    '..2111111112..',
    '...211111112..',
    '....22..22....',
    '....22..22....',
    '....22..22....',
  ],
  grim_priest: [
    '....HHHHHH....',
    '...Hh....hH...',
    '....HHHHHH....',
    '......22......',
    '....2244442...',
    '...244FFFF42..',
    '...24FFFFFF1..',
    '...24FEEFFFF..',
    '...24FFFFFFF..',
    '....24FFFF42..',
    '....24FFFF42..',
    '....2222FF22..',
    '....2111122...',
    '...211333112..',
    '..2111111112..',
    '..2111111112..',
    '..2111441112..',
    '..2111111112..',
    '...211111112..',
    '....22..22....',
    '....22..22....',
    '....22..22....',
  ],
  stormwright: [
    '....K....K....',
    '...KkK..KkK...',
    '....x....x....',
    '...22222222...',
    '..2111111112..',
    '.211333333112.',
    '.21FFFFFFFF12.',
    '.21FEEFFFEEF1.',
    '.21FFFFFFFFF1.',
    '..21FFFFFFf2..',
    '..2111ffff112.',
    '.2111144441112',
    '.2111144441112',
    '..21111111112.',
    '...21111111A..',
    '....2A1A1A2...',
    '...2A.2A.2A...',
    '..2A...A...2..',
    '..A....A....A.',
    '.A.....A.....A',
  ],
  fungal_creeper: [
    '...l...l......',
    '..lLl.lLl.....',
    '...l...l......',
    '....22.22.....',
    '...2113311....',
    '..21133311....',
    '..21FFFFFF2...',
    '..21FEEFFFF2..',
    '..21FFFFFFFF2.',
    '...2FFffffFF2.',
    '...2211FFff12.',
    '....21144412..',
    '....21144331..',
    '...21144331...',
    '...21133311...',
    '...211333112..',
    '....21333311..',
    '....2113331...',
    '.....211331...',
    '......21331...',
    '.......21331..',
    '........2113..',
    '.........212..',
    '..........22..',
  ],
  blazing_knight: [
    '......HHHHHH......',
    '.....Hh....hH.....',
    '......HHHHHH......',
    '........22........',
    '.......2112.......',
    'k.....21FF12.....k',
    'kxk..21FFFF12..kxk',
    'KxK..21FEEFF1..KxK',
    'kxk..21FFFFF1..kxk',
    'k.....22FF22.....k',
    '......2111122.....',
    '.....211333112....',
    '....21111441112...',
    '....21114444112...',
    '....21114444112...',
    '....21111111112...',
    '....21111111112...',
    '....21111111112...',
    '.....22..22.......',
    '.....22..22.......',
    '.....22..22.......',
  ],
  reef_prowler: [
    '..l.........l.',
    '.lLl.......lLl',
    '..l.22.22..l..',
    '...2113311....',
    '...2113311....',
    '....211112....',
    '...21FFFF12...',
    '...21FEEFF1...',
    '...21FFFFF1...',
    '....22FF22....',
    '....2111122...',
    '...211333112..',
    '...2114444112.',
    '...2114444112.',
    '...2111111112.',
    '....21111112..',
    '....2111112...',
    '...2113112....',
    '..211131122...',
    '.21111312222..',
    '21113112222...',
    '.2113122......',
    '..21222.......',
    '...22.........',
  ],
  arcane_sphinx: [
    '......HHHHHH......',
    '.....Hh....hH.....',
    '......HHHHHH......',
    '........22........',
    '.......2112.......',
    'W.....21FF12.....W',
    'WwW..21FFFF12..WwW',
    'WwwW.21FEEFF1.WwwW',
    'WvwwW21FFFFF1WwwvW',
    '.WvwW.22FF22.WvwW.',
    '.WvW.2111122..WvW.',
    '..WW211333112..WW.',
    '...211444411112...',
    '...211333311112...',
    '....21111111A2....',
    '.....22..22.......',
    '.....22..22.......',
    '.....22..22.......',
  ],
  void_lich: [
    '....K....K....',
    '...KkK..KkK...',
    '...22222......',
    '..2111112.....',
    '.21133312.....',
    '.211FFFF12....',
    '.21FFFFFF1....',
    '.21FEEEEF1....',
    '.21FFFFFF1....',
    '..2FFFFFf12...',
    '..2111ff112...',
    '..21144441A2..',
    '...211441A12..',
    '...A2A14A2....',
    '..A.2A.2A.....',
    '.A...A...A....',
    'A....A....A...',
    '.....A........',
  ],
  apex_predator: [
    '..o..........o..',
    '..oO........oO..',
    '..22........22..',
    '.2112.......2112',
    '.21133333333312.',
    'k.21FFFFFFFFFk..',
    'k.21FEEFFFFEEk..',
    '..21FFFFFFFFFF12',
    '..21FfffffFf12..',
    '...22FFffff22...',
    '...211111111....',
    '..21134444112...',
    '..21111111112...',
    '..21111111A12...',
    '...22..22..22...',
    '...22..22..22...',
    '...22..22..22...',
    '...22..22..22...',
  ],
  blooming_titan: [
    '......HHHHHH......',
    '.....Hh....hH.....',
    '......HHHHHH......',
    '.l......22......l.',
    'lLl....2112....lLl',
    '......21FF12......',
    '....21FFEEFFF12...',
    '....21FFFFFFF12...',
    '....21FFFFFFF12...',
    '.....22FFFFf22....',
    '....2111111122....',
    '...211111144112...',
    '..21111111441112..',
    '..21111144441112..',
    '..21111111111112..',
    '..21111111111112..',
    '..21111111111112..',
    '...22..22..22.....',
    '...22..22..22.....',
    '...22..22..22.....',
  ],
  silver_pegasus: [
    '......HHHHHH......',
    '.....Hh....hH.....',
    '......HHHHHH......',
    '........22........',
    '..22..2112........',
    '.2112.21FF12......',
    '.211333FFFFFF12...',
    '.21FFFFEEFFFFFF...',
    '.21FFFFFFFFFFFF...',
    '.21FfffffFffFf12..',
    '..2FFFFFffF12.....',
    '...2111111112.....',
    '...211111111A.....',
    '...211114411112...',
    '...211144441112...',
    '...21111111111A...',
    '....211111111A....',
    '....22..22..22....',
    '....22..22..22....',
    '....22..22..22....',
  ],
  abzan_warden: [
    '....HHHHHH....',
    '...Hh....hH...',
    '....HHHHHH....',
    '.l....22....l.',
    'lLl.2244442.lL',
    '...244FFFF42..',
    '...24FFFFFF1..',
    '...24FEEFFFF..',
    '...24FFFFFFF..',
    '....24FFFF42..',
    '....2222FF22..',
    '....2111122...',
    '...211333112..',
    '..2111441112..',
    '..2114444112..',
    '..2114444112..',
    '..2111111112..',
    '...211111112..',
    '....22..22....',
    '....22..22....',
    '....22..22....',
  ],
  jeskai_monk: [
    '....HHHHHH....',
    '...Hh....hH...',
    '....HHHHHH....',
    'k....22....k..',
    'kxk2113311kxk.',
    '...21FFFFFF12.',
    '...21FEEFFFF1.',
    '...21FFFFFFF1.',
    '....22FFFF22..',
    '....2111122...',
    '...211333112..',
    '..2114444112..',
    '..2114444112..',
    '..2111111112..',
    '..2111111112..',
    '..2111111112..',
    '...211111112..',
    '....22..22....',
    '....22..22....',
    '....22..22....',
  ],
  sultai_assassin: [
    'l..............',
    'lLl............',
    '....22.22......',
    '...2113311.....',
    '...211FFFF1....',
    '....2FFFFFFF...',
    '....2FEEFFFF...',
    '....2FFFFFFF...',
    '....2FFFFFf2...',
    '....22ff22.....',
    '...2111111A2...',
    '..21344441A12..',
    '..21344441112..',
    '..21111111112..',
    '..21111111112..',
    '..21111111112..',
    '...211111112...',
    '....22..22.....',
    '....22..22.....',
    '....22..22.....',
  ],
  mardu_warlord: [
    '....HHHHHH....',
    '...Hh....hH...',
    '....HHHHHH....',
    'k....22....k..',
    'kx.o2112o..xk.',
    '...oFFFFo.....',
    '...21FFFF12...',
    '...21FEEFF1...',
    '...21FFFFF1...',
    '....22FF22....',
    '....2111122...',
    '...211333112..',
    '..2114444112..',
    '..2114444112..',
    '..2111111112..',
    '..2111111112..',
    '..2111111112..',
    '...211111112..',
    '....22..22....',
    '....22..22....',
    '....22..22....',
  ],
  temur_shaman: [
    '..o.l..l.o....',
    '..oOlLlLloO...',
    '..22.....22...',
    '.2112....2112.',
    '.211333333312.',
    '.21FFFFFFFFFF.',
    '.21FEEFFFFEEF.',
    '.21FFFFFFFFFF.',
    '..21Fffffffff.',
    '...22FFFFff...',
    '...211111111..',
    'k.21144441A12k',
    'k.21144441112k',
    '..2111111111..',
    '..21111111A...',
    '...22..22..22.',
    '...22..22..22.',
    '...22..22..22.',
    '...22..22..22.',
  ],
  yore_tiller: [
    '......HHHHHH......',
    '.....Hh....hH.....',
    '......HHHHHH......',
    '........22........',
    '.......2112.......',
    'M....21FFFF12....M',
    'MmM.21FEEFFF12.MmM',
    'MmmM21FFFFFF12MmmM',
    'MmmM.22FFFF22.MmmM',
    '.MmM2111111112MmM.',
    '..MM21133311122MM.',
    '...2114411111A2...',
    '...2114411111A2...',
    '...2113333111A2...',
    '...2111111111A2...',
    '...2111111111A2...',
    '....22..22..22....',
    '....22..22..22....',
    '....22..22..22....',
    '....22..22..22....',
  ],
  glint_eye: [
    '...l........l...',
    '..lLl..K....lLl.',
    '...l..KkK....l..',
    'M..22.222...22.M',
    'MmM2111112.2MmM.',
    'MmmM3333312MmmM.',
    'MmmFFFFFFFF2MmM.',
    '.MmFEEFFFFFFMM..',
    '..MFFFFFFFFF.M..',
    '...FFFFFFFFf....',
    '....111ff112....',
    '....11144441....',
    '....11144441....',
    '....2A11A12.....',
    '....A2A1A2A.....',
    '...A.2A.2A.A....',
    '..A...A...A.....',
    '.A....A....A....',
    'A.....A.....A...',
    '......A.........',
  ],
  dune_brood: [
    '......HHHHHH......',
    '.....Hh....hH.....',
    '......HHHHHH......',
    '..o..l....l..o....',
    '..oOlLl..lLloO....',
    '..22........22....',
    '.2112.......2112..',
    '.21133333333312...',
    'k.21FFFFFFFFFk....',
    'k.21FEEFFFFEEk....',
    '..21FFFFFFFFFF12..',
    '..21FfffffFf12....',
    '...22FFffff22.....',
    '...211111111......',
    '..21134434112.....',
    '..21111111112.....',
    '..21111111A12.....',
    '...22..22..22.....',
    '...22..22..22.....',
    '...22..22..22.....',
  ],
  ink_treader: [
    '......HHHHHH......',
    '.....Hh....hH.....',
    '......HHHHHH......',
    '.l......22......l.',
    'lLl....2112....lLl',
    'W.....21FF12.....W',
    'WwW..21FFFF12..WwW',
    'WwwW.21FEEFF1.WwwW',
    'WvwwW21FFFFF1WwwvW',
    '.WvwW.22FF22.WvwW.',
    '.WvW.2111122..WvW.',
    '..WW.211333112.WW.',
    '.....2114441112...',
    '.....2114443112...',
    '.....2111111112...',
    '.....2111111112...',
    '.....2111111112...',
    '......22..22......',
    '......22..22......',
    '......22..22......',
  ],
  witch_maw: [
    '....HHHHHH....',
    '...Hh....hH...',
    '....HHHHHH....',
    'l..l.....l..l.',
    'lLl.lLl.lLl.l.',
    '....22.22.....',
    '...2113311....',
    '...2113311....',
    '...21FFFFFF2..',
    '...21FEEFFFF2.',
    '...21FFFFFFFF2',
    '....2FFffffFFF',
    '....2211FFff12',
    '....21111ff12.',
    '....21144412..',
    '...21144331...',
    '...21133311...',
    '...211333112..',
    '....2113331...',
    '.....211331...',
    '......21331...',
    '.......21331..',
    '........2113..',
    '.........212..',
  ],
  prismatic_avatar: [
    '......HHHHHHHH......',
    '.....Hh......hH.....',
    '......HHHHHHHH......',
    '........22..........',
    '.......2112.........',
    'W.....21FF12.....W..',
    'WwW..21FFFF12..WwW..',
    'WwwW.21FEEFF1.WwwW..',
    'WvwwW21FFFFF1WwwvW..',
    '.WvwW.22FF22.WvwW...',
    '.WvW.2111122.WvW....',
    '..WW.211333112.WW...',
    'k....2113344112....k',
    'kxk.211443344112.kxk',
    'k...211344334112....',
    '....211443344112....',
    '....211111111112....',
    '.....22..22..22.....',
    '.....22..22..22.....',
    '.....22..22..22.....',
  ],
  vigil_avatar: [
    '......HHHHHHHH.......',
    '....HHh......hHH.....',
    '......HHHHHHHH.......',
    '........22...........',
    '.......2112..........',
    'W......21FF12......W.',
    'WwW...21FEEFF12...WwW',
    'WwwW.21FFFFFFF1.WwwW.',
    'WvwwW2FFFFFFFFF2WwwvW',
    'WvwwW2211FFFF112WwwvW',
    'WvvwW.21111111A.WvvwW',
    '.WvwW2113333311A.WvwW',
    '.WvW.21133333312.WvW.',
    '..WW.21133311112.WW..',
    '.....21111111112.....',
    '.....21134431112.....',
    '.....21133331112.....',
    '.....21111111112.....',
    '......22..22.........',
    '......22..22.........',
    '......22..22.........',
  ],
  tidewarden: [
    '...22..............',
    '..2113.............',
    '..21133............',
    '...21133...........',
    '...22113...........',
    '....21FF22.........',
    '...21FEEFF2........',
    '..21FFFFFFF2.......',
    '..21FFFFFFFF2......',
    '..21FFFffffFF2.....',
    '..21FFFffff112.....',
    '...2211FFff112.....',
    '....2113311112.....',
    '...21133311111.....',
    '..21133331122......',
    '..2113333112.......',
    '..21133311.........',
    '.21133311..........',
    '.211333112.........',
    '..21133311.........',
    '...21133311........',
    '....2113311........',
    '.....211331........',
    '......21331........',
    '.......21331.......',
    '........2113.......',
    '.........212.......',
    '..........22.......',
  ],
  voidlord: [
    '..o..K.....K..o..',
    '..oOkkK...KkkOo..',
    '..oOO.x...x.OOo..',
    '...22.........22.',
    '..2111111111122..',
    '.21133331113332..',
    '.21FFFFFFFFFF12..',
    '.21FFFFFFFFFFF1..',
    '.21FEEFFFFEEFFF..',
    '.21FFFFFFFFFFFF..',
    '.21FFFFFFFFFFFF..',
    '..2FFFFFFFFFf12..',
    '..2111ffffff112..',
    '..2113333333A12..',
    '..21133333111A2..',
    '..21111111111A...',
    '...21111111A12...',
    '....2A11A11A2....',
    '....A2A1A1A2A....',
    '...A.2A.2A.2A....',
    '..A...A...A...A..',
    '.A....A....A.....',
    'A.....A.....A....',
  ],
  pyreclaw: [
    'M.................',
    'MmM...............',
    'MmmM......o....o..',
    'MmmmM.....oO..oO..',
    'MmmmmM....22..22..',
    'MmmmmmM..21122112.',
    'MmmmmmM2211FFFFE12',
    '.MmmmmM2FFFFFFFFFE',
    '.MmmmmM2FFFFFFFFFF',
    '..MmmmM221FFFFFff1',
    '..MmmmM221111ff112',
    '..MmmmM21133333112',
    '...MmmM2113333312.',
    '....MmM21133331...',
    '....MmM21111A12...',
    '.....MM21111A12...',
    '......M2A1A11A2...',
    '......M2A1A1A22...',
    '......2A1A1A2..k..',
    '....2P22A1A2...kk.',
    '....2P22.A2....k..',
    '....2S2.........K.',
    '....2s2...........',
  ],
  patriarch_wurm: [
    '...l...l...l......',
    '..lLl.lLl.lLl.....',
    '...l...l...l......',
    'o.....22.22.....o.',
    'oO...2113311...oO.',
    '..21133333311.....',
    '..21FFFFFFFFF2....',
    '..21FEEFFFEEFF2...',
    '..21FFFFFFFFFFF2..',
    '..21FFffffffFFFF2.',
    '..21FFffffffffFFF2',
    '...221FFFFFFffff12',
    '....221111ffff112.',
    '....211133331112..',
    '....2113333311....',
    '....21133331......',
    '....21133311......',
    '....21133311......',
    '....211333112.....',
    '.....21133311.....',
    '......21133311....',
    '.......2113331....',
    '........211331....',
    '.........21133....',
    '..........2113....',
    '...........212....',
    '............22....',
  ],
  the_planeswalker: [
    '......HHHHHHHH.......',
    '....HHh......hHH.....',
    '......HHHHHHHH.......',
    '........22...........',
    '.......2112..........',
    'W.....21FF12.....W...',
    'WwW..21FFFF12..WwW...',
    'WwwW.21FEEFF1.WwwW...',
    'WvwwW2FFFFFFF2WwwvW..',
    'WvwwW2211FFFF112WvwW.',
    '.WvwW.A1111111A.WvwW.',
    '.WvW.2113344112.WvW..',
    '..WW.2113444412..WW..',
    'k...21134333311112.k.',
    'kxK.21133443331112Kxk',
    'k...21111111111112..k',
    '....21111111111112...',
    '....21111111111112...',
    '.....22..22..22......',
    '.....22..22..22......',
    '.....22..22..22......',
  ],
};

// Rich palette: extends crPal with all the keys our hand-authored sprites use.
// Falls back gracefully for legacy archetype sprites (those keys are still present).
function crPalRich(c1, c2, c3, archetype, primary) {
  const base = crPal(c1, c2, c3, archetype);
  // Color-tinted feature palettes (so a Black wraith's wisp tendrils stay purple,
  // a Green wurm's leaves stay green, etc).
  const lighten = (hex, amt = 60) => {
    if (!hex || hex.length < 7) return '#ffffff';
    const r = Math.min(255, parseInt(hex.slice(1,3),16)+amt);
    const g = Math.min(255, parseInt(hex.slice(3,5),16)+amt);
    const b = Math.min(255, parseInt(hex.slice(5,7),16)+amt);
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  };
  const darken = (hex, amt = 50) => {
    if (!hex || hex.length < 7) return '#000000';
    const r = Math.max(0, parseInt(hex.slice(1,3),16)-amt);
    const g = Math.max(0, parseInt(hex.slice(3,5),16)-amt);
    const b = Math.max(0, parseInt(hex.slice(5,7),16)-amt);
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  };
  return {
    ...base,
    // Hooded face shadow — always near-black, eye color tinted by primary
    'F': '#1a0e08',
    'E': primary === 'B' ? '#e8c8ff' :
         primary === 'U' ? '#d8f0ff' :
         primary === 'G' ? '#fff8d0' :
         primary === 'R' ? '#fff8d0' :
                            '#fff8d0',
    // Halo gold (shared)
    'H': '#f8d850', 'h': '#a08428',
    // Angel feather palette
    'W': '#fff8e8', 'w': '#d8c098', 'v': '#7a6038',
    // Bat / dragon wing membrane — uses creature dark color so it blends
    'M': c2, 'm': darken(c2, 30),
    // Flames (universal)
    'K': '#fffadd', 'k': '#ffd870', 'x': '#ff7020',
    // Horns / claws / spear shaft
    'o': '#a89070', 'O': '#48381c',
    // Leaves (always green even on non-green creatures)
    'l': '#88c850', 'L': '#1a3810',
    // Highlight pixel
    'A': lighten(c1, 40),
    // Legs / feet (kept as before)
    'P': c2, 'S': '#2a1808',
    // Numbers
    '1': c1, '2': c2, '3': lighten(c1, 60), '4': c3 || c1,
  };
}


const CR_SPR = {
  // HUMANOID
  humanoid: [
    '...22222222...',
    '..2111111112..',
    '..2111111112..',
    '..2233333322..',
    '...21FFFF12...',
    '..21FFEEFF12..',
    '..21FfffffF2..',
    '..21FFFFFFf2..',
    '...211ff112...',
    '.222111111222.',
    '21A211111121A1',
    '21AAA1111A21AA',
    '21AAAAAAAAA1A1',
    '21AAAAAAAAA1A1',
    '212GGGGGGGG112',
    '21222222222222',
    '..2P2....2P2..',
    '..2P2....2P2..',
    '..2P2....2P2..',
    '..2S2....2S2..',
    '..2s2....2s2..',
  ],
  // BEAST
  beast: [
    '..3.........3...',
    '..32........32..',
    '..32........32..',
    '..3322....2233..',
    '.231111111111132',
    '.23111111111111.',
    '.23E11A11A11E13.',
    '.23111111111113.',
    '.23F1FFFFFF1F13.',
    '..2311ffff1132..',
    '...23ffffff32...',
    '...2311111132...',
    '..231111111132..',
    '.23111111111322.',
    '.2311AAAAAA1322.',
    '.231111111113322',
    '.23111111111332.',
    '..23P21..21P32..',
    '...2P2....2P2...',
    '...2S2....2S2...',
  ],
  // MERFOLK
  merfolk: [
    '....22222....',
    '...211111122.',
    '...21FFFF112.',
    '...21FEEFF12.',
    '...21Ff1Ff12.',
    '...21FFFFf12.',
    '...211FFf112.',
    '....2111122..',
    '..2A111111A2.',
    '..21AAAA112..',
    '..2AA11AAA2..',
    '...2111112...',
    '...21A1A12...',
    '...21111A2...',
    '...211A12....',
    '..221A22.....',
    '.221A22......',
    '221A22.......',
    '.22A2........',
    '..22.........',
  ],
  // WISP
  wisp: [
    '....222222....',
    '..2211111122..',
    '.2111111111A2.',
    '.21111AAAA112.',
    '.21A1AAAAAA12.',
    '.21EeAAAAEe12.',
    '.21A1AAAA1A12.',
    '.21111111111A.',
    '.21111A111122.',
    '.21111111122..',
    '..21A1A1112...',
    '...21A1112....',
    '...21111A2....',
    '....22A22.....',
    '.....2A2......',
    '...2A2........',
    '..2A2.........',
    '..22..........',
  ],
  // SERPENT
  serpent: [
    '...2222.......',
    '..211112......',
    '.21111122.....',
    '21EE111122....',
    '2111AAA1122...',
    '21111111122...',
    '2113333111122.',
    '.211111111122.',
    '..21111111122.',
    '..2A11111A112.',
    '..2111A11A1122',
    '..21AA111111A2',
    '..21111A11A112',
    '..2A1A1111A1A2',
    '...21111A1112.',
    '...2A1A11AA12.',
    '....2111A112..',
    '....2A11A12...',
    '.....21A12....',
    '......222.....',
  ],
  // DRAKE
  drake: [
    '...222222....2....',
    '..21111112...2....',
    '.211111A12...22...',
    '21E111111122..2...',
    '211111111112..22..',
    '2113333AA1122..2..',
    '.21111111122...22.',
    '..2111111122....2.',
    '..21111A1122...22.',
    '..211A11AA1222.22.',
    '.2111AAAAAA1222.2.',
    '21111AAAAAAA1222..',
    '2A111AAA111A11222.',
    '21A11A1AA1A111222.',
    '.2A1AAAAAA1A1222..',
    '..211111111A1222..',
    '..211111A111122...',
    '..2P22112P22A22...',
    '..2P2...2P22A22...',
    '..2S2...2S22A22...',
    '..2s2...2s222A2...',
    '............22A2..',
  ],
  // BLOB
  blob: [
    '....2222......',
    '..221111122...',
    '.21111111112..',
    '.211AAAA1122..',
    '21E11AA11E122.',
    '21111111111122',
    '21133331111A22',
    '21111111111A22',
    '.21111111A122.',
    '.21A11111122..',
    '.21111111122..',
    '..2111111122..',
    '..2111111122..',
    '..21111111A2..',
    '...211111122..',
    '....2P22P2....',
    '....2P22P2....',
    '....2S22S2....',
    '....2s22s2....',
  ],
};

const SHAPE_TO_ARCHETYPE = {
  humanoid: 'humanoid',
  beast:    'beast',
  merfolk:  'merfolk',
  wisp:     'wisp',
  serpent:  'serpent',
  drake:    'drake',
  blob:     'blob',
};

// Build dynamic palette from creature colors
// Faces are body-tinted (within palette family) for ALL archetypes
function crPal(c1, c2, c3, archetype) {
  const lighten = (hex, amt = 55) => {
    if (!hex || hex.length < 7) return '#ffffff';
    const r = Math.min(255, parseInt(hex.slice(1,3),16)+amt);
    const g = Math.min(255, parseInt(hex.slice(3,5),16)+amt);
    const b = Math.min(255, parseInt(hex.slice(5,7),16)+amt);
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  };
  const darken = (hex, amt = 45) => {
    if (!hex || hex.length < 7) return '#000000';
    const r = Math.max(0, parseInt(hex.slice(1,3),16)-amt);
    const g = Math.max(0, parseInt(hex.slice(3,5),16)-amt);
    const b = Math.max(0, parseInt(hex.slice(5,7),16)-amt);
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  };
  // Faces always blend with the body palette — never default skin
  // Humanoids/merfolk get a SLIGHTLY desaturated lighter tone for a face;
  // animals get a pure body-color shade
  const useSkin = archetype === 'humanoid' || archetype === 'merfolk';
  // Tint white slightly toward body color for humanoid faces, but keep them in palette family
  const faceLight = useSkin ? lighten(c1, 35) : lighten(c1, 25);
  const faceDark  = useSkin ? c1             : darken(c1, 15);
  return {
    '1': c1,
    '2': c2,
    '3': lighten(c1),
    '4': c3,
    'F': faceLight,
    'f': faceDark,
    'E': '#180e10',
    'e': '#f0e8d8',
    'G': '#d4c030',
    'g': '#a09020',
    'A': lighten(c1),
    'a': c1,
    'P': c2,
    'p': '#0a0810',
    'S': '#2a1808',
    's': '#180e04',
    'M': '#d020a0',
    'B': lighten(c1),
    'b': c2,
    'W': '#ffffff',
    'O': '#0a0814',
  };
}

// Pixel-art renderer — emits SVG <rect> elements
function renderPxSpr(rows, pal, cx=36, baseY=80, ps=3) {
  if (!rows) return null;
  const maxW = rows.reduce((m,r)=>Math.max(m,r.length),0);
  const H = rows.length;
  const ox = cx - Math.floor(maxW*ps/2);
  const oy = baseY - H*ps;
  const elems = [];
  rows.forEach((row,r)=>{
    for(let c=0;c<row.length;c++){
      const k=row[c];
      if(k==='.' || !pal[k]) continue;
      elems.push(<rect key={r+'-'+c} x={ox+c*ps} y={oy+r*ps} width={ps} height={ps} fill={pal[k]} shapeRendering="crispEdges"/>);
    }
  });
  return { elems, top: oy, bottom: oy+H*ps, left: ox, right: ox+maxW*ps, cx, h: H*ps, w: maxW*ps };
}

function CreatureSprite({ creature, facing, scale = 1 }) {
  const cols = colorsOf(creature.c);
  const primary   = cols[0] || 'W';
  const secondary = cols[1] || primary;
  const c1 = COLOR_HEX[primary];
  const c2 = COLOR_DEEP[primary];
  const c3 = COLOR_HEX[secondary];

  const W = 72, H = 88;
  const s = specFor(creature.id);
  const tier = creature.tier || 0;
  const flashing = creature.flashUntil && creature.flashUntil > Date.now();
  const glowColor = c1 + '88';

  const [, force] = useState(0);
  useEffect(() => {
    if (!flashing) return;
    const remaining = creature.flashUntil - Date.now();
    const id = setTimeout(() => force(n => n+1), remaining + 50);
    return () => clearTimeout(id);
  }, [creature.flashUntil, flashing]);

  const filter = flashing
    ? 'drop-shadow(0 0 14px #ffe888) drop-shadow(0 0 20px #fff6c8)'
    : 'drop-shadow(0 0 8px ' + glowColor + ')';

  // Use per-creature pixel art when available; fall back to archetype shape.
  const archetype = SHAPE_TO_ARCHETYPE[s.shape] || 'blob';
  const customRows = PER_CREATURE_SPR[creature.id];
  const rows = customRows || CR_SPR[archetype];
  const pal  = customRows
    ? crPalRich(c1, c2, c3, archetype, primary)
    : crPal(c1, c2, c3, archetype);
  const sprite = renderPxSpr(rows, pal);

  // === FX layers ===================================================
  // All FX are positioned RELATIVE to the actual sprite bbox so they
  // always sit at the right anatomy point regardless of sprite size.
  const bgFx = [];   // behind sprite (back wings)
  const fgFx = [];   // in front of / on top of sprite (halo, flames, horns, front wings)

  const spriteTop    = sprite.top;
  const spriteBottom = sprite.bottom;
  const spriteCx     = sprite.cx;
  const spriteH      = sprite.h;
  // Anatomical reference points
  const headTop      = spriteTop;
  const headBottom   = spriteTop + Math.min(28, spriteH * 0.35);
  // Shoulder line: about 35-40% down for humanoids; for non-humanoids approximate similarly
  const shoulderY    = spriteTop + Math.round(spriteH * 0.36);
  const hipY         = spriteTop + Math.round(spriteH * 0.65);

  // ---- Wings (positioned at shoulder/upper-back, asymmetric pose) ----
  if (s.wings === 'angel' || s.wings === 'bird') {
    const wColor  = '#f4ead0';
    const wShadow = '#c9b888';
    const wDetail = '#a08858';
    // LEFT wing (slightly lower / spread back)
    bgFx.push(
      <g key="wingL" opacity="0.96">
        <rect x={spriteCx-26} y={shoulderY-2}  width="14" height="6" fill={wShadow} shapeRendering="crispEdges"/>
        <rect x={spriteCx-30} y={shoulderY+2}  width="16" height="6" fill={wShadow} shapeRendering="crispEdges"/>
        <rect x={spriteCx-32} y={shoulderY+6}  width="14" height="6" fill={wShadow} shapeRendering="crispEdges"/>
        <rect x={spriteCx-24} y={shoulderY-6}  width="10" height="6" fill={wColor}  shapeRendering="crispEdges"/>
        <rect x={spriteCx-28} y={shoulderY}    width="14" height="4" fill={wColor}  shapeRendering="crispEdges"/>
        <rect x={spriteCx-30} y={shoulderY+4}  width="14" height="4" fill={wColor}  shapeRendering="crispEdges"/>
        {/* feather lines */}
        <rect x={spriteCx-20} y={shoulderY+2}  width="2"  height="6" fill={wDetail} shapeRendering="crispEdges"/>
        <rect x={spriteCx-24} y={shoulderY+6}  width="2"  height="6" fill={wDetail} shapeRendering="crispEdges"/>
      </g>
    );
    // RIGHT wing (raised slightly higher — asymmetric pose)
    bgFx.push(
      <g key="wingR" opacity="0.96">
        <rect x={spriteCx+12} y={shoulderY-4}  width="14" height="6" fill={wShadow} shapeRendering="crispEdges"/>
        <rect x={spriteCx+14} y={shoulderY}    width="18" height="6" fill={wShadow} shapeRendering="crispEdges"/>
        <rect x={spriteCx+16} y={shoulderY+4}  width="14" height="6" fill={wShadow} shapeRendering="crispEdges"/>
        <rect x={spriteCx+14} y={shoulderY-8}  width="10" height="6" fill={wColor}  shapeRendering="crispEdges"/>
        <rect x={spriteCx+14} y={shoulderY-2}  width="14" height="4" fill={wColor}  shapeRendering="crispEdges"/>
        <rect x={spriteCx+16} y={shoulderY+2}  width="14" height="4" fill={wColor}  shapeRendering="crispEdges"/>
        <rect x={spriteCx+22} y={shoulderY}    width="2"  height="6" fill={wDetail} shapeRendering="crispEdges"/>
        <rect x={spriteCx+26} y={shoulderY+4}  width="2"  height="6" fill={wDetail} shapeRendering="crispEdges"/>
      </g>
    );
  } else if (s.wings === 'bat' || s.wings === 'dragon') {
    const wColor    = c2;
    const wMembrane = c1;
    const wEdge     = '#0a0410';
    // Folded/spread bat wings extending from upper back
    bgFx.push(
      <g key="wingL" opacity="0.95">
        <rect x={spriteCx-28} y={shoulderY-4} width="14" height="6"  fill={wMembrane} shapeRendering="crispEdges"/>
        <rect x={spriteCx-32} y={shoulderY+2} width="16" height="6"  fill={wMembrane} shapeRendering="crispEdges"/>
        <rect x={spriteCx-30} y={shoulderY+8} width="12" height="6"  fill={wMembrane} shapeRendering="crispEdges"/>
        <rect x={spriteCx-24} y={shoulderY-2} width="2"  height="14" fill={wEdge}     shapeRendering="crispEdges"/>
        <rect x={spriteCx-30} y={shoulderY+4} width="2"  height="8"  fill={wEdge}     shapeRendering="crispEdges"/>
      </g>
    );
    bgFx.push(
      <g key="wingR" opacity="0.95">
        <rect x={spriteCx+14} y={shoulderY-4} width="14" height="6"  fill={wMembrane} shapeRendering="crispEdges"/>
        <rect x={spriteCx+16} y={shoulderY+2} width="16" height="6"  fill={wMembrane} shapeRendering="crispEdges"/>
        <rect x={spriteCx+18} y={shoulderY+8} width="12" height="6"  fill={wMembrane} shapeRendering="crispEdges"/>
        <rect x={spriteCx+22} y={shoulderY-2} width="2"  height="14" fill={wEdge}     shapeRendering="crispEdges"/>
        <rect x={spriteCx+28} y={shoulderY+4} width="2"  height="8"  fill={wEdge}     shapeRendering="crispEdges"/>
      </g>
    );
  } else if (s.wings === 'jet' || s.wings === 'fire') {
    // Energy/jet wings — flames or magic streaks at shoulder
    fgFx.push(
      <g key="jet" opacity="0.92">
        <rect x={spriteCx-22} y={shoulderY+2} width="10" height="4" fill="#ff9020" shapeRendering="crispEdges"/>
        <rect x={spriteCx-26} y={shoulderY+6} width="12" height="4" fill="#ff6010" shapeRendering="crispEdges"/>
        <rect x={spriteCx+12} y={shoulderY+2} width="10" height="4" fill="#ff9020" shapeRendering="crispEdges"/>
        <rect x={spriteCx+14} y={shoulderY+6} width="12" height="4" fill="#ff6010" shapeRendering="crispEdges"/>
      </g>
    );
  }

  // ---- Glow aura behind body ----
  if (s.glow) {
    bgFx.push(
      <ellipse key="glow" cx={spriteCx} cy={(spriteTop+spriteBottom)/2}
               rx={sprite.w*0.55} ry={spriteH*0.45}
               fill={c1+'22'} stroke={c1+'66'} strokeWidth="0.5"/>
    );
  }

  // ---- Horns (extend up from head crown, slight outward angle) ----
  if (s.horns) {
    const hh = 6 + s.horns * 4;
    fgFx.push(
      <g key="horns">
        {/* Left horn */}
        <rect x={spriteCx-9} y={headTop-hh+2} width="3" height={hh} fill="#d4b840" shapeRendering="crispEdges"/>
        <rect x={spriteCx-10} y={headTop-hh+2} width="2" height={Math.round(hh*0.6)} fill="#f0d860" shapeRendering="crispEdges"/>
        {/* Right horn */}
        <rect x={spriteCx+6} y={headTop-hh+2} width="3" height={hh} fill="#d4b840" shapeRendering="crispEdges"/>
        <rect x={spriteCx+7} y={headTop-hh+2} width="2" height={Math.round(hh*0.6)} fill="#f0d860" shapeRendering="crispEdges"/>
      </g>
    );
  }

  // ---- Flames (overlap silhouette — start from belt area, rise up & past head) ----
  if (s.flames) {
    const fl = s.flames;
    const fbase = hipY;
    const fh    = headBottom - fbase + 14 + fl * 4;
    // Use jagged flame silhouette (small rects offset to mimic flicker)
    fgFx.push(
      <g key="flames" opacity="0.88">
        {/* Outer red flame body */}
        <rect x={spriteCx-9} y={fbase-fh+8} width="18" height={fh-8} fill="#e63a10" shapeRendering="crispEdges"/>
        <rect x={spriteCx-7} y={fbase-fh+4} width="14" height={fh-4} fill="#ff5a18" shapeRendering="crispEdges"/>
        <rect x={spriteCx-5} y={fbase-fh}   width="10" height={fh}   fill="#ff8030" shapeRendering="crispEdges"/>
        {/* Inner orange */}
        <rect x={spriteCx-4} y={fbase-fh+6} width="8"  height={fh-10} fill="#ffb040" shapeRendering="crispEdges"/>
        <rect x={spriteCx-3} y={fbase-fh+10} width="6" height={fh-14} fill="#ffd870" shapeRendering="crispEdges"/>
        {/* Top flicker tip */}
        <rect x={spriteCx-2} y={fbase-fh-3} width="4"  height="6" fill="#ffe890" shapeRendering="crispEdges"/>
        <rect x={spriteCx-1} y={fbase-fh-6} width="2"  height="4" fill="#fffadd" shapeRendering="crispEdges"/>
        {/* Side jagged flicker (asymmetric) */}
        <rect x={spriteCx-11} y={fbase-fh+12} width="3" height="4" fill="#ff8030" shapeRendering="crispEdges"/>
        <rect x={spriteCx+9}  y={fbase-fh+10} width="3" height="6" fill="#ff8030" shapeRendering="crispEdges"/>
        <rect x={spriteCx+10} y={fbase-fh+16} width="2" height="4" fill="#e63a10" shapeRendering="crispEdges"/>
      </g>
    );
  }

  // ---- Halo (renders ABOVE everything, just above head crown) ----
  if (s.halo) {
    const r = 11 + s.halo * 3;
    let haloY = headTop - 4;
    // If horns or flames, push halo up so all are visible
    if (s.horns)  haloY -= s.horns * 4;
    if (s.flames) haloY -= 4;
    fgFx.push(
      <g key="halo">
        <ellipse cx={spriteCx} cy={haloY} rx={r}     ry={Math.round(r*0.32)}
                 fill="none" stroke="#ffe888" strokeWidth={1.4 + s.halo*0.4} opacity="0.95"/>
        <ellipse cx={spriteCx} cy={haloY} rx={r-2}   ry={Math.round(r*0.22)}
                 fill="none" stroke="#fff8d8" strokeWidth="0.8" opacity="0.7"/>
      </g>
    );
  }

  // ---- Staff (humanoids only) ----
  if (s.staff) {
    fgFx.push(
      <g key="staff">
        <rect x={spriteCx+sprite.w*0.4} y={shoulderY-4} width="3" height={hipY-shoulderY+18} fill="#8a6a40" shapeRendering="crispEdges"/>
        <rect x={spriteCx+sprite.w*0.4-2} y={shoulderY-10} width="7" height="7" fill="#ffe888" shapeRendering="crispEdges"/>
        <rect x={spriteCx+sprite.w*0.4-1} y={shoulderY-9}  width="4" height="4" fill="#ffffff" shapeRendering="crispEdges"/>
      </g>
    );
  }

  // ---- Tail spike (extends past body to the right) ----
  if (s.tailSpike) {
    fgFx.push(
      <g key="tspike">
        <rect x={sprite.right-2} y={spriteBottom-12} width="6" height="3" fill={c2} shapeRendering="crispEdges"/>
        <rect x={sprite.right+2} y={spriteBottom-10} width="4" height="3" fill={c2} shapeRendering="crispEdges"/>
        <rect x={sprite.right+4} y={spriteBottom-8}  width="3" height="3" fill={c2} shapeRendering="crispEdges"/>
      </g>
    );
  }

  return (
    <div style={{
      width: W*scale, height: H*scale,
      transform: facing==='left' ? 'scaleX(-1)' : 'none',
      filter,
    }}>
      <div style={{
        width: '100%', height: '100%',
        animation: flashing ? 'gtmEvoFlash 0.7s ease-in-out infinite alternate' : undefined,
        transformOrigin: 'center',
      }}>
        <svg viewBox={'0 0 '+W+' '+H} width={W*scale} height={H*scale}>
          <ellipse cx={W/2} cy={H-4} rx="22" ry="4" fill="rgba(0,0,0,0.55)"/>
          {/* Background FX (wings, glow) */}
          {bgFx}
          {/* Body sprite */}
          {sprite.elems}
          {/* Foreground FX (halo, flames, horns) — overlap silhouette */}
          {fgFx}
        </svg>
      </div>
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
// RENAME PROMPT — set or clear a creature's nickname
// =========================================================================
// Modal with a text input. Empty submission clears the nickname (revert to
// species name). Cap at 16 chars to prevent UI overflow.
function RenamePrompt({ creature, onConfirm, onCancel }) {
  const [val, setVal] = useState(creature.nick || '');
  const submit = () => onConfirm(val.trim().slice(0, 16));
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,6,20,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 60, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(180deg, #2a2038, #141020)',
          border: '2px solid #6a5a88', borderRadius: 6,
          padding: 18, width: 'min(90vw, 340px)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
          animation: 'gtmDialogSlideUp 0.25s ease-out',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#e8dcc0' }}>
          Name your {creature.name}?
        </div>
        <div style={{ fontSize: 11, color: '#9888b0', marginBottom: 10 }}>
          Leave blank to keep the species name.
        </div>
        <input
          type="text"
          autoFocus
          value={val}
          maxLength={16}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') onCancel(); }}
          placeholder={creature.name}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 10px', fontSize: 14,
            background: '#0a0614', border: '1px solid #6a5a88',
            borderRadius: 4, color: '#f4ecd8',
            fontFamily: "'Cinzel', serif", letterSpacing: 0.5,
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="mtgBtn" onClick={onCancel} style={{ padding: '6px 12px', fontSize: 12 }}>
            Cancel
          </button>
          <button className="mtgBtn" onClick={submit} style={{ padding: '6px 14px', fontSize: 12, borderColor: '#9ad080', color: '#d8f0c8' }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// DIALOG PANEL — typewriter text reveal with skip-to-end on first interaction
// =========================================================================
// Lines are revealed one character at a time. A small "tick" sound fires every
// few characters for that classic JRPG feel. Pressing Continue (or A/Enter) the
// first time skips the typewriter to the end of the current set; pressing again
// dismisses the dialog.
function DialogPanel({ dialog }) {
  const fullText = dialog.lines.join('\n');
  const [revealed, setRevealed] = useState(0);
  const isComplete = revealed >= fullText.length;
  useEffect(() => {
    if (isComplete) return;
    const id = setInterval(() => {
      setRevealed(r => {
        const next = Math.min(r + 1, fullText.length);
        // Tick sound every 3 characters, but never on whitespace (avoids spam)
        if (next > r && next % 3 === 0 && fullText[next - 1] && /\S/.test(fullText[next - 1])) {
          // sfx.blip is a quiet "click" at ~720Hz — perfect for typewriter ticks
          try { audio.sfx.blip(); } catch (_) {}
        }
        return next;
      });
    }, 25);
    return () => clearInterval(id);
  }, [fullText, isComplete]);
  // First press = skip to end. Second press = onDone (dismiss).
  // If dialog.choices are present, a second press shows the choices instead of auto-dismissing.
  const advance = () => {
    if (!isComplete) {
      setRevealed(fullText.length);
      return;
    }
    // When choices are defined, clicking the background after text is done does nothing —
    // the player must explicitly pick a choice button.
    if (dialog.choices) return;
    dialog.onDone?.();
  };
  // Render the revealed substring back as the original line array
  const shown = fullText.slice(0, revealed);
  const lines = shown.split('\n');
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,6,20,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}
      onClick={advance}
    >
      <div style={{
        width: 'min(92vw, 460px)', margin: 20,
        background: 'linear-gradient(180deg, #2a2038, #141020)',
        border: '2px solid #6a5a88', borderRadius: 6, padding: 16,
        boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
        animation: 'gtmDialogSlideUp 0.3s ease-out',
      }}>
        {/* Show all lines that have at least started revealing.
            The last visible line gets a blinking cursor while still typing. */}
        {lines.map((l, i) => (
          <div key={i} style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 8, minHeight: '1.5em' }}>
            {l}
            {!isComplete && i === lines.length - 1 && (
              <span style={{
                display: 'inline-block', width: 6, height: 14,
                background: '#c8b888', marginLeft: 2,
                animation: 'pulse 0.8s ease-in-out infinite',
                verticalAlign: 'baseline',
              }} />
            )}
          </div>
        ))}
        {/* Render any not-yet-started lines as empty placeholders so the box
            doesn't visibly grow as text reveals. */}
        {dialog.lines.length > lines.length && Array.from({ length: dialog.lines.length - lines.length }).map((_, i) => (
          <div key={`ph-${i}`} style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 8, minHeight: '1.5em' }}>&nbsp;</div>
        ))}
        {/* Bottom action area: choice buttons when defined, otherwise single Continue/Skip */}
        <div style={{ marginTop: 10 }}>
          {dialog.choices && isComplete ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dialog.choices.map((ch, i) => (
                <button key={i} className="mtgBtn"
                  onClick={(e) => { e.stopPropagation(); ch.action(); }}
                  style={{ padding: '8px 14px', fontSize: 13, textAlign: 'left',
                           ...(i === 0 ? { borderColor: '#c9a664', color: '#f4e5a8' } : { opacity: 0.7 }) }}>
                  {ch.label}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'right' }}>
              <button className="mtgBtn" onClick={(e) => { e.stopPropagation(); advance(); }} style={{ fontSize: 13, padding: '6px 14px' }}>
                {isComplete ? (dialog.choices ? '...' : '▸ Continue') : '» Skip'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// MOVE-SET EDITOR — drag/swap-by-tap UI for reordering a creature's 4 moves
// =========================================================================
// Shows all 4 move slots (or fewer, padded with empty placeholders). Tap a move
// to "select" it; tap a second move to swap their positions. Move 1 is the
// default move shown in battle when no one explicitly chooses.
function MoveSetEditor({ creature, onSwap }) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const moves = creature.moves || [];
  const handleTap = (idx) => {
    if (selectedIdx === null) {
      setSelectedIdx(idx);
    } else if (selectedIdx === idx) {
      setSelectedIdx(null);  // deselect
    } else {
      onSwap(selectedIdx, idx);
      setSelectedIdx(null);
    }
  };
  return (
    <div style={{
      width: '100%', maxWidth: 200,
      marginTop: 4,
      padding: 8,
      background: 'rgba(20, 12, 36, 0.6)',
      border: '1px solid #4a3a68',
      borderRadius: 4,
      animation: 'gtmDialogSlideUp 0.2s ease-out',
    }}>
      <div style={{ fontSize: 9, color: '#9888b0', marginBottom: 5, textAlign: 'center', letterSpacing: 1 }}>
        TAP TO SWAP · slot 1 = default
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {[0, 1, 2, 3].map(idx => {
          const moveKey = moves[idx];
          const move = moveKey ? MOVES[moveKey] : null;
          const isSelected = selectedIdx === idx;
          const isEmpty = !move;
          return (
            <button
              key={idx}
              onClick={() => !isEmpty && handleTap(idx)}
              disabled={isEmpty}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 7px', fontSize: 11,
                background: isSelected
                  ? 'linear-gradient(180deg, #c8a448, #6a5418)'
                  : isEmpty
                    ? 'rgba(20, 12, 36, 0.4)'
                    : 'linear-gradient(180deg, #2a2038, #141020)',
                color: isSelected ? '#1a0e08' : (isEmpty ? '#5a5070' : '#e8dcc0'),
                border: `1px solid ${isSelected ? '#f0d860' : (isEmpty ? '#3a3050' : '#6a5a88')}`,
                borderRadius: 3,
                cursor: isEmpty ? 'default' : 'pointer',
                opacity: isEmpty ? 0.55 : 1,
                fontFamily: "'Cinzel', serif",
                textAlign: 'left',
                transition: 'background 0.12s, border-color 0.12s',
              }}
            >
              <span style={{ fontSize: 9, opacity: 0.7, minWidth: 12 }}>{idx + 1}.</span>
              {!isEmpty && move.c && (
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: COLOR_HEX[move.c] || '#888',
                  border: '1px solid #1a0e28',
                  flexShrink: 0,
                }} />
              )}
              <span style={{ flex: 1, fontWeight: isSelected ? 700 : 500 }}>
                {isEmpty ? '— empty —' : move.name}
              </span>
              {!isEmpty && move.p > 0 && (
                <span style={{ fontSize: 9, opacity: 0.7 }}>P{move.p}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =========================================================================
// MENU SCREEN
// =========================================================================
// =========================================================================
// HELD ITEM PICKER — appears below a creature card in the Team tab when
// the player taps "⬡ Item". Shows currently equipped item and all held
// items in inventory; tapping equips (swapping out the old one if any).
// =========================================================================
function HeldItemPicker({ creature, items, onEquip, onUnequip }) {
  const heldEntries = Object.entries(items).filter(([k, n]) => n > 0 && ITEMS[k]?.kind === 'held');
  const equippedItem = creature.heldItem ? ITEMS[creature.heldItem] : null;
  return (
    <div style={{
      width: '100%', marginTop: 4, padding: '8px 10px',
      background: 'linear-gradient(180deg, #1a1428 0%, #130e20 100%)',
      border: '1.5px solid #c9a664', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 10, color: '#c9a664', fontFamily: "'Cinzel', serif", letterSpacing: 1 }}>
        HELD ITEM
      </div>
      {/* Current equipped slot */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 8px', borderRadius: 4,
        background: equippedItem ? 'rgba(201,166,100,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${equippedItem ? '#c9a664' : '#3a2a50'}`,
        minHeight: 32,
      }}>
        {equippedItem ? (
          <>
            <span style={{ fontSize: 16 }}>{equippedItem.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#f4e5a8' }}>{equippedItem.name}</div>
              <div style={{ fontSize: 9, color: '#9888b0' }}>{equippedItem.desc}</div>
            </div>
            <button className="mtgBtn" onClick={onUnequip}
              style={{ fontSize: 9, padding: '2px 6px', opacity: 0.75 }}>
              ✕ Remove
            </button>
          </>
        ) : (
          <span style={{ fontSize: 11, color: '#5a4a70', fontStyle: 'italic' }}>— No item equipped —</span>
        )}
      </div>
      {/* Available held items */}
      {heldEntries.length === 0 && !equippedItem && (
        <div style={{ fontSize: 10, color: '#7a6898', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
          No held items in bag. Buy some at Merle's shop.
        </div>
      )}
      {heldEntries.map(([key, count]) => {
        const it = ITEMS[key];
        const isEquipped = creature.heldItem === key;
        return (
          <button key={key} className="mtgBtn" onClick={() => onEquip(key)} disabled={isEquipped}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 8px', textAlign: 'left',
              opacity: isEquipped ? 0.5 : 1,
              background: isEquipped ? 'rgba(201,166,100,0.1)' : undefined,
            }}>
            <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{it.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{it.name}
                <span style={{ fontWeight: 400, color: '#9888b0', marginLeft: 4 }}>×{count}</span>
              </div>
              <div style={{ fontSize: 9, color: '#9888b0' }}>{it.desc}</div>
            </div>
            {isEquipped && <span style={{ fontSize: 9, color: '#c9a664' }}>✓ ON</span>}
          </button>
        );
      })}
    </div>
  );
}

function MenuScreen({ team, codex, tokens, gold, items, mode, commanderColor, storageBroken, defeated, trainerCycles, medallions, planeswalkerDefeated, currentPlane, planeBaseLevel, planeDualPairs, dualMedallions, vaultCount, lastDailyEncounters, hourOfDay, currentMap, onUseItem, onEquipItem, onCall, onRename, onSwapMoves, onOpenVault, onClose, onReset, onSaveQuit, onRelease, onCheckStorage }) {
  const [tab, setTab] = useState('team');
  const [pickingFor, setPickingFor] = useState(null); // item key to use, waiting for team pick
  const [releaseConfirm, setReleaseConfirm] = useState(null); // index of creature awaiting release confirmation
  // Tracks which creature's move-set is open for editing in the team tab.
  // null = none selected; toggles closed when the same creature's button is clicked again.
  const [movesUid, setMovesUid] = useState(null);
  // Which creature's held-item picker is open in the team tab (null = none).
  const [equipUid, setEquipUid] = useState(null);
  // Audio mute toggle — read once on mount; persists via the audio engine itself.
  const [muted, setMuted] = useState(audio.isMuted());

  // ── Tab list — Phone tab is gated behind owning the Runic Phone key item.
  const TABS = items.runic_phone
    ? ['team', 'codex', 'items', 'phone']
    : ['team', 'codex', 'items'];
  const TAB_LABEL = { team: 'Team', codex: 'Codex', items: 'Items', phone: '☎ Phone' };

  // ── Swipe-to-change-tab (mobile) ─────────────────────────────────────────
  // ≥50 px horizontal delta with <80 px vertical drift advances/retreats the
  // active tab; smaller motion is treated as a tap or scroll and ignored.
  const swipeStartX = useRef(null);
  const swipeStartY = useRef(null);
  const handleTouchStart = (e) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  };
  const handleTouchEnd = (e) => {
    if (swipeStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - swipeStartY.current);
    swipeStartX.current = null;
    swipeStartY.current = null;
    if (dy > 80 || Math.abs(dx) < 50) return;
    const cur = TABS.indexOf(tab);
    if (dx < 0 && cur < TABS.length - 1) {
      audio.sfx.blip();
      setTab(TABS[cur + 1]);
    } else if (dx > 0 && cur > 0) {
      audio.sfx.blip();
      setTab(TABS[cur - 1]);
    }
  };

  return (
    <div
      style={{ width: 'min(94vw, 440px)', margin: 'auto', animation: 'gtmMenuSlideIn 0.25s ease-out' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
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
      {/* Tab bar — gold underline marks active tab. Phone tab only shows when
          the player has unlocked the Runic Phone (defeating all 3 town trainers). */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {TABS.map(t => (
          <button key={t} className="mtgBtn" onClick={() => setTab(t)}
            style={{ flex: 1, padding: 6, fontSize: 12, opacity: tab === t ? 1 : 0.6,
                     borderBottom: tab === t ? '2px solid #c9a664' : '2px solid transparent',
                     transition: 'opacity 0.15s, border-color 0.15s' }}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 9, color: '#7a6898', marginBottom: 8,
                    fontStyle: 'italic', letterSpacing: 0.5 }}>
        ◀ swipe to switch tabs ▶
      </div>
      {tab === 'team' && (
        <>
          {/* Vault count badge — gives an at-a-glance reminder that more creatures
              are stored. Tappable when the player owns the Vault Sigil; otherwise
              just informational (with a hint where to find their stored creatures). */}
          {vaultCount > 0 && (
            <button
              onClick={items.vault_sigil ? onOpenVault : undefined}
              disabled={!items.vault_sigil}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '6px 10px', marginBottom: 8,
                background: items.vault_sigil
                  ? 'linear-gradient(180deg, #1a2438 0%, #1a1028 100%)'
                  : '#1a1428',
                border: items.vault_sigil ? '1.5px solid #c9a664' : '1.5px solid #5a7088',
                borderRadius: 4,
                color: '#a8c0e0', fontSize: 11,
                cursor: items.vault_sigil ? 'pointer' : 'default',
                fontFamily: "'Cinzel', serif",
                textAlign: 'left',
              }}>
              <span style={{ fontSize: 14 }}>✦</span>
              <span style={{ flex: 1 }}>
                <b>{vaultCount}</b> stored in the Hollow Vault
              </span>
              <span style={{ fontSize: 10, color: items.vault_sigil ? '#f4e5a8' : '#7a6898', fontStyle: 'italic' }}>
                {items.vault_sigil ? 'Tap to open' : 'Visit Keeper Solenne'}
              </span>
            </button>
          )}
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
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                      className="mtgBtn"
                      onClick={() => onRename && onRename(c.uid)}
                      style={{ fontSize: 10, padding: '3px 8px' }}
                      title="Set or clear nickname"
                    >
                      ✎ Rename
                    </button>
                    <button
                      className="mtgBtn"
                      onClick={() => setMovesUid(c.uid === movesUid ? null : c.uid)}
                      style={{ fontSize: 10, padding: '3px 8px',
                               background: c.uid === movesUid ? 'linear-gradient(180deg, #6a5a88, #3a2a58)' : undefined }}
                      title="Reorder moves"
                    >
                      ⚔ Moves
                    </button>
                    <button
                      className="mtgBtn"
                      onClick={() => { setEquipUid(c.uid === equipUid ? null : c.uid); setMovesUid(null); }}
                      style={{ fontSize: 10, padding: '3px 8px',
                               background: c.uid === equipUid ? 'linear-gradient(180deg, #4a6a30, #2a3a18)' : undefined,
                               borderColor: c.heldItem ? '#c9a664' : undefined }}
                      title="Equip a held item"
                    >
                      {c.heldItem ? `${ITEMS[c.heldItem]?.icon} Item` : '⬡ Item'}
                    </button>
                    {canRelease ? (
                      <button className="mtgBtn" onClick={() => setReleaseConfirm(i)}
                        style={{ fontSize: 10, padding: '3px 8px', opacity: 0.75 }}>
                        ✕ Release
                      </button>
                    ) : (
                      <div style={{ fontSize: 8, color: '#7a6a90', fontStyle: 'italic', alignSelf: 'center' }}>
                        {isCommander ? 'CMDR — bound' : 'Last — locked'}
                      </div>
                    )}
                  </div>
                  {/* Move-set editor — appears below the card when this creature is selected */}
                  {c.uid === movesUid && (
                    <MoveSetEditor
                      creature={c}
                      onSwap={(fromIdx, toIdx) => onSwapMoves && onSwapMoves(c.uid, fromIdx, toIdx)}
                    />
                  )}
                  {/* Held item picker — appears below the card when this creature is selected */}
                  {c.uid === equipUid && (
                    <HeldItemPicker
                      creature={c}
                      items={items}
                      onEquip={(key) => { onEquipItem && onEquipItem(c.uid, key); setEquipUid(null); audio.sfx.confirm(); }}
                      onUnequip={() => { onEquipItem && onEquipItem(c.uid, null); setEquipUid(null); audio.sfx.blip(); }}
                    />
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
          {/* Daily Encounters panel — surfaces the rare time-windowed creatures
              so the player knows where/when to look. Shows current availability
              status: live now (green), already-seen-today (gold), or pending
              (dim). The window times are real game-clock hours (24-min day). */}
          <div style={{
            marginBottom: 12, padding: 8,
            border: '1.5px solid #4a3a68', borderRadius: 4,
            background: 'linear-gradient(180deg, #1a1028 0%, #100820 100%)',
          }}>
            <div style={{ fontSize: 11, color: '#c8b8e0', letterSpacing: 1.2, marginBottom: 6, fontFamily: "'Cinzel', serif" }}>
              ✦ DAILY APPARITIONS
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {DAILY_ENCOUNTERS.map(entry => {
                const today = realDayNumber();
                const seenToday = lastDailyEncounters?.[entry.key] === today;
                const eligibleNow = !seenToday && (typeof hourOfDay === 'number') && hourInWindow(hourOfDay, entry.hours) && currentMap === entry.zone;
                const status = seenToday ? 'seen' : eligibleNow ? 'live' : 'pending';
                const statusColor = status === 'live' ? '#a8e0a8' : status === 'seen' ? '#f4e5a8' : '#6a5a88';
                const statusText = status === 'live' ? 'NEAR — NOW' : status === 'seen' ? 'SEEN TODAY' : 'WAITING';
                const dexName = DEX[entry.id]?.name || entry.id;
                const zoneName = MAPS[entry.zone]?.name || entry.zone;
                const [h0, h1] = entry.hours;
                const hoursLabel = h0 <= h1 ? `${h0}:00–${h1}:00` : `${h0}:00–${h1}:00 (overnight)`;
                return (
                  <div key={entry.key} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 6px',
                    background: '#1a1428',
                    border: `1px solid ${entry.glow}`,
                    borderRadius: 3,
                    opacity: status === 'pending' ? 0.55 : 1,
                  }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: entry.glow,
                      boxShadow: status === 'live' ? `0 0 6px ${entry.glow}` : 'none',
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#e8dcc0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.prefix} {dexName}
                      </div>
                      <div className="pixelFont" style={{ fontSize: 8, color: '#9080b0' }}>
                        {zoneName} · {hoursLabel}
                      </div>
                    </div>
                    <span className="pixelFont" style={{ fontSize: 8, fontWeight: 700, color: statusColor, letterSpacing: 0.5, flexShrink: 0 }}>
                      {statusText}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
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
          {/* Current Plane progress badge */}
          {currentPlane > 0 && (
            <div style={{
              padding: 8, marginBottom: 10,
              border: '1.5px solid #c8a860',
              borderRadius: 4,
              background: 'linear-gradient(135deg, #1a0c30 0%, #0c1428 100%)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: '#f0d870' }}>✦ {getPlaneName(currentPlane)}</div>
                <div style={{ fontSize: 11, color: '#c8a860' }}>Plane {currentPlane}</div>
              </div>
              <div style={{ fontSize: 10, color: '#a898c0', marginTop: 3 }}>
                Base creature level: {planeBaseLevel + 2} · Next Planeswalker: Lv. {getPlaneswalkerLevel(currentPlane)}
              </div>
            </div>
          )}
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
            {(medallions || []).length === 0 && !planeDualPairs && (
              <div style={{ fontSize: 9, color: '#7a6898', marginTop: 5, fontStyle: 'italic' }}>
                Each zone has a hidden building. Clear all five challengers once and the buildings open.
              </div>
            )}
            {/* Dual zone rift medallions — shown in Plane 1+ only */}
            {planeDualPairs && planeDualPairs.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 11, color: '#b070ff' }}>✦ Rift Medallions</div>
                  <div style={{ fontSize: 10, color: '#9060cc' }}>
                    {(dualMedallions || []).length} / {planeDualPairs.length}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  {planeDualPairs.map(([cA, cB]) => {
                    const pk = normPair(cA, cB);
                    const has = (dualMedallions || []).includes(pk);
                    const gName = GUILD_NAMES[pk] || pk;
                    return (
                      <div key={pk} title={has ? `${gName} Rift Medallion (collected)` : `${gName} Rift Medallion (not yet)`}
                        style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                          background: has ? '#4a1a8a' : '#1a0e28',
                          border: has ? '1px solid #b070ff' : '1px dashed #4a2870',
                          color: has ? '#d0a0ff' : '#5a3880',
                          boxShadow: has ? '0 0 5px #b070ff55' : 'none',
                        }}>
                        {has ? `✦ ${gName}` : `? ${gName}`}
                      </div>
                    );
                  })}
                </div>
                {(dualMedallions || []).length === 0 && (
                  <div style={{ fontSize: 9, color: '#7a5898', marginTop: 4, fontStyle: 'italic' }}>
                    Find X-portals in each zone to enter rift corridors. Defeat all 5 rift guardians to unlock the wardens.
                  </div>
                )}
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
          {/* Inventory list — consumables only (held items are equipped via Team tab) */}
          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            {Object.entries(items).filter(([k, n]) => n > 0 && ITEMS[k]?.kind !== 'held').length === 0 && (
              <div style={{ color: '#9080b0', fontSize: 12, textAlign: 'center', padding: 12 }}>
                No items. Visit Merle's shop in town.
              </div>
            )}
            {Object.entries(items).filter(([k, n]) => n > 0 && ITEMS[k]?.kind !== 'held').map(([key, count]) => {
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
                  {/* Buttons:
                       - 'card' and 'key' kinds aren't usable as items.
                       - The Vault Sigil is a special key — its button opens the vault directly. */}
                  {key === 'vault_sigil' ? (
                    <button className="mtgBtn" onClick={onOpenVault}
                      style={{ padding: '4px 10px', fontSize: 11, color: '#f4e5a8' }}>
                      Open
                    </button>
                  ) : (
                    <button className="mtgBtn" onClick={() => setPickingFor(key)}
                      disabled={it.kind === 'card' || it.kind === 'key'}
                      style={{ padding: '4px 10px', fontSize: 11 }}>
                      Use
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {/* Held items section — shows bag stock; equip/unequip from Team tab */}
          {Object.entries(items).some(([k, n]) => n > 0 && ITEMS[k]?.kind === 'held') && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#c9a664', letterSpacing: 1.5,
                            fontFamily: "'Cinzel', serif", marginBottom: 6 }}>
                HELD ITEMS (equip via Team tab ▸ ⬡ Item)
              </div>
              <div style={{ display: 'grid', gap: 5 }}>
                {Object.entries(items).filter(([k, n]) => n > 0 && ITEMS[k]?.kind === 'held').map(([key, count]) => {
                  const it = ITEMS[key];
                  const equippedCount = team.filter(c => c.heldItem === key).length;
                  return (
                    <div key={key} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: 7, border: '1.5px solid #5a4a28', borderRadius: 4,
                      background: 'rgba(201,166,100,0.06)',
                    }}>
                      <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{it.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#f4e5a8' }}>{it.name}</div>
                        <div style={{ fontSize: 9, color: '#9888b0' }}>{it.desc}</div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 10, color: '#c9a664', flexShrink: 0 }}>
                        <div>× {count} in bag</div>
                        {equippedCount > 0 && <div style={{ color: '#9888b0' }}>× {equippedCount} equipped</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
      {tab === 'phone' && (
        <PhoneTab
          defeated={defeated}
          trainerCycles={trainerCycles}
          onCall={onCall}
        />
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
            {displayName(c)}
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
        {/* XP sliver — smooth fill animation + shimmer effect when nearly full */}
        {xpPct !== null && (
          <div style={{ height: 4, background: '#0a0614', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
            <div style={{
              width: `${xpPct}%`, height: '100%',
              background: xpPct > 80
                ? 'linear-gradient(90deg, #9a80c0 0%, #b8a0e0 50%, #9a80c0 100%)'
                : '#9a80c0',
              backgroundSize: '200% 100%',
              animation: xpPct > 80 ? 'gtmXpShimmer 1.4s linear infinite' : undefined,
              transition: 'width 0.6s ease-out',
            }} />
          </div>
        )}
        {/* Held item badge — shown when a held item is equipped */}
        {c.heldItem && ITEMS[c.heldItem] && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(201,166,100,0.15)', border: '1px solid #c9a664',
            borderRadius: 3, padding: '2px 6px', marginTop: 1,
            fontSize: textSize - 1, color: '#c9a664', fontFamily: 'sans-serif',
          }} title={ITEMS[c.heldItem].desc}>
            <span style={{ fontSize: textSize }}>{ITEMS[c.heldItem].icon}</span>
            <span>{ITEMS[c.heldItem].name}</span>
            {c.heldItemCharged && (
              <span style={{ opacity: 0.5, fontSize: textSize - 2 }}>(used)</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// SHOP SCENE
// =========================================================================
// PHONE TAB — rendered inside MenuScreen when the player owns the Runic Phone.
// Lists every trainer (town + zone) and lets the player call any defeated one
// for a scaled-up rematch (trainerCycles + 1) without walking to their zone.
// Undefeated trainers show their location and a hint to find them in person.
// =========================================================================
function PhoneTab({ defeated, trainerCycles, onCall }) {
  // Build a unified list: town trainers first (the local duellists who gave the
  // phone), then zone trainers grouped by zone order.
  const townTrainers = NPCS_TOWN
    .filter(n => TOWN_TRAINER_IDS.has(n.id))
    .map(n => ({ ...n, zoneId: 'town', isTown: true }));
  const zoneTrainers = Object.entries(NPCS_ZONE).flatMap(([zoneId, list]) =>
    list.map(n => ({ ...n, zoneId, isTown: false }))
  );
  const allTrainers = [...townTrainers, ...zoneTrainers];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Cycle info strip */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 10px',
        border: '1.5px solid #5a4a68', borderRadius: 4,
        background: 'linear-gradient(180deg, #1e1430 0%, #130e20 100%)',
      }}>
        <span style={{ fontSize: 11, color: '#9888b0' }}>
          Current cycle: <b style={{ color: '#c9a664' }}>{trainerCycles + 1}</b>
        </span>
        <span style={{ fontSize: 10, color: '#7a6898', fontStyle: 'italic' }}>
          Rematch teams: +{(trainerCycles + 1) * 2} lv
        </span>
      </div>

      {/* Section heading */}
      <div style={{ fontSize: 10, color: '#9080b0', letterSpacing: 1.4,
                    fontFamily: "'Cinzel', serif" }}>
        TRAINERS
      </div>

      {/* Trainer list */}
      <div style={{ display: 'grid', gap: 6 }}>
        {allTrainers.map(n => {
          const isDefeated = defeated.includes(n.id);
          const zoneName = n.isTown ? 'Runesmith Hollow' : (MAPS[n.zoneId]?.name || n.zoneId);
          const rematchLv = (n.team?.[0]?.lv || 8) + (trainerCycles + 1) * 2;
          return (
            <div key={n.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 9px',
              border: `1.5px solid ${isDefeated ? '#5a4a28' : '#2a2038'}`,
              borderRadius: 4,
              background: isDefeated
                ? 'linear-gradient(180deg, #1e1810 0%, #130e08 100%)'
                : '#0f0a18',
              opacity: isDefeated ? 1 : 0.6,
            }}>
              {/* Color swatch */}
              <div style={{
                width: 8, height: 32, borderRadius: 2, flexShrink: 0,
                background: n.color,
                boxShadow: isDefeated ? `0 0 6px ${n.color}88` : 'none',
              }} />
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700,
                              color: isDefeated ? '#f4e5a8' : '#7a6898' }}>
                  {n.name}
                  {n.isTown && (
                    <span style={{ fontSize: 9, color: '#7ab8d8', marginLeft: 5,
                                   fontWeight: 400, letterSpacing: 0.3 }}>· LOCAL</span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: '#7a6898' }}>
                  {zoneName} · {isDefeated ? `Rematch ~Lv ${rematchLv}` : 'Not yet defeated'}
                </div>
              </div>
              {/* Call / locked */}
              {isDefeated ? (
                <button className="mtgBtn" onClick={() => onCall(n)}
                  style={{ padding: '5px 10px', fontSize: 10, flexShrink: 0,
                           borderColor: '#c9a664', color: '#f4e5a8' }}>
                  ☎ Call
                </button>
              ) : (
                <div style={{ fontSize: 9, color: '#4a3a58', fontStyle: 'italic',
                               textAlign: 'right', flexShrink: 0, maxWidth: 60 }}>
                  Find in person
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 4, fontSize: 9, color: '#5a4a70',
                    textAlign: 'center', fontStyle: 'italic' }}>
        "Defeat a trainer once and they'll take your call." — Bran, Ria, & Dax
      </div>
    </div>
  );
}

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

// =========================================================================
// VAULT SCENE — The Hollow Vault
// Creature storage management. Two stacked sections (Team + Vault). Tapping
// a creature selects it; tapping a creature in the OPPOSITE section while one
// is already selected swaps the two. Tapping an empty team slot while a vault
// creature is selected withdraws it. The action bar at the bottom shows what
// you can do with the current selection (move/rename/release/cancel).
// =========================================================================
function VaultChip({ c, selected, dim, onClick }) {
  // Compact creature card used in both team and vault grids. Shows color,
  // name, level, and an HP bar. Selected state pulses with a gold border.
  const primary = primaryColor(c.c);
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const hpColor = pct > 50 ? '#6fb06f' : pct > 25 ? '#d8a040' : '#d84040';
  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 6,
        width: '100%', padding: '6px 8px',
        background: selected
          ? `linear-gradient(180deg, ${COLOR_HEX[primary]}33 0%, #1a1428 100%)`
          : '#1a1428',
        border: selected ? '2px solid #f4e5a8' : `1.5px solid ${COLOR_DEEP[primary]}`,
        borderRadius: 4,
        cursor: 'pointer',
        opacity: dim ? 0.55 : 1,
        boxShadow: selected ? `0 0 10px ${COLOR_HEX[primary]}88, inset 0 0 0 1px #1a0e28` : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        textAlign: 'left',
        fontFamily: "'Cinzel', serif",
        color: '#e8dcc0',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}>
      <ManaBadge identity={c.c} size={14} label={colorsOf(c.c).length === 1} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1,
          }}>{displayName(c)}</span>
          <span className="pixelFont" style={{ fontSize: 8, color: '#9888b0' }}>Lv.{c.level}</span>
        </div>
        <div style={{ height: 4, background: '#0a0614', borderRadius: 1, marginTop: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: hpColor }} />
        </div>
      </div>
      {c.championBadge && (
        <span title="Champion" style={{
          position: 'absolute', top: -5, right: -4,
          fontSize: 10, padding: '0 3px',
          background: 'linear-gradient(135deg, #f3e3a8, #c9a664)',
          color: '#1a0e28',
          border: '1px solid #1a0e28', borderRadius: 3,
        }}>★</span>
      )}
    </button>
  );
}

function EmptyTeamSlot({ selected, onClick, label = 'Empty' }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '6px 8px', minHeight: 36,
        background: 'transparent',
        border: selected ? '2px dashed #f4e5a8' : '1.5px dashed #4a3a68',
        borderRadius: 4,
        color: '#6a5a88', fontSize: 11, fontStyle: 'italic',
        fontFamily: "'Cinzel', serif",
        cursor: selected ? 'pointer' : 'default',
        textAlign: 'center',
      }}>{label}</button>
  );
}

function VaultScene({ team, vault, mode, onDeposit, onWithdraw, onSwap, onRename, onRelease, onClose }) {
  // selection: { side: 'team'|'vault', uid } | null
  const [selection, setSelection] = useState(null);
  const [confirmRelease, setConfirmRelease] = useState(null); // uid pending release
  // After any structural change (swap, deposit, withdraw, release) the previously
  // selected creature may no longer be in its expected list. Drop the selection
  // if it no longer corresponds to a real creature in the named side.
  useEffect(() => {
    if (!selection) return;
    const list = selection.side === 'team' ? team : vault;
    if (!list.find(c => c.uid === selection.uid)) setSelection(null);
  }, [team, vault, selection]);

  const selected = selection ? (selection.side === 'team' ? team : vault).find(c => c.uid === selection.uid) : null;

  // Click handler for an occupied creature chip. Branches:
  //  - no selection → select this one
  //  - tapped same uid → deselect
  //  - tapped same side, different uid → change selection
  //  - tapped opposite side with a selection → SWAP
  const onChipClick = (side, uid) => {
    if (!selection) { setSelection({ side, uid }); return; }
    if (selection.uid === uid) { setSelection(null); return; }
    if (selection.side === side) { setSelection({ side, uid }); return; }
    // Cross-side click → swap. The caller-supplied onSwap takes (teamUid, vaultUid).
    if (selection.side === 'team') onSwap(selection.uid, uid);
    else                            onSwap(uid, selection.uid);
    setSelection(null);
  };
  // Click handler for an empty team slot. Withdraws the currently-selected
  // vault creature into the open slot. No-op otherwise.
  const onEmptySlotClick = () => {
    if (!selection || selection.side !== 'vault') return;
    onWithdraw(selection.uid);
    setSelection(null);
  };

  // Pad out the team grid to 6 entries so empty slots render in a stable layout.
  const teamSlots = [...team];
  while (teamSlots.length < 6) teamSlots.push(null);

  return (
    <div style={{ width: 'min(94vw, 460px)', margin: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1, color: '#e8dcc0' }}>The Hollow Vault</div>
          <div style={{ fontSize: 11, color: '#9080b0', fontStyle: 'italic' }}>"Spirits, kept in rune-iron until you call."</div>
        </div>
        <button className="mtgBtn" onClick={onClose} style={{ padding: '4px 10px' }}>✕ Leave</button>
      </div>

      {/* Counts row */}
      <div style={{
        display: 'flex', gap: 8,
        padding: 8, border: '1.5px solid #5a7088', borderRadius: 4,
        background: 'linear-gradient(180deg, #1a2438 0%, #1a1028 100%)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#a8c0e0', flex: 1 }}>◇ Team {team.length}/6</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#a890c0', flex: 1, textAlign: 'right' }}>✦ Vault {vault.length} stored</span>
      </div>

      {/* TEAM section */}
      <div>
        <div style={{ fontSize: 11, color: '#9888b0', letterSpacing: 1.5, marginBottom: 4, fontFamily: "'Cinzel', serif" }}>YOUR PARTY</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {teamSlots.map((c, i) => {
            if (!c) {
              const slotSelected = selection?.side === 'vault';
              return <EmptyTeamSlot key={`empty-${i}`} selected={slotSelected} onClick={onEmptySlotClick} />;
            }
            const isCmdr = mode === 'commander' && i === 0;
            const isSelected = selection?.side === 'team' && selection.uid === c.uid;
            return (
              <div key={c.uid} style={{ position: 'relative' }}>
                <VaultChip c={c} selected={isSelected} onClick={() => onChipClick('team', c.uid)} />
                {isCmdr && (
                  <span title="Commander" style={{
                    position: 'absolute', top: -5, left: -3,
                    fontSize: 9, padding: '0 4px', fontWeight: 700,
                    background: '#9a80c0', color: '#1a0e28',
                    border: '1px solid #1a0e28', borderRadius: 3,
                    fontFamily: "'Cinzel', serif", letterSpacing: 0.4,
                  }}>CMDR</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* VAULT section (scrollable) */}
      <div>
        <div style={{ fontSize: 11, color: '#9888b0', letterSpacing: 1.5, marginBottom: 4, fontFamily: "'Cinzel', serif" }}>STORAGE</div>
        <div className="scroll" style={{
          maxHeight: 260, overflowY: 'auto',
          padding: 6, border: '1.5px solid #4a3a68', borderRadius: 4,
          background: '#100820',
        }}>
          {vault.length === 0 ? (
            <div style={{ padding: 14, textAlign: 'center', color: '#6a5a88', fontSize: 11, fontStyle: 'italic' }}>
              The cages are empty. Catch beyond your team's six and they'll rest here between adventures.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {vault.map(c => {
                const isSelected = selection?.side === 'vault' && selection.uid === c.uid;
                return <VaultChip key={c.uid} c={c} selected={isSelected} onClick={() => onChipClick('vault', c.uid)} />;
              })}
            </div>
          )}
        </div>
      </div>

      {/* ACTION BAR — appears when a creature is selected */}
      {selected && (
        <div style={{
          padding: 10, border: '1.5px solid #c9a664', borderRadius: 4,
          background: 'linear-gradient(180deg, #2a1c40 0%, #1a1028 100%)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <ManaBadge identity={selected.c} size={16} label={colorsOf(selected.c).length === 1} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f4e5a8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName(selected)}
              </div>
              <div className="pixelFont" style={{ fontSize: 9, color: '#9888b0' }}>
                Lv.{selected.level} · HP {selected.hp}/{selected.maxHp} · {selection.side === 'team' ? 'In Party' : 'In Vault'}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {selection.side === 'team' ? (
              <button className="mtgBtn"
                onClick={() => { onDeposit(selected.uid); setSelection(null); }}
                style={{ padding: '6px 8px', fontSize: 11 }}>
                ✦ Send to Vault
              </button>
            ) : (
              <button className="mtgBtn"
                onClick={() => {
                  if (team.length < 6) { onWithdraw(selected.uid); setSelection(null); }
                }}
                disabled={team.length >= 6}
                title={team.length >= 6 ? 'Tap a team member above to swap' : 'Bring this creature to your party'}
                style={{ padding: '6px 8px', fontSize: 11 }}>
                ◇ Bring to Team
              </button>
            )}
            <button className="mtgBtn"
              onClick={() => onRename(selected.uid)}
              style={{ padding: '6px 8px', fontSize: 11 }}>
              ✎ Rename
            </button>
            <button className="mtgBtn"
              onClick={() => setConfirmRelease(selected.uid)}
              style={{ padding: '6px 8px', fontSize: 11, color: '#e0a0a0' }}>
              ✕ Release
            </button>
            <button className="mtgBtn"
              onClick={() => setSelection(null)}
              style={{ padding: '6px 8px', fontSize: 11, opacity: 0.7 }}>
              Cancel
            </button>
          </div>
          {selection.side === 'vault' && team.length >= 6 && (
            <div style={{ marginTop: 6, fontSize: 10, color: '#9888b0', fontStyle: 'italic', textAlign: 'center' }}>
              Team is full — tap a party member above to swap them.
            </div>
          )}
        </div>
      )}

      {/* Helpful prompt when nothing is selected */}
      {!selected && (
        <div style={{
          padding: 8, fontSize: 11, color: '#9080b0', fontStyle: 'italic', textAlign: 'center',
          border: '1px dashed #3a2850', borderRadius: 4,
        }}>
          Tap a creature to act on it. Tap one in the other section to swap.
        </div>
      )}

      {/* Release confirmation overlay */}
      {confirmRelease && (() => {
        const c = (selection?.side === 'team' ? team : vault).find(x => x.uid === confirmRelease);
        if (!c) { setConfirmRelease(null); return null; }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,6,20,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }}>
            <div style={{
              width: 'min(94vw, 380px)',
              padding: 16,
              background: 'linear-gradient(180deg, #2a1428 0%, #14081a 100%)',
              border: '2px solid #6a3a4a', borderRadius: 6,
              fontFamily: "'Cinzel', serif", color: '#f0d8c8',
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Release {displayName(c)}?</div>
              <div style={{ fontSize: 12, color: '#c8a890', fontStyle: 'italic', marginBottom: 14 }}>
                They'll return to the wilds. This cannot be undone.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button className="mtgBtn"
                  onClick={() => {
                    onRelease(confirmRelease, selection?.side === 'vault');
                    setConfirmRelease(null);
                    setSelection(null);
                  }}
                  style={{ padding: 8, fontSize: 12, color: '#e0a0a0' }}>
                  Yes — Release
                </button>
                <button className="mtgBtn"
                  onClick={() => setConfirmRelease(null)}
                  style={{ padding: 8, fontSize: 12 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// =========================================================================
// VAULT SWAP PROMPT — post-catch overflow
// Shown after a successful catch when the team was already at 6 creatures.
// The newcomer was auto-deposited in the vault; this prompt offers to swap
// them in for a current team member, or leave them in the vault for later.
// =========================================================================
function VaultSwapPrompt({ newcomer, team, mode, onSwap, onKeep }) {
  const primary = primaryColor(newcomer.c);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,6,20,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 65, padding: 16 }}>
      <div style={{
        width: 'min(94vw, 420px)',
        padding: 14,
        background: 'linear-gradient(180deg, #1a2438 0%, #14081a 100%)',
        border: '2px solid #c9a664', borderRadius: 6,
        boxShadow: `0 4px 20px ${COLOR_HEX[primary]}55, 0 8px 40px rgba(0,0,0,0.7)`,
        fontFamily: "'Cinzel', serif", color: '#f4e5a8',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ManaBadge identity={newcomer.c} size={20} label={colorsOf(newcomer.c).length === 1} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Caught {displayName(newcomer)}!</div>
            <div className="pixelFont" style={{ fontSize: 9, color: '#9888b0' }}>Lv.{newcomer.level} · {newcomer.t}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#c8b890', fontStyle: 'italic', lineHeight: 1.45, marginBottom: 12 }}>
          Your team is full — they're resting in the Hollow Vault. Swap one of your party for them now, or leave them with Keeper Solenne for later.
        </div>

        {/* Team list — pick someone to send to the vault */}
        <div style={{ fontSize: 10, color: '#9080b0', letterSpacing: 1.4, marginBottom: 4 }}>SWAP WITH…</div>
        <div style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
          {team.map((c, i) => {
            const isCmdr = mode === 'commander' && i === 0;
            return (
              <button key={c.uid} className="mtgBtn"
                disabled={isCmdr}
                onClick={() => !isCmdr && onSwap(c.uid)}
                title={isCmdr ? 'The commander cannot be sent to the vault.' : `Send ${displayName(c)} to the vault and bring ${displayName(newcomer)} into the team`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', textAlign: 'left',
                  borderColor: COLOR_DEEP[primaryColor(c.c)],
                  opacity: isCmdr ? 0.5 : 1,
                }}>
                <ManaBadge identity={c.c} size={14} label={colorsOf(c.c).length === 1} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e8dcc0' }}>
                  {displayName(c)}
                </span>
                <span className="pixelFont" style={{ fontSize: 9, color: '#9888b0' }}>Lv.{c.level}</span>
                {isCmdr && (
                  <span style={{
                    fontSize: 8, padding: '0 4px', fontWeight: 700,
                    background: '#9a80c0', color: '#1a0e28',
                    border: '1px solid #1a0e28', borderRadius: 2,
                    letterSpacing: 0.3,
                  }}>CMDR</span>
                )}
              </button>
            );
          })}
        </div>

        <button className="mtgBtn" onClick={onKeep} style={{ width: '100%', padding: 8, fontSize: 12 }}>
          ✦ Leave in Vault
        </button>
      </div>
    </div>
  );
}
