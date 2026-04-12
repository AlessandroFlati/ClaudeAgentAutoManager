import math


def test_uniform_distribution():
    # Entropy of uniform distribution over 4 outcomes = log(4) = 2 bits
    probs = [0.25, 0.25, 0.25, 0.25]
    result = invoke_tool(probabilities=probs, base=2)
    assert abs(result["entropy"] - 2.0) < 1e-6


def test_certain_distribution():
    probs = [1.0, 0.0, 0.0]
    result = invoke_tool(probabilities=probs)
    assert abs(result["entropy"]) < 1e-9


def test_natural_log_base():
    probs = [0.5, 0.5]
    result = invoke_tool(probabilities=probs)
    expected = math.log(2)
    assert abs(result["entropy"] - expected) < 1e-9


if __name__ == "__main__":
    test_uniform_distribution()
    test_certain_distribution()
    test_natural_log_base()
    print("All tests passed.")
