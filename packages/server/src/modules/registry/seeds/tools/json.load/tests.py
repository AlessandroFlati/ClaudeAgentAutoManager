# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case(tmp_path):
    """Load a JSON file and verify the returned dict."""
    import json
    data = {"key": "value", "count": 42}
    path = str(tmp_path / "data.json")
    with open(path, "w") as f:
        json.dump(data, f)
    result = invoke_tool(path=path)
    assert result["data"]["key"] == "value"
    assert result["data"]["count"] == 42


def test_nested_json(tmp_path):
    """Load a JSON file with nested structure."""
    import json
    data = {"outer": {"inner": [1, 2, 3]}}
    path = str(tmp_path / "nested.json")
    with open(path, "w") as f:
        json.dump(data, f)
    result = invoke_tool(path=path)
    assert result["data"]["outer"]["inner"] == [1, 2, 3]


def test_output_type(tmp_path):
    """Output data is a dict."""
    import json
    path = str(tmp_path / "simple.json")
    with open(path, "w") as f:
        json.dump({"x": 1}, f)
    result = invoke_tool(path=path)
    assert isinstance(result["data"], dict)
