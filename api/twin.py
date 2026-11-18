"""Home twin: nameplate estimate, cooling regression, and Slab Guard forecast.
All numbers come from these functions, never from the LLM."""
from dataclasses import dataclass
from datetime import date
import calendar

BASE_TEMP_C = 24.0  # cooling degree-day base (assumption, tunable)


def nameplate_kwh_per_day(appliances: list[dict]) -> float:
    """appliances: [{'watts': 1500, 'qty': 1, 'hours': 6}, ...]"""
    return sum(a["watts"] * a.get("qty", 1) * a.get("hours", 0) for a in appliances) / 1000.0


def cdd(t_mean_c: float) -> float:
    return max(0.0, t_mean_c - BASE_TEMP_C)


@dataclass
class TwinFit:
    base_kwh_day: float     # b
    cooling_per_cdd: float  # c
    r2: float
    n: int


def fit_twin(daily_kwh: list[float], daily_tmean: list[float]) -> TwinFit:
    """Least squares fit of kWh_d = b + c * CDD_d. Needs >= 7 days."""
    n = len(daily_kwh)
    if n < 7 or n != len(daily_tmean):
        raise ValueError("need >= 7 paired days")
    x = [cdd(t) for t in daily_tmean]
    mx, my = sum(x) / n, sum(daily_kwh) / n
    sxx = sum((xi - mx) ** 2 for xi in x)
    sxy = sum((xi - mx) * (yi - my) for xi, yi in zip(x, daily_kwh))
    c = sxy / sxx if sxx > 0 else 0.0
    b = my - c * mx
    ss_tot = sum((y - my) ** 2 for y in daily_kwh)
    ss_res = sum((y - (b + c * xi)) ** 2 for xi, y in zip(x, daily_kwh))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return TwinFit(round(b, 3), round(max(c, 0.0), 3), round(r2, 3), n)


def cooling_share(fit: TwinFit, tmean_c: float) -> float:
    total = fit.base_kwh_day + fit.cooling_per_cdd * cdd(tmean_c)
    return 0.0 if total <= 0 else fit.cooling_per_cdd * cdd(tmean_c) / total


def slab_forecast(units_so_far: float, today: date, forecast_tmean: list[float], fit: TwinFit) -> float:
    """Projected month-end units = units so far + sum of predicted daily kWh for remaining days.
    forecast_tmean: mean temperature for each remaining day (pad with the last value if short)."""
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    remaining = days_in_month - today.day
    temps = (forecast_tmean + [forecast_tmean[-1]] * remaining)[:remaining] if forecast_tmean else [BASE_TEMP_C] * remaining
    return round(units_so_far + sum(fit.base_kwh_day + fit.cooling_per_cdd * cdd(t) for t in temps), 1)


def ac_peak_saving_kwh(ac_kw: float, hours: float, degrees_raised: float) -> tuple[float, float]:
    """Range for AC set-point raise. duty 0.6-0.9, saving 3-6% per degree C (published guidance: up to 6%)."""
    low = ac_kw * hours * 0.6 * 0.03 * degrees_raised
    high = ac_kw * hours * 0.9 * 0.06 * degrees_raised
    return round(low, 2), round(high, 2)
