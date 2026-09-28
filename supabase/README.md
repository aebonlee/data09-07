# Supabase DB 스크립트 — data09-07 하네스 유사도면 분류 · ECN 관리

이 폴더에는 유사도면 분류·ECN 관리 도구의 자료를 데이터베이스(Supabase)에 담을 때 쓸 표 구조(`schema.sql`)가 들어 있습니다.
지금 도구는 이 스크립트 없이도 그대로 동작합니다. 앱을 DB 에 연결하는 일은 다음 단계에서 합니다.

## 왜 DB 가 필요한가

지금 도구는 도면·그룹·확정 이력·ECN 전부를 브라우저 localStorage 의 `data09-07.db` 한 덩어리에 둡니다. 그래서 다음 한계가 있습니다.

- **팀이 함께 쓰지 못합니다** — 설계변경통보서는 작성·검토·승인·접수(품질)와 6개 수신 부서가 함께 보는 문서입니다. 브라우저에만 있으면 작성자 PC 밖에서는 보이지 않습니다.
- **이력이 쉽게 사라집니다** — 그룹 확정·후보 제외 이력(누가, 언제, 어느 그룹으로)은 나중에 「왜 이 도면이 이 그룹인가」를 설명하는 근거입니다. 브라우저 저장소를 지우거나 PC 를 바꾸면 함께 사라지고, 누구나 고칠 수 있습니다.
- **용량** — 도면이 늘고 PDF 추출 원문(raw_text)이 쌓이면 브라우저 저장 공간(보통 5MB 안팎)을 넘습니다.

## 테이블

| 이름 | 용도 | localStorage 대응 |
|---|---|---|
| `app_settings` | 유사도 가중치 5항목, 기준점수, 후보 표시 건수, 비교 범위, 확정자, 사용처 목록, 부품번호 모양, 키워드 사전. 사용자당 1행 | `db.settings` |
| `drawing` | 도면 정보(품번·품명·REV·고객사·기종·사용처·등록일)와 특징(커넥터·회로 수·분기 수·전선·키워드), 확정 그룹, 정답 그룹, 추출 원문 | `db.drawings[]` |
| `drawing_group` | 도면 그룹 — 그룹명, 대표 도면, 분류 기준, 확정자·확정일, 메모 | `db.groups[]` |
| `decision_log` | 그룹 확정·후보 제외 이력 (기록성 — 추가·조회만) | `db.decisions[]` |
| `ecn` | ECN·설계변경통보서 1절 기본 정보, 3절 적용 시점·재고 처리, 9·10절, 결재란, 상태 | `db.ecns[]` |
| `ecn_receipt` | 4절 수신 부서 확인 (ECN 당 6개 부서) | `ecns[].receipts[]` |
| `ecn_material` | 5절 변경자재 내역 | `ecns[].materials[]` |
| `ecn_impact` | 6절 영향도 검토·부서별 조치 (ECN 당 9개 항목) | `ecns[].impacts[]` |
| `ecn_horizontal` | 7절 수평전개 검토 | `ecns[].horizontal[]` |

필드 이름은 도구의 이름을 snake_case 로 옮겼습니다. 몇 가지는 이름을 바꿨습니다.

- 그룹 표는 `group` 이 PostgreSQL 예약어라 `drawing_group` 입니다.
- 앱의 id(`DWG-0001`, `G-012`, `ECN-0001`)는 `drawing_id`·`group_id`·`ecn_key` 로 두었습니다. 표마다 따로 숫자 `id` 가 있습니다.
- 이력의 `by`·`at` 은 `decided_by`·`decided_at`, ECN 의 `createdAt` 은 `ecn_created_at`, 결재란 `approval.writer` 등은 `approval_writer` 처럼 펼쳤습니다.
- 변경자재의 증감과 영향도의 상태는 앱이 계산하는 값이라 저장하지 않습니다.

## 보안

- 모든 표에 RLS(행 단위 보안)를 켰습니다. 각 행은 만든 사람(`owner_id`)만 보고 고치고 지울 수 있습니다.
- `decision_log` 는 기록성 표라 추가·조회 정책만 둡니다. 만든 사람도 고치거나 지우지 못합니다.
- ECN 에 딸린 표(수신 부서·변경자재·영향도·수평전개)는 본인 ECN 에만 붙일 수 있습니다.
- 로그인하지 않은 방문자(anon)는 아무것도 보거나 쓰지 못합니다.
- 지금 도구에는 로그인·역할 구분이 없어 관리자 표를 두지 않았습니다. 여러 부서가 같은 ECN 을 함께 고치게 하려면, 앱을 연결하는 단계에서 팀 구성원 표와 정책을 더합니다.

## 적용 방법

1. [supabase.com](https://supabase.com) 에 가입합니다.
2. **New project** 로 본인 프로젝트를 만듭니다.
3. 왼쪽 메뉴의 **SQL Editor** 를 엽니다.
4. `schema.sql` 내용을 모두 복사해 붙여 넣습니다.
5. **Run** 을 누릅니다.

여러 번 실행해도 안전합니다. 이미 있는 표는 건너뛰고, 정책과 트리거는 지우고 다시 만듭니다.

## 확인 방법

- **Table Editor** 에 표 9개가 보이면 됩니다.
- 표마다 **RLS enabled** 표시가 있는지 확인합니다.
- SQL Editor 에서 아래를 실행해 정책 수를 봅니다. `decision_log` 는 2개(조회·추가), 나머지는 4개(조회·추가·수정·삭제)입니다.

```sql
select tablename, count(*) from pg_policies where schemaname = 'public' group by tablename;
```

## 앱 연결은 다음 단계입니다

이 스크립트는 표를 준비해 두는 것까지입니다. 도구의 `js/store.js` 를 Supabase 에 읽고 쓰도록 바꾸는 일, 로그인 화면을 붙이는 일은 다음 단계에서 합니다.
그때 저장은 upsert 로 하고, 충돌 기준을 `owner_id,drawing_id`·`owner_id,group_id`·`owner_id,ecn_key` 로 지정해야 중복 행이 생기지 않습니다.
앱은 빈칸을 `''` 로 두므로, 날짜 칸은 보낼 때 `''` 를 `null` 로 바꿔야 합니다.

## 로컬 검증 방법

운영에 올리기 전에 내 PC 의 임시 PostgreSQL 에 실제로 적용해 검사합니다. PostgreSQL 이 설치되어 있어야 합니다(macOS: `brew install postgresql@17`).

```sh
./scripts/sqltest/run.sh
```

임시 데이터베이스를 만들어 `schema.sql` 을 두 번 적용하고, 사용자 A·B 격리, 비로그인 차단, 이력 표의 수정·삭제 차단, 제약 조건, 함수 권한을 검사한 뒤 지웁니다. 마지막에 「SQL 검증 통과.」가 나오면 됩니다.
`scripts/sqltest/` 의 `*.local.sql` 파일은 검증 전용이라 Supabase SQL Editor 에서 실행하면 스스로 멈춥니다.
