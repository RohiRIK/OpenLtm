import sqlite3
DB = "/home/rohi/.hermes/openltm.db"
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()
cur.execute("PRAGMA journal_mode")
print("journal_mode:", cur.fetchone()[0])
print("=== sqlite_master tables ===")
tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type IN ('table','virtual table') ORDER BY name")]
for t in tables: print(" ", t)
print("=== _schema_version ===")
try:
    for r in cur.execute("SELECT * FROM _schema_version"): print(" ", r)
except Exception as e: print("  ERR", e)
print("=== schema_migrations (plugin ledger) ===")
try:
    for r in cur.execute("SELECT * FROM schema_migrations"): print(" ", r)
except Exception as e: print("  ERR", e)
