# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case(tmp_path):
    """Serialize a dict to JSON and verify the file contents."""
    import json
    data = {"name": "test", "value": 123}
    path = str(tmp_path / "out.json")
    result = invoke_tool(data=data, path=path)
    assert result["written"] is True
    with open(path) as f:
        loaded = json.load(f)
    assert loaded["name"] == "test"
    assert loaded["value"] == 123


def test_nested_data(tmp_path):
    """Serialize nested dict with list values."""
    import json
    data = {"items": [1, 2, 3], "meta": {"version": 1}}
    path = str(tmp_path / "nested.json")
    result = invoke_tool(data=data, path=path)
    assert result["written"] is True
    with open(path) as f:
        loaded = json.load(f)
    assert loaded["items"] == [1, 2, 3]


def test_output_type(tmp_path):
    """Output written is a boolean True."""
    path = str(tmp_path / "t.json")
    result = invoke_tool(data={"k": "v"}, path=path)
    assert isinstance(result["written"], bool)
    assert result["written"] is True
