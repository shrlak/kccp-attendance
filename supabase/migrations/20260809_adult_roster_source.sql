-- 장년부 명단을 옮겨 담을 때 **원본 한 줄을 통째로** 함께 보관한다.
--
-- 교회가 쓰던 명단은 세대 단위다: 한 줄에 부부가 함께 적혀 있고, 전화(D/E)·생일(G/H)·
-- 세례여부(I)가 그 두 사람의 자리에 하나씩 들어간다. 출석은 사람이 찍으므로 사람 단위로
-- 갈라 넣을 수밖에 없는데, 그 과정에서 "이 값이 둘 중 누구 것인가"를 우리가 판단하게 된다.
--
-- 그 판단이 틀렸을 때 되돌릴 수 있도록, 갈라 넣기 **전의 행을 그대로** 여기 둔다. 값을
-- 다듬지 않고 옮긴다는 약속을 데이터로 지키는 칸이다 — 표시에는 쓰이지 않는다.
--   {"row": 92, "A": "양효은 Mike Miller", "C": "475 Serpentine Drive…", …}

ALTER TABLE adult.members
  ADD COLUMN IF NOT EXISTS source_row jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN adult.members.source_row IS
  '명단 이관 당시의 원본 스프레드시트 행 전체(칸 문자 그대로). 화면에는 쓰지 않는다';
