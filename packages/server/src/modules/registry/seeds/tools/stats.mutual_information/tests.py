def test_identical_variables():
    x = [0, 1, 0, 1, 0, 1, 2, 2]
    result = invoke_tool(x=x, y=x)
    assert result["mi"] > 0.5


def test_independent_variables():
    x = [0, 1, 0, 1, 0, 1, 0, 1]
    y = [0, 0, 1, 1, 0, 0, 1, 1]
    result = invoke_tool(x=x, y=y)
    assert result["mi"] >= 0.0


def test_output_key():
    x = [0, 1, 2, 0, 1, 2]
    y = [0, 1, 2, 0, 1, 2]
    result = invoke_tool(x=x, y=y)
    assert "mi" in result
    assert isinstance(result["mi"], float)


if __name__ == "__main__":
    test_identical_variables()
    test_independent_variables()
    test_output_key()
    print("All tests passed.")
