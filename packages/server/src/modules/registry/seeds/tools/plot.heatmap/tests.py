import os
import tempfile
import numpy as np

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def test_creates_png():
    rng = np.random.default_rng(0)
    matrix = rng.standard_normal((6, 6)).tolist()
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        output_path = f.name
    try:
        result = invoke_tool(matrix=matrix, output_path=output_path)
        assert os.path.exists(output_path)
        with open(output_path, "rb") as fh:
            assert fh.read(8) == PNG_SIGNATURE
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)


def test_custom_cmap_and_title():
    matrix = [[1.0, 2.0], [3.0, 4.0]]
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        output_path = f.name
    try:
        result = invoke_tool(matrix=matrix, output_path=output_path, title="H", cmap="plasma")
        assert os.path.exists(result["path"])
        with open(result["path"], "rb") as fh:
            assert fh.read(8) == PNG_SIGNATURE
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)


if __name__ == "__main__":
    test_creates_png()
    test_custom_cmap_and_title()
    print("All tests passed.")
