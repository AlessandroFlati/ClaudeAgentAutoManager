import numpy as np


def test_basic_fit():
    x = np.array([[1.0], [2.0], [3.0], [4.0]])
    y = np.array([2.0, 4.0, 6.0, 8.0])
    result = invoke_tool(x=x, y=y, alpha=0.01)
    assert result["r_squared"] > 0.99
    assert "coefficients" in result
    assert "intercept" in result


def test_regularization_shrinks_coefficients():
    rng = np.random.default_rng(1)
    x = rng.standard_normal((30, 5))
    y = x[:, 0] * 10.0
    result_low = invoke_tool(x=x, y=y, alpha=0.001)
    result_high = invoke_tool(x=x, y=y, alpha=100.0)
    norm_low = np.linalg.norm(result_low["coefficients"])
    norm_high = np.linalg.norm(result_high["coefficients"])
    assert norm_high < norm_low


def test_invalid_alpha():
    x = np.array([[1.0], [2.0]])
    y = np.array([1.0, 2.0])
    try:
        invoke_tool(x=x, y=y, alpha=-1.0)
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_basic_fit()
    test_regularization_shrinks_coefficients()
    test_invalid_alpha()
    print("All tests passed.")
