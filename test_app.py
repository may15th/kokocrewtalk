from fastapi.testclient import TestClient
from app import app, STICKERS

with TestClient(app) as client:
    r=client.get('/')
    assert r.status_code == 200 and '코코톡' in r.text
    rooms=client.get('/api/rooms').json()['rooms']
    assert len(rooms)>=3
    assert rooms[0]['id']=='lobby'
    assert len(client.get('/api/stickers').json()['stickers'])==10
    r=client.post('/api/rooms',json={'name':'테스트 대화방','description':'두 사람이 함께 테스트'})
    assert r.status_code == 201, r.text
    rid=r.json()['room']['id']
    with client.websocket_connect(f'/ws/{rid}?name=테스터A&id=user-abcdefgh-a') as a:
      assert a.receive_json()['event']=='presence'
      with client.websocket_connect(f'/ws/{rid}?name=테스터B&id=user-abcdefgh-b') as b:
        assert a.receive_json()['event']=='presence'
        assert b.receive_json()['event']=='presence'
        a.send_json({'event':'message','kind':'text','content':'안녕하세요! 코코톡 테스트입니다.'})
        am=a.receive_json()
        bm=b.receive_json()
        assert am['event']=='message'
        assert bm['event']=='message'
        assert bm['message']['content']=='안녕하세요! 코코톡 테스트입니다.'
        assert bm['message']['nickname']=='테스터A'
        b.send_json({'event':'message','kind':'sticker','content':'hello'})
        sa=a.receive_json()
        sb=b.receive_json()
        assert sa['event']=='message' and sa['message']['kind']=='sticker'
        assert sb['message']['content']=='hello'
    history=client.get(f'/api/rooms/{rid}/messages').json()['messages']
    assert len(history)==2
    assert len([x for x in history if x['kind']=='sticker'])==1
    for file in STICKERS.values():
        assert client.get('/static/stickers/'+file).status_code == 200
    print('PASS: startup, rooms, stickers, simultaneous websocket clients, broadcast, persistence, image assets')
