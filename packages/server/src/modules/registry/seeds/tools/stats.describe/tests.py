# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Describe a two-column DataFrame and verify output shape."""
    import pandas as pd
    df = pd.DataFrame({"a": [1.0, 2.0, 3.0, 4.0], "b": [10.0, 20.0, 30.0, 40.0]})
    result = invoke_tool(df=df)
    stats = result["stats"]
    assert isinstance(stats, pd.DataFrame)
    assert stats.shape[1] == 2  # two columns described
    assert "mean" in stats.index


def test_custom_percentiles():
    """Custom percentiles appear in the output index."""
    import pandas as pd
    df = pd.DataFrame({"x": range(100)})
    result = invoke_tool(df=df, percentiles=[0.1, 0.5, 0.9])
    stats = result["stats"]
    assert "10%" in stats.index or any("10" in str(i) for i in stats.index)


def test_output_type():
    """Output stats is a pandas DataFrame."""
    import pandas as pd
    df = pd.DataFrame({"v": [1, 2, 3]})
    result = invoke_tool(df=df)
    assert isinstance(result["stats"], pd.DataFrame)
