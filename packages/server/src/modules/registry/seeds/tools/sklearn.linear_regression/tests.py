import numpy as np


def test_basic_fit():
    x = np.array([[1.0], [2.0], [3.0], [4.0]])
    y = np.array([2.0, 4.0, 6.0, 8.0])
    result = invoke_tool(x=x, y=y)
    assert abs(result["coefficients"][0] - 2.0) < 1e-6
    assert result["r_squared"] > 0.99


def test_no_intercept():
    x = np.array([[1.0], [2.0], [3.0]])
    y = np.array([3.0, 6.0, 9.0])
    result = invoke_tool(x=x, y=y, fit_intercept=False)
    assert abs(result["coefficients"][0] - 3.0) < 1e-6
    assert result["r_squared"] > 0.99


def test_multivariate():
    rng = np.random.default_rng(0)
    x = rng.standard_normal((50, 3))
    y = x @ np.array([1.0, -2.0, 0.5]) + 0.1
    result = invoke_tool(x=x, y=y)
    assert result["coefficients"].shape == (3,)
    assert "model" in result
    assert result["r_squared"] > 0.95


if __name__ == "__main__":
    test_basic_fit()
    test_no_intercept()
    test_multivariate()
    print("All tests passed.")
