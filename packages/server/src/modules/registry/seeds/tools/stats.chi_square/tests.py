# tests.py -- uses invoke_tool provided by the test runner context

def test_uniform_frequencies():
    """Equal observed counts yield large p-value (consistent with uniform)."""
    import numpy as np
    observed = np.array([25, 25, 25, 25])
    result = invoke_tool(observed=observed)
    assert result["p_value"] > 0.05
    assert result["dof"] == 3


def test_skewed_frequencies():
    """Highly skewed observed counts yield small p-value."""
    import numpy as np
    observed = np.array([100, 1, 1, 1])
    result = invoke_tool(observed=observed)
    assert result["p_value"] < 0.001


def test_output_types():
    """statistic is float, dof is int."""
    import numpy as np
    result = invoke_tool(observed=np.array([10, 20, 30]))
    assert isinstance(result["statistic"], float)
    assert isinstance(result["dof"], int)
