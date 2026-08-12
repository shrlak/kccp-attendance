/**
 * 동산 출석 구글 시트 → KCCP 출석부 연동.
 *
 * 이 스크립트가 하는 일은 하나뿐이다: **"시트가 바뀌었다"고 서버에 알린다.**
 * 시트를 읽고 해석하는 일은 서버가 한다 (supabase/functions/attendance-api/sheetSync.ts).
 *
 * 왜 여기서 파싱하지 않는가 — 스크립트는 스프레드시트 안에 산다. 여기에 파서를 두면
 * 읽는 규칙을 고칠 때마다 시트마다 사람이 들어가서 코드를 다시 붙여넣어야 하고, 시트가
 * 늘어날수록(학기마다 부서마다 새 시트가 난다) 서로 다른 버전이 돌아다니게 된다. 서버에
 * 두면 배포 한 번으로 모든 시트가 같은 규칙을 쓴다. 그래서 이 파일은 앞으로 거의 바뀌지
 * 않는다 — 아래 두 줄만 채우면 끝이다.
 *
 * ── 설치 (시트마다 한 번) ────────────────────────────────────────────────────────────
 *  1. 출석 시트에서 확장 프로그램 → Apps Script
 *  2. 이 파일 내용을 통째로 붙여넣기
 *  3. 아래 TOKEN에 출석부 관리자 탭 → 설정 → 구글 시트 연동에서 발급한 연동 키를 넣기
 *  4. 위쪽 함수 목록에서 `설치하기`를 고르고 실행 → 권한 허용
 *     (한 번만 하면 된다. 이후 시트가 바뀔 때마다 자동으로 알린다.)
 *
 * 시트 자체는 '링크가 있는 모든 사용자 — 보기' 로 공유되어 있어야 한다. 서버가 그 링크로
 * 시트를 읽기 때문이다. 편집 권한은 주지 않는다 — 연동은 시트를 절대 고치지 않는다.
 */

// ── 여기 두 줄만 채운다 ──────────────────────────────────────────────────────────────
var TOKEN = '여기에 연동 키를 붙여넣으세요';
var ENDPOINT = 'https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api/api/sheet/sync';

// 편집이 멈춘 뒤 몇 초 있다가 보낼지. 한 칸씩 O를 찍어 나가는 동안 매번 보내면 서버가
// 같은 시트를 수십 번 읽게 되므로, 마지막 편집으로부터 이만큼 조용해지면 한 번만 보낸다.
var QUIET_SECONDS = 45;

/** 처음 한 번 실행 — 편집 감지 트리거를 건다. */
function 설치하기() {
  var ss = SpreadsheetApp.getActive();
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) ScriptApp.deleteTrigger(existing[i]);

  // 단순 트리거(onEdit)로는 외부 호출을 할 수 없어서 설치형 트리거를 쓴다.
  ScriptApp.newTrigger('편집됨').forSpreadsheet(ss).onEdit().create();
  // 편집 감지를 놓치는 경우(다른 시트에서 붙여넣기, 오프라인 편집 뒤 동기화 등)를 위한
  // 안전망. 한 시간에 한 번은 어차피 맞춰 본다.
  ScriptApp.newTrigger('동기화').timeBased().everyHours(1).create();

  동기화();
  SpreadsheetApp.getUi().alert('연동을 켰습니다. 이제 이 시트를 고치면 출석부에 반영됩니다.');
}

/** 시트에 메뉴를 붙인다 (수동으로 한 번 보내고 싶을 때). */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('출석부 연동')
    .addItem('지금 동기화', '동기화')
    .addItem('연동 켜기 (처음 한 번)', '설치하기')
    .addToUi();
}

/**
 * 편집이 일어날 때마다 불린다. 바로 보내지 않고 "마지막 편집 시각"만 적어 두고,
 * 조용해진 뒤에 보내는 일회성 트리거를 하나만 예약한다 — 한 사람이 한 줄을 쭉 채우는
 * 동안 서버를 수십 번 부르지 않기 위해서다.
 */
function 편집됨(e) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('lastEdit', String(Date.now()));
  if (props.getProperty('pending') === '1') return; // 이미 예약되어 있다
  props.setProperty('pending', '1');
  ScriptApp.newTrigger('예약분_보내기').timeBased().after(QUIET_SECONDS * 1000).create();
}

/** 예약된 시각에 불린다. 그 사이에 또 고쳤으면 다시 미룬다. */
function 예약분_보내기() {
  var props = PropertiesService.getScriptProperties();
  정리_일회성트리거();
  var last = Number(props.getProperty('lastEdit') || 0);
  if (Date.now() - last < QUIET_SECONDS * 1000) {
    ScriptApp.newTrigger('예약분_보내기').timeBased().after(QUIET_SECONDS * 1000).create();
    return; // 아직 고치는 중이다
  }
  props.deleteProperty('pending');
  동기화();
}

/** 서버에 "이 시트를 다시 읽어라"고 알린다. */
function 동기화() {
  if (!TOKEN || TOKEN.indexOf('여기에') === 0) {
    Logger.log('연동 키가 아직 비어 있습니다.');
    return;
  }
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Sync-Token': TOKEN },
    payload: JSON.stringify({ sourceId: SpreadsheetApp.getActive().getId() }),
    muteHttpExceptions: true,
  });
  Logger.log('동기화 응답 ' + res.getResponseCode() + ': ' + res.getContentText());
}

/** 다 쓴 일회성 트리거를 지운다 (쌓이면 트리거 한도에 걸린다). */
function 정리_일회성트리거() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === '예약분_보내기') ScriptApp.deleteTrigger(triggers[i]);
  }
}
