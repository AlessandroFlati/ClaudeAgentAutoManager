# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Population variance of [2, 4, 4, 4, 5, 5, 7, 9] is 4.0."""
    result = invoke_tool(values=[2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0])
    assert abs(result["variance"] - 4.0) < 1e-6


def test_constant_series():
    """Variance of a constant series is 0."""
    result = invoke_tool(values=[5.0, 5.0, 5.0, 5.0])
    assert abs(result["variance"] - 0.0) < 1e-10


def test_output_type():
    """Output variance is a float."""
    result = invoke_tool(values=[1.0, 2.0, 3.0])
    assert isinstance(result["variance"], float)
