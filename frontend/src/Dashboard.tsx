import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { DashboardData, DashboardPoint } from "./types";

const ranges = [7, 30, 365] as const;

function usd(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: value < 0.01 ? 4 : 2, maximumFractionDigits: 4 }).format(value);
}

function label(period: string, bucket: DashboardData["bucket"]) {
  const date = new Date(`${period}${bucket === "month" ? "-01" : ""}T00:00:00Z`);
  return new Intl.DateTimeFormat("de-DE", bucket === "month" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date);
}

function CostChart({ data }: { data: DashboardData }) {
  const width = 960, height = 310, top = 24, bottom = 44, left = 58, right = 18;
  const innerHeight = height - top - bottom, innerWidth = width - left - right;
  const max = Math.max(...data.points.map((point) => point.totalCost), 0.0001);
  const gap = data.points.length > 100 ? 1 : data.points.length > 20 ? 3 : 8;
  const barWidth = Math.max(1, innerWidth / data.points.length - gap);
  const ticks = [0, .25, .5, .75, 1];
  const labelEvery = Math.max(1, Math.ceil(data.points.length / 8));
  return <div className="chart-wrap">
    <svg className="cost-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Kostenentwicklung der letzten ${data.days} Tage`}>
      {ticks.map((tick) => {
        const y = top + innerHeight * (1 - tick);
        return <g key={tick}><line x1={left} x2={width - right} y1={y} y2={y} className="grid-line" /><text x={left - 10} y={y + 4} textAnchor="end" className="axis-label">{usd(max * tick)}</text></g>;
      })}
      {data.points.map((point, index) => {
        const x = left + index * innerWidth / data.points.length + gap / 2;
        const lunaHeight = point.lunaCost / max * innerHeight, audioHeight = point.audioCost / max * innerHeight;
        const base = top + innerHeight;
        return <g key={point.period}>
          <title>{`${label(point.period, data.bucket)}: ${usd(point.totalCost)} (${point.dictates} Diktate)`}</title>
          <rect x={x} y={base - audioHeight} width={barWidth} height={audioHeight} rx="2" className="bar-audio" />
          <rect x={x} y={base - audioHeight - lunaHeight} width={barWidth} height={lunaHeight} rx="2" className="bar-luna" />
          {(index % labelEvery === 0 || index === data.points.length - 1) && <text x={x + barWidth / 2} y={height - 14} textAnchor="middle" className="axis-label">{label(point.period, data.bucket)}</text>}
        </g>;
      })}
    </svg>
  </div>;
}

export function Dashboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [days, setDays] = useState<7 | 30 | 365>(30);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true; setError("");
    void api.dashboard(days).then((result) => { if (active) setData(result); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Dashboard konnte nicht geladen werden"); });
    return () => { active = false; };
  }, [days, refreshKey]);
  const trackedSince = useMemo(() => data ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(data.costTrackingSince)) : "", [data]);

  return <section className="dashboard-view" aria-labelledby="dashboard-title">
    <div className="dashboard-heading"><div><span className="eyebrow">Nutzungsübersicht</span><h1 id="dashboard-title">Dashboard</h1><p>Diktate, Audiolaufzeit und geschätzte API-Kosten auf einen Blick.</p></div>
      <div className="range-tabs" aria-label="Dashboard-Zeitraum">{ranges.map((range) => <button key={range} className={days === range ? "active" : ""} onClick={() => setDays(range)}>{range} Tage</button>)}</div>
    </div>
    {error && <div className="dashboard-error">{error}</div>}
    {!data && !error && <div className="dashboard-loading">Statistik wird geladen …</div>}
    {data && <>
      <div className="metric-grid">
        <Metric label="Gespeicherte Diktate" value={String(data.summary.dictates)} hint={`letzte ${days} Tage`} />
        <Metric label="Transkribiertes Audio" value={`${(data.summary.audioSeconds / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 })} min`} hint="erfolgreich verarbeitet" />
        <Metric label="Gesamtkosten" value={usd(data.summary.totalCost)} hint="geschätzt in USD" accent />
      </div>
      <div className="chart-card">
        <div className="chart-heading"><div><h2>Kostenentwicklung</h2><p>{data.bucket === "day" ? "Tageswerte" : "Monatswerte"} · UTC</p></div><div className="legend"><span><i className="audio" />Audio {usd(data.summary.audioCost)}</span><span><i className="luna" />Luna {usd(data.summary.lunaCost)}</span></div></div>
        <CostChart data={data} />
        <p className="tracking-note">Exakte Tageskosten werden seit {trackedSince} erfasst. Frühere Kosten werden nicht künstlich verteilt.</p>
      </div>
    </>}
  </section>;
}

function Metric({ label, value, hint, accent = false }: { label: string; value: string; hint: string; accent?: boolean }) {
  return <article className={`metric-card ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}
