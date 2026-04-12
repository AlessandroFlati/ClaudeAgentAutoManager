# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Median of an odd-length list is the middle element."""
    result = invoke_tool(values=[3.0, 1.0, 4.0, 1.0, 5.0])
    assert abs(result["median"] - 3.0) < 1e-10


def test_even_length():
    """Median of an even-length list is the average of the two middle values."""
    result = invoke_tool(values=[1.0, 2.0, 3.0, 4.0])
    assert abs(result["median"] - 2.5) < 1e-10


def test_output_type():
    """Output median is a float."""
    result = invoke_tool(values=[1.0, 2.0, 3.0])
    assert isinstance(result["median"], float)
