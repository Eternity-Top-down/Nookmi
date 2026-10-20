"""SQLite workspace storage with optimistic concurrency and normalized relations."""
from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3

from .schemas import AppData

EMPTY_DATA = {"schemaVersion": 1, "students": [], "classes": [], "records": []}


class RevisionConflict(Exception):
    pass


class Database:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "nookmi.sqlite3"
        with self.connect() as connection:
            connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS workspace_meta (
                    id INTEGER PRIMARY KEY CHECK(id=1),
                    revision INTEGER NOT NULL DEFAULT 0,
                    feedback_present INTEGER NOT NULL DEFAULT 0
                );
                INSERT OR IGNORE INTO workspace_meta(id) VALUES (1);
                CREATE TABLE IF NOT EXISTS workspace_preferences (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS classes (
                    id TEXT PRIMARY KEY, module TEXT NOT NULL,
                    position INTEGER NOT NULL, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS students (
                    id TEXT PRIMARY KEY, module TEXT NOT NULL,
                    class_id TEXT REFERENCES classes(id),
                    position INTEGER NOT NULL, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS records (
                    id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
                    position INTEGER NOT NULL, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS feedback_sessions (
                    id TEXT PRIMARY KEY, module TEXT NOT NULL,
                    class_id TEXT REFERENCES classes(id),
                    student_id TEXT REFERENCES students(id),
                    lesson_at TEXT NOT NULL, position INTEGER NOT NULL,
                    payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS feedback_entries (
                    session_id TEXT NOT NULL REFERENCES feedback_sessions(id),
                    student_id TEXT NOT NULL REFERENCES students(id),
                    content TEXT NOT NULL, observations TEXT,
                    position INTEGER NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(session_id, student_id)
                );
                CREATE INDEX IF NOT EXISTS students_class ON students(class_id);
                CREATE INDEX IF NOT EXISTS feedback_student ON feedback_entries(student_id);
            """)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
        finally:
            connection.close()

    @staticmethod
    def encode(value: object) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def _read(self, connection: sqlite3.Connection) -> dict:
        meta = connection.execute("SELECT revision, feedback_present FROM workspace_meta WHERE id=1").fetchone()
        data = {
            "schemaVersion": 1,
            "classes": [json.loads(row["payload"]) for row in connection.execute("SELECT payload FROM classes ORDER BY position")],
            "students": [json.loads(row["payload"]) for row in connection.execute("SELECT payload FROM students ORDER BY position")],
            "records": [json.loads(row["payload"]) for row in connection.execute("SELECT payload FROM records ORDER BY position")],
        }
        if meta["feedback_present"]:
            sessions = []
            entries: dict[str, list[dict]] = {}
            for row in connection.execute("SELECT session_id,payload FROM feedback_entries ORDER BY position"):
                entries.setdefault(row["session_id"], []).append(json.loads(row["payload"]))
            for row in connection.execute("SELECT id,payload FROM feedback_sessions ORDER BY position"):
                session = json.loads(row["payload"])
                session["entries"] = entries.get(row["id"], [])
                sessions.append(session)
            data["feedbackSessions"] = sessions
        preference = connection.execute(
            "SELECT value FROM workspace_preferences WHERE key=?", ("feedbackStyles",),
        ).fetchone()
        if preference is not None:
            data["feedbackStyles"] = json.loads(preference["value"])
        return {"data": data, "revision": meta["revision"]}

    def read(self) -> dict:
        with self.connect() as connection:
            connection.execute("BEGIN")
            result = self._read(connection)
            connection.commit()
            return result

    def replace(self, data: AppData, revision: int) -> dict:
        payload = data.payload()
        with self.connect() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = connection.execute("SELECT revision FROM workspace_meta WHERE id=1").fetchone()[0]
                if current != revision:
                    raise RevisionConflict()
                for table in ("feedback_entries", "feedback_sessions", "records", "students", "classes"):
                    connection.execute(f"DELETE FROM {table}")
                connection.execute("DELETE FROM workspace_preferences WHERE key=?", ("feedbackStyles",))
                if "feedbackStyles" in payload:
                    connection.execute(
                        "INSERT INTO workspace_preferences(key,value) VALUES (?,?)",
                        ("feedbackStyles", self.encode(payload["feedbackStyles"])),
                    )
                for index, row in enumerate(payload["classes"]):
                    connection.execute("INSERT INTO classes VALUES (?,?,?,?)", (row["id"], row["module"], index, self.encode(row)))
                for index, row in enumerate(payload["students"]):
                    connection.execute("INSERT INTO students VALUES (?,?,?,?,?)", (row["id"], row["module"], row["classId"], index, self.encode(row)))
                for index, row in enumerate(payload["records"]):
                    connection.execute("INSERT INTO records VALUES (?,?,?,?)", (row["id"], row["studentId"], index, self.encode(row)))
                for index, row in enumerate(payload.get("feedbackSessions", [])):
                    session = {key: value for key, value in row.items() if key != "entries"}
                    connection.execute("INSERT INTO feedback_sessions VALUES (?,?,?,?,?,?,?)", (
                        row["id"], row["module"], row["classId"], row["studentId"], row["lessonAt"], index, self.encode(session),
                    ))
                    for entry_index, entry in enumerate(row["entries"]):
                        connection.execute("INSERT INTO feedback_entries VALUES (?,?,?,?,?,?)", (
                            row["id"], entry["studentId"], entry["content"],
                            self.encode(entry["observations"]) if "observations" in entry else None,
                            entry_index, self.encode(entry),
                        ))
                connection.execute(
                    "UPDATE workspace_meta SET revision=?,feedback_present=? WHERE id=1",
                    (current + 1, int("feedbackSessions" in payload)),
                )
                result = self._read(connection)
                connection.commit()
                return result
            except Exception:
                connection.rollback()
                raise
