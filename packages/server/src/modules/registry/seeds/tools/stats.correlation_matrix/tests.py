# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Correlation matrix of a two-column DataFrame is 2x2 with 1s on diagonal."""
    import pandas as pd
    df = pd.DataFrame({"a": [1.0, 2.0, 3.0], "b": [3.0, 2.0, 1.0]})
    result = invoke_tool(df=df)
    corr = result["corr"]
    assert corr.shape == (2, 2)
    assert abs(corr.loc["a", "a"] - 1.0) < 1e-10
    assert abs(corr.loc["b", "b"] - 1.0) < 1e-10


def test_perfect_negative_correlation():
    """Perfectly anti-correlated columns yield -1 off-diagonal."""
    import pandas as pd
    df = pd.DataFrame({"x": [1.0, 2.0, 3.0], "y": [3.0, 2.0, 1.0]})
    result = invoke_tool(df=df)
    corr = result["corr"]
    assert abs(corr.loc["x", "y"] - (-1.0)) < 1e-10


def test_spearman_method():
    """Spearman correlation runs without error and returns square matrix."""
    import pandas as pd
    df = pd.DataFrame({"a": [1, 2, 3], "b": [2, 1, 3]})
    result = invoke_tool(df=df, method="spearman")
    assert result["corr"].shape == (2, 2)
