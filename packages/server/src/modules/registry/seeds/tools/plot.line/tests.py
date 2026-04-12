import os
import tempfile

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def test_creates_png():
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        output_path = f.name
    try:
        result = invoke_tool(
            x=[1.0, 2.0, 3.0, 4.0],
            y=[1.0, 4.0, 9.0, 16.0],
            output_path=output_path,
        )
        assert os.path.exists(output_path)
        with open(output_path, "rb") as fh:
            header = fh.read(8)
        assert header == PNG_SIGNATURE
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)


def test_with_labels():
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        output_path = f.name
    try:
        result = invoke_tool(
            x=[0.0, 1.0, 2.0],
            y=[0.0, 1.0, 0.0],
            output_path=output_path,
            title="Test",
            xlabel="x",
            ylabel="y",
        )
        assert os.path.exists(result["path"])
        with open(result["path"], "rb") as fh:
            assert fh.read(8) == PNG_SIGNATURE
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)


if __name__ == "__main__":
    test_creates_png()
    test_with_labels()
    print("All tests passed.")
