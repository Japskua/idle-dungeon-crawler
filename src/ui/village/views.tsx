/**
 * One focused screen per village building. Each view gets the full width —
 * no more everything-crammed-into-one-screen.
 */
import { useState } from 'react';
import { app } from '../../app/loop';
import { epitaphFor, loadGraveyard } from '../../app/graveyard';
import { POTION_PRICES, healInjuryCost, instantHealCost, learnSkillCost, spellAmount } from '../../game/balance';
import { CHORES, CLASSES, INJURIES, ITEMS, PERKS, SKILLS } from '../../game/content';
import { derive } from '../../game/hero/derive';
import { canEquip } from '../../game/hero/equipment';
import { effectiveHireCost, shopStock, tavernRecruits } from '../../game/village/shop';
import type { GameState, Hero, Id, SkillDef } from '../../game/types';
import { ClassSprite, HeroVitals, ItemName } from '../components';
import { TacticsEditor } from '../TacticsEditor';
import { setVillageView } from '../store';

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
export function ArmorerView({ game }: { game: GameState }) {
  const stock = shopStock(game);
  const armory = game.village.inventory.filter((i) =>
    ['weapon', 'offhand', 'armor', 'trinket'].includes(ITEMS[i.defId]?.slot ?? ''),
  );
  const heroes = game.rosterOrder.map((id) => game.roster[id]!).filter((h) => h && h.activity !== 'party');
  return (
    <BuildingShell icon="⚒" title="Armorer" blurb="Weapons and armor. The hammering never stops. Stock rotates daily.">
      <div className="building-cols">
        <div className="panel">
          <div className="panel-title">For sale today</div>
          {stock.map((entry) => {
            const def = ITEMS[entry.defId]!;
            const bought = game.village.purchasedToday.includes(entry.key);
            return (
              <div key={entry.key} className="row">
                <span title={def.flavor}>
                  {def.name}{' '}
                  <span className="muted small">
                    {def.base?.dmg ? `${def.base.dmg} dmg` : ''}
                    {def.base?.armor ? `${def.base.armor} armor` : ''}
                    {def.base?.range && def.base.range > 1 ? `, range ${def.base.range}` : ''}
                  </span>
                </span>
                <button
                  className="btn btn-small"
                  disabled={bought || game.village.gold < entry.price}
                  onClick={() => app.dispatch({ t: 'BUY_STOCK_ITEM', stockKey: entry.key })}
                >
                  {bought ? 'sold' : `${entry.price}g`}
                </button>
              </div>
            );
          })}
        </div>
        <div className="panel">
          <div className="panel-title">Your armory ({armory.length})</div>
          {armory.length === 0 && <div className="muted small">Empty racks. The dungeon provides.</div>}
          {armory.slice(0, 40).map((item) => {
            const def = ITEMS[item.defId]!;
            return (
              <div key={item.id} className="row">
                <ItemName item={item} />
                <span className="row-buttons">
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
                      const slot = def.slot as 'weapon' | 'offhand' | 'armor' | 'trinket';
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
                  <button className="btn btn-tiny" onClick={() => app.dispatch({ t: 'SELL_ITEM', itemId: item.id })}>
                    sell
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- store
export function StoreView({ game }: { game: GameState }) {
  const sellables = game.village.inventory.filter(
    (i) => !['weapon', 'offhand', 'armor', 'trinket'].includes(ITEMS[i.defId]?.slot ?? ''),
  );
  return (
    <BuildingShell icon="🧺" title="General Store" blurb="Potions, sundries, and a shopkeeper who buys absolutely anything.">
      <div className="building-cols">
        <div className="panel">
          <div className="panel-title">Potions</div>
          {(['hp', 'mp'] as const).map((kind) => (
            <div key={kind} className="row">
              <span>
                {kind === 'hp' ? '🧪 Healing potion' : '🧪 Mana potion'}{' '}
                <span className="muted small">(in stock: {game.village.potions[kind]})</span>
              </span>
              <span className="row-buttons">
                {[1, 5].map((qty) => (
                  <button
                    key={qty}
                    className="btn btn-small"
                    disabled={game.village.gold < POTION_PRICES[kind] * qty}
                    onClick={() => app.dispatch({ t: 'BUY_POTION', potion: kind, qty })}
                  >
                    ×{qty} ({POTION_PRICES[kind] * qty}g)
                  </button>
                ))}
              </span>
            </div>
          ))}
          <div className="muted small" style={{ marginTop: 8 }}>
            Heroes pack 3 healing / 2 mana potions automatically when embarking.
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">Sell goods ({sellables.length})</div>
          {sellables.length === 0 && <div className="muted small">Nothing to sell. Yet. The rats are out there.</div>}
          {sellables.slice(0, 40).map((item) => (
            <div key={item.id} className="row">
              <ItemName item={item} />
              <button className="btn btn-tiny" onClick={() => app.dispatch({ t: 'SELL_ITEM', itemId: item.id })}>
                sell {Math.max(1, Math.round((ITEMS[item.defId]?.value ?? 0) * 0.4))}g
              </button>
            </div>
          ))}
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

function SpellCard({ game, hero, skill }: { game: GameState; hero: Hero; skill: SkillDef }) {
  const d = derive(hero);
  const known = hero.skills.includes(skill.id);
  const req = skill.guild!;
  const levelOk = hero.level >= req.minLevel;
  const intOk = d.attrs.int >= req.minInt;
  const goldOk = game.village.gold >= req.cost;
  const estimate = spellEstimate(skill, d.attrs.int);
  return (
    <div className={`panel spell-card ${known ? 'spell-known' : ''}`}>
      <div className="row">
        <b>{skill.name}</b>
        <span className="mana-cost">{skill.mpCost} mana</span>
      </div>
      <div className="muted small">
        {skill.target === 'enemiesInRadius' || skill.target === 'alliesInRadius'
          ? `area ${skill.radius} tiles`
          : skill.range > 0
            ? `range ${skill.range}`
            : 'self'}
        {' · '}cooldown {(skill.cooldown / 10).toFixed(0)}s · cast {(skill.castTicks / 10).toFixed(1)}s
      </div>
      <div className="small spell-desc">{skill.description}</div>
      {estimate && (
        <div className="small">
          <span className="gold">{estimate}</span> <span className="muted">for {hero.name} (INT {Math.floor(d.attrs.int)})</span>
        </div>
      )}
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
  );
}

export function GuildView({ game }: { game: GameState }) {
  const heroes = game.rosterOrder.map((id) => game.roster[id]!).filter(Boolean);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const hero = heroes.find((h) => h.id === selectedId) ?? heroes[0];
  const spellbook = Object.values(SKILLS)
    .filter((s) => s.guild)
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
                <ClassSprite classId={h.classId} scale={2} />
                <span>
                  {h.name}
                  <span className="muted small"> L{h.level} · INT {Math.floor(derive(h).attrs.int)}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="panel">
            <div className="panel-title">Class training — {CLASSES[hero.classId]?.name}</div>
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
                      disabled={game.village.gold < cost}
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
          <div className="building-cols">
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
    <BuildingShell icon="🍺" title="Tavern" blurb="Adventurers for hire. New faces wander in every day. Some of them are even competent.">
      <div className="building-cols">
        {recruits.map((r) => {
          const hired = game.village.hiredToday.includes(r.key);
          const cost = effectiveHireCost(game, r);
          return (
            <div key={r.key} className="panel">
              <div className="portrait-row">
                <ClassSprite classId={r.classId} scale={3} />
                <div>
                  <div className="panel-title">
                    {r.name} <span className="muted">L{r.level} {CLASSES[r.classId]?.name}</span>
                  </div>
                  <div className="muted small">{CLASSES[r.classId]?.description}</div>
                </div>
              </div>
              <div className="small" style={{ margin: '6px 0' }}>
                {r.perks.length === 0 && <span className="muted">No remarkable traits. Refreshingly normal.</span>}
                {r.perks.map((pid) => {
                  const perk = PERKS[pid];
                  return (
                    <div key={pid} title={perk?.flavor}>
                      <span className={`tag tag-perk-${perk?.polarity}`}>{perk?.name}</span>{' '}
                      <span className="muted small">{perk?.flavor}</span>
                    </div>
                  );
                })}
              </div>
              <button
                className="btn btn-primary"
                disabled={hired || game.village.gold < cost}
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
                {hero.name} <span className="muted">L{hero.level} {CLASSES[hero.classId]?.name}</span>
                <span className={`tag tag-${hero.activity}`}>{hero.activity}</span>
              </div>
              <HeroVitals hero={hero} />
              {missing > 0 && (
                <button
                  className="btn btn-small"
                  disabled={game.village.gold < restCost}
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
                      disabled={game.village.gold < cost}
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
                L{grave.level} {CLASSES[grave.classId]?.name ?? grave.classId} — fell at depth {grave.depth}
              </div>
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
function HallHeroCard({ game, hero }: { game: GameState; hero: Hero }) {
  const d = derive(hero);
  const [editingTactics, setEditingTactics] = useState(false);
  return (
    <div className="panel hero-card">
      <div className="portrait-row">
        <ClassSprite classId={hero.classId} scale={3} />
        <div style={{ flex: 1 }}>
          <div className="panel-title">
            {hero.name} <span className="muted">— L{hero.level} {CLASSES[hero.classId]?.name}</span>
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
      {hero.perks.length > 0 && (
        <div className="small">
          {hero.perks.map((pid) => {
            const perk = PERKS[pid];
            return (
              <span key={pid} className={`tag tag-perk-${perk?.polarity}`} title={perk?.flavor}>
                {perk?.name ?? pid}
              </span>
            );
          })}
        </div>
      )}
      <div className="small">
        {(['weapon', 'offhand', 'armor', 'trinket'] as const).map((slot) => {
          const item = hero.equipment[slot];
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
            </div>
          );
        })}
      </div>
      {hero.injuries.length > 0 && (
        <div className="small">
          {hero.injuries.map((iid) => (
            <span key={iid} className="tag tag-bad" title={INJURIES[iid]?.flavor}>
              {INJURIES[iid]?.name}
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
            title="Chores earn gold & xp around the clock, even offline"
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
      <div className="building-cols">
        {game.rosterOrder.map((id) => {
          const hero = game.roster[id];
          return hero ? <HallHeroCard key={id} game={game} hero={hero} /> : null;
        })}
      </div>
    </BuildingShell>
  );
}

// ---------------------------------------------------------------- dungeon gate
export function GateView({ game }: { game: GameState }) {
  const [selected, setSelected] = useState<Id[]>([]);
  const [depth, setDepth] = useState(1);
  const candidates = game.rosterOrder
    .map((id) => game.roster[id]!)
    .filter((h) => h && h.activity !== 'party' && h.hp > 0);
  const depths = [1, ...game.progress.checkpoints].sort((a, b) => a - b);
  const toggle = (id: Id) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < 4 ? [...sel, id] : sel));
  return (
    <BuildingShell
      icon="🕳"
      title="Dungeon Gate"
      blurb="Pick up to four. They fight on their own — your tactics decide how. Bosses wait every 5th floor."
    >
      <div className="building-cols">
        <div className="panel">
          <div className="panel-title">Expedition party ({selected.length}/4)</div>
          {candidates.length === 0 && (
            <div className="muted small">Nobody is fit to descend. Visit the tavern or the hospital.</div>
          )}
          {candidates.map((h) => {
            const d = derive(h);
            return (
              <label key={h.id} className="check-row gate-row">
                <input type="checkbox" checked={selected.includes(h.id)} onChange={() => toggle(h.id)} />
                <ClassSprite classId={h.classId} scale={2} />
                <span>
                  <b>{h.name}</b>{' '}
                  <span className="muted small">
                    L{h.level} {CLASSES[h.classId]?.name} · {Math.floor(h.hp)}/{d.maxHp} hp · carries{' '}
                    {Math.max(0, d.carryMax - d.carryUsed).toFixed(0)}kg spare
                    {h.injuries.length > 0 ? ` · ${h.injuries.length} injur${h.injuries.length > 1 ? 'ies' : 'y'}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="panel">
          <div className="panel-title">Descent</div>
          <div className="row">
            <span className="muted">Start at depth</span>
            <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
              {depths.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="muted small" style={{ margin: '6px 0' }}>
            Each hero packs up to 3 healing / 2 mana potions from the store shelf ({game.village.potions.hp} hp /{' '}
            {game.village.potions.mp} mp in stock). A downed hero ends the expedition — the others carry them home.
          </div>
          <button
            className="btn btn-primary wide"
            disabled={selected.length === 0}
            onClick={() => {
              app.dispatch({ t: 'EMBARK', memberIds: selected, startDepth: depth });
              setSelected([]);
            }}
          >
            ⚔ Descend!
          </button>
        </div>
      </div>
    </BuildingShell>
  );
}
