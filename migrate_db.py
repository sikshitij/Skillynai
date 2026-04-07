import sqlite3, os

db_path = os.path.join(os.path.dirname(__file__), "skillyn.db")
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("PRAGMA table_info(interview_sessions)")
existing = {row[1] for row in cur.fetchall()}

migrations = [
    ("skills",                "TEXT DEFAULT ''"),
    ("status",                "TEXT DEFAULT 'setup'"),
    ("hr_score",              "REAL DEFAULT 0"),
    ("communication_score",   "REAL DEFAULT 0"),
    ("round_type",            "TEXT DEFAULT 'full_mock'"),
]

for col, definition in migrations:
    if col not in existing:
        cur.execute(f"ALTER TABLE interview_sessions ADD COLUMN {col} {definition}")
        print(f"Added column: {col}")
    else:
        print(f"Already exists: {col}")

conn.commit()
conn.close()
print("Migration complete.")
