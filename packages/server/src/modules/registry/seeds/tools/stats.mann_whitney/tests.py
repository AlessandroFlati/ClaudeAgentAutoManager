# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Mann-Whitney U between clearly separated groups yields small p-value."""
    import numpy as np
    a = np.arange(1, 21, dtype=float)
    b = np.arange(21, 41, dtype=float)
    result = invoke_tool(sample_a=a, sample_b=b)
    assert result["p_value"] < 0.001


def test_identical_samples():
    """Mann-Whitney U of identical samples yields large p-value."""
    import numpy as np
    sample = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    result = invoke_tool(sample_a=sample, sample_b=sample)
    assert result["p_value"] > 0.05


def test_output_types():
    """statistic and p_value are floats."""
    import numpy as np
    result = invoke_tool(
        sample_a=np.array([1.0, 2.0, 3.0]),
        sample_b=np.array([4.0, 5.0, 6.0]),
    )
    assert isinstance(result["statistic"], float)
    assert isinstance(result["p_value"], float)
