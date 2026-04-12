import numpy as np


def test_ward_linkage():
    rng = np.random.default_rng(0)
    X = np.vstack([
        rng.standard_normal((20, 2)),
        rng.standard_normal((20, 2)) + np.array([8.0, 8.0]),
    ])
    result = invoke_tool(X=X, n_clusters=2, linkage="ward")
    assert result["labels"].shape == (40,)
    assert len(set(result["labels"])) == 2


def test_complete_linkage():
    rng = np.random.default_rng(1)
    X = rng.standard_normal((30, 3))
    result = invoke_tool(X=X, n_clusters=3, linkage="complete")
    assert len(set(result["labels"])) == 3


def test_invalid_linkage():
    X = np.random.default_rng(0).standard_normal((10, 2))
    try:
        invoke_tool(X=X, n_clusters=2, linkage="bogus")
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_ward_linkage()
    test_complete_linkage()
    test_invalid_linkage()
    print("All tests passed.")
