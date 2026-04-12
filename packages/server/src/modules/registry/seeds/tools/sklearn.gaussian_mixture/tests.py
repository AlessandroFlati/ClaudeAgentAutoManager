import numpy as np


def test_two_component_gmm():
    rng = np.random.default_rng(0)
    X = np.vstack([
        rng.standard_normal((50, 2)),
        rng.standard_normal((50, 2)) + np.array([5.0, 5.0]),
    ])
    result = invoke_tool(matrix=X, n_components=2)
    assert result["labels"].shape == (100,)
    assert result["probabilities"].shape == (100, 2)
    assert np.allclose(result["probabilities"].sum(axis=1), 1.0, atol=1e-6)
    assert "aic" in result and "bic" in result


def test_model_returned():
    rng = np.random.default_rng(1)
    X = rng.standard_normal((40, 3))
    result = invoke_tool(matrix=X, n_components=2)
    assert "model" in result


def test_invalid_n_components():
    X = np.random.default_rng(0).standard_normal((10, 2))
    try:
        invoke_tool(matrix=X, n_components=0)
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_two_component_gmm()
    test_model_returned()
    test_invalid_n_components()
    print("All tests passed.")
