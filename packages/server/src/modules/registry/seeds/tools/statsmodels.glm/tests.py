import numpy as np


def test_gaussian_family():
    rng = np.random.default_rng(0)
    x = rng.standard_normal((50, 2))
    y = x[:, 0] * 2.0 + 1.0 + 0.1 * rng.standard_normal(50)
    result = invoke_tool(x=x, y=y, family="gaussian")
    assert len(result["coefficients"]) == 3
    assert len(result["p_values"]) == 3


def test_binomial_family():
    rng = np.random.default_rng(1)
    x = rng.standard_normal((100, 2))
    log_odds = x[:, 0] - x[:, 1]
    prob = 1 / (1 + np.exp(-log_odds))
    y = (rng.uniform(size=100) < prob).astype(float)
    result = invoke_tool(x=x, y=y, family="binomial")
    assert "coefficients" in result
    assert "model" in result


def test_invalid_family():
    x = np.array([[1.0], [2.0]])
    y = np.array([1.0, 2.0])
    try:
        invoke_tool(x=x, y=y, family="nonexistent")
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_gaussian_family()
    test_binomial_family()
    test_invalid_family()
    print("All tests passed.")
