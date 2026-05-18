/**
 * Perf measurement tool. Heap, frame time, render counts, live interval count,
 * stress-chat injector, and chat-store action call rates.
 */

import { useEffect, useRef, useState } from "react";

import type { ChatMessage, ChatPlatform } from "../../shared/chat-types";
import { useChatStore } from "../../store/chat-store";

import { getActiveIntervalCount, installIntervalTracker } from "./interval-tracker";
import { DEBUG_TOKENS } from "./tokens";
import { getRenderCounts, resetRenderCounts } from "./use-render-count";

interface MemorySnapshot {
  used: number;
  total: number;
}

const STRESS_TOTAL = 1000;
const STRESS_DURATION_MS = 30_000;

function readMemory(): MemorySnapshot | null {
  const perf = performance as unknown as {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
  };
  if (!perf.memory) return null;
  return { used: perf.memory.usedJSHeapSize, total: perf.memory.totalJSHeapSize };
}

function formatMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

interface ChatStoreDebugCounters {
  setCalls: number;
  addMessageBatched: number;
  flushBatch: number;
  addMessage: number;
  setPaused: number;
  deleteMessage: number;
  deleteMessagesByUser: number;
  updateConnectionStatus: number;
}

interface ChatStoreDebugWindow {
  __chatStore?: { counters: ChatStoreDebugCounters };
}

function readStoreCounters(): ChatStoreDebugCounters | null {
  const cs = (window as unknown as ChatStoreDebugWindow).__chatStore;
  return cs ? { ...cs.counters } : null;
}

function injectStressChat(): () => void {
  const platforms: ChatPlatform[] = ["twitch", "kick"];
  const intervalMs = STRESS_DURATION_MS / STRESS_TOTAL;
  let i = 0;
  const id = window.setInterval(() => {
    i += 1;
    if (i > STRESS_TOTAL) {
      window.clearInterval(id);
      return;
    }
    const platform = platforms[i % platforms.length];
    const synthetic: ChatMessage = {
      id: `stress-${Date.now()}-${i}`,
      platform,
      type: "message",
      channel: "stress-test",
      userId: `stress-user-${i % 25}`,
      username: `stresser${i % 25}`,
      displayName: `Stresser${i % 25}`,
      color: "#888888",
      badges: [],
      content: [{ type: "text", content: `Synthetic stress message #${i}` }],
      rawContent: `Synthetic stress message #${i}`,
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    useChatStore.getState().addMessageBatched(synthetic, platform);
  }, intervalMs);
  return () => window.clearInterval(id);
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: DEBUG_TOKENS.textSecondary,
  margin: "0 0 6px 0",
};

const statRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 12,
  padding: "3px 0",
  fontSize: 13,
};

const statLabelStyle: React.CSSProperties = {
  color: DEBUG_TOKENS.textSecondary,
};

const statValueStyle: React.CSSProperties = {
  color: DEBUG_TOKENS.textPrimary,
  fontFamily: DEBUG_TOKENS.fontMono,
  fontVariantNumeric: "tabular-nums",
};

const buttonStyle: React.CSSProperties = {
  background: DEBUG_TOKENS.surfaceRaised,
  color: DEBUG_TOKENS.textPrimary,
  border: `1px solid ${DEBUG_TOKENS.border}`,
  padding: "8px 14px",
  cursor: "pointer",
  font: `13px/1.2 ${DEBUG_TOKENS.fontUi}`,
  fontWeight: 500,
  borderRadius: 6,
  transition: "all 0.12s",
  flex: 1,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 14,
};

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const color =
    tone === "success"
      ? DEBUG_TOKENS.success
      : tone === "warning"
        ? DEBUG_TOKENS.warning
        : tone === "danger"
          ? DEBUG_TOKENS.danger
          : DEBUG_TOKENS.textPrimary;
  return (
    <div style={statRowStyle}>
      <span style={statLabelStyle}>{label}</span>
      <span style={{ ...statValueStyle, color }}>{value}</span>
    </div>
  );
}

function HeapBar({ pct, tone }: { pct: number; tone: "success" | "warning" | "danger" }) {
  const color =
    tone === "success"
      ? DEBUG_TOKENS.success
      : tone === "warning"
        ? DEBUG_TOKENS.warning
        : DEBUG_TOKENS.danger;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: 4,
        background: DEBUG_TOKENS.surfaceSubtle,
        borderRadius: 2,
        overflow: "hidden",
        margin: "6px 0 2px",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          height: "100%",
          background: color,
          transition: "width 0.3s ease, background 0.3s ease",
        }}
      />
    </div>
  );
}

function tonePct(pct: number): "success" | "warning" | "danger" {
  if (pct >= 90) return "danger";
  if (pct >= 70) return "warning";
  return "success";
}

function toneFps(fps: number): "success" | "warning" | "danger" {
  if (fps < 30) return "danger";
  if (fps < 55) return "warning";
  return "success";
}

export function PerfTool() {
  const [memory, setMemory] = useState<MemorySnapshot | null>(readMemory);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [intervalCount, setIntervalCount] = useState(0);
  const [avgFrameMs, setAvgFrameMs] = useState(0);
  const [storeCounters, setStoreCounters] = useState<ChatStoreDebugCounters | null>(
    readStoreCounters
  );
  const lastSampleRef = useRef<{ counters: ChatStoreDebugCounters; t: number } | null>(null);
  const [storeRates, setStoreRates] = useState<Partial<ChatStoreDebugCounters> | null>(null);
  const [stressActive, setStressActive] = useState(false);
  const stressCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    installIntervalTracker();
  }, []);

  useEffect(() => {
    const tick = () => {
      setMemory(readMemory());
      setCounts(getRenderCounts());
      setIntervalCount(getActiveIntervalCount());
      const cur = readStoreCounters();
      setStoreCounters(cur);
      if (cur) {
        const now = performance.now();
        const last = lastSampleRef.current;
        if (last) {
          const dt = (now - last.t) / 1000;
          if (dt > 0) {
            const rates: Partial<ChatStoreDebugCounters> = {};
            (Object.keys(cur) as Array<keyof ChatStoreDebugCounters>).forEach((k) => {
              rates[k] = Math.round(((cur[k] - last.counters[k]) / dt) * 10) / 10;
            });
            setStoreRates(rates);
          }
        }
        lastSampleRef.current = { counters: { ...cur }, t: now };
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const samples: number[] = [];
    let prev = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      samples.push(now - prev);
      if (samples.length > 60) samples.shift();
      prev = now;
      if (samples.length % 12 === 0) {
        const sum = samples.reduce((a, b) => a + b, 0);
        setAvgFrameMs(sum / samples.length);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    return () => {
      stressCancelRef.current?.();
    };
  }, []);

  const handleStress = () => {
    if (stressActive) {
      stressCancelRef.current?.();
      stressCancelRef.current = null;
      setStressActive(false);
      return;
    }
    setStressActive(true);
    const cancel = injectStressChat();
    const timeout = window.setTimeout(() => {
      stressCancelRef.current = null;
      setStressActive(false);
    }, STRESS_DURATION_MS + 100);
    stressCancelRef.current = () => {
      cancel();
      window.clearTimeout(timeout);
    };
  };

  const sortedNames = Object.keys(counts).sort();
  const usedPct = memory && memory.total > 0 ? (memory.used / memory.total) * 100 : 0;
  const heapTone = tonePct(usedPct);
  const fpsValue = Number((1000 / Math.max(avgFrameMs, 0.01)).toFixed(0));
  const fpsTone = avgFrameMs > 0 ? toneFps(fpsValue) : "success";

  return (
    <div>
      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Runtime</div>
        <Stat
          label="Heap"
          tone={memory ? heapTone : "default"}
          value={
            memory
              ? `${formatMb(memory.used)} / ${formatMb(memory.total)} · ${usedPct.toFixed(0)}%`
              : "n/a"
          }
        />
        {memory ? <HeapBar pct={usedPct} tone={heapTone} /> : null}
        <Stat
          label="Frame"
          tone={fpsTone}
          value={`${avgFrameMs.toFixed(1)} ms · ${fpsValue} fps`}
        />
        <Stat label="Live intervals" value={intervalCount} />
      </section>

      <section style={sectionStyle}>
        <div style={sectionLabelStyle}>Render counts</div>
        {sortedNames.length === 0 ? (
          <div style={{ ...statRowStyle, color: DEBUG_TOKENS.textMuted, fontStyle: "italic" }}>
            none registered
          </div>
        ) : (
          sortedNames.map((name) => <Stat key={name} label={name} value={counts[name]} />)
        )}
      </section>

      {storeCounters && storeRates && (
        <section style={sectionStyle}>
          <div style={sectionLabelStyle}>Chat store rate (per sec)</div>
          <Stat label="addMessageBatched" value={storeRates.addMessageBatched ?? 0} />
          <Stat label="flushBatch" value={storeRates.flushBatch ?? 0} />
          <Stat label="addMessage" value={storeRates.addMessage ?? 0} />
          <Stat label="setCalls (all)" value={storeRates.setCalls ?? 0} />
        </section>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => resetRenderCounts()}
          style={buttonStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = DEBUG_TOKENS.surfaceSubtle;
            e.currentTarget.style.borderColor = DEBUG_TOKENS.borderStrong;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = DEBUG_TOKENS.surfaceRaised;
            e.currentTarget.style.borderColor = DEBUG_TOKENS.border;
          }}
        >
          Reset counts
        </button>
        <button
          type="button"
          onClick={handleStress}
          style={{
            ...buttonStyle,
            background: stressActive ? DEBUG_TOKENS.dangerSoft : DEBUG_TOKENS.surfaceRaised,
            color: stressActive ? DEBUG_TOKENS.danger : DEBUG_TOKENS.textPrimary,
            borderColor: stressActive ? DEBUG_TOKENS.danger : DEBUG_TOKENS.border,
          }}
        >
          {stressActive ? "Stop stress" : `Stress chat · ${STRESS_TOTAL}/30s`}
        </button>
      </div>
    </div>
  );
}
