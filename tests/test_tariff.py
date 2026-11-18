import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "api"))
from tariff import tariff_calc, marginal_rate


def test_lifeline_all_units_at_lifeline_rate():
    b = tariff_calc(50)
    assert b.energy_tk == round(50 * 4.63, 2)


def test_51_units_leaves_lifeline():
    assert tariff_calc(51).energy_tk == round(51 * 5.26, 2)


def test_progressive_blocks_350_units():
    expected = 75 * 5.26 + 125 * 8.50 + 100 * 9.10 + 50 * 9.62
    assert tariff_calc(350).energy_tk == round(expected, 2)


def test_crossing_400_costs_15_01_per_extra_unit():
    assert round(tariff_calc(401).energy_tk - tariff_calc(400).energy_tk, 2) == 15.01
    assert marginal_rate(400) == 15.01
    assert marginal_rate(399) == 9.62


def test_vat_and_demand_charge():
    b = tariff_calc(100, sanctioned_kw=2, demand_rate_tk_per_kw=42)
    assert b.demand_tk == 84
    assert b.vat_tk == round((b.energy_tk + 84) * 0.05, 2)


def test_units_to_next_slab():
    assert tariff_calc(370).units_to_next_slab == 30

# TODO (team): add 3 REAL bills from your families here, e.g.
# def test_real_bill_rina_aug():  assert tariff_calc(412, 2, <rate on bill>).total_tk == <bill total>
