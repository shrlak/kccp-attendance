# KCCP 출석 — 데스크톱 앱 (macOS .dmg · Windows .exe)

운영 사이트를 그대로 여는 Electron 앱이다. 웹과 같은 코드·같은 서버·같은 DB를 쓰므로
기능·연동·구글 로그인이 웹과 동일하고, 웹이 배포되면 앱도 다음 실행에서 자동으로 최신이 된다.

## 설치 파일 받기
GitHub → Actions → **Desktop apps** → 최신 실행 → Artifacts 에서 `KCCP-macOS`(.dmg) / `KCCP-Windows`(.exe).
`desktop-v*` 태그를 올리면 Releases 에도 올라간다.

## 로컬 실행/빌드
    cd desktop && npm install && npm start
    npm run dist:mac   # macOS 에서만 (.dmg)
    npm run dist:win   # Windows(또는 wine)에서 (.exe)

## 처음 열 때 (서명 안 된 앱)
- macOS: 앱을 우클릭 → 열기 (또는 시스템 설정 → 개인정보 보호 및 보안 → "그래도 열기").
- Windows: SmartScreen 에서 "추가 정보 → 실행".
