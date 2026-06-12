/**
 * Content codegen: globs content/**.json, validates everything (schema shape,
 * sprite grids vs the palette, cross-references), and emits typed indexes into
 * src/game/content/gen/. Adding an enemy/item/perk to the game = dropping a
 * JSON file into content/ and re-running `bun run gen` (chained into dev/build/test).
 *
 * Fails loudly with file+field error messages; never emits partial output.
 */
import { Glob } from 'bun';
import { mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CONTENT = join(ROOT, 'content');
const OUT = join(ROOT, 'src', 'game', 'content', 'gen');

const errors: string[] = [];
function err(file: string, msg: string) {
  errors.push(`${file}: ${msg}`);
}

async function readDir(dir: string): Promise<{ file: string; data: any }[]> {
  const glob = new Glob('*.json');
  const out: { file: string; data: any }[] = [];
  const path = join(CONTENT, dir);
  for await (const name of glob.scan({ cwd: path })) {
    const file = `content/${dir}/${name}`;
    try {
      out.push({ file, data: await Bun.file(join(path, name)).json() });
    } catch (e) {
      err(file, `invalid JSON: ${(e as Error).message}`);
    }
  }
  out.sort((a, b) => a.file.localeCompare(b.file));
  return out;
}

// ---------- palette ----------
const paletteRaw = await Bun.file(join(CONTENT, 'palette.json')).json();
const palette: Record<string, string> = paletteRaw.colors ?? {};
for (const [ch, hex] of Object.entries(palette)) {
  if (ch.length !== 1) err('content/palette.json', `palette key ${JSON.stringify(ch)} must be a single character`);
  if (ch === '.') err('content/palette.json', `'.' is reserved for transparency`);
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) err('content/palette.json', `color for '${ch}' is not #rrggbb: ${hex}`);
}

// ---------- shared validators ----------
function checkSprite(file: string, sprite: any, label = 'sprite') {
  if (!sprite || typeof sprite !== 'object') return err(file, `missing ${label}`);
  const size = sprite.size;
  if (!Number.isInteger(size) || size < 4 || size > 64) return err(file, `${label}.size must be an integer 4..64`);
  if (!Array.isArray(sprite.frames) || sprite.frames.length < 1) return err(file, `${label}.frames must be a non-empty array`);
  sprite.frames.forEach((frame: any, f: number) => {
    if (!Array.isArray(frame) || frame.length !== size) {
      return err(file, `${label}.frames[${f}] must have exactly ${size} rows (has ${frame?.length})`);
    }
    frame.forEach((row: any, r: number) => {
      if (typeof row !== 'string' || row.length !== size) {
        return err(file, `${label}.frames[${f}] row ${r} must be ${size} chars (is ${row?.length}): ${JSON.stringify(row)}`);
      }
      for (const ch of row) {
        if (ch !== '.' && !(ch in palette)) {
          err(file, `${label}.frames[${f}] row ${r} has unknown palette char ${JSON.stringify(ch)}`);
          break;
        }
      }
    });
  });
}

function need(file: string, obj: any, field: string, type: string): boolean {
  const v = obj?.[field];
  const ok =
    type === 'array' ? Array.isArray(v)
    : type === 'number' ? typeof v === 'number' && Number.isFinite(v)
    : typeof v === type;
  if (!ok) err(file, `missing/invalid field '${field}' (expected ${type})`);
  return ok;
}

function checkId(file: string, data: any) {
  if (!need(file, data, 'id', 'string')) return;
  if (!/^[a-z0-9_]+$/.test(data.id)) err(file, `id '${data.id}' must be snake_case [a-z0-9_]`);
  const expected = basename(file, '.json');
  if (data.id !== expected) err(file, `id '${data.id}' must match filename '${expected}'`);
}

// ---------- items ----------
const itemFiles = await readDir('items');
const itemIds = new Set<string>();
const SLOTS = ['weapon', 'offhand', 'armor', 'trinket', 'potion', 'junk'];
for (const { file, data } of itemFiles) {
  checkId(file, data);
  need(file, data, 'name', 'string');
  need(file, data, 'value', 'number');
  if (!SLOTS.includes(data.slot)) err(file, `slot must be one of ${SLOTS.join('|')} (is '${data.slot}')`);
  if (!Number.isInteger(data.tier) || data.tier < 1) err(file, `tier must be a positive integer`);
  if (typeof data.weight !== 'number' || data.weight < 0) err(file, `weight (kg, >= 0) is required`);
  if (data.slot === 'potion' && !data.potion) err(file, `potion items need a 'potion' field {kind, amount}`);
  if (data.potion && !['hp', 'mp'].includes(data.potion.kind)) err(file, `potion.kind must be hp|mp`);
  checkSprite(file, data.sprite);
  itemIds.add(data.id);
}

// ---------- monsters & neutrals ----------
const TIERS = ['minion', 'normal', 'elite', 'boss'];
function checkCreature(file: string, data: any, neutral: boolean) {
  checkId(file, data);
  need(file, data, 'name', 'string');
  if (!TIERS.includes(data.tier)) err(file, `tier must be ${TIERS.join('|')}`);
  const wantDisposition = neutral ? 'neutral' : 'hostile';
  if (data.disposition !== wantDisposition) err(file, `disposition must be '${wantDisposition}'`);
  if (neutral && !['wander', 'flee'].includes(data.behavior)) err(file, `neutral needs behavior wander|flee`);
  const base = data.base ?? {};
  for (const f of ['hp', 'dmg', 'armor', 'attackTicks', 'moveTicks', 'range', 'aggroRadius']) {
    if (typeof base[f] !== 'number') err(file, `base.${f} must be a number`);
  }
  if (data.summonOnly === true) {
    if (Array.isArray(data.spawn) && data.spawn.length > 0) {
      err(file, `summonOnly creatures must not have spawn bands`);
    }
  } else if (!Array.isArray(data.spawn) || data.spawn.length === 0) {
    err(file, `spawn must be a non-empty array of {depths:[lo,hi], weight}`);
  } else {
    data.spawn.forEach((b: any, i: number) => {
      if (!Array.isArray(b.depths) || b.depths.length !== 2 || b.depths[0] > b.depths[1] || b.depths[0] < 1) {
        err(file, `spawn[${i}].depths must be [lo,hi] with 1 <= lo <= hi`);
      }
      if (typeof b.weight !== 'number' || b.weight <= 0) err(file, `spawn[${i}].weight must be > 0`);
    });
  }
  if (typeof data.level?.offset !== 'number' || typeof data.level?.spread !== 'number' || data.level.spread < 0) {
    err(file, `level must be {offset:number, spread:number>=0}`);
  }
  need(file, data, 'xpBase', 'number');
  if (!Array.isArray(data.gold) || data.gold.length !== 2 || data.gold[0] > data.gold[1]) {
    err(file, `gold must be [min,max]`);
  }
  if (!Array.isArray(data.skills)) err(file, `skills must be an array`);
  if (!Array.isArray(data.drops)) {
    err(file, `drops must be an array`);
  } else {
    data.drops.forEach((d: any, i: number) => {
      if (typeof d.item !== 'string' || !itemIds.has(d.item)) {
        err(file, `drops[${i}].item '${d.item}' does not exist in content/items/`);
      }
      if (typeof d.chance !== 'number' || d.chance <= 0 || d.chance > 1) {
        err(file, `drops[${i}].chance must be in (0,1]`);
      }
      if (d.qty && (!Array.isArray(d.qty) || d.qty.length !== 2 || d.qty[0] > d.qty[1] || d.qty[0] < 1)) {
        err(file, `drops[${i}].qty must be [min,max] with min >= 1`);
      }
    });
  }
  checkSprite(file, data.sprite);
}

const monsterFiles = await readDir('monsters');
for (const { file, data } of monsterFiles) checkCreature(file, data, false);
const neutralFiles = await readDir('neutrals');
for (const { file, data } of neutralFiles) checkCreature(file, data, true);

// ---------- perks ----------
const perkFiles = await readDir('perks');
const PERK_KINDS = ['modifier', 'flavor', 'startingItem'];
const POLARITIES = ['positive', 'negative', 'neutral'];
for (const { file, data } of perkFiles) {
  checkId(file, data);
  need(file, data, 'name', 'string');
  need(file, data, 'flavor', 'string');
  if (!PERK_KINDS.includes(data.kind)) err(file, `kind must be ${PERK_KINDS.join('|')}`);
  if (!POLARITIES.includes(data.polarity)) err(file, `polarity must be ${POLARITIES.join('|')}`);
  if (typeof data.weight !== 'number' || data.weight <= 0) err(file, `weight must be > 0`);
  if (!Array.isArray(data.mods)) err(file, `mods must be an array (may be empty)`);
  if (data.kind === 'modifier' && data.mods.length === 0) err(file, `modifier perks need at least one mod`);
  if (data.kind === 'startingItem' && (typeof data.item !== 'string' || !itemIds.has(data.item))) {
    err(file, `startingItem perks need item referencing an existing item (got '${data.item}')`);
  }
  for (const [i, m] of (data.mods ?? []).entries()) {
    if (m.kind === 'attr') {
      if (!['str', 'dex', 'int', 'vit'].includes(m.attr) || typeof m.add !== 'number') {
        err(file, `mods[${i}] attr mod must be {kind:'attr', attr:str|dex|int|vit, add:number}`);
      }
    } else if (m.kind === 'mult') {
      if (!['dmg', 'xp', 'gold', 'maxhp', 'speed'].includes(m.what) || typeof m.mul !== 'number' || m.mul <= 0) {
        err(file, `mods[${i}] mult mod must be {kind:'mult', what:dmg|xp|gold|maxhp|speed, mul:number>0}`);
      }
    } else {
      err(file, `mods[${i}].kind must be attr|mult`);
    }
  }
}

// ---------- tiles ----------
const tileFiles = await readDir('tiles');
for (const { file, data } of tileFiles) {
  checkId(file, data);
  checkSprite(file, data.sprite);
}

// ---------- village scenery (buildings, props) ----------
const villageFiles = await readDir('village');
for (const { file, data } of villageFiles) {
  checkId(file, data);
  checkSprite(file, data.sprite);
}

// ---------- names ----------
const nameFiles = await readDir('names');
const banks = { firstSyllables: [] as string[], lastSyllables: [] as string[], funnyNames: [] as string[], epithets: [] as string[], epithetChance: 0.3, funnyChance: 0.15 };
for (const { file, data } of nameFiles) {
  for (const key of ['firstSyllables', 'lastSyllables', 'funnyNames', 'epithets'] as const) {
    if (data[key]) {
      if (!Array.isArray(data[key]) || data[key].some((s: any) => typeof s !== 'string')) {
        err(file, `${key} must be an array of strings`);
      } else {
        banks[key].push(...data[key]);
      }
    }
  }
  if (typeof data.epithetChance === 'number') banks.epithetChance = data.epithetChance;
  if (typeof data.funnyChance === 'number') banks.funnyChance = data.funnyChance;
}
if (banks.firstSyllables.length === 0 || banks.lastSyllables.length === 0) {
  err('content/names/', 'need at least one file providing firstSyllables and lastSyllables');
}

// ---------- banter (traits, voices, exchanges, quirk shouts, memories) ----------
const CLASS_IDS = [
  'knight', 'cleric', 'ranger', 'mage', 'necromancer', 'barbarian', 'monk',
  'paladin', 'druid', 'bard', 'chef', 'beekeeper', 'thief', 'mime',
];
const ROLE_IDS = ['tank', 'healer', 'ranged_dps', 'caster', 'melee_dps', 'support'];
const FAMILY_IDS = ['beast', 'slime', 'goblinoid', 'undead', 'cultist', 'fungus', 'landlord', 'generic'];
const BANTER_CONTEXTS = ['kill', 'hurt', 'lowHp', 'allyDown', 'rescue', 'loot', 'boss', 'descend', 'idle', 'friendlyFire', 'react'];
const PLACEHOLDERS = new Set(['enemy', 'ally', 'hero', 'depth', 'gold', 'kills', 'downs', 'rescuer', 'worst']);

async function readBanterFile(name: string): Promise<any> {
  const path = join(ROOT, 'content', 'banter', name);
  if (!(await Bun.file(path).exists())) {
    err(`content/banter/${name}`, 'missing');
    return null;
  }
  try {
    return JSON.parse(await Bun.file(path).text());
  } catch (e) {
    err(`content/banter/${name}`, `invalid JSON: ${(e as Error).message}`);
    return null;
  }
}

function checkLines(file: string, where: string, lines: unknown) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.some((l) => typeof l !== 'string')) {
    err(file, `${where}: must be a non-empty array of strings`);
    return;
  }
  for (const line of lines as string[]) {
    for (const m of line.matchAll(/\{(\w+)\}/g)) {
      if (!PLACEHOLDERS.has(m[1]!)) err(file, `${where}: unknown placeholder {${m[1]}} in "${line}"`);
    }
    if (line.length > 130) err(file, `${where}: line too long for a speech bubble (${line.length} chars): "${line.slice(0, 40)}…"`);
  }
}

const banterTraits = await readBanterFile('traits.json');
if (banterTraits) {
  const f = 'content/banter/traits.json';
  if (!Array.isArray(banterTraits.traits)) err(f, 'traits must be an array');
  for (const trait of banterTraits.traits ?? []) {
    if (!trait.id || !trait.name || typeof trait.weight !== 'number') err(f, `trait ${trait.id ?? '?'}: needs id, name, weight`);
    checkLines(f, `${trait.id}.interjections`, trait.interjections);
    checkLines(f, `${trait.id}.tags`, trait.tags);
    for (const ctx of BANTER_CONTEXTS) checkLines(f, `${trait.id}.lines.${ctx}`, trait.lines?.[ctx]);
  }
}

const banterVoices = await readBanterFile('voices.json');
if (banterVoices) {
  const f = 'content/banter/voices.json';
  const seen = new Set<string>();
  for (const voice of banterVoices.classes ?? []) {
    seen.add(voice.id);
    if (!CLASS_IDS.includes(voice.id)) err(f, `unknown class id ${voice.id}`);
    for (const fam of FAMILY_IDS) checkLines(f, `${voice.id}.taunts.${fam}`, voice.taunts?.[fam]);
    checkLines(f, `${voice.id}.kill`, voice.kill);
    checkLines(f, `${voice.id}.idle`, voice.idle);
    checkLines(f, `${voice.id}.react`, voice.react);
  }
  for (const cid of CLASS_IDS) if (!seen.has(cid)) err(f, `class ${cid} has no voice`);
}

const banterPairs = await readBanterFile('pairs.json');
if (banterPairs) {
  const f = 'content/banter/pairs.json';
  for (const pair of banterPairs.rolePairs ?? []) {
    if (!ROLE_IDS.includes(pair.a) || !ROLE_IDS.includes(pair.b)) err(f, `rolePair ${pair.a}|${pair.b}: unknown role`);
    for (const ex of pair.exchanges ?? []) checkLines(f, `rolePair ${pair.a}|${pair.b}`, ex);
  }
  for (const pair of banterPairs.classPairs ?? []) {
    if (!CLASS_IDS.includes(pair.a) || !CLASS_IDS.includes(pair.b)) err(f, `classPair ${pair.a}|${pair.b}: unknown class`);
    for (const ex of pair.exchanges ?? []) checkLines(f, `classPair ${pair.a}|${pair.b}`, ex);
  }
}

const banterPerks = await readBanterFile('perk_shouts.json');
if (banterPerks) {
  const f = 'content/banter/perk_shouts.json';
  const perkIds = new Set(perkFiles.map((x) => x.data.id));
  for (const perk of banterPerks.perks ?? []) {
    if (!perkIds.has(perk.id)) err(f, `unknown perk id ${perk.id}`);
    for (const ctx of ['idle', 'descend', 'chest', 'combat']) checkLines(f, `${perk.id}.${ctx}`, perk.lines?.[ctx]);
  }
}

const banterMemory = await readBanterFile('memory.json');
if (banterMemory) {
  const f = 'content/banter/memory.json';
  for (const cond of banterMemory.conditions ?? []) {
    if (!cond.id || !cond.when) err(f, `condition ${cond.id ?? '?'}: needs id and when`);
    checkLines(f, `${cond.id}.lines`, cond.lines);
  }
}

const banterFamilies = await readBanterFile('families.json');
if (banterFamilies) {
  const f = 'content/banter/families.json';
  for (const { data } of monsterFiles) {
    if (!banterFamilies[data.id]) err(f, `monster ${data.id} has no enemy family`);
  }
  for (const [mid, fam] of Object.entries(banterFamilies)) {
    if (!FAMILY_IDS.includes(fam as string)) err(f, `${mid}: unknown family ${fam}`);
  }
}

// ---------- bail on errors ----------
if (errors.length > 0) {
  console.error(`\ncontent validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}):\n`);
  for (const e of errors) console.error('  ✗ ' + e);
  console.error('');
  process.exit(1);
}

// ---------- emit ----------
await mkdir(OUT, { recursive: true });

function emitRecord(typeName: string, constName: string, entries: { file: string; data: any }[]): string {
  const map: Record<string, any> = {};
  for (const { data } of entries) map[data.id] = data;
  const keys = Object.keys(map).sort();
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])}`).join(',\n');
  return [
    `// AUTO-GENERATED by tools/gen-content.ts — DO NOT EDIT. Source: content/`,
    `import type { ${typeName} } from '../../types';`,
    ``,
    `export const ${constName}: Record<string, ${typeName}> = {`,
    body,
    `};`,
    ``,
  ].join('\n');
}

const files: Record<string, string> = {
  'palette.gen.ts': [
    `// AUTO-GENERATED by tools/gen-content.ts — DO NOT EDIT. Source: content/palette.json`,
    `export const PALETTE: Record<string, string> = ${JSON.stringify(palette, null, 2)};`,
    ``,
  ].join('\n'),
  'items.gen.ts': emitRecord('ItemDef', 'ITEMS', itemFiles),
  'monsters.gen.ts': emitRecord('MonsterDef', 'MONSTERS', monsterFiles),
  'neutrals.gen.ts': emitRecord('MonsterDef', 'NEUTRALS', neutralFiles),
  'perks.gen.ts': emitRecord('PerkDef', 'PERKS', perkFiles),
  'tiles.gen.ts': emitRecord('TileDef', 'TILES', tileFiles),
  'village.gen.ts': emitRecord('TileDef', 'VILLAGE_SPRITES', villageFiles),
  'banter.gen.ts': [
    `// AUTO-GENERATED by tools/gen-content.ts — DO NOT EDIT. Source: content/banter/`,
    `import type { BanterContent } from '../../types';`,
    ``,
    `export const BANTER: BanterContent = ${JSON.stringify(
      {
        traits: banterTraits?.traits ?? [],
        voices: Object.fromEntries(((banterVoices?.classes ?? []) as any[]).map((v) => [v.id, v])),
        rolePairs: banterPairs?.rolePairs ?? [],
        classPairs: banterPairs?.classPairs ?? [],
        perkShouts: Object.fromEntries(((banterPerks?.perks ?? []) as any[]).map((p) => [p.id, p])),
        memory: banterMemory?.conditions ?? [],
        families: banterFamilies ?? {},
      },
      null,
      1,
    )};`,
    ``,
  ].join('\n'),
  'names.gen.ts': [
    `// AUTO-GENERATED by tools/gen-content.ts — DO NOT EDIT. Source: content/names/`,
    `import type { NameBanks } from '../../types';`,
    ``,
    `export const NAME_BANKS: NameBanks = ${JSON.stringify(banks, null, 2)};`,
    ``,
  ].join('\n'),
};

let wrote = 0;
for (const [name, text] of Object.entries(files)) {
  const path = join(OUT, name);
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : null;
  if (existing !== text) {
    await Bun.write(path, text);
    wrote++;
  }
}

const counts = `${monsterFiles.length} monsters, ${neutralFiles.length} neutrals, ${itemFiles.length} items, ${perkFiles.length} perks, ${tileFiles.length} tiles, ${villageFiles.length} village sprites, ${(banterTraits?.traits ?? []).length} banter traits`;
console.log(`content ok (${counts})${wrote ? ` — regenerated ${wrote} file(s)` : ' — up to date'}`);
