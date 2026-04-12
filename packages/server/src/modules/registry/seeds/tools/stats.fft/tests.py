# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """FFT of a pure sine wave has a dominant frequency at the correct bin."""
    import numpy as np
    n = 64
    freq = 4  # cycles per 64 samples
    t = np.arange(n)
    signal = (np.sin(2 * np.pi * freq * t / n)).tolist()
    result = invoke_tool(values=signal)
    magnitudes = result["magnitudes"]
    assert len(magnitudes) == n
    dominant_bin = int(np.argmax(magnitudes[1:n // 2])) + 1
    assert dominant_bin == freq


def test_output_lengths():
    """frequencies and magnitudes have the same length as input."""
    values = [1.0, 0.0, -1.0, 0.0] * 8  # 32 samples
    result = invoke_tool(values=values)
    assert len(result["frequencies"]) == len(values)
    assert len(result["magnitudes"]) == len(values)


def test_output_types():
    """frequencies and magnitudes are numpy arrays."""
    import numpy as np
    result = invoke_tool(values=[1.0, 2.0, 1.0, 0.0])
    assert isinstance(result["frequencies"], np.ndarray)
    assert isinstance(result["magnitudes"], np.ndarray)
