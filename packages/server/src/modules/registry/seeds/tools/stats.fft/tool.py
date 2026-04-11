def run(values):
    import numpy as np
    arr = np.array(values, dtype=float)
    fft_result = np.fft.fft(arr)
    frequencies = np.fft.fftfreq(len(arr))
    magnitudes = np.abs(fft_result)
    return {"frequencies": frequencies, "magnitudes": magnitudes}
