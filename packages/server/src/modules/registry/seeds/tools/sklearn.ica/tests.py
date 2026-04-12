import numpy as np


def test_basic_ica():
    rng = np.random.default_rng(0)
    matrix = rng.standard_normal((100, 4))
    result = invoke_tool(matrix=matrix, n_components=2)
    assert result["sources"].shape == (100, 2)
    assert result["components"].shape == (2, 4)


def test_full_components():
    rng = np.random.default_rng(1)
    matrix = rng.standard_normal((50, 3))
    result = invoke_tool(matrix=matrix)
    assert result["sources"].shape[1] == 3
    assert result["components"].shape == (3, 3)


if __name__ == "__main__":
    test_basic_ica()
    test_full_components()
    print("All tests passed.")
