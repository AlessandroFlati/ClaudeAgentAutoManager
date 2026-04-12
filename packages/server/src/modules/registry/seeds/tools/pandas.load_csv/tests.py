# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case(tmp_path):
    """Load a simple CSV and verify shape and column names."""
    import pandas as pd
    csv_file = tmp_path / "sample.csv"
    csv_file.write_text("a,b\n1,2\n3,4\n5,6\n")
    result = invoke_tool(path=str(csv_file))
    df = result["df"]
    assert df.shape == (3, 2)
    assert list(df.columns) == ["a", "b"]


def test_parse_dates(tmp_path):
    """CSV with a date column parsed as datetime."""
    import pandas as pd
    csv_file = tmp_path / "dated.csv"
    csv_file.write_text("date,value\n2024-01-01,10\n2024-01-02,20\n")
    result = invoke_tool(path=str(csv_file), parse_dates=["date"])
    df = result["df"]
    assert pd.api.types.is_datetime64_any_dtype(df["date"])


def test_output_type(tmp_path):
    """Output df is a pandas DataFrame."""
    import pandas as pd
    csv_file = tmp_path / "t.csv"
    csv_file.write_text("x\n1\n2\n")
    result = invoke_tool(path=str(csv_file))
    assert isinstance(result["df"], pd.DataFrame)
