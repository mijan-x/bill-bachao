import asyncio, json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "mcp"))
from fastmcp import Client
import server


def _call(name, args):
    async def run():
        async with Client(server.mcp) as c:
            tools = {t.name for t in await c.list_tools()}
            r = await c.call_tool(name, args)
            return tools, json.loads(r.content[0].text)
    return asyncio.run(run())


def test_mcp_tariff_tool():
    tools, out = _call("tariff_calc_tool", {"units": 412})
    assert tools == {"tariff_calc_tool", "estimate_peak_saving"}
    assert out["total_tk"] == 3684.58


def test_mcp_peak_saving_tool():
    _, out = _call("estimate_peak_saving", {"ac_kw": 1.5, "hours": 2, "degrees_raised": 2})
    assert 0 < out["kwh_low"] < out["kwh_high"]   # 1.5 kW AC, 2 h, +2 C -> 0.11 to 0.32 kWh
    assert "per degree" in out["assumptions"]
