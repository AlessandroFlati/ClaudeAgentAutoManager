def run(df, path):
    import pandas as pd
    df.to_csv(path, index=False)
    return {"written": True}
