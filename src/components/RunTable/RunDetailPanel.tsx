import React, { useMemo } from 'react';
import {
  Activity,
  pathForRun,
  formatPace,
  convertMovingTime2Sec,
} from '@/utils/utils';
import { SHOW_ELEVATION_GAIN } from '@/utils/const';
import styles from './RunDetailPanel.module.css';

interface RunDetailPanelProps {
  run: Activity;
}

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
};

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr.replace(' ', 'T'));
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const formatTime = (dateStr: string): string => {
  const d = new Date(dateStr.replace(' ', 'T'));
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const getActivityLabel = (run: Activity): { label: string; emoji: string } => {
  const t = run.type?.toLowerCase();
  const st = run.subtype?.toLowerCase();
  if (t === 'run') {
    if (st === 'trail') return { label: 'Trail Run', emoji: '⛰️' };
    if (st === 'treadmill') return { label: 'Treadmill', emoji: '🏃' };
    const km = run.distance / 1000;
    if (km >= 42) return { label: 'Marathon', emoji: '🏅' };
    if (km >= 21) return { label: 'Half Marathon', emoji: '🥈' };
    return { label: 'Run', emoji: '🏃' };
  }
  if (t === 'cycling' || t === 'ride') return { label: 'Ride', emoji: '🚴' };
  if (t === 'hiking') return { label: 'Hike', emoji: '🥾' };
  if (t === 'walking' || t === 'walk') return { label: 'Walk', emoji: '🚶' };
  if (t === 'swimming') return { label: 'Swim', emoji: '🏊' };
  if (t?.includes('ski')) return { label: 'Ski', emoji: '⛷️' };
  return { label: run.type || 'Activity', emoji: '🏅' };
};

const computeEffort = (run: Activity): number | null => {
  if (!run.average_heartrate) return null;
  const secs = convertMovingTime2Sec(run.moving_time);
  return Math.min(Math.round((run.average_heartrate * secs) / 5000), 999);
};

// ── Mini route map ────────────────────────────────────────────────────────────
const RouteMiniMap: React.FC<{ run: Activity }> = ({ run }) => {
  const path = useMemo(() => pathForRun(run), [run.run_id]);

  if (!path || path.length < 2) {
    return (
      <div className={styles.noRoute}>
        <span>No GPS data</span>
      </div>
    );
  }

  const lngs = path.map((p) => p[0]);
  const lats = path.map((p) => p[1]);
  const minLng = Math.min(...lngs),
    maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats),
    maxLat = Math.max(...lats);
  const pad = 0.0005;
  const bw = maxLng - minLng + pad * 2;
  const bh = maxLat - minLat + pad * 2;
  const W = 320,
    H = 200;
  const toX = (lng: number) => ((lng - minLng + pad) / bw) * W;
  const toY = (lat: number) => H - ((lat - minLat + pad) / bh) * H;

  const d = path
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${toX(p[0]).toFixed(1)},${toY(p[1]).toFixed(1)}`
    )
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={styles.routeSvg}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={W} height={H} fill="var(--color-activity-card)" rx="8" />
      <path
        d={d}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <circle
        cx={toX(path[0][0])}
        cy={toY(path[0][1])}
        r="5"
        fill="#22c55e"
        stroke="white"
        strokeWidth="1.5"
      />
      <circle
        cx={toX(path[path.length - 1][0])}
        cy={toY(path[path.length - 1][1])}
        r="5"
        fill="#ef4444"
        stroke="white"
        strokeWidth="1.5"
      />
    </svg>
  );
};

// ── Stat tile ─────────────────────────────────────────────────────────────────
interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}
const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  sub,
  highlight,
}) => (
  <div
    className={`${styles.statTile} ${highlight ? styles.statHighlight : ''}`}
  >
    <span className={styles.statLabel}>{label}</span>
    <span className={styles.statValue}>{value}</span>
    {sub && <span className={styles.statSub}>{sub}</span>}
  </div>
);

// ── Pace split bars ────────────────────────────────────────────────────────────
const PaceLaps: React.FC<{
  run: Activity;
  movingSecs: number;
  distanceKm: number;
}> = ({ run, movingSecs, distanceKm }) => {
  const laps = useMemo(() => {
    const path = pathForRun(run);
    if (!path || path.length < 2 || distanceKm < 1) return [];

    const haversine = (a: [number, number], b: [number, number]): number => {
      const R = 6371000;
      const dLat = ((b[1] - a[1]) * Math.PI) / 180;
      const dLon = ((b[0] - a[0]) * Math.PI) / 180;
      const lat1 = (a[1] * Math.PI) / 180;
      const lat2 = (b[1] * Math.PI) / 180;
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    };

    let totalPolylineM = 0;
    const segLengths: number[] = [];
    for (let i = 1; i < path.length; i++) {
      const d = haversine(
        path[i - 1] as [number, number],
        path[i] as [number, number]
      );
      segLengths.push(d);
      totalPolylineM += d;
    }
    if (totalPolylineM === 0) return [];

    const scale = (distanceKm * 1000) / totalPolylineM;
    const numLaps = Math.floor(distanceKm);
    if (numLaps < 1) return [];

    const secPerMeter = movingSecs / (distanceKm * 1000);
    const lapResults: {
      lap: number;
      paceSec: number;
      paceStr: string;
      fastest: boolean;
    }[] = [];
    let cumDist = 0;
    let lapAccSec = 0;

    for (let i = 0; i < segLengths.length && lapResults.length < numLaps; i++) {
      const segM = segLengths[i] * scale;
      const segSec = segM * secPerMeter;
      const lapEnd = (lapResults.length + 1) * 1000;

      if (cumDist + segM >= lapEnd) {
        const frac = (lapEnd - cumDist) / segM;
        const lapSec = lapAccSec + frac * segSec;
        const pm = Math.floor(lapSec / 60);
        const ps = Math.round(lapSec % 60);
        lapResults.push({
          lap: lapResults.length + 1,
          paceSec: lapSec,
          paceStr: `${pm}:${ps.toString().padStart(2, '0')}`,
          fastest: false,
        });
        lapAccSec = (1 - frac) * segSec;
        cumDist = lapEnd;
      } else {
        lapAccSec += segSec;
        cumDist += segM;
      }
    }

    if (lapResults.length < 2) return [];

    const fastestIdx = lapResults.reduce(
      (bi, l, i) => (l.paceSec < lapResults[bi].paceSec ? i : bi),
      0
    );
    lapResults[fastestIdx].fastest = true;

    // Also find slowest for bar scaling
    const slowestSec = Math.max(...lapResults.map((l) => l.paceSec));
    const fastestSec = Math.min(...lapResults.map((l) => l.paceSec));
    const range = slowestSec - fastestSec || 1;

    return lapResults.map((l) => ({
      ...l,
      barPct: Math.round(60 + ((l.paceSec - fastestSec) / range) * 40), // 60–100%
    }));
  }, [run.run_id]);

  if (laps.length === 0) return null;

  return (
    <div className={styles.lapsSection}>
      <h4 className={styles.lapsTitle}>Estimated Splits</h4>
      <div className={styles.lapsGrid}>
        {laps.map((lap) => (
          <div
            key={lap.lap}
            className={`${styles.lapItem} ${lap.fastest ? styles.lapFastest : ''}`}
          >
            <span className={styles.lapNum}>km {lap.lap}</span>
            <div className={styles.lapBarWrap}>
              <div
                className={`${styles.lapBar} ${lap.fastest ? styles.lapBarFastest : ''}`}
                style={{ height: `${lap.barPct}%` }}
              />
            </div>
            <span className={styles.lapPace}>{lap.paceStr}</span>
            {lap.fastest && <span className={styles.lapTag}>⚡</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────
const RunDetailPanel: React.FC<RunDetailPanelProps> = ({ run }) => {
  const distanceKm = run.distance / 1000;
  const movingSecs = convertMovingTime2Sec(run.moving_time);
  const avgPace = formatPace(run.average_speed);
  const effort = computeEffort(run);
  const { label: actLabel, emoji } = getActivityLabel(run);
  const avgSpeedKmh = run.average_speed * 3.6;
  const calories = run.average_heartrate
    ? Math.round((run.average_heartrate * movingSecs * 0.0175) / 60)
    : null;
  const isLong = distanceKm >= 21;
  const isMarathon = distanceKm >= 42;

  const locationParts = run.location_country
    ? run.location_country
        .split(',')
        .map((s) => s.trim())
        .filter(
          (s) => s.length > 0 && !/^\d/.test(s) && !/[\u4e00-\u9fa5]/.test(s)
        )
        .slice(0, 3)
    : [];
  const locationDisplay = locationParts.join(', ');

  return (
    <div className={styles.panel}>
      {/* ── Header ── */}
      <div className={styles.panelHeader}>
        <div className={styles.activityMeta}>
          <span className={styles.activityBadge}>
            {emoji} {actLabel}
          </span>
          {isMarathon && (
            <span className={styles.achievementBadge}>🏅 Marathon</span>
          )}
          {!isMarathon && isLong && (
            <span className={styles.achievementBadge}>🥈 Half Marathon</span>
          )}
          {run.streak > 1 && (
            <span className={styles.streakBadge}>
              🔥 {run.streak}-day streak
            </span>
          )}
        </div>
        <div className={styles.dateInfo}>
          <span className={styles.dateLabel}>
            {formatDate(run.start_date_local)}
          </span>
          <span className={styles.timeLabel}>
            at {formatTime(run.start_date_local)}
          </span>
          {locationDisplay && (
            <span className={styles.locationLabel}>📍 {locationDisplay}</span>
          )}
        </div>
      </div>

      {/* ── Body: map + stats ── */}
      <div className={styles.panelBody}>
        <div className={styles.mapSection}>
          <RouteMiniMap run={run} />
        </div>

        <div className={styles.statsSection}>
          {/* Primary big-3 */}
          <div className={styles.primaryStats}>
            <StatTile
              label="Distance"
              value={distanceKm.toFixed(2)}
              sub="km"
              highlight
            />
            <StatTile
              label="Moving Time"
              value={formatDuration(movingSecs)}
              highlight
            />
            <StatTile label="Avg Pace" value={avgPace} sub="/ km" highlight />
          </div>

          {/* Secondary */}
          <div className={styles.secondaryStats}>
            <StatTile
              label="Avg Speed"
              value={avgSpeedKmh.toFixed(1)}
              sub="km/h"
            />
            {SHOW_ELEVATION_GAIN && run.elevation_gain != null && (
              <StatTile
                label="Elevation"
                value={run.elevation_gain.toFixed(0)}
                sub="m gain"
              />
            )}
            {run.average_heartrate && (
              <StatTile
                label="Avg Heart Rate"
                value={run.average_heartrate.toFixed(0)}
                sub="bpm"
              />
            )}
            {effort !== null && (
              <StatTile label="Relative Effort" value={effort.toString()} />
            )}
            {calories !== null && (
              <StatTile
                label="Est. Calories"
                value={calories.toString()}
                sub="kcal"
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Splits ── */}
      <div className={styles.paceBreakdown}>
        <PaceLaps run={run} movingSecs={movingSecs} distanceKm={distanceKm} />
      </div>
    </div>
  );
};

export default RunDetailPanel;
