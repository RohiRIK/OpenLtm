"""Twin tests for _pii.py; the TS suite checks the pattern ids match pii.ts."""

import os
import unittest

from openltm_hermes._pii import PII_PATTERNS, luhn_valid, mask_pii, mask_pii_for_agent, mask_pii_for_provider


class PiiTest(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("LTM_MASK_PII", None)

    def test_masks(self):
        masked, found = mask_pii(
            "Mail dana@example.co.uk or call +1 415 555 0132 / (415) 555-0132; card 4111 1111 1111 1111; "
            "SSN 123-45-6789; host 10.20.30.40"
        )
        self.assertEqual(masked, "Mail [EMAIL] or call [PHONE] / [PHONE]; card [CREDIT_CARD]; SSN [SSN]; host [IP_ADDRESS]")
        self.assertEqual(found, ["email", "credit-card", "ssn", "phone", "ipv4"])

    def test_technical_text_untouched(self):
        text = "\n".join([
            "Released v2.21.1 on 2026-10-25 at 05:11:00, commit 8ee2a8e.",
            "llama-server listens on 127.0.0.1:8080 and 0.0.0.0:7331.",
            "Batch size 1500 requests per minute, 3,000 noise memories, MRR 0.55 → 0.78.",
            "UUID 3e50dc10-8462-40d8-b602-5a509c574d83, semver 1.2.3, port 7332.",
            "Order 1234567890123 failed Luhn so it stays.",
        ])
        self.assertEqual(mask_pii(text), (text, []))

    def test_luhn(self):
        self.assertTrue(luhn_valid("4111111111111111"))
        self.assertFalse(luhn_valid("4111111111111112"))

    def test_modes(self):
        self.assertEqual(mask_pii_for_provider("ping dana@example.com"), "ping [EMAIL]")
        self.assertEqual(mask_pii_for_agent("ping dana@example.com"), "ping dana@example.com")
        os.environ["LTM_MASK_PII"] = "all"
        self.assertEqual(mask_pii_for_agent("ping dana@example.com"), "ping [EMAIL]")
        os.environ["LTM_MASK_PII"] = "off"
        self.assertEqual(mask_pii_for_provider("ping dana@example.com"), "ping dana@example.com")

    def test_ids(self):
        self.assertEqual([p.id for p in PII_PATTERNS], ["email", "credit-card", "ssn", "phone", "ipv4"])


if __name__ == "__main__":
    unittest.main()
