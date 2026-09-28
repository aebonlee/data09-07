-- ============================================================================
-- data09-07 — 하네스 유사도면 분류 · ECN(설계변경통보서) 관리
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금 브라우저 localStorage('data09-07.db' 한 덩어리)에 두는 자료를
--             DB 로 옮길 때 쓸 표 구조입니다. 앱 연결은 다음 단계입니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 표 이름에 접두사를 붙이지 않았습니다.
--  회사 Supabase 주소·키는 이 파일 어디에도 없습니다.
--
--  표 목록 (← localStorage 'data09-07.db' 안의 키)
--    app_settings    유사도 가중치·임계값·확정자 등 (사용자당 1행)   ← db.settings
--    drawing         도면 정보·특징                                   ← db.drawings[]
--    drawing_group   도면 그룹                                        ← db.groups[]
--    decision_log    그룹 확정·후보 제외 이력 (기록성)                ← db.decisions[]
--    ecn             ECN · 설계변경통보서 1~3·8~10절, 결재란          ← db.ecns[]
--    ecn_receipt     4절 수신 부서 확인 (ECN 당 6행)                  ← ecns[].receipts[]
--    ecn_material    5절 변경자재 내역                                ← ecns[].materials[]
--    ecn_impact      6절 영향도 검토·부서별 조치 (ECN 당 9행)         ← ecns[].impacts[]
--    ecn_horizontal  7절 수평전개 검토                                ← ecns[].horizontal[]
--
--  보안
--    모든 표 RLS 켬. 행은 만든 사람(owner_id = auth.uid())만 봅니다.
--    decision_log 는 기록성 표라 INSERT·SELECT 정책만 둡니다(사후 수정·삭제 불가).
--    도구에 로그인·역할 구분이 없어 관리자 표를 두지 않았습니다.
--
--  앱의 id 는 'DWG-0001' · 'G-012' · 'ECN-0001' 같은 글자입니다. 그 값을 그대로
--  drawing_id · group_id · ecn_key 로 두고 (owner_id, 그 값)에 UNIQUE 를 걸었습니다.
--  앱이 빈칸을 '' 로 두는 선택 항목은 CHECK 에서 '' 도 받습니다(앱과 같게).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 설정 — js/logic.js defaultSettings()
create table if not exists public.app_settings (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  -- 원문 3.6 가중치(퍼센트). 합이 100 이 아니어도 앱은 비율로 씁니다.
  weight_family  numeric not null default 25 check (weight_family >= 0),
  weight_usage   numeric not null default 20 check (weight_usage  >= 0),
  weight_parts   numeric not null default 30 check (weight_parts  >= 0),
  weight_text    numeric not null default 15 check (weight_text   >= 0),
  weight_shape   numeric not null default 10 check (weight_shape  >= 0),
  threshold      numeric not null default 70 check (threshold between 0 and 100), -- 기존/신규 그룹 기준점수
  top_n          int not null default 5 check (top_n between 1 and 5),            -- 상위 1~5건
  scope          text not null default 'all' check (scope in ('all', 'sameCustomer')),
  approver       text not null default '',                                         -- 확정자 이름
  usages         text[] not null default array['MAIN','CABIN','ENGINE','PANEL'],
  part_pattern   text not null default '\b[A-Z]{2,4}-?\d{3,6}(?:-\d+)?\b',        -- 부품번호 모양(정규식)
  keyword_dict   text[] not null default array['방수','WATERPROOF','코루게이트','CORRUGATE','TAPE','테이프','TUBE','튜브','SHIELD','GROMMET'],
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- ⚠ 프런트에서 upsert 할 때 onConflict: 'owner_id'
  constraint app_settings_owner_key unique (owner_id)
);

-- 도면
create table if not exists public.drawing (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  drawing_id     text not null check (drawing_id ~ '^DWG-\d+$'),   -- 앱 id
  file_name      text not null default '',
  file_hash      text not null default '',                          -- FNV-1a + 크기(같은 파일 가려내기용)
  part_no        text not null default '',                          -- 비어 있으면 「추출 보정 필요」
  part_name      text not null default '',
  rev            text not null default '',
  customer       text not null default '',
  model          text not null default '',
  usage          text not null default '',                          -- MAIN · CABIN · ENGINE · PANEL …
  reg_date       date,
  connectors     text not null default '',                          -- 'CN-0118, CN-0120' (앱과 같은 글자)
  circuits       int check (circuits is null or circuits >= 0),
  branches       int check (branches is null or branches >= 0),
  wires          text not null default '',
  keywords       text not null default '',
  group_id       text not null default '',                          -- 확정 그룹(G-xxx), 미확정이면 ''
  answer_group   text not null default '',                          -- 적중 검증용 담당자 정답 그룹 ('신규' 포함)
  raw_text       text not null default '',                          -- PDF 추출 원문
  source         text not null default '',                          -- 'PDF 등록' · '엑셀 가져오기' · '직접 입력' …
  src_map        jsonb not null default '{}'::jsonb check (jsonb_typeof(src_map) = 'object'), -- 항목별 값의 출처
  analyzed_at    timestamp,
  excluded       text[] not null default '{}',                      -- 담당자가 제외한 후보 도면 id
  confirmed_by   text not null default '',
  confirmed_at   timestamp,
  version_of     text not null default '',                          -- 같은 품번의 앞 REV 도면 id
  updated_by     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,drawing_id'
  constraint drawing_owner_drawing_key unique (owner_id, drawing_id)
);
create index if not exists drawing_part_idx  on public.drawing (owner_id, part_no, rev);
create index if not exists drawing_group_idx on public.drawing (owner_id, group_id);

-- 도면 그룹 (group 은 PostgreSQL 예약어라 drawing_group)
create table if not exists public.drawing_group (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  group_id        text not null check (group_id ~ '^G-\d+$'),       -- 앱 id
  name            text not null check (length(btrim(name)) > 0),
  rep_drawing_id  text not null default '',                         -- 대표 도면
  criteria        text not null default '',                         -- 분류 기준
  confirmed_by    text not null check (length(btrim(confirmed_by)) > 0), -- 앱: 확정자 없으면 확정 불가
  confirmed_at    timestamp not null,
  memo            text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint drawing_group_owner_group_key unique (owner_id, group_id)
);

-- 그룹 확정·후보 제외 이력 — 기록성 표. UPDATE/DELETE 정책을 두지 않는다.
-- 도면이 지워져도 이력은 남아야 하므로 drawing 에 외래키를 걸지 않는다.
-- (앱 필드 by·at 은 각각 decided_by·decided_at 으로 옮겼다)
create table if not exists public.decision_log (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  drawing_id     text not null,
  action         text not null check (action in ('기존 그룹 연결', '신규 그룹 생성', '후보 제외')),
  group_id       text not null default '',
  prev_group_id  text not null default '',
  candidate_id   text not null default '',
  score          numeric,
  decided_by     text not null default '',
  decided_at     timestamp not null,
  memo           text not null default '',
  created_at     timestamptz not null default now()
  -- 기록성 표라 updated_at 을 두지 않는다(고치지 않으므로)
);
create index if not exists decision_log_drawing_idx on public.decision_log (owner_id, drawing_id, decided_at);

-- ECN · 설계변경통보서 (1·3·8·9·10절 + 결재란)
create table if not exists public.ecn (
  id                 bigint generated always as identity primary key,
  owner_id           uuid not null default auth.uid(),
  ecn_key            text not null,                                  -- 앱 id ('ECN-0001')
  ecn_no             text not null check (length(btrim(ecn_no)) > 0), -- ECN 번호(필수)
  status             text not null default '진행 중' check (status in ('진행 중', '완료')),
  -- 1. 기본 정보
  doc_class          text not null default '개발팀',
  written_date       date,
  change_kind        text not null default '',                       -- 설변 종류(선적용·정규)
  received_date      date,
  rev_no             int not null default 0 check (rev_no >= 0),
  model              text not null default '',
  part_no_after      text not null default '',
  part_no_before     text not null default '',
  part_name          text not null default '',
  customer           text not null default '',
  customer_contact   text not null default '',
  reason_type        text not null default '',
  rev_before         text not null default '',
  rev_after          text not null default '',
  request_source     text not null default '',
  purpose            text not null default '',
  before_text        text not null default '',
  after_text         text not null default '',
  drawing_before_id  text not null default '',
  drawing_after_id   text not null default '',
  group_id           text not null default '',
  -- 3. 적용 시점 · 재고 처리
  apply_date         date,
  delivery_apply     text not null default '',
  apply_condition    text not null default '',
  apply_lot          text not null default '',
  pre_apply          text not null default '' check (pre_apply in ('', 'Y', 'N')),
  regular_date       date,
  stock_plan         text not null default '',
  -- 9·10절, 비고
  remarks            text not null default '',
  detail_memo        text not null default '',
  meeting_memo       text not null default '',
  -- 결재란 (작성 · 검토 · 승인 · 접수(품질))
  approval_writer    text not null default '',
  approval_reviewer  text not null default '',
  approval_approver  text not null default '',
  approval_receiver  text not null default '',
  -- 앱 필드 createdAt 은 작성 시각(글자)이라 created_at(행 생성 시각)과 따로 둔다
  ecn_created_at     timestamp,
  completed_at       timestamp,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ecn_owner_key_key unique (owner_id, ecn_key),
  constraint ecn_owner_no_key  unique (owner_id, ecn_no),
  -- 완료면 완료 시각이 있어야 한다
  constraint ecn_completed_check check (status <> '완료' or completed_at is not null)
);

-- 4절 수신 부서 확인
create table if not exists public.ecn_receipt (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  ecn_id      bigint not null references public.ecn(id) on delete cascade,
  dept        text not null check (dept in ('생산', '생산기술', '품질경영', '영업', '생산관리', '구매·자재')),
  person      text not null default '',
  date        date,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ecn_receipt_ecn_dept_key unique (ecn_id, dept)
);

-- 5절 변경자재 내역 (증감은 저장하지 않고 계산 — 앱 materialDelta)
create table if not exists public.ecn_material (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  ecn_id         bigint not null references public.ecn(id) on delete cascade,
  line_no        int not null check (line_no >= 1),                  -- 화면 순서(No)
  type           text not null default ''
                 check (type in ('', '신규', '삭제', '대체', '수량변경', '사양변경')),
  location       text not null default '',                           -- 적용 위치(커넥터·회로)
  before_no      text not null default '',
  before_spec    text not null default '',
  before_qty     numeric,
  unit           text not null default 'EA',
  after_no       text not null default '',
  after_spec     text not null default '',
  after_qty      numeric,
  stock          text not null default '',                           -- 재고 처리
  dept           text not null default '',
  current_stock  numeric,                                            -- 현재고(구자재)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ecn_material_ecn_line_key unique (ecn_id, line_no)
);

-- 6절 영향도 검토 · 부서별 조치 (상태는 저장하지 않고 계산 — 앱 impactStatus)
create table if not exists public.ecn_impact (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  ecn_id      bigint not null references public.ecn(id) on delete cascade,
  item        text not null check (item in ('도면', 'BOM', '작업지시서', '조립 JIG', '검사 JIG', '구매 발주',
                                            '구자재 재고 처리', '초도품·품질 승인', '포장·라벨·고객제출')),
  applies     text not null default '' check (applies in ('', '해당', '비해당')),
  before_doc  text not null default '',
  after_doc   text not null default '',
  action      text not null default '',
  dept        text not null default '',
  person      text not null default '',
  due         date,
  done        date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ecn_impact_ecn_item_key unique (ecn_id, item)
);

-- 7절 수평전개 검토
create table if not exists public.ecn_horizontal (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  ecn_id      bigint not null references public.ecn(id) on delete cascade,
  line_no     int not null check (line_no >= 1),
  drawing_id  text not null default '',
  part_no     text not null default '',
  model       text not null default '',
  customer    text not null default '',
  relation    text not null default '',                              -- '동일 그룹 G-012' · '유사 도면 82점'
  applies     text not null default '' check (applies in ('', '검토 중', '적용', '미적용')),
  result      text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ecn_horizontal_ecn_line_key unique (ecn_id, line_no)
);

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거 (search_path 고정)
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['app_settings','drawing','drawing_group','ecn',
                           'ecn_receipt','ecn_material','ecn_impact','ecn_horizontal']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만
-- ----------------------------------------------------------------------------

alter table public.app_settings   enable row level security;
alter table public.drawing        enable row level security;
alter table public.drawing_group  enable row level security;
alter table public.decision_log   enable row level security;
alter table public.ecn            enable row level security;
alter table public.ecn_receipt    enable row level security;
alter table public.ecn_material   enable row level security;
alter table public.ecn_impact     enable row level security;
alter table public.ecn_horizontal enable row level security;

-- 부모가 없는 표
do $rls$
declare t text;
begin
  foreach t in array array['app_settings','drawing','drawing_group','ecn']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())', t || '_delete', t);
  end loop;
end;
$rls$;

-- ECN 딸린 표: 본인 행이면서, 붙는 ECN 도 본인 것이어야 한다
do $rls$
declare t text;
  v_own text := 'owner_id = auth.uid()';
  v_par text := 'owner_id = auth.uid() and exists (select 1 from public.ecn e where e.id = ecn_id and e.owner_id = auth.uid())';
begin
  foreach t in array array['ecn_receipt','ecn_material','ecn_impact','ecn_horizontal']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select', t, v_own);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert', t, v_par);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update', t, v_own, v_par);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete', t, v_own);
  end loop;
end;
$rls$;

-- 기록성 표: 조회·추가만. UPDATE/DELETE 정책이 없으므로 RLS 가 모두 거부한다.
drop policy if exists decision_log_select on public.decision_log;
drop policy if exists decision_log_insert on public.decision_log;
drop policy if exists decision_log_update on public.decision_log;
drop policy if exists decision_log_delete on public.decision_log;
create policy decision_log_select on public.decision_log for select to authenticated using (owner_id = auth.uid());
create policy decision_log_insert on public.decision_log for insert to authenticated with check (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않습니다. PostgreSQL 이 PUBLIC 에, Supabase 가
--  ALTER DEFAULT PRIVILEGES 로 anon 에 EXECUTE 를 미리 붙이므로 둘 다 끊습니다.
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
-- 트리거 전용 함수는 authenticated 를 남깁니다(트리거 발화 시 호출자 권한 검사 대비).
grant execute on function public.set_updated_at() to authenticated;

-- ----------------------------------------------------------------------------
-- 끝.
-- ----------------------------------------------------------------------------
