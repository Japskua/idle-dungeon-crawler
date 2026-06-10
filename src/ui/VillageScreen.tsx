import { useState } from 'react';
import { app } from '../app/loop';
import { POTION_PRICES, healInjuryCost, instantHealCost } from '../game/balance';
import { CLASSES, INJURIES, ITEMS, PERKS } from '../game/content';
import { derive } from '../game/hero/derive';
import { effectiveHireCost, shopStock, tavernRecruits } from '../game/village/shop';
import type { GameState, Hero, Id } from '../game/types';
import { CombatLog } from './CombatLog';
import { HeroVitals, ItemName } from './components';
import { TacticsEditor } from './TacticsEditor';
import { useUi } from './store';

function HeroCard({ game, hero }: { game: GameState; hero: Hero }) {
  const d = derive(hero);
  const missing = Math.max(0, d.maxHp - Math.floor(hero.hp));
  const restCost = instantHealCost(missing);
  const [editingTactics, setEditingTactics] = useState(false);
  return (
    <div className="panel hero-card">
      <div className="panel-title">
        {hero.name} <span className="muted">— L{hero.level} {CLASSES[hero.classId]?.name}</span>
        <span className={`tag tag-${hero.activity}`}>{hero.activity}</span>
      </div>
      <HeroVitals hero={hero} />
      <div className="muted small">
        xp {hero.xp} · str {Math.floor(d.attrs.str)} dex {Math.floor(d.attrs.dex)} int {Math.floor(d.attrs.int)} vit{' '}
        {Math.floor(d.attrs.vit)} · dmg {d.weaponDmg} · armor {d.armor}
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
            </div>
          );
        })}
      </div>
      {hero.injuries.length > 0 && (
        <div className="small">
          <span className="muted">Injuries:</span>
          {hero.injuries.map((iid) => {
            const injury = INJURIES[iid];
            if (!injury) return null;
            const cost = healInjuryCost(injury.healCostBase, injury.severity, hero.level);
            return (
              <div key={iid} className="injury-row" title={injury.flavor}>
                <span className="tag tag-bad">{injury.name}</span>
                <button
                  className="btn btn-tiny"
                  disabled={game.village.gold < cost}
                  onClick={() => app.dispatch({ t: 'HEAL_INJURY', heroId: hero.id, injuryId: iid })}
                >
                  treat {cost}g
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="row">
        <span className="row-buttons">
          {missing > 0 && (
            <button
              className="btn btn-small"
              disabled={game.village.gold < restCost}
              onClick={() => app.dispatch({ t: 'REST_HERO', heroId: hero.id })}
            >
              Patch up ({restCost}g)
            </button>
          )}
          <button className="btn btn-small" onClick={() => setEditingTactics(true)}>
            Tactics
          </button>
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

function EmbarkPanel({ game }: { game: GameState }) {
  const [selected, setSelected] = useState<Id[]>([]);
  const [depth, setDepth] = useState(1);
  const candidates = game.rosterOrder
    .map((id) => game.roster[id]!)
    .filter((h) => h && h.activity !== 'party' && h.hp > 0);
  const depths = [1, ...game.progress.checkpoints].sort((a, b) => a - b);
  const toggle = (id: Id) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < 4 ? [...sel, id] : sel));
  return (
    <div className="panel embark">
      <div className="panel-title">⚔ Expedition (max 4)</div>
      {candidates.length === 0 && <div className="muted small">Nobody is fit to descend. Hire or heal heroes.</div>}
      {candidates.map((h) => (
        <label key={h.id} className="check-row">
          <input type="checkbox" checked={selected.includes(h.id)} onChange={() => toggle(h.id)} />
          {h.name} <span className="muted">L{h.level} {CLASSES[h.classId]?.name}</span>
        </label>
      ))}
      <div className="row">
        <label className="muted small">
          start at depth{' '}
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
            {depths.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-primary"
          disabled={selected.length === 0}
          onClick={() => {
            app.dispatch({ t: 'EMBARK', memberIds: selected, startDepth: depth });
            setSelected([]);
          }}
        >
          Descend!
        </button>
      </div>
    </div>
  );
}

function ShopPanel({ game }: { game: GameState }) {
  const stock = shopStock(game);
  return (
    <div className="panel">
      <div className="panel-title">🛒 Shop <span className="muted small">(rotates daily)</span></div>
      {stock.map((entry) => {
        const def = ITEMS[entry.defId]!;
        const bought = game.village.purchasedToday.includes(entry.key);
        return (
          <div key={entry.key} className="row">
            <span title={def.flavor}>{def.name}</span>
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
      <div className="row">
        <span>
          Healing potion <span className="muted small">(have {game.village.potions.hp})</span>
        </span>
        <button
          className="btn btn-small"
          disabled={game.village.gold < POTION_PRICES.hp}
          onClick={() => app.dispatch({ t: 'BUY_POTION', potion: 'hp', qty: 1 })}
        >
          {POTION_PRICES.hp}g
        </button>
      </div>
      <div className="row">
        <span>
          Mana potion <span className="muted small">(have {game.village.potions.mp})</span>
        </span>
        <button
          className="btn btn-small"
          disabled={game.village.gold < POTION_PRICES.mp}
          onClick={() => app.dispatch({ t: 'BUY_POTION', potion: 'mp', qty: 1 })}
        >
          {POTION_PRICES.mp}g
        </button>
      </div>
    </div>
  );
}

function TavernPanel({ game }: { game: GameState }) {
  const recruits = tavernRecruits(game);
  return (
    <div className="panel">
      <div className="panel-title">🍺 Tavern <span className="muted small">(new faces daily)</span></div>
      {recruits.map((r) => {
        const hired = game.village.hiredToday.includes(r.key);
        const cost = effectiveHireCost(game, r);
        return (
          <div key={r.key} className="recruit">
            <div>
              <b>{r.name}</b> <span className="muted">L{r.level} {CLASSES[r.classId]?.name}</span>
            </div>
            {r.perks.length > 0 && (
              <div className="small">
                {r.perks.map((pid) => {
                  const perk = PERKS[pid];
                  return (
                    <span key={pid} className={`tag tag-perk-${perk?.polarity}`} title={perk?.flavor}>
                      {perk?.name}
                    </span>
                  );
                })}
              </div>
            )}
            <button
              className="btn btn-small"
              disabled={hired || game.village.gold < cost}
              onClick={() => app.dispatch({ t: 'HIRE', recruitKey: r.key })}
            >
              {hired ? 'hired' : cost === 0 ? 'hire (free!)' : `hire ${cost}g`}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function InventoryPanel({ game }: { game: GameState }) {
  const heroes = game.rosterOrder.map((id) => game.roster[id]!).filter(Boolean);
  return (
    <div className="panel">
      <div className="panel-title">🎒 Storage ({game.village.inventory.length})</div>
      {game.village.inventory.length === 0 && <div className="muted small">Empty. The dungeon has more.</div>}
      {game.village.inventory.slice(0, 30).map((item) => {
        const def = ITEMS[item.defId]!;
        const equipable = ['weapon', 'offhand', 'armor', 'trinket'].includes(def.slot);
        return (
          <div key={item.id} className="row">
            <ItemName item={item} />
            <span className="row-buttons">
              {equipable && (
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
                  {heroes
                    .filter((h) => h.activity !== 'party')
                    .map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                </select>
              )}
              <button className="btn btn-tiny" onClick={() => app.dispatch({ t: 'SELL_ITEM', itemId: item.id })}>
                sell
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function VillageScreen() {
  useUi((s) => s.rev);
  const game = useUi((s) => s.game);
  if (!game) return null;
  return (
    <div className="village-screen">
      <div className="village-col">
        <EmbarkPanel game={game} />
        {game.rosterOrder.map((id) => {
          const hero = game.roster[id];
          return hero ? <HeroCard key={id} game={game} hero={hero} /> : null;
        })}
      </div>
      <div className="village-col">
        <ShopPanel game={game} />
        <TavernPanel game={game} />
        <InventoryPanel game={game} />
      </div>
      <div className="village-col">
        <div className="panel">
          <div className="panel-title">📜 Chronicle</div>
          <div className="chronicle">
            {game.chronicle.slice(-12).reverse().map((c, i) => (
              <div key={i} className="log-line log-info">
                {c.text}
              </div>
            ))}
          </div>
        </div>
        <div className="panel grow">
          <div className="panel-title">Log</div>
          <CombatLog />
        </div>
      </div>
    </div>
  );
}
