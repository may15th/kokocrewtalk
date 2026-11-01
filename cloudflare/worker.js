import { DurableObject } from 'cloudflare:workers';

const STICKERS = ['hello','like','thanks','sorry','wow','lol','angry','sulk','go','okay'];
const LIMITED = '무료 이용 한도 또는 저장소 제한으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.';
const json = (value, status=200, headers={}) => Response.json(value, {status, headers:{'Cache-Control':'no-store',...headers}});
const fail = (detail,status=400) => { throw Object.assign(new Error(detail), {status}); };
const now = () => Math.floor(Date.now()/1000);
const cleanName = value => typeof value === 'string' ? value.trim().replace(/[<>\r\n]/g,'') : '';
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function sameOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) fail('접속 출처를 확인할 수 없습니다.',403);
}
async function profile(request, env) {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)koko_session=([a-f0-9-]{36})/)?.[1];
  if (!token) return null;
  return env.DB.prepare('SELECT u.id,u.nickname,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token),now()).first();
}
async function body(request) {
  if (Number(request.headers.get('Content-Length'))>12000) fail('요청이 너무 큽니다.',413);
  const text=await request.text();
  if (text.length>12000) fail('요청이 너무 큽니다.',413);
  try { const value=JSON.parse(text); if (!value || Array.isArray(value) || typeof value!=='object') fail('잘못된 요청'); return value; }
  catch { fail('잘못된 JSON 요청입니다.'); }
}

export default {
  async fetch(request,env) {
    try {
      if (env.FREE_ONLY !== 'true') fail('무료 전용 설정이 필요합니다.',503);
      const url=new URL(request.url), path=url.pathname;
      if (!path.startsWith('/api/') && !path.startsWith('/ws/')) return env.ASSETS.fetch(request);
      if (path==='/api/config') return json({cloudflare:true,free_only:true});
      if (!['GET','HEAD'].includes(request.method)) sameOrigin(request);
      const user=await profile(request,env);
      if (path==='/api/session' && request.method==='GET') return json({user});
      if (path==='/api/session' && request.method==='POST') {
        const nickname=cleanName((await body(request)).nickname);
        if (nickname.length<1 || nickname.length>20) fail('닉네임은 1~20자로 입력하세요.',422);
        if (user) {
          await env.DB.prepare('UPDATE users SET nickname=? WHERE id=?').bind(nickname,user.id).run();
          return json({user:{...user,nickname}});
        }
        const id=crypto.randomUUID(), token=crypto.randomUUID(), expires=now()+30*86400;
        await env.DB.batch([
          env.DB.prepare('INSERT INTO users VALUES(?,?,?)').bind(id,nickname,new Date().toISOString()),
          env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(token),id,expires)
        ]);
        const secure=url.protocol==='https:'?'; Secure':'';
        return json({user:{id,nickname,expires_at:expires}},201,{'Set-Cookie':`koko_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`});
      }
      if (!user) fail('세션이 만료되었습니다. 닉네임을 다시 설정해 주세요.',401);
      if (path==='/api/rooms' && request.method==='GET') {
        const {results}=await env.DB.prepare("SELECT *,0 AS online FROM rooms ORDER BY CASE id WHEN 'lobby' THEN 0 WHEN 'lounge' THEN 1 WHEN 'rail' THEN 2 ELSE 3 END,created_at DESC LIMIT 100").all();
        return json({rooms:results});
      }
      if (path==='/api/rooms' && request.method==='POST') {
        const input=await body(request), name=cleanName(input.name), description=cleanName(input.description);
        if (name.length<2 || name.length>24 || description.length>80) fail('방 이름은 2~24자, 설명은 80자 이하로 입력하세요.',422);
        const room={id:crypto.randomUUID(),name,description,emoji:'☁️',created_at:new Date().toISOString(),online:0};
        await env.DB.prepare('INSERT INTO rooms(id,name,description,emoji,created_at) VALUES(?,?,?,?,?)').bind(room.id,name,description,room.emoji,room.created_at).run();
        return json({room},201);
      }
      const match=path.match(/^\/ws\/([a-zA-Z0-9-]{1,70})$/);
      if (match) {
        sameOrigin(request);
        if (request.headers.get('Upgrade')?.toLowerCase()!=='websocket') fail('WebSocket 연결이 필요합니다.',426);
        if (!await env.DB.prepare('SELECT id FROM rooms WHERE id=?').bind(match[1]).first()) fail('대화방이 없습니다.',404);
        const headers=new Headers(request.headers);
        headers.set('X-Koko-User',JSON.stringify(user));
        headers.set('X-Koko-Room',match[1]);
        return await env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(new Request(request,{headers}));
      }
      fail('요청한 경로가 없습니다.',404);
    } catch(error) {
      return json({detail:error.status?error.message:LIMITED},error.status||503);
    }
  }
};

export class ChatRoom extends DurableObject {
  constructor(ctx,env) { super(ctx,env); this.ctx=ctx;this.env=env;this.tail=Promise.resolve(); }
  serial(work) { const task=this.tail.then(work);this.tail=task.catch(()=>{});return task; }
  send(ws,packet) { try { ws.send(JSON.stringify(packet)); } catch {} }
  broadcast(packet) { for(const ws of this.ctx.getWebSockets()) this.send(ws,packet); }
  presence() {
    const users=new Set(this.ctx.getWebSockets().map(ws=>ws.deserializeAttachment().user.id));
    this.broadcast({event:'presence',count:users.size});
  }
  async fetch(request) {
    const user=JSON.parse(request.headers.get('X-Koko-User'));
    if (this.ctx.getWebSockets().length>=100) return json({detail:'이 방의 접속 한도에 도달했습니다.'},503);
    const pair=new WebSocketPair(), client=pair[0], server=pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({user,room:request.headers.get('X-Koko-Room'),lastMessage:0,lastTyping:0});
    this.presence();
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws,raw) {
    return this.serial(async()=>{
      let packet;
      try {
        if (typeof raw!=='string' || raw.length>12000) {ws.close(1009,'메시지가 너무 큽니다.');return;}
        packet=JSON.parse(raw);
        if (!packet || typeof packet!=='object') return;
        const a=ws.deserializeAttachment();
        if (a.user.expires_at<=now()) {ws.close(4001,'세션 만료');return;}
        if (packet.event==='sync') {
          const after=Number(packet.after);
          if (!Number.isSafeInteger(after) || after<0) return;
          const initial=packet.initial===true;
          const result=initial
            ? await this.env.DB.prepare('SELECT * FROM (SELECT * FROM messages WHERE room_id=? ORDER BY seq DESC LIMIT 80) ORDER BY seq').bind(a.room).all()
            : await this.env.DB.prepare('SELECT * FROM messages WHERE room_id=? AND seq>? ORDER BY seq LIMIT 100').bind(a.room,after).all();
          const messages=result.results;
          this.send(ws,{event:'sync',messages,more:!initial && messages.length===100,cursor:messages.at(-1)?.seq||after});
          return;
        }
        if (packet.event==='typing') {
          if (Date.now()-a.lastTyping<1200) return;
          a.lastTyping=Date.now();ws.serializeAttachment(a);
          this.broadcast({event:'typing',sender_id:a.user.id,nickname:a.user.nickname,active:!!packet.active});return;
        }
        if (packet.event!=='message') return;
        if (Date.now()-a.lastMessage<400) {this.send(ws,{event:'error',client_message_id:packet.client_message_id,message:'메시지를 조금 천천히 보내주세요.'});return;}
        a.lastMessage=Date.now();ws.serializeAttachment(a);
        if (!/^[a-f0-9-]{36}$/.test(packet.client_message_id||'')) fail('메시지 식별자가 올바르지 않습니다.');
        const content=typeof packet.content==='string'?packet.content.trim():'';
        if (!content || content.length>2000 || !['text','sticker'].includes(packet.kind) || (packet.kind==='sticker'&&!STICKERS.includes(content))) fail('메시지 형식이 올바르지 않습니다.');
        // D1 UNIQUE constraint and trigger make retries and capacity checks atomic across rooms.
        await this.env.DB.prepare('INSERT INTO messages(id,room_id,sender_id,nickname,kind,content,created_at,client_message_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(room_id,sender_id,client_message_id) DO NOTHING')
          .bind(crypto.randomUUID(),a.room,a.user.id,a.user.nickname,packet.kind,content,new Date().toISOString(),packet.client_message_id).run();
        const message=await this.env.DB.prepare('SELECT * FROM messages WHERE room_id=? AND sender_id=? AND client_message_id=?').bind(a.room,a.user.id,packet.client_message_id).first();
        if (!message) throw new Error('Storage failed');
        if (message.kind!==packet.kind || message.content!==content) fail('동일한 식별자로 다른 내용을 전송할 수 없습니다.');
        this.broadcast({event:'message',message});
        this.send(ws,{event:'ack',client_message_id:packet.client_message_id,message});
      } catch(error) {
        this.send(ws,{event:'error',client_message_id:packet?.client_message_id,message:error.status?error.message:LIMITED});
      }
    });
  }
  webSocketClose(ws,code) { try {ws.close(code===1006?1000:code);} catch {} this.presence(); }
  webSocketError(ws) { try {ws.close(1011,'연결 오류');} catch {} this.presence(); }
}
