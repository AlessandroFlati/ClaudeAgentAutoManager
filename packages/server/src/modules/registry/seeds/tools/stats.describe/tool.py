def run(df):
    import pandas as pd
    summary = df.describe().to_dict()
    return {"summary": summary}
