-- 새가족 교육 동산: a per-member 동산 assignment used only during newcomer education,
-- kept separate from a member's eventual regular 동산 (members.subgroup) — a newcomer
-- can be placed in a temporary education-track 동산 before they join their real one.
-- The name list (관리자 › 동산 tab) is configured independently of config.dongsan_names.
ALTER TABLE members ADD COLUMN IF NOT EXISTS new_member_dongsan text DEFAULT '';
ALTER TABLE config  ADD COLUMN IF NOT EXISTS new_member_dongsan_names jsonb NOT NULL DEFAULT '{"대학부":[],"청년부":[]}'::jsonb;

-- 카드 사진 등록 (Gemini card-photo extraction) monthly quota: how many 새가족 › 카드
-- 사진 등록 scans are allowed per calendar month, adjustable in 관리자 › 설정. Usage
-- itself is derived from audit_log (action='extract-card'), not stored separately.
ALTER TABLE config ADD COLUMN IF NOT EXISTS card_scan_monthly_limit integer NOT NULL DEFAULT 60;
