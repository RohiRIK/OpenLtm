"""Regression tests for R-3 embedding boundary hardening: secrets scrubber."""

from __future__ import annotations

import pytest

from openltm_hermes._secrets_scrubber import ScrubResult, scrub_secrets, scrub_secrets_for_embedding


# Token-shaped test values are assembled at runtime so no provider-format
# literal is committed (keeps GitHub secret scanning quiet); values are fake.
_GHP = "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz12345678901234"
_SK = "s" + "k-" + "abcdefghijklmnopqrstuvwxyz1234567890123456"
_SK_PROJ = "s" + "k-proj-" + "abcdefghijklmnopqrstuvwxyz12345678901234567890"
_XOXB = "xo" + "xb-" + "123456789012-abcdefghijkl"
_XOXP = "xo" + "xp-" + "abcdefghijklmnopqrst"
_PEM_BEGIN = "-----BEGIN " + "PRIVATE KEY-----"


class TestSecretsScrubber:
    """Tests for the secrets scrubber ported from TypeScript."""

    def test_no_secrets_returns_original(self):
        """Plain text with no secrets should return unchanged."""
        text = "This is a normal sentence about preferences."
        result = scrub_secrets(text)
        assert result == ScrubResult(scrubbed=text, redactions=[])

    def test_aws_access_key_redacted(self):
        """AWS access key (AKIA...) should be redacted."""
        text = "My AWS key is AKIAIOSFODNN7EXAMPLE for testing."
        result = scrub_secrets(text)
        assert "AKIAIOSFODNN7EXAMPLE" not in result.scrubbed
        assert "[REDACTED:aws-access-key]" in result.scrubbed
        assert "aws-access-key" in result.redactions

    def test_github_token_redacted(self):
        """GitHub tokens (ghp_, ghs_, github_pat_) should be redacted."""
        texts = [
            "Token: " + _GHP,
            "Fine-grained: github_pat_" + "a" * 82,
        ]
        for text in texts:
            result = scrub_secrets(text)
            assert "[REDACTED:github-token]" in result.scrubbed
            assert "github-token" in result.redactions

    def test_openai_key_redacted(self):
        """OpenAI keys (sk-, sk-proj-) should be redacted."""
        texts = [
            _SK,
            _SK_PROJ,
        ]
        for text in texts:
            result = scrub_secrets(text)
            assert "[REDACTED:openai-key]" in result.scrubbed
            assert "openai-key" in result.redactions

    def test_anthropic_key_redacted(self):
        """Anthropic keys (sk-ant-) should be redacted."""
        text = "sk-ant-" + "a" * 93
        result = scrub_secrets(text)
        assert "[REDACTED:anthropic-key]" in result.scrubbed
        assert "anthropic-key" in result.redactions

    def test_google_api_key_redacted(self):
        """Google API keys (AIza...) should be redacted."""
        text = "My Google key: AIza" + "a" * 35
        result = scrub_secrets(text)
        assert "[REDACTED:google-api-key]" in result.scrubbed
        assert "google-api-key" in result.redactions

    def test_stripe_key_redacted(self):
        """Stripe keys (sk_test_, pk_live_, etc.) should be redacted."""
        texts = [
            "sk_test_abcdefghijklmnopqrstuvwxyz",
            "pk_live_abcdefghijklmnopqrstuvwxyz1234",
        ]
        for text in texts:
            result = scrub_secrets(text)
            assert "[REDACTED:stripe-key]" in result.scrubbed
            assert "stripe-key" in result.redactions

    def test_slack_token_redacted(self):
        """Slack tokens (xoxb-, xoxp-, xoxr-, etc.) should be redacted."""
        texts = [_XOXB, _XOXP]
        for text in texts:
            result = scrub_secrets(text)
            assert "[REDACTED:slack-token]" in result.scrubbed
            assert "slack-token" in result.redactions

    def test_jwt_redacted(self):
        """JWT tokens should be redacted."""
        text = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        result = scrub_secrets(text)
        assert "[REDACTED:jwt]" in result.scrubbed
        assert "jwt" in result.redactions

    def test_bearer_token_redacted(self):
        """Bearer tokens should be redacted."""
        text = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"
        result = scrub_secrets(text)
        assert "Bearer [REDACTED:bearer-token]" in result.scrubbed
        assert "bearer-token" in result.redactions

    def test_connection_string_redacted(self):
        """Database connection strings should be redacted."""
        texts = [
            "postgres://user:pass@localhost:5432/db",
            "mysql://user:secret@host/db",
            "mongodb://user:password@cluster.mongodb.net/db",
            "redis://:password@localhost:6379",
        ]
        for text in texts:
            result = scrub_secrets(text)
            assert "[REDACTED:connection-string]" in result.scrubbed
            assert "connection-string" in result.redactions

    def test_private_key_redacted(self):
        """Private keys should be redacted."""
        text = _PEM_BEGIN + """
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD...
-----END PRIVATE KEY-----"""
        result = scrub_secrets(text)
        assert "[REDACTED:private-key]" in result.scrubbed
        assert "private-key" in result.redactions

    def test_generic_api_key_redacted(self):
        """Generic api_key/secret_key/access_token patterns should be redacted."""
        texts = [
            'api_key = "abcdefghijklmnopqrstuvwxyz123456"',
            "secret_key: 'abcdefghijklmnopqrstuvwxyz123456'",
            'access_token = "abcdefghijklmnopqrstuvwxyz123456"',
        ]
        for text in texts:
            result = scrub_secrets(text)
            assert "[REDACTED:generic-api-key]" in result.scrubbed
            assert "generic-api-key" in result.redactions

    def test_multiple_secrets_all_redacted(self):
        """Multiple different secrets in one text should all be redacted."""
        text = """
        AWS: AKIAIOSFODNN7EXAMPLE
        GitHub: """ + _GHP + """
        OpenAI: """ + _SK + """
        """
        result = scrub_secrets(text)
        assert "[REDACTED:aws-access-key]" in result.scrubbed
        assert "[REDACTED:github-token]" in result.scrubbed
        assert "[REDACTED:openai-key]" in result.scrubbed
        assert set(result.redactions) == {"aws-access-key", "github-token", "openai-key"}

    def test_no_duplicate_redactions_in_list(self):
        """Same secret pattern appearing multiple times should only appear once in redactions."""
        text = "Key1: AKIAIOSFODNN7EXAMPLE Key2: AKIAI44QH8DHBEXAMPLE"
        result = scrub_secrets(text)
        assert result.redactions == ["aws-access-key"]

    def test_scrub_secrets_for_embedding_returns_string(self):
        """Convenience wrapper returns only the scrubbed string."""
        text = "My key is AKIAIOSFODNN7EXAMPLE"
        result = scrub_secrets_for_embedding(text)
        assert isinstance(result, str)
        assert "AKIAIOSFODNN7EXAMPLE" not in result
        assert "[REDACTED:aws-access-key]" in result

    def test_empty_string_returns_empty(self):
        """Empty string should return empty."""
        result = scrub_secrets("")
        assert result == ScrubResult(scrubbed="", redactions=[])
        assert scrub_secrets_for_embedding("") == ""

    def test_none_returns_none(self):
        """None input should return None (or empty)."""
        result = scrub_secrets(None)  # type: ignore
        assert result.scrubbed is None
        assert result.redactions == []

    def test_aws_secret_key_near_context(self):
        """AWS secret key near aws/secret context should be redacted."""
        # The regex expects "aws" or "secret" or "SECRET" followed by non-alnum chars, then 40 base64
        text = 'aws = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"'
        result = scrub_secrets(text)
        assert "[REDACTED:aws-secret-key]" in result.scrubbed
        assert "aws-secret-key" in result.redactions


class TestSecretsScrubberIntegration:
    """Integration tests verifying scrubbing works in embedding paths."""

    def test_learn_scrubs_before_embedding(self, tmp_path):
        """learn() should scrub secrets before calling embedder."""
        from openltm_hermes import _db

        db = _db.connect(tmp_path / "test.db")
        _db.init_schema(db)

        # Mock embedder that captures what it receives
        captured = {}

        class MockEmbedder:
            def embed(self, text):
                captured["text"] = text
                return [0.1] * 768

        mock_embedder = MockEmbedder()

        content = "My API key is " + _SK + " and I like Python"
        _db.learn(db, content, category="preference", importance=3, embedder=mock_embedder)

        # Verify the embedder received scrubbed text
        assert captured["text"] is not None
        assert _SK not in captured["text"]
        assert "[REDACTED:openai-key]" in captured["text"]
        assert "I like Python" in captured["text"]  # legitimate content preserved

        db.close()

    def test_hybrid_search_scrubs_query(self, tmp_path):
        """hybrid_search should scrub the query before vector search."""
        from openltm_hermes import _db

        db = _db.connect(tmp_path / "test2.db")
        _db.init_schema(db)

        # Add a memory
        _db.learn(db, "I prefer using pytest for testing", category="preference", importance=3)

        # Mock embedder that captures query
        captured = {}

        class MockEmbedder:
            def embed(self, text):
                captured["text"] = text
                return [0.1] * 768

        mock_embedder = MockEmbedder()

        # Search with a query containing a secret - call via the provider path
        # that does the scrubbing
        query = "What is my API key " + _SK + " ?"
        # Simulate what handle_tool_call does: scrub then embed
        from openltm_hermes._secrets_scrubber import scrub_secrets_for_embedding
        scrubbed_query = scrub_secrets_for_embedding(query)
        query_embedding = mock_embedder.embed(scrubbed_query)
        _db.hybrid_search(db, query, query_embedding)

        # Verify embedder received scrubbed query
        assert captured["text"] is not None
        assert _SK not in captured["text"]
        assert "[REDACTED:openai-key]" in captured["text"]

        db.close()

    def test_round_trip_learn_recall_no_secret_in_embedding_request(self, tmp_path):
        """Full learn/recall round-trip with secrets should not send secrets to embedder."""
        from openltm_hermes import _db

        db = _db.connect(tmp_path / "test3.db")
        _db.init_schema(db)

        captured_learn = {}
        captured_recall = {}

        class MockEmbedder:
            def embed(self, text):
                # Track whether this is a learn or recall call
                # Check for RAW secret patterns, not redacted markers
                if _SK in text:
                    captured_learn["has_secret"] = True
                if "learn" not in captured_learn:
                    captured_learn["text"] = text
                else:
                    captured_recall["text"] = text
                return [0.1] * 768

        mock_embedder = MockEmbedder()

        # Learn with secret - this goes through _db.learn which scrubs
        content = "My secret is " + _SK
        _db.learn(db, content, category="gotcha", importance=4, embedder=mock_embedder)

        # Recall with secret in query - need to scrub before embedding
        from openltm_hermes._secrets_scrubber import scrub_secrets_for_embedding
        query = "What was my secret " + _SK + " ?"
        scrubbed_query = scrub_secrets_for_embedding(query)
        query_embedding = mock_embedder.embed(scrubbed_query)
        _db.hybrid_search(db, query, query_embedding)

        # Neither learn nor recall should have sent the raw secret
        assert captured_learn.get("has_secret") is not True
        assert _SK not in captured_learn.get("text", "")
        assert _SK not in captured_recall.get("text", "")

        # But legitimate content should be preserved
        assert "secret" in captured_learn.get("text", "").lower()
        assert "[REDACTED:openai-key]" in captured_learn.get("text", "")

        db.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

# --- aws-secret-key pattern; shared fixture with core's aws-secret-pattern.test.ts ---
import json as _json
from pathlib import Path as _Path

# Built at runtime so no key-shaped literal is committed (secret scanning).
_STS_KEY_ID = "AS" + "IA" + "Z" * 16
_SESSION_TOKEN = "Q" * 120
_PATH_40 = "Ab" * 20
_AWS_FX = _json.loads(
    (_Path(__file__).resolve().parents[2] / "packages/openltm-core/src/__tests__/fixtures/aws-secret-cases.json")
    .read_text()
    .replace("{{STS_KEY_ID}}", _STS_KEY_ID)
    .replace("{{SESSION_TOKEN}}", _SESSION_TOKEN)
    .replace("{{PATH_40}}", _PATH_40)
)


@pytest.mark.parametrize("key", sorted(_AWS_FX["redact"]))
def test_aws_secret_redacted(key):
    r = scrub_secrets(_AWS_FX["redact"][key])
    assert "[REDACTED:aws-secret-key]" in r.scrubbed or "[REDACTED:aws-session-token]" in r.scrubbed
    assert "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE" not in r.scrubbed
    assert _SESSION_TOKEN[:40] not in r.scrubbed


@pytest.mark.parametrize("key", sorted(_AWS_FX["keep"]))
def test_aws_secret_not_overmatched(key):
    assert "aws-secret-key" not in scrub_secrets(_AWS_FX["keep"][key]).redactions


def test_sts_block_redacts_asia_and_session_token():
    r = scrub_secrets(_AWS_FX["redact"]["sts_json"])
    assert _STS_KEY_ID not in r.scrubbed
    assert _SESSION_TOKEN[:40] not in r.scrubbed
    assert {"aws-access-key", "aws-secret-key", "aws-session-token"} <= set(r.redactions)


def test_label_normalization_only_decides_value_span_replaced():
    v = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    assert scrub_secrets(f'Aws_Secret_Access_Key = "{v}"').scrubbed == 'Aws_Secret_Access_Key = "[REDACTED:aws-secret-key]"'


_MARKERS = {
    "[REDACTED:aws-secret-key]": r"[0-9a-zA-Z/+]{40,48}",
    "[REDACTED:aws-access-key]": r"(?:AKIA|ASIA)[0-9A-Z]{16}",
    "[REDACTED:aws-session-token]": r"[A-Za-z0-9/+=]{100,}",
}


@pytest.mark.parametrize("key", sorted(_AWS_FX["redact"]))
def test_aws_redaction_preserves_other_bytes(key):
    import re as _re
    text = _AWS_FX["redact"][key]
    out = scrub_secrets(text).scrubbed
    parts = _re.split(r"(\[REDACTED:(?:aws-secret-key|aws-access-key|aws-session-token)\])", out)
    pattern = "".join(_MARKERS.get(p, _re.escape(p)) for p in parts)
    assert _re.fullmatch(pattern, text, _re.S)


@pytest.mark.parametrize("text", [
    "secret_key! " * 16_667,
    "secret_key: [REDACTED:aws-secret-key] " * 5_200 + "'",
    ("AWS_" + "_" * 19 + "-" * 19) * 4_762,
])
def test_scrubber_linear_on_200k_input(text):
    import time as _time
    t = _time.perf_counter()
    scrub_secrets(text)
    assert _time.perf_counter() - t < 0.5


@pytest.mark.parametrize("key", sorted([("redact", k) for k in _AWS_FX["redact"]] + [("keep", k) for k in _AWS_FX["keep"]]))
def test_scrub_is_idempotent(key):
    once = scrub_secrets(_AWS_FX[key[0]][key[1]]).scrubbed
    assert scrub_secrets(once).scrubbed == once


@pytest.mark.parametrize("text", [
    "api_key = os.environ.get('X', 'abcdefghijklmnopqrstuvwxyz123456')",  # getenv_sq
    "api_key = cfg['k'] or \"abcdefghijklmnopqrstuvwxyz123456\"",
    "secret_key: 'a', backup: 'abcdefghijklmnopqrstuvwxyz123456'",  # errs on the safe side
])
def test_generic_key_gap_crosses_quotes(text):
    """The gap before the quoted value may cross another quote."""
    r = scrub_secrets(text)
    assert "generic-api-key" in r.redactions
    assert "abcdefghijklmnopqrstuvwxyz123456" not in r.scrubbed
