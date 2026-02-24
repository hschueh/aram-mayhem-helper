"use client";

import { useState, useEffect, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Augment = {
  id: number;
  key: string;
  nameZh: string;
  nameEn: string;
  tier: string;
  performance: number;
};

type Champion = {
  rank: number;
  key: string;
  nameZh: string;
  nameEn: string;
  tier: string;
  augments: Augment[];
};

type RoundRecord = {
  roundNumber: number;
  options: Augment[];
  picked: Augment;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const TIER_ORD: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };

const TIER_STYLE: Record<string, { background: string; color: string }> = {
  S: { background: "#ff4757", color: "#fff" },
  A: { background: "#ffa502", color: "#000" },
  B: { background: "#2ed573", color: "#000" },
  C: { background: "#1e90ff", color: "#fff" },
  D: { background: "#a29bfe", color: "#000" },
  E: { background: "#636e72", color: "#fff" },
};

// ─── Bond data ────────────────────────────────────────────────────────────────
type BondThreshold = { count: number; effect: string };
type BondDef = { thresholds: BondThreshold[]; members: string[] };

const BONDS: Record<string, BondDef> = {
  喪鐘: {
    members: ["小丑學院", "死亡列車", "自我毀滅", "自爆炸彈客"],
    thresholds: [{ count: 2, effect: "復活倒數時間縮短 40%" }],
  },
  烈焰爆竹: {
    members: ["旋風鎚", "魔法導彈", "暴擊沖天炮", "點火", "颱風", "雙響炮"],
    thresholds: [
      { count: 2, effect: "技能彈跳 2 次，造成 40% 原傷害" },
      { count: 4, effect: "技能彈跳 3 次，造成 80% 原傷害" },
    ],
  },
  土豪賭客: {
    members: ["質變：大混亂", "潘朵拉的寶盒", "能力值堆堆堆起來！", "質變：稜鏡", "質變：金級"],
    thresholds: [
      { count: 2, effect: "士兵死亡時有機會掉落能力值鐵砧" },
      { count: 3, effect: "獲得金級或稜鏡鐵砧的機率 +50%" },
      { count: 4, effect: "獲得金級或稜鏡鐵砧的機率再 +50%" },
    ],
  },
  堆層暴龍: {
    members: ["無限循環", "雙修大師", "輕舞飛揚", "食魂者", "任務：鋼鐵雄心", "極度邪惡", "縮小引擎", "傲慢", "痛打一頓"],
    thresholds: [
      { count: 2, effect: "堆層獲得量 +50%" },
      { count: 3, effect: "堆層獲得量 +100%" },
      { count: 4, effect: "堆層獲得量 +200%" },
    ],
  },
  嗚咿嗚咿: {
    members: ["風語者的祝福", "我是小貓咪媽咪在哪裡", "升級：米凱的祝福", "全部都給你", "暴擊治療", "奏鳴曲", "急救箱"],
    thresholds: [
      { count: 2, effect: "移速 +40%、治療與護盾 +25%" },
      { count: 3, effect: "移速 +50%、治療與護盾 +35%" },
      { count: 4, effect: "移速 +60%、治療與護盾 +45%" },
    ],
  },
  全自動: {
    members: ["舞會皇后", "量子計算", "棒棒回力鏢", "奏鳴曲", "聖光顯靈", "自我毀滅", "寒霜幽魂", "火狐"],
    thresholds: [
      { count: 2, effect: "自動施放冷卻時間縮短 30%" },
      { count: 3, effect: "自動施放冷卻時間受益於技能加速" },
    ],
  },
  大法師: {
    members: ["溢流", "因心成體", "增益麻吉", "強化攻擊", "癒水龍魂"],
    thresholds: [{ count: 2, effect: "施展技能時返還 40% 隨機技能的冷卻時間" }],
  },
  錢如雨下: {
    members: ["黃金撕裂", "小心杯子蛋糕！", "斗內", "紅包", "自始至終", "升級獻祭", "升級收藏家"],
    thresholds: [
      { count: 2, effect: "透過增幅裝置和擊殺獲得的金錢 +25%" },
      { count: 3, effect: "透過增幅裝置和擊殺獲得的金錢 +50%" },
      { count: 4, effect: "透過增幅裝置和擊殺獲得的金錢 +100%" },
    ],
  },
  降雪之日: {
    members: ["巨無霸雪球", "黃金雪球", "雪球升級", "雪球彈珠台", "雪球輪盤"],
    thresholds: [
      { count: 2, effect: "雪球技能加速 +50、額外傷害 +30%" },
      { count: 3, effect: "雪球技能加速 +100、額外傷害 +50%" },
      { count: 4, effect: "雪球技能加速 +150、額外傷害 +100%" },
    ],
  },
};

// ─── Bond utilities ───────────────────────────────────────────────────────────
type ActiveBond = {
  bondName: string;
  count: number;
  activeThreshold: BondThreshold | undefined;
  nextThreshold: BondThreshold | undefined;
};

function getActiveBonds(picked: Augment[]): ActiveBond[] {
  const names = new Set(picked.map((a) => a.nameZh));
  return Object.entries(BONDS).flatMap(([bondName, def]) => {
    const count = def.members.filter((m) => names.has(m)).length;
    if (count === 0) return [];
    const activeThreshold = [...def.thresholds].reverse().find((t) => count >= t.count);
    const nextThreshold = def.thresholds.find((t) => count < t.count);
    return [{ bondName, count, activeThreshold, nextThreshold }];
  });
}

type BondBonus = { bondName: string; newCount: number; effect: string };

function getBondBonus(option: Augment, picked: Augment[]): BondBonus | null {
  const names = new Set(picked.map((a) => a.nameZh));
  for (const [bondName, def] of Object.entries(BONDS)) {
    if (!def.members.includes(option.nameZh)) continue;
    const currentCount = def.members.filter((m) => names.has(m)).length;
    const newCount = currentCount + 1;
    const newThresh = [...def.thresholds].filter((t) => newCount >= t.count).pop();
    const oldThresh = [...def.thresholds].filter((t) => currentCount >= t.count).pop();
    if (newThresh && newThresh !== oldThresh) {
      return { bondName, newCount, effect: newThresh.effect };
    }
  }
  return null;
}

// ─── Decision logic ───────────────────────────────────────────────────────────
type DecideResult = {
  sorted: Augment[];
  best: Augment;
  rest: Augment[];
  eHighScore: boolean;
  closeCall: boolean;
  bigGap: boolean;
  bondBonuses: Map<string, BondBonus | null>;
};

function decide(augs: Augment[], pickedSoFar: Augment[]): DecideResult {
  const sorted = [...augs].sort((a, b) => {
    const d = TIER_ORD[a.tier] - TIER_ORD[b.tier];
    return d !== 0 ? d : b.performance - a.performance;
  });
  const best = sorted[0];
  const rest = sorted.slice(1);
  const eHighScore = best.tier === "E" && best.performance > 100;
  const closeCall =
    rest.length > 0 &&
    rest[0].tier === best.tier &&
    Math.abs(best.performance - rest[0].performance) <= 5;
  const bigGap =
    rest.length > 0 && TIER_ORD[rest[0].tier] - TIER_ORD[best.tier] >= 2;
  const bondBonuses = new Map(augs.map((a) => [a.nameZh, getBondBonus(a, pickedSoFar)]));
  return { sorted, best, rest, eHighScore, closeCall, bigGap, bondBonuses };
}

// ─── Small shared components ──────────────────────────────────────────────────
function TierBadge({ tier }: { tier: string }) {
  const s = TIER_STYLE[tier] ?? { background: "#636e72", color: "#fff" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 4,
        fontWeight: 700,
        fontSize: 12,
        flexShrink: 0,
        ...s,
      }}
    >
      {tier}
    </span>
  );
}

// ─── Champion search dropdown ─────────────────────────────────────────────────
function ChampionSearch({
  champions,
  value,
  onChange,
  onSelect,
  placeholder,
}: {
  champions: Champion[];
  value: string;
  onChange: (v: string) => void;
  onSelect: (c: Champion) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  const results = value.trim()
    ? champions
        .filter(
          (c) =>
            (c.nameZh ?? "").includes(value) ||
            (c.nameEn ?? "").toLowerCase().includes(value.toLowerCase()) ||
            (c.key ?? "").toLowerCase().includes(value.toLowerCase())
        )
        .slice(0, 8)
    : [];

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        style={inputStyle}
      />
      {open && results.length > 0 && (
        <div style={dropdownStyle}>
          {results.map((c) => (
            <div
              key={c.key}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(c);
                setOpen(false);
              }}
              style={dropItemStyle}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLDivElement).style.background = "var(--sf2)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLDivElement).style.background = "transparent")
              }
            >
              <TierBadge tier={c.tier} />
              <div>
                <div style={{ fontWeight: 600 }}>{c.nameZh}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {c.nameEn} · #{c.rank}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Augment slot input ───────────────────────────────────────────────────────
function AugmentInput({
  champion,
  selected,
  onSelect,
  placeholder,
}: {
  champion: Champion;
  selected: Augment | null;
  onSelect: (a: Augment | null) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState(selected?.nameZh ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(selected?.nameZh ?? "");
  }, [selected, champion]);

  const results = open
    ? query.trim() && !selected
      ? champion.augments
          .filter(
            (a) =>
              (a.nameZh ?? "").includes(query) ||
              (a.nameEn ?? "").toLowerCase().includes(query.toLowerCase())
          )
          .slice(0, 10)
      : champion.augments.slice(0, 12)
    : [];

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (selected && v !== selected.nameZh) onSelect(null);
  }

  function handlePick(aug: Augment) {
    setQuery(aug.nameZh);
    onSelect(aug);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          ...inputStyle,
          borderColor: selected ? "#2ed573" : "var(--border)",
        }}
      />
      {open && results.length > 0 && (
        <div style={dropdownStyle}>
          {results.map((a, i) => (
            <div
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                handlePick(a);
              }}
              style={dropItemStyle}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLDivElement).style.background = "var(--sf2)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLDivElement).style.background = "transparent")
              }
            >
              <TierBadge tier={a.tier} />
              <div>
                <div style={{ fontWeight: 600 }}>{a.nameZh}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {a.nameEn || ""} · {a.tier} · {(a.performance || 0).toFixed(1)} 分
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tier list panel ─────────────────────────────────────────────────────────
const TIERS = ["S", "A", "B", "C", "D", "E"] as const;

function TierListPanel({
  champions,
  onSelect,
  highlight,
}: {
  champions: Champion[];
  onSelect?: (c: Champion) => void;
  highlight?: string; // champion key to highlight
}) {
  const byTier = useMemo(() => {
    const map = new Map<string, Champion[]>();
    for (const t of TIERS) map.set(t, []);
    for (const c of champions) {
      const list = map.get(c.tier);
      if (list) list.push(c);
    }
    return map;
  }, [champions]);

  return (
    <Card>
      <CardTitle>英雄強度一覽</CardTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TIERS.map((tier) => {
          const list = byTier.get(tier) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={tier} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, paddingTop: 2 }}>
                <TierBadge tier={tier} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {list.map((c) => (
                  <span
                    key={c.key}
                    onClick={() => onSelect?.(c)}
                    title={`${c.nameEn} · #${c.rank}`}
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background:
                        highlight === c.key
                          ? "rgba(88,166,255,.2)"
                          : "var(--sf2)",
                      border: `1px solid ${
                        highlight === c.key ? "var(--accent)" : "var(--border)"
                      }`,
                      color: highlight === c.key ? "var(--accent)" : "var(--text)",
                      cursor: onSelect ? "pointer" : "default",
                      transition: "background .1s",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      if (onSelect)
                        (e.currentTarget as HTMLSpanElement).style.background =
                          "var(--sf2)";
                    }}
                  >
                    {c.nameZh}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AramHelper({ champions }: { champions: Champion[] }) {
  const [phase, setPhase] = useState<"select" | "rounds">("select");

  // Phase: select
  const [poolQuery, setPoolQuery] = useState("");
  const [champPool, setChampPool] = useState<Champion[]>([]);

  // Phase: rounds
  const [confirmedChamp, setConfirmedChamp] = useState<Champion | null>(null);
  const [roundHistory, setRoundHistory] = useState<RoundRecord[]>([]);
  const [currentOptions, setCurrentOptions] = useState<[Augment | null, Augment | null, Augment | null]>([null, null, null]);
  const [augError, setAugError] = useState("");
  const [currentRec, setCurrentRec] = useState<DecideResult | null>(null);

  const poolSorted = useMemo(
    () =>
      [...champPool].sort((a, b) => {
        const d = TIER_ORD[a.tier] - TIER_ORD[b.tier];
        return d !== 0 ? d : a.rank - b.rank;
      }),
    [champPool]
  );

  function addToPool(c: Champion) {
    if (!champPool.find((x) => x.key === c.key)) setChampPool((l) => [...l, c]);
    setPoolQuery("");
  }

  function confirmChamp(c: Champion) {
    setConfirmedChamp(c);
    setChampPool([]);
    setPoolQuery("");
    setRoundHistory([]);
    setCurrentOptions([null, null, null]);
    setAugError("");
    setCurrentRec(null);
    setPhase("rounds");
  }

  function resetToSelect() {
    setPhase("select");
    setConfirmedChamp(null);
    setChampPool([]);
    setRoundHistory([]);
    setCurrentOptions([null, null, null]);
    setCurrentRec(null);
    setAugError("");
  }

  function setOpt(idx: 0 | 1 | 2, aug: Augment | null) {
    setCurrentOptions((prev) => {
      const next = [...prev] as typeof prev;
      next[idx] = aug;
      return next;
    });
    setCurrentRec(null);
  }

  function runAnalysis() {
    const filled = currentOptions.filter(Boolean) as Augment[];
    if (filled.length < 2) {
      setAugError("請至少選擇 2 個增強");
      return;
    }
    setAugError("");
    const pickedSoFar = roundHistory.map((r) => r.picked);
    setCurrentRec(decide(filled, pickedSoFar));
  }

  function confirmPick(aug: Augment) {
    const roundNumber = roundHistory.length + 1;
    const options = currentOptions.filter(Boolean) as Augment[];
    setRoundHistory((prev) => [...prev, { roundNumber, options, picked: aug }]);
    setCurrentOptions([null, null, null]);
    setCurrentRec(null);
    setAugError("");
  }

  const pickedSoFar = roundHistory.map((r) => r.picked);
  const activeBonds = getActiveBonds(pickedSoFar);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "20px 16px" }}>
      {/* Header */}
      <div
        style={{
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.4rem", color: "var(--accent)", fontWeight: 700 }}>
            ARAM: 大亂鬥 Helper
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            {phase === "select" ? "選擇你的英雄" : "增強選擇進行中"}
          </p>
        </div>
        {phase === "rounds" && confirmedChamp && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TierBadge tier={confirmedChamp.tier} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>{confirmedChamp.nameZh}</span>
            <button
              onClick={resetToSelect}
              style={{
                marginLeft: 8,
                padding: "4px 10px",
                background: "var(--sf2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--muted)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              換英雄
            </button>
          </div>
        )}
      </div>

      {/* ── Phase: select ── */}
      {phase === "select" && (
        <div>
          <Card>
            <CardTitle>加入英雄池來比較</CardTitle>
            <ChampionSearch
              champions={champions}
              value={poolQuery}
              onChange={setPoolQuery}
              onSelect={addToPool}
              placeholder="輸入英雄名稱（中文 / 英文 / key）..."
            />
            {champPool.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {champPool.map((c) => (
                  <span
                    key={c.key}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      background: "var(--sf2)",
                      border: "1px solid var(--border)",
                      borderRadius: 20,
                      padding: "3px 10px 3px 5px",
                      fontSize: 13,
                    }}
                  >
                    <TierBadge tier={c.tier} />
                    <span>{c.nameZh}</span>
                    <span
                      onClick={() => setChampPool((l) => l.filter((x) => x.key !== c.key))}
                      style={{
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: 18,
                        lineHeight: 1,
                        padding: "0 2px",
                      }}
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            )}
          </Card>

          <TierListPanel
            champions={champions}
            onSelect={addToPool}
          />

          {poolSorted.length >= 1 && (
            <Card>
              <CardTitle>比較結果 — 點「選這隻」確認你選的英雄</CardTitle>
              {poolSorted.map((c, i) => (
                <div
                  key={c.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 10px",
                    borderRadius: 6,
                    background: i === 0 ? "rgba(88,166,255,.06)" : "transparent",
                    borderBottom:
                      i < poolSorted.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      textAlign: "center",
                      fontWeight: 700,
                      fontSize: 14,
                      color: i === 0 ? "#ffd700" : "var(--muted)",
                    }}
                  >
                    {i === 0 ? "👑" : i + 1}
                  </span>
                  <TierBadge tier={c.tier} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.nameZh}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      {c.nameEn} · 全服 #{c.rank}
                    </div>
                  </div>
                  <button
                    onClick={() => confirmChamp(c)}
                    style={{
                      padding: "5px 14px",
                      background: i === 0 ? "var(--accent)" : "var(--sf2)",
                      color: i === 0 ? "#0d1117" : "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    選這隻
                  </button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* ── Phase: rounds ── */}
      {phase === "rounds" && confirmedChamp && (
        <div>
          {/* History + active bonds */}
          {roundHistory.length > 0 && (
            <Card>
              <CardTitle>已選增強</CardTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {roundHistory.map((r, idx) => {
                  const prevPicked = roundHistory.slice(0, idx).map((x) => x.picked);
                  const bonus = getBondBonus(r.picked, prevPicked);
                  return (
                    <div
                      key={r.roundNumber}
                      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                    >
                      <span style={{ color: "var(--muted)", width: 28, flexShrink: 0 }}>
                        R{r.roundNumber}
                      </span>
                      <TierBadge tier={r.picked.tier} />
                      <span style={{ fontWeight: 600 }}>{r.picked.nameZh}</span>
                      {bonus && (
                        <span style={{ color: "#ffa502", fontSize: 12 }}>
                          💡 {bonus.bondName}({bonus.newCount})
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {activeBonds.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    borderTop: "1px solid var(--border)",
                    paddingTop: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: "var(--muted)",
                      marginBottom: 8,
                    }}
                  >
                    羈絆
                  </div>
                  {activeBonds.map((b) => (
                    <div
                      key={b.bondName}
                      style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {b.activeThreshold ? "🔗" : "○"} {b.bondName}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>
                          ({b.count} 個)
                        </span>
                        {b.activeThreshold && (
                          <span
                            style={{
                              background: "#2ed57322",
                              color: "#2ed573",
                              borderRadius: 4,
                              padding: "1px 6px",
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            激活
                          </span>
                        )}
                      </div>
                      {b.activeThreshold && (
                        <div style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 20 }}>
                          {b.activeThreshold.effect}
                        </div>
                      )}
                      {b.nextThreshold && (
                        <div style={{ fontSize: 11, color: "#ffa50299", paddingLeft: 20 }}>
                          ↳ 再湊 {b.nextThreshold.count - b.count} 個可升級：
                          {b.nextThreshold.effect}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <TierListPanel
            champions={champions}
            highlight={confirmedChamp.key}
          />

          {/* Current round inputs */}
          <Card>
            <CardTitle>第 {roundHistory.length + 1} 輪增強選項</CardTitle>
            {(["選項 1", "選項 2", "選項 3（可選）"] as const).map((lbl, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}
              >
                <span
                  style={{ width: 80, fontSize: 12, color: "var(--muted)", flexShrink: 0 }}
                >
                  {lbl}
                </span>
                <AugmentInput
                  champion={confirmedChamp}
                  selected={currentOptions[i as 0 | 1 | 2]}
                  onSelect={(a) => setOpt(i as 0 | 1 | 2, a)}
                  placeholder="點擊展開 / 輸入篩選..."
                />
              </div>
            ))}
            <div style={{ marginTop: 4 }}>
              <button onClick={runAnalysis} style={btnStyle}>
                分析增強
              </button>
              {augError && (
                <p style={{ color: "#ff4757", fontSize: 13, marginTop: 8 }}>{augError}</p>
              )}
            </div>
          </Card>

          {/* Recommendation */}
          {currentRec && <AugResult result={currentRec} onConfirmPick={confirmPick} />}
        </div>
      )}
    </div>
  );
}

// ─── Augment result display ───────────────────────────────────────────────────
function AugResult({
  result,
  onConfirmPick,
}: {
  result: DecideResult;
  onConfirmPick: (a: Augment) => void;
}) {
  const { sorted, best, rest, eHighScore, closeCall, bigGap, bondBonuses } = result;

  let recNode: React.ReactNode;
  if (closeCall) {
    const tie = sorted.slice(0, 2);
    const bonus0 = bondBonuses.get(tie[0].nameZh);
    const bonus1 = bondBonuses.get(tie[1].nameZh);
    const tiebreaker =
      bonus0 && !bonus1
        ? `選 ${tie[0].nameZh} 可激活「${bonus0.bondName}」羈絆。`
        : !bonus0 && bonus1
        ? `選 ${tie[1].nameZh} 可激活「${bonus1.bondName}」羈絆。`
        : "";
    recNode = (
      <>
        <div style={{ color: "#ffa502", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          🤔 難選：{tie[0].nameZh} 或 {tie[1].nameZh}
        </div>
        {rest.length > 1 && (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            骰掉：{rest.slice(1).map((a) => a.nameZh).join("、")}
          </div>
        )}
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
          兩者同為 {best.tier} 階，分數相近（{tie[0].performance.toFixed(1)} vs{" "}
          {tie[1].performance.toFixed(1)}），都可以選。
          {tiebreaker && ` ${tiebreaker}`}
        </div>
      </>
    );
  } else {
    const note = eHighScore ? "（E 階但高分，值得留）" : "";
    const bestBonus = bondBonuses.get(best.nameZh);
    let reason = `${best.nameZh} 為 ${best.tier} 階（${best.performance.toFixed(1)} 分）`;
    if (eHighScore) reason += "，雖然是通用增強，但評分 > 100 值得留";
    else if (bigGap) reason += "，與其他選項差距明顯";
    else reason += "，是本輪最佳選擇";
    if (bestBonus) reason += `；且可激活「${bestBonus.bondName}」(${bestBonus.newCount}) 羈絆`;

    recNode = (
      <>
        <div style={{ color: "#2ed573", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          留下 {best.nameZh} {note}
        </div>
        {rest.length > 0 && (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            骰掉：{rest.map((a) => a.nameZh).join("、")}
          </div>
        )}
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
          {reason}
        </div>
      </>
    );
  }

  return (
    <Card>
      <CardTitle>增強建議</CardTitle>
      <div style={{ marginBottom: 12 }}>
        {sorted.map((a, i) => {
          const bonus = bondBonuses.get(a.nameZh);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 0",
                borderBottom: i < sorted.length - 1 ? "1px solid var(--border)" : "none",
                fontSize: 14,
              }}
            >
              <span style={{ fontSize: 16 }}>{i === 0 ? "✅" : "🎲"}</span>
              <TierBadge tier={a.tier} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{a.nameZh}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {a.nameEn}
                  {bonus && (
                    <span style={{ color: "#ffa502", marginLeft: 6 }}>
                      💡 激活「{bonus.bondName}」({bonus.newCount})
                    </span>
                  )}
                </div>
              </div>
              <span style={{ color: "var(--muted)", fontSize: 12, marginRight: 8 }}>
                {a.performance.toFixed(1)} 分
              </span>
              <button
                onClick={() => onConfirmPick(a)}
                style={{
                  padding: "4px 12px",
                  background: i === 0 ? "#2ed57322" : "var(--sf2)",
                  color: i === 0 ? "#2ed573" : "var(--muted)",
                  border: `1px solid ${i === 0 ? "#2ed57344" : "var(--border)"}`,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                選這個
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ background: "var(--sf2)", borderRadius: 6, padding: 14 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--muted)",
            marginBottom: 8,
          }}
        >
          建議
        </div>
        {recNode}
      </div>
    </Card>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--sf)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>{children}</div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--sf2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 14,
  outline: "none",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "var(--sf)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  zIndex: 200,
  maxHeight: 280,
  overflowY: "auto",
};

const dropItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  cursor: "pointer",
  fontSize: 13,
  background: "transparent",
  transition: "background .1s",
};

const btnStyle: React.CSSProperties = {
  padding: "8px 22px",
  background: "var(--accent)",
  color: "#0d1117",
  border: "none",
  borderRadius: 6,
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
