"""Creates SIMULATED demo data (no real personal data) for the public demo.
Output: scripts/demo_readings.csv  (household 'Rina (simulated)', 60 days)"""
import csv, random
from datetime import date, timedelta

random.seed(7)
start, kwh_total = date(2026, 8, 1), 18250.0
rows = []
for i in range(60):
    d = start + timedelta(days=i)
    t_mean = 31 + random.uniform(-2.5, 2.5) - (i / 60) * 3  # slowly cooling toward autumn
    daily = 6.0 + 1.4 * max(0, t_mean - 24) + random.uniform(-0.8, 0.8)
    kwh_total += daily
    rows.append({"date": d.isoformat(), "t_mean": round(t_mean, 1), "kwh_day": round(daily, 2),
                 "kwh_cumulative": round(kwh_total, 1), "source": "simulated"})
with open("scripts/demo_readings.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
print("wrote", len(rows), "simulated days")
