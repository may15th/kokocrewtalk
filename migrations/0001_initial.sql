PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY, nickname TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
);
CREATE TABLE rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
  emoji TEXT NOT NULL, created_at TEXT NOT NULL,
  last_message TEXT NOT NULL DEFAULT '', last_at TEXT
);
CREATE TABLE messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL REFERENCES rooms(id),
  sender_id TEXT NOT NULL REFERENCES users(id), nickname TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('text','sticker')),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL, client_message_id TEXT NOT NULL,
  UNIQUE(room_id, sender_id, client_message_id)
);
CREATE INDEX idx_messages_room_seq ON messages(room_id,seq);
CREATE TABLE capacity (
  id INTEGER PRIMARY KEY CHECK(id=1), message_count INTEGER NOT NULL DEFAULT 0,
  content_bytes INTEGER NOT NULL DEFAULT 0,
  max_messages INTEGER NOT NULL DEFAULT 100000,
  max_content_bytes INTEGER NOT NULL DEFAULT 50000000,
  max_rooms INTEGER NOT NULL DEFAULT 100,
  max_users INTEGER NOT NULL DEFAULT 10000,
  writes_enabled INTEGER NOT NULL DEFAULT 1
);
INSERT INTO capacity(id) VALUES(1);
CREATE TRIGGER message_capacity BEFORE INSERT ON messages
WHEN NOT EXISTS (SELECT 1 FROM messages WHERE room_id=NEW.room_id AND sender_id=NEW.sender_id AND client_message_id=NEW.client_message_id)
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM capacity WHERE id=1 AND
    (writes_enabled=0 OR message_count>=max_messages OR content_bytes+length(CAST(NEW.content AS BLOB))>max_content_bytes))
    THEN RAISE(ABORT,'FREE_STORAGE_LIMIT') END;
END;
CREATE TRIGGER message_usage AFTER INSERT ON messages BEGIN
  UPDATE capacity SET message_count=message_count+1,
    content_bytes=content_bytes+length(CAST(NEW.content AS BLOB)) WHERE id=1;
  UPDATE rooms SET last_message=CASE WHEN NEW.kind='sticker' THEN '🧸 코코크루 이모티콘' ELSE substr(NEW.content,1,50) END,
    last_at=NEW.created_at WHERE id=NEW.room_id;
END;
CREATE TRIGGER room_capacity BEFORE INSERT ON rooms BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM rooms)>=(SELECT max_rooms FROM capacity WHERE id=1)
    THEN RAISE(ABORT,'FREE_STORAGE_LIMIT') END;
END;
CREATE TRIGGER user_capacity BEFORE INSERT ON users BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM users)>=(SELECT max_users FROM capacity WHERE id=1)
    THEN RAISE(ABORT,'FREE_STORAGE_LIMIT') END;
END;
INSERT INTO rooms(id,name,description,emoji,created_at) VALUES
 ('lobby','코코크루 광장','누구나 인사하고 이야기해요','✨',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('lounge','자유 수다방','일상 이야기, 잡담 환영!','💬',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('rail','오늘의 철도','출퇴근길과 여행 이야기','🚆',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
