"""Hermes twin of core's temporal-supersede and recall-adaptive-intent tests."""

import sqlite3
import unittest

from openltm_hermes import _db
from openltm_hermes._recall_shape import adaptive_cutoff, detect_query_intent, recency_ranks


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _db.init_schema(conn)
    return conn


class ShapeTest(unittest.TestCase):
    def test_intent(self):
        self.assertEqual(detect_query_intent("what is the current embedding model"), "recency")
        self.assertEqual(detect_query_intent("list all current hosts"), "aggregate")
        self.assertEqual(detect_query_intent("how many hosts"), "aggregate")
        self.assertIsNone(detect_query_intent("snowflake knowledge base"))

    def test_recency_and_cutoff(self):
        r = recency_ranks([
            {"id": 1, "created_at": "2026-01-01 00:00:00"},
            {"id": 2, "created_at": "2026-06-01T00:00:00+00:00"},
            {"id": 3, "created_at": "2026-09-01 00:00:00", "occurred_at": "2025-01-01 00:00:00"},
        ])
        self.assertEqual((r[2], r[3], r[1]), (1.0, 0.0, 0.5))
        ranked = [{"id": i} for i in range(1, 7)]
        s = {1: 1, 2: 0.9, 3: 0.1, 4: 0.5, 5: 0.2, 6: 0.29}
        self.assertEqual([x["id"] for x in adaptive_cutoff(ranked, s)], [1, 2, 3, 4])


class TemporalTest(unittest.TestCase):
    def setUp(self):
        self.conn = _conn()

    def test_occurred_at_and_bad_date(self):
        r = _db.learn(self.conn, "The ferret cluster moved to Frankfurt.", occurred_at="2026-03-15")
        row = self.conn.execute("SELECT occurred_at FROM memories WHERE id=?", (r["id"],)).fetchone()
        self.assertEqual(row[0], "2026-03-15 00:00:00")
        with self.assertRaises(ValueError):
            _db.learn(self.conn, "Bad date memory.", occurred_at="last Tuesday")

    def test_supersede_kinds_and_owner_protection(self):
        old = _db.learn(self.conn, "The badger API listens on port 7000.")
        new = _db.learn(self.conn, "The badger API listens on port 7400.", supersedes={"id": old["id"]})
        self.assertEqual(new["supersede"], {"id": old["id"], "relation": "updates", "applied": True})
        row = self.conn.execute("SELECT status, superseded_by, supersede_kind FROM memories WHERE id=?", (old["id"],)).fetchone()
        self.assertEqual(tuple(row), ("superseded", new["id"], "updates"))

        ext_old = _db.learn(self.conn, "Badger backups run nightly.")
        ext = _db.learn(self.conn, "Badger backups also copy weekly.", supersedes={"id": ext_old["id"], "relation": "extends"})
        self.assertTrue(ext["supersede"]["applied"])
        self.assertEqual(self.conn.execute("SELECT status FROM memories WHERE id=?", (ext_old["id"],)).fetchone()[0], "active")

        owner = _db.learn(self.conn, "Never deploy badger on Fridays.", origin="owner-statement")
        agent = _db.learn(self.conn, "Friday deploys are fine.", supersedes={"id": owner["id"], "relation": "retracts"})
        self.assertEqual(agent["supersede"]["reason"], "owner_statement_protected")
        self.assertEqual(self.conn.execute("SELECT status FROM memories WHERE id=?", (owner["id"],)).fetchone()[0], "active")

    def test_as_of(self):
        v1 = _db.learn(self.conn, "The heron database runs Postgres 14.")
        self.conn.execute("UPDATE memories SET created_at='2026-01-10T09:00:00+00:00' WHERE id=?", (v1["id"],))
        v2 = _db.learn(self.conn, "The heron database runs Postgres 16 after the upgrade.", supersedes={"id": v1["id"]})
        self.conn.execute("UPDATE memories SET created_at='2026-06-01T09:00:00+00:00' WHERE id=?", (v2["id"],))
        self.conn.execute("UPDATE memories SET superseded_at='2026-06-01 09:00:00' WHERE id=?", (v1["id"],))
        before = _db.recall(self.conn, query="heron database Postgres", as_of="2026-03-01")
        self.assertEqual([m["id"] for m in before], [v1["id"]])
        after = _db.recall(self.conn, query="heron database Postgres", as_of="2026-07-01")
        self.assertEqual([m["id"] for m in after], [v2["id"]])
        counts = self.conn.execute("SELECT SUM(recall_count) FROM memories").fetchone()[0]
        self.assertEqual(counts, 0)

    def test_adaptive(self):
        _db.learn(self.conn, "The quokka deploy pipeline signs every quokka artifact with cosign before upload.")
        _db.learn(self.conn, "Quokka artifacts are uploaded to the quokka bucket in eu-west-1.")
        for i in range(8):
            _db.learn(self.conn, f"Unrelated note {i}: the pipeline for service number {i} runs lint before tests.")
        trimmed = _db.recall(self.conn, query="quokka artifact signing pipeline", limit=10)
        full = _db.recall(self.conn, query="quokka artifact signing pipeline", limit=10, adaptive=False)
        self.assertGreater(len(full), len(trimmed))
        self.assertGreaterEqual(len(trimmed), 3)


if __name__ == "__main__":
    unittest.main()
