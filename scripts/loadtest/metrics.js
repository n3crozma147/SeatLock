/** Counters plus latency samples, summarised as percentiles. */
export class Metrics {
  constructor() {
    this.counters = new Map();
    this.samples = new Map();
  }

  count(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  record(name, ms) {
    if (!this.samples.has(name)) this.samples.set(name, []);
    this.samples.get(name).push(ms);
  }

  async time(name, fn) {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.record(name, performance.now() - start);
    }
  }

  counterTable() {
    return Object.fromEntries([...this.counters].sort(([a], [b]) => a.localeCompare(b)));
  }

  latencyTable() {
    const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    const rows = {};
    for (const [name, values] of this.samples) {
      const sorted = [...values].sort((a, b) => a - b);
      rows[name] = {
        n: sorted.length,
        'p50 ms': Math.round(pct(sorted, 50)),
        'p95 ms': Math.round(pct(sorted, 95)),
        'p99 ms': Math.round(pct(sorted, 99)),
        'max ms': Math.round(sorted.at(-1)),
      };
    }
    return rows;
  }
}
