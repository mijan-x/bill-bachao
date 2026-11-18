"""Bangladesh residential (LT-A) electricity tariff calculator.

Rates: BERC order effective from the June 2026 billing cycle.
Verify against a real bill before relying on it; keep rates in the
`tariff_slabs` table in production and load them from there.
"""
from dataclasses import dataclass

LIFELINE_MAX_UNITS = 50
LIFELINE_RATE = 4.63  # Tk/kWh, applies to ALL units when monthly use <= 50

# (upper unit of block, Tk per kWh). Progressive: each block is charged at its own rate.
SLABS = [
    (75, 5.26),
    (200, 8.50),
    (300, 9.10),
    (400, 9.62),
    (600, 15.01),
    (float("inf"), 17.35),
]
VAT_RATE = 0.05


@dataclass
class BillBreakdown:
    units: float
    energy_tk: float
    demand_tk: float
    vat_tk: float
    total_tk: float
    blocks: list  # [(from_unit, to_unit, units_in_block, rate, tk)]
    current_slab_rate: float
    units_to_next_slab: float | None


def tariff_calc(units: float, sanctioned_kw: float = 0.0, demand_rate_tk_per_kw: float = 0.0) -> BillBreakdown:
    """Compute a monthly residential bill.

    demand_rate_tk_per_kw: demand charge per sanctioned kW (check your bill; it is configurable).
    """
    if units < 0:
        raise ValueError("units must be >= 0")
    blocks = []
    if units <= LIFELINE_MAX_UNITS:
        energy = units * LIFELINE_RATE
        blocks.append((0, units, units, LIFELINE_RATE, round(energy, 2)))
        current_rate, to_next = LIFELINE_RATE, LIFELINE_MAX_UNITS - units
    else:
        energy, lower = 0.0, 0.0
        current_rate, to_next = SLABS[-1][1], None
        for upper, rate in SLABS:
            if units > lower:
                in_block = min(units, upper) - lower
                tk = in_block * rate
                energy += tk
                blocks.append((lower, min(units, upper), in_block, rate, round(tk, 2)))
                if units <= upper:
                    current_rate = rate
                    to_next = None if upper == float("inf") else upper - units
            lower = upper
    demand = sanctioned_kw * demand_rate_tk_per_kw
    vat = (energy + demand) * VAT_RATE
    total = energy + demand + vat
    return BillBreakdown(
        units=units,
        energy_tk=round(energy, 2),
        demand_tk=round(demand, 2),
        vat_tk=round(vat, 2),
        total_tk=round(total, 2),
        blocks=blocks,
        current_slab_rate=current_rate,
        units_to_next_slab=to_next,
    )


def marginal_rate(units: float) -> float:
    """Tk per kWh for the NEXT unit used."""
    if units < LIFELINE_MAX_UNITS:
        return LIFELINE_RATE
    for upper, rate in SLABS:
        if units < upper:
            return rate
    return SLABS[-1][1]
