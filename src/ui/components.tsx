import { useEffect, useRef } from 'react';
import type { Hero, ItemInstance } from '../game/types';
import { ITEMS, PALETTE } from '../game/content';
import { GOD_PORTRAITS } from '../game/content/godPortraits';
import { derive } from '../game/hero/derive';
import { atlasDraw, getAtlas } from '../render/spriteCompiler';

/** A static 32×32 pixel portrait of a god, drawn from its palette-char grid.
 *  Pass `label` for an accessible name; without one it's hidden from screen
 *  readers (the god's name is rendered beside it in the picker). */
export function GodPortrait({ religionId, scale = 3, label }: { religionId: string; scale?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rows = GOD_PORTRAITS[religionId];
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !rows) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pal = PALETTE as Record<string, string>;
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        const hex = pal[row[x]!];
        if (!hex) continue; // '.' / unknown -> transparent
        ctx.fillStyle = hex;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }, [religionId, scale, rows]);
  const n = 32;
  return (
    <canvas
      ref={ref}
      width={n * scale}
      height={n * scale}
      className="god-portrait"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}

/** A label that reveals a styled pixel-box explanation on hover/focus — used for
 *  traits, perks and other quirks so the player learns what e.g. "Lone Wolf" means.
 *  On reveal it nudges itself left so a right-edge chip's popup stays on-screen. */
export function Hint({ label, text, className }: { label: string; text?: string; className?: string }) {
  const popRef = useRef<HTMLSpanElement>(null);
  if (!text) return <span className={className}>{label}</span>;
  const clamp = () => {
    const pop = popRef.current;
    if (!pop) return;
    pop.style.left = '0px';
    const overflow = pop.getBoundingClientRect().right - (window.innerWidth - 8);
    if (overflow > 0) pop.style.left = `${-overflow}px`;
  };
  return (
    <span className={`hint${className ? ' ' + className : ''}`} tabIndex={0} onMouseEnter={clamp} onFocus={clamp}>
      {label}
      <span ref={popRef} className="hint-pop" role="tooltip">
        {text}
      </span>
    </span>
  );
}

/** An animated pixel portrait of a class (idle bob, faces right). */
export function ClassSprite({ classId, scale = 4 }: { classId: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      atlasDraw(ctx, getAtlas(), `hero/${classId}`, frame, 0, 0, false, scale);
    };
    draw();
    const iv = setInterval(() => {
      frame = 1 - frame;
      draw();
    }, 450);
    return () => clearInterval(iv);
  }, [classId, scale]);
  return <canvas ref={ref} width={16 * scale} height={16 * scale} className="class-sprite" />;
}

export function Bar({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="bar" title={`${Math.floor(value)} / ${max}`}>
      <div className="bar-fill" style={{ width: `${frac * 100}%`, background: color }} />
      <span className="bar-label">
        {label ? `${label} ` : ''}
        {Math.floor(value)}/{max}
      </span>
    </div>
  );
}

/** humanized "what does it do" line; the flavor text stays charmingly vague */
export function describeItem(defId: string): string {
  const def = ITEMS[defId];
  if (!def) return '';
  const bits: string[] = [];
  if (def.base?.dmg) bits.push(`${def.base.dmg} dmg every ${((def.base.attackTicks ?? 12) / 10).toFixed(1)}s`);
  if (def.base?.range && def.base.range > 1) bits.push(`range ${def.base.range}`);
  if (def.base?.armor) bits.push(`${def.base.armor} armor`);
  if (def.base?.moveTicks) bits.push(`slows you down`);
  if (def.base?.stats) {
    for (const [k, v] of Object.entries(def.base.stats)) bits.push(`+${v} ${k}`);
  }
  if (def.potion) bits.push(`restores ${def.potion.amount} ${def.potion.kind === 'hp' ? 'health' : 'mana'}`);
  if (def.slot === 'junk') bits.push('worth a few coins to the right buyer');
  bits.push(`${def.weight}kg`);
  return bits.join(' · ');
}

const rarityColor: Record<string, string> = {
  common: '#b8b6cf',
  magic: '#4f7ad1',
  rare: '#f2c94c',
  epic: '#a14fd1',
};

export function itemLabel(item: ItemInstance): string {
  const def = ITEMS[item.defId];
  const affix = item.affixes[0];
  return `${def?.name ?? item.defId}${affix ? ` ${affix.name}` : ''}`;
}

export function ItemName({ item }: { item: ItemInstance }) {
  const def = ITEMS[item.defId];
  const stats: string[] = [];
  if (def?.base?.dmg) stats.push(`${def.base.dmg} dmg`);
  if (def?.base?.armor) stats.push(`${def.base.armor} armor`);
  if (def?.base?.stats) {
    for (const [k, v] of Object.entries(def.base.stats)) stats.push(`+${v} ${k}`);
  }
  for (const affix of item.affixes) {
    for (const mod of affix.mods) {
      if (mod.kind === 'attr') stats.push(`+${mod.add} ${mod.attr}`);
    }
  }
  if (def?.weight) stats.push(`${def.weight}kg`);
  const title = [def?.flavor, stats.join(', ')].filter(Boolean).join(' — ');
  return (
    <span className="item-name" style={{ color: rarityColor[item.rarity] }} title={title}>
      {itemLabel(item)}
      {stats.length > 0 && <span className="item-stats"> ({stats.join(', ')})</span>}
    </span>
  );
}

export function HeroVitals({ hero }: { hero: Hero }) {
  const d = derive(hero);
  return (
    <>
      <Bar value={hero.hp} max={d.maxHp} color="#4fae4f" label="HP" />
      <Bar value={hero.mp} max={d.maxMp} color="#4f7ad1" label="MP" />
    </>
  );
}
