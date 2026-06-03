import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ActivityLap,
  ActivityStreams,
  convertMovingTime2Sec,
  formatPace,
  pathForRun,
} from '@/utils/utils';
import { SHOW_ELEVATION_GAIN } from '@/utils/const';
import styles from './RunDetailPanel.module.css';

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0)
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
};

const fmtDate = (d: string) =>
  new Date(d.replace(' ', 'T')).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const fmtTime = (d: string) =>
  new Date(d.replace(' ', 'T')).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

const getLabel = (run: Activity): { label: string; emoji: string } => {
  const t = run.type?.toLowerCase();
  const km = run.distance / 1000;
  if (t === 'run') {
    if (km >= 42) return { label: 'Marathon', emoji: '🏅' };
    if (km >= 21) return { label: 'Half Marathon', emoji: '🥈' };
    if (run.subtype?.toLowerCase() === 'trail')
      return { label: 'Trail Run', emoji: '⛰️' };
    return { label: 'Run', emoji: '🏃' };
  }
  if (t === 'cycling' || t === 'ride') return { label: 'Ride', emoji: '🚴' };
  if (t === 'hiking') return { label: 'Hike', emoji: '🥾' };
  if (t === 'walk' || t === 'walking') return { label: 'Walk', emoji: '🚶' };
  if (t === 'swimming') return { label: 'Swim', emoji: '🏊' };
  return { label: run.type || 'Activity', emoji: '🏅' };
};

// ─── mini route map ────────────────────────────────────────────────────────────

const RouteMiniMap: React.FC<{ run: Activity }> = ({ run }) => {
  const path = useMemo(() => pathForRun(run), [run.run_id]);
  if (!path || path.length < 2)
    return (
      <div className={styles.noRoute}>
        <span>No GPS data</span>
      </div>
    );

  const lngs = path.map((p) => p[0]);
  const lats = path.map((p) => p[1]);
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
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

// ─── stat tile ─────────────────────────────────────────────────────────────────

const StatTile: React.FC<{
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}> = ({ label, value, sub, highlight }) => (
  <div
    className={`${styles.statTile} ${highlight ? styles.statHighlight : ''}`}
  >
    <span className={styles.statLabel}>{label}</span>
    <span className={styles.statValue}>{value}</span>
    {sub && <span className={styles.statSub}>{sub}</span>}
  </div>
);

// ─── real laps table ───────────────────────────────────────────────────────────

const LapsTable: React.FC<{ laps: ActivityLap[] }> = ({ laps }) => {
  const fastestIdx = laps.reduce(
    (bi, l, i) =>
      l.average_speed !== null &&
      (laps[bi].average_speed === null ||
        l.average_speed > laps[bi].average_speed)
        ? i
        : bi,
    0
  );

  return (
    <div className={styles.lapsSection}>
      <h4 className={styles.sectionTitle}>Splits</h4>
      <div className={styles.lapsTableWrap}>
        <table className={styles.lapsTable}>
          <thead>
            <tr>
              <th>Lap</th>
              <th>Distance</th>
              <th>Time</th>
              <th>Pace</th>
              {laps.some((l) => l.average_heartrate) && <th>Avg HR</th>}
              {laps.some((l) => l.max_heartrate) && <th>Max HR</th>}
              {laps.some((l) => l.total_elevation_gain) && <th>Elev</th>}
              {laps.some((l) => l.average_cadence) && <th>Cadence</th>}
            </tr>
          </thead>
          <tbody>
            {laps.map((lap, i) => {
              const pace =
                lap.average_speed && lap.average_speed > 0
                  ? formatPace(lap.average_speed)
                  : '—';
              const isFastest = i === fastestIdx;
              return (
                <tr
                  key={lap.lap_index}
                  className={isFastest ? styles.lapRowFastest : ''}
                >
                  <td className={styles.lapNum}>
                    {isFastest && <span className={styles.fastTag}>⚡</span>}
                    {lap.name || `Lap ${lap.lap_index}`}
                  </td>
                  <td>{(lap.distance / 1000).toFixed(2)} km</td>
                  <td>{fmtDuration(lap.moving_time)}</td>
                  <td>{pace}</td>
                  {laps.some((l) => l.average_heartrate) && (
                    <td>{lap.average_heartrate?.toFixed(0) ?? '—'}</td>
                  )}
                  {laps.some((l) => l.max_heartrate) && (
                    <td>{lap.max_heartrate?.toFixed(0) ?? '—'}</td>
                  )}
                  {laps.some((l) => l.total_elevation_gain) && (
                    <td>
                      {lap.total_elevation_gain !== null
                        ? `↑${lap.total_elevation_gain.toFixed(0)}m`
                        : '—'}
                    </td>
                  )}
                  {laps.some((l) => l.average_cadence) && (
                    <td>
                      {lap.average_cadence !== null
                        ? `${(lap.average_cadence * 2).toFixed(0)} spm`
                        : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── streams charts ────────────────────────────────────────────────────────────

interface ChartPoint {
  dist: number; // km
  altitude?: number;
  heartrate?: number;
  pace?: number; // sec/km (for display, inverted)
  paceStr?: string;
}

// Downsample to at most `maxPts` points to keep charts fast
const downsample = <T,>(arr: T[], maxPts: number): T[] => {
  if (arr.length <= maxPts) return arr;
  const step = arr.length / maxPts;
  return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
};

const buildChartData = (streams: ActivityStreams): ChartPoint[] => {
  const dist = streams.distance;
  if (!dist || dist.length === 0) return [];

  const raw: ChartPoint[] = dist.map((d, i) => {
    const alt = streams.altitude?.[i];
    const hr = streams.heartrate?.[i];
    const vel = streams.velocity_smooth?.[i]; // m/s
    let pace: number | undefined;
    let paceStr: string | undefined;
    if (vel && vel > 0.5) {
      const secPerKm = 1000 / vel;
      pace = secPerKm;
      const m = Math.floor(secPerKm / 60);
      const s = Math.round(secPerKm % 60);
      paceStr = `${m}:${s.toString().padStart(2, '0')}`;
    }
    return {
      dist: Math.round((d / 1000) * 100) / 100,
      ...(alt !== undefined ? { altitude: Math.round(alt * 10) / 10 } : {}),
      ...(hr !== undefined ? { heartrate: Math.round(hr) } : {}),
      ...(pace !== undefined ? { pace, paceStr } : {}),
    };
  });

  return downsample(raw, 500);
};

const CHART_COLORS = {
  altitude: '#60a5fa',
  heartrate: '#f87171',
  pace: '#e0ed5e',
};

const chartTooltipStyle = {
  background: 'var(--color-activity-card)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
  fontSize: '0.75rem',
  color: 'var(--color-run-table-thead)',
};

const StreamCharts: React.FC<{ streams: ActivityStreams }> = ({ streams }) => {
  const data = useMemo(() => buildChartData(streams), [streams]);
  if (data.length === 0) return null;

  const hasAlt = data.some((p) => p.altitude !== undefined);
  const hasHR = data.some((p) => p.heartrate !== undefined);
  const hasPace = data.some((p) => p.pace !== undefined);

  if (!hasAlt && !hasHR && !hasPace) return null;

  return (
    <div className={styles.chartsSection}>
      <h4 className={styles.sectionTitle}>Activity Charts</h4>
      <div className={styles.chartsGrid}>
        {/* Elevation chart */}
        {hasAlt && (
          <div className={styles.chartCard}>
            <span className={styles.chartLabel}>Elevation</span>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart
                data={data}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradAlt" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={CHART_COLORS.altitude}
                      stopOpacity={0.4}
                    />
                    <stop
                      offset="95%"
                      stopColor={CHART_COLORS.altitude}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="dist"
                  tick={{ fontSize: 9, fill: 'var(--color-run-date)' }}
                  tickFormatter={(v) => `${v}km`}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'var(--color-run-date)' }}
                  tickFormatter={(v) => `${v}m`}
                  width={42}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v: number) => [`${v}m`, 'Altitude']}
                  labelFormatter={(v) => `${v} km`}
                />
                <Area
                  type="monotone"
                  dataKey="altitude"
                  stroke={CHART_COLORS.altitude}
                  strokeWidth={1.5}
                  fill="url(#gradAlt)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Heart rate chart */}
        {hasHR && (
          <div className={styles.chartCard}>
            <span className={styles.chartLabel}>Heart Rate</span>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart
                data={data}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradHR" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={CHART_COLORS.heartrate}
                      stopOpacity={0.4}
                    />
                    <stop
                      offset="95%"
                      stopColor={CHART_COLORS.heartrate}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="dist"
                  tick={{ fontSize: 9, fill: 'var(--color-run-date)' }}
                  tickFormatter={(v) => `${v}km`}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'var(--color-run-date)' }}
                  tickFormatter={(v) => `${v}`}
                  width={36}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v: number) => [`${v} bpm`, 'Heart Rate']}
                  labelFormatter={(v) => `${v} km`}
                />
                <Area
                  type="monotone"
                  dataKey="heartrate"
                  stroke={CHART_COLORS.heartrate}
                  strokeWidth={1.5}
                  fill="url(#gradHR)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Pace chart */}
        {hasPace && (
          <div className={styles.chartCard}>
            <span className={styles.chartLabel}>Pace</span>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart
                data={data}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradPace" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={CHART_COLORS.pace}
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor={CHART_COLORS.pace}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="dist"
                  tick={{ fontSize: 9, fill: 'var(--color-run-date)' }}
                  tickFormatter={(v) => `${v}km`}
                  interval="preserveStartEnd"
                />
                <YAxis
                  reversed
                  tick={{ fontSize: 9, fill: 'var(--color-run-date)' }}
                  tickFormatter={(v: number) => {
                    const m = Math.floor(v / 60);
                    const s = Math.round(v % 60);
                    return `${m}:${s.toString().padStart(2, '0')}`;
                  }}
                  width={42}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(_v: number, _n: string, item) => {
                    const pt = (item as { payload?: ChartPoint })?.payload;
                    return [pt?.paceStr ?? '—', 'Pace'];
                  }}
                  labelFormatter={(v) => `${v} km`}
                />
                <Area
                  type="monotone"
                  dataKey="pace"
                  stroke={CHART_COLORS.pace}
                  strokeWidth={1.5}
                  fill="url(#gradPace)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── main panel ────────────────────────────────────────────────────────────────

const RunDetailPanel: React.FC<{ run: Activity }> = ({ run }) => {
  const distKm = run.distance / 1000;
  const movingSecs = convertMovingTime2Sec(run.moving_time);
  const avgPace = formatPace(run.average_speed);
  const avgSpeedKmh = run.average_speed * 3.6;
  const { label: actLabel, emoji } = getLabel(run);

  const effort = run.average_heartrate
    ? Math.min(Math.round((run.average_heartrate * movingSecs) / 5000), 999)
    : null;
  const calories = run.average_heartrate
    ? Math.round((run.average_heartrate * movingSecs * 0.0175) / 60)
    : null;

  const locationDisplay = (run.location_country ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\d/.test(s) && !/[\u4e00-\u9fa5]/.test(s))
    .slice(0, 3)
    .join(', ');

  const hasRealLaps = run.laps && run.laps.length > 0;
  const hasStreams =
    run.streams &&
    (run.streams.altitude?.length ||
      run.streams.heartrate?.length ||
      run.streams.velocity_smooth?.length);

  return (
    <div className={styles.panel}>
      {/* header */}
      <div className={styles.panelHeader}>
        <div className={styles.activityMeta}>
          <span className={styles.activityBadge}>
            {emoji} {actLabel}
          </span>
          {distKm >= 42 && (
            <span className={styles.achievementBadge}>🏅 Marathon</span>
          )}
          {distKm >= 21 && distKm < 42 && (
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
            {fmtDate(run.start_date_local)}
          </span>
          <span className={styles.timeLabel}>
            at {fmtTime(run.start_date_local)}
          </span>
          {locationDisplay && (
            <span className={styles.locationLabel}>📍 {locationDisplay}</span>
          )}
        </div>
      </div>

      {/* map + stats */}
      <div className={styles.panelBody}>
        <div className={styles.mapSection}>
          <RouteMiniMap run={run} />
        </div>
        <div className={styles.statsSection}>
          <div className={styles.primaryStats}>
            <StatTile
              label="Distance"
              value={distKm.toFixed(2)}
              sub="km"
              highlight
            />
            <StatTile
              label="Moving Time"
              value={fmtDuration(movingSecs)}
              highlight
            />
            <StatTile label="Avg Pace" value={avgPace} sub="/ km" highlight />
          </div>
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

      {/* real splits */}
      {hasRealLaps && <LapsTable laps={run.laps!} />}

      {/* streams charts */}
      {hasStreams && <StreamCharts streams={run.streams!} />}
    </div>
  );
};

export default RunDetailPanel;
