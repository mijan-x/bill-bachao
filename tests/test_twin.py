import sys, pathlib
from datetime import date
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "api"))
from twin import fit_twin, nameplate_kwh_per_day, slab_forecast, ac_peak_saving_kwh


def test_nameplate():
    assert nameplate_kwh_per_day([{"watts": 1500, "qty": 1, "hours": 6}, {"watts": 75, "qty": 4, "hours": 10}]) == 12.0


def test_fit_recovers_known_line():
    temps = [25, 27, 29, 31, 33, 30, 28, 26]
    kwh = [6 + 1.5 * max(0, t - 24) for t in temps]
    f = fit_twin(kwh, temps)
    assert abs(f.base_kwh_day - 6) < 1e-6 and abs(f.cooling_per_cdd - 1.5) < 1e-6 and f.r2 > 0.99


def test_slab_forecast():
    temps = [25, 27, 29, 31, 33, 30, 28, 26]
    f = fit_twin([6 + 1.5 * max(0, t - 24) for t in temps], temps)
    proj = slab_forecast(300, date(2026, 8, 22), [30.0], f)  # 9 days left, 6+1.5*6=15/day
    assert proj == 300 + 9 * 15


def test_saving_range_ordered():
    lo, hi = ac_peak_saving_kwh(1.5, 2, 2)
    assert 0 < lo < hi
