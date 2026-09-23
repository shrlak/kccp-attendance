-- 프로덕션 public 스키마에 있는데 이 저장소의 마이그레이션이 만들지 않는 것들을 옮겨 적는다.
--
-- 프로덕션의 schema_migrations에는 이 저장소에 파일이 없는 줄이 20260826~20260830에 있다
-- (slides_ai_proxy · slides_storage · slides_setlists · praise_team_leaders ·
-- prod_schema_parity). 그 줄들이 public에 표 여섯 개(ai_usage · services · teams ·
-- team_services · team_leaders · setlists)와 config.slides_ai_settings 한 칸을 만들었는데,
-- 저장소에는 그 정의가 없다.
--
-- 그래서 **대학·청년부 백업이 검증 단계에서 깨졌다** (backup.yml, 2026-09-20 주간 실행):
-- 백업은 `pg_dump --schema=public --data-only`라 그 표들의 줄도 싣는데, 검증은 일회용 DB에
-- **이 저장소의** 마이그레이션만 재생해 스키마를 세우므로 그 줄을 받을 표가 없다 —
-- `column "slides_ai_settings" of relation "config" does not exist`. 덤프에서 빼는 것은
-- 답이 아니다: 그러면 그 표들은 어디에도 백업되지 않는다. 저장소가 프로덕션을 따라잡는다.
--
-- 정의는 프로덕션의 것을 그대로 옮겼다 (열·기본값·NULL 여부·키·CHECK·인덱스·RLS).
-- 프로덕션에는 이미 다 있으므로 거기서는 아무것도 하지 않는다 — 전부 IF NOT EXISTS다.
-- RLS는 다른 표들과 같이 켜고 정책은 두지 않는다 (프로덕션도 정책이 없다).
--
-- 번호는 원격에 실제로 있는 마지막 줄(20260831)보다 뒤여야 한다 — 20260831의 머리말 참고.

ALTER TABLE public.config ADD COLUMN IF NOT EXISTS slides_ai_settings jsonb;

CREATE TABLE IF NOT EXISTS public.ai_usage (
  day                 date        NOT NULL,
  provider            text        NOT NULL,
  model               text        NOT NULL,
  requests            integer     NOT NULL DEFAULT 0,
  successful_requests integer     NOT NULL DEFAULT 0,
  failed_requests     integer     NOT NULL DEFAULT 0,
  prompt_tokens       bigint      NOT NULL DEFAULT 0,
  output_tokens       bigint      NOT NULL DEFAULT 0,
  total_tokens        bigint      NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, provider, model)
);

CREATE TABLE IF NOT EXISTS public.services (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  starts_at  time        NOT NULL,
  partition  text        NOT NULL CONSTRAINT services_partition_check CHECK (partition = ANY (ARRAY['youth','adult'])),
  sort_order integer     NOT NULL DEFAULT 0,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_partition_name_key UNIQUE (partition, name)
);

CREATE TABLE IF NOT EXISTS public.teams (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  kind       text        NOT NULL CONSTRAINT teams_kind_check CHECK (kind = ANY (ARRAY['praise','choir'])),
  partition  text        NOT NULL CONSTRAINT teams_partition_check CHECK (partition = ANY (ARRAY['youth','adult'])),
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_partition_name_key UNIQUE (partition, name),
  CONSTRAINT teams_choir_is_adult CHECK (kind <> 'choir' OR partition = 'adult')
);

CREATE TABLE IF NOT EXISTS public.team_services (
  team_id    uuid    NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  service_id uuid    NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  leads_ppt  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (team_id, service_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS team_services_one_leader
  ON public.team_services (service_id) WHERE leads_ppt;

CREATE TABLE IF NOT EXISTS public.team_leaders (
  team_id    uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  member_id  uuid,
  name       text,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS team_leaders_one_team_per_email
  ON public.team_leaders (lower(email)) WHERE active;
CREATE INDEX IF NOT EXISTS team_leaders_by_team
  ON public.team_leaders (team_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.setlists (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  service_id        uuid        NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  service_date      date        NOT NULL,
  conti_path        text,
  deck_path         text,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  uploaded_by_email text,
  uploaded_by_name  text,
  CONSTRAINT setlists_team_id_service_id_service_date_key UNIQUE (team_id, service_id, service_date)
);
CREATE INDEX IF NOT EXISTS setlists_live_by_date
  ON public.setlists (service_date DESC) WHERE archived_at IS NULL;

ALTER TABLE public.ai_usage      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_leaders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setlists      ENABLE ROW LEVEL SECURITY;

-- 백업 계정이 읽을 수 있어야 덤프에 실린다 (프로덕션에는 이미 있다). 역할이 없는 곳
-- (PR 미리보기 브랜치·일회용 검증 DB)에서는 건너뛴다 — 20260720과 같은 방식.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_reader') THEN
    GRANT SELECT ON public.ai_usage, public.services, public.teams,
                    public.team_services, public.team_leaders, public.setlists
      TO backup_reader;
  ELSE
    RAISE NOTICE 'backup_reader does not exist; skipping grants';
  END IF;
END $$;
