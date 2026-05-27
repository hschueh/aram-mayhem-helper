import { chromium, Browser, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface RawChampion {
  key: string;           // e.g. "brand"
  name: string;          // localized name
  image_url: string;
  id: number;
  tier: number;          // 1=S 2=A 3=B 4=C 5=D
  rank: number;
}

interface RawAugment {
  id: number;
  name: string;
  key: string;
  tier: number;
  performance: number;
  popular: number;
  rarity: number;
  desc?: string;
  largeIcon?: string;
}

interface ChampionAugmentData {
  championKey: string;
  augments: RawAugment[];
}

// ── Abilities + build (from /build page) ──
interface Ability {
  name: string;
  desc: string;
  image: string;
}
interface Spell extends Ability {
  key: string; // Q / W / E / R
}
interface AbilitiesData {
  passive: Ability;
  spells: Spell[];
}
interface BuildItems {
  starter: string[][];
  boots: string[][];
  core: string[][];
}
interface BuildData {
  summonerSpells: string[][];
  skillOrderNames: string[];
  items: BuildItems;
}
interface ChampionBuildData {
  championKey: string;
  abilities: AbilitiesData | null;
  build: BuildData | null;
}

// ──────────────────────────────────────────────
// Tier labels
// ──────────────────────────────────────────────

// Champion tier: SVG fill #0093FF=S, #00BBA3=A, #FFB900=B, #9AA4AF=C, #A88A67=D
const CHAMP_TIER: Record<number, string> = { 1: 'S', 2: 'A', 3: 'B', 4: 'C', 5: 'D' };

// Augment tier per champion: SVG fill rainbow=S(0), #EB9C00=A(1), #9AA4AF=B(2), #907659=C(3), #676678=D(4), #424254=E(5)
// E = universal augments (not champion-specific synergy but can still perform well)
const AUG_TIER: Record<number, string> = { 0: 'S', 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' };

const champTierLabel = (t: number) => CHAMP_TIER[t] ?? String(t);
const augTierLabel   = (t: number) => AUG_TIER[t]   ?? String(t);

// ──────────────────────────────────────────────
// Browser context factory
// ──────────────────────────────────────────────

function makeContext(browser: Browser, locale: string): Promise<BrowserContext> {
  return browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale,
  }).then(async (ctx) => {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    return ctx;
  });
}

// ──────────────────────────────────────────────
// Parse __next_f scripts
// ──────────────────────────────────────────────

function parseNextF(scripts: string[]): { champions: RawChampion[]; augments: RawAugment[] } {
  let champions: RawChampion[] = [];
  let augments: RawAugment[] = [];

  for (const script of scripts) {
    const match = script.match(/self\.__next_f\.push\(\[1,"([\s\S]+?)"\]\)\s*$/);
    if (!match) continue;

    let raw: string;
    try { raw = JSON.parse(`"${match[1]}"`); } catch { continue; }

    // Champions: array with {key, name, tier, rank}
    if (champions.length === 0) {
      const idx = raw.indexOf('"champions":[{"key"');
      if (idx !== -1) {
        try {
          const start = raw.indexOf('[', idx + '"champions":'.length);
          const extracted = extractJsonArray(raw, start);
          const arr = JSON.parse(extracted);
          if (Array.isArray(arr) && arr.length > 10 && arr[0]?.key && arr[0]?.tier !== undefined) {
            champions = arr as RawChampion[];
          }
        } catch { /* skip */ }
      }
    }

    // Augments on main page: "data":[{id, tier, performance, popular, champion_ids, ...}]
    if (augments.length === 0) {
      const idx = raw.indexOf('"data":[{"id"');
      if (idx !== -1) {
        try {
          const start = raw.indexOf('[', idx + '"data":'.length);
          const extracted = extractJsonArray(raw, start);
          const arr = JSON.parse(extracted);
          if (Array.isArray(arr) && arr.length > 5 && arr[0]?.champion_ids) {
            augments = arr as RawAugment[];
          }
        } catch { /* skip */ }
      }
    }

    if (champions.length > 0 && augments.length > 0) break;
  }

  return { champions, augments };
}

/** Parse __next_f scripts from champion /augments page */
function parseChampionAugments(scripts: string[]): RawAugment[] {
  for (const script of scripts) {
    const match = script.match(/self\.__next_f\.push\(\[1,"([\s\S]+?)"\]\)\s*$/);
    if (!match) continue;

    let raw: string;
    try { raw = JSON.parse(`"${match[1]}"`); } catch { continue; }

    // Champion augments: "data":[{id, tier, performance, popular, name, key, ...}]
    const idx = raw.indexOf('"data":[{"id"');
    if (idx !== -1) {
      try {
        const start = raw.indexOf('[', idx + '"data":'.length);
        const extracted = extractJsonArray(raw, start);
        const arr = JSON.parse(extracted);
        if (Array.isArray(arr) && arr.length > 0 && arr[0]?.name && arr[0]?.tier !== undefined && !arr[0]?.champion_ids) {
          return arr as RawAugment[];
        }
      } catch { /* skip */ }
    }
  }
  return [];
}

function extractJsonArray(str: string, start: number): string {
  let depth = 0, end = start;
  for (let i = start; i < str.length; i++) {
    if (str[i] === '[' || str[i] === '{') depth++;
    else if (str[i] === ']' || str[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return str.slice(start, end + 1);
}

/** Parse champion abilities (passive + Q/W/E/R) from /build page __next_f scripts.
 *  The payload embeds a clean object: {"passive":{name,description,image_url},"data":[{key,name,description,image_url}]} */
function parseAbilities(scripts: string[]): AbilitiesData | null {
  for (const script of scripts) {
    const match = script.match(/self\.__next_f\.push\(\[1,"([\s\S]+?)"\]\)\s*$/);
    if (!match) continue;

    let raw: string;
    try { raw = JSON.parse(`"${match[1]}"`); } catch { continue; }

    const pIdx = raw.indexOf('"passive":{"name"');
    if (pIdx === -1) continue;

    // The enclosing object opens with the '{' immediately before "passive".
    const objStart = raw.lastIndexOf('{', pIdx);
    if (objStart === -1) continue;
    try {
      const obj = JSON.parse(extractJsonArray(raw, objStart));
      if (!obj?.passive?.name || !Array.isArray(obj.data)) continue;
      return {
        passive: {
          name: obj.passive.name,
          desc: (obj.passive.description ?? '').trim(),
          image: obj.passive.image_url ?? '',
        },
        spells: obj.data
          .filter((s: any) => s?.key && s?.name)
          .map((s: any) => ({
            key: s.key,
            name: s.name,
            desc: (s.description ?? '').trim(),
            image: s.image_url ?? '',
          })),
      };
    } catch { continue; }
  }
  return null;
}

/** Dedupe rows (op.gg renders responsive duplicate tables) while preserving order. */
function dedupeRows(rows: string[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const r of rows) {
    if (!r.length) continue;
    const k = r.join('|');
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}

function normalizeBuild(raw: {
  spells: string[][]; skill: string[][]; starter: string[][]; boots: string[][]; core: string[][];
}): BuildData | null {
  const skillRows = dedupeRows(raw.skill);
  const build: BuildData = {
    summonerSpells: dedupeRows(raw.spells),
    skillOrderNames: skillRows[0] ?? [],
    items: {
      starter: dedupeRows(raw.starter),
      boots: dedupeRows(raw.boots),
      core: dedupeRows(raw.core),
    },
  };
  // If we got essentially nothing, treat as missing.
  const hasAny =
    build.summonerSpells.length || build.skillOrderNames.length ||
    build.items.starter.length || build.items.boots.length || build.items.core.length;
  return hasAny ? build : null;
}

// ──────────────────────────────────────────────
// Fetch helpers
// ──────────────────────────────────────────────

async function fetchScripts(context: BrowserContext, url: string): Promise<string[]> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait until table rows are real (not skeletons). The augment page renders a
    // table of augments; if we grab scripts before hydration we get an empty parse.
    await page.waitForFunction(
      () => {
        const rows = document.querySelectorAll('table tbody tr');
        return rows.length > 0 && !(rows[0] as HTMLElement).querySelector?.('.animate-pulse');
      },
      { timeout: 25000 }
    ).catch(() => { /* fall through; parser will surface the failure */ });
    await page.waitForTimeout(1500);
    return await page.evaluate(() =>
      Array.from(document.querySelectorAll('script'))
        .map((s) => (s as HTMLScriptElement).innerText)
        .filter((t) => t.includes('__next_f'))
    );
  } finally {
    await page.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch a champion's /build page and extract abilities (from payload) + build (from DOM). */
async function fetchBuildPage(
  context: BrowserContext,
  key: string
): Promise<{ abilities: AbilitiesData | null; build: BuildData | null }> {
  const url = `https://op.gg/zh-tw/lol/modes/aram-mayhem/${key}/build`;
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait until the build tables (skill order / core build) have rendered.
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('table tr')).some((tr) =>
          /核心組建|技能順序/.test(tr.textContent || '')
        ),
      { timeout: 25000 }
    ).catch(() => { /* fall through; parser will surface the failure */ });
    await page.waitForTimeout(1200);

    // 1) Abilities from __next_f payload
    const scripts: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script'))
        .map((s) => (s as HTMLScriptElement).innerText)
        .filter((t) => t.includes('__next_f'))
    );
    const abilities = parseAbilities(scripts);

    // 2) Build (spells / skill order / items) from the rendered tables.
    //    Each section is a <table> whose first row is a localized label; data
    //    rows contain item/spell icons whose alt text is the localized name.
    const rawBuild = await page.evaluate(() => {
      const buckets: Record<string, string[][]> = {
        spells: [], skill: [], starter: [], boots: [], core: [],
      };
      for (const table of Array.from(document.querySelectorAll('table'))) {
        const trs = Array.from(table.querySelectorAll('tr'));
        if (!trs.length) continue;
        const label = (trs[0].textContent || '').trim();
        let bucket: keyof typeof buckets | null = null;
        if (label.includes('召喚師技能')) bucket = 'spells';
        else if (label.includes('技能順序')) bucket = 'skill';
        else if (label.includes('起始裝備')) bucket = 'starter';
        else if (label.includes('鞋子')) bucket = 'boots';
        else if (label.includes('核心')) bucket = 'core';
        else continue;
        for (const tr of trs) {
          const alts = Array.from(tr.querySelectorAll('img'))
            .map((im) => (im as HTMLImageElement).alt)
            .filter(Boolean);
          if (alts.length) buckets[bucket].push(alts);
        }
      }
      return buckets as { spells: string[][]; skill: string[][]; starter: string[][]; boots: string[][]; core: string[][] };
    });
    const build = normalizeBuild(rawBuild);

    return { abilities, build };
  } finally {
    await page.close();
  }
}

async function fetchMainPage(
  context: BrowserContext,
  locale: string
): Promise<{ champions: RawChampion[]; augments: RawAugment[] }> {
  const base = locale === 'en' ? 'https://op.gg/lol/modes/aram-mayhem' : `https://op.gg/${locale}/lol/modes/aram-mayhem`;
  console.log(`  [${locale}] Loading main page...`);
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait until champion table rows are real (not skeletons)
    await page.waitForFunction(
      () => {
        const rows = document.querySelectorAll('table tbody tr');
        return rows.length > 0 && !(rows[0] as HTMLElement).querySelector?.('.animate-pulse');
      },
      { timeout: 20000 }
    ).catch(() => { /* may timeout on slow load */ });
    await page.waitForTimeout(2000);
    const scripts: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script'))
        .map((s) => (s as HTMLScriptElement).innerText)
        .filter((t) => t.includes('__next_f'))
    );
    return parseNextF(scripts);
  } finally {
    await page.close();
  }
}

// Concurrency helper
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function scrape() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });

  try {
    // ── Step 1: Load main pages (zh-tw + en) ──
    console.log('\n[Step 1] Loading main ARAM Mayhem pages...');
    const [ctxZh, ctxEn] = await Promise.all([
      makeContext(browser, 'zh-TW'),
      makeContext(browser, 'en-US'),
    ]);

    const [zhMain, enMain] = await Promise.all([
      fetchMainPage(ctxZh, 'zh-tw'),
      fetchMainPage(ctxEn, 'en'),
    ]);

    if (zhMain.champions.length === 0) throw new Error('Failed to get zh champion list');
    if (enMain.champions.length === 0) throw new Error('Failed to get en champion list');

    console.log(`  zh: ${zhMain.champions.length} champions, ${zhMain.augments.length} augments`);
    console.log(`  en: ${enMain.champions.length} champions, ${enMain.augments.length} augments`);

    // Build lookup maps
    const zhChampByKey = new Map(zhMain.champions.map((c) => [c.key, c]));
    const enChampByKey = new Map(enMain.champions.map((c) => [c.key, c]));
    const enAugById    = new Map(enMain.augments.map((a) => [a.id, a]));
    const zhAugById    = new Map(zhMain.augments.map((a) => [a.id, a]));

    // ── Step 2: Load each champion's /augments page ──
    console.log(`\n[Step 2] Loading augment pages for ${zhMain.champions.length} champions (concurrency=10)...`);

    let champKeys = zhMain.champions.map((c) => c.key);
    // Dev hook: SCRAPE_LIMIT=N processes only the first N champions (faster iteration).
    if (process.env.SCRAPE_LIMIT) {
      const n = Number(process.env.SCRAPE_LIMIT);
      champKeys = champKeys.slice(0, n);
      console.log(`  [SCRAPE_LIMIT] restricted to ${champKeys.length} champions: ${champKeys.join(', ')}`);
    }

    const MAX_ATTEMPTS = 4;
    const champAugResults: ChampionAugmentData[] = await mapConcurrent(
      champKeys,
      5,
      async (key, idx) => {
        const url = `https://op.gg/zh-tw/lol/modes/aram-mayhem/${key}/augments`;
        let lastErr = '';
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const scripts = await fetchScripts(ctxZh, url);
            const augments = parseChampionAugments(scripts);
            if (augments.length > 0) {
              process.stdout.write(`\r  Progress: ${idx + 1}/${champKeys.length} (${key.padEnd(16)})    `);
              return { championKey: key, augments };
            }
            lastErr = 'empty parse';
          } catch (e) {
            lastErr = (e as Error).message.slice(0, 60);
          }
          // Backoff before retry: 2s, 5s, 10s
          if (attempt < MAX_ATTEMPTS) {
            const backoff = [2000, 5000, 10000][attempt - 1];
            process.stdout.write(`\r  [retry ${attempt}/${MAX_ATTEMPTS - 1}] ${key} (${lastErr}), waiting ${backoff}ms\n`);
            await sleep(backoff);
          }
        }
        process.stdout.write(`\r  [WARN] Gave up on ${key} after ${MAX_ATTEMPTS} attempts: ${lastErr}\n`);
        return { championKey: key, augments: [] };
      }
    );
    console.log('\n  Done.');

    // ── Step 2b: Load each champion's /build page (abilities + item/skill build) ──
    console.log(`\n[Step 2b] Loading build pages for ${champKeys.length} champions (concurrency=5)...`);

    const champBuildResults: ChampionBuildData[] = await mapConcurrent(
      champKeys,
      5,
      async (key, idx) => {
        let lastErr = '';
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const { abilities, build } = await fetchBuildPage(ctxZh, key);
            if (abilities || build) {
              process.stdout.write(`\r  Progress: ${idx + 1}/${champKeys.length} (${key.padEnd(16)})    `);
              return { championKey: key, abilities, build };
            }
            lastErr = 'empty parse';
          } catch (e) {
            lastErr = (e as Error).message.slice(0, 60);
          }
          if (attempt < MAX_ATTEMPTS) {
            const backoff = [2000, 5000, 10000][attempt - 1];
            process.stdout.write(`\r  [retry ${attempt}/${MAX_ATTEMPTS - 1}] ${key} build (${lastErr}), waiting ${backoff}ms\n`);
            await sleep(backoff);
          }
        }
        process.stdout.write(`\r  [WARN] Gave up on ${key} build after ${MAX_ATTEMPTS} attempts: ${lastErr}\n`);
        return { championKey: key, abilities: null, build: null };
      }
    );
    console.log('\n  Done.');

    await ctxZh.close();
    await ctxEn.close();

    // ── Step 3: Build final output ──
    console.log('\n[Step 3] Building output...');

    const isTest = !!process.env.SCRAPE_LIMIT;
    const limitSet = isTest ? new Set(champKeys) : null;
    const sortedChampions = [...zhMain.champions]
      .sort((a, b) => a.rank - b.rank)
      .filter((c) => !limitSet || limitSet.has(c.key));

    const output = {
      scrapedAt: new Date().toISOString(),

      // Champion tier list
      champions: sortedChampions.map((zh) => {
        const en = enChampByKey.get(zh.key);
        const augResult = champAugResults.find((r) => r.championKey === zh.key);
        const augments = (augResult?.augments ?? [])
          .sort((a, b) => a.tier !== b.tier ? a.tier - b.tier : b.performance - a.performance)
          .map((aug) => {
            const enAug = enAugById.get(aug.id);
            const zhAug = zhAugById.get(aug.id);
            return {
              id: aug.id,
              key: aug.key,
              nameZh: aug.name,
              nameEn: enAug?.name ?? aug.key,
              tier: augTierLabel(aug.tier),
              tierRaw: aug.tier,
              performance: aug.performance,
              popular: aug.popular,
              desc: aug.desc?.replace(/<[^>]+>/g, '') ?? zhAug?.desc?.replace(/<[^>]+>/g, '') ?? '',
            };
          });

        const buildResult = champBuildResults.find((r) => r.championKey === zh.key);
        const abilities = buildResult?.abilities ?? null;
        const rawBuild = buildResult?.build ?? null;

        // Derive skill leveling priority (keys) from the ability names op.gg shows.
        const nameToKey = new Map((abilities?.spells ?? []).map((s) => [s.name, s.key]));
        const build = rawBuild
          ? {
              summonerSpells: rawBuild.summonerSpells,
              skillOrder: rawBuild.skillOrderNames.map((n) => nameToKey.get(n) ?? '?'),
              skillOrderNames: rawBuild.skillOrderNames,
              items: rawBuild.items,
            }
          : null;

        return {
          rank: zh.rank,
          key: zh.key,
          nameZh: zh.name,
          nameEn: en?.name ?? zh.key,
          tier: champTierLabel(zh.tier),
          tierRaw: zh.tier,
          augments,
          abilities,
          build,
        };
      }),
    };

    // ── Save JSON ──
    const outPath = path.join(__dirname, isTest ? 'aram-mayhem-data.test.json' : 'aram-mayhem-data.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\nSaved JSON → ${outPath}`);

    // ── Write Champions.md ──
    const mdDir = path.join(__dirname, isTest ? 'champions-test' : 'champions');
    fs.mkdirSync(mdDir, { recursive: true });

    const tierGroups: Record<string, typeof output.champions> = { S: [], A: [], B: [], C: [], D: [] };
    for (const c of output.champions) {
      (tierGroups[c.tier] ??= []).push(c);
    }

    let champsMd = `# ARAM: 大亂鬥 英雄強度 (Champions)\n\n`;
    champsMd += `> 更新時間: ${output.scrapedAt}\n\n`;
    for (const tier of ['S', 'A', 'B', 'C', 'D']) {
      const group = tierGroups[tier] ?? [];
      if (!group.length) continue;
      champsMd += `## ${tier} 階\n\n`;
      champsMd += `| 排名 | 英雄 (中) | Champion (EN) | Key |\n`;
      champsMd += `|------|-----------|---------------|-----|\n`;
      for (const c of group) {
        champsMd += `| #${c.rank} | ${c.nameZh} | ${c.nameEn} | [${c.key}](./champions/${c.key}.md) |\n`;
      }
      champsMd += '\n';
    }
    if (!isTest) {
      fs.writeFileSync(path.join(__dirname, 'Champions.md'), champsMd, 'utf-8');
      console.log('Saved Champions.md');
    }

    // ── Write individual {key}.md files ──
    for (const c of output.champions) {
      let md = `# ${c.nameZh} / ${c.nameEn}\n\n`;
      md += `**模式**: ARAM: 大亂鬥  \n`;
      md += `**強度**: ${c.tier} 階 (排名 #${c.rank})  \n`;
      md += `**更新時間**: ${output.scrapedAt}\n\n`;

      if (c.augments.length > 0) {
        md += `## 推薦增強 / Recommended Augments\n\n`;
        md += `| 評級 | 增強 (中) | Augment (EN) | 分數 | 選用率 |\n`;
        md += `|------|-----------|--------------|------|--------|\n`;
        for (const aug of c.augments) {
          md += `| ${aug.tier} | ${aug.nameZh} | ${aug.nameEn} | ${aug.performance.toFixed(1)} | ${aug.popular.toFixed(1)}% |\n`;
        }
      } else {
        md += `> 無增強資料\n`;
      }

      // ── 出裝 & 加點 ──
      if (c.build) {
        md += `\n## 出裝 & 加點 / Build\n\n`;
        if (c.build.summonerSpells.length) {
          const opts = c.build.summonerSpells.map((s) => s.join(' + ')).join(' ／ ');
          md += `**召喚師技能**: ${opts}  \n`;
        }
        if (c.build.skillOrder.length) {
          const order = c.build.skillOrder
            .map((k, i) => `${k}${c.build!.skillOrderNames[i] ? `（${c.build!.skillOrderNames[i]}）` : ''}`)
            .join(' > ');
          md += `**技能加點 (主修順序)**: ${order}  \n`;
        }
        if (c.build.items.starter.length) {
          md += `**起始裝備**: ${c.build.items.starter.map((r) => r.join(' + ')).join(' ／ ')}  \n`;
        }
        if (c.build.items.boots.length) {
          md += `**鞋子**: ${c.build.items.boots.map((r) => r.join('')).join(' ／ ')}  \n`;
        }
        if (c.build.items.core.length) {
          md += `\n**核心組建**:\n`;
          c.build.items.core.forEach((path, i) => {
            md += `${i + 1}. ${path.join(' → ')}\n`;
          });
        }
      }

      // ── 技能說明 ──
      if (c.abilities) {
        md += `\n## 技能說明 / Abilities\n\n`;
        md += `**被動 — ${c.abilities.passive.name}**: ${c.abilities.passive.desc}\n\n`;
        if (c.abilities.spells.length) {
          md += `| 鍵 | 技能 | 說明 |\n`;
          md += `|----|------|------|\n`;
          for (const s of c.abilities.spells) {
            const desc = s.desc.replace(/\n/g, ' ').replace(/\|/g, '\\|');
            md += `| ${s.key} | ${s.name} | ${desc} |\n`;
          }
        }
      }

      fs.writeFileSync(path.join(mdDir, `${c.key}.md`), md, 'utf-8');
    }
    console.log(`Saved ${output.champions.length} champion files → champions/`);

    // ── Print summary ──
    console.log('\n' + '='.repeat(60));
    console.log('CHAMPION TIER LIST (Top 20)');
    console.log('='.repeat(60));
    for (const c of output.champions.slice(0, 20)) {
      console.log(`  [${c.tier}] #${String(c.rank).padStart(3)} ${c.nameZh} / ${c.nameEn}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('SAMPLE: 布蘭德 (Brand) TOP AUGMENTS');
    console.log('='.repeat(60));
    const brand = output.champions.find((c) => c.key === 'brand');
    if (brand) {
      for (const aug of brand.augments.slice(0, 10)) {
        console.log(`  [${aug.tier}] ${aug.nameZh.padEnd(12)} / ${aug.nameEn.padEnd(20)}  score: ${aug.performance.toFixed(1)}`);
      }
    }

    console.log(`\nTotal: ${output.champions.length} champions`);
    const withAugs = output.champions.filter((c) => c.augments.length > 0).length;
    console.log(`Champions with augment data: ${withAugs}`);
    const withAbilities = output.champions.filter((c) => c.abilities).length;
    const withBuild = output.champions.filter((c) => c.build).length;
    console.log(`Champions with ability data:  ${withAbilities}`);
    console.log(`Champions with build data:    ${withBuild}`);

    // ── Sync JSON into the frontend (page.tsx imports ../aram-mayhem-data.json) ──
    const frontendJson = path.join(__dirname, 'frontend', 'aram-mayhem-data.json');
    if (!isTest && fs.existsSync(path.dirname(frontendJson))) {
      fs.copyFileSync(outPath, frontendJson);
      console.log(`Synced JSON → ${frontendJson}`);
    }

  } finally {
    await browser.close();
  }
}

scrape().catch((err) => {
  console.error(err);
  process.exit(1);
});
