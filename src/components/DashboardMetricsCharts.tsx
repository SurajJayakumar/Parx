"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/useAuth";
import { Card, CardSectionLabel } from "@/components/ui/Card";
import {
  loadMetricSnapshots,
  type MetricSnapshot,
} from "@/lib/sessions/metricsStore";
import { getOrCreateTodaySession } from "@/lib/sessions/sessionStore";

// ---------------------------------------------------------------------------
// Mini SVG line-chart helpers
// ---------------------------------------------------------------------------

interface DataPoint {
  x: number; // 0–1 normalised
  y: number; // 0–1 normalised (0 = top, 1 = bottom in SVG space)
}

function buildPoints(
  values: (number | undefined)[],
  minVal: number,
  maxVal: number,
): DataPoint[] {
  const range = maxVal - minVal || 1;
  return values
    .map((v, i) =>
      v !== undefined
        ? {
            x: values.length > 1 ? i / (values.length - 1) : 0.5,
            y: 1 - (v - minVal) / range,
          }
        : null,
    )
    .filter((p): p is DataPoint => p !== null);
}

// ---------------------------------------------------------------------------
// Sparkline chart component (pure SVG, no libraries)
// ---------------------------------------------------------------------------

interface SparklineProps {
  series: { label: string; color: string; values: (number | undefined)[] }[];
  unit: string;
  yMin?: number;
  yMax?: number;
  height?: number;
  ticks?: number;
}

function Sparkline({ series, unit, yMin, yMax, height = 120, ticks = 4 }: SparklineProps) {
  const W = 460;
  const H = height;
  const PAD_LEFT = 40;
  const PAD_RIGHT = 8;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 20;
  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOTTOM;

  // Compute global min/max across all series
  const allVals = series.flatMap((s) => s.values.filter((v): v is number => v !== undefined));
  const dataMin = allVals.length ? Math.min(...allVals) : 0;
  const dataMax = allVals.length ? Math.max(...allVals) : 1;

  const lo = yMin ?? Math.max(0, dataMin - (dataMax - dataMin) * 0.15);
  const hi = yMax ?? (dataMax + (dataMax - dataMin) * 0.15 || lo + 1);

  const tickValues = Array.from({ length: ticks + 1 }, (_, i) =>
    lo + ((hi - lo) / ticks) * i,
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      aria-hidden="true"
    >
      {/* Y-axis gridlines + labels */}
      {tickValues.map((v, i) => {
        const yPx = PAD_TOP + innerH * (1 - (v - lo) / (hi - lo));
        return (
          <g key={i}>
            <line
              x1={PAD_LEFT}
              x2={W - PAD_RIGHT}
              y1={yPx}
              y2={yPx}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 4}
              y={yPx + 4}
              textAnchor="end"
              className="fill-zinc-400 dark:fill-zinc-500"
              style={{ fontSize: 9, fontFamily: "inherit" }}
            >
              {v.toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Series polylines */}
      {series.map((s) => {
        const pts = buildPoints(s.values, lo, hi);
        if (pts.length < 2) return null;
        return (
          <polyline
            key={s.label}
            points={pts
              .map(
                (p) =>
                  `${(PAD_LEFT + p.x * innerW).toFixed(1)},${(PAD_TOP + p.y * innerH).toFixed(1)}`,
              )
              .join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.9}
          />
        );
      })}

      {/* X-axis unit label */}
      <text
        x={W - PAD_RIGHT}
        y={H - 4}
        textAnchor="end"
        className="fill-zinc-400 dark:fill-zinc-500"
        style={{ fontSize: 9, fontFamily: "inherit" }}
      >
        {unit}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stat pill
// ---------------------------------------------------------------------------

function StatPill({ label, value, unit, color }: { label: string; value: number | undefined; unit: string; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color }}>
        {label}
      </span>
      <span className="text-2xl font-semibold text-zinc-800 dark:text-zinc-100 tabular-nums">
        {value !== undefined ? value.toFixed(1) : "—"}
        <span className="text-sm font-normal text-zinc-400 dark:text-zinc-500 ml-1">{unit}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main chart card
// ---------------------------------------------------------------------------

interface ChartCardProps {
  title: string;
  icon: React.ReactNode;
  isLoading: boolean;
  hasData: boolean;
  children: React.ReactNode;
}

function ChartCard({ title, icon, isLoading, hasData, children }: ChartCardProps) {
  return (
    <Card padding="none">
      <div className="p-5 pb-3 flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-widest">{title}</span>
      </div>
      {isLoading ? (
        <div className="px-5 pb-5 flex items-center justify-center h-28">
          <div className="h-4 w-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
        </div>
      ) : !hasData ? (
        <div className="px-5 pb-5 flex flex-col items-center justify-center h-28 gap-1">
          <p className="text-2xl font-semibold text-zinc-300 dark:text-zinc-600">—</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Waiting for session data</p>
        </div>
      ) : (
        <div className="px-2 pb-3">{children}</div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function DashboardMetricsCharts() {
  const { user } = useAuth();
  const [snapshots, setSnapshots] = useState<MetricSnapshot[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;

    (async () => {
      try {
        const sid = await getOrCreateTodaySession(user.uid);
        const data = await loadMetricSnapshots(user.uid, sid);
        if (!cancelled) setSnapshots(data);
      } catch {
        if (!cancelled) setSnapshots([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Downsample to at most 150 visible points for chart clarity
  const downsampled = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    const step = Math.max(1, Math.floor(snapshots.length / 150));
    return snapshots.filter((_, i) => i % step === 0);
  }, [snapshots]);

  const stepLengths = downsampled.map((s) => s.stepLength);
  const armSwingLs = downsampled.map((s) => s.armSwingL);
  const armSwingRs = downsampled.map((s) => s.armSwingR);

  const lastStep = downsampled.at(-1)?.stepLength;
  const lastArmL = downsampled.at(-1)?.armSwingL;
  const lastArmR = downsampled.at(-1)?.armSwingR;

  const hasStepData = stepLengths.some((v) => v !== undefined);
  const hasArmData = armSwingLs.some((v) => v !== undefined) || armSwingRs.some((v) => v !== undefined);

  const stepIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );

  const armIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
    </svg>
  );

  return (
    <>
      <CardSectionLabel>Today&apos;s Mobility Analytics</CardSectionLabel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Step Length */}
        <ChartCard
          title="Step Length"
          icon={stepIcon}
          isLoading={loading}
          hasData={hasStepData}
        >
          <div className="px-3 pt-1 pb-2">
            <StatPill label="Latest" value={lastStep} unit="cm" color="#818cf8" />
          </div>
          <Sparkline
            series={[{ label: "Step Length", color: "#818cf8", values: stepLengths }]}
            unit="time →"
            ticks={3}
          />
        </ChartCard>

        {/* Arm Swing */}
        <ChartCard
          title="Arm Swing"
          icon={armIcon}
          isLoading={loading}
          hasData={hasArmData}
        >
          <div className="px-3 pt-1 pb-2 flex gap-6">
            <StatPill label="Left" value={lastArmL} unit="°" color="#34d399" />
            <StatPill label="Right" value={lastArmR} unit="°" color="#f472b6" />
          </div>
          <Sparkline
            series={[
              { label: "Arm Swing L", color: "#34d399", values: armSwingLs },
              { label: "Arm Swing R", color: "#f472b6", values: armSwingRs },
            ]}
            unit="time →"
            ticks={3}
          />
          {/* Legend */}
          <div className="flex gap-4 px-3 pt-1 pb-1">
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: "#34d399" }} />
              Left
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: "#f472b6" }} />
              Right
            </span>
          </div>
        </ChartCard>
      </div>
    </>
  );
}
