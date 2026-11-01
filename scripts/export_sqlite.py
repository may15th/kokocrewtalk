"""Create a WAL-consistent legacy backup and import SQL, never modifying the source DB."""
import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def export(source, output):
    output.mkdir(parents=True, exist_ok=False)
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as live:
        with sqlite3.connect(output / 'legacy-backup.db') as snapshot:
            live.backup(snapshot)
    with sqlite3.connect(output / 'legacy-backup.db') as db:
        db.row_factory = sqlite3.Row
        rooms = db.execute('SELECT * FROM rooms ORDER BY created_at,id').fetchall()
        messages = db.execute('SELECT * FROM messages ORDER BY created_at,id').fetchall()
    lines = ['-- Apply 0001_initial.sql first. Legacy identities cannot authenticate.']
    for r in rooms:
        values = ','.join(quote(r[k]) for k in ('id','name','description','emoji','created_at'))
        lines.append(f'INSERT INTO rooms(id,name,description,emoji,created_at) VALUES({values}) ON CONFLICT(id) DO NOTHING;')
    users = {}
    for m in messages:
        users.setdefault(m['sender_id'], m)
    for old, m in users.items():
        values = ','.join(quote(v) for v in ('legacy:'+old, m['nickname'], m['created_at']))
        lines.append(f'INSERT INTO users VALUES({values}) ON CONFLICT(id) DO NOTHING;')
    for m in messages:
        values = [m['id'], m['room_id'], 'legacy:'+m['sender_id'], m['nickname'], m['kind'], m['content'], m['created_at'], 'legacy:'+m['id']]
        lines.append('INSERT INTO messages(id,room_id,sender_id,nickname,kind,content,created_at,client_message_id) VALUES(' + ','.join(map(quote, values)) + ') ON CONFLICT(room_id,sender_id,client_message_id) DO NOTHING;')
    (output / 'legacy-import.sql').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    print(f'Exported {len(rooms)} rooms, {len(messages)} messages, {len(users)} legacy identities to {output}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('chat.db'))
    parser.add_argument('--output', type=Path, default=Path('migration-output') / datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S'))
    args = parser.parse_args()
    export(args.source, args.output)
