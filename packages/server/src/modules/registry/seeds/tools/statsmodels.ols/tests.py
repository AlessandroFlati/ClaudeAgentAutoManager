import numpy as np


def test_basic_ols():
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    y = 3.0 * x + 1.0 + np.array([0.01, -0.01, 0.02, -0.02, 0.0])
    result = invoke_tool(x=x, y=y)
    assert result["r_squared"] > 0.99
    assert len(result["coefficients"]) == 2
    assert len(result["p_values"]) == 2


def test_no_constant():
    x = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]])
    y = x[:, 0] + 2.0 * x[:, 1]
    result = invoke_tool(x=x, y=y, add_constant=False)
    assert result["r_squared"] > 0.99


def test_summary_returned():
    x = np.linspace(0, 1, 20)
    y = 2.0 * x + 0.5
    result = invoke_tool(x=x, y=y)
    assert isinstance(result["summary"], str)
    assert len(result["summary"]) > 0


if __name__ == "__main__":
    test_basic_ols()
    test_no_constant()
    test_summary_returned()
    print("All tests passed.")
