"""bill-bachao-mcp: read-only tools for Bill Bachao agents and MCP hosts.
stdio (Claude Desktop / Cursor):  python mcp/server.py
HTTP (agents):                    python mcp/server.py --http   (Streamable HTTP on port 8001)"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "api"))
from fastmcp import FastMCP
from tariff import tariff_calc, marginal_rate
from twin import ac_peak_saving_kwh

mcp = FastMCP("bill-bachao")


@mcp.tool
def tariff_calc_tool(units: float, sanctioned_kw: float = 0.0, demand_rate_tk_per_kw: float = 0.0) -> dict:
    """Monthly Bangladesh residential (LT-A) bill for a number of units, June 2026 BERC rates, incl. 5% VAT."""
    b = tariff_calc(units, sanctioned_kw, demand_rate_tk_per_kw)
    return {**b.__dict__, "next_unit_rate": marginal_rate(units)}


@mcp.tool
def estimate_peak_saving(ac_kw: float, hours: float, degrees_raised: float) -> dict:
    """kWh saved (low-high range) by raising an AC set-point for a peak window."""
    lo, hi = ac_peak_saving_kwh(ac_kw, hours, degrees_raised)
    return {"kwh_low": lo, "kwh_high": hi, "assumptions": "duty 0.6-0.9, 3-6% per degree C"}


if __name__ == "__main__":
    if "--http" in sys.argv:
        mcp.run(transport="http", host="0.0.0.0", port=8001)
    else:
        mcp.run()
