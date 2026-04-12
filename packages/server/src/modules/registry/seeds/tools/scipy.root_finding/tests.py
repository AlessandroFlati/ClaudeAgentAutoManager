import numpy as np


def test_quadratic_shift_root():
    result = invoke_tool(function="quadratic_shift", bracket=[1.0, 2.0])
    assert result["converged"]
    assert abs(result["root"] - np.sqrt(2)) < 1e-6


def test_cubic_root():
    result = invoke_tool(function="cubic", bracket=[1.0, 2.0])
    assert result["converged"]
    assert abs(result["root"] ** 3 - result["root"] - 2.0) < 1e-6


def test_unknown_function():
    try:
        invoke_tool(function="nonexistent", bracket=[0.0, 1.0])
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_quadratic_shift_root()
    test_cubic_root()
    test_unknown_function()
    print("All tests passed.")
