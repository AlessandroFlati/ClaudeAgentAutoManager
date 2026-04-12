# tests.py -- uses invoke_tool provided by the test runner context

def test_median_via_quantile():
    """q=0.5 returns the median."""
    result = invoke_tool(values=[1.0, 2.0, 3.0, 4.0, 5.0], q=0.5)
    assert abs(result["quantile"] - 3.0) < 1e-10


def test_min_max_quantiles():
    """q=0.0 returns minimum, q=1.0 returns maximum."""
    values = [10.0, 20.0, 30.0, 40.0, 50.0]
    r_min = invoke_tool(values=values, q=0.0)
    r_max = invoke_tool(values=values, q=1.0)
    assert abs(r_min["quantile"] - 10.0) < 1e-10
    assert abs(r_max["quantile"] - 50.0) < 1e-10


def test_output_type():
    """Output quantile is a float."""
    result = invoke_tool(values=[1.0, 2.0, 3.0], q=0.25)
    assert isinstance(result["quantile"], float)
