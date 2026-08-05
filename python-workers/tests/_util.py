"""Shared helpers for worker tests.

The worker runners are single-file scripts, not a package, so we load them by
path. garak/ and pyrit/ runners only import the stdlib at module top, so they
import cleanly here. The deepteam runner exits on a missing `deepteam` package
at import time, so it is exercised via subprocess (see test_deepteam_protocol).
"""
import importlib.util
import os

WORKERS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_runner(worker_name):
    """Import <worker>/runner.py as a module object."""
    path = os.path.join(WORKERS_DIR, worker_name, "runner.py")
    spec = importlib.util.spec_from_file_location(f"{worker_name}_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
