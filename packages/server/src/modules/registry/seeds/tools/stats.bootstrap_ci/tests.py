# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Bootstrap CI for a known-mean sample should contain the true mean."""
    import numpy as np
    rng = np.random.default_rng(0)
    data = rng.normal(loc=5.0, scale=1.0, size=100)
    result = invoke_tool(data=data, confidence=0.95, n_resamples=1000)
    assert result["ci_low"] < 5.0 < result["ci_high"]


def test_ci_ordering():
    """ci_low is strictly less than ci_high."""
    import numpy as np
    data = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
    result = invoke_tool(data=data, confidence=0.90, n_resamples=500)
    assert result["ci_low"] < result["ci_high"]


def test_output_types():
    """ci_low and ci_high are floats."""
    import numpy as np
    result = invoke_tool(
        data=np.array([1.0, 2.0, 3.0, 4.0, 5.0]),
        confidence=0.95,
        n_resamples=200,
    )
    assert isinstance(result["ci_low"], float)
    assert isinstance(result["ci_high"], float)
