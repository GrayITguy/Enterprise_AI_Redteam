"""Protocol-level tests for the deepteam worker.

The deepteam runner validates that the `deepteam` package is importable at
module load and exits if it isn't, so we exercise it via subprocess rather than
importing it. This also verifies the worker's stdin(JSON)→stdout(JSONL) contract
and that a missing dependency is reported as a structured error line, not a
crash.
"""
import json
import os
import subprocess
import sys
import unittest

WORKERS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNNER = os.path.join(WORKERS_DIR, "deepteam", "runner.py")


def _deepteam_installed():
    try:
        import deepteam  # noqa: F401
        return True
    except Exception:
        return False


class TestDeepteamProtocol(unittest.TestCase):
    def test_compiles(self):
        # py_compile catches syntax errors without importing (which would exit).
        rc = subprocess.call([sys.executable, "-m", "py_compile", RUNNER])
        self.assertEqual(rc, 0, "deepteam runner.py failed to compile")

    @unittest.skipIf(_deepteam_installed(), "deepteam installed — dependency-missing path not exercised")
    def test_reports_missing_dependency_as_json_error(self):
        proc = subprocess.run(
            [sys.executable, RUNNER],
            input=json.dumps({"target_url": "http://localhost:1", "plugins": []}),
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertNotEqual(proc.returncode, 0)
        # The first stdout line must be a JSON object carrying an `error` key.
        first = proc.stdout.strip().splitlines()[0]
        payload = json.loads(first)
        self.assertIn("error", payload)
        self.assertIn("deepteam", payload["error"].lower())


if __name__ == "__main__":
    unittest.main()
