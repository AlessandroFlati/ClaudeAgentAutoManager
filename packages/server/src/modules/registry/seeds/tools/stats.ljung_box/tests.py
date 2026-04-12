# tests.py -- uses invoke_tool provided by the test runner context

def test_white_noise():
    """Ljung-Box on white noise residuals yields large p-value (no autocorrelation)."""
    import numpy as np
    rng = np.random.default_rng(0)
    residuals = rng.normal(size=200)
    result = invoke_tool(residuals=residuals, lags=10)
    assert result["p_value"] > 0.05


def test_autocorrelated_residuals():
    """AR(1) residuals exhibit autocorrelation; Ljung-Box p-value should be small."""
    import numpy as np
    rng = np.random.default_rng(1)
    n = 200
    residuals = np.zeros(n)
    for i in range(1, n):
        residuals[i] = 0.9 * residuals[i - 1] + rng.normal()
    result = invoke_tool(residuals=residuals, lags=10)
    assert result["p_value"] < 0.05


def test_output_types():
    """statistic and p_value are floats."""
    import numpy as np
    result = invoke_tool(residuals=np.random.default_rng(2).normal(size=50), lags=5)
    assert isinstance(result["statistic"], float)
    assert isinstance(result["p_value"], float)
