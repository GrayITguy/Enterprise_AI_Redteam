"""Tests for the pyrit worker runner's pure helpers.

Focus on the SSRF guard (_is_safe_url) — a security control that must not
regress — and the content-detection heuristics.
"""
import json
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


class TestPluginSpec(unittest.TestCase):
    def test_attack_spec_matches_plugin_map(self):
        self.assertEqual(set(pyrit.ATTACK_SPEC), set(pyrit.PLUGIN_MAP))

    def test_attack_kinds_are_known(self):
        known = {"prompt_sending", "skeleton_key", "many_shot", "flip", "crescendo", "tap", "pair"}
        for pid, (kind, needs_adv, objective) in pyrit.ATTACK_SPEC.items():
            self.assertIn(kind, known, pid)
            self.assertIsInstance(needs_adv, bool)
            self.assertTrue(objective)

    def test_plugin_map_metadata(self):
        for pid, meta in pyrit.PLUGIN_MAP.items():
            self.assertIn(meta["severity"], {"critical", "high", "medium", "low", "info"})
            self.assertTrue(meta["owasp_category"].startswith("LLM"))


class TestCallChatMessageBuilding(unittest.TestCase):
    """call_chat must shape the request per provider — verified by capturing the
    URL/body via a stubbed urlopen (no network)."""

    def _capture(self, descriptor, messages, response):
        import io
        captured = {}

        class FakeResp:
            def __enter__(self_):
                return self_

            def __exit__(self_, *a):
                return False

            def read(self_):
                return json.dumps(response).encode()

        def fake_urlopen(req, timeout=90):
            captured["url"] = req.full_url
            captured["body"] = json.loads(req.data.decode())
            captured["headers"] = {k.lower(): v for k, v in req.header_items()}
            return FakeResp()

        orig = pyrit.urllib.request.urlopen
        pyrit.urllib.request.urlopen = fake_urlopen
        try:
            text = pyrit.call_chat(descriptor, messages)
        finally:
            pyrit.urllib.request.urlopen = orig
        return text, captured

    def test_openai_shape(self):
        text, cap = self._capture(
            {"type": "openai", "endpoint": "https://api.example.com", "api_key": "sk-1", "model": "m"},
            [{"role": "user", "content": "hi"}],
            {"choices": [{"message": {"content": "hello"}}]},
        )
        self.assertEqual(text, "hello")
        self.assertTrue(cap["url"].endswith("/v1/chat/completions"))
        self.assertEqual(cap["headers"].get("authorization"), "Bearer sk-1")

    def test_ollama_shape(self):
        text, cap = self._capture(
            {"type": "ollama", "endpoint": "http://host.docker.internal:11434", "model": "llama3"},
            [{"role": "user", "content": "hi"}],
            {"message": {"content": "hey"}},
        )
        self.assertEqual(text, "hey")
        self.assertTrue(cap["url"].endswith("/api/chat"))

    def test_anthropic_extracts_system(self):
        text, cap = self._capture(
            {"type": "anthropic", "endpoint": "https://api.anthropic.com", "api_key": "ak", "model": "claude"},
            [{"role": "system", "content": "be strict"}, {"role": "user", "content": "hi"}],
            {"content": [{"type": "text", "text": "ok"}]},
        )
        self.assertEqual(text, "ok")
        self.assertEqual(cap["body"]["system"], "be strict")
        self.assertEqual(cap["headers"].get("x-api-key"), "ak")

    def test_rejects_ssrf_endpoint(self):
        with self.assertRaises(ValueError):
            pyrit.call_chat({"type": "openai", "endpoint": "http://169.254.169.254", "model": "m"},
                            [{"role": "user", "content": "hi"}])


def _pyrit_installed():
    try:
        import pyrit as _p  # noqa: F401
        return True
    except Exception:
        return False


@unittest.skipUnless(_pyrit_installed(), "pyrit not installed")
class TestRealEngineConstruction(unittest.TestCase):
    """Runs only where PyRIT is installed (built image / local venv): verifies
    the custom target and every mapped attack construct against real PyRIT."""

    def test_target_and_attacks_build(self):
        import asyncio

        async def _run():
            from pyrit.setup.initialization import initialize_pyrit_async
            from pyrit.executor.attack import AttackScoringConfig, AttackAdversarialConfig
            from pyrit.score import SelfAskRefusalScorer, TrueFalseInverterScorer

            await initialize_pyrit_async("InMemory")
            TargetCls = pyrit._build_target_class()
            target = TargetCls({"type": "custom", "endpoint": "http://localhost:1", "model": "m"})
            evalt = TargetCls({"type": "custom", "endpoint": "http://localhost:1", "model": "m"})
            scoring = AttackScoringConfig(
                objective_scorer=TrueFalseInverterScorer(scorer=SelfAskRefusalScorer(chat_target=evalt)))
            adv = AttackAdversarialConfig(target=evalt)
            for kind in ["prompt_sending", "skeleton_key", "many_shot", "flip", "crescendo", "tap", "pair"]:
                pyrit._build_attack(kind, target, evalt, scoring, adv)  # must not raise

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
