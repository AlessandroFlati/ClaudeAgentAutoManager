def run(path):
    import pandas as pd
    df = pd.read_csv(path)
    return {"df": df}
