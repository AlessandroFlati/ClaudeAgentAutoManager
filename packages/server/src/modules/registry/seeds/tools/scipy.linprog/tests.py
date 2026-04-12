import numpy as np


def test_simple_minimization():
    # Minimize -x1 - 2*x2 subject to x1 + x2 <= 4, x1 <= 3, x2 <= 3
    c = [-1.0, -2.0]
    A_ub = [[1.0, 1.0], [1.0, 0.0], [0.0, 1.0]]
    b_ub = [4.0, 3.0, 3.0]
    result = invoke_tool(c=c, A_ub=A_ub, b_ub=b_ub)
    assert result["success"]
    assert result["x"].shape == (2,)
    assert abs(result["fun"] - (-7.0)) < 1e-4


def test_known_optimal():
    # Minimize x1 + x2 subject to x1 >= 1, x2 >= 2  (written as -x1 <= -1, -x2 <= -2)
    c = [1.0, 1.0]
    A_ub = [[-1.0, 0.0], [0.0, -1.0]]
    b_ub = [-1.0, -2.0]
    result = invoke_tool(c=c, A_ub=A_ub, b_ub=b_ub)
    assert result["success"]
    assert abs(result["fun"] - 3.0) < 1e-4


if __name__ == "__main__":
    test_simple_minimization()
    test_known_optimal()
    print("All tests passed.")
