import numpy as np


def test_well_separated_clusters():
    rng = np.random.default_rng(0)
    matrix = np.vstack([
        rng.standard_normal((30, 2)) * 0.1,
        rng.standard_normal((30, 2)) * 0.1 + np.array([10.0, 10.0]),
    ])
    labels = np.array([0] * 30 + [1] * 30)
    result = invoke_tool(matrix=matrix, labels=labels)
    assert result["score"] > 0.8


def test_poor_clusters():
    rng = np.random.default_rng(1)
    matrix = rng.standard_normal((40, 2))
    labels = np.array([0] * 20 + [1] * 20)
    result = invoke_tool(matrix=matrix, labels=labels)
    assert -1.0 <= result["score"] <= 1.0


if __name__ == "__main__":
    test_well_separated_clusters()
    test_poor_clusters()
    print("All tests passed.")
