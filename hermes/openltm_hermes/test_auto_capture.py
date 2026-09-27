"""Tests for the auto-capture rule engine.

Written with stdlib `unittest` so they run both under `python3 -m unittest` and
under `pytest` (which collects unittest.TestCase natively). No third-party
dependency is required to verify extraction policy.

`auto_capture` is deliberately free of Hermes imports, so it loads directly
from its file. That means the extraction policy is testable without a Hermes
runtime — the previous tests could only run inside a full install.
"""

import importlib.util
import sys
import unittest
from pathlib import Path


def _load_auto_capture():
    path = Path(__file__).resolve().parent / "auto_capture.py"
    name = "openltm_auto_capture_under_test"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves annotations through sys.modules, so register before exec.
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ac = _load_auto_capture()


class DistillTests(unittest.TestCase):
    def test_strips_speech_marker_prefix(self):
        self.assertEqual(
            ac.distill("I prefer Bun over npm.", ("prefer",)),
            "Bun over npm.",
        )

    def test_preserves_negation(self):
        # Losing the negation would invert a correction into an approval.
        self.assertEqual(
            ac.distill("Don't use npm, use bun.", ("don't",)),
            "Don't use npm, use bun.",
        )

    def test_picks_the_sentence_containing_the_trigger(self):
        text = "The build takes a while. I prefer Bun over npm. That is all."
        # The trigger sentence is selected, then its speech marker stripped.
        self.assertEqual(ac.distill(text, ("prefer",)), "Bun over npm.")

    def test_falls_back_to_truncated_text_without_a_trigger(self):
        self.assertEqual(ac.distill("no triggers here", ("zzz",)), "No triggers here")

    def test_never_returns_empty(self):
        self.assertTrue(ac.distill("", ("x",)).strip() == "")


class GuardTests(unittest.TestCase):
    def test_transient_operational_is_detected(self):
        for text in (
            "[ASYNC DELEGATION BATCH COMPLETE — deleg_x] done",
            "[IMPORTANT: Background process proc_abc completed normally (exit code 0).]",
            "context compaction — reference only",
            "background process worker completed",
        ):
            with self.subTest(text=text):
                self.assertTrue(ac.is_transient_operational(text))

    def test_real_knowledge_is_not_transient(self):
        self.assertFalse(
            ac.is_transient_operational("Always run the migration before deploying.")
        )

    READ_ONLY = (
        "Call openltm_brain_stats exactly once; report status; do not write or delete memory.",
        "Can you please call openltm_brain_stats exactly once; do not write memory.",
        "Please call `openltm_context` now; report the result; do not write memory.",
        "Invoke **openltm_graph** exactly once; return results; do not write memory.",
        "Query openltm_recall exactly once; do not write memory.",
        "Call the OpenLTM tool that reports memory statistics exactly once, then "
        "report the total memory count in one short sentence. Do not write or delete "
        "any memory.",
    )

    def test_read_only_requests_are_exempt(self):
        for text in self.READ_ONLY:
            with self.subTest(text=text):
                self.assertTrue(ac.is_read_only_memory_request(text))

    def test_described_read_only_tool_is_generalised(self):
        # Not the exact wording that was originally hard-coded.
        self.assertTrue(
            ac.is_read_only_memory_request(
                "Call the openltm tool that returns memory stats now; report status."
            )
        )

    def test_mixed_message_is_not_exempt(self):
        self.assertFalse(
            ac.is_read_only_memory_request(
                "Call openltm_context now. Always use Bun, never npm in this project."
            )
        )

    def test_mutating_tool_requests_are_not_exempt(self):
        for text in (
            "Call openltm_learn exactly once; do not write memory.",
            "Call openltm_forget exactly once; do not delete memory.",
        ):
            with self.subTest(text=text):
                self.assertFalse(ac.is_read_only_memory_request(text))

    def test_durable_openltm_constraint_is_not_exempt(self):
        self.assertFalse(
            ac.is_read_only_memory_request(
                "Always call openltm_recall before answering project questions."
            )
        )


class RuleTableTests(unittest.TestCase):
    def test_rules_have_unique_names(self):
        names = [r.name for r in ac.RULES]
        self.assertEqual(len(names), len(set(names)))

    def test_user_rules_come_before_assistant_rules(self):
        self.assertEqual(ac.RULES[: len(ac.USER_RULES)], ac.USER_RULES)

    def test_correction_outranks_preference(self):
        # "No, use X instead" contains both "no," and "use " — it must be a
        # gotcha, not a preference.
        decision = ac.evaluate_turn("No, use the approved deployment path instead.", "ok")
        self.assertIsNotNone(decision)
        self.assertEqual(decision.rule, "correction")
        self.assertEqual(decision.category, "gotcha")

    def test_constraint_outranks_preference(self):
        # "Always use Bun, never npm" is a hard rule that also contains "use ";
        # filing it as a soft preference would drop it to importance 3.
        decision = ac.evaluate_turn("Always use Bun, never npm in this project.", "ok")
        self.assertIsNotNone(decision)
        self.assertEqual(decision.rule, "constraint")
        self.assertEqual(decision.importance, 4)


class EvaluateTurnTests(unittest.TestCase):
    def test_correction_becomes_a_distilled_gotcha(self):
        d = ac.evaluate_turn("No, use the approved deployment path instead.", "I will follow that.")
        self.assertEqual((d.rule, d.category, d.importance), ("correction", "gotcha", 4))
        self.assertEqual(d.content, "No, use the approved deployment path instead.")

    def test_constraint_is_captured(self):
        d = ac.evaluate_turn("Always use Bun, never npm in this project.", "Understood.")
        self.assertEqual((d.rule, d.category), ("constraint", "constraint"))

    def test_preference_is_captured(self):
        d = ac.evaluate_turn("I prefer tabs over spaces.", "Noted.")
        self.assertEqual((d.rule, d.category), ("preference", "preference"))
        self.assertEqual(d.content, "Tabs over spaces.")

    def test_assistant_discovery_is_the_fallback(self):
        d = ac.evaluate_turn("Can you check the build?", "Turns out the fix is clearing the cache.")
        self.assertEqual((d.rule, d.category), ("discovery", "gotcha"))

    def test_read_only_request_is_skipped(self):
        self.assertIsNone(
            ac.evaluate_turn(
                "Call openltm_brain_stats exactly once; report status; do not write memory.",
                "Total memories: 42.",
            )
        )

    def test_mixed_operational_message_keeps_the_constraint(self):
        d = ac.evaluate_turn(
            "Call openltm_context now. Always use Bun, never npm in this project.",
            "I will use Bun for this project.",
        )
        self.assertIsNotNone(d)
        self.assertEqual(d.rule, "constraint")

    def test_transient_notification_is_skipped(self):
        self.assertIsNone(
            ac.evaluate_turn(
                "[IMPORTANT: Background process proc_1 completed normally (exit code 0).]",
                "The task ran.",
            )
        )

    def test_bare_acknowledgement_is_not_stored(self):
        self.assertIsNone(ac.evaluate_turn("ok thanks", "done"))

    def test_empty_turn_is_not_stored(self):
        self.assertIsNone(ac.evaluate_turn("", ""))


class EvaluateSessionTests(unittest.TestCase):
    def test_keeps_a_real_correction(self):
        decisions = ac.evaluate_session(
            [
                {"role": "assistant", "content": "I will use the old deployment path."},
                {"role": "user", "content": "No, use the approved deployment path instead."},
            ]
        )
        self.assertEqual(len(decisions), 1)
        self.assertEqual(decisions[0].rule, "correction")

    def test_opening_correction_is_ignored(self):
        # A correction with no preceding agent turn is a rebuttal to nothing.
        self.assertEqual(
            ac.evaluate_session([{"role": "user", "content": "No, never do that."}]), []
        )

    def test_uses_the_same_rule_set_as_sync_turn(self):
        # A phrase only the shared user rule list knows about.
        decisions = ac.evaluate_session(
            [
                {"role": "assistant", "content": "Which editor?"},
                {"role": "user", "content": "I'd rather stick to Helix in this repo."},
            ]
        )
        self.assertEqual([d.rule for d in decisions], ["preference"])

    def test_read_only_requests_are_skipped(self):
        self.assertEqual(
            ac.evaluate_session(
                [
                    {"role": "assistant", "content": "What should I inspect?"},
                    {
                        "role": "user",
                        "content": "Call openltm_brain_stats exactly once; report status; "
                        "do not write or delete memory.",
                    },
                ]
            ),
            [],
        )

    def test_synthetic_envelopes_are_skipped(self):
        self.assertEqual(
            ac.evaluate_session(
                [
                    {"role": "assistant", "content": "I will wait for the result."},
                    {
                        "role": "user",
                        "content": "[ASYNC DELEGATION BATCH COMPLETE — deleg_x] "
                        "A background fan-out completed successfully.",
                    },
                    {"role": "assistant", "content": "The task ran."},
                    {
                        "role": "user",
                        "content": "[IMPORTANT: Background process proc_abc completed "
                        "normally (exit code 0).]",
                    },
                ]
            ),
            [],
        )

    def test_respects_max_extract(self):
        messages = [{"role": "assistant", "content": "Noted."}]
        for i in range(10):
            messages.append({"role": "user", "content": f"Always use tool number {i} for jobs."})
        self.assertEqual(len(ac.evaluate_session(messages, max_extract=3)), 3)

    def test_ignores_assistant_messages(self):
        self.assertEqual(
            ac.evaluate_session([{"role": "assistant", "content": "Turns out the fix is X."}]), []
        )

    def test_handles_block_content_lists(self):
        decisions = ac.evaluate_session(
            [
                {"role": "assistant", "content": "Which runtime?"},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Always use Bun, never node."},
                        {"type": "image", "url": "ignored"},
                    ],
                },
            ]
        )
        self.assertEqual([d.rule for d in decisions], ["constraint"])


if __name__ == "__main__":
    unittest.main()
