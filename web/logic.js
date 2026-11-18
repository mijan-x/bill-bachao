// Bill Bachao core logic (mirrors api/tariff.py and api/twin.py; same unit tests)
(function (root) {
  const LIFELINE_MAX = 50, LIFELINE_RATE = 4.63, VAT = 0.05;
  const SLABS = [[75, 5.26], [200, 8.50], [300, 9.10], [400, 9.62], [600, 15.01], [Infinity, 17.35]];
  const r2 = x => Math.round(x * 100) / 100;

  function tariff(units, kw = 0, demandRate = 0) {
    let energy = 0, blocks = [], rate = SLABS[5][1], toNext = null;
    if (units <= LIFELINE_MAX) {
      energy = units * LIFELINE_RATE; rate = LIFELINE_RATE; toNext = LIFELINE_MAX - units;
      blocks.push({ from: 0, to: units, units, rate, tk: r2(energy) });
    } else {
      let lower = 0;
      for (const [upper, rt] of SLABS) {
        if (units > lower) {
          const inb = Math.min(units, upper) - lower;
          energy += inb * rt;
          blocks.push({ from: lower, to: Math.min(units, upper), units: inb, rate: rt, tk: r2(inb * rt) });
          if (units <= upper) { rate = rt; toNext = upper === Infinity ? null : upper - units; }
        }
        lower = upper;
      }
    }
    const demand = kw * demandRate, vat = (energy + demand) * VAT;
    return { units, energy: r2(energy), demand: r2(demand), vat: r2(vat), total: r2(energy + demand + vat), blocks, rate, toNext };
  }
  function marginalRate(units) {
    if (units < LIFELINE_MAX) return LIFELINE_RATE;
    for (const [upper, rt] of SLABS) if (units < upper) return rt;
    return SLABS[5][1];
  }
  const BASE = 24, cdd = t => Math.max(0, t - BASE);
  function fitTwin(kwh, temps) {
    const n = kwh.length, x = temps.map(cdd);
    const mx = x.reduce((a, b) => a + b, 0) / n, my = kwh.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0; x.forEach((xi, i) => { sxx += (xi - mx) ** 2; sxy += (xi - mx) * (kwh[i] - my); });
    const c = sxx > 0 ? sxy / sxx : 0, b = my - c * mx;
    let st = 0, sr = 0; kwh.forEach((y, i) => { st += (y - my) ** 2; sr += (y - (b + c * x[i])) ** 2; });
    return { b, c: Math.max(c, 0), r2: st > 0 ? 1 - sr / st : 0, n };
  }
  const nameplate = list => list.reduce((s, a) => s + a.watts * (a.qty || 1) * (a.hours || 0), 0) / 1000;
  function acSaving(kw, hours, deg) { return [r2(kw * hours * 0.6 * 0.03 * deg), r2(kw * hours * 0.9 * 0.06 * deg)]; }
  function safeSetpoint(vulnerable, heatIndex, lifeline) {
    if (lifeline) return { allowed: false, reason: "lifeline" };
    if (vulnerable && heatIndex > 41) return { allowed: false, reason: "heat" };
    return { allowed: true, maxC: vulnerable ? 26 : 27 };
  }
  root.BB = { tariff, marginalRate, fitTwin, nameplate, acSaving, safeSetpoint, cdd };
})(typeof window !== "undefined" ? window : globalThis);
