def run(expr, variable):
    import sympy
    var = sympy.Symbol(variable)
    return {"result": sympy.integrate(expr, var)}
