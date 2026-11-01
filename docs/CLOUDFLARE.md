# 코코크루톡 무료 전용 운영

월 0원, 유료 자동 전환 없음, 한도 초과 시 서비스 제한, 기존 메시지 자동 삭제 없음을 운영 조건으로 한다.
이 파일이나 FREE_ONLY 변수는 Cloudflare의 실제 결제 플랜을 변경하지 않는다. **과금 방지의 근거는 대상 계정의 Workers Free 플랜**이다. Paid 계정의 무료 포함량은 이 조건에 맞지 않는다.

## 구현 범위

- 원본 app.py, static/index.html, PNG, chat.db는 유지. 별도 Cloudflare 빌드에서 통신 JS만 교체한다.
- 공개방만 지원. 서버 발급 HttpOnly 게스트 세션은 30일 유효하며 브라우저마다 다른 계정이다.
- 방별 SQLite 기반 Durable Object, WebSocket Hibernation, D1 영구 저장.
- 저장 후 ACK/방송, 클라이언트 UUID 중복 방지, 순번 커서 기반 재접속 복구.
- 정기 12초 폴링 제거. 방 목록 복귀·화면 활성화 시 새로고침.
- 방 목록 접속 수는 미접속 방에서 0으로 표시한다. 정확한 사용자 수는 현재 방 연결에서 제공한다.
- 전송 대기함은 탭의 sessionStorage에 최대 20개 보관한다. 탭을 닫으면 미확인 메시지는 소실될 수 있다.
- 자동 전송 재시도는 ACK 유실에 적용. 서버가 한도/저장 오류를 반환하면 자동 반복을 멈추고 연결 상태 글자를 눌러 재시도한다.

## 저장 상한

D1 capacity 테이블에 총 메시지 100,000건, 본문 UTF-8 50,000,000바이트, 방 100개, 사용자 10,000명 상한을 둔다. 이는 실제 DB 파일 크기 측정값이 아닌 보수적인 앱 제한이다. 인덱스·메타데이터도 용량을 차지한다. 메시지 상한 검사는 트리거로 처리하므로 서로 다른 방의 동시 쓰기에도 적용된다. capacity.writes_enabled=0이면 신규 메시지 저장을 중단한다. 자동 삭제는 하지 않는다.

플랫폼의 일일 요청·읽기·쓰기 한도에 먼저 닿으면 조회/로그인까지 실패할 수 있다. 저장 공간 초과는 날짜가 바뀌어도 복구되지 않는다. 운영자는 명시적으로 백업·정리하거나 신규 저장을 중단해야 한다.

## 로컬 검증 (결제 계정 불필요)

PowerShell에서 실행:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run db:local
npm.cmd run dev
```

localhost:8787 접속. 테스트 DB는 .wrangler 아래에 있으며 기존 chat.db와 분리된다.

개발 서버 실행 중 다른 터미널에서 `npm.cmd run test:live`를 실행하면 로컬 주소에만 접속해 두 사용자 방송·중복 방지·방 분리·재접속 복구를 확인한다. 테스트 사용자와 테스트 방은 로컬 D1에 추가된다. 실제 브라우저/스마트폰의 화면 및 네트워크 전환 검증은 별도로 수행한다.

## 배포 전 필수 확인

1. Cloudflare 대시보드에서 **대상 계정의 Workers Free** 확인. 유료 계정과 혼동되면 무료 전용 계정을 사용한다.
2. Workers Paid, 유료 부가 서비스, 유료 API, 도메인 구매를 활성화하지 않는다. workers.dev 주소 사용.
3. wrangler login / whoami로 대상 계정을 확인한다. 이후 D1 생성도 동일 계정에서 한다.
4. 무료 계정에서 `npx.cmd wrangler d1 create kokocrew-talk` 실행 후 반환된 database_id를 wrangler.jsonc에 입력한다. 여기에 들어 있는 0 UUID는 로컬용 자리표시자다.
5. `npx.cmd wrangler d1 migrations apply DB --remote`로 스키마 적용. 이 명령 역시 계정 확인 후에만 실행한다.
6. 이력 이전이 필요하면 아래 절차 수행.
7. 실제 Free 플랜 확인 후에만 현재 PowerShell 세션에서 아래 실행:

```powershell
$env:KOKO_CONFIRMED_FREE_ACCOUNT='YES'
npm.cmd run deploy
Remove-Item Env:KOKO_CONFIRMED_FREE_ACCOUNT
```

배포 스크립트는 확인값/DB ID가 없으면 중단한다. **이는 사람이 대시보드를 확인했다는 표시이며 결제 플랜을 API로 검증하는 기능이 아니다.** Wrangler를 직접 실행하면 이 보호를 우회하므로 운영 배포는 위 스크립트를 사용한다. 자동 유료 가입·전환 코드는 없다. 요금 정책이 바뀌거나 계정이 Paid로 변경되면 이 전제는 다시 확인해야 한다.

## Git 연동 Workers Builds 설정

대시보드 Worker 이름은 `kokocrewtalk`이며 wrangler.jsonc의 name과 일치시킨다. D1 이름 `kokocrew-talk`은 별도 리소스 이름이므로 그대로 사용해도 된다.

1. 대상 계정의 Workers Free를 확인한 뒤 D1에서 `kokocrew-talk` DB를 생성한다. 기존 DB가 있으면 재사용한다.
2. DB의 Database ID를 wrangler.jsonc의 `database_id`에 입력한다. 0 UUID는 로컬용이며 실제 배포에서는 동작하지 않는다. Database ID는 비밀번호/API 토큰이 아니다.
3. D1 콘솔에서 migrations/0001_initial.sql을 한 번 실행하거나, Wrangler로 원격 마이그레이션을 적용한다. 이미 적용한 스키마는 다시 실행하지 않는다.
4. 설정 변경을 Git 저장소에 반영한다.
5. Workers Builds의 빌드 명령은 `npm run build`, 배포 명령은 `npm run deploy`로 설정한다. `npx wrangler deploy`는 무료 확인용 스크립트를 우회한다.
6. 실제 Workers Free를 확인한 경우에만 빌드 변수 `KOKO_CONFIRMED_FREE_ACCOUNT=YES`를 추가한다. 이 값 자체가 실제 계정 플랜을 검증하거나 변경하지는 않는다.
7. 재배포 후 공용 URL에서 로그인·메시지 저장·두 기기 동시 대화를 확인한다.

## SQLite 이전 절차

최종 전환 시 Python 서버 쓰기를 중단한다. WAL 파일을 수동으로 삭제/복사하지 않는다.

```powershell
python -B scripts/export_sqlite.py
```

출력된 폴더에 일관된 SQLite 백업과 legacy-import.sql이 만들어진다. 기본 스키마를 적용한 별도 로컬 D1에 먼저 `wrangler d1 execute DB --local --file <SQL경로>`로 입력한다. 방별 메시지 건수·ID·내용·스티커를 원본과 대조한 후 remote에 적용한다. 기존 sender_id는 legacy: 접두어로 보존하며 새 세션에 자동 귀속시키지 않는다. 백업·SQL에는 대화가 포함되므로 공개 정적 파일에 넣지 않는다.

## 공개 URL 합격 기준

- 개발 PC를 종료하고 다른 PC + LTE/5G 스마트폰으로 같은 방에서 송수신.
- 다른 방에 메시지/입력 상태가 전달되지 않음.
- 텍스트·PNG 10종·다크 모드·모바일 레이아웃 유지.
- 연결 단절 중 도착한 메시지가 복구되고 같은 UUID 재전송은 한 건만 저장.
- 테스트 DB의 max_messages를 작게 줄여 상한 도달 시 실패 안내, 기존 메시지 보존 확인.
- 요청/DB 장애 시 성공 표시와 방송이 없어야 함.
- 세션 위조·다른 Origin·만료 세션 거부.
- 스키마/데이터 이전 및 재배포 후 이력 유지.

공식 정책: https://developers.cloudflare.com/d1/platform/pricing/ , https://developers.cloudflare.com/durable-objects/platform/pricing/ , https://developers.cloudflare.com/workers/platform/limits/
