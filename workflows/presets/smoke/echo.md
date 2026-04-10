# Echo (process backend)

Trivial process node. The actual command is `powershell -Command "Write-Output 'hello...'"`.
The platform generates the signal from the exit code automatically.

This preset exists for documentation — the process backend reads the purpose
from `CAAM_PURPOSE_FILE` env var but the powershell command ignores it.
