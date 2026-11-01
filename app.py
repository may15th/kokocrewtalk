"""KokoCrew Talk: small multi-user realtime chat prototype (FastAPI + SQLite)."""
from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get('KOKO_DB_PATH', str(ROOT / 'chat.db')))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
STICKERS = {
    'hello': '01_안녕.png',
    'like': '02_좋아.png',
    'thanks': '03_고마워.png',
    'sorry': '04_미안해.png',
    'wow': '05_대박.png',
    'lol': '06_ㅋㅋ.png',
    'angry': '07_화남.png',
    'sulk': '08_삐짐.png',
    'go': '09_출발.png',
    'okay': '10_오케이.png',
}
INITIAL_ROOMS = [
    ('lobby', '코코크루 광장', '누구나 인사하고 이야기해요', '✨'),
    ('lounge', '자유 수다방', '일상 이야기, 잡담 환영!', '💬'),
    ('rail', '오늘의 철도', '출퇴근길과 여행 이야기', '🚆'),
]

def db_open():
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    return conn


def initialize_db():
    with db_open() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('''CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
            emoji TEXT NOT NULL, created_at TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, room_id TEXT NOT NULL,
            sender_id TEXT NOT NULL, nickname TEXT NOT NULL,
            kind TEXT NOT NULL, content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(room_id) REFERENCES rooms(id))''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id,created_at)')
        for room_id, name, description, emoji in INITIAL_ROOMS:
            db.execute('INSERT OR IGNORE INTO rooms VALUES (?,?,?,?,?)', (
                room_id, name, description, emoji, datetime.now(timezone.utc).isoformat()))
        db.commit()

@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_db()
    yield

app = FastAPI(title='KokoCrew Talk', lifespan=lifespan)
app.mount('/static', StaticFiles(directory=str(ROOT / 'static')), name='static')

class NewRoom(BaseModel):
    name: str
    description: str = ''

class Hub:
    def __init__(self):
        self.rooms: dict[str, dict[WebSocket, dict[str, str]]] = {}

    def count(self, room_id: str) -> int:
        return len(self.rooms.get(room_id, {}))

    def join(self, room: str, ws: WebSocket, profile: dict[str, str]):
        self.rooms.setdefault(room, {})[ws] = profile

    def leave(self, room: str, ws: WebSocket):
        self.rooms.get(room, {}).pop(ws, None)

    async def broadcast(self, room: str, msg: dict[str, Any]):
        if not self.rooms.get(room):
            return
        targets = list(self.rooms[room].keys())
        results = await asyncio.gather(*(s.send_json(msg) for s in targets), return_exceptions=True)
        for sock, result in zip(targets, results):
            if isinstance(result, Exception):
                self.leave(room, sock)

hub = Hub()

def room_exists(room_id: str) -> bool:
    with db_open() as db:
        return db.execute('SELECT 1 FROM rooms WHERE id=?', (room_id,)).fetchone() is not None

def get_rooms():
    with db_open() as db:
        rooms = db.execute('SELECT * FROM rooms ORDER BY CASE WHEN id="lobby" THEN 0 WHEN id="lounge" THEN 1 WHEN id="rail" THEN 2 ELSE 3 END, created_at DESC').fetchall()
        result = []
        for r in rooms:
            item = dict(r)
            last = db.execute('SELECT kind, content, created_at FROM messages WHERE room_id=? ORDER BY created_at DESC LIMIT 1', (r['id'],)).fetchone()
            item['last_message'] = ('🧸 코코크루 이모티콘' if last['kind'] == 'sticker' else last['content'][:50]) if last else ''
            item['last_at'] = last['created_at'] if last else None
            item['online'] = hub.count(r['id'])
            result.append(item)
        return result

@app.get('/')
async def index():
    return FileResponse(ROOT / 'static' / 'index.html')

@app.get('/api/rooms')
async def list_rooms():
    return {'rooms': get_rooms()}

@app.post('/api/rooms', status_code=201)
async def create_room(value: NewRoom):
    name = value.name.strip()
    desc = value.description.strip()
    if not (2 <= len(name) <= 24):
        raise HTTPException(422, '방 이름은 2~24글자로 입력하세요.')
    if len(desc) > 80:
        raise HTTPException(422, '설명은 80글자 이하로 입력하세요.')
    rid = uuid.uuid4().hex[:12]
    date = datetime.now(timezone.utc).isoformat()
    with db_open() as db:
        db.execute('INSERT INTO rooms VALUES (?,?,?,?,?)', (rid, name, desc or '새로 만들어진 대화방', '☁️', date))
        db.commit()
    return {'room': {'id': rid, 'name': name, 'description': desc, 'emoji': '☁️', 'created_at': date, 'online': 0}}

@app.get('/api/rooms/{room_id}/messages')
async def list_messages(room_id: str, limit: int = 80):
    if not room_exists(room_id):
        raise HTTPException(404, '대화방이 없습니다.')
    limit = min(max(limit, 1), 120)
    with db_open() as db:
        rows = db.execute('SELECT * FROM (SELECT * FROM messages WHERE room_id=? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at', (room_id, limit)).fetchall()
    return {'messages': [dict(row) for row in rows]}

@app.get('/api/stickers')
async def list_stickers():
    return {'stickers': [{'id': key, 'url': '/static/stickers/' + name} for key, name in STICKERS.items()]}

@app.websocket('/ws/{room_id}')
async def chat_socket(ws: WebSocket, room_id: str):
    if not room_exists(room_id):
        await ws.close(code=1008)
        return
    nickname = re.sub(r'[\r\n<>]', '', (ws.query_params.get('name') or '').strip())[:20]
    sender_id = re.sub(r'[^a-zA-Z0-9-]', '', ws.query_params.get('id') or '')[:70]
    if not (1 <= len(nickname) <= 20) or len(sender_id) < 8:
        await ws.close(code=1008)
        return
    profile = {'nickname': nickname, 'sender_id': sender_id}
    await ws.accept()
    hub.join(room_id, ws, profile)
    await hub.broadcast(room_id, {'event': 'presence', 'count': hub.count(room_id)})
    last_sent = 0.0
    try:
        while True:
            packet = await ws.receive_json()
            event = packet.get('event')
            if event == 'typing':
                await hub.broadcast(room_id, {'event': 'typing', 'nickname': nickname, 'sender_id': sender_id, 'active': bool(packet.get('active'))})
                continue
            if event != 'message':
                continue
            now = time.monotonic()
            if now - last_sent < 0.35:
                await ws.send_json({'event': 'error', 'message': '메시지를 조금 천천히 보내주세요.'})
                continue
            last_sent = now
            kind = packet.get('kind')
            content = packet.get('content')
            if not isinstance(content, str) or kind not in ('text', 'sticker'):
                continue
            if kind == 'text':
                content = content.strip()
                if not (1 <= len(content) <= 2000):
                    await ws.send_json({'event': 'error', 'message': '메시지는 1~2000글자까지 보낼 수 있어요.'})
                    continue
            elif content not in STICKERS:
                continue
            msg = {
                'id': uuid.uuid4().hex,
                'room_id': room_id,
                'sender_id': sender_id,
                'nickname': nickname,
                'kind': kind,
                'content': content,
                'created_at': datetime.now(timezone.utc).isoformat(),
            }
            with db_open() as db:
                db.execute('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', tuple(msg[k] for k in ('id','room_id','sender_id','nickname','kind','content','created_at')))
                db.commit()
            await hub.broadcast(room_id, {'event': 'message', 'message': msg})
    except (WebSocketDisconnect, RuntimeError, ValueError, json.JSONDecodeError):
        pass
    finally:
        hub.leave(room_id, ws)
        await hub.broadcast(room_id, {'event': 'presence', 'count': hub.count(room_id)})

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', '8000')))
