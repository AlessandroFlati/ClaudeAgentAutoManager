import numpy as np


def test_quadratic_minimum():
    result = invoke_tool(function="quadratic", initial_guess=[3.0, -2.0])
    assert result["success"]
    assert np.allclose(result["x"], [0.0, 0.0], atol=1e-4)
    assert abs(result["fun"]) < 1e-8


def test_sphere_function():
    result = invoke_tool(function="sphere", initial_guess=[1.0, 2.0, 3.0])
    assert result["success"]
    assert result["fun"] < 1e-8


def test_unknown_function():
    try:
        invoke_tool(function="nonexistent", initial_guess=[0.0])
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_quadratic_minimum()
    test_sphere_function()
    test_unknown_function()
    print("All tests passed.")
