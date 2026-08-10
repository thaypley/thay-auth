/**
 * Zero-dependency Prometheus-style metrics registry.
 *
 * Deliberately tiny: counters, labeled histograms (fixed ms buckets),
 * and function gauges evaluated at scrape time. The hot-path calls
 * (inc/observe) are map lookups + number arithmetic — no allocations
 * beyond the label-key string, which is interned per label set.
 */

const BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

type Labels = Record<string, string>;

interface CounterCell {
  value: number;
}
interface HistogramCell {
  buckets: number[];
  count: number;
  sum: number;
}

/** Interned label-key strings keep per-series overhead to one shared key.
 * Comma-separated + no trailing space — valid Prometheus label set. */
function labelKey(labels: Labels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  keys.sort();
  let out = '';
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) out += ',';
    out += `${keys[i]}="${escapeLabelValue(labels[keys[i]])}"`;
  }
  return out;
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

class Metrics {
  private counters = new Map<string, Map<string, CounterCell>>();
  private histograms = new Map<string, Map<string, HistogramCell>>();
  private gauges = new Map<string, Map<string, { value: number }>>();
  private gaugeFns = new Map<string, () => number>();

  inc(name: string, labels: Labels = {}, by = 1): void {
    let series = this.counters.get(name);
    if (!series) {
      series = new Map();
      this.counters.set(name, series);
    }
    const key = labelKey(labels);
    let cell = series.get(key);
    if (!cell) {
      cell = { value: 0 };
      series.set(key, cell);
    }
    cell.value += by;
  }

  /** valueMs is recorded in ms; rendered as seconds (Prometheus convention). */
  observe(name: string, valueMs: number, labels: Labels = {}): void {
    let series = this.histograms.get(name);
    if (!series) {
      series = new Map();
      this.histograms.set(name, series);
    }
    const key = labelKey(labels);
    let cell = series.get(key);
    if (!cell) {
      cell = { buckets: new Array(BUCKETS_MS.length).fill(0), count: 0, sum: 0 };
      series.set(key, cell);
    }
    for (let i = 0; i < BUCKETS_MS.length; i++) {
      if (valueMs <= BUCKETS_MS[i]) cell.buckets[i] += 1;
    }
    cell.count += 1;
    cell.sum += valueMs;
  }

  setGauge(name: string, labels: Labels, value: number): void {
    let series = this.gauges.get(name);
    if (!series) {
      series = new Map();
      this.gauges.set(name, series);
    }
    const key = labelKey(labels);
    let cell = series.get(key);
    if (!cell) {
      cell = { value: 0 };
      series.set(key, cell);
    }
    cell.value = value;
  }

  /** Function gauge — read at scrape time (process memory, uptime, ...). */
  registerGauge(name: string, read: () => number): void {
    this.gaugeFns.set(name, read);
  }

  render(): string {
    const lines: string[] = [];

    for (const [name, series] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [key, cell] of series) {
        lines.push(`${name}${key ? '{' + key + '}' : ''} ${cell.value}`);
      }
    }

    for (const [name, series] of this.histograms) {
      const base = `${name}_seconds`;
      lines.push(`# TYPE ${base} histogram`);
      for (const [key, cell] of series) {
        for (let i = 0; i < BUCKETS_MS.length; i++) {
          const le = (BUCKETS_MS[i] / 1000).toFixed(3);
          lines.push(`${base}_bucket{le="${le}"${key ? ',' + key : ''}} ${cell.buckets[i]}`);
        }
        lines.push(`${base}_count${key ? '{' + key + '}' : ''} ${cell.count}`);
        lines.push(`${base}_sum${key ? '{' + key + '}' : ''} ${(cell.sum / 1000).toFixed(6)}`);
      }
    }

    for (const [name, series] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      for (const [key, cell] of series) {
        lines.push(`${name}${key ? '{' + key + '}' : ''} ${cell.value}`);
      }
    }

    for (const [name, read] of this.gaugeFns) {
      let v: number;
      try {
        v = read();
      } catch {
        v = 0;
      }
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${Number.isFinite(v) ? v : 0}`);
    }

    return lines.join('\n') + '\n';
  }
}

export const metrics = new Metrics();
export { escapeLabelValue };
