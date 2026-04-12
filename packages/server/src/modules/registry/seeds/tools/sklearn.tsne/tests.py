import numpy as np


def test_basic_tsne():
    rng = np.random.default_rng(0)
    matrix = rng.standard_normal((50, 5))
    result = invoke_tool(matrix=matrix, n_components=2, perplexity=5.0)
    assert result["embedding"].shape == (50, 2)


def test_output_shape_3d():
    rng = np.random.default_rng(1)
    matrix = rng.standard_normal((40, 6))
    result = invoke_tool(matrix=matrix, n_components=3, perplexity=5.0)
    assert result["embedding"].shape == (40, 3)


if __name__ == "__main__":
    test_basic_tsne()
    test_output_shape_3d()
    print("All tests passed.")
