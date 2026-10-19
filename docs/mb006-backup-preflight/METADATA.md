# 읽기 전용 운영 메타데이터 관찰

조회일: 2026-10-19 KST. Supabase connector의 get_project/get_organization 및 SELECT만 사용했다. 실제 고객 행/비밀번호 hash/session/파일/Secrets는 조회하지 않았다. 아래 table_count는 catalog 객체 수이며 데이터 행 수가 아니다. ledger version/name은 요청에서 허용한 관리 이력이다.

- Project healthcare-Briefing, ref kkcvglldsoxglfjqnsga, ap-northeast-1, ACTIVE_HEALTHY.
- Organization cxr542, plan=free, tier=tier_free.
- Management version17.6.1.155, SQL version17.6 /170006, DB postgres.
- Metadata 세션 current_user/session_user postgres, ssl=on; pg_stat_ssl의 현재 세션 ssl=true/TLSv1.3. 로컬 pg_dump 접속 또는 verify-full 성공을 의미하지 않는다.
- pg_database_size=19,246,227 bytes. 실제 논리 archive 크기·소요시간·egress 사용량과 다르다.

| Schema | owner | 테이블 수 | RLS 테이블 | 정책 수 | postgres USAGE | SELECT 없는 테이블/시퀀스 |
|---|---|---|---|---|---|---|
| public | pg_database_owner | 3 | 3 | 3 | true | 0 / 0 |
| customer_auth | postgres | 6 | 6 | 6 | true | 0 / 0 |
| supabase_migrations | postgres | 1 | 0 | 0 | true | 0 / 0 |
| auth | supabase_admin | 27 | 16 | 0 | true | 0 / 0 |
| storage | supabase_admin | 8 | 8 | 0 | true | 0 / 0 |
| support | 부재 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 |

postgres는 LOGIN=true, BYPASSRLS=true, SUPERUSER=false. supabase_admin은 SUPERUSER=true. service_role은 LOGIN=false/BYPASSRLS=true, anon/authenticated는 LOGIN=false/BYPASSRLS=false다. public/customer_auth 함수 catalog 합계7, public/customer_auth/supabase_migrations 시퀀스 합계2. 정의·GRANT·RLS·인덱스는 pg_dump가 포함할 수 있는 객체이지만 실제 export/restore는 미검증이다.

확장: plpgsql1.0(pg_catalog), pg_stat_statements1.11(extensions), uuid-ossp1.1(extensions), pgcrypto1.3(extensions), supabase_vault0.3.1(vault). Vault 존재만 확인했고 비밀 데이터는 읽지 않았다.

## Ledger

supabase_migrations.schema_migrations, owner postgres, relacl NULL, RLS=false/FORCE=false. 모든 column default 없음.

| 순서 | Column | Type | Nullable |
|---|---|---|---|
| 1 | version | text | false, PK |
| 2 | statements | text[] | true |
| 3 | name | text | true |
| 4 | created_by | text | true |
| 5 | idempotency_key | text | true, UNIQUE |
| 6 | rollback | text[] | true |

제약/index: schema_migrations_pkey PRIMARY KEY(version), schema_migrations_idempotency_key_key UNIQUE(idempotency_key). 각 unique btree index, 합계2.

기존 행의 version/name:

| Version | Name |
|---|---|
| 20260928064906 | collector_alert_state |
| 20260929063328 | 20260928010000_collector_runs_admin_only |
| 20261007041102 | article_keyword_boundary |
| 20261012043225 | article_source_detail_url |

postgres: SELECT/INSERT/UPDATE/DELETE 모두 true. service_role/anon/authenticated: 모두 false. 카탈로그 권한 확인이며 실제 INSERT 성공은 UNVERIFIED다. 기존 행의 statements/created_by 등 선택 필드는 읽지 않았으며 그 내용 전체 보존을 운영 조회로 검증했다고 주장하지 않는다.

세 대상 버전20261016014502/20261016035115/20261019041429는 운영 ledger에 없으며 support schema도 없다. 기존 이력4건은 수정하지 않았다.

## 로컬 접속 관찰

- direct host는 project API의 실제 db.kkcvglldsoxglfjqnsga.supabase.co를 사용했다. 로컬 OS DNS lookup(all) 결과 ENOTFOUND. TCP/DB 인증까지 진행되지 않았다. 원인을 IPv6 미지원/DB 장애로 확정하지 않는다.
- Session Pooler 실제 host는 확인하지 못했다. region으로 endpoint를 생성하거나 임의 probe하지 않았다.
- PATH에 pg_dump/psql/Supabase CLI 없음. 캐시된 Supabase CLI2.81.3의 projects list는 Access token not provided로 실패. 로그인/비밀 생성/변경 없음.
- 기존 Docker image postgres:17.6-alpine의 network=none 일회성 pg_dump --version은17.6. 백업은 실행하지 않았다.
- 기본 .pgpass/.pg_service.conf/.config/supabase 경로는 존재가 확인되지 않았다. 다른 저장소에 자격증명이 없다는 뜻은 아니며 기존 앱 .env/Keychain 비밀은 탐색·추출하지 않았다.
