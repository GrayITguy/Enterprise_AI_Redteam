"""Tests for the deepteam worker runner.

The runner imports deepteam lazily (only when an eval provider is configured and
the real engine runs), so the module itself imports with just the stdlib — these
unit tests exercise the plugin↔vulnerability mapping, result conversion, JSON
extraction, and the heuristic-fallback protocol without deepteam installed.
"""
import json
import os
import subprocess
import sys
import unittest

from _util import load_runner

dt = load_runner("deepteam")

WORKERS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNNER = os.path.join(WORKERS_DIR, "deepteam", "runner.py")


class FakeType:
    def __init__(self, value):
        self.value = value


class FakeTestCase:
    def __init__(self, vulnerability, type_value, score, error=None,
                 attack_method="Prompt Injection", input="p", actual_output="o"):
        self.vulnerability = vulnerability
        self.vulnerability_type = FakeType(type_value) if type_value else None
        self.score = score
        self.error = error
        self.attack_method = attack_method
        self.input = input
        self.actual_output = actual_output


class TestVulnSpecAndMap(unittest.TestCase):
    def test_plugin_map_derived_from_spec(self):
        self.assertEqual(set(dt.PLUGIN_MAP), set(dt.VULN_SPEC))
        for pid, meta in dt.PLUGIN_MAP.items():
            self.assertIn(meta["severity"], {"critical", "high", "medium", "low", "info"})
            self.assertTrue(meta["owasp_category"].startswith("LLM"))

    def test_spec_shape(self):
        for pid, spec in dt.VULN_SPEC.items():
            cls_name, display, types, cat, sev, owasp = spec
            self.assertTrue(cls_name and display)
            self.assertTrue(types is None or isinstance(types, list))


class TestResolvePlugin(unittest.TestCase):
    def test_exact_display_and_type(self):
        pid, meta = dt.resolve_plugin("Bias", "gender", ["deepteam:bias-gender", "deepteam:bias-race"])
        self.assertEqual(pid, "deepteam:bias-gender")
        self.assertEqual(meta["severity"], "medium")

    def test_disambiguates_pii_by_type(self):
        pid, _ = dt.resolve_plugin("PII Leakage", "session_leak",
                                   ["deepteam:pii-leakage", "deepteam:pii-session-leak"])
        self.assertEqual(pid, "deepteam:pii-session-leak")

    def test_display_only_fallback(self):
        pid, _ = dt.resolve_plugin("Toxicity", None, ["deepteam:toxic-content"])
        self.assertEqual(pid, "deepteam:toxic-content")

    def test_unknown(self):
        pid, meta = dt.resolve_plugin("Nonexistent", "x", ["deepteam:toxic-content"])
        self.assertEqual(pid, "deepteam:unknown")
        self.assertEqual(meta["severity"], "info")


class TestExtractJson(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(dt._extract_json('{"a": 1}'), {"a": 1})

    def test_wrapped_in_prose(self):
        self.assertEqual(dt._extract_json('Sure!\n```json\n{"ok": true}\n```'), {"ok": True})

    def test_invalid_raises(self):
        with self.assertRaises(ValueError):
            dt._extract_json("no json here")


class TestConvertTestCase(unittest.TestCase):
    def test_score_zero_is_vulnerable(self):
        r = dt.convert_test_case(FakeTestCase("Toxicity", "insults", 0), ["deepteam:toxic-content"])
        self.assertFalse(r["passed"])
        self.assertEqual(r["severity"], "high")
        self.assertEqual(r["evidence"]["mode"], "deepteam-real")
        self.assertEqual(r["evidence"]["vulnerability_type"], "insults")

    def test_score_one_is_safe(self):
        r = dt.convert_test_case(FakeTestCase("Bias", "gender", 1), ["deepteam:bias-gender"])
        self.assertTrue(r["passed"])

    def test_error_marks_failed_and_errored(self):
        r = dt.convert_test_case(
            FakeTestCase("Bias", "race", None, error="simulation failed"),
            ["deepteam:bias-race"],
        )
        self.assertFalse(r["passed"])
        self.assertTrue(r["evidence"]["errored"])
        self.assertEqual(r["evidence"]["error"], "simulation failed")


class TestHeuristicFallbackProtocol(unittest.TestCase):
    """With no eval_provider, the runner must run heuristic probes and still
    honour the stdin(JSON)→stdout(JSONL) contract even when the target is
    unreachable (each probe fails closed to an errored result, exit 0)."""

    def test_compiles(self):
        self.assertEqual(subprocess.call([sys.executable, "-m", "py_compile", RUNNER]), 0)

    def test_heuristic_emits_jsonl_without_eval_provider(self):
        # Port 1 is unreachable → call_target raises → error_result per probe.
        config = {
            "target_url": "http://127.0.0.1:1",
            "provider_type": "custom",
            "plugins": ["deepteam:toxic-content", "deepteam:unknown-plugin"],
        }
        proc = subprocess.run(
            [sys.executable, RUNNER], input=json.dumps(config),
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(proc.returncode, 0)
        lines = [l for l in proc.stdout.strip().splitlines() if l.strip()]
        self.assertTrue(lines, "expected JSONL output")
        payloads = [json.loads(l) for l in lines]
        # Every emitted line is a valid result object in heuristic mode.
        for p in payloads:
            self.assertIn("test_name", p)
            self.assertIn("passed", p)
        # The unknown plugin is reported as a benign skip.
        self.assertTrue(any("unknown" in p["test_name"].lower() for p in payloads))
        # The toxic-content probe ran in heuristic mode.
        self.assertTrue(any(p.get("evidence", {}).get("mode") == "builtin-heuristic" for p in payloads))


def _deepteam_installed():
    try:
        import deepteam  # noqa: F401
        return True
    except Exception:
        return False


@unittest.skipUnless(_deepteam_installed(), "deepteam not installed")
class TestRealEngineConstruction(unittest.TestCase):
    """Runs only where deepteam is installed (the built image / local venv):
    verifies the plugin specs actually map to real deepteam classes & types."""

    def test_build_vulnerabilities_dedupes_and_maps(self):
        vulns = dt.build_vulnerabilities([
            "deepteam:bias-gender", "deepteam:bias-race",
            "deepteam:toxic-content", "deepteam:bias-gender",  # duplicate
        ])
        # gender, race, toxicity → 3 distinct instances (duplicate collapsed).
        self.assertEqual(len(vulns), 3)

    def test_every_spec_class_exists_with_valid_types(self):
        import deepteam.vulnerabilities as V
        for pid, (cls_name, _display, types, *_rest) in dt.VULN_SPEC.items():
            cls = getattr(V, cls_name, None)
            self.assertIsNotNone(cls, f"{cls_name} missing for {pid}")
            inst = cls(types=types) if types else cls()  # must not raise
            self.assertIsNotNone(inst)

    def test_build_attacks_default(self):
        attacks = dt.build_attacks()
        self.assertTrue(attacks)


if __name__ == "__main__":
    unittest.main()
