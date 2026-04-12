import numpy as np


def test_basic_pca():
    matrix = np.array([
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0],
        [7.0, 8.0, 9.0],
        [2.0, 1.0, 0.0],
    ])
    result = invoke_tool(matrix=matrix, n_components=2)
    assert result["loadings"].shape == (4, 2)
    assert len(result["explained_variance_ratio"]) == 2
    assert sum(result["explained_variance_ratio"]) <= 1.0 + 1e-9


def test_default_n_components():
    matrix = np.random.default_rng(0).standard_normal((10, 5))
    result = invoke_tool(matrix=matrix)
    assert result["components"].shape[0] <= 5


def test_whitening():
    rng = np.random.default_rng(0)
    matrix = rng.standard_normal((100, 3))
    result = invoke_tool(matrix=matrix, whiten=True)
    variances = np.var(result["loadings"], axis=0)
    assert np.allclose(variances, 1.0, atol=0.15)


if __name__ == "__main__":
    test_basic_pca()
    test_default_n_components()
    test_whitening()
    print("All tests passed.")
