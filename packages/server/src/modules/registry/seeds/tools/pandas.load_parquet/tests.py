# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case(tmp_path):
    """Load a Parquet file and verify shape."""
    import pandas as pd
    df_orig = pd.DataFrame({"x": [1, 2, 3], "y": [4.0, 5.0, 6.0]})
    path = str(tmp_path / "data.parquet")
    df_orig.to_parquet(path, index=False)
    result = invoke_tool(path=path)
    df = result["df"]
    assert df.shape == (3, 2)
    assert list(df.columns) == ["x", "y"]


def test_column_selection(tmp_path):
    """Only load a subset of columns."""
    import pandas as pd
    df_orig = pd.DataFrame({"a": [1, 2], "b": [3, 4], "c": [5, 6]})
    path = str(tmp_path / "multi.parquet")
    df_orig.to_parquet(path, index=False)
    result = invoke_tool(path=path, columns=["a", "c"])
    df = result["df"]
    assert list(df.columns) == ["a", "c"]
    assert df.shape == (2, 2)


def test_output_type(tmp_path):
    """Output df is a pandas DataFrame."""
    import pandas as pd
    df_orig = pd.DataFrame({"v": [10]})
    path = str(tmp_path / "single.parquet")
    df_orig.to_parquet(path, index=False)
    result = invoke_tool(path=path)
    assert isinstance(result["df"], pd.DataFrame)
