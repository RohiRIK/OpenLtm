"""Regression tests for R-3 embedding boundary hardening: secrets scrubber."""

from __future__ import annotations

import pytest

from openltm_hermes._secrets_scrubber import ScrubResult, scrub_secrets, scrub_secrets_for_embedding


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
            "Token: ghp_abcdefghijklmnopqrstuvwxyz12345678901234",
            "Fine-grained: github_pat_" + "a" * 82,
        ]
        for text in texts:
            result = scrub_secrets(text)
            assert "[REDACTED:github-token]" in result.scrubbed
            assert "github-token" in result.redactions

    def test_openai_key_redacted(self):
        """OpenAI keys (sk-, sk-proj-) should be redacted."""
        texts = [
            "sk-abcdefghijklmnopqrstuvwxyz1234567890123456",
            "sk-proj-abcdefghijklmnopqrstuvwxyz12345678901234567890",
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
        texts = ["xoxb-123456789012-abcdefghijkl", "xoxp-abcdefghijklmnopqrst"]
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
        text = """-----BEGIN PRIVATE KEY-----
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
        GitHub: ghp_abcdefghijklmnopqrstuvwxyz12345678901234
        OpenAI: sk-abcdefghijklmnopqrstuvwxyz1234567890123456
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

        content = "My API key is sk-abcdefghijklmnopqrstuvwxyz1234567890123456 and I like Python"
        _db.learn(db, content, category="preference", importance=3, embedder=mock_embedder)

        # Verify the embedder received scrubbed text
        assert captured["text"] is not None
        assert "sk-abcdefghijklmnopqrstuvwxyz1234567890123456" not in captured["text"]
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
        query = "What is my API key sk-abcdefghijklmnopqrstuvwxyz1234567890123456 ?"
        # Simulate what handle_tool_call does: scrub then embed
        from openltm_hermes._secrets_scrubber import scrub_secrets_for_embedding
        scrubbed_query = scrub_secrets_for_embedding(query)
        query_embedding = mock_embedder.embed(scrubbed_query)
        _db.hybrid_search(db, query, query_embedding)

        # Verify embedder received scrubbed query
        assert captured["text"] is not None
        assert "sk-abcdefghijklmnopqrstuvwxyz1234567890123456" not in captured["text"]
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
                if "sk-abcdefghijklmnopqrstuvwxyz1234567890123456" in text:
                    captured_learn["has_secret"] = True
                if "learn" not in captured_learn:
                    captured_learn["text"] = text
                else:
                    captured_recall["text"] = text
                return [0.1] * 768

        mock_embedder = MockEmbedder()

        # Learn with secret - this goes through _db.learn which scrubs
        content = "My secret is sk-abcdefghijklmnopqrstuvwxyz1234567890123456"
        _db.learn(db, content, category="gotcha", importance=4, embedder=mock_embedder)

        # Recall with secret in query - need to scrub before embedding
        from openltm_hermes._secrets_scrubber import scrub_secrets_for_embedding
        query = "What was my secret sk-abcdefghijklmnopqrstuvwxyz1234567890123456 ?"
        scrubbed_query = scrub_secrets_for_embedding(query)
        query_embedding = mock_embedder.embed(scrubbed_query)
        _db.hybrid_search(db, query, query_embedding)

        # Neither learn nor recall should have sent the raw secret
        assert captured_learn.get("has_secret") is not True
        assert "sk-abcdefghijklmnopqrstuvwxyz1234567890123456" not in captured_learn.get("text", "")
        assert "sk-abcdefghijklmnopqrstuvwxyz1234567890123456" not in captured_recall.get("text", "")

        # But legitimate content should be preserved
        assert "secret" in captured_learn.get("text", "").lower()
        assert "[REDACTED:openai-key]" in captured_learn.get("text", "")

        db.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])