import numpy as np


def test_basic_umap():
    rng = np.random.default_rng(0)
    X = rng.standard_normal((60, 5))
    result = invoke_tool(X=X, n_components=2, n_neighbors=5)
    assert result["embedding"].shape == (60, 2)


def test_3d_embedding():
    rng = np.random.default_rng(1)
    X = rng.standard_normal((50, 8))
    result = invoke_tool(X=X, n_components=3, n_neighbors=5)
    assert result["embedding"].shape == (50, 3)


def test_invalid_n_neighbors():
    X = np.random.default_rng(0).standard_normal((20, 3))
    try:
        invoke_tool(X=X, n_components=2, n_neighbors=1)
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_basic_umap()
    test_3d_embedding()
    test_invalid_n_neighbors()
    print("All tests passed.")
