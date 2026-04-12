# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Compute mean of a simple 1-D array."""
    import numpy as np
    values = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    result = invoke_tool(values=values)
    assert abs(result["mean"] - 3.0) < 1e-10


def test_negative_values():
    """Mean of an array with negative values."""
    import numpy as np
    values = np.array([-2.0, 0.0, 2.0])
    result = invoke_tool(values=values)
    assert abs(result["mean"] - 0.0) < 1e-10


def test_output_type():
    """Output mean is a float."""
    import numpy as np
    result = invoke_tool(values=np.array([1.0, 2.0, 3.0]))
    assert isinstance(result["mean"], float)
