import numpy as np


def test_binary_classification():
    rng = np.random.default_rng(0)
    X = rng.standard_normal((100, 2))
    y = (X[:, 0] + X[:, 1] > 0).astype(int)
    result = invoke_tool(X=X, y=y)
    assert result["accuracy"] > 0.8
    assert result["coefficients"].shape == (1, 2)


def test_linearly_separable():
    X = np.array([[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0],
                  [5.0, 5.0], [5.0, 6.0], [6.0, 5.0], [6.0, 6.0]])
    y = np.array([0, 0, 0, 0, 1, 1, 1, 1])
    result = invoke_tool(X=X, y=y)
    assert result["accuracy"] == 1.0


if __name__ == "__main__":
    test_binary_classification()
    test_linearly_separable()
    print("All tests passed.")
