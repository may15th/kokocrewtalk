"""Use only disposable in-memory databases; never touch chat.db."""
import sqlite3
import unittest
from pathlib import Path

SCHEMA = (Path(__file__).resolve().parents[1] / 'migrations/0001_initial.sql').read_text(encoding='utf-8')

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)
        self.db.execute("INSERT INTO users VALUES('u','tester','2026-11-01')")

    def tearDown(self):
        self.db.close()

    def send(self, ident, room='lobby', content='hello'):
        self.db.execute('''INSERT INTO messages(id,room_id,sender_id,nickname,kind,content,created_at,client_message_id)
          VALUES(?,?, 'u','tester','text',?,'2026-11-01',?)
          ON CONFLICT(room_id,sender_id,client_message_id) DO NOTHING''', (ident, room, content, ident))

    def test_retries_at_capacity_do_not_duplicate(self):
        self.db.execute('UPDATE capacity SET max_messages=1')
        self.send('one')
        self.send('one')
        self.assertEqual(self.db.execute('SELECT count(*) FROM messages').fetchone()[0], 1)
        with self.assertRaisesRegex(sqlite3.IntegrityError, 'FREE_STORAGE_LIMIT'):
            self.send('two', 'rail')
        self.assertEqual(self.db.execute('SELECT message_count FROM capacity').fetchone()[0], 1)

    def test_utf8_byte_cap_preserves_existing_messages(self):
        self.db.execute('UPDATE capacity SET max_content_bytes=6')
        self.send('one', content='가나')
        with self.assertRaisesRegex(sqlite3.IntegrityError, 'FREE_STORAGE_LIMIT'):
            self.send('two', content='a')
        self.assertEqual(self.db.execute('SELECT content FROM messages').fetchone()[0], '가나')

    def test_room_separation_and_foreign_keys(self):
        self.send('one', 'lobby')
        self.send('two', 'rail')
        self.assertEqual(self.db.execute("SELECT id FROM messages WHERE room_id='rail'").fetchall(), [('two',)])
        with self.assertRaises(sqlite3.IntegrityError):
            self.send('three', 'missing')

    def test_kill_switch_and_metadata(self):
        self.send('one')
        self.assertEqual(self.db.execute("SELECT last_message FROM rooms WHERE id='lobby'").fetchone()[0], 'hello')
        self.db.execute('UPDATE capacity SET writes_enabled=0')
        with self.assertRaisesRegex(sqlite3.IntegrityError, 'FREE_STORAGE_LIMIT'):
            self.send('two')
        self.send('one')

if __name__ == '__main__':
    unittest.main()
