
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {rooms:[], active:null, nick:localStorage.getItem('koko-nick')||'',id:'',ws:null,connected:false,stickerOpen:false,lastDay:'',roomsTimer:null,typingTimer:null,toastTimer:null,pendingRoom:(new URL(location.href)).searchParams.get('room')||'lobby'};
  const stickerList = [
    ['hello','안녕','01_안녕.png'],['like','좋아','02_좋아.png'],['thanks','고마워','03_고마워.png'],['sorry','미안해','04_미안해.png'],['wow','대박','05_대박.png'],
    ['lol','ㅋㅋ','06_ㅋㅋ.png'],['angry','화남','07_화남.png'],['sulk','삐짐','08_삐짐.png'],['go','출발','09_출발.png'],['okay','오케이','10_오케이.png']
  ];
  const stMap = Object.fromEntries(stickerList.map(([id,label,file])=>[id, {label,url:'/static/stickers/'+file}]));
  const avatarIcons = ['🧸','🐰','🚆','🌸','🌿','⭐','☁️'];
  let reconnectTimer=null, attempts=0, syncing=true, cursor=0, buffered=[], historyLoaded=false;
  let pending=JSON.parse(sessionStorage.getItem('koko-pending')||'[]');
  const seen=new Set();
  function savePending(){sessionStorage.setItem('koko-pending',JSON.stringify(pending))}
  function accept(m){if(!seen.has(m.id)){seen.add(m.id);renderMessage(m)}cursor=Math.max(cursor,m.seq||0);
    pending=pending.filter(p=>!(p.client_message_id===m.client_message_id&&m.sender_id===state.id));savePending()}
  let flushTimer=null, inFlight=false;
  function flush(){if(inFlight||!state.connected||syncing)return;clearTimeout(flushTimer);
    const p=pending.find(p=>p.room_id===state.active);if(!p)return;
    inFlight=true;state.ws.send(JSON.stringify(p));flushTimer=setTimeout(()=>{inFlight=false;flush()},5000)}
  function showPending(){const count=pending.filter(p=>p.room_id===state.active).length;
    $('connText').textContent=count?'전송 확인 대기 '+count+'개 · 눌러 재시도':'실시간 연결'}
  $('connText').style.cursor='pointer';$('connText').onclick=()=>{showPending();flush()};

  function avatar(id){let value=0;for(const c of id){value=(value*33+c.charCodeAt(0))>>>0}return avatarIcons[value%avatarIcons.length]}
  function toast(t){$('notice').textContent=t;$('notice').classList.remove('hidden');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>$('notice').classList.add('hidden'),2800)}
  function dateFmt(iso){return new Date(iso).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'})}
  function dayFmt(iso){return new Date(iso).toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'})}
  async function req(path,opts){const res=await fetch(path,opts);if(!res.ok){let x={};try{x=await res.json()}catch{}throw new Error(typeof x.detail==='string'?x.detail:'서버 요청에 실패했어요')}return res.json()}
  function setConnection(active,text){state.connected=active;$('connDot').classList.toggle('off',!active);$('connText').textContent=text|| (active?'실시간 연결':'연결 끊김')}
  function renderRooms(){const q=$('roomSearch').value.trim().toLowerCase();const list=$('roomList');list.replaceChildren();$('roomTotal').textContent=state.rooms.length;
    for(const room of state.rooms.filter(r=>(r.name+' '+r.description).toLowerCase().includes(q))){
      const btn=document.createElement('button');btn.className='roomItem'+(room.id===state.active?' active':'');btn.type='button';btn.addEventListener('click',()=>selectRoom(room.id));
      const icon=document.createElement('span');icon.className='roomIcon';icon.textContent=room.emoji;
      const info=document.createElement('div');info.className='roomInfo';
      const top=document.createElement('div');top.className='roomTop';const name=document.createElement('span');name.className='roomTitle';name.textContent=room.name;
      const count=document.createElement('span');count.className='roomCount';count.textContent=room.online+'명';top.append(name,count);
      const preview=document.createElement('div');preview.className='roomPreview';preview.textContent=room.last_message||room.description;
      info.append(top,preview);btn.append(icon,info);list.append(btn)
    }
    if(!list.children.length){const p=document.createElement('p');p.style.cssText='color:#90a0aa;font-size:12px;padding:12px';p.textContent='검색 결과가 없어요.';list.append(p)}
  }
  async function fetchRooms(){try{state.rooms=(await req('/api/rooms')).rooms;renderRooms();if(!state.active){const requested=state.rooms.find(r=>r.id===state.pendingRoom);await selectRoom(requested?requested.id:'lobby')}}catch(e){toast('채팅 서버 연결 실패: '+e.message)}}
  function addDay(date){const day=dayFmt(date);if(day===state.lastDay)return;state.lastDay=day;const d=document.createElement('div');d.className='daylabel';d.textContent=day;$('messages').append(d)}
  function renderEmpty(){const empty=document.createElement('div');empty.className='empty';const image=document.createElement('img');image.src=stMap.hello.url;image.alt='환영 인사';const h=document.createElement('h3');h.textContent='첫 인사를 남겨볼까요?';const p=document.createElement('p');p.textContent='코코크루와 친구들이 기다리고 있어요. 메시지나 이모티콘을 보내 대화를 시작해 보세요.';const pill=document.createElement('span');pill.className='pill';pill.textContent='✨ 따뜻한 첫 대화를 시작해요';empty.append(image,h,p,pill);$('messages').append(empty)}
  function renderMessage(m){document.querySelector('.empty')?.remove();addDay(m.created_at);const mine=m.sender_id===state.id;const el=document.createElement('div');el.className='msg '+(mine?'me':'them')+(m.kind==='sticker'?' stickerMessage':'');el.dataset.msgid=m.id;
    if(!mine){const av=document.createElement('div');av.className='msgAvatar';av.textContent=avatar(m.sender_id);el.append(av)}
    const body=document.createElement('div');body.className='msgBody';if(!mine){const name=document.createElement('div');name.className='sender';name.textContent=m.nickname;body.append(name)}
    const line=document.createElement('div');line.className='msgLine';if(m.kind==='sticker'){
      const img=document.createElement('img');img.className='stickerBubble';img.src=(stMap[m.content]||stMap.hello).url;img.alt=(stMap[m.content]||stMap.hello).label+' 이모티콘';img.loading='lazy';line.append(img)
    }else{const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=m.content;line.append(bubble)}
    const tm=document.createElement('span');tm.className='time';tm.textContent=dateFmt(m.created_at);line.append(tm);body.append(line);el.append(body);$('messages').append(el);$('messages').scrollTop=$('messages').scrollHeight;
  }
  async function selectRoom(roomId){const room=state.rooms.find(r=>r.id===roomId);if(!room)return;
    clearTimeout(reconnectTimer);if(state.ws){const old=state.ws;state.ws=null;old.onclose=null;old.close()};state.active=roomId;state.lastDay='';$('messages').replaceChildren();$('chatTitle').textContent=room.name;$('chatIcon').textContent=room.emoji;$('onlineCount').textContent=room.online||0;$('typing').textContent='';setConnection(false,'연결 중');toggleStickers(false);renderRooms();
    const url=new URL(location.href);url.searchParams.set('room',roomId);history.replaceState({},'',url.pathname+url.search);
    $('shell').classList.add('roomOpen');
    seen.clear();cursor=0;historyLoaded=false;buffered=[];connect(roomId)
  }
  function connect(roomId){
    if(!state.nick||!state.id)return;syncing=true;inFlight=false;clearTimeout(flushTimer);buffered=[];setConnection(false,'연결 중');
    const ws=new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws/'+encodeURIComponent(roomId));state.ws=ws;
    ws.onopen=()=>{if(state.ws!==ws)return;ws.send(JSON.stringify({event:'sync',after:cursor,initial:!historyLoaded}))};
    ws.onmessage=e=>{if(state.ws!==ws)return;let p;try{p=JSON.parse(e.data)}catch{return}
      if(p.event==='sync'){
        for(const m of p.messages)accept(m);
        if(p.more){ws.send(JSON.stringify({event:'sync',after:p.cursor}));return}
        for(const m of buffered.sort((a,b)=>a.seq-b.seq))accept(m);buffered=[];syncing=false;historyLoaded=true;attempts=0;
        setConnection(true);if(!seen.size)renderEmpty();showPending();flush();
      }else if(p.event==='message'){
        if(syncing)buffered.push(p.message);else {accept(p.message);showPending()}
      }else if(p.event==='ack'){pending=pending.filter(x=>x.client_message_id!==p.client_message_id);savePending();showPending();clearTimeout(flushTimer);inFlight=false;flushTimer=setTimeout(flush,500)}
      else if(p.event==='presence'){$('onlineCount').textContent=p.count;const r=state.rooms.find(r=>r.id===roomId);if(r){r.online=p.count;renderRooms()}}
      else if(p.event==='typing'&&p.sender_id!==state.id){$('typing').textContent=p.active?p.nickname+'님이 입력 중...':'';clearTimeout(state.typingTimer);state.typingTimer=setTimeout(()=>$('typing').textContent='',1600)}
      else if(p.event==='error'){clearTimeout(flushTimer);inFlight=false;toast(p.message);$('connText').textContent='처리 실패 · 눌러 재시도';if(syncing){ws.close();}}
    };
    ws.onclose=async e=>{if(state.ws!==ws)return;clearTimeout(flushTimer);inFlight=false;setConnection(false,'다시 연결 중');
      if(e.code===4001){showProfile();return}
      const delay=Math.min(30000,1000*2**Math.min(attempts++,5))*(.8+Math.random()*.4);
      reconnectTimer=setTimeout(async()=>{if(state.active!==roomId||state.ws!==ws)return;
        try{const {user}=await req('/api/session');if(!user){showProfile();return}}catch{}
        connect(roomId)
      },delay)
    };ws.onerror=()=>{};
  }
  function send(kind,content){
    if(!state.connected||syncing){toast('서버 연결을 확인해 주세요.');return false}
    if(pending.length>=20){toast('전송 대기 메시지를 먼저 재시도해 주세요.');return false}
    pending.push({event:'message',kind,content,room_id:state.active,client_message_id:crypto.randomUUID()});savePending();showPending();flush();return true
  }
  function sendText(){const txt=$('messageInput').value.trim();if(!txt)return;if(send('text',txt)){$('messageInput').value='';$('messageInput').style.height='43px';toggleStickers(false);$('messageInput').focus()}}
  function toggleStickers(forced){state.stickerOpen=typeof forced==='boolean'?forced:!state.stickerOpen;$('stickerDrawer').classList.toggle('hidden',!state.stickerOpen);$('stickerBtn').classList.toggle('on',state.stickerOpen)}
  function fillStickers(){for(const [id,label,file] of stickerList){const btn=document.createElement('button');btn.type='button';btn.className='stickerChoice';btn.title=label;btn.setAttribute('aria-label',label+' 이모티콘 보내기');const img=document.createElement('img');img.src='/static/stickers/'+file;img.alt=label;btn.append(img);btn.addEventListener('click',()=>{if(send('sticker',id))toggleStickers(false)});$('stickerGrid').append(btn)}}
  function showProfile(){if(state.nick)$('nicknameInput').value=state.nick;$('profileOverlay').classList.remove('hidden');$('nicknameInput').focus()}
  async function saveProfile(){const nickname=$('nicknameInput').value.trim();
    try{const {user}=await req('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname})});
      if(sessionStorage.getItem('koko-pending-owner')!==user.id){pending=[];savePending()}sessionStorage.setItem('koko-pending-owner',user.id);
      state.nick=user.nickname;state.id=user.id;localStorage.setItem('koko-nick',state.nick);
      $('selfName').textContent=state.nick;$('profileOverlay').classList.add('hidden');
      if(state.active)await selectRoom(state.active);else await fetchRooms()
    }catch(e){toast(e.message)}
  }
  async function createRoom(){const name=$('newRoomName').value.trim();const description=$('newRoomDesc').value.trim();try{const r=await req('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description})});$('roomOverlay').classList.add('hidden');$('newRoomName').value='';$('newRoomDesc').value='';await fetchRooms();await selectRoom(r.room.id);toast('새 대화방을 만들었어요!')}catch(e){toast(e.message)}}
  async function copyRoom(){const link=new URL(location.href);link.searchParams.set('room',state.active);try{await navigator.clipboard.writeText(link.href);toast('채팅방 주소를 복사했어요!')}catch{prompt('초대 링크를 복사하세요',link.href)}}
  $('roomSearch').addEventListener('input',renderRooms);$('createRoom').onclick=()=>{$('roomOverlay').classList.remove('hidden');$('newRoomName').focus()};$('cancelRoom').onclick=()=>$('roomOverlay').classList.add('hidden');$('confirmRoom').onclick=createRoom;$('newRoomName').onkeydown=e=>{if(e.key==='Enter')createRoom()};
  $('editProfile').onclick=showProfile;$('saveProfile').onclick=saveProfile;$('nicknameInput').onkeydown=e=>{if(e.key==='Enter')saveProfile()};
  $('messageInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendText()}else if(state.connected&&Date.now()-(state.lastTyping||0)>1200){state.lastTyping=Date.now();state.ws.send(JSON.stringify({event:'typing',active:true}))}};$('sendBtn').onclick=sendText;
  $('stickerBtn').onclick=()=>toggleStickers();$('backBtn').onclick=()=>{$('shell').classList.remove('roomOpen');toggleStickers(false)};
  $('shareRoom').onclick=copyRoom;$('roomInfo').onclick=()=>{const r=state.rooms.find(r=>r.id===state.active);if(!r)return;$('infoTitle').textContent=r.emoji+' '+r.name;$('infoBody').textContent=r.description+'\n\n현재 '+$('onlineCount').textContent+'명 접속 중 · 공개 채팅방';$('infoOverlay').classList.remove('hidden')};$('closeInfo').onclick=()=>$('infoOverlay').classList.add('hidden');$('copyInfo').onclick=()=>{$('infoOverlay').classList.add('hidden');copyRoom()};
  $('themeToggle').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('koko-dark',document.body.classList.contains('dark')?'true':'false');$('themeToggle').textContent=document.body.classList.contains('dark')?'☀':'☾'};
  if(localStorage.getItem('koko-dark')==='true'){$('themeToggle').click()}
  document.addEventListener('keydown',e=>{if(e.altKey&&e.key.toLowerCase()==='e'){e.preventDefault();toggleStickers()}if(e.key==='Escape'){$('roomOverlay').classList.add('hidden');$('infoOverlay').classList.add('hidden');toggleStickers(false)}});
  fillStickers();
  async function boot(){try{const {user}=await req('/api/session');if(!user){showProfile();return}
    if(sessionStorage.getItem('koko-pending-owner')!==user.id){pending=[];savePending()}sessionStorage.setItem('koko-pending-owner',user.id);state.id=user.id;state.nick=user.nickname;$('selfName').textContent=state.nick;fetchRooms()
  }catch(e){toast(e.message)}}
  boot();
  // No recurring room-list polling. Refresh when returning to the list or foreground.
  $('backBtn').addEventListener('click',fetchRooms);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.nick){fetchRooms();if(state.ws?.readyState===WebSocket.OPEN){syncing=true;state.ws.send(JSON.stringify({event:'sync',after:cursor}))}}});
  window.addEventListener('online',()=>{if(state.active&&state.ws?.readyState!==WebSocket.OPEN){clearTimeout(reconnectTimer);connect(state.active)}});
})();
