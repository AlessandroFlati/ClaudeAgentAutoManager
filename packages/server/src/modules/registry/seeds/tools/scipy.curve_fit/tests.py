import numpy as np


def test_linear_fit():
    x = np.linspace(0.0, 5.0, 20)
    y = 2.5 * x + 1.0
    result = invoke_tool(function="linear", x=x.tolist(), y=y.tolist(), initial_guess=[1.0, 0.0])
    params = result["parameters"]
    assert abs(params[0] - 2.5) < 0.01
    assert abs(params[1] - 1.0) < 0.01


def test_quadratic_fit():
    x = np.linspace(-3.0, 3.0, 30)
    y = 1.0 * x**2 - 2.0 * x + 3.0
    result = invoke_tool(function="quadratic", x=x.tolist(), y=y.tolist())
    params = result["parameters"]
    assert abs(params[0] - 1.0) < 0.05
    assert result["covariance"].shape == (3, 3)


def test_unknown_function():
    try:
        invoke_tool(function="bogus", x=[1.0, 2.0], y=[1.0, 2.0])
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_linear_fit()
    test_quadratic_fit()
    test_unknown_function()
    print("All tests passed.")
