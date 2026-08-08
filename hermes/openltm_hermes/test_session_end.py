import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import openltm_hermes


class SessionEndProvenanceTests(unittest.TestCase):
    def _provider(self):
        provider_cls = getattr(openltm_hermes, "OpenLtmpMemoryProvider")
        provider = provider_cls.__new__(provider_cls)
        provider._conn = object()
        return provider

    def test_skips_synthetic_operational_envelopes(self):
        learn = Mock()
        provider = self._provider()
        with patch.object(openltm_hermes, "_get_db", return_value=SimpleNamespace(learn=learn)):
            provider.on_session_end([
                {"role": "assistant", "content": "I will wait for the result."},
                {
                    "role": "user",
                    "content": "[ASYNC DELEGATION BATCH COMPLETE — deleg_x] "
                    "A background fan-out completed successfully.",
                },
                {"role": "assistant", "content": "The task ran."},
                {
                    "role": "user",
                    "content": "[IMPORTANT: Background process proc_abc completed normally "
                    "(exit code 0).]",
                },
            ])

        learn.assert_not_called()

    def test_keeps_real_user_correction(self):
        learn = Mock()
        provider = self._provider()
        with patch.object(openltm_hermes, "_get_db", return_value=SimpleNamespace(learn=learn)):
            provider.on_session_end([
                {"role": "assistant", "content": "I will use the old deployment path."},
                {"role": "user", "content": "No, use the approved deployment path instead."},
            ])

        learn.assert_called_once_with(
            provider._conn,
            "No, use the approved deployment path instead.",
            category="gotcha",
            importance=4,
        )


if __name__ == "__main__":
    unittest.main()
