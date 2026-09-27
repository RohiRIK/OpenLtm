import os
import unittest
from unittest.mock import patch

from openltm_hermes._providers import GeminiProvider, detect_provider


class DetectProviderTest(unittest.TestCase):
    def test_ambient_cloud_keys_never_select_a_cloud_embedder(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "k", "OPENAI_API_KEY": "k"}), \
                patch("urllib.request.urlopen", side_effect=OSError("no ollama")):
            self.assertIsNone(detect_provider())
            self.assertIsNone(detect_provider("none"))

    def test_cloud_embedder_requires_explicit_choice_and_key(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "k"}):
            self.assertIsInstance(detect_provider("gemini"), GeminiProvider)
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(detect_provider("gemini"))


if __name__ == "__main__":
    unittest.main()
