# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case(tmp_path):
    """Save a DataFrame to CSV and verify the file is readable."""
    import pandas as pd
    df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
    path = str(tmp_path / "out.csv")
    result = invoke_tool(df=df, path=path, index=False)
    assert result["path"] == path
    loaded = pd.read_csv(path)
    assert loaded.shape == (3, 2)


def test_with_index(tmp_path):
    """Save with index=True and verify index column appears in file."""
    import pandas as pd
    df = pd.DataFrame({"v": [10, 20]}, index=["r1", "r2"])
    path = str(tmp_path / "indexed.csv")
    invoke_tool(df=df, path=path, index=True)
    content = open(path).read()
    assert "r1" in content


def test_output_type(tmp_path):
    """Output path is a string."""
    import pandas as pd
    df = pd.DataFrame({"x": [1]})
    path = str(tmp_path / "t.csv")
    result = invoke_tool(df=df, path=path)
    assert isinstance(result["path"], str)
