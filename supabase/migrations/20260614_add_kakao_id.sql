-- Add KakaoTalk ID field to member profiles
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS kakao_id TEXT;
