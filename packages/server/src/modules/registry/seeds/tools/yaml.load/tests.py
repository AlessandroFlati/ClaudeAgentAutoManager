# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case(tmp_path):
    """Load a YAML file and verify the returned dict."""
    path = str(tmp_path / "config.yaml")
    with open(path, "w") as f:
        f.write("name: example\nvalue: 42\n")
    result = invoke_tool(path=path)
    assert result["data"]["name"] == "example"
    assert result["data"]["value"] == 42


def test_nested_yaml(tmp_path):
    """Load YAML with nested mappings and lists."""
    path = str(tmp_path / "nested.yaml")
    with open(path, "w") as f:
        f.write("outer:\n  inner:\n    - 1\n    - 2\n")
    result = invoke_tool(path=path)
    assert result["data"]["outer"]["inner"] == [1, 2]


def test_output_type(tmp_path):
    """Output data is a dict."""
    path = str(tmp_path / "simple.yaml")
    with open(path, "w") as f:
        f.write("x: 1\n")
    result = invoke_tool(path=path)
    assert isinstance(result["data"], dict)
