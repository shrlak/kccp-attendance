/**
 * KCCP 출석부 → 구글 시트 내보내기.
 *
 * Code.gs(시트 → 출석부)의 반대 방향이다. 키오스크·관리자 화면에서 찍힌 **예배 출석**이
 * 이 스프레드시트에 부서마다 탭 하나씩(`출석부 · 대학부`, `출석부 · 청년부`) 표로 채워진다.
 *
 * 이 스크립트가 하는 일은 **받아 적기뿐이다.** 누구를 담고 어느 칸이 O인지는 서버가 정한다
 * (supabase/functions/attendance-api/sheetExport.ts) — 출석부 탭과 같은 규칙이 한 자리에만
 * 있어야, 규칙을 고칠 때 시트마다 코드를 다시 붙여넣지 않는다.
 *
 * 그 탭들은 **실행할 때마다 통째로 다시 쓰인다.** 그 탭에 손으로 적은 것은 다음 갱신에
 * 사라지므로, 메모나 계산은 다른 탭에서 이 탭을 참조해서 한다. 이 스크립트가 만든 탭 밖은
 * 건드리지 않는다.
 *
 * ── 설치 (스프레드시트마다 한 번) ────────────────────────────────────────────────────
 *  1. 출석을 받을 스프레드시트에서 확장 프로그램 → Apps Script
 *  2. 이 파일 내용을 통째로 붙여넣기
 *  3. 아래 TOKEN에 출석부 관리자 탭 → 설정 → 구글 시트 연동 → '출석부 → 시트 내보내기'의
 *     **내보내기 키**를 넣기 (동산 시트를 읽을 때 쓰는 연동 키와 다른 키다)
 *  4. 위쪽 함수 목록에서 `설치하기`를 고르고 실행 → 권한 허용
 *     이후 10분마다 저절로 갱신되고, 메뉴 '출석부 내보내기 → 지금 가져오기'로 바로 받을 수도 있다.
 *
 * 시트를 공개할 필요는 없다 — 서버가 시트를 읽는 것이 아니라 이 스크립트가 서버를 부른다.
 */

// ── 여기만 채운다 ────────────────────────────────────────────────────────────────────
var TOKEN = '여기에 내보내기 키를 붙여넣으세요';
var ENDPOINT = 'https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api/api/sheet/export';
// 비워 두면 지금 학기(학기 사이에는 지난 학기가 끝난 뒤부터 오늘까지). 지난 학기를 받으려면
// '2026-summer'처럼 적는다 — 그러면 탭 이름에도 그 학기가 붙어 이번 학기 탭과 따로 남는다.
var TERM = '';
// 몇 분마다 갱신할지 (Apps Script가 허용하는 값: 1, 5, 10, 15, 30).
var EVERY_MINUTES = 10;

var TAB_PREFIX = '출석부 · ';

/** 처음 한 번 실행 — 시간 트리거를 걸고 바로 한 번 받아 온다. */
function 설치하기() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === '가져오기') ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('가져오기').timeBased().everyMinutes(EVERY_MINUTES).create();
  var n = 가져오기();
  SpreadsheetApp.getUi().alert('내보내기를 켰습니다. ' + n + '개 탭을 채웠고, 이제 ' + EVERY_MINUTES + '분마다 갱신됩니다.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('출석부 내보내기')
    .addItem('지금 가져오기', '가져오기')
    .addItem('자동 갱신 켜기 (처음 한 번)', '설치하기')
    .addToUi();
}

/** 서버에서 표를 받아 부서마다 탭에 적는다. 적은 탭 수를 돌려준다. */
function 가져오기() {
  if (!TOKEN || TOKEN.indexOf('여기에') === 0) throw new Error('내보내기 키가 아직 비어 있습니다.');
  var url = ENDPOINT + (TERM ? '?term=' + encodeURIComponent(TERM) : '');
  var res = UrlFetchApp.fetch(url, { headers: { 'X-Export-Token': TOKEN }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    // 실패하면 탭을 비우지 않는다 — 지난번 표가 남아 있는 편이 빈 탭보다 낫다.
    throw new Error('출석부 응답 ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  var data = JSON.parse(res.getContentText());
  var ss = SpreadsheetApp.getActive();
  var suffix = TERM ? ' (' + TERM + ')' : '';
  for (var b = 0; b < data.blocks.length; b++) {
    var block = data.blocks[b];
    var name = TAB_PREFIX + (block.group || '부서 미기재') + suffix;
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    적기(sheet, data, block);
  }
  return data.blocks.length;
}

function 적기(sheet, data, block) {
  var dates = data.dates;
  var header = ['이름', '동산', '예배 총 출석'].concat(dates.map(날짜));
  var rows = [header];
  for (var i = 0; i < block.rows.length; i++) {
    var r = block.rows[i];
    rows.push([r.name, r.subgroup, r.total].concat(r.cells));
  }
  rows.push(['총 출석', '', ''].concat(block.totals));

  sheet.clear();
  var width = header.length;
  var range = sheet.getRange(1, 1, rows.length, width);
  // 이름·동산 칸은 글자로 적는다 — 날짜·숫자처럼 보이는 이름이 바뀌지 않게. 총 출석은
  // 숫자로 남겨야 다른 탭에서 계산할 수 있다.
  sheet.getRange(1, 1, rows.length, 2).setNumberFormat('@');
  range.setValues(rows).setHorizontalAlignment('center');
  sheet.getRange(2, 1, rows.length - 1, 2).setHorizontalAlignment('left');

  // 칸 색: O 초록 글자, X 옅은 회색, 상태 표기(방학·귀국 …)는 회색 바탕 — 교회 시트의 모양.
  if (block.rows.length && dates.length) {
    var colors = [], fills = [];
    for (var y = 0; y < block.rows.length; y++) {
      var cRow = [], fRow = [];
      for (var x = 0; x < dates.length; x++) {
        var v = block.rows[y].cells[x];
        cRow.push(v === 'O' ? '#16a34a' : v === 'X' ? '#b0b0b0' : '#555555');
        fRow.push(v && v !== 'O' && v !== 'X' ? '#e5e5e5' : null);
      }
      colors.push(cRow); fills.push(fRow);
    }
    var cells = sheet.getRange(2, 4, block.rows.length, dates.length);
    cells.setFontColors(colors).setBackgrounds(fills);
  }
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#6FA8DC');
  sheet.getRange(rows.length, 1, 1, width).setFontWeight('bold').setBackground('#ede9fe');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  var when = Utilities.formatDate(new Date(data.generatedAt), 'America/New_York', 'yyyy-MM-dd HH:mm');
  sheet.getRange(rows.length + 2, 1).setValue(
    '출석부에서 가져옴 · ' + when + ' · ' + data.start + ' ~ ' + data.end +
    ' · 이 탭은 갱신될 때마다 통째로 다시 쓰입니다').setFontColor('#888888');
}

/** "2026-08-16" → "08/16/2026" (교회 시트의 날짜 모양). */
function 날짜(iso) {
  var p = iso.split('-');
  return p[1] + '/' + p[2] + '/' + p[0];
}
