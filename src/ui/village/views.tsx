/**
 * One focused screen per village building. Each view gets the full width —
 * no more everything-crammed-into-one-screen.
 */
import { useEffect, useState } from 'react';
import { app } from '../../app/loop';
import { epitaphFor, loadGraveyard } from '../../app/graveyard';
import {
  BOMB_DAMAGE,
  BOMB_PRICE,
  BOMB_RADIUS,
  POTION_PRICES,
  healInjuryCost,
  heroMaxHp,
  heroMaxMp,
  instantHealCost,
  learnSkillCost,
  spellAmount,
} from '../../game/balance';
import { BANTER, CHORES, CLASSES, COVE_GAMES, INJURIES, ITEMS, PERKS, RACES, RELIGIONS, SKILLS } from '../../game/content';
import { favorTier } from '../../game/balance';
import { derive } from '../../game/hero/derive';
import { canEquip } from '../../game/hero/equipment';
import { effectiveHireCost, shopStock, spendableGold, tavernRecruits } from '../../game/village/shop';
import type { EquipSlot, GameState, Hero, Id, ItemInstance, SkillDef, StatMod } from '../../game/types';
import { BehaviorSelectModal, ClassName, ClassSprite, GodPortrait, Hint, HeroVitals, ItemName, RaceName, describeItem } from '../components';
import { TacticsEditor } from '../TacticsEditor';
import { PARTY_BEHAVIORS } from '../../game/tactics/behaviors';
import type { PartyBehavior } from '../../game/types';
import { setVillageView, useUi } from '../store';

// ---------------------------------------------------------------- item browsing
type SortKey = 'new' | 'name' | 'value' | 'weight' | 'power';

function sortItems(items: ItemInstance[], sort: SortKey): ItemInstance[] {
  const arr = [...items];
  const def = (i: ItemInstance) => ITEMS[i.defId]!;
  switch (sort) {
    case 'new':
      return arr.reverse();
    case 'name':
      return arr.sort((a, b) => def(a).name.localeCompare(def(b).name));
    case 'value':
      return arr.sort((a, b) => def(b).value - def(a).value);
    case 'weight':
      return arr.sort((a, b) => def(b).weight - def(a).weight);
    case 'power':
      return arr.sort(
        (a, b) =>
          (def(b).base?.dmg ?? def(b).base?.armor ?? 0) - (def(a).base?.dmg ?? def(a).base?.armor ?? 0),
      );
  }
}

function SortSelect({ sort, setSort }: { sort: SortKey; setSort: (s: SortKey) => void }) {
  return (
    <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="sort">
      <option value="new">newest first</option>
      <option value="power">strongest first</option>
      <option value="value">priciest first</option>
      <option value="weight">heaviest first</option>
      <option value="name">by name</option>
    </select>
  );
}

function Pager({ page, setPage, total, pageSize }: { page: number; setPage: (p: number) => void; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages - 1);
  if (pages <= 1) return null;
  return (
    <div className="row pager">
      <button className="btn btn-tiny" disabled={current === 0} onClick={() => setPage(current - 1)}>
        ◀ prev
      </button>
      <span className="muted small">
        page {current + 1} / {pages}
      </span>
      <button className="btn btn-tiny" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
        next ▶
      </button>
    </div>
  );
}

function Chips<T extends string>({ options, value, onPick }: { options: { id: T; label: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="chip-row">
      {options.map((o) => (
        <button key={o.id} className={`btn btn-tiny ${value === o.id ? 'active' : ''}`} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** storage items this hero could actually put on right now */
function equipCandidates(game: GameState, hero: Hero, slot: EquipSlot): ItemInstance[] {
  const d = derive(hero);
  const replaced = hero.equipment[slot];
  const freed = replaced ? ITEMS[replaced.defId]?.weight ?? 0 : 0;
  // the hero's own satchel (already on them → weight-neutral) plus fitting village storage
  const fromSatchel = hero.satchel.filter((it) => {
    const def = ITEMS[it.defId];
    return !!def && def.slot === slot && canEquip(hero.classId, def);
  });
  const fromVillage = game.village.inventory.filter((it) => {
    const def = ITEMS[it.defId];
    if (!def || def.slot !== slot) return false;
    if (!canEquip(hero.classId, def)) return false;
    return d.carryUsed - freed + def.weight <= d.carryMax;
  });
  return [...fromSatchel, ...fromVillage];
}

function BuildingShell({
  icon,
  title,
  blurb,
  children,
}: {
  icon: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div className="building-view">
      <div className="building-header">
        <button className="btn" onClick={() => setVillageView('scene')}>
          ⟵ Village
        </button>
        <div>
          <div className="building-title">
            {icon} {title}
          </div>
          <div className="muted small">{blurb}</div>
        </div>
      </div>
      <div className="building-body">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- armorer
const ARMORY_PAGE = 8;
type ArmoryFilter = 'all' | 'weapon' | 'offhand' | 'armor' | 'trinket';

function EquipSelect({ game, item }: { game: GameState; item: ItemInstance }) {
  const def = ITEMS[item.defId]!;
  const heroes = game.rosterOrder.map((id) => game.roster[id]!).filter((h) => h && h.activity !== 'party');
  return (
    <select
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) {
          app.dispatch({ t: 'EQUIP', heroId: e.target.value, itemId: item.id });
          e.target.value = '';
        }
      }}
    >
      <option value="">equip…</option>
      {heroes.map((h) => {
        const d = derive(h);
        const slot = def.slot as EquipSlot;
        const wrongClass = !canEquip(h.classId, def);
        const replaced = h.equipment[slot];
        const freed = replaced ? ITEMS[replaced.defId]?.weight ?? 0 : 0;
        const tooHeavy = d.carryUsed - freed + def.weight > d.carryMax;
        return (
          <option key={h.id} value={h.id} disabled={wrongClass || tooHeavy}>
            {h.name}
            {wrongClass ? ` (not for ${CLASSES[h.classId]?.name.toLowerCase()}s)` : tooHeavy ? ' (too heavy)' : ''}
          </option>
        );
      })}
    </select>
  );
}

/** a hero's traits (racial + personality) with their plain-language descriptions */
function traitInfos(traitIds: string[], raceId?: string): { name: string; desc: string }[] {
  const racial = raceId
    ? (RACES[raceId]?.racialTraits ?? []).map((t) => ({ name: t.name, desc: t.effect }))
    : [];
  const personality = traitIds.map((id) => {
    const t = BANTER.traits.find((x) => x.id === id);
    return { name: t?.name ?? id, desc: t?.blurb ?? '' };
  });
  return [...racial, ...personality];
}

/** the personality line: each trait is hoverable for a styled explanation */
function TraitChips({ traitIds, raceId }: { traitIds: string[]; raceId?: string }) {
  const infos = traitInfos(traitIds, raceId);
  return (
    <div className="small personality">
      ☘{' '}
      {infos.map((t, i) => (
        <span key={`${t.name}-${i}`}>
          {i > 0 ? ' · ' : ''}
          <Hint label={t.name} text={t.desc} />
        </span>
      ))}
    </div>
  );
}

/** race attribute deltas, for previewing a recruit before they're a real Hero */
function raceAttrDelta(raceId: string): { str: number; dex: number; int: number; vit: number } {
  const d = { str: 0, dex: 0, int: 0, vit: 0 };
  for (const m of RACES[raceId]?.mods ?? []) if (m.kind === 'attr') d[m.attr] += m.add;
  return d;
}

/** slot labels for gear, shared by filters and per-item badges */
const SLOT_TAGS: Record<string, string> = {
  weapon: '⚔ weapon',
  offhand: '🛡 offhand',
  armor: '🧥 armor',
  trinket: '💍 trinket',
};

export function ArmorerView({ game }: { game: GameState }) {
  const stock = shopStock(game);
  const [filter, setFilter] = useState<ArmoryFilter>('all');
  const [sort, setSort] = useState<SortKey>('new');
  const [page, setPage] = useState(0);

  const armory = game.village.inventory.filter((i) => {
    const slot = ITEMS[i.defId]?.slot ?? '';
    if (!['weapon', 'offhand', 'armor', 'trinket'].includes(slot)) return false;
    return filter === 'all' || slot === filter;
  });
  const sorted = sortItems(armory, sort);
  const pageItems = sorted.slice(page * ARMORY_PAGE, (page + 1) * ARMORY_PAGE);

  return (
    <BuildingShell icon="⚒" title="Armorer" blurb="Weapons and armor. The hammering never stops. Stock rotates daily.">
      <div className="shop-grid">
        <div className="panel">
          <div className="panel-title">🛒 For sale today</div>
          <div className="panel-sub">Fresh stock every morning — one of each, first come only served.</div>
          {stock.map((entry) => {
            const def = ITEMS[entry.defId]!;
            const bought = game.village.purchasedToday.includes(entry.key);
            return (
              <div key={entry.key} className="sale-row">
                <div className="row">
                  <span>
                    <b>{def.name}</b> <span className="tag">{SLOT_TAGS[def.slot] ?? def.slot}</span>
                  </span>
                  <button
                    className="btn btn-small"
                    disabled={bought || spendableGold(game) < entry.price}
                    onClick={() => app.dispatch({ t: 'BUY_STOCK_ITEM', stockKey: entry.key })}
                  >
                    {bought ? 'sold' : `buy ${entry.price}g`}
                  </button>
                </div>
                <div className="muted small">{describeItem(entry.defId)}</div>
                {def.flavor && <div className="small flavor">“{def.flavor}”</div>}
              </div>
            );
          })}
        </div>
        <div className="panel">
          <div className="panel-title">🎒 Your armory ({armory.length})</div>
          <div className="panel-sub">Gear you own — hand it to a hero, or sell it back for scrap value.</div>
          <div className="row">
            <Chips
              options={[
                { id: 'all', label: 'all' },
                { id: 'weapon', label: '⚔ weapons' },
                { id: 'offhand', label: '🛡 offhand' },
                { id: 'armor', label: '🧥 armor' },
                { id: 'trinket', label: '💍 trinkets' },
              ]}
              value={filter}
              onPick={(f) => {
                setFilter(f);
                setPage(0);
              }}
            />
            <SortSelect sort={sort} setSort={setSort} />
          </div>
          {armory.length === 0 && <div className="muted small">Empty racks. The dungeon provides.</div>}
          {pageItems.map((item) => {
            const slot = ITEMS[item.defId]?.slot ?? '';
            return (
              <div key={item.id} className="sale-row">
                <div className="row">
                  <span>
                    <ItemName item={item} /> <span className="tag">{SLOT_TAGS[slot] ?? slot}</span>
                  </span>
                  <span className="row-buttons">
                    <EquipSelect game={game} item={item} />
                    <button className="btn btn-tiny" onClick={() => app.dispatch({ t: 'SELL_ITEM', itemId: item.id })}>
                      sell
                    </button>
                  </span>
                </div>
                <div className="muted small">{describeItem(item.defId)}</div>
              </div>
            );
          })}
          <Pager page={page} setPage={setPage} total={armory.length} pageSize={ARMORY_PAGE} />
        </div>
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- store
const STORE_PAGE = 10;
type StoreTab = 'all' | 'healing' | 'collectables' | 'gear' | 'magic';

function storeTabOf(item: ItemInstance): Exclude<StoreTab, 'all'> {
  const def = ITEMS[item.defId];
  if (!def) return 'collectables';
  if (def.slot === 'potion') return 'healing';
  if (def.slot === 'junk') return 'collectables';
  if (item.rarity !== 'common' || (def.base?.stats && Object.keys(def.base.stats).length > 0)) return 'magic';
  return 'gear';
}

export function StoreView({ game }: { game: GameState }) {
  const [tab, setTab] = useState<StoreTab>('all');
  const [page, setPage] = useState(0);
  const sellables = game.village.inventory.filter((i) => tab === 'all' || storeTabOf(i) === tab);
  const pageItems = sellables.slice(page * STORE_PAGE, (page + 1) * STORE_PAGE);
  const junk = game.village.inventory.filter((i) => ITEMS[i.defId]?.slot === 'junk');
  const junkGold = junk.reduce((sum, i) => sum + Math.max(1, Math.round((ITEMS[i.defId]?.value ?? 0) * 0.4)), 0);

  const TAB_TAGS: Record<Exclude<StoreTab, 'all'>, string> = {
    healing: '🧪 healing',
    magic: '✨ magic',
    gear: '⚔ gear',
    collectables: '🗝 collectable',
  };

  return (
    <BuildingShell icon="🧺" title="General Store" blurb="Potions, sundries, and a shopkeeper who buys absolutely anything.">
      <div className="shop-grid">
        <div className="panel">
          <div className="panel-title">🧪 Buy supplies</div>
          <div className="panel-sub">
            The village stockpile — heroes top up to 3 healing / 2 mana from here when they descend. Bombs are
            packed by hand at the Dungeon Gate.
          </div>
          {(['hp', 'mp'] as const).map((kind) => (
            <div key={kind} className="sale-row">
              <div className="row">
                <span>
                  <b>{kind === 'hp' ? 'Healing potion' : 'Mana potion'}</b>{' '}
                  <span className="muted small">in stock: {game.village.potions[kind]}</span>
                </span>
                <span className="row-buttons">
                  {[1, 5].map((qty) => (
                    <button
                      key={qty}
                      className="btn btn-small"
                      disabled={spendableGold(game) < POTION_PRICES[kind] * qty}
                      onClick={() => app.dispatch({ t: 'BUY_POTION', potion: kind, qty })}
                    >
                      buy ×{qty} ({POTION_PRICES[kind] * qty}g)
                    </button>
                  ))}
                </span>
              </div>
              <div className="muted small">
                {kind === 'hp'
                  ? `Restores ${ITEMS['hp_potion_s']?.potion?.amount ?? 25} HP. The difference between a story and an obituary.`
                  : `Restores ${ITEMS['mp_potion_s']?.potion?.amount ?? 20} MP. Tastes like static.`}
              </div>
            </div>
          ))}
          <div className="sale-row">
            <div className="row">
              <span>
                <b>💣 Bomb</b> <span className="muted small">in stock: {game.village.bombs}</span>
              </span>
              <span className="row-buttons">
                {[1, 5].map((qty) => (
                  <button
                    key={qty}
                    className="btn btn-small"
                    disabled={spendableGold(game) < BOMB_PRICE * qty}
                    onClick={() => app.dispatch({ t: 'BUY_BOMB', qty })}
                  >
                    buy ×{qty} ({BOMB_PRICE * qty}g)
                  </button>
                ))}
              </span>
            </div>
            <div className="muted small">
              {BOMB_DAMAGE} blast damage in a {BOMB_RADIUS}-tile radius. The blast does not check name tags —
              friend, foe and chicken alike.
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">💰 Sell goods ({sellables.length})</div>
          <div className="panel-sub">Everything the party hauled home — the shopkeeper pays 40% of value, no questions.</div>
          <div className="row">
            <Chips
              options={[
                { id: 'all', label: 'all' },
                { id: 'healing', label: '🧪 healing' },
                { id: 'magic', label: '✨ magic' },
                { id: 'gear', label: '⚔ gear' },
                { id: 'collectables', label: '🗝 collectables' },
              ]}
              value={tab}
              onPick={(t) => {
                setTab(t);
                setPage(0);
              }}
            />
            <button
              className="btn btn-small"
              disabled={junk.length === 0}
              title="sells every rat tail, goo and bone in storage at once"
              onClick={() => app.dispatch({ t: 'SELL_ALL_JUNK' })}
            >
              Sell all oddities ({junk.length} → {junkGold}g)
            </button>
          </div>
          {sellables.length === 0 && <div className="muted small">Nothing here. Yet. The rats are out there.</div>}
          {pageItems.map((item) => (
            <div key={item.id} className="sale-row">
              <div className="row">
                <span>
                  <ItemName item={item} /> <span className="tag">{TAB_TAGS[storeTabOf(item)]}</span>
                </span>
                <button className="btn btn-tiny" onClick={() => app.dispatch({ t: 'SELL_ITEM', itemId: item.id })}>
                  sell {Math.max(1, Math.round((ITEMS[item.defId]?.value ?? 0) * 0.4))}g
                </button>
              </div>
              <div className="muted small">{describeItem(item.defId)}</div>
            </div>
          ))}
          <Pager page={page} setPage={setPage} total={sellables.length} pageSize={STORE_PAGE} />
        </div>
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- magician's guild
function spellEstimate(skill: SkillDef, int: number): string | null {
  if (skill.power <= 0 || skill.physical) return null;
  const amount = Math.round(spellAmount(skill.power, int));
  if (skill.kind === 'heal') return `≈ ${amount} healing`;
  if (skill.kind === 'attack') return `≈ ${amount} damage${skill.target === 'enemiesInRadius' ? ' to each enemy' : ''}`;
  return null;
}

/** spell categories: one source of truth for filter chips and card badges */
const SPELL_KINDS: { id: SkillDef['kind']; label: string }[] = [
  { id: 'attack', label: '🔥 attack' },
  { id: 'heal', label: '💚 heal' },
  { id: 'buff', label: '✨ buff' },
  { id: 'debuff', label: '🌀 debuff' },
  { id: 'summon', label: '💀 summon' },
];

function SpellCard({ game, hero, skill }: { game: GameState; hero: Hero; skill: SkillDef }) {
  const d = derive(hero);
  const known = hero.skills.includes(skill.id);
  const req = skill.guild!;
  const levelOk = hero.level >= req.minLevel;
  const intOk = d.attrs.int >= req.minInt;
  const goldOk = spendableGold(game) >= req.cost;
  const estimate = spellEstimate(skill, d.attrs.int);
  const kind = SPELL_KINDS.find((k) => k.id === skill.kind);
  return (
    <div className={`panel spell-card ${known ? 'spell-known' : ''}`}>
      <div className="row">
        <b>{skill.name}</b>
        <span className="mana-cost">{skill.mpCost} mana</span>
      </div>
      <div className="small">
        <span className={`spell-kind spell-kind-${skill.kind}`}>{kind?.label ?? skill.kind}</span>{' '}
        <span className="muted">
          {skill.target === 'enemiesInRadius' || skill.target === 'alliesInRadius'
            ? `area ${skill.radius} tiles`
            : skill.range > 0
              ? `range ${skill.range}`
              : 'self'}
          {' · '}cooldown {(skill.cooldown / 10).toFixed(0)}s · cast {(skill.castTicks / 10).toFixed(1)}s
        </span>
      </div>
      <div className="small spell-desc">{skill.description}</div>
      {estimate && (
        <div className="small">
          <span className="gold">{estimate}</span> <span className="muted">for {hero.name} (INT {Math.floor(d.attrs.int)})</span>
        </div>
      )}
      <div className="spell-card-foot">
        <div className="small spell-reqs">
          <span className={levelOk ? 'req-met' : 'req-unmet'}>level {req.minLevel}+</span>
          {' · '}
          <span className={intOk ? 'req-met' : 'req-unmet'}>INT {req.minInt}+</span>
        </div>
        {known ? (
          <span className="tag tag-idle">known</span>
        ) : (
          <button
            className="btn btn-small"
            disabled={!levelOk || !intOk || !goldOk || hero.activity === 'party'}
            title={
              !levelOk
                ? `requires level ${req.minLevel}`
                : !intOk
                  ? `requires ${req.minInt} INT (smarter headgear helps)`
                  : !goldOk
                    ? 'not enough gold'
                    : hero.activity === 'party'
                      ? 'currently in the dungeon'
                      : ''
            }
            onClick={() => app.dispatch({ t: 'LEARN_SKILL', heroId: hero.id, skillId: skill.id })}
          >
            learn for {req.cost}g
          </button>
        )}
      </div>
    </div>
  );
}

export function GuildView({ game }: { game: GameState }) {
  const heroes = game.rosterOrder.map((id) => game.roster[id]!).filter(Boolean);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [spellKind, setSpellKind] = useState<'all' | SkillDef['kind']>('all');
  const [query, setQuery] = useState('');
  const hero = heroes.find((h) => h.id === selectedId) ?? heroes[0];
  const spellbook = Object.values(SKILLS)
    .filter((s) => s.guild)
    .filter((s) => spellKind === 'all' || s.kind === spellKind)
    .filter(
      (s) =>
        query.trim() === '' ||
        `${s.name} ${s.description}`.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => a.guild!.minLevel - b.guild!.minLevel || a.guild!.cost - b.guild!.cost);

  return (
    <BuildingShell
      icon="✨"
      title="Magician's Guild"
      blurb="Class techniques can be trained ahead of their level; the open spellbook teaches anyone clever enough. The guild does not ask questions."
    >
      {!hero ? (
        <div className="panel muted">No students. Hire heroes at the tavern first.</div>
      ) : (
        <>
          <div className="hero-tabs">
            {heroes.map((h) => (
              <button
                key={h.id}
                className={`btn hero-tab ${h.id === hero.id ? 'active' : ''}`}
                onClick={() => setSelectedId(h.id)}
              >
                <ClassSprite classId={h.classId} scale={3} />
                <span>
                  {h.name}
                  <span className="muted small"> L{h.level} · INT {Math.floor(derive(h).attrs.int)}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="panel">
            <div className="panel-title">Class training — <ClassName classId={hero.classId} /></div>
            {CLASSES[hero.classId]!.skillUnlocks.map((u) => {
              const skill = SKILLS[u.skillId];
              const known = hero.skills.includes(u.skillId);
              const cost = learnSkillCost(u.level, u.level - hero.level);
              return (
                <div key={u.skillId} className="row" title={skill?.description}>
                  <span>
                    {known ? '✓ ' : ''}
                    {skill?.name ?? u.skillId}{' '}
                    <span className="muted small">
                      (free at level {u.level}{skill ? ` · ${skill.mpCost} mana` : ''})
                    </span>
                  </span>
                  {known ? (
                    <span className="tag tag-idle">known</span>
                  ) : hero.activity === 'party' ? (
                    <span className="muted small">in the dungeon</span>
                  ) : (
                    <button
                      className="btn btn-small"
                      disabled={spendableGold(game) < cost}
                      onClick={() => app.dispatch({ t: 'LEARN_SKILL', heroId: hero.id, skillId: u.skillId })}
                    >
                      learn early {cost}g
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="panel-title" style={{ margin: '10px 0 6px' }}>
            📖 The Open Spellbook
          </div>
          <div className="row">
            <Chips
              options={[{ id: 'all' as const, label: 'all' }, ...SPELL_KINDS]}
              value={spellKind}
              onPick={setSpellKind}
            />
            <input
              className="search-input"
              type="search"
              placeholder="search spells…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {spellbook.length === 0 && (
            <div className="panel muted small">No spells match. The librarian shrugs.</div>
          )}
          <div className="building-cols cols-equal">
            {spellbook.map((skill) => (
              <SpellCard key={skill.id} game={game} hero={hero} skill={skill} />
            ))}
          </div>
        </>
      )}
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- tavern
export function TavernView({ game }: { game: GameState }) {
  const recruits = tavernRecruits(game);
  return (
    <BuildingShell icon="🍺" title="Tavern" blurb="Adventurers for hire. The crowd changes after every crawl — and every morning. Some of them are even competent.">
      <div className="building-cols cols-equal">
        {recruits.map((r) => {
          const hired = game.village.hiredToday.includes(r.key);
          const cost = effectiveHireCost(game, r);
          const cls = CLASSES[r.classId]!;
          const attrs = {
            str: Math.floor(cls.base.str + cls.growth.str * (r.level - 1)),
            dex: Math.floor(cls.base.dex + cls.growth.dex * (r.level - 1)),
            int: Math.floor(cls.base.int + cls.growth.int * (r.level - 1)),
            vit: Math.floor(cls.base.vit + cls.growth.vit * (r.level - 1)),
          };
          return (
            <div key={r.key} className="panel recruit-card">
              <div className="portrait-row">
                <ClassSprite classId={r.classId} scale={4} />
                <div>
                  <div className="panel-title">
                    {r.name}{' '}
                    <span className="muted">
                      L{r.level} <RaceName raceId={r.raceId} /> <ClassName classId={r.classId} />
                    </span>
                  </div>
                  <div className="muted small">{cls.description}</div>
                  <div className="small recruit-stats">
                    STR {attrs.str + raceAttrDelta(r.raceId).str} · DEX {attrs.dex + raceAttrDelta(r.raceId).dex} · INT{' '}
                    {attrs.int + raceAttrDelta(r.raceId).int} · VIT {attrs.vit + raceAttrDelta(r.raceId).vit} ·{' '}
                    {heroMaxHp(cls.baseHp, attrs.vit)} HP · {heroMaxMp(cls.baseMp, attrs.int)} MP
                  </div>
                  <TraitChips traitIds={r.traits} raceId={r.raceId} />
                </div>
              </div>
              <div className="small" style={{ margin: '6px 0' }}>
                {r.perks.length === 0 && <span className="muted">No remarkable traits. Refreshingly normal.</span>}
                {r.perks.map((pid) => {
                  const perk = PERKS[pid];
                  return (
                    <div key={pid}>
                      <Hint className={`tag tag-perk-${perk?.polarity}`} label={perk?.name ?? pid} text={perk?.flavor} />{' '}
                      <span className="muted small">{perk?.flavor}</span>
                    </div>
                  );
                })}
              </div>
              <button
                className="btn btn-primary"
                disabled={hired || spendableGold(game) < cost}
                onClick={() => app.dispatch({ t: 'HIRE', recruitKey: r.key })}
              >
                {hired ? 'already hired' : cost === 0 ? 'Hire (free — the village insists)' : `Hire for ${cost}g`}
              </button>
            </div>
          );
        })}
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- hospital
export function HospitalView({ game }: { game: GameState }) {
  const patients = game.rosterOrder
    .map((id) => game.roster[id]!)
    .filter((h) => h && h.activity !== 'party')
    .filter((h) => h.injuries.length > 0 || h.hp < derive(h).maxHp - 0.5);
  return (
    <BuildingShell
      icon="✚"
      title="Hospital"
      blurb="Rest heals slowly even while you're away; gold heals instantly. Lost limbs are negotiable."
    >
      {patients.length === 0 && (
        <div className="panel muted">Every bed is empty. The doctor is doing crosswords.</div>
      )}
      <div className="building-cols">
        {patients.map((hero) => {
          const d = derive(hero);
          const missing = Math.max(0, d.maxHp - Math.floor(hero.hp));
          const restCost = instantHealCost(missing);
          return (
            <div key={hero.id} className="panel">
              <div className="panel-title">
                {hero.name}{' '}
                <span className="muted">
                  L{hero.level} <RaceName raceId={hero.raceId} /> <ClassName classId={hero.classId} />
                </span>
                <span className={`tag tag-${hero.activity}`}>{hero.activity}</span>
              </div>
              <HeroVitals hero={hero} />
              {missing > 0 && (
                <button
                  className="btn btn-small"
                  disabled={spendableGold(game) < restCost}
                  onClick={() => app.dispatch({ t: 'REST_HERO', heroId: hero.id })}
                >
                  Patch up fully ({restCost}g)
                </button>
              )}
              {hero.injuries.map((iid) => {
                const injury = INJURIES[iid];
                if (!injury) return null;
                const cost = healInjuryCost(injury.healCostBase, injury.severity, hero.level);
                return (
                  <div key={iid} className="row" title={injury.flavor}>
                    <span>
                      <span className="tag tag-bad">{injury.name}</span>{' '}
                      <span className="muted small">{injury.flavor}</span>
                    </span>
                    <button
                      className="btn btn-small"
                      disabled={spendableGold(game) < cost}
                      onClick={() => app.dispatch({ t: 'HEAL_INJURY', heroId: hero.id, injuryId: iid })}
                    >
                      treat {cost}g
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- graveyard
export function GraveyardView({ game }: { game: GameState }) {
  const graves = loadGraveyard().slice().reverse();
  return (
    <BuildingShell
      icon="🪦"
      title="Graveyard"
      blurb="Every hero who never came home — across all your villages, forever. The groundskeeper has excellent memory."
    >
      <div className="panel">
        <div className="row">
          <span className="muted">
            {graves.length === 0
              ? 'No graves. The grass grows undisturbed. May it stay that way.'
              : `${graves.length} hero${graves.length > 1 ? 'es' : ''} rest${graves.length > 1 ? '' : 's'} here · ${game.progress.totalPermadeaths} from this village`}
          </span>
        </div>
      </div>
      <div className="building-cols">
        {graves.map((grave, i) => (
          <div key={i} className="panel grave">
            <div className="grave-stone">🪦</div>
            <div>
              <div className="panel-title">{grave.name}</div>
              <div className="muted small">
                L{grave.level} <ClassName classId={grave.classId} /> — fell at depth {grave.depth}
              </div>
              <div className="small">{grave.cause ?? 'the dungeon keeps its secrets'}</div>
              <div className="small epitaph">“{epitaphFor(grave)}”</div>
              <div className="muted small">{new Date(grave.diedAtMs).toLocaleDateString()}</div>
            </div>
          </div>
        ))}
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- guild hall (roster)
/** the story arc that comes to everyone */
function StoryBlock({ hero }: { hero: Hero }) {
  const s = hero.stats;
  if (!s || s.runs === 0) {
    return <div className="muted small story">📖 No story yet. The dungeon awaits.</div>;
  }
  return (
    <div className="small story">
      <div>
        ⚔ {s.runs} crawl{s.runs > 1 ? 's' : ''} · {s.kills} kill{s.kills === 1 ? '' : 's'} ·{' '}
        {Math.round(s.dmgDealt)} dmg dealt
        {s.bestRunDmg > 0 ? ` (best crawl: ${Math.round(s.bestRunDmg)})` : ''}
      </div>
      {s.biggestHitTaken > 0 && (
        <div className="muted">
          💥 worst hit taken: {s.biggestHitTaken} from {s.biggestHitFrom}
        </div>
      )}
      {s.downs > 0 && (
        <div className="muted">
          🩸 incapacitated {s.downs}×{s.lastDownedHow ? ` — last ${s.lastDownedHow}` : ''}
        </div>
      )}
      {(s.carriedOut > 0 || s.rescues > 0) && (
        <div className="muted">
          🤝 {s.carriedOut > 0 ? `carried to safety ${s.carriedOut}×` : ''}
          {s.carriedOut > 0 && s.rescues > 0 ? ' · ' : ''}
          {s.rescues > 0 ? `carried a friend home ${s.rescues}×` : ''}
        </div>
      )}
    </div>
  );
}

/** format a god's signature StatMods as a short human string ("+10% dmg · +1 dex") */
function fmtBonus(mods: StatMod[]): string {
  const parts = mods
    .map((m) => {
      if (m.kind === 'mult') {
        const pct = Math.round((m.mul - 1) * 100);
        return pct === 0 ? null : `${pct > 0 ? '+' : ''}${pct}% ${m.what}`;
      }
      if (m.kind === 'attr') return `${m.add > 0 ? '+' : ''}${m.add} ${m.attr}`;
      return null;
    })
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

/** the deity-selection popup: every god with portrait, lore and signature boon;
 *  dedication is a clear choice, switching is gated behind a heavy-penalty confirm */
function DeitySelectModal({ hero, onClose }: { hero: Hero; onClose: () => void }) {
  const currentId = hero.faith?.religionId ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const choose = (id: string) => {
    if (id === currentId) return;
    if (currentId) {
      const from = RELIGIONS[currentId];
      const to = RELIGIONS[id];
      const ok = confirm(
        `Forsake ${from?.name} and turn ${hero.name} to ${to?.name}?\n\n` +
          `⚠ ENORMOUS PENALTY — all of ${hero.name}'s accumulated favor is wiped, and they ` +
          `begin FORSAKEN: ${to?.deity} suffers the turncoat with reduced damage and the threat ` +
          `of divine wrath until ${hero.name} tithes and devotes a long way back into favor.\n\n` +
          `This is not easily undone. Switch anyway?`,
      );
      if (!ok) return;
    }
    app.dispatch({ t: 'SET_HERO_FAITH', heroId: hero.id, religionId: id });
    onClose();
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal panel deity-picker"
        role="dialog"
        aria-modal="true"
        aria-label={`Choose ${hero.name}'s deity`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="debrief-title">🛐 Choose {hero.name}&rsquo;s Deity</div>
        <p className="muted small deity-intro">
          {currentId ? (
            <>
              {hero.name} is devoted to <b>{RELIGIONS[currentId]?.name}</b>. Dedication is for life —{' '}
              <b>switching gods wipes all favor and begins Forsaken</b> under the new deity&rsquo;s wrath. Choose carefully.
            </>
          ) : (
            <>
              Dedication is free, and favor grows through devotion and tithing. But once chosen, a hero&rsquo;s faith is
              meant to last — <b>switching gods later carries an enormous penalty</b>.
            </>
          )}
        </p>
        <div className="deity-grid">
          {Object.values(RELIGIONS).map((r) => {
            const isCurrent = r.id === currentId;
            return (
              <div key={r.id} className={`deity-card${isCurrent ? ' current' : ''}`}>
                <div className="deity-head">
                  <GodPortrait religionId={r.id} scale={3} label={`${r.name} portrait`} />
                  <div className="deity-titles">
                    <b>{r.name}</b>
                    <span className="muted small">{r.deity}</span>
                    <span className="muted small deity-domain">{r.domain}</span>
                  </div>
                </div>
                <div className="small deity-desc">{r.description}</div>
                <div className="small">
                  <span className="muted">Faithful boon:</span> {fmtBonus(r.bonus)}
                </div>
                <div className="small">
                  <span className="muted">Blessing:</span> {r.blessing}
                </div>
                <div className="deity-action">
                  {isCurrent ? (
                    <span className="tag tag-current">✓ current faith</span>
                  ) : currentId ? (
                    <button className="btn btn-small btn-danger" onClick={() => choose(r.id)}>
                      ⚠ switch — favor wiped, begin Forsaken
                    </button>
                  ) : (
                    <button className="btn btn-small btn-primary" onClick={() => choose(r.id)}>
                      dedicate
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="row modal-footer">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** per-hero faith management — choose a god (popup), tithe gold for favor (Guild Hall) */
function FaithRow({ hero }: { hero: Hero }) {
  const rel = hero.faith ? RELIGIONS[hero.faith.religionId] : undefined;
  const tier = hero.faith ? favorTier(hero.faith.favor) : null;
  const [picking, setPicking] = useState(false);
  return (
    <div className="row small faith-row">
      <span>
        🛐{' '}
        {rel ? (
          <>
            <Hint label={<b>{rel.name}</b>} text={`${rel.deity} — ${rel.description}`} />{' '}
            <span className={`favor favor-${tier}`}>
              {tier} ({hero.faith!.favor >= 0 ? '+' : ''}{hero.faith!.favor})
            </span>
          </>
        ) : (
          <span className="muted">Faithless</span>
        )}
      </span>
      <span className="row-buttons">
        <button className="btn btn-tiny" onClick={() => setPicking(true)}>
          {hero.faith ? 'change deity' : 'choose deity'}
        </button>
        {hero.faith && (
          <button
            className="btn btn-tiny"
            disabled={hero.gold < (rel?.titheRate ?? 10)}
            title={`tithe gold for favor (${rel?.titheRate ?? 10}g per +1)`}
            onClick={() => app.dispatch({ t: 'TITHE', heroId: hero.id, amount: Math.min(hero.gold, 200) })}
          >
            tithe
          </button>
        )}
      </span>
      {picking && <DeitySelectModal hero={hero} onClose={() => setPicking(false)} />}
    </div>
  );
}

function HallHeroCard({ game, hero }: { game: GameState; hero: Hero }) {
  const d = derive(hero);
  const [editingTactics, setEditingTactics] = useState(false);
  return (
    <div className="panel hero-card">
      <div className="portrait-row">
        <ClassSprite classId={hero.classId} scale={4} />
        <div style={{ flex: 1 }}>
          <div className="panel-title">
            {hero.name}{' '}
            <span className="muted">
              — L{hero.level} <RaceName raceId={hero.raceId} /> <ClassName classId={hero.classId} />
            </span>
            <span className={`tag tag-${hero.activity}`}>{hero.activity}</span>
          </div>
          <HeroVitals hero={hero} />
        </div>
      </div>
      <div className="muted small">
        str {Math.floor(d.attrs.str)} · dex {Math.floor(d.attrs.dex)} · int {Math.floor(d.attrs.int)} · vit{' '}
        {Math.floor(d.attrs.vit)} · dmg {d.weaponDmg} · armor {d.armor} · speed {(40 / d.moveTicks).toFixed(1)}
      </div>
      <div className={`small ${d.carryUsed > d.carryMax ? 'req-unmet' : 'muted'}`}>
        carry: {d.carryUsed.toFixed(1)} / {d.carryMax.toFixed(1)} kg
        {d.moveTicks > 4 ? <span className="muted"> · heavy gear slows movement</span> : null}
      </div>
      <TraitChips traitIds={hero.traits} raceId={hero.raceId} />
      <FaithRow hero={hero} />
      {hero.perks.length > 0 && (
        <div className="small">
          {hero.perks.map((pid) => {
            const perk = PERKS[pid];
            return (
              <span key={pid}>
                <Hint className={`tag tag-perk-${perk?.polarity}`} label={perk?.name ?? pid} text={perk?.flavor} />{' '}
              </span>
            );
          })}
        </div>
      )}
      <div className="small">
        {(['weapon', 'offhand', 'armor', 'trinket'] as const).map((slot) => {
          const item = hero.equipment[slot];
          const candidates = hero.activity === 'party' ? [] : equipCandidates(game, hero, slot);
          return (
            <div key={slot} className="equip-row">
              <span className="muted">{slot}:</span>{' '}
              {item ? (
                <>
                  <ItemName item={item} />{' '}
                  <button className="btn btn-tiny" onClick={() => app.dispatch({ t: 'UNEQUIP', heroId: hero.id, slot })}>
                    ✕
                  </button>
                </>
              ) : (
                <span className="muted">—</span>
              )}
              {candidates.length > 0 && (
                <select
                  defaultValue=""
                  title="equip from storage"
                  onChange={(e) => {
                    if (e.target.value) {
                      app.dispatch({ t: 'EQUIP', heroId: hero.id, itemId: e.target.value });
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="">{item ? 'swap…' : 'equip…'}</option>
                  {candidates.slice(0, 12).map((c) => (
                    <option key={c.id} value={c.id}>
                      {ITEMS[c.defId]?.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
      <div className="row small satchel-head">
        <span>
          <span className="gold">{hero.gold}g</span>
          {hero.satchel.length > 0 ? <span className="muted"> · 🎒 {hero.satchel.length} in pack</span> : null}
        </span>
        {hero.gold > 0 &&
          (hero.ownership?.greedy ? (
            <span className="muted small" title="Greedy — hoards their gold and won't bank or share it (but finds more of it)">
              🪙 hoarding
            </span>
          ) : (
            <button
              className="btn btn-tiny"
              title="move this hero's gold into the village treasury"
              onClick={() => app.dispatch({ t: 'DEPOSIT_GOLD', heroId: hero.id, amount: hero.gold })}
            >
              bank {hero.gold}g
            </button>
          ))}
      </div>
      {hero.satchel.length > 0 && (
        <div className="small satchel">
          {hero.satchel.slice(0, 8).map((it) => (
            <div key={it.id} className="row">
              <ItemName item={it} />
              <span className="row-buttons">
                <button
                  className="btn btn-tiny"
                  title="move into shared village storage"
                  onClick={() => app.dispatch({ t: 'DEPOSIT_ITEM', heroId: hero.id, itemId: it.id })}
                >
                  stash
                </button>
                <button
                  className="btn btn-tiny"
                  title="sell for this hero's own gold"
                  onClick={() => app.dispatch({ t: 'SELL_SATCHEL_ITEM', heroId: hero.id, itemId: it.id })}
                >
                  sell
                </button>
              </span>
            </div>
          ))}
          {hero.satchel.length > 8 && <div className="muted">…and {hero.satchel.length - 8} more</div>}
        </div>
      )}
      <StoryBlock hero={hero} />
      {hero.injuries.length > 0 && (
        <div className="small">
          {hero.injuries.map((iid) => (
            <span key={iid}>
              <Hint className="tag tag-bad" label={INJURIES[iid]?.name ?? iid} text={INJURIES[iid]?.flavor} />{' '}
            </span>
          ))}
          <span className="muted small"> → hospital</span>
        </div>
      )}
      <div className="row">
        <span className="row-buttons">
          <button className="btn btn-small" onClick={() => setEditingTactics(true)}>
            Tactics
          </button>
          <select
            value={hero.choreId ?? ''}
            title="Chores earn gold & xp while the tab is open"
            onChange={(e) => app.dispatch({ t: 'ASSIGN_CHORE', heroId: hero.id, choreId: e.target.value || null })}
          >
            <option value="">no chore</option>
            {Object.values(CHORES).map((c) => (
              <option key={c.id} value={c.id} disabled={hero.level < c.minLevel}>
                {c.name} ({c.goldPerHour}g/h, {c.xpPerHour}xp/h)
              </option>
            ))}
          </select>
        </span>
        <button
          className="btn btn-tiny btn-danger"
          onClick={() => {
            if (confirm(`Dismiss ${hero.name} forever?`)) app.dispatch({ t: 'DISMISS', heroId: hero.id });
          }}
        >
          dismiss
        </button>
      </div>
      {editingTactics && <TacticsEditor hero={hero} onClose={() => setEditingTactics(false)} />}
    </div>
  );
}

export function HallView({ game }: { game: GameState }) {
  return (
    <BuildingShell
      icon="🛡"
      title="Guild Hall"
      blurb="The roster: equipment, tactics, chores. Heroes between expeditions loiter here."
    >
      <div className="building-cols cols-wide">
        {game.rosterOrder.map((id) => {
          const hero = game.roster[id];
          return hero ? <HallHeroCard key={id} game={game} hero={hero} /> : null;
        })}
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- dungeon gate
/** one hero at the gate: click to enlist, kit them out right here */
function GateHeroCard({
  game,
  hero,
  selected,
  onToggle,
}: {
  game: GameState;
  hero: Hero;
  selected: boolean;
  onToggle: () => void;
}) {
  const d = derive(hero);
  const [editingTactics, setEditingTactics] = useState(false);
  const stock = game.village.potions;
  const setPotions = (kind: 'hp' | 'mp', delta: number) =>
    app.dispatch({
      t: 'SET_HERO_POTIONS',
      heroId: hero.id,
      potions: { ...hero.potions, [kind]: Math.max(0, hero.potions[kind] + delta) },
    });
  return (
    <div className={`panel hero-card gate-card ${selected ? 'gate-selected' : ''}`} onClick={onToggle}>
      {selected && <div className="stamp">⚔ SELECTED</div>}
      <div className="portrait-row">
        <ClassSprite classId={hero.classId} scale={4} />
        <div style={{ flex: 1 }}>
          <div className="panel-title">
            {hero.name}{' '}
            <span className="muted">
              — L{hero.level} <RaceName raceId={hero.raceId} /> <ClassName classId={hero.classId} />
            </span>
          </div>
          <HeroVitals hero={hero} />
        </div>
      </div>
      <div className="muted small">
        dmg {d.weaponDmg} · armor {d.armor} · speed {(40 / d.moveTicks).toFixed(1)} · carry{' '}
        {d.carryUsed.toFixed(1)}/{d.carryMax.toFixed(1)} kg
      </div>
      <TraitChips traitIds={hero.traits} raceId={hero.raceId} />
      {hero.injuries.length > 0 && (
        <div className="small">
          {hero.injuries.map((iid) => (
            <span key={iid}>
              <Hint className="tag tag-bad" label={INJURIES[iid]?.name ?? iid} text={INJURIES[iid]?.flavor} />{' '}
            </span>
          ))}
        </div>
      )}
      <div className="gate-controls small" onClick={(e) => e.stopPropagation()}>
        {(['weapon', 'offhand', 'armor', 'trinket'] as const).map((slot) => {
          const item = hero.equipment[slot];
          const candidates = equipCandidates(game, hero, slot);
          return (
            <div key={slot} className="equip-row">
              <span className="muted">{slot}:</span>{' '}
              {item ? (
                <>
                  <ItemName item={item} />{' '}
                  <button
                    className="btn btn-tiny"
                    onClick={() => app.dispatch({ t: 'UNEQUIP', heroId: hero.id, slot })}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <span className="muted">—</span>
              )}
              {candidates.length > 0 && (
                <select
                  defaultValue=""
                  title="equip from storage"
                  onChange={(e) => {
                    if (e.target.value) {
                      app.dispatch({ t: 'EQUIP', heroId: hero.id, itemId: e.target.value });
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="">{item ? 'swap…' : 'equip…'}</option>
                  {candidates.slice(0, 12).map((c) => (
                    <option key={c.id} value={c.id}>
                      {ITEMS[c.defId]?.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
        <div className="row">
          <span className="muted">packed:</span>
          <span className="row-buttons">
            {(['hp', 'mp'] as const).map((kind) => (
              <span key={kind} className="potion-stepper">
                <span className="muted">{kind === 'hp' ? '🧪 heal' : '💧 mana'}</span>
                <button
                  className="btn btn-tiny"
                  disabled={hero.potions[kind] <= 0}
                  title="put one back on the shelf"
                  onClick={() => setPotions(kind, -1)}
                >
                  −
                </button>
                <b>{hero.potions[kind]}</b>
                <button
                  className="btn btn-tiny"
                  disabled={stock[kind] <= 0}
                  title="pack one from the shelf"
                  onClick={() => setPotions(kind, 1)}
                >
                  +
                </button>
              </span>
            ))}
            <span className="potion-stepper">
              <span className="muted">💣 bomb</span>
              <button
                className="btn btn-tiny"
                disabled={hero.bombs <= 0}
                title="put one back in the crate"
                onClick={() => app.dispatch({ t: 'SET_HERO_BOMBS', heroId: hero.id, bombs: hero.bombs - 1 })}
              >
                −
              </button>
              <b>{hero.bombs}</b>
              <button
                className="btn btn-tiny"
                disabled={game.village.bombs <= 0}
                title="pack one from the crate (buy them at the store)"
                onClick={() => app.dispatch({ t: 'SET_HERO_BOMBS', heroId: hero.id, bombs: hero.bombs + 1 })}
              >
                +
              </button>
            </span>
          </span>
        </div>
        <div className="row">
          <span className="muted">tactics:</span>
          <span className="row-buttons">
            <select
              value={hero.tactics.activeSetId}
              title="active tactic set"
              onChange={(e) => app.dispatch({ t: 'SWITCH_TACTIC_SET', heroId: hero.id, setId: e.target.value })}
            >
              {hero.tactics.sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="btn btn-tiny" onClick={() => setEditingTactics(true)}>
              ⚙ edit
            </button>
          </span>
        </div>
        {editingTactics && <TacticsEditor hero={hero} onClose={() => setEditingTactics(false)} />}
      </div>
    </div>
  );
}

export function GateView({ game }: { game: GameState }) {
  const [selected, setSelected] = useState<Id[]>([]);
  const [depth, setDepth] = useState(1);
  const [behavior, setBehavior] = useState<PartyBehavior>('balanced');
  const [behaviorPicking, setBehaviorPicking] = useState(false);
  const candidates = game.rosterOrder
    .map((id) => game.roster[id]!)
    .filter((h) => h && h.activity !== 'party' && h.hp > 0);
  const depths = [1, ...game.progress.checkpoints].sort((a, b) => a - b);
  const toggle = (id: Id) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < 4 ? [...sel, id] : sel));
  const spare = selected
    .map((id) => game.roster[id])
    .filter((h): h is Hero => !!h)
    .reduce((sum, h) => {
      const d = derive(h);
      return sum + Math.max(0, d.carryMax - d.carryUsed);
    }, 0);
  return (
    <BuildingShell
      icon="🕳"
      title="Dungeon Gate"
      blurb="Pick up to four. They fight on their own — your tactics decide how. Bosses wait every 5th floor."
    >
      <div className="panel gate-bar">
        <div className="row">
          <span className="panel-title" style={{ marginBottom: 0 }}>
            Expedition party ({selected.length}/4)
          </span>
          <span className="row-buttons">
            <span className="muted">behavior</span>
            <button className="btn btn-small" onClick={() => setBehaviorPicking(true)}>
              {PARTY_BEHAVIORS.find((b) => b.id === behavior)?.name ?? behavior} ⏷
            </button>
            {behaviorPicking && (
              <BehaviorSelectModal value={behavior} onPick={setBehavior} onClose={() => setBehaviorPicking(false)} />
            )}
            <span className="muted">start at depth</span>
            <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
              {depths.map((dd) => (
                <option key={dd} value={dd}>
                  {dd}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary gate-descend"
              disabled={selected.length === 0}
              onClick={() => {
                app.dispatch({ t: 'EMBARK', memberIds: selected, startDepth: depth, behavior });
                setSelected([]);
              }}
            >
              {selected.length === 0
                ? '⚔ Descend!'
                : `⚔ Descend with ${selected.length} hero${selected.length > 1 ? 'es' : ''}!`}
            </button>
          </span>
        </div>
        <div className="panel-sub">
          Click a hero card to enlist them — gear, potions and tactics can be tuned right on the card. Everyone tops up
          to 3 healing / 2 mana potions from the store shelf ({game.village.potions.hp} hp / {game.village.potions.mp}{' '}
          mp in stock); pack extra below if you like.
          {selected.length > 0 ? ` Party loot space: ${spare.toFixed(0)}kg.` : ''} A downed hero ends the expedition —
          the others carry them home. <b>{PARTY_BEHAVIORS.find((b) => b.id === behavior)?.name}:</b>{' '}
          {PARTY_BEHAVIORS.find((b) => b.id === behavior)?.blurb}
        </div>
      </div>
      {candidates.length === 0 && (
        <div className="panel muted">Nobody is fit to descend. Visit the tavern or the hospital.</div>
      )}
      <div className="building-cols cols-wide">
        {candidates.map((h) => (
          <GateHeroCard
            key={h.id}
            game={game}
            hero={h}
            selected={selected.includes(h.id)}
            onToggle={() => toggle(h.id)}
          />
        ))}
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- gambler's cove
export function CoveView({ game }: { game: GameState }) {
  const [stake, setStake] = useState(25);
  const log = useUi((s) => s.log);
  const gold = game.village.gold;
  const recent = log.filter((l) => l.text.startsWith('🎲')).slice(0, 7);

  const clampStake = (g: (typeof COVE_GAMES)[string]) =>
    Math.min(Math.max(g.minStake, Math.floor(stake)), g.maxStake, gold);

  return (
    <BuildingShell
      icon="🎲"
      title="Gambler's Cove"
      blurb="A seaside den where the village coffers come to feel alive. The house always keeps a sliver — but the longshots pay like the tide."
    >
      <div className="cove">
        <div className="cove-bank">
          <span>
            Village bank: <b className="gold">{gold}g</b>
          </span>
          <label className="cove-stake">
            stake
            <input
              type="range"
              min={5}
              max={250}
              step={5}
              value={stake}
              onChange={(e) => setStake(Number(e.target.value))}
            />
            <input
              type="number"
              min={5}
              value={stake}
              onChange={(e) => setStake(Math.max(5, Number(e.target.value) || 5))}
            />
            <span className="muted">g</span>
          </label>
          <span className="row-buttons">
            {[25, 50, 100].map((v) => (
              <button key={v} className="btn btn-tiny" onClick={() => setStake(v)}>
                {v}
              </button>
            ))}
            <button className="btn btn-tiny" onClick={() => setStake(Math.max(5, Math.min(250, gold)))}>
              max
            </button>
          </span>
        </div>

        <div className="cove-games">
          {Object.values(COVE_GAMES).map((g) => {
            const bet = clampStake(g);
            const profit = Math.round(bet * (g.payoutMult - 1));
            const canBet = gold >= g.minStake;
            return (
              <div key={g.id} className="cove-game">
                <div className="cove-game-head">
                  <b>{g.name}</b>
                  <span className="cove-mult">{g.payoutMult}×</span>
                </div>
                <div className="small muted cove-blurb">{g.blurb}</div>
                <div className="cove-odds small">
                  <span>win {Math.round(g.winChance * 100)}%</span>
                  <span>·</span>
                  <span>min {g.minStake}</span>
                  <span>·</span>
                  <span>max {g.maxStake}g</span>
                </div>
                <button
                  className="btn cove-bet"
                  disabled={!canBet}
                  onClick={() => app.dispatch({ t: 'GAMBLE', gameId: g.id, stake: bet })}
                >
                  {canBet ? (
                    <>
                      Bet {bet}g → win <b className="gold">+{profit}g</b>
                    </>
                  ) : (
                    'bank too low'
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="cove-results">
          <div className="muted small">At the table…</div>
          {recent.length === 0 ? (
            <div className="small muted">No bets placed yet. The barkeep cracks his knuckles.</div>
          ) : (
            recent.map((l, i) => (
              <div key={i} className={`small log-${l.cls}`}>
                {l.text}
              </div>
            ))
          )}
        </div>
      </div>
    </BuildingShell>
  );
}
