"use client";

import { useState, useEffect } from "react";

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

  // When champion changes or selection is cleared externally, reset
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

// ─── Decision logic ───────────────────────────────────────────────────────────
function decide(augs: Augment[]) {
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
  return { sorted, best, rest, eHighScore, closeCall, bigGap };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AramHelper({ champions }: { champions: Champion[] }) {
  const [tab, setTab] = useState<"compare" | "augment">("compare");

  // Compare tab state
  const [cmpQuery, setCmpQuery] = useState("");
  const [cmpList, setCmpList] = useState<Champion[]>([]);

  // Augment advisor state
  const [advQuery, setAdvQuery] = useState("");
  const [advChamp, setAdvChamp] = useState<Champion | null>(null);
  const [advAugs, setAdvAugs] = useState<[Augment | null, Augment | null, Augment | null]>([
    null,
    null,
    null,
  ]);
  const [augError, setAugError] = useState("");
  const [augResult, setAugResult] = useState<ReturnType<typeof decide> | null>(null);

  // Compare tab handlers
  function addToCompare(c: Champion) {
    if (!cmpList.find((x) => x.key === c.key)) setCmpList((l) => [...l, c]);
    setCmpQuery("");
  }

  const cmpSorted = [...cmpList].sort((a, b) => {
    const d = TIER_ORD[a.tier] - TIER_ORD[b.tier];
    return d !== 0 ? d : a.rank - b.rank;
  });

  // Augment advisor handlers
  function selectChamp(c: Champion) {
    setAdvChamp(c);
    setAdvQuery(c.nameZh);
    setAdvAugs([null, null, null]);
    setAugError("");
    setAugResult(null);
  }

  function setAug(idx: 0 | 1 | 2, aug: Augment | null) {
    setAdvAugs((prev) => {
      const next = [...prev] as typeof prev;
      next[idx] = aug;
      return next;
    });
    setAugResult(null);
  }

  function runAnalysis() {
    const filled = advAugs.filter(Boolean) as Augment[];
    if (filled.length < 2) {
      setAugError("請至少選擇 2 個增強（從下拉選單點選）");
      return;
    }
    setAugError("");
    setAugResult(decide(filled));
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "20px 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: "1.4rem", color: "var(--accent)", fontWeight: 700 }}>
          ARAM: 大亂鬥 Helper
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          英雄強度比較 &amp; 增強選項建議
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          marginBottom: 20,
        }}
      >
        {(["compare", "augment"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 18px",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${tab === t ? "var(--accent)" : "transparent"}`,
              color: tab === t ? "var(--accent)" : "var(--muted)",
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
              fontSize: 14,
              transition: "color .15s",
            }}
          >
            {t === "compare" ? "英雄比較" : "增強建議"}
          </button>
        ))}
      </div>

      {/* ── Compare Tab ── */}
      {tab === "compare" && (
        <div>
          <Card>
            <CardTitle>選擇英雄來比較強度</CardTitle>
            <ChampionSearch
              champions={champions}
              value={cmpQuery}
              onChange={setCmpQuery}
              onSelect={addToCompare}
              placeholder="輸入英雄名稱（中文 / 英文 / key）..."
            />
            {cmpList.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {cmpList.map((c) => (
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
                      onClick={() => setCmpList((l) => l.filter((x) => x.key !== c.key))}
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

          {cmpSorted.length >= 2 && (
            <Card>
              <CardTitle>比較結果</CardTitle>
              <div>
                {cmpSorted.map((c, i) => (
                  <div
                    key={c.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: i === 0 ? "rgba(88,166,255,.06)" : "transparent",
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
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{c.nameEn}</div>
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>全服 #{c.rank}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 14, color: "var(--muted)" }}>
                ✅ 推薦選{" "}
                <strong style={{ color: "var(--text)" }}>{cmpSorted[0].nameZh}</strong> —{" "}
                {cmpSorted[0].tier} 階，全服 #{cmpSorted[0].rank}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Augment Tab ── */}
      {tab === "augment" && (
        <div>
          <Card>
            <CardTitle>選擇你的英雄</CardTitle>
            <ChampionSearch
              champions={champions}
              value={advQuery}
              onChange={(v) => {
                setAdvQuery(v);
                if (advChamp && v !== advChamp.nameZh) {
                  setAdvChamp(null);
                  setAdvAugs([null, null, null]);
                }
              }}
              onSelect={selectChamp}
              placeholder="輸入英雄名稱..."
            />
            {advChamp && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "var(--sf2)",
                  borderRadius: 6,
                  padding: 10,
                  marginTop: 10,
                }}
              >
                <TierBadge tier={advChamp.tier} />
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {advChamp.nameZh} / {advChamp.nameEn}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    {advChamp.tier} 階 · 全服排名 #{advChamp.rank}
                  </div>
                </div>
              </div>
            )}
          </Card>

          {advChamp && (
            <Card>
              <CardTitle>輸入本輪增強選項（2–3 個）</CardTitle>
              {(["選項 1", "選項 2", "選項 3（可選）"] as const).map((lbl, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}
                >
                  <span style={{ width: 80, fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
                    {lbl}
                  </span>
                  <AugmentInput
                    champion={advChamp}
                    selected={advAugs[i as 0 | 1 | 2]}
                    onSelect={(a) => setAug(i as 0 | 1 | 2, a)}
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
          )}

          {augResult && <AugResult result={augResult} />}
        </div>
      )}
    </div>
  );
}

// ─── Augment result display ───────────────────────────────────────────────────
function AugResult({ result }: { result: ReturnType<typeof decide> }) {
  const { sorted, best, rest, eHighScore, closeCall, bigGap } = result;

  let recNode: React.ReactNode;
  if (closeCall) {
    const tie = sorted.slice(0, 2);
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
        </div>
      </>
    );
  } else {
    const note = eHighScore ? "（E 階但高分，值得留）" : "";
    let reason = `${best.nameZh} 為 ${best.tier} 階（${best.performance.toFixed(1)} 分）`;
    if (eHighScore) reason += "，雖然是通用增強，但評分 > 100 值得留";
    else if (bigGap) reason += "，與其他選項差距明顯";
    else reason += "，是本輪最佳選擇";

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
        {sorted.map((a, i) => (
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
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{a.nameEn}</div>
            </div>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {a.performance.toFixed(1)} 分
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          background: "var(--sf2)",
          borderRadius: 6,
          padding: 14,
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
