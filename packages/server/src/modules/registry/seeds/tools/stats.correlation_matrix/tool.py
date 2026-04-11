def run(df):
    import numpy as np
    matrix = df.corr(numeric_only=True).to_numpy()
    return {"matrix": matrix}
