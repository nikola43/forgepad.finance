"""Test suite for the Fyuz Python SDK.

Adds ``src`` to ``sys.path`` so the tests exercise the working tree without an
install step. If the package is already installed in the environment, the
working tree still wins — which is what you want while developing.

This directory is put on ``sys.path`` too, so the shared ``payloads`` and
``stub_server`` modules resolve identically under every runner. The test
modules import them absolutely rather than relatively, because
``python -m unittest discover -s tests`` (no ``-t .``) makes this directory the
top level and imports each module as a *top-level* module, where a relative
import has no parent package to resolve against. That invocation never runs
this file at all — it works because unittest has already put this directory on
``sys.path`` itself, and it resolves ``fyuz`` from the installed package.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.join(os.path.dirname(_HERE), "src")
for _path in (_SRC, _HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)
