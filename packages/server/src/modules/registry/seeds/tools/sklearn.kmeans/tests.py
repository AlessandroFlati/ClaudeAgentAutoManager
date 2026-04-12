import numpy as np


def test_basic_kmeans():
    rng = np.random.default_rng(0)
    cluster_a = rng.standard_normal((30, 2)) + np.array([0.0, 0.0])
    cluster_b = rng.standard_normal((30, 2)) + np.array([10.0, 10.0])
    matrix = np.vstack([cluster_a, cluster_b])
    result = invoke_tool(matrix=matrix, n_clusters=2)
    assert result["labels"].shape == (60,)
    assert result["centers"].shape == (2, 2)
    assert len(set(result["labels"])) == 2
    assert result["inertia"] > 0


def test_three_clusters():
    rng = np.random.default_rng(1)
    centers = [np.array([0.0, 0.0]), np.array([5.0, 0.0]), np.array([0.0, 5.0])]
    matrix = np.vstack([rng.standard_normal((20, 2)) + c for c in centers])
    result = invoke_tool(matrix=matrix, n_clusters=3)
    assert len(set(result["labels"])) == 3
    assert "model" in result


def test_invalid_n_clusters():
    matrix = np.random.default_rng(0).standard_normal((10, 2))
    try:
        invoke_tool(matrix=matrix, n_clusters=0)
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_basic_kmeans()
    test_three_clusters()
    test_invalid_n_clusters()
    print("All tests passed.")
