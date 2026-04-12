# tests.py -- uses invoke_tool provided by the test runner context

def test_stationary_series():
    """White noise is stationary; ADF p-value should be small."""
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng(0)
    series = pd.Series(rng.normal(size=200))
    result = invoke_tool(series=series)
    assert result["p_value"] < 0.05
    assert isinstance(result["critical_values"], dict)


def test_random_walk_nonstationary():
    """A random walk is typically non-stationary; ADF p-value should be large."""
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng(1)
    series = pd.Series(rng.normal(size=200).cumsum())
    result = invoke_tool(series=series)
    assert result["p_value"] > 0.05


def test_output_structure():
    """All three outputs are present and critical_values has expected keys."""
    import numpy as np
    import pandas as pd
    series = pd.Series(np.random.default_rng(2).normal(size=100))
    result = invoke_tool(series=series)
    assert "statistic" in result
    assert "p_value" in result
    assert "critical_values" in result
    assert "5%" in result["critical_values"]
