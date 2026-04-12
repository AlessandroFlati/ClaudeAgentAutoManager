# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case(tmp_path):
    """Save a DataFrame to Parquet and verify it can be reloaded."""
    import pandas as pd
    df = pd.DataFrame({"a": [1, 2, 3], "b": [0.1, 0.2, 0.3]})
    path = str(tmp_path / "out.parquet")
    result = invoke_tool(df=df, path=path)
    assert result["path"] == path
    loaded = pd.read_parquet(path)
    assert loaded.shape == (3, 2)


def test_roundtrip_values(tmp_path):
    """Values survive a save/load roundtrip."""
    import pandas as pd
    df = pd.DataFrame({"val": [42, 99, 7]})
    path = str(tmp_path / "vals.parquet")
    invoke_tool(df=df, path=path)
    loaded = pd.read_parquet(path)
    assert list(loaded["val"]) == [42, 99, 7]


def test_output_type(tmp_path):
    """Output path is a string."""
    import pandas as pd
    df = pd.DataFrame({"x": [1]})
    path = str(tmp_path / "t.parquet")
    result = invoke_tool(df=df, path=path)
    assert isinstance(result["path"], str)
