-- ============================================================================
-- 로컬 검증 전용 — data09-07 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 흉내: set role authenticated + request.jwt.claim.sub 에 uuid 를 넣으면
--  스텁의 auth.uid() 가 그 값을 돌려줍니다. anon 은 set role anon.
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 문장이 지정한 SQLSTATE 로 실패하는지 본다. (이름이 _assert 로 시작해 권한 검사에서 빠진다)
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is not distinct from p_state then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 %)', p_label, p_state, coalesce(v_state, '성공함');
  end if;
end;
$fn$;

-- 영향받은 행 수를 돌려준다 (RLS 로 가려진 UPDATE/DELETE 는 0 행)
create or replace function public._assert_rows(p_sql text, p_expected int, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n = p_expected then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 % 행, 실제 % 행)', p_label, p_expected, v_n;
  end if;
end;
$fn$;

do $t$ begin raise notice '[프로젝트] 재실행 안전 · 정책 수'; end $t$;

-- 두 번 적용한 뒤에도 정책이 표마다 정확히 4개(중복 생성 없음)
do $t$
declare v_bad text;
begin
  select string_agg(c.relname || '=' || n, ', ') into v_bad from (
    select c.relname, count(p.oid) as n
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
     where s.nspname = 'public' and c.relkind = 'r'
     group by c.relname) c
   where n <> case when relname = 'decision_log' then 2 else 4 end;
  perform public._assert(v_bad is null, '두 번 적용 후 정책 수가 그대로 — 일반 표 4개, decision_log 2개 (어긋남: ' || coalesce(v_bad, '없음') || ')');
  perform public._assert_eq(
    (select count(*) from pg_trigger where tgname like '%\_updated\_at' and not tgisinternal),
    9::bigint, '두 번 적용 후 updated_at 트리거 9개 (housing_master 포함)');
end $t$;

do $t$ begin raise notice '[프로젝트] 함수 권한(proacl)'; end $t$;

do $t$
declare v_acl text;
begin
  select array_to_string(proacl, ',') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and proname = 'set_updated_at';
  perform public._assert(v_acl is not null and v_acl not like '=X/%' and v_acl not like '%,=X/%',
    'set_updated_at: PUBLIC EXECUTE 없음 (' || coalesce(v_acl, 'null') || ')');
  perform public._assert(v_acl not like '%anon=%', 'set_updated_at: anon EXECUTE 없음');
  perform public._assert(v_acl like '%authenticated=X%', 'set_updated_at: authenticated EXECUTE 있음');
end $t$;

-- decision_log 는 조회·추가 정책만 — 수정·삭제 정책이 없어야 한다
do $t$ begin
  perform public._assert_eq(
    (select string_agg(polcmd::text, '' order by polcmd) from pg_policy where polrelid = 'public.decision_log'::regclass),
    'ar'::text, 'decision_log 정책은 SELECT(r)·INSERT(a) 두 개뿐');
end $t$;

-- ----------------------------------------------------------------------------
-- 사용자 A 가 자료를 넣는다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 사용자 A — 자기 자료 쓰기·읽기'; end $t$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

do $t$
declare v_ecn bigint;
begin
  insert into public.app_settings (approver) values ('예시 담당자');
  insert into public.drawing (drawing_id, part_no, rev, customer, model, usage, circuits, group_id)
    values ('DWG-0001', 'HN-A0198', 'B', '고객사 A', 'X1', 'MAIN', 36, 'G-012'),
           ('DWG-0008', 'HN-A0231', 'C', '고객사 A', 'X1', 'MAIN', 38, '');
  insert into public.drawing_group (group_id, name, rep_drawing_id, confirmed_by, confirmed_at)
    values ('G-012', '고객사 A X1 MAIN 계열', 'DWG-0001', '예시 담당자', '2026-09-12 10:20');
  insert into public.decision_log (drawing_id, action, group_id, decided_by, decided_at)
    values ('DWG-0001', '신규 그룹 생성', 'G-012', '예시 담당자', '2026-09-12 10:20');
  insert into public.ecn (ecn_key, ecn_no, model, group_id, pre_apply) values ('ECN-0001', 'ECN-2026-014', 'X1', 'G-012', 'N')
    returning id into v_ecn;
  insert into public.ecn_receipt (ecn_id, dept) select v_ecn, d from unnest(array['생산','생산기술','품질경영','영업','생산관리','구매·자재']) d;
  insert into public.ecn_impact (ecn_id, item, applies) select v_ecn, i, '' from unnest(array['도면','BOM','작업지시서','조립 JIG','검사 JIG','구매 발주','구자재 재고 처리','초도품·품질 승인','포장·라벨·고객제출']) i;
  insert into public.ecn_material (ecn_id, line_no, type, before_no, before_qty, after_no, after_qty)
    values (v_ecn, 1, '대체', 'WR-0085', 1, 'WR-0125', 1), (v_ecn, 2, '', '', null, '', null);
  insert into public.ecn_horizontal (ecn_id, line_no, drawing_id, relation, applies)
    values (v_ecn, 1, 'DWG-0008', '유사 도면 82점', '검토 중');
  -- 2026-09-29 저녁: 도면 자동 읽기 칸 · 하우징 마스터
  update public.drawing set dwg_date = '2026-06-30', title_items = '[{"str":"NO.","x":1,"y":2}]', bom_inputs = '{"DT06-2S-CE06":{"count":3,"circuits":2}}'
    where drawing_id = 'DWG-0001';
  insert into public.housing_master (housing, item, name, kind, qty, basis, csa_text, csa_min, csa_max)
    values ('DT06-2S-CE06', 'EX-LK-2S', 'LOCK', 'LOCK', 1, '하우징당', '', null, null),
           ('DT06-2S-CE06', 'EX-TM-S16-A', '단자', '단자', 1, '회로당', '0.5~1.0', 0.5, 1.0);
  perform public._assert_eq((select count(*) from public.housing_master), 2::bigint, 'A 는 자기 하우징 마스터 2행을 본다');
  perform public._assert_raises($q$insert into public.housing_master (housing, item, kind) values ('DT06-2S-CE06', 'EX-LK-2S', 'LOCK')$q$, '23505', '같은 하우징·구분·핀 범위·자재는 두 번 넣지 못한다(upsert 기준)');
  perform public._assert_raises($q$insert into public.housing_master (housing, item, basis) values ('X', 'Y', '개당')$q$, '23514', '수량 기준은 하우징당·회로당·빈 자리당만');
  -- 2026-09-30 오전: 같은 단자가 핀 범위별로, 같은 품번이 더미로도 — 넣을 수 있어야 한다
  insert into public.housing_master (housing, item, kind, basis, pin_range, slot, optional)
    values ('DT06-2S-CE06', 'EX-TM-S16-A', '단자', '회로당', '2', 'TML|2', false),
           ('DT06-2S-CE06', 'EX-DM-1', '더미(빈 자리)', '빈 자리당', '', 'DUMMY|', false);
  perform public._assert_eq((select count(*) from public.housing_master), 4::bigint, '핀 범위가 다르면 같은 단자를 따로 넣고, 빈 자리당 기준도 받는다');
  update public.app_settings set housing_info = '{"DT06-2S-CE06":{"pins":2}}', ga_sq = '{"18":0.85}';
  perform public._assert_raises($q$update public.app_settings set ga_sq = '[]'$q$, '23514', 'ga_sq 는 객체');
  update public.drawing set cav_tables = '[{"kind":"cav","rows":[]}]' where drawing_id = 'DWG-0001';
  perform public._assert_raises($q$update public.drawing set cav_tables = '{}' where drawing_id = 'DWG-0001'$q$, '23514', 'cav_tables 는 배열');
  perform public._assert_raises($q$insert into public.housing_master (housing, item, csa_min, csa_max) values ('X', 'Z', 2, 1)$q$, '23514', '전선 굵기 범위는 min <= max');
  perform public._assert_raises($q$update public.drawing set title_items = '{}' where drawing_id = 'DWG-0001'$q$, '23514', 'title_items 는 배열');

  perform public._assert_eq((select count(*) from public.ecn_impact), 9::bigint, 'A 는 자기 ECN 의 영향도 9행을 본다');
  perform public._assert_eq((select count(*) from public.ecn_receipt), 6::bigint, 'A 는 자기 ECN 의 수신 부서 6행을 본다');
  perform public._assert_eq((select owner_id from public.drawing where drawing_id = 'DWG-0001'),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'owner_id 가 auth.uid() 로 채워진다');

  -- 기록성 표: 주인도 고치거나 지우지 못한다
  perform public._assert_rows($q$update public.decision_log set action = '후보 제외'$q$, 0, 'decision_log 는 주인(A)도 UPDATE 하지 못한다 (0행)');
  perform public._assert_rows($q$delete from public.decision_log$q$, 0, 'decision_log 는 주인(A)도 DELETE 하지 못한다 (0행)');
  perform public._assert_eq((select action from public.decision_log), '신규 그룹 생성'::text, 'decision_log 이력이 그대로 남아 있다');
  insert into public.decision_log (drawing_id, action, candidate_id, decided_by, decided_at)
    values ('DWG-0008', '후보 제외', 'DWG-0001', '예시 담당자', '2026-09-25 10:00');
  perform public._assert_eq((select count(*) from public.decision_log), 2::bigint, 'decision_log 에 새 이력은 추가된다');
end $t$;

-- 트리거는 now()(트랜잭션 시작 시각)를 쓰므로 INSERT 와 다른 문장에서 고쳐야 차이가 난다
update public.ecn set status = '완료', completed_at = '2026-09-28 10:00';
do $t$ begin
  perform public._assert((select updated_at > created_at from public.ecn), 'UPDATE 하면 updated_at 이 갱신된다');
end $t$;

-- ----------------------------------------------------------------------------
-- 사용자 B 는 A 의 자료를 못 본다 · 못 고친다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 사용자 B — A 와 격리'; end $t$;

set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

do $t$
declare t text;
begin
  foreach t in array array['app_settings','drawing','drawing_group','decision_log','ecn',
                           'ecn_receipt','ecn_material','ecn_impact','ecn_horizontal','housing_master']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'B 에게 A 의 ' || t || ' 가 안 보인다');
    perform public._assert_rows(format('delete from public.%I', t), 0, 'B 는 A 의 ' || t || ' 를 못 지운다');
  end loop;
  foreach t in array array['app_settings','drawing','drawing_group','ecn',
                           'ecn_receipt','ecn_material','ecn_impact','ecn_horizontal','housing_master']
  loop
    perform public._assert_rows(format('update public.%I set updated_at = now()', t), 0, 'B 는 A 의 ' || t || ' 를 못 고친다');
  end loop;
  perform public._assert_raises(
    $q$insert into public.drawing (owner_id, drawing_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'DWG-0099')$q$,
    '42501', 'B 가 owner_id 를 A 로 속여 넣으면 RLS 가 막는다');
  perform public._assert_raises(
    $q$insert into public.decision_log (owner_id, drawing_id, action, decided_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'DWG-0001', '후보 제외', now())$q$,
    '42501', 'B 는 A 의 이력(decision_log)을 지어 넣지 못한다');
  -- B 는 A 와 같은 도면 id·ECN 번호를 자기 것으로 따로 쓸 수 있다
  insert into public.drawing (drawing_id) values ('DWG-0001');
  insert into public.ecn (ecn_key, ecn_no) values ('ECN-0001', 'ECN-2026-014');
  perform public._assert_eq((select count(*) from public.drawing), 1::bigint, 'B 는 A 와 같은 도면 id 로 자기 도면을 따로 둔다');
end $t$;

reset role;
do $t$
declare v_ecn bigint;
begin
  select id into v_ecn from public.ecn where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  execute 'set local role authenticated';
  perform public._assert_raises(
    format('insert into public.ecn_material (ecn_id, line_no) values (%s, 9)', v_ecn),
    '42501', 'B 가 A 의 ECN id 를 알아도 변경자재를 붙이지 못한다');
end $t$;

-- ----------------------------------------------------------------------------
-- anon(비로그인)은 아무것도 못 보고 못 쓴다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] anon — 읽기·쓰기 불가'; end $t$;

set role anon;
set request.jwt.claim.sub = '';
do $t$
declare t text;
begin
  foreach t in array array['app_settings','drawing','drawing_group','decision_log','ecn',
                           'ecn_receipt','ecn_material','ecn_impact','ecn_horizontal','housing_master']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'anon 에게 ' || t || ' 가 안 보인다');
  end loop;
  perform public._assert_raises($q$insert into public.drawing (drawing_id) values ('DWG-0500')$q$,
    '42501', 'anon 은 drawing 에 쓰지 못한다');
  perform public._assert_raises($q$insert into public.ecn (ecn_key, ecn_no) values ('ECN-0500', 'X')$q$,
    '42501', 'anon 은 ecn 에 쓰지 못한다');
  perform public._assert_raises($q$insert into public.decision_log (drawing_id, action, decided_at) values ('DWG-0001', '후보 제외', now())$q$,
    '42501', 'anon 은 decision_log 에 쓰지 못한다');
  perform public._assert_raises('select public.set_updated_at()', '42501', 'anon 은 set_updated_at 을 실행하지 못한다');
end $t$;
reset role;

-- ----------------------------------------------------------------------------
-- CHECK · UNIQUE (postgres 로 — RLS 와 무관하게 제약만 본다)
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] CHECK · UNIQUE 제약'; end $t$;

do $t$
declare a uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; v_ecn bigint;
begin
  select id into v_ecn from public.ecn where owner_id = a;
  perform public._assert_raises(format('insert into public.drawing (owner_id, drawing_id) values (%L, %L)', a, 'DWG-0001'),
    '23505', '같은 사용자·같은 도면 id 는 UNIQUE 가 막는다');
  perform public._assert_raises(format('insert into public.drawing_group (owner_id, group_id, name, confirmed_by, confirmed_at) values (%L, %L, %L, %L, now())', a, 'G-012', 'x', 'y'),
    '23505', '같은 사용자·같은 그룹 id 는 UNIQUE 가 막는다');
  perform public._assert_raises(format('insert into public.ecn (owner_id, ecn_key, ecn_no) values (%L, %L, %L)', a, 'ECN-0009', 'ECN-2026-014'),
    '23505', '같은 사용자·같은 ECN 번호는 UNIQUE 가 막는다');
  perform public._assert_raises(format('insert into public.ecn_impact (owner_id, ecn_id, item) values (%L, %s, %L)', a, v_ecn, 'BOM'),
    '23505', '한 ECN 에 같은 영향도 항목은 한 번만');
  perform public._assert_raises(format('insert into public.ecn_receipt (owner_id, ecn_id, dept) values (%L, %s, %L)', a, v_ecn, '생산'),
    '23505', '한 ECN 에 같은 수신 부서는 한 번만');
  perform public._assert_raises(format('insert into public.app_settings (owner_id) values (%L)', a),
    '23505', '설정은 사용자당 1행');
  perform public._assert_raises(format('insert into public.drawing (owner_id, drawing_id) values (%L, %L)', a, 'D-1'),
    '23514', '도면 id 는 DWG-숫자 모양만');
  perform public._assert_raises(format('insert into public.drawing (owner_id, drawing_id, circuits) values (%L, %L, -1)', a, 'DWG-0777'),
    '23514', '회로 수 음수는 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.drawing_group (owner_id, group_id, name, confirmed_by, confirmed_at) values (%L, %L, %L, %L, now())', a, 'G-900', 'x', ' '),
    '23514', '확정자 없는 그룹 확정은 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.decision_log (owner_id, drawing_id, action, decided_at) values (%L, %L, %L, now())', a, 'DWG-0001', '승인'),
    '23514', '이력 동작은 기존 그룹 연결·신규 그룹 생성·후보 제외만');
  perform public._assert_raises(format('insert into public.ecn (owner_id, ecn_key, ecn_no) values (%L, %L, %L)', a, 'ECN-0010', '  '),
    '23514', 'ECN 번호 빈칸은 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.ecn (owner_id, ecn_key, ecn_no, status) values (%L, %L, %L, %L)', a, 'ECN-0011', 'N-11', '보류'),
    '23514', 'ECN 상태는 진행 중·완료만');
  perform public._assert_raises(format('insert into public.ecn (owner_id, ecn_key, ecn_no, status) values (%L, %L, %L, %L)', a, 'ECN-0012', 'N-12', '완료'),
    '23514', '완료 ECN 은 완료 시각이 있어야 한다');
  perform public._assert_raises(format('insert into public.ecn_material (owner_id, ecn_id, line_no, type) values (%L, %s, 3, %L)', a, v_ecn, '교체'),
    '23514', '변경 유형은 신규·삭제·대체·수량변경·사양변경(또는 빈칸)만');
  perform public._assert_raises(format('insert into public.ecn_material (owner_id, ecn_id, line_no) values (%L, %s, 1)', a, v_ecn),
    '23505', '한 ECN 에 같은 변경자재 줄 번호는 한 번만');
  perform public._assert_raises(format('insert into public.ecn_impact (owner_id, ecn_id, item) values (%L, %s, %L)', a, v_ecn, '금형'),
    '23514', '영향도 항목은 양식의 9개만');
  perform public._assert_raises(format('update public.ecn_impact set applies = %L where ecn_id = %s and item = %L', '예', v_ecn, 'BOM'),
    '23514', '영향도 해당 여부는 해당·비해당(또는 빈칸)만');
  perform public._assert_raises(format('insert into public.ecn_horizontal (owner_id, ecn_id, line_no, applies) values (%L, %s, 5, %L)', a, v_ecn, '보류'),
    '23514', '수평전개 적용 여부는 검토 중·적용·미적용(또는 빈칸)만');
  perform public._assert_raises(format('insert into public.app_settings (owner_id, top_n) values (%L, 6)', gen_random_uuid()),
    '23514', '후보 표시 건수는 1~5');
  perform public._assert_raises(format('insert into public.app_settings (owner_id, scope) values (%L, %L)', gen_random_uuid(), 'team'),
    '23514', '비교 범위는 all·sameCustomer 만');

  -- ECN 을 지우면 딸린 절도 함께 지워진다
  delete from public.ecn where id = v_ecn;
  perform public._assert_eq((select count(*) from public.ecn_impact where ecn_id = v_ecn), 0::bigint,
    'ECN 을 지우면 딸린 영향도 행도 지워진다 (on delete cascade)');
end $t$;

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
