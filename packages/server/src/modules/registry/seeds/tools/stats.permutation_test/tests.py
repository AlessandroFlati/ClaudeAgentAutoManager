# tests.py -- uses invoke_tool provided by the test runner context

def test_mean_diff_same_samples():
    """Permutation test on identical samples has statistic near 0."""
    import numpy as np
    sample = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    result = invoke_tool(
        sample_a=sample,
        sample_b=sample,
        statistic="mean_diff",
        n_resamples=999,
    )
    assert abs(result["statistic"]) < 1e-10


def test_mean_diff_different_samples():
    """Permutation test on very different samples yields small p-value."""
    import numpy as np
    a = np.zeros(30)
    b = np.ones(30) * 5.0
    result = invoke_tool(
        sample_a=a,
        sample_b=b,
        statistic="mean_diff",
        n_resamples=999,
    )
    assert result["p_value"] < 0.05


def test_output_types():
    """statistic and p_value are floats."""
    import numpy as np
    result = invoke_tool(
        sample_a=np.array([1.0, 2.0, 3.0]),
        sample_b=np.array([4.0, 5.0, 6.0]),
        statistic="mean_diff",
        n_resamples=99,
    )
    assert isinstance(result["statistic"], float)
    assert isinstance(result["p_value"], float)
