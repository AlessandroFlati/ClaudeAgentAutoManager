import numpy as np


def test_two_dense_clusters():
    rng = np.random.default_rng(0)
    cluster_a = rng.standard_normal((30, 2)) * 0.2
    cluster_b = rng.standard_normal((30, 2)) * 0.2 + np.array([5.0, 5.0])
    matrix = np.vstack([cluster_a, cluster_b])
    result = invoke_tool(matrix=matrix, eps=0.5, min_samples=3)
    assert result["n_clusters"] == 2
    assert result["labels"].shape == (60,)


def test_noise_points():
    rng = np.random.default_rng(1)
    matrix = rng.standard_normal((20, 2))
    result = invoke_tool(matrix=matrix, eps=0.1, min_samples=20)
    assert result["n_noise"] > 0


def test_invalid_eps():
    matrix = np.random.default_rng(0).standard_normal((10, 2))
    try:
        invoke_tool(matrix=matrix, eps=0.0)
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_two_dense_clusters()
    test_noise_points()
    test_invalid_eps()
    print("All tests passed.")
