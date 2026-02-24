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

// ──────────────────────────────────────────────
// Fetch helpers
// ──────────────────────────────────────────────

async function fetchScripts(context: BrowserContext, url: string): Promise<string[]> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    return await page.evaluate(() =>
      Array.from(document.querySelectorAll('script'))
        .map((s) => (s as HTMLScriptElement).innerText)
        .filter((t) => t.includes('__next_f'))
    );
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

    const champKeys = zhMain.champions.map((c) => c.key);

    const champAugResults: ChampionAugmentData[] = await mapConcurrent(
      champKeys,
      10,
      async (key, idx) => {
        const url = `https://op.gg/zh-tw/lol/modes/aram-mayhem/${key}/augments`;
        try {
          const scripts = await fetchScripts(ctxZh, url);
          const augments = parseChampionAugments(scripts);
          process.stdout.write(`\r  Progress: ${idx + 1}/${champKeys.length} (${key.padEnd(16)})    `);
          return { championKey: key, augments };
        } catch (e) {
          process.stdout.write(`\r  [WARN] Failed ${key}: ${(e as Error).message.slice(0, 40)}\n`);
          return { championKey: key, augments: [] };
        }
      }
    );
    console.log('\n  Done.');

    await ctxZh.close();
    await ctxEn.close();

    // ── Step 3: Build final output ──
    console.log('\n[Step 3] Building output...');

    const sortedChampions = [...zhMain.champions].sort((a, b) => a.rank - b.rank);

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

        return {
          rank: zh.rank,
          key: zh.key,
          nameZh: zh.name,
          nameEn: en?.name ?? zh.key,
          tier: champTierLabel(zh.tier),
          tierRaw: zh.tier,
          augments,
        };
      }),
    };

    // ── Save JSON ──
    const outPath = path.join(__dirname, 'aram-mayhem-data.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\nSaved JSON → ${outPath}`);

    // ── Write Champions.md ──
    const mdDir = path.join(__dirname, 'champions');
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
    fs.writeFileSync(path.join(__dirname, 'Champions.md'), champsMd, 'utf-8');
    console.log('Saved Champions.md');

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

  } finally {
    await browser.close();
  }
}

scrape().catch((err) => {
  console.error(err);
  process.exit(1);
});
