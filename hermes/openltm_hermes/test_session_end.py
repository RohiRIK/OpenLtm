import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import openltm_hermes


READ_ONLY_OPERATION_VARIANTS = (
    (
        "plain",
        "Call openltm_brain_stats exactly once; report status; "
        "do not write or delete memory.",
    ),
    (
        "described-brain-stats",
        "Call the OpenLTM tool that reports memory statistics exactly once, then "
        "report the total memory count in one short sentence. Do not write or "
        "delete any memory.",
    ),
    (
        "polite-question",
        "Can you please call openltm_brain_stats exactly once; do not write memory.",
    ),
    (
        "inline-code",
        "Please call `openltm_context` now; report the result; do not write memory.",
    ),
    (
        "bold",
        "Invoke **openltm_graph** exactly once; return results; do not write memory.",
    ),
    (
        "recall",
        "Query openltm_recall exactly once; do not write memory.",
    ),
)
MIXED_OPERATION_AND_CONSTRAINT = (
    "Call openltm_context now. Always use Bun, never npm in this project."
)
DURABLE_OPENLTM_CONSTRAINT = (
    "Always call openltm_recall before answering project questions."
)
MUTATING_TOOL_OPERATIONS = (
    "Call openltm_learn exactly once; do not write memory.",
    "Call openltm_forget exactly once; do not delete memory.",
)
DURABLE_CONSTRAINT = "Always use Bun, never npm in this project."


class SessionEndProvenanceTests(unittest.TestCase):
    def _provider(self):
        provider_cls = getattr(openltm_hermes, "OpenLtmpMemoryProvider")
        provider = provider_cls.__new__(provider_cls)
        provider._conn = object()
        provider._embedder = None
        return provider

    def test_sync_turn_skips_read_only_memory_operation_variants(self):
        for name, operation in READ_ONLY_OPERATION_VARIANTS:
            with self.subTest(name=name):
                learn = Mock()
                provider = self._provider()
                with patch.object(
                    openltm_hermes,
                    "_get_db",
                    return_value=SimpleNamespace(learn=learn),
                ):
                    provider.sync_turn(operation, "OpenLTM status reported.")

                learn.assert_not_called()

    def test_session_end_skips_read_only_memory_operation_variants(self):
        for name, operation in READ_ONLY_OPERATION_VARIANTS:
            with self.subTest(name=name):
                learn = Mock()
                provider = self._provider()
                with patch.object(
                    openltm_hermes,
                    "_get_db",
                    return_value=SimpleNamespace(learn=learn),
                ):
                    provider.on_session_end([
                        {"role": "assistant", "content": "What should I inspect?"},
                        {"role": "user", "content": operation},
                    ])

                learn.assert_not_called()

    def test_sync_turn_keeps_constraint_from_mixed_operational_message(self):
        learn = Mock()
        provider = self._provider()
        with patch.object(openltm_hermes, "_get_db", return_value=SimpleNamespace(learn=learn)):
            provider.sync_turn(
                MIXED_OPERATION_AND_CONSTRAINT,
                "I will use Bun for this project.",
            )

        learn.assert_called_once()

    def test_session_end_keeps_constraint_from_mixed_operational_message(self):
        learn = Mock()
        provider = self._provider()
        with patch.object(openltm_hermes, "_get_db", return_value=SimpleNamespace(learn=learn)):
            provider.on_session_end([
                {"role": "assistant", "content": "What should I inspect?"},
                {"role": "user", "content": MIXED_OPERATION_AND_CONSTRAINT},
            ])

        learn.assert_called_once()

    def test_sync_turn_keeps_durable_openltm_constraint(self):
        learn = Mock()
        provider = self._provider()
        with patch.object(openltm_hermes, "_get_db", return_value=SimpleNamespace(learn=learn)):
            provider.sync_turn(
                DURABLE_OPENLTM_CONSTRAINT,
                "I will recall project context before answering.",
            )

        learn.assert_called_once()

    def test_session_end_keeps_durable_openltm_constraint(self):
        learn = Mock()
        provider = self._provider()
        with patch.object(openltm_hermes, "_get_db", return_value=SimpleNamespace(learn=learn)):
            provider.on_session_end([
                {"role": "assistant", "content": "How should I use project memory?"},
                {"role": "user", "content": DURABLE_OPENLTM_CONSTRAINT},
            ])

        learn.assert_called_once()

    def test_sync_turn_does_not_exempt_mutating_tools(self):
        for operation in MUTATING_TOOL_OPERATIONS:
            with self.subTest(operation=operation):
                learn = Mock()
                provider = self._provider()
                with patch.object(
                    openltm_hermes,
                    "_get_db",
                    return_value=SimpleNamespace(learn=learn),
                ):
                    provider.sync_turn(operation, "I will follow that instruction.")

                learn.assert_called_once()

    def test_session_end_does_not_exempt_mutating_tools(self):
        for operation in MUTATING_TOOL_OPERATIONS:
            with self.subTest(operation=operation):
                learn = Mock()
                provider = self._provider()
                with patch.object(
                    openltm_hermes,
                    "_get_db",
                    return_value=SimpleNamespace(learn=learn),
                ):
                    provider.on_session_end([
                        {"role": "assistant", "content": "Which tool should I call?"},
                        {"role": "user", "content": operation},
                    ])

                learn.assert_called_once()

    def test_sync_turn_keeps_durable_project_constraint(self):
        learn = Mock()
        provider = self._provider()
        with patch.object(openltm_hermes, "_get_db", return_value=SimpleNamespace(learn=learn)):
            provider.sync_turn(DURABLE_CONSTRAINT, "I will use Bun for this project.")

        learn.assert_called_once()

    def test_session_end_keeps_durable_project_constraint(self):
        learn = Mock()
        provider = self._provider()
        with patch.object(openltm_hermes, "_get_db", return_value=SimpleNamespace(learn=learn)):
            provider.on_session_end([
                {"role": "assistant", "content": "Which package manager should I use?"},
                {"role": "user", "content": DURABLE_CONSTRAINT},
            ])

        learn.assert_called_once()

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
