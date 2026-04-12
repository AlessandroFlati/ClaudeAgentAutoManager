def run(expr, variable):
    import sympy
    var = sympy.Symbol(variable)
    solutions = sympy.solve(expr, var)
    return {"solutions": [str(s) for s in solutions]}
