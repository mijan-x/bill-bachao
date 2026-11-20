// Same checks as tests/test_tariff.py and tests/test_twin.py, run against the browser logic (web/logic.js),
// plus the heat-safety rules that only exist in the browser demo today.
// Run: node --test tests/logic.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
require(path.join(__dirname, "..", "web", "logic.js"));
const BB = globalThis.BB;
const r2 = (x) => Math.round(x * 100) / 100;

test("lifeline: all units at Tk 4.63 when total <= 50", () => {
  assert.equal(BB.tariff(50).energy, r2(50 * 4.63));
});

test("51 units leaves lifeline", () => {
  assert.equal(BB.tariff(51).energy, r2(51 * 5.26));
});

test("progressive blocks at 350 units", () => {
  assert.equal(BB.tariff(350).energy, r2(75 * 5.26 + 125 * 8.5 + 100 * 9.1 + 50 * 9.62));
});

test("crossing 400 costs Tk 15.01 per extra unit", () => {
  assert.equal(r2(BB.tariff(401).energy - BB.tariff(400).energy), 15.01);
  assert.equal(BB.marginalRate(400), 15.01);
  assert.equal(BB.marginalRate(399), 9.62);
});

test("VAT and demand charge", () => {
  const b = BB.tariff(100, 2, 42);
  assert.equal(b.demand, 84);
  assert.equal(b.vat, r2((b.energy + 84) * 0.05));
});

test("units to next slab", () => {
  assert.equal(BB.tariff(370).toNext, 30);
});

test("Python and JS agree: 412 units -> Tk 3,684.58", () => {
  assert.equal(BB.tariff(412).total, 3684.58);
});

test("nameplate kWh per day", () => {
  assert.equal(BB.nameplate([{ watts: 1500, qty: 1, hours: 6 }, { watts: 75, qty: 4, hours: 10 }]), 12);
});

test("twin regression recovers a known line", () => {
  const temps = [25, 27, 29, 31, 33, 30, 28, 26];
  const f = BB.fitTwin(temps.map((t) => 6 + 1.5 * Math.max(0, t - 24)), temps);
  assert.ok(Math.abs(f.b - 6) < 1e-6 && Math.abs(f.c - 1.5) < 1e-6 && f.r2 > 0.99);
});

test("AC saving range is ordered and positive", () => {
  const [lo, hi] = BB.acSaving(1.5, 2, 2);
  assert.ok(lo > 0 && lo < hi);
});

test("safety: lifeline homes never get a challenge", () => {
  assert.deepEqual(BB.safeSetpoint(false, 30, true), { allowed: false, reason: "lifeline" });
});

test("safety: vulnerable member + heat index above 41 C -> no challenge", () => {
  assert.deepEqual(BB.safeSetpoint(true, 42, false), { allowed: false, reason: "heat" });
});

test("safety: AC cap is 26 C with a vulnerable member, 27 C otherwise", () => {
  assert.equal(BB.safeSetpoint(true, 38, false).maxC, 26);
  assert.equal(BB.safeSetpoint(false, 45, false).maxC, 27);
});
