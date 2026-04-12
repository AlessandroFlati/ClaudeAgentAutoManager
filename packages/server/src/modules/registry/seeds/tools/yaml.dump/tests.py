# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case(tmp_path):
    """Serialize a dict to YAML and verify the file contents."""
    import yaml
    data = {"host": "localhost", "port": 8080}
    path = str(tmp_path / "out.yaml")
    result = invoke_tool(data=data, path=path)
    assert result["written"] is True
    with open(path) as f:
        loaded = yaml.safe_load(f)
    assert loaded["host"] == "localhost"
    assert loaded["port"] == 8080


def test_nested_data(tmp_path):
    """Serialize nested structure to YAML."""
    import yaml
    data = {"items": [10, 20], "meta": {"v": 1}}
    path = str(tmp_path / "nested.yaml")
    result = invoke_tool(data=data, path=path)
    assert result["written"] is True
    with open(path) as f:
        loaded = yaml.safe_load(f)
    assert loaded["items"] == [10, 20]


def test_output_type(tmp_path):
    """Output written is a boolean True."""
    path = str(tmp_path / "t.yaml")
    result = invoke_tool(data={"k": "v"}, path=path)
    assert isinstance(result["written"], bool)
    assert result["written"] is True
