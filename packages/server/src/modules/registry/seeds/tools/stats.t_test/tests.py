# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """t-test of identical samples yields p-value of 1.0."""
    import numpy as np
    sample = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    result = invoke_tool(sample_a=sample, sample_b=sample)
    assert abs(result["p_value"] - 1.0) < 1e-10
    assert abs(result["statistic"]) < 1e-10


def test_clearly_different_samples():
    """Clearly separated samples yield very small p-value."""
    import numpy as np
    a = np.zeros(50)
    b = np.ones(50) * 100.0
    result = invoke_tool(sample_a=a, sample_b=b)
    assert result["p_value"] < 0.001


def test_output_types():
    """statistic and p_value are floats."""
    import numpy as np
    result = invoke_tool(
        sample_a=np.array([1.0, 2.0, 3.0]),
        sample_b=np.array([4.0, 5.0, 6.0]),
    )
    assert isinstance(result["statistic"], float)
    assert isinstance(result["p_value"], float)
