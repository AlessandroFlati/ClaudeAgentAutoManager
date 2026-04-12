# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """ACF at lag 0 equals 1.0 for any series."""
    import pandas as pd
    series = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0, 4.0, 3.0, 2.0, 1.0])
    result = invoke_tool(series=series, nlags=4)
    acf = result["acf"]
    assert abs(acf[0] - 1.0) < 1e-10
    assert len(acf) == 5  # lags 0..4


def test_output_length():
    """ACF length equals nlags + 1."""
    import numpy as np
    import pandas as pd
    series = pd.Series(np.random.default_rng(0).normal(size=50))
    result = invoke_tool(series=series, nlags=10)
    assert len(result["acf"]) == 11


def test_output_type():
    """Output acf is a numpy array."""
    import numpy as np
    import pandas as pd
    result = invoke_tool(series=pd.Series([1.0, 2.0, 3.0, 2.0, 1.0]), nlags=2)
    assert isinstance(result["acf"], np.ndarray)
