# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Histogram of 100 values with 10 bins has correct array lengths."""
    import numpy as np
    rng = np.random.default_rng(42)
    values = rng.normal(size=100).tolist()
    result = invoke_tool(values=values, bins=10)
    assert len(result["counts"]) == 10
    assert len(result["bin_edges"]) == 11


def test_range_restriction():
    """Histogram with explicit range only counts values within range."""
    import numpy as np
    values = list(range(20))  # 0..19
    result = invoke_tool(values=values, bins=5, range=[0, 10])
    counts = result["counts"]
    assert sum(counts) <= 11  # values 0..10 inclusive


def test_output_types():
    """Counts and bin_edges are numpy arrays."""
    import numpy as np
    result = invoke_tool(values=[1.0, 2.0, 3.0, 4.0], bins=4)
    assert isinstance(result["counts"], np.ndarray)
    assert isinstance(result["bin_edges"], np.ndarray)
