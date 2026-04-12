# tests.py -- uses invoke_tool provided by the test runner context

def test_normal_vs_normal():
    """Samples from N(0,1) are compatible with 'norm'; p-value should be large."""
    import numpy as np
    rng = np.random.default_rng(0)
    values = rng.normal(size=200)
    result = invoke_tool(values=values, distribution="norm")
    assert result["p_value"] > 0.05


def test_uniform_vs_normal():
    """Uniform samples are clearly not normal; p-value should be very small."""
    import numpy as np
    rng = np.random.default_rng(1)
    values = rng.uniform(0, 1, size=200)
    result = invoke_tool(values=values, distribution="norm")
    assert result["p_value"] < 0.001


def test_output_types():
    """statistic and p_value are floats."""
    import numpy as np
    result = invoke_tool(values=np.array([0.1, 0.5, 0.9]), distribution="uniform")
    assert isinstance(result["statistic"], float)
    assert isinstance(result["p_value"], float)
