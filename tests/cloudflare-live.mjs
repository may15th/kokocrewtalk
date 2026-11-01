// Run only against a running local Wrangler instance, never production.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base='http://127.0.0.1:8787';
const sockets=[];
async function guest(nickname) {
  const r=await fetch(base+'/api/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({nickname})});
  assert.equal(r.status,201);
  return {cookie:r.headers.get('set-cookie').split(';')[0],...(await r.json())};
}
async function socket(path,cookie) {
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws/'+path,{headers:{Cookie:cookie,Origin:base}});
  sockets.push(ws);const inbox=[];ws.on('message',raw=>inbox.push(JSON.parse(raw)));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  return {ws,inbox,async next(event) {
    const deadline=Date.now()+8000;
    while(Date.now()<deadline){const i=inbox.findIndex(p=>p.event===event);if(i>=0)return inbox.splice(i,1)[0];await new Promise(r=>setTimeout(r,20))}
    throw new Error('Timeout: '+event);
  }};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
  assert.equal((await fetch(base+'/api/rooms')).status,401);
  const wrong=await fetch(base+'/api/session',{method:'POST',headers:{Origin:'https://invalid.example','Content-Type':'application/json'},body:'{"nickname":"x"}'});
  assert.equal(wrong.status,403);
  const a=await guest('tester-a'), b=await guest('tester-b');
  const roomResponse=await fetch(base+'/api/rooms',{method:'POST',headers:{Cookie:a.cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({name:'Integration test'})});
  assert.equal(roomResponse.status,201);const {room}=await roomResponse.json();
  const x=await socket(room.id,a.cookie), y=await socket(room.id,b.cookie), other=await socket('rail',b.cookie);
  x.ws.send(JSON.stringify({event:'sync',after:0}));assert.equal((await x.next('sync')).messages.length,0);
  const packet={event:'message',kind:'sticker',content:'hello',client_message_id:crypto.randomUUID()};
  x.ws.send(JSON.stringify(packet));const first=(await x.next('ack')).message;
  assert.equal((await y.next('message')).message.id,first.id);
  await wait(450);x.ws.send(JSON.stringify(packet));assert.equal((await x.next('ack')).message.id,first.id);
  x.ws.send(JSON.stringify({event:'sync',after:0}));assert.equal((await x.next('sync')).messages.length,1);
  assert.equal(other.inbox.filter(p=>p.event==='message').length,0);
  y.ws.close();await wait(450);
  x.ws.send(JSON.stringify({...packet,kind:'text',content:'offline catchup',client_message_id:crypto.randomUUID()}));
  const second=(await x.next('ack')).message;
  const reconnected=await socket(room.id,b.cookie);reconnected.ws.send(JSON.stringify({event:'sync',after:first.seq}));
  assert.deepEqual((await reconnected.next('sync')).messages.map(m=>m.id),[second.id]);
  const html=await (await fetch(base)).text();assert.ok(html.includes('/static/client.js'));assert.ok(html.includes('stickerDrawer'));
  assert.equal((await fetch(base+'/static/stickers/'+encodeURIComponent('01_안녕.png'))).status,200);
  assert.equal((await fetch(base+'/chat.db')).status,404);
  console.log('PASS: authentication, Origin, two-user broadcast, duplicate retry, room isolation, reconnect catchup, static UI/PNG, database exclusion');
} finally { for(const ws of sockets) ws.close(); }
