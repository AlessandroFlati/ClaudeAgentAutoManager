import numpy as np


def test_basic_fit():
    rng = np.random.default_rng(0)
    X = rng.standard_normal((50, 3))
    y = X[:, 0] * 2.0 + 0.05 * rng.standard_normal(50)
    result = invoke_tool(X=X, y=y, alpha=0.01)
    assert result["r_squared"] > 0.9
    assert result["coefficients"].shape == (3,)


def test_sparsity():
    rng = np.random.default_rng(1)
    X = rng.standard_normal((100, 10))
    y = X[:, 0] * 3.0 + 0.1 * rng.standard_normal(100)
    result = invoke_tool(X=X, y=y, alpha=0.5)
    n_zero = np.sum(np.abs(result["coefficients"]) < 1e-6)
    assert n_zero >= 5


def test_invalid_alpha():
    X = np.array([[1.0], [2.0]])
    y = np.array([1.0, 2.0])
    try:
        invoke_tool(X=X, y=y, alpha=0.0)
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_basic_fit()
    test_sparsity()
    test_invalid_alpha()
    print("All tests passed.")
