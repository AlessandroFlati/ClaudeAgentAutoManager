# tests.py -- uses invoke_tool provided by the test runner context

def test_common_case():
    """Cross-correlation of identical signals peaks at lag 0."""
    import numpy as np
    signal = [1.0, 2.0, 3.0, 2.0, 1.0]
    result = invoke_tool(x=signal, y=signal)
    ccf = result["ccf"]
    n = len(signal)
    assert len(ccf) == 2 * n - 1
    center = n - 1
    assert ccf[center] == max(ccf)


def test_shifted_signal():
    """Cross-correlation of a shifted copy has the peak shifted accordingly."""
    x = [0.0, 1.0, 0.0, 0.0, 0.0]
    y = [0.0, 0.0, 1.0, 0.0, 0.0]
    result = invoke_tool(x=x, y=y)
    ccf = result["ccf"]
    peak_idx = int(max(range(len(ccf)), key=lambda i: ccf[i]))
    n = len(x)
    assert peak_idx == n - 2  # shifted by 1


def test_output_length():
    """CCF length equals 2*n - 1."""
    n = 10
    result = invoke_tool(x=[1.0] * n, y=[1.0] * n)
    assert len(result["ccf"]) == 2 * n - 1
