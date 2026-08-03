"""Single source of truth for the distribution version.

Kept in its own module so that ``pyproject.toml`` can read it without importing
the package (which would drag in the whole client at build time).
"""

__version__ = "1.0.0"
