import numpy as np


def test_basic_nmf():
    rng = np.random.default_rng(0)
    matrix = np.abs(rng.standard_normal((20, 5)))
    result = invoke_tool(matrix=matrix, n_components=2)
    assert result["W"].shape == (20, 2)
    assert result["H"].shape == (2, 5)
    assert np.all(result["W"] >= 0)
    assert np.all(result["H"] >= 0)


def test_reconstruction_quality():
    rng = np.random.default_rng(1)
    W_true = np.abs(rng.standard_normal((30, 2)))
    H_true = np.abs(rng.standard_normal((2, 4)))
    matrix = W_true @ H_true
    result = invoke_tool(matrix=matrix, n_components=2)
    reconstructed = result["W"] @ result["H"]
    error = np.mean((matrix - reconstructed) ** 2)
    assert error < 1.0


def test_invalid_n_components():
    matrix = np.abs(np.random.default_rng(0).standard_normal((10, 3)))
    try:
        invoke_tool(matrix=matrix, n_components=0)
        assert False, "Expected ValueError"
    except ValueError:
        pass


if __name__ == "__main__":
    test_basic_nmf()
    test_reconstruction_quality()
    test_invalid_n_components()
    print("All tests passed.")
