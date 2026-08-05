"""Tests for the pyrit worker runner's pure helpers.

Focus on the SSRF guard (_is_safe_url) — a security control that must not
regress — and the content-detection heuristics.
"""
import unittest

from _util import load_runner

pyrit = load_runner("pyrit")


class TestIsSafeUrl(unittest.TestCase):
    def test_allows_public_https(self):
        parsed = pyrit._is_safe_url("https://api.openai.com/v1/chat/completions")
        self.assertEqual(parsed.hostname, "api.openai.com")

    def test_allows_localhost_for_ollama(self):
        self.assertTrue(pyrit._is_safe_url("http://localhost:11434/api/chat"))
        self.assertTrue(pyrit._is_safe_url("http://host.docker.internal:11434"))

    def test_blocks_cloud_metadata(self):
        with self.assertRaises(ValueError):
            pyrit._is_safe_url("http://169.254.169.254/latest/meta-data/")
        with self.assertRaises(ValueError):
            pyrit._is_safe_url("http://metadata.google.internal/")

    def test_blocks_private_ip(self):
        with self.assertRaises(ValueError):
            pyrit._is_safe_url("http://10.0.0.5/")
        with self.assertRaises(ValueError):
            pyrit._is_safe_url("http://192.168.1.1/")

    def test_blocks_non_http_scheme(self):
        with self.assertRaises(ValueError):
            pyrit._is_safe_url("file:///etc/passwd")
        with self.assertRaises(ValueError):
            pyrit._is_safe_url("gopher://evil/")


class TestHarmfulContentHeuristics(unittest.TestCase):
    def test_instructions_without_refusal_flag_harmful(self):
        self.assertTrue(
            pyrit.contains_harmful_content("Step 1: gather materials. Step 2: proceed.")
        )

    def test_refusal_overrides_instructions(self):
        self.assertFalse(
            pyrit.contains_harmful_content("I can't help. But step 1: nothing.")
        )

    def test_empty_is_safe(self):
        self.assertFalse(pyrit.contains_harmful_content(""))
        self.assertFalse(pyrit.contains_harmful_content(None))


class TestSynthesisHeuristics(unittest.TestCase):
    def test_detects_synthesis_keywords(self):
        self.assertTrue(pyrit.contains_synthesis_info("Combine equal parts and heat."))

    def test_benign_text_is_safe(self):
        self.assertFalse(pyrit.contains_synthesis_info("The weather is nice today."))


if __name__ == "__main__":
    unittest.main()
