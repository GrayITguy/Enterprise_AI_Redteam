"""Tests for the pure helper functions in the garak worker runner.

These run without garak installed — the heavy tool is invoked via subprocess at
runtime, not imported at module top — so they're a fast guard against drift in
the config-building, prompt-shaping, and detector-scoring logic.
"""
import unittest

from _util import load_runner

garak = load_runner("garak")


class TestPluginMap(unittest.TestCase):
    def test_every_entry_has_required_metadata(self):
        for plugin_id, meta in garak.PLUGIN_MAP.items():
            self.assertTrue(plugin_id.startswith("garak:"), plugin_id)
            self.assertIn("probes", meta)
            self.assertTrue(meta["probes"], f"{plugin_id} has no probes")
            self.assertIn(meta["severity"], {"critical", "high", "medium", "low", "info"})
            self.assertTrue(meta["owasp"] is None or meta["owasp"].startswith("LLM"))


class TestExtractOutputText(unittest.TestCase):
    def test_string_passthrough(self):
        self.assertEqual(garak.extract_output_text("hello"), "hello")

    def test_message_dict(self):
        self.assertEqual(garak.extract_output_text({"text": "hi"}), "hi")

    def test_content_dict_fallback(self):
        self.assertEqual(garak.extract_output_text({"content": "yo"}), "yo")

    def test_none(self):
        self.assertIsNone(garak.extract_output_text(None))

    def test_empty_dict(self):
        self.assertIsNone(garak.extract_output_text({}))


class TestBuildRestConfig(unittest.TestCase):
    def test_ollama_shape(self):
        cfg = garak.build_rest_config(
            {"provider_type": "ollama", "target_url": "http://host:11434/", "model": "llama3"}
        )
        rest = cfg["rest"]["RestGenerator"]
        self.assertEqual(rest["uri"], "http://host:11434/api/chat")
        self.assertEqual(rest["response_json_field"], "$.message.content")
        self.assertFalse(rest["req_template_json_object"]["stream"])

    def test_openai_default_shape_and_bearer_auth(self):
        cfg = garak.build_rest_config(
            {
                "provider_type": "openai",
                "target_url": "https://api.example.com",
                "model": "gpt-4o-mini",
                "provider_config": {"apiKey": "sk-test"},
            }
        )
        rest = cfg["rest"]["RestGenerator"]
        self.assertTrue(rest["uri"].endswith("/v1/chat/completions"))
        self.assertEqual(rest["headers"]["Authorization"], "Bearer sk-test")
        self.assertEqual(rest["response_json_field"], "$.choices[0].message.content")

    def test_anthropic_headers(self):
        cfg = garak.build_rest_config(
            {
                "provider_type": "anthropic",
                "target_url": "https://api.anthropic.com/v1/messages",
                "model": "claude",
                "provider_config": {"api_key": "ak-1"},
            }
        )
        rest = cfg["rest"]["RestGenerator"]
        self.assertEqual(rest["headers"]["x-api-key"], "ak-1")
        self.assertIn("anthropic-version", rest["headers"])
        self.assertEqual(rest["response_json_field"], "$.content[0].text")

    def test_custom_endpoint_not_double_suffixed(self):
        cfg = garak.build_rest_config(
            {
                "provider_type": "custom",
                "provider_config": {"endpoint": "https://x.test/v1/chat/completions"},
                "model": "m",
            }
        )
        self.assertEqual(
            cfg["rest"]["RestGenerator"]["uri"], "https://x.test/v1/chat/completions"
        )


class TestResolvePluginForProbe(unittest.TestCase):
    def test_matches_requesting_plugin(self):
        pid, meta = garak.resolve_plugin_for_probe(
            "encoding.InjectBase64", ["garak:encoding-attacks", "garak:dan-variants"]
        )
        self.assertEqual(pid, "garak:encoding-attacks")
        self.assertEqual(meta["category"], "encoding")

    def test_falls_back_to_first_requested(self):
        pid, _ = garak.resolve_plugin_for_probe("unknownmod.Foo", ["garak:dan-variants"])
        self.assertEqual(pid, "garak:dan-variants")

    def test_unknown_when_nothing_requested(self):
        pid, meta = garak.resolve_plugin_for_probe("x.Y", [])
        self.assertEqual(pid, "garak:unknown")
        self.assertEqual(meta["severity"], "info")


class TestAttemptIsHit(unittest.TestCase):
    def test_hit_above_threshold(self):
        self.assertTrue(garak.attempt_is_hit({"det": [0.9]}))

    def test_scalar_score(self):
        self.assertTrue(garak.attempt_is_hit({"det": 1.0}))

    def test_no_hit_below_threshold(self):
        self.assertFalse(garak.attempt_is_hit({"det": [0.1, 0.2]}))

    def test_non_dict_is_safe(self):
        self.assertFalse(garak.attempt_is_hit(None))

    def test_non_numeric_scores_ignored(self):
        self.assertFalse(garak.attempt_is_hit({"det": ["n/a", None]}))


class TestStringifyPrompt(unittest.TestCase):
    def test_plain_string(self):
        self.assertEqual(garak.stringify_prompt("hi"), "hi")

    def test_conversation_turns(self):
        out = garak.stringify_prompt({"turns": [{"content": {"text": "a"}}, {"content": "b"}]})
        self.assertEqual(out, "a\nb")

    def test_none(self):
        self.assertIsNone(garak.stringify_prompt(None))


if __name__ == "__main__":
    unittest.main()
