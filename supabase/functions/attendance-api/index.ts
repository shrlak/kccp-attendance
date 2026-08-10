import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ADULT_GROUP, ADULT_SCHEMA, canViewLoginLog, dbOf, inScope, inScopeGroup, partitionOfGroup, resolveAdmin, scopeFilter, type Partition, type Role, type Scope } from "./auth.ts";
import { DEFAULT_SEMESTER_DATES, isSummerTerm, lastEndedTermKey, mergeSchedule, rollSchedule, sameSchedule, scheduleOf, scheduleToDates, subgroupSnapshot, trimHistory, validSchedule } from "./term.ts";
import { availableCardModels, buildCardRequest, cardModelChain, parseCardResponse } from "./gemini.ts";
// Decrypt-side of the weekly R2 backup pipeline (see scripts/backup/). age-encryption is
// FiloSottile's own pure-JS port of `age` (no native/subprocess dependency, which Deno
// edge functions can't shell out to anyway); postgres.js's .unsafe() with no parameters
// sends the query over the simple protocol, which is what lets a whole multi-statement
// pg_dump script run in one call without a pg_restore binary.
import * as age from "npm:age-encryption@0.3.0";
import postgres from "npm:postgres@3.4.9";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.1090.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.1090.0";

// Allow-Headers MUST list every custom request header the web app sends (web/src/lib/api.ts),
// or the browser's cross-origin preflight blocks the call before it reaches this function.
// The X-Geo-* trio rides along on login when the admin allows the location prompt — omitting
// them silently broke password sign-in for anyone who had granted location.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Device-Id,X-Admin-Password,X-Geo-Lat,X-Geo-Lon,X-Geo-Acc,Authorization,apikey",
};
function localDate() { return new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"}); }
function localTime() { return new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function fmtDateWithDay(d: string) { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric",year:"numeric"}); }
function fmtMin(m: number) { const h=Math.floor(m/60),mn=m%60,h12=h%12||12; return String(h12).padStart(2,"0")+":"+String(mn).padStart(2,"0")+" "+(h>=12?"PM":"AM"); }
function addIsoDays(day: string, amount: number) {
  const date=new Date(day+"T12:00:00Z");
  date.setUTCDate(date.getUTCDate()+amount);
  return date.toISOString().slice(0,10);
}
// Exact Pittsburgh midnight as an epoch, including DST transition days. 05:00 UTC is
// midnight or 01:00 in America/New_York year-round and therefore still carries the
// offset that was active at the beginning of that local calendar day.
function easternDayStartMs(day: string) {
  const probe=new Date(day+"T05:00:00Z");
  const offsetPart=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",timeZoneName:"longOffset"})
    .formatToParts(probe).find((part)=>part.type==="timeZoneName")?.value||"";
  const offset=offsetPart.replace("GMT","");
  if(!/^[+-]\d{2}:\d{2}$/.test(offset)) throw new Error("Could not determine Pittsburgh UTC offset");
  return Date.parse(day+"T00:00:00"+offset);
}

const CHURCH_LAT=40.450218535488325, CHURCH_LNG=-79.93480148825721;
function checkLocation(lat?: number | null, lng?: number | null) {
  if(lat==null||lng==null) return "required";
  const R=6371000,dLat=(lat-CHURCH_LAT)*Math.PI/180,dLng=(lng-CHURCH_LNG)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(CHURCH_LAT*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLng/2)**2;
  const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  return dist>30?Math.round(dist):null;
}

type SB = ReturnType<typeof createClient>;

// ── 부(部)별 데이터베이스 손잡이 ────────────────────────────────────────────────────────
// 대학·청년부는 public, 장년부는 adult 스키마 (마이그레이션 20260807). 사람·기기·출석·권한·
// 설정·감사기록 — 두 부서가 각각 소유하는 것은 전부 이 손잡이를 거쳐 읽고 쓴다. 그래서 조건을
// 빠뜨려도 남의 부서가 나올 수 없다: 그 표에 없기 때문이다.
//
// 여기 없는 표(login_log·ip_geo·gps_geo·events·pending_registrations)는 공용이라 sb를 그대로 쓴다.
//
// 클라이언트를 모듈 변수에 담아 두지 않고 매번 넘기는 이유: 한 아이솔레이트가 요청 여러 개를
// 동시에 처리하므로, 담아 두면 늦게 온 요청이 앞 요청의 부(部)를 덮어쓸 수 있다.
// deno-lint-ignore no-explicit-any
function db(sb: SB, part: Partition): any { return dbOf(sb, part); }

// 설정은 부서마다 자기 스키마의 config 행 하나다. 예전처럼 `_adult` 접미사 칸을 세는 일은
// 없다 — 이름은 양쪽 다 똑같고, 어느 행을 읽느냐만 다르다.
async function getCfg(sb: SB, part: Partition="youth") {
  const {data}=await db(sb,part).from("config").select("*").eq("id",1).single();
  return data||{};
}
// 그 부서에서 기본으로 쓰는 하위 단위 이름 (아직 아무것도 저장하지 않았을 때). 장년부는 이
// 단위를 **셀**이라 부르고 그 이름은 고정이라(학기가 끝나도 지우지 않는다 —
// RESETS_SUBGROUPS_EACH_TERM 참고) 여기 값은 첫 설정 화면의 출발점일 뿐이다.
function defaultDongsanNames(part: Partition): Record<string,string[]> {
  return part==="adult"
    ?{[ADULT_GROUP]:["1셀","2셀","3셀","4셀"]}
    :{"대학부":["동산1","동산2","동산3","동산4"],"청년부":["동산1","동산2","동산3","동산4"]};
}
function defaultGroupColors(part: Partition): Record<string,string> {
  return part==="adult"?{[ADULT_GROUP]:"#10B981"}:{"대학부":"#E0A800","청년부":"#3B82F6"};
}
// 부서 이름을 키로 갖는 지도(동산/셀 이름·동산지기·부서 색)에서 이 부에 속한 키만 남긴다.
// 스키마가 이미 갈라 놓았지만, 오래된 탭이 남의 부서 키를 실어 보내는 것까지 막아 둔다.
function partitionNames<T>(map: Record<string,T>, part: Partition): Record<string,T> {
  const out: Record<string,T>={};
  for(const [g,v] of Object.entries(map||{})) if(partitionOfGroup(g)===part) out[g]=v;
  return out;
}

// ── 부(部) 범위를 쿼리에 거는 두 조각 ─────────────────────────────────────────────────
// 스키마가 부서를 가른 뒤에도 이것이 남아 있는 이유: 리더는 자기 동산/셀만 봐야 하고,
// 부서 조건은 "혹시라도" 잘못 들어온 행에 대한 이중 잠금이다.
// PostgREST의 neq는 NULL 행을 떨어뜨리므로, "장년부만 빼라"는 조건은 "NULL이거나 장년부가
// 아니거나"로 풀어 써야 부서가 비어 있는 예전 행(방문자 등)이 사라지지 않는다.
function excludeGroups(q: any, groups: string[]) {
  for(const g of groups) q=q.or(`group_name.is.null,group_name.neq.${g}`);
  return q;
}
// 이 관리자가 볼 수 있는 행만 남긴다 — members / devices / attendance_log 어디에 걸어도 같다.
function scopeQuery(q: any, scope: Scope) {
  if(scope.all) return excludeGroups(q,scope.exclude);
  q=q.in("group_name",scope.groups);
  if(scope.subgroup) q=q.eq("subgroup",scope.subgroup);
  return q;
}
// "출석 기록 전체 삭제"는 자기 부의 전체다. 출석 행은 찍힐 때의 부서를 함께 들고 있으므로
// 같은 범위 조건을 그대로 쓴다 — 부서가 비어 있는 예전/방문자 행은 대학·청년부 쪽에 남는다.
// deno-lint-ignore no-explicit-any
async function clearPartitionAttendance(pdb: any, scope: Scope) {
  await scopeQuery(pdb.from("attendance_log").delete().neq("id",0),scope);
}

// 여름 모드 = 오늘이 여름학기 안인가. Was an admin toggle (config.summer_mode); it is now
// derived from the saved 학기 일정, so it switches itself on the day 여름학기 starts and off
// the day after it ends. The old column is left in place but never read or written.
// 여름 합동은 대학부·청년부를 하나로 묶는 장치라 장년부에는 존재하지 않는다 — 언제나 꺼짐.
function summerNow(cfg: any, part: Partition="youth") {
  if(part==="adult") return false;
  return isSummerTerm(localDate(),cfg?.semester_dates,cfg?.semester_schedule);
}
// 등록 경로가 받는 장년부 카드 칸들 — 멤버 수정의 ADULT_CARD_COLS와 같은 이름들이다.
// 대학·청년부 표에는 없는 컬럼이라, 그 부의 등록에는 절대 얹지 않는다.
function adultCardFields(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for(const [k,col] of Object.entries(ADULT_CARD_COLS)){
    if(body[k]!==undefined) out[col]=(col==="visit_date")?(body[k]||null):body[k];
  }
  if(Array.isArray(body.family)) out.family=body.family.map((r:any)=>({
    nameKo:String(r?.nameKo??""), nameEn:String(r?.nameEn??""), relation:String(r?.relation??""),
    birthDate:String(r?.birthDate??""), gender:String(r?.gender??""), baptism:String(r?.baptism??""),
  }));
  return out;
}

// 장년부 새교우 방문·등록 카드가 가진 칸들 (마이그레이션 20260808). adult.members에만
// 있는 컬럼이라 멤버 수정에서 **장년부 요청일 때만** 매핑한다. 웹의 짝은 adultCard.ts.
const ADULT_CARD_COLS: Record<string,string>={nameEn:"name_en",phoneHome:"phone_home",email:"email",birthDateRaw:"birth_date_raw",address:"address",city:"city",state:"state",zipCode:"zip_code",attendReason:"attend_reason",registrationChoice:"registration_choice",visitDate:"visit_date",memberNo:"member_no"};

// 봄·여름·가을학기로 한 해를 나누는 부. 장년부는 상반기·하반기 둘로만 나뉘고 그 경계가
// 고정이라, 학기 일정도 학기 종료 롤오버도 없다. 웹의 짝은 partition.ts usesSemesters().
const USES_SEMESTERS: Partition[]=["youth"];
// 2년치 학기 일정을 굴린다: 끝난 학기는 편집 목록에서 빠지고(보관은 유지) 맨 뒤에 다음 학기가
// 붙는다. 바뀐 게 없으면 쓰지 않으므로 매 요청에 불러도 안전하다. 부서마다 자기 일정을 쓴다.
async function maybeRollSchedule(sb: SB, cfg: any, part: Partition="youth") {
  // 장년부에는 학기 일정이라는 것이 없다 — 한 해가 상반기(1–6월)·하반기(7–12월)로 고정이고
  // 설정 탭에 편집기도 뜨지 않는다. 굴릴 목록이 없으니 매 요청마다 손대지 않는다.
  if(!USES_SEMESTERS.includes(part)) return cfg;
  const dates=cfg?.semester_dates, schedule=cfg?.semester_schedule;
  const rolled=rollSchedule(localDate(),dates,schedule);
  if(sameSchedule(rolled,scheduleOf(schedule))) return cfg;
  await db(sb,part).from("config").update({semester_schedule:rolled,updated_at:new Date().toISOString()}).eq("id",1);
  return {...cfg,semester_schedule:rolled};
}
// 상태 표기(한국 귀국 · 방학 …)는 멤버당 여러 개다: [{note,start,end}]. 저장 전에 모양을
// 다듬고(문구 trim, 빈 날짜 → null, 문구 없는 항목 제거) 시작일 순으로 정렬한다.
function cleanStatusMarks(value: unknown): {note:string;start:string|null;end:string|null}[] | null {
  if(!Array.isArray(value)) return null;
  const out: {note:string;start:string|null;end:string|null}[]=[];
  for(const raw of value){
    if(!raw||typeof raw!=="object") continue;
    const mark=raw as {note?:unknown;start?:unknown;end?:unknown};
    const note=typeof mark.note==="string"?mark.note.trim():"";
    if(!note) continue;
    const iso=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;
    const start=iso(mark.start), end=iso(mark.end);
    if(start&&end&&end<start) continue; // 거꾸로 된 기간은 버린다
    out.push({note,start,end});
  }
  return out.sort((a,b)=>(a.start||"").localeCompare(b.start||""));
}
// 예전 단일 컬럼(status_note/start/end)에 mirror 할 표기: 오늘을 덮는 것, 없으면 가장 최근 것.
function currentStatusMark(marks: {note:string;start:string|null;end:string|null}[], today: string) {
  const covering=marks.filter((m)=>m.start&&m.start<=today&&(!m.end||today<=m.end));
  const pick=covering[covering.length-1]??marks[marks.length-1];
  return pick??{note:"",start:null,end:null};
}

// 같은 사람이 다시 등록되면 새 행을 만들지 않고 기존 멤버를 찾아 준다: 이름이 같고 부서도
// 같으면 같은 사람으로 본다. 전화번호나 생년월일이 둘 다 있는데 서로 다르면 동명이인으로
// 보고 병합하지 않는다 (교회 명단은 동명이인을 "김서현(청년부)"처럼 구분해 적는다).
// deno-lint-ignore no-explicit-any
async function findDuplicateMember(pdb: any, name: string, group: string, body: any) {
  const {data}=await pdb.from("members").select("*").eq("name",name);
  const rows=(data||[]) as any[];
  return rows.find((r)=>{
    if(group&&(r.group_name||"")&&r.group_name!==group) return false;
    const phone=(body.phone||"").replace(/\D/g,""), rphone=(r.phone||"").replace(/\D/g,"");
    if(phone&&rphone&&phone!==rphone) return false;
    const birth=(body.birthDate||""), rbirth=(r.birth_date||"");
    if(birth&&rbirth&&birth!==rbirth) return false;
    return true;
  })||null;
}
// 병합 규칙: 나중에 들어온 값이 이긴다. 새 등록이 비워 둔 칸은 기존 값을 그대로 둔다.
// 등록일자만 예외로 더 이른 날짜를 지킨다 — 출석부가 등록일 이전 주일을 빈칸으로 두므로
// 나중 날짜로 덮으면 이미 쌓인 출석이 화면에서 사라진다.
function mergedMemberFields(existing: any, body: any, subgroup: string, today: string) {
  const upd: any={updated_at:new Date().toISOString(),is_new_member:true};
  const put=(col:string,val:unknown)=>{ if(val!==undefined&&val!==null&&val!=="") upd[col]=val; };
  put("group_name",(body.group||"").trim());
  put("subgroup",subgroup);
  put("gender",body.gender); put("phone",body.phone); put("kakao_id",body.kakaoId);
  put("birth_date",body.birthDate); put("baptism_status",body.baptismStatus);
  put("school_or_work",body.schoolOrWork); put("faith_duration",body.faithDuration);
  if(body.pastoralVisitRequested===true||body.pastoralVisitRequested===false) upd.pastoral_visit_requested=body.pastoralVisitRequested;
  const reg=((body.registrationDate||"").trim())||today;
  upd.registration_date=existing.registration_date&&existing.registration_date<reg?existing.registration_date:reg;
  return upd;
}
// 한 동산/셀에 둘 수 있는 부지기 수. 대학·청년부의 동산은 커서 부동산지기 둘이 나눠 맡지만,
// 장년부의 셀은 셀장 한 명·부셀장 한 명으로 고정이다. 웹의 짝은 partition.ts subLeaderSlots().
const SUB_LEADER_SLOTS: Record<Partition, number> = { youth: 2, adult: 1 };


// 학기가 끝나면 동산을 없애고 모두를 동산에서 뺀다 — 한 학기당 정확히 한 번, 학기가 끝난
// 다음 첫 요청에서. 지우기 전에 그 학기의 편성(+동산 이름/동산지기)을 config.dongsan_history에
// 얼려두므로, 지난 학기 출석부는 그대로 동산별로 남는다. 출석 기록(attendance_log)의 동산
// 표기는 그 주일의 사실이므로 건드리지 않는다.
//
// dongsan_reset_term이 비어 있는 첫 관측(이 기능의 배포 직후)에는 초기화하지 않고 표식만
// 남긴다 — 배포 시점에 이미 끝나 있던 학기 때문에 학기 도중 편성이 지워지면 안 되므로.
// 갱신된 config를 돌려주니 호출부는 그대로 이어서 쓰면 된다.
//
// 부서별로 따로 돈다: 장년부의 학기 일정·표식·기록은 자기 칸(_adult)에 있고, 편성을 비울 때도
// 자기 부서 멤버/기기만 건드린다 — 한쪽 학기가 끝났다고 다른 쪽 편성이 지워지면 안 되므로.
//
// **장년부(셀)는 초기화하지 않는다.** 대학·청년부의 동산은 학기마다 새로 짜는 것이지만, 장년부의
// 셀은 이름도 소속도 고정이고 바뀌는 것은 셀장·부셀장뿐이다 (그것도 학기와 무관하게, 부서가
// 정할 때). 그래서 장년부는 스냅숏만 뜨고 — 지난 학기 출석부가 그 시점의 셀 편성으로 고정되도록 —
// 이름·셀장·멤버 배정은 그대로 둔다. 이 한 줄이 CELL_PARTITIONS다.
const RESETS_SUBGROUPS_EACH_TERM: Partition[]=["youth"];
async function rolloverDongsan(sb: SB, cfg: any, part: Partition="youth") {
  // 학기가 없는 부에는 학기 종료도 없다. 장년부의 셀은 이름도 소속도 고정이라 비울 것이
  // 없고(RESETS_SUBGROUPS_EACH_TERM), 얼려 둘 편성도 늘 같으니 스냅숏도 뜨지 않는다.
  if(!USES_SEMESTERS.includes(part)) return cfg;
  const pdb=db(sb,part);
  const key=lastEndedTermKey(localDate(),cfg?.semester_dates);
  const marker="dongsan_reset_term";
  if(!key||cfg?.[marker]===key) return cfg;
  if(!cfg?.[marker]){
    await pdb.from("config").update({[marker]:key}).eq("id",1);
    return {...cfg,[marker]:key};
  }
  const clears=RESETS_SUBGROUPS_EACH_TERM.includes(part);
  // 부서를 조건으로 거르지 않는다 — 이 스키마에는 이 부서 사람만 있다.
  const {data:members}=await pdb.from("members").select("id,subgroup");
  const subgroups=subgroupSnapshot((members||[]) as {id:string;subgroup?:string|null}[]);
  const ts=new Date().toISOString();
  // 스냅숏은 두 부서 모두 남긴다: 셀이 고정이더라도 누군가 셀을 옮기면 지난 학기 출석부가
  // 그 사람을 새 셀에 그리게 되므로, 그때의 편성을 얼려 두는 것이 여전히 옳다.
  const history=trimHistory({
    ...(cfg?.dongsan_history||{}),
    [key]:{endedAt:localDate(),subgroups,names:cfg?.dongsan_names||{},leaders:cfg?.dongsan_leaders||{}},
  });
  const upd: any={dongsan_history:history,[marker]:key,updated_at:ts};
  if(clears){
    await pdb.from("members").update({subgroup:"",updated_at:ts}).neq("subgroup","");
    await pdb.from("devices").update({subgroup:""}).neq("subgroup","");
    upd["dongsan_names"]={};
    upd["dongsan_leaders"]={};
  }
  await pdb.from("config").update(upd).eq("id",1);
  await addAudit(pdb,"term-rollover","system",
    key+(clears?" 학기 종료 — 동산 편성 해제 ("+Object.keys(subgroups).length+"명)"
               :" 학기 종료 — 셀 편성 보존, 스냅숏만 저장 ("+Object.keys(subgroups).length+"명)"),part);
  return {...cfg,...upd};
}
async function isAdmin(sb: SB, did: string) {
  const cfg=await getCfg(sb); const ads: any[]=cfg.admin_devices||[];
  if(!ads.length) return true;
  if(ads.some((d:any)=>typeof d==="string"?d===did:d.deviceId===did)) return true;
  const {data:dev}=await sb.from("devices").select("name").eq("id",did).single();
  if(!dev?.name) return false;
  const peers=await getDevsByName(sb,dev.name);
  return peers.some(pid=>ads.some((d:any)=>typeof d==="string"?d===pid:d.deviceId===pid));
}
async function isSuperAdmin(sb: SB, did: string) {
  const cfg=await getCfg(sb); const ads: any[]=cfg.admin_devices||[];
  if(!ads.length) return true;
  let entry=ads.find((d:any)=>typeof d==="string"?d===did:d.deviceId===did);
  if(!entry) {
    const {data:dev}=await sb.from("devices").select("name").eq("id",did).single();
    if(dev?.name) {
      const peers=await getDevsByName(sb,dev.name);
      entry=ads.find((d:any)=>peers.includes(typeof d==="string"?d:d.deviceId));
    }
  }
  if(!entry) return false;
  return typeof entry==="string"||(entry.role||"super")==="super";
}
function rowToDev(d: any) {
  return {
    name:d.name,
    group:d.group_name||"",
    subgroup:d.subgroup||"",
    notes:d.notes||"",
    memberRole:d.member_role||"",
    gender:d.gender||"",
    phone:d.phone||"",
    birthDate:d.birth_date||"",
    baptismStatus:d.baptism_status||"해당없음",
    schoolOrWork:d.school_or_work||"",
    faithDuration:d.faith_duration||"",
    registrationDate:d.registration_date||"",
    pastoralVisitRequested:d.pastoral_visit_requested||false,
    isNewMember:d.is_new_member||false,
    newMemberEduWeek1:d.new_member_edu_week1||false,
    newMemberEduWeek2:d.new_member_edu_week2||false,
    kakaoId:d.kakao_id||"",
  };
}
function rowToLog(e: any) { return {id:e.id,memberId:e.member_id,deviceId:e.device_id,name:e.name,group:e.group_name||"",subgroup:e.subgroup||"",date:e.date,time:e.time_str,ts:e.ts,locationVerified:e.location_verified,adminAdded:e.admin_added,manual:e.is_manual,bulk:e.is_bulk,guest:e.is_guest,firstVisit:e.first_visit,memberRole:e.member_role}; }
// deno-lint-ignore no-explicit-any
async function getDevsByName(pdb: any, name: string): Promise<string[]> { const {data}=await pdb.from("devices").select("id").eq("name",name); return (data||[]).map((d:any)=>d.id); }
// When a real device is added for a member, it supersedes any ROSTER-… placeholder rows
// for that same name (seeded roster stubs with no real device). The placeholder's MEMBER
// IDENTITY is inherited onto the new personal device (so any member_roles grant on that
// member becomes usable from the personal device — e.g. a 동산지기/super whose only record
// was a ROSTER stub can now sign in), its attendance history is migrated, the legacy
// admin_devices entry is remapped, and the placeholders are deleted so the member has a
// single canonical device record. No-op unless devId is a personal (non-ROSTER) id and
// ROSTER- stubs for the name exist.
// deno-lint-ignore no-explicit-any
async function supersedeRosterPlaceholders(pdb: any, name: string, devId: string) {
  const sb=pdb; // 이 함수가 만지는 표(devices·attendance_log·config)는 전부 그 부서의 것이다.
  if(!name||!devId||devId.startsWith("ROSTER-")) return;
  const {data:rows}=await sb.from("devices").select("id,member_id").eq("name",name).like("id","ROSTER-%");
  const stubs=(rows||[]).filter((r:any)=>r.id!==devId);
  const rosterIds=stubs.map((r:any)=>r.id);
  if(!rosterIds.length) return;
  // Inherit the member identity from the placeholder so the personal device maps to the
  // same member (and inherits any member_roles grant). Only set it when the device isn't
  // already linked — the admin device/register|link paths set member_id explicitly.
  const inheritedMember=stubs.map((r:any)=>r.member_id).find((m:any)=>m)||null;
  if(inheritedMember){
    const {data:curDev}=await sb.from("devices").select("member_id").eq("id",devId).single();
    if(!(curDev as {member_id?:string}|null)?.member_id){
      await sb.from("devices").update({member_id:inheritedMember}).eq("id",devId);
    }
  }
  // Move any attendance logged under the placeholders onto the real device.
  await sb.from("attendance_log").update({device_id:devId}).in("device_id",rosterIds);
  // Transfer any admin-role grant from a placeholder to the DEV device (keeping the
  // DEV entry if it already has one), then drop the placeholder admin entries.
  const cfg=await getCfg(sb); const ads: any[]=cfg.admin_devices||[];
  if(ads.length){
    const devHasEntry=ads.some((d:any)=>(typeof d==="string"?d:d.deviceId)===devId);
    let changed=false;
    const next: any[]=[];
    for(const d of ads){
      const did=typeof d==="string"?d:d.deviceId;
      if(rosterIds.includes(did)){
        changed=true;
        if(!devHasEntry && !next.some((e:any)=>(typeof e==="string"?e:e.deviceId)===devId)){
          next.push(typeof d==="string"?devId:{...d,deviceId:devId});
        }
        continue; // drop the placeholder entry
      }
      next.push(d);
    }
    if(changed) await sb.from("config").update({admin_devices:next}).eq("id",1);
  }
  await sb.from("devices").delete().in("id",rosterIds);
}
async function countAtt(sb: SB, name: string): Promise<number> {
  const dids=await getDevsByName(sb,name); if(!dids.length) return 0;
  const {data}=await sb.from("attendance_log").select("date").in("device_id",dids);
  return new Set((data||[]).map((e:any)=>e.date)).size;
}
// Is `name` the 동산지기/부동산지기 of their 동산 (the display roster in config.dongsan_leaders)?
// Used to exclude such leaders from bulk-동산 reassignment (super-admins + non-동산지기 leaders only).
function isDongsanLeaderName(name: string, group: string, subgroup: string, leaders: any, summer: boolean): boolean {
  if(!name||!subgroup||!leaders) return false;
  const entry = summer ? (leaders["합동"]&&leaders["합동"][subgroup]) : (group&&leaders[group]&&leaders[group][subgroup]);
  if(!entry) return false;
  return entry.leader===name || (Array.isArray(entry.subLeaders)&&entry.subLeaders.includes(name));
}
async function checkedToday(sb: SB, name: string, today: string) {
  const dids=await getDevsByName(sb,name); if(!dids.length) return null;
  const {data}=await sb.from("attendance_log").select("*").in("device_id",dids).eq("date",today).limit(1);
  return data&&data.length?data[0]:null;
}
// 감사 기록도 부서마다 자기 스키마의 audit_log에 쌓인다 — 그러니 관리자 탭은 조건 없이 읽어도
// 자기 부의 일만 본다. **첫 인자는 부(部)에 묶인 손잡이(db(sb,part))이지 원본 클라이언트가
// 아니다**: 그래야 기록이 남의 스키마로 새지 않는다. 마지막 인자 part는 표시용 문구에만 쓴다.
// deno-lint-ignore no-explicit-any
async function addAudit(pdb: any, action: string, adminId: string, details: any, _part?: Partition) {
  try {
    const {data:d}=await pdb.from("devices").select("name").eq("id",adminId).single();
    const {error}=await pdb.from("audit_log").insert({
      ts:Date.now(),action,admin_id:adminId,admin_name:d?.name||adminId,
      details:typeof details==="string"?{info:details}:details,
    });
    return !error;
  } catch(_){return false;}
}
// R2 access for the db-backup list/download/restore endpoints (scripts/backup/ writes
// here on its own schedule; these just read). Returns null when the edge-function-side R2
// secrets haven't been configured yet, so callers can fail with a clear setup message
// instead of a raw SDK error.
function r2Bucket() { return Deno.env.get("R2_BUCKET")||"kccp-attendance-backups"; }
// 부서마다 자기 백업 줄기를 갖는다. 대학·청년부는 예전 그대로 backups/ (데이터베이스 전체를
// 담는 재해복구 스냅숏), 장년부는 backups/adult/ 에 장년부 데이터만 담긴 별도 파일이 쌓인다.
// 목록·다운로드·복원 모두 로그인한 부서의 접두사만 본다.
function r2Prefix(part: Partition) { return part==="adult"?"backups/adult/":"backups/"; }
// backups/current.sql.age · backups/adult/current.sql.age 같은 키만 허용 (경로 탈출 차단).
function backupKeyRe(part: Partition) {
  const p=r2Prefix(part).replace(/\//g,"\\/");
  return new RegExp("^"+p+"(?:current|backup-\\d{4}-\\d{2}-\\d{2})\\.(sql\\.age|schema\\.tar\\.gz\\.age)$");
}
// 백업 워크플로에 넘기는 입력 — 어느 부서의 백업을 뜰지.
function backupWorkflowInputs(part: Partition) { return {partition:part==="adult"?"adult":"youth"}; }

// ── 복원이 되돌리는 범위 ──────────────────────────────────────────────────────────────
// 부서마다 자기 스키마를 통째로 갖고 있으므로 복원도 스키마 단위다: 그 스키마의 표를 전부
// 비우고 백업의 INSERT를 그대로 흘려 넣으면 끝이다. 시퀀스도 그 스키마 것이라 RESTART
// IDENTITY가 그대로 통한다 — 예전처럼 부서 조건으로 골라 지우고 시퀀스를 손으로 밀 필요가 없다.
// 스키마 이름은 식별자라 파라미터로 넘길 수 없어 상수로 둔다 (사용자 입력이 닿지 않는다).
function restoreWipeSql(part: Partition): string {
  const schema=part==="adult"?ADULT_SCHEMA:"public";
  return `DO $$
DECLARE tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO tables FROM pg_tables WHERE schemaname = '${schema}';
  IF tables IS NULL THEN RAISE EXCEPTION 'No tables found in schema ${schema}'; END IF;
  EXECUTE 'TRUNCATE ' || tables || ' RESTART IDENTITY CASCADE';
END $$;`;
}
function r2Client(): InstanceType<typeof S3Client> | null {
  const endpoint=Deno.env.get("R2_ENDPOINT"), accessKeyId=Deno.env.get("R2_ACCESS_KEY_ID"), secretAccessKey=Deno.env.get("R2_SECRET_ACCESS_KEY");
  if(!endpoint||!accessKeyId||!secretAccessKey) return null;
  return new S3Client({region:"auto",endpoint,credentials:{accessKeyId,secretAccessKey}});
}
// The backup bucket's storage allowance, shown as a usage bar in the Admins tab. R2's
// free tier includes 10 GB-month of standard storage; override with R2_STORAGE_LIMIT_GB
// if the bucket ever moves to a paid class. Decimal GB to match the web's formatBytes.
function r2StorageLimitBytes(): number {
  const gb=Number(Deno.env.get("R2_STORAGE_LIMIT_GB")||"10");
  return Math.round((Number.isFinite(gb)&&gb>0?gb:10)*1e9);
}
// ── Auto-backup on data change ──────────────────────────────────────────────
// Every successful non-GET request (i.e. anything that can mutate data) tries to
// dispatch the off-site backup workflow, coalesced to at most one run per cooldown
// window: a compare-and-set UPDATE on config.last_auto_backup_at is the claim, so
// Sunday check-in bursts produce a single run and concurrent isolates can't
// double-dispatch. The weekly Sunday cron remains the guaranteed floor.
// Excluded paths: verify (login only), the backup endpoints themselves, and both
// restore flows — auto-backing-up right after restoring an older snapshot would
// overwrite current.* in R2 with pre-restore-era data and destroy the newer copy.
// 두 부서는 백업도 따로 돈다: 청구권(claim) 칸도(last_auto_backup_at / _adult), 워크플로에
// 넘기는 partition 입력도, 결과가 쌓이는 R2 접두사도 각자 것이다. 그래서 장년부에서 출석을
// 찍어도 대학·청년부 백업이 돌지 않고, 그 반대도 마찬가지다.
const AUTO_BACKUP_EXCLUDE=[/^\/api\/admin\/verify$/,/^\/api\/admin\/db-backup\//,/^\/api\/admin\/restore$/,/^\/api\/admin\/extract-card$/,/^\/api\/share\//];
async function maybeAutoBackup(sb:any,p:string,part:Partition): Promise<void> {
  if(AUTO_BACKUP_EXCLUDE.some((re)=>re.test(p))) return;
  const pat=Deno.env.get("GITHUB_PAT"); if(!pat) return;
  const cooldownMin=Number(Deno.env.get("AUTO_BACKUP_COOLDOWN_MIN")||"60");
  if(!(Number.isFinite(cooldownMin)&&cooldownMin>0)) return; // 0/invalid disables auto-backup
  const claimCol="last_auto_backup_at";
  const cutoff=new Date(Date.now()-cooldownMin*60_000).toISOString();
  const {data:claimed}=await db(sb,part).from("config").update({[claimCol]:new Date().toISOString()})
    .eq("id",1).or(`${claimCol}.is.null,${claimCol}.lt.${cutoff}`).select("id");
  if(!claimed?.length) return; // within cooldown, or another isolate holds the claim
  const res=await fetch("https://api.github.com/repos/shrlak/kccp-attendance/actions/workflows/backup.yml/dispatches",{
    method:"POST",
    headers:{"Authorization":"Bearer "+pat,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},
    body:JSON.stringify({ref:"main",inputs:backupWorkflowInputs(part)}),
  });
  if(!res.ok) console.error("auto-backup dispatch failed ("+res.status+")");
}
// Fire-and-forget wrapper: the response must never wait on (or fail because of) the
// backup dispatch. EdgeRuntime.waitUntil keeps the isolate alive until it settles.
function scheduleAutoBackup(sb:any,p:string,part:Partition): void {
  const task=maybeAutoBackup(sb,p,part).catch((e)=>console.error("auto-backup error",e));
  try{(globalThis as any).EdgeRuntime?.waitUntil?.(task);}catch(_){/* best effort */}
}

const SEMESTER_SEASONS=["spring","summer","fall"] as const;
function monthDayNumber(value: unknown): number | null {
  if(typeof value!=="string"||!/^\d{2}-\d{2}$/.test(value)) return null;
  const [month,day]=value.split("-").map(Number);
  const date=new Date(Date.UTC(2001,month-1,day));
  if(date.getUTCFullYear()!==2001||date.getUTCMonth()!==month-1||date.getUTCDate()!==day) return null;
  return month*100+day;
}
function validSemesterDates(value: unknown): boolean {
  if(!value||typeof value!=="object"||Array.isArray(value)) return false;
  const ranges=value as Record<string,{start?:unknown;end?:unknown}>;
  const nums=SEMESTER_SEASONS.map((season)=>({start:monthDayNumber(ranges[season]?.start),end:monthDayNumber(ranges[season]?.end)}));
  if(nums.some((range)=>range.start===null||range.end===null)) return false;
  const [spring,summer,fall]=nums as {start:number;end:number}[];
  return spring.start<=spring.end&&spring.end<summer.start&&summer.start<=summer.end&&summer.end<fall.start&&fall.start<=fall.end;
}
// Card-photo-registration (/api/admin/extract-card) usage for the current Pittsburgh
// calendar day. Every extraction attempt is audited before the first fetch(), so failed
// provider responses and network failures count just like successful ones.
// The allowance is fixed at the Gemini free-tier daily maximum for gemini-2.5-flash
// (250 requests/day) — not admin-configurable; the providers' own 429s cover the rest.
const CARD_SCAN_DAILY_LIMIT=250;
// How far down the free-model fallback chain one request may walk, and how long any
// single model gets, so a chain of retries still fits the client's 60s budget.
const CARD_MODEL_ATTEMPTS=4,CARD_MODEL_TIMEOUT_MS=20_000;
async function cardScanUsage(sb: SB): Promise<{limit:number;used:number;remaining:number;day:string;resetsAt:number;updatedAt:number}> {
  const limit=CARD_SCAN_DAILY_LIMIT;
  const day=localDate();
  const startsAt=easternDayStartMs(day),resetsAt=easternDayStartMs(addIsoDays(day,1));
  // 한도는 부서가 아니라 하나뿐인 무료 API 키에 걸린다 — 두 스키마의 시도를 합쳐서 센다.
  const counts=await Promise.all((["youth","adult"] as Partition[]).map((part)=>
    db(sb,part).from("audit_log").select("id",{count:"exact",head:true})
      .eq("action","extract-card").gte("ts",startsAt).lt("ts",resetsAt)));
  for(const c of counts) if(c.error) throw new Error(c.error.message);
  const used=counts.reduce((n:number,c:any)=>n+(c.count||0),0);
  return {limit,used,remaining:Math.max(0,limit-used),day,resetsAt,updatedAt:Date.now()};
}
// Client IP as seen by the edge runtime: first hop of X-Forwarded-For (Supabase's proxy
// appends its own hops after the client), else the CDN/proxy single-IP headers.
function clientIp(req: Request): string {
  const xf=req.headers.get("x-forwarded-for")||"";
  if(xf) return xf.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"";
}
// Record a successful admin sign-in (login_log, read via /api/admin/login-log). The web
// app re-sends the saved password through /api/admin/verify on every page reload, so an
// identical repeat (same role+member+device+ip+method) within an hour is collapsed into
// the original entry instead of flooding the log. Best-effort: a logging failure must
// never block the login itself.
async function addLoginLog(sb: SB, req: Request, role: {role:string;memberId:string;partition:Partition}) {
  try {
    const ip=clientIp(req);
    const deviceId=req.headers.get("x-device-id")||req.headers.get("X-Device-Id")||"";
    const method=(req.headers.get("authorization")||"").startsWith("Bearer ")?"google":"password";
    let memberName="";
    if(role.memberId){
      // login_log 자체는 부서를 가리지 않는 시스템 기록(공용 표)이지만, 이름은 그 사람이
      // 실제로 사는 스키마에서 찾아야 한다.
      const {data:m}=await db(sb,role.partition).from("members").select("name").eq("id",role.memberId).single();
      memberName=(m as {name?:string}|null)?.name||"";
    }
    // Precise device-GPS coordinates, sent by the web app only when the admin allowed the
    // browser location prompt at login (X-Geo-*). Absent/denied → NULL, and the login-log
    // viewer falls back to the city-level IP estimate. Parsed defensively.
    const num=(h:string)=>{const v=parseFloat(req.headers.get(h)||"");return Number.isFinite(v)?v:null;};
    const gpsLat=num("x-geo-lat"),gpsLon=num("x-geo-lon"),gpsAcc=num("x-geo-acc");
    const now=Date.now();
    const {data:last}=await sb.from("login_log").select("ts")
      .eq("role",role.role).eq("member_name",memberName).eq("device_id",deviceId).eq("ip",ip).eq("method",method)
      .order("ts",{ascending:false}).limit(1);
    if(last&&last.length&&now-((last[0] as {ts:number}).ts)<60*60*1000) return;
    await sb.from("login_log").insert({ts:now,role:role.role,member_id:role.memberId||null,member_name:memberName,device_id:deviceId,ip,method,user_agent:req.headers.get("user-agent")||"",gps_lat:gpsLat,gps_lon:gpsLon,gps_accuracy:gpsAcc});
  } catch(_){}
}

// Reverse-geocode GPS coordinates → a street-level address, via the gps_geo cache (see the
// 20260726 migration), filling misses from OpenStreetMap's Nominatim (HTTPS, keyless).
// Keyed by coords rounded to 5 decimals (~1 m). Resolved sequentially and capped per read
// to respect Nominatim's ≤1 req/sec policy; uncached leftovers resolve on a later load.
// Best-effort: the exact coordinates + map link already convey the precise location, so a
// geocoder failure only omits the prose address, it never blocks the log.
function coordKey(lat:number,lon:number):string { return lat.toFixed(5)+","+lon.toFixed(5); }
async function gpsAddresses(sb: SB, coords: {lat:number;lon:number}[]): Promise<Record<string,string>> {
  const out: Record<string,string>={};
  const keys=[...new Set(coords.map((c)=>coordKey(c.lat,c.lon)))];
  if(!keys.length) return out;
  const {data:cached}=await sb.from("gps_geo").select("*").in("coord_key",keys);
  (cached||[]).forEach((g:any)=>{out[g.coord_key]=g.address||"";});
  const missing=coords.filter((c)=>!(coordKey(c.lat,c.lon) in out)).slice(0,6);
  for(const c of missing){
    const key=coordKey(c.lat,c.lon);
    if(key in out) continue;
    try {
      const u="https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat="+encodeURIComponent(c.lat)+"&lon="+encodeURIComponent(c.lon);
      const res=await fetch(u,{headers:{"User-Agent":"kccp-attendance/1.0 (church attendance app)"},signal:AbortSignal.timeout(4000)});
      if(!res.ok){await new Promise((r)=>setTimeout(r,1100));continue;}
      const j=await res.json();
      const address=typeof j?.display_name==="string"?j.display_name:"";
      out[key]=address;
      await sb.from("gps_geo").upsert({coord_key:key,address});
    } catch(_){}
    await new Promise((r)=>setTimeout(r,1100)); // Nominatim: ≤1 req/sec
  }
  return out;
}

// IP → approximate place for the login log, via the ip_geo cache (see the 20260725
// migration), filling misses from ipwho.is (HTTPS, keyless). City-level at best — an IP
// can never yield a GPS-exact position. Lookups are capped per request so a cold cache
// can't stall the response; uncached leftovers resolve on later loads. A success:false
// answer (private/reserved IP) is cached as an empty row so it isn't retried forever,
// while a network failure stays uncached to retry next time.
interface IpGeo { city:string; region:string; country:string; lat:number|null; lon:number|null; org:string }
async function geoForIps(sb: SB, ips: string[]): Promise<Record<string,IpGeo>> {
  const out: Record<string,IpGeo>={};
  const distinct=[...new Set(ips.filter(Boolean))];
  if(!distinct.length) return out;
  const {data:cached}=await sb.from("ip_geo").select("*").in("ip",distinct);
  (cached||[]).forEach((g:any)=>{out[g.ip]={city:g.city||"",region:g.region||"",country:g.country||"",lat:g.lat??null,lon:g.lon??null,org:g.org||""};});
  const missing=distinct.filter((ip)=>!(ip in out)).slice(0,25);
  await Promise.all(missing.map(async (ip)=>{
    try {
      const res=await fetch("https://ipwho.is/"+encodeURIComponent(ip),{signal:AbortSignal.timeout(4000)});
      if(!res.ok) return;
      const j=await res.json();
      const geo: IpGeo=j?.success
        ?{city:j.city||"",region:j.region||"",country:j.country||"",lat:typeof j.latitude==="number"?j.latitude:null,lon:typeof j.longitude==="number"?j.longitude:null,org:j.connection?.org||j.connection?.isp||""}
        :{city:"",region:"",country:"",lat:null,lon:null,org:""};
      out[ip]=geo;
      await sb.from("ip_geo").upsert({ip,...geo});
    } catch(_){}
  }));
  return out;
}

async function buildCsvLog(sb: SB, gf: string, sf: string) {
  const [{data:logs},{data:devs}]=await Promise.all([
    (()=>{let q:any=(sb.from("attendance_log").select("*").order("ts",{ascending:false}));if(gf)q=q.eq("group_name",gf);if(sf)q=q.eq("subgroup",sf);return q;})(),
    (sb.from("devices").select("*"))
  ]);
  const dm: Record<string,any>={}; (devs||[]).forEach((d:any)=>{dm[d.id]=d;});
  const allLogs=(await (sb.from("attendance_log").select("device_id,name,date"))).data||[];
  const nt: Record<string,Set<string>>={};
  for(const e of allLogs){const nm=dm[e.device_id]?.name||e.name||"";if(!nt[nm])nt[nm]=new Set();nt[nm].add(e.date);}
  const h=["Name","Group","Subgroup","Day","Date","Time","Total"];
  const r=(logs||[]).map((e:any)=>{ const dv=dm[e.device_id]; const nm=dv?.name||e.name||""; const day=new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{timeZone:"America/New_York",weekday:"long"}); return [nm,dv?.group_name||e.group_name||"",dv?.subgroup||e.subgroup||"",day,e.date,e.time_str||"",nt[nm]?.size||0]; });
  const q='"',qq='""';
  return [h,...r].map((row:any[])=>row.map((c:any)=>q+String(c).replace(/"/g,qq)+q).join(",")).join("\n");
}
async function buildCsvGrid(sb: SB, gf: string, sf: string) {
  let dq: any=(sb.from("devices").select("*")); if(gf) dq=dq.eq("group_name",gf); if(sf) dq=dq.eq("subgroup",sf);
  const {data:devs}=await dq;
  const members: Record<string,{group:string;subgroup:string;devices:string[]}>={};
  (devs||[]).forEach((d:any)=>{if(!members[d.name])members[d.name]={group:d.group_name||"",subgroup:d.subgroup||"",devices:[]};members[d.name].devices.push(d.id);});
  const names=Object.keys(members).sort();
  let lq: any=(sb.from("attendance_log").select("*").order("date",{ascending:true})); if(gf) lq=lq.eq("group_name",gf); if(sf) lq=lq.eq("subgroup",sf);
  const {data:logs}=await lq;
  const dates=[...new Set((logs||[]).map((e:any)=>e.date as string))].sort();
  const h=["Name","Group","Subgroup","Total",...dates.map(fmtDateWithDay)];
  const r=names.map((name:string)=>{ const dids=members[name].devices; const total=dates.filter((d:string)=>(logs||[]).find((e:any)=>dids.includes(e.device_id)&&e.date===d)).length; return [name,members[name].group,members[name].subgroup,total,...dates.map((d:string)=>{const e=(logs||[]).find((x:any)=>dids.includes(x.device_id)&&x.date===d);return e?e.time_str:"";})]; });
  const q='"',qq='""';
  return [h,...r].map((row:any[])=>row.map((c:any)=>q+String(c).replace(/"/g,qq)+q).join(",")).join("\n");
}

function buildReportHtml(names: string[], dates: string[], members: Record<string,any>, logs: any[], periodLabel: string, gf: string, sf: string): string {
  const CSS='*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;font-size:12px;color:#111;background:#fff;padding:24px}h1{font-size:20px;font-weight:800;margin-bottom:4px}.sub{font-size:13px;color:#555;margin-bottom:20px}.stats{display:flex;gap:16px;margin-bottom:20px}.stat{background:#f5f5f5;border-radius:8px;padding:10px 16px;text-align:center}.stat b{display:block;font-size:22px;font-weight:800}.stat span{font-size:10px;color:#777;text-transform:uppercase;letter-spacing:.8px}table{width:100%;border-collapse:collapse;font-size:11px}th{padding:6px 8px;background:#4a2d87;color:#fff;font-size:10px;white-space:nowrap;text-align:center}th.nc{text-align:left;min-width:110px}td{padding:5px 8px;border:1px solid #e5e5e5;text-align:center}td.nc{text-align:left;font-weight:600;font-size:12px;border-right:2px solid #ccc}td.tc{font-weight:700;background:#fafaf8}td.pc{color:#16a34a;font-weight:700}td.ac{color:#ccc}tr:nth-child(even) td{background:#fafaf8}tr.tot td{background:#ede9fe!important;font-weight:700;border-top:2px solid #7c3aed;color:#5b21b6}.btn{display:inline-block;margin-top:16px;padding:8px 20px;background:#6d28d9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700}@media print{.btn{display:none}}';
  const totalByDate: number[]=[];
  for(const d of dates) { const s=new Set<string>(); logs.filter((e:any)=>e.date===d).forEach((e:any)=>s.add(e.name||"")); totalByDate.push(s.size); }
  let gridRows="";
  for(const name of names) {
    const dids=members[name].devices;
    // Only dates on/after the member's 등록일자 count toward their total and 출석률;
    // earlier dates render as blank (not absent).
    const reg=members[name].regDate||"";
    const mdates=reg?dates.filter((d:string)=>d>=reg):dates;
    const total=mdates.filter((d:string)=>logs.find((e:any)=>dids.includes(e.device_id)&&e.date===d)).length;
    const rate=mdates.length?Math.round(total/mdates.length*100):0;
    const rc=rate>=80?"#16a34a":rate>=60?"#d97706":"#dc2626";
    let row='<tr><td class="nc">'+name+'</td><td>'+members[name].group+(members[name].subgroup?' / '+members[name].subgroup:'')+'</td><td class="tc">'+total+'</td><td class="tc" style="color:'+rc+'">'+rate+'%</td>';
    for(const d of dates) { if(reg&&d<reg){row+='<td class="ac"></td>';continue;} const e=logs.find((x:any)=>dids.includes(x.device_id)&&x.date===d); row+=e?'<td class="pc">&#x2713;</td>':'<td class="ac">&mdash;</td>'; }
    gridRows+=row+'</tr>';
  }
  const totalRow='<tr class="tot"><td class="nc">TOTAL</td><td></td><td></td><td></td>'+totalByDate.map((n:number)=>'<td class="tc">'+n+'</td>').join('')+'</tr>';
  const dateHdrs=dates.map((d:string)=>'<th>'+fmtDateWithDay(d).replace(/, \d{4}/,'')+'</th>').join('');
  const tableHtml=names.length&&dates.length
    ?'<div style="overflow-x:auto"><table><thead><tr><th class="nc">이름</th><th>그룹</th><th class="tc">합계</th><th class="tc">출석률</th>'+dateHdrs+'</tr></thead><tbody>'+gridRows+totalRow+'</tbody></table></div>'
    :'<p style="color:#999;margin-top:16px;">출석 기록이 없습니다.</p>';
  const groupLabel=(gf?' &middot; '+gf:'')+(sf?' / '+sf:'');
  const genTime=new Date().toLocaleString("ko-KR",{timeZone:"America/New_York"});
  const avg=dates.length?Math.round(totalByDate.reduce((a:number,b:number)=>a+b,0)/dates.length):0;
  const statsHtml='<div class="stats"><div class="stat"><b>'+names.length+'</b><span>멤버 수</span></div><div class="stat"><b>'+dates.length+'</b><span>주일 수</span></div><div class="stat"><b>'+logs.length+'</b><span>총 출석</span></div><div class="stat"><b>'+avg+'</b><span>평균 출석</span></div></div>';
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>KCCP 출석 보고서</title><style>'+CSS+'</style></head><body><h1>&#x1F4CA; KCCP 출석 보고서</h1><div class="sub">기간: '+periodLabel+groupLabel+' &nbsp;&middot;&nbsp; 생성: '+genTime+'</div>'+statsHtml+tableHtml+'<button class="btn" onclick="window.print()">&#x1F5A8; PDF로 저장 / 인쇄</button></body></html>';
}

Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url=new URL(req.url);
  const raw=url.pathname; const apiIdx=raw.indexOf("/api"); const p=apiIdx>=0?raw.slice(apiIdx):"/";
  const xDev=req.headers.get("x-device-id")||req.headers.get("X-Device-Id")||"";
  // 이 요청을 낸 사람이 속한 부(대학·청년부 / 장년부). auth()가 신원을 풀 때마다 갱신되고,
  // 자동 백업이 어느 줄기로 나갈지를 정한다. 로그인 없이 도는 경로(공개 체크인 등)는
  // 기본값 그대로 대학·청년부로 남는다.
  let actingPartition: Partition="youth";
  // 로그인한 부(部)의 데이터베이스 손잡이. **인증된 경로에서 사람·기기·출석·권한·설정·감사기록을
  // 만질 때는 sb가 아니라 이것을 쓴다** — 그래야 대학·청년부는 public, 장년부는 adult 스키마로
  // 간다. 요청 처리 함수 안의 지역 변수라 동시에 들어온 다른 요청과 섞이지 않는다.
  // deno-lint-ignore no-explicit-any
  let adb: any=sb;
  const auth=async(): Promise<Role|null>=>{
    const r=await resolveAdmin(sb,req);
    if(r){ actingPartition=r.partition; adb=dbOf(sb,r.partition); }
    return r;
  };
  const ok=(obj:any)=>{
    if(req.method!=="GET") scheduleAutoBackup(sb,p,actingPartition); // success on a mutating route → coalesced auto-backup
    return new Response(JSON.stringify(obj),{headers:{...CORS,"Content-Type":"application/json"}});
  };
  const fail=(code:number,msg:string)=>new Response(JSON.stringify({error:msg}),{status:code,headers:{...CORS,"Content-Type":"application/json"}});
  let body: any={};
  if(req.method!=="GET"&&req.method!=="DELETE"){try{body=await req.json();}catch(_){}}
  try {
    if(req.method==="GET"&&p==="/api/health") return ok({status:"ok",ts:Date.now()});

    if(req.method==="GET"&&p==="/api/data") {
      // Hardened: the full dump is super-admin only — closes the legacy world-readable PII hole.
      // 부서 범위까지 걸린다: 장년부 관리자에게는 장년부 행만, 대학·청년부에는 장년부를 뺀 나머지만.
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Not authorized");
      const dumpScope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
      const [{data:devData},{data:logData}]=await Promise.all([
        scopeQuery(adb.from("devices").select("*"),dumpScope),
        scopeQuery(adb.from("attendance_log").select("*").order("ts",{ascending:false}),dumpScope),
      ]);
      const devices: Record<string,any>={}; (devData||[]).forEach((d:any)=>{devices[d.id]=rowToDev(d);});
      return ok({devices,log:(logData||[]).map(rowToLog)});
    }

    // ── Hardened admin auth: Google JWT, or the master password from ANY device (break-glass) ──
    if(req.method==="POST"&&p==="/api/admin/verify") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      await addLoginLog(sb,req,role);
      // partition tells the web app which department's panel to render — it drives every
      // 부서 list, the 새가족 교육 tab's visibility, and which config block it reads.
      return ok({role:role.role,group:role.group,subgroup:role.subgroup,ministry:role.ministry,partition:role.partition,canViewLoginLog:canViewLoginLog(role)});
    }

    // Scoped roster (replaces the world-readable /api/data for staff): super/pastor → their
    // whole 부(대학·청년부 minus 장년부, or 장년부 alone); leader → their 동산 (summer-mode
    // 합동 handled by scopeFilter). The 부 partition is what keeps the two departments from
    // ever seeing each other's people — it is applied here, once, for every tab downstream.
    if(req.method==="GET"&&p==="/api/roster") {
      // 이 응답이 앱에서 제일 자주, 제일 오래 기다리는 요청이라 순차 왕복을 최대한 줄인다.
      // 인증과 설정 읽기는 서로를 기다릴 이유가 없으니 함께 보낸다. (설정 *쓰기*인 롤오버는
      // 401 뒤로 미룬다 — 인증 안 된 요청이 학기 롤오버를 촉발하면 안 된다.)
      // 신원이 풀리기 전에는 어느 스키마의 설정을 읽어야 할지 알 수 없다. 그렇다고 순서대로
      // 기다리면 왕복이 하나 늘어나므로, 두 부의 설정을 인증과 함께 나란히 보내고 고른다
      // (설정은 행 하나짜리 읽기라 한 번 더 부르는 값이 왕복 한 번보다 싸다).
      const [role,youthCfg,adultCfg]=await Promise.all([auth(),getCfg(sb,"youth"),getCfg(sb,"adult")]);
      if(!role) return fail(401,"Not authorized");
      const part=role.partition;
      const baseCfg=part==="adult"?adultCfg:youthCfg;
      // Every admin page load is also the clock that retires a finished 학기's 동산 편성
      // (no-op except on the first request after a term ends) — for this 부 only.
      const cfg=await rolloverDongsan(sb,await maybeRollSchedule(sb,baseCfg,part),part);
      const summer=summerNow(cfg,part);
      const scope=scopeFilter(role,summer);
      const mq:any=scopeQuery(adb.from("members").select("*").order("name",{ascending:true}),scope);
      // 멤버 목록 · 방문자 출석 · (리더/새가족팀이면) 본인 이름 — 셋 다 서로 독립이라 한 번에.
      // 방문자(guests) have no member_id and no 동산, so the member-id filter below drops
      // them. Fold them in for admins who see their whole 부 (대학·청년부 super/pastor, and
      // the 장년부 panel) so they appear in — and count toward — the 오늘 tab; a 동산에 묶인
      // 리더는 자기 동산만 본다 (guests aren't theirs). Guests carry a 부서 too, so the
      // same scope query keeps each department's visitors on its own sheet.
      const seesWholePartition=scope.all||(part==="adult"&&!scope.subgroup);
      const needsTag=role.role==="leader"||role.role==="welcoming";
      const [mRes,gRes,meRes]:any[]=await Promise.all([
        mq,
        seesWholePartition?scopeQuery(adb.from("attendance_log").select("*").eq("is_guest",true),scope).order("ts",{ascending:false}):Promise.resolve({data:[]}),
        needsTag?adb.from("members").select("name").eq("id",role.memberId).single():Promise.resolve({data:null}),
      ]);
      const members=mRes?.data;
      const ids=(members||[]).map((m:any)=>m.id);
      const {data:md}=ids.length?await adb.from("attendance_log").select("*").in("member_id",ids).order("ts",{ascending:false}):{data:[] as any[]};
      let logs:any[]=md||[];
      const gd=gRes?.data; if(gd&&gd.length)logs=logs.concat(gd);
      // Bulk 동산 reassignment: super-admins + staff + leaders who are NOT 동산지기/부동산지기.
      // Clear-all-attendance: super (direct) + staff/leader/welcoming non-동산지기 (request).
      // staff (break-glass 리더+새가족팀) has no 동산지기 tag, so it gets both.
      let canBulkSubgroup=role.role==="super_admin"||role.role==="staff";
      let canClearAttendance=role.role==="super_admin"||role.role==="staff";
      if(needsTag){
        const tag=isDongsanLeaderName(meRes?.data?.name||"",role.group,role.subgroup,cfg?.dongsan_leaders,summer);
        if(role.role==="leader") canBulkSubgroup=!tag;
        canClearAttendance=!tag;
      }
      // 학기별 동산 편성 스냅샷 (지난 학기 출석부용) — 이 부의 기록에서, 이 관리자가 이미 볼
      // 수 있는 멤버의 것만. (visible로 거르는 것이 곧 부서 분리이기도 하다.)
      const visible=new Set(ids);
      const dongsanHistory: Record<string,any>={};
      for(const [term,entry] of Object.entries<any>(cfg?.dongsan_history||{})){
        const subs: Record<string,string>={};
        for(const [mid,sub] of Object.entries<any>(entry?.subgroups||{})) if(visible.has(mid)) subs[mid]=String(sub);
        dongsanHistory[term]={endedAt:entry?.endedAt||"",subgroups:subs};
      }
      return ok({role:role.role,partition:part,canBulkSubgroup,canClearAttendance,members:members||[],log:(logs||[]).map(rowToLog),dongsanHistory});
    }

    // Settings (super-admin only): group colors, semester dates. 여름 모드는 더 이상 설정이
    //아니라 학기 일정에서 계산되는 값이라 여기서 받지 않는다 (예전 탭이 보내와도 무시).
    if(req.method==="POST"&&p==="/api/admin/settings") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const part=role.partition;
      const {groupColors,semesterDates,semesterSchedule}=body;
      const upd: any={updated_at:new Date().toISOString()};
      if(groupColors!==undefined&&groupColors&&typeof groupColors==="object"){
        // 색은 부서 이름을 키로 갖는 지도라, 자기 부(partition)에 속한 부서만 받아 적는다 —
        // 장년부 설정 화면에서 저장해도 대학부/청년부 색은 손대지 않는다.
        const HEX=/^#[0-9a-fA-F]{6}$/; const clean: Record<string,string>={};
        for(const [g,c] of Object.entries(groupColors)) {
          if(partitionOfGroup(g)!==part) continue;
          if(typeof c==="string"&&HEX.test(c)) clean[g]=c;
        }
        upd["group_colors"]=clean;
      }
      // card_scan_daily_limit is intentionally NOT accepted here anymore — the card-scan
      // allowance is fixed at CARD_SCAN_DAILY_LIMIT (an older open tab posting it is a no-op).
      if(semesterDates!==undefined){
        if(!validSemesterDates(semesterDates)) return fail(400,"Invalid semester dates");
        upd["semester_dates"]=semesterDates;
      }
      // 2년치 학기 목록. 저장된 지난 학기는 그대로 남기고(아카이브가 그 날짜를 쓴다) 보내온
      // 목록으로 앞부분을 갈아끼운 뒤, 매년 반복되는 템플릿도 최신 패턴으로 맞춰 둔다.
      // 두 부서는 각자의 학기 일정을 갖는다 (장년부는 _adult 칸).
      if(semesterSchedule!==undefined){
        if(!validSchedule(semesterSchedule)) return fail(400,"Invalid semester schedule");
        const cfg=await getCfg(sb,actingPartition);
        const savedDates=cfg?.semester_dates;
        const merged=mergeSchedule(semesterSchedule,cfg?.semester_schedule,localDate());
        upd["semester_schedule"]=merged;
        const tmpl=scheduleToDates(merged,validSemesterDates(savedDates)?savedDates:DEFAULT_SEMESTER_DATES);
        if(validSemesterDates(tmpl)) upd["semester_dates"]=tmpl;
      }
      const {error}=await adb.from("config").update(upd).eq("id",1);
      if(error) throw new Error(error.message);
      return ok({status:"ok"});
    }

    // 동산 (dongsan) names editor — read (super-admin only). Returns config.dongsan_names,
    // shaped { "대학부": [...], "청년부": [...] }, falling back to the seeded defaults.
    if(req.method==="GET"&&p==="/api/admin/dongsan-names") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const cfg=await getCfg(sb,actingPartition);
      return ok({names:cfg?.dongsan_names||defaultDongsanNames(role.partition)});
    }

    // 동산 names editor — write (super-admin only). Replaces this 부's dongsan_names with
    // the posted map { [group]: string[] }, dropping any 부서 outside the caller's 부 so a
    // stale tab can never write into the other department. Audited as a config-change.
    if(req.method==="POST"&&p==="/api/admin/dongsan-names") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {names}=body;
      if(!names||typeof names!=="object"||Array.isArray(names)) return fail(400,"names map required");
      const mine=partitionNames(names,role.partition);
      await adb.from("config").update({dongsan_names:mine,updated_at:new Date().toISOString()}).eq("id",1);
      await addAudit(adb,"config-change",xDev,"동산 이름 수정",role.partition);
      return ok({status:"ok"});
    }

    // 새가족 교육 동산 names editor — read (super-admin only). A SEPARATE name list from
    // config.dongsan_names: the temporary 동산 a newcomer is placed in during education,
    // distinct from their eventual regular 동산. Returns config.new_member_dongsan_names,
    // falling back to an empty per-부서 map.
    if(req.method==="GET"&&p==="/api/admin/new-member-dongsan-names") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const cfg=await getCfg(sb,actingPartition);
      const blank: Record<string,string[]>={};
      for(const g of Object.keys(defaultDongsanNames(role.partition))) blank[g]=[];
      return ok({names:cfg?.new_member_dongsan_names||blank});
    }

    // 새가족 교육 동산 names editor — write (super-admin only). Same shape as
    // /api/admin/dongsan-names but a separate column. Audited as a config-change.
    if(req.method==="POST"&&p==="/api/admin/new-member-dongsan-names") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {names}=body;
      if(!names||typeof names!=="object"||Array.isArray(names)) return fail(400,"names map required");
      const mine=partitionNames(names,role.partition);
      await adb.from("config").update({new_member_dongsan_names:mine,updated_at:new Date().toISOString()}).eq("id",1);
      await addAudit(adb,"config-change",xDev,"새가족 교육 동산 이름 수정",role.partition);
      return ok({status:"ok"});
    }

    // 카드 사진 등록 (Gemini extract-card) usage for today's Pittsburgh calendar day.
    // The public response deliberately exposes tries left, not tries already used.
    // /api/share/... is the unauthenticated twin of each card endpoint below, used by the
    // share-link registration page (web/share.html). Same implementation, same shared daily
    // scan quota — the only difference is that no admin role is resolved, because that page
    // deliberately has no login. Anyone with the link can register a 새가족 card.
    if(req.method==="GET"&&(p==="/api/admin/card-scan-usage"||p==="/api/share/card-scan-usage")) {
      if(p==="/api/admin/card-scan-usage") {
        const role=await auth();
        if(!role) return fail(401,"Not authorized");
      }
      const {limit,remaining,day,resetsAt,updatedAt}=await cardScanUsage(sb);
      return ok({limit,remaining,day,resetsAt,updatedAt});
    }

    // 동산지기/부동산지기 display roles — read (any verified admin, so leaders/pastor/
    // welcoming also see the 👑/⭐ badges on member cards + the Today list). Returns the
    // full config.dongsan_leaders map { [group|"합동"]: { [동산]: { leader, subLeaders } } }.
    if(req.method==="GET"&&p==="/api/admin/dongsan-leaders") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      const cfg=await getCfg(sb,actingPartition);
      return ok({leaders:cfg?.dongsan_leaders||{}});
    }

    // 동산지기/부동산지기 editor — write one 동산's leader + sub-leaders (super-admin only).
    // Mirrors the legacy /api/dongsan-leaders shape; in summer mode the group key is "합동".
    // Audited as a config-change.
    if(req.method==="POST"&&p==="/api/admin/dongsan-leaders") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {group,subgroup,leader,subLeaders}=body;
      if(!group||!subgroup) return fail(400,"group and subgroup required");
      // 자기 부의 부서(또는 여름 합동 키)에만 쓸 수 있다.
      if(partitionOfGroup(group)!==role.partition) return fail(403,"Out of scope");
      const cfg=await getCfg(sb,actingPartition); const ldrs=cfg?.dongsan_leaders||{}; if(!ldrs[group]) ldrs[group]={};
      // 부지기 수는 부마다 다르다: 대학·청년부 동산은 부동산지기 둘, 장년부 셀은 부셀장 하나.
      // 화면도 그만큼만 그리지만 (web lib/partition.ts subLeaderSlots), 경계는 여기서 지킨다.
      const subs=Array.isArray(subLeaders)?subLeaders.filter((n:any)=>typeof n==="string"&&n):[];
      ldrs[group][subgroup]={leader:leader||"",subLeaders:subs.slice(0,SUB_LEADER_SLOTS[role.partition])};
      await adb.from("config").update({dongsan_leaders:ldrs,updated_at:new Date().toISOString()}).eq("id",1);
      await addAudit(adb,"config-change",xDev,"동산지기 수정: "+group+" "+subgroup,role.partition);
      return ok({status:"ok"});
    }

    // 임원 display-badge roster — read (any verified admin, so the 🎖️ badge shows for
    // everyone who can see the roster). Returns config.officers as a name list.
    if(req.method==="GET"&&p==="/api/admin/officers") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      const cfg=await getCfg(sb,actingPartition);
      const officers=cfg?.officers;
      return ok({officers:Array.isArray(officers)?officers:[]});
    }

    // 임원 editor — replace the whole officer name list (super-admin only). Audited as a
    // config-change. A display badge like 동산지기, independent of admin roles.
    if(req.method==="POST"&&p==="/api/admin/officers") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {officers}=body;
      if(!Array.isArray(officers)||officers.some((n:any)=>typeof n!=="string")) return fail(400,"officers array required");
      const clean=Array.from(new Set(officers.map((n:string)=>n.trim()).filter((n:string)=>n.length>0)));
      await adb.from("config").update({officers:clean,updated_at:new Date().toISOString()}).eq("id",1);
      await addAudit(adb,"config-change",xDev,"임원 수정",role.partition);
      return ok({status:"ok"});
    }

    // List admin role grants (member_roles ⨝ member names). Super-admin only, and only the
    // grants held by members this admin can see — a 장년부 관리자 never learns who the
    // 대학·청년부 관리자들이다, and vice versa.
    if(req.method==="GET"&&p==="/api/admin/roles") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      // 이 스키마의 member_roles에는 이 부서의 권한만 있다 — 다른 부의 관리자가 누구인지는
      // 보이지도 않는다. 남는 것은 부서 안에서의 범위(리더의 동산/셀)뿐.
      const scope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
      const {data:roles}=await adb.from("member_roles").select("*");
      const ids=(roles||[]).map((r:any)=>r.member_id);
      const {data:mem}=ids.length?await adb.from("members").select("id,name,group_name,subgroup").in("id",ids):{data:[] as any[]};
      const byId: Record<string,any>={}; (mem||[]).forEach((m:any)=>{byId[m.id]=m;});
      const visible=(roles||[]).filter((r:any)=>{
        const m=byId[r.member_id];
        // 멤버 행이 사라진 고아 권한도 이 스키마의 것이니 그대로 보여준다 (지워 줄 수 있도록).
        return !m||inScope(scope,m.group_name,m.subgroup);
      });
      return ok({roles:visible.map((r:any)=>({memberId:r.member_id,name:byId[r.member_id]?.name||"—",role:r.role,group:r.group_name||"",subgroup:r.subgroup||"",ministry:r.ministry||""}))});
    }

    // Audit log — most recent admin actions in this 부, newest first. Super-admin only.
    if(req.method==="GET"&&p==="/api/admin/audit") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const limit=Math.min(parseInt(url.searchParams.get("limit")||"100")||100,200);
      // 조건이 없다 — 이 스키마의 audit_log에는 이 부서에서 일어난 일만 있다.
      const {data:log}=await adb.from("audit_log").select("*").order("ts",{ascending:false}).limit(limit);
      return ok({log:(log||[]).map((e:any)=>({ts:e.ts,action:e.action,adminName:e.admin_name,details:e.details}))});
    }

    // Login log — successful admin sign-ins (which account, when, from which IP/device),
    // newest first, with the most precise location available: the device's own GPS (a
    // street-level address) when the admin allowed it at login, else the city-level IP
    // estimate. Personal-audit data, so it is NOT super-admin-wide: only 김호연, signed in
    // attributably (see canViewLoginLog in auth.ts), may read it.
    if(req.method==="GET"&&p==="/api/admin/login-log") {
      const role=await auth();
      if(!canViewLoginLog(role)) return fail(403,"Not available");
      const limit=Math.min(parseInt(url.searchParams.get("limit")||"100")||100,500);
      const {data:log}=await sb.from("login_log").select("*").order("ts",{ascending:false}).limit(limit);
      const rows=log||[];
      const geo=await geoForIps(sb,rows.map((e:any)=>e.ip||""));
      const gpsRows=rows.filter((e:any)=>typeof e.gps_lat==="number"&&typeof e.gps_lon==="number");
      const addrs=await gpsAddresses(sb,gpsRows.map((e:any)=>({lat:e.gps_lat,lon:e.gps_lon})));
      return ok({log:rows.map((e:any)=>({
        ts:e.ts,role:e.role,memberName:e.member_name||"",deviceId:e.device_id||"",ip:e.ip||"",method:e.method||"password",
        location:geo[e.ip]||null,
        gps:(typeof e.gps_lat==="number"&&typeof e.gps_lon==="number")
          ?{lat:e.gps_lat,lon:e.gps_lon,accuracy:typeof e.gps_accuracy==="number"?e.gps_accuracy:null,address:addrs[coordKey(e.gps_lat,e.gps_lon)]||""}
          :null,
      }))});
    }

    // ── Off-site encrypted DB backup (scripts/backup/, .github/workflows/backup.yml) ──
    // The full weekly Postgres dump pipeline to Cloudflare R2 — the only backup/restore
    // path in the app now, namespaced under /api/admin/db-backup/. Listing/downloading/
    // restoring stay super-admin only; triggering a fresh backup is opened to every admin
    // role except pastor (read-only), so leaders/새가족팀/break-glass staff can run one too.

    // Triggers the GH Actions workflow on demand instead of waiting for Sunday — for the
    // caller's own 부 only, so a 장년부 "지금 백업" never touches the 대학·청년부 stream.
    if(req.method==="POST"&&p==="/api/admin/db-backup/run") {
      const role=await auth();
      if(!role||role.role==="pastor") return fail(403,"Not authorized");
      const pat=Deno.env.get("GITHUB_PAT");
      if(!pat) return fail(500,"GITHUB_PAT not configured — set it in Supabase Edge Function secrets");
      const res=await fetch("https://api.github.com/repos/shrlak/kccp-attendance/actions/workflows/backup.yml/dispatches",{
        method:"POST",
        headers:{"Authorization":"Bearer "+pat,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},
        body:JSON.stringify({ref:"main",inputs:backupWorkflowInputs(role.partition)}),
      });
      if(!res.ok) return fail(502,"GitHub dispatch failed ("+res.status+")");
      await addAudit(adb,"db-backup-run",xDev,"Triggered backup workflow manually ("+role.partition+")",role.partition);
      return ok({status:"dispatched"});
    }

    // Lists the one current overwrite-in-place backup. During the first deployment,
    // before current.* exists, dated legacy objects remain visible as a safe fallback.
    if(req.method==="GET"&&p==="/api/admin/db-backup/list") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const s3=r2Client();
      if(!s3) return fail(500,"R2 credentials not configured — set R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY in Supabase Edge Function secrets");
      // 자기 부의 접두사만 본다: 대학·청년부는 backups/, 장년부는 backups/adult/.
      const prefix=r2Prefix(role.partition);
      const listing=await s3.send(new ListObjectsV2Command({Bucket:r2Bucket(),Prefix:prefix}));
      // 장년부 파일은 backups/adult/ 아래에 있으므로 대학·청년부 목록(Prefix "backups/")에도
      // 딸려 온다 — 접두사가 정확히 일치하는 객체만 남겨 두 줄기를 갈라 놓는다.
      const contents=(listing.Contents||[]).filter((o:any)=>{
        const key=o.Key||"";
        return key.startsWith(prefix)&&!key.slice(prefix.length).includes("/");
      });
      // 이 부가 쓴 것만 세니 사용량 막대도 부서별로 자기 몫을 보여준다.
      const storage={usedBytes:contents.reduce((sum:number,o:any)=>sum+(o.Size||0),0),limitBytes:r2StorageLimitBytes()};
      const objects=new Map<string,any>(contents.map((o:any)=>[o.Key||"",o] as [string,any]));
      const currentSql=objects.get(prefix+"current.sql.age"),currentSchema=objects.get(prefix+"current.schema.tar.gz.age");
      const currentSqlChecksum=objects.get(prefix+"current.sql.age.sha256"),currentSchemaChecksum=objects.get(prefix+"current.schema.tar.gz.age.sha256");
      if(currentSql&&currentSchema&&currentSqlChecksum&&currentSchemaChecksum) {
        const completedAt=currentSchemaChecksum.LastModified||currentSchema.LastModified||currentSql.LastModified;
        const sqlSize=currentSql.Size||0,schemaSize=currentSchema.Size||0;
        return ok({storage,backups:[{
          date:completedAt?new Date(completedAt).toLocaleDateString("en-CA",{timeZone:"America/New_York"}):localDate(),
          current:true,updatedAt:completedAt?new Date(completedAt).toISOString():undefined,
          totalSize:sqlSize+schemaSize,sqlKey:prefix+"current.sql.age",sqlSize,
          schemaKey:prefix+"current.schema.tar.gz.age",schemaSize,
        }]});
      }
      const byDate: Record<string,{date:string;current:boolean;updatedAt?:string;totalSize?:number;sqlKey?:string;sqlSize?:number;schemaKey?:string;schemaSize?:number}>={};
      const dated=(suffix:string)=>new RegExp("^"+prefix.replace(/\//g,"\\/")+"backup-(\\d{4}-\\d{2}-\\d{2})\\."+suffix+"$");
      for(const o of contents){
        const key=o.Key||"";
        let m=dated("sql\\.age").exec(key);
        if(m){const e=byDate[m[1]]??={date:m[1],current:false};e.sqlKey=key;e.sqlSize=o.Size||0;e.updatedAt=o.LastModified?new Date(o.LastModified).toISOString():e.updatedAt;continue;}
        m=dated("schema\\.tar\\.gz\\.age").exec(key);
        if(m){const e=byDate[m[1]]??={date:m[1],current:false};e.schemaKey=key;e.schemaSize=o.Size||0;if(o.LastModified)e.updatedAt=new Date(o.LastModified).toISOString();}
      }
      const backups=Object.values(byDate).map((e)=>({...e,totalSize:(e.sqlSize||0)+(e.schemaSize||0)})).sort((a,b)=>b.date.localeCompare(a.date));
      return ok({storage,backups});
    }

    // Short-lived presigned URL so the browser downloads the (still-encrypted) file
    // directly from R2 instead of proxying bytes through this function.
    if(req.method==="GET"&&p==="/api/admin/db-backup/download") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const key=url.searchParams.get("key")||"";
      // 자기 부의 접두사에 맞는 키만 — 장년부 패널에서 backups/current.sql.age를 요청해도 거절.
      if(!backupKeyRe(role.partition).test(key)) return fail(400,"Invalid backup key");
      const s3=r2Client();
      if(!s3) return fail(500,"R2 credentials not configured");
      const signedUrl=await getSignedUrl(s3,new GetObjectCommand({Bucket:r2Bucket(),Key:key}),{expiresIn:300});
      await addAudit(adb,"db-backup-download",xDev,"Downloaded "+key,role.partition);
      return ok({url:signedUrl});
    }

    // Destructive restore: decrypts an encrypted data dump — fetched from R2 by key, or
    // posted directly as base64 — with a private key supplied fresh in THIS request only
    // (never stored, never logged), then truncates and reloads every public table inside
    // one transaction so a failure midway leaves the database exactly as it was. The
    // literal confirmation phrase is a server-side backstop behind the UI's own confirm
    // gate, since this replaces ALL current data with the backup's snapshot.
    if(req.method==="POST"&&p==="/api/admin/db-backup/restore") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const restorePart=role.partition;
      const {source,key,fileBase64,privateKey,confirm}=body;
      if(confirm!=="RESTORE") return fail(400,"Confirmation phrase required");
      if(!privateKey||typeof privateKey!=="string") return fail(400,"Private key required");

      let ciphertext: Uint8Array;
      if(source==="online") {
        const sqlKeyRe=new RegExp("^"+r2Prefix(restorePart).replace(/\//g,"\\/")+"(?:current|backup-\\d{4}-\\d{2}-\\d{2})\\.sql\\.age$");
        if(typeof key!=="string"||!sqlKeyRe.test(key)) return fail(400,"Invalid backup key");
        const s3=r2Client();
        if(!s3) return fail(500,"R2 credentials not configured");
        const obj=await s3.send(new GetObjectCommand({Bucket:r2Bucket(),Key:key}));
        const bytes=await obj.Body?.transformToByteArray();
        if(!bytes) return fail(404,"Backup not found");
        ciphertext=bytes;
      } else if(source==="upload") {
        if(typeof fileBase64!=="string"||!fileBase64) return fail(400,"File required");
        ciphertext=Uint8Array.from(atob(fileBase64),c=>c.charCodeAt(0));
      } else {
        return fail(400,"Invalid source");
      }

      let sqlText: string;
      try {
        const d=new age.Decrypter();
        d.addIdentity(privateKey.trim());
        const plaintext=await d.decrypt(ciphertext);
        sqlText=new TextDecoder().decode(plaintext);
      } catch(_e) {
        return fail(400,"Decryption failed — check the private key and file");
      }

      const restoreDbUrl=Deno.env.get("RESTORE_DB_URL");
      if(!restoreDbUrl) return fail(500,"RESTORE_DB_URL not configured — set it in Supabase Edge Function secrets");
      const pgSql=postgres(restoreDbUrl,{max:1});
      try {
        // 자기 부의 스키마만 비우고 그 백업을 흘려 넣는다. 한 트랜잭션이라 도중에 실패하면
        // 전부 원상복귀하고, 다른 부서의 스키마는 어느 쪽으로도 손대지 않는다.
        const schema=restorePart==="adult"?ADULT_SCHEMA:"public";
        const tables=await pgSql`SELECT tablename FROM pg_tables WHERE schemaname=${schema}`;
        if(!tables.length) return fail(500,`No tables found in schema ${schema}`);
        await pgSql.begin(async (tx: any)=>{
          await tx.unsafe(restoreWipeSql(restorePart)+"\n"+sqlText);
        });
        await addAudit(adb,"db-restore",xDev,
          schema+" 스키마 복원: "+(source==="online"?key:"uploaded file")+" ("+tables.length+" tables)");
        return ok({status:"restored",tables:tables.length});
      } catch(e: any) {
        return fail(500,"Restore failed: "+(e?.message||"unknown error"));
      } finally {
        await pgSql.end({timeout:5});
      }
    }

    // Assign/replace a member's admin role (super-admin only). Upsert into member_roles.
    if(req.method==="POST"&&p==="/api/admin/role/set") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {memberId,role:newRole,group,subgroup,ministry}=body;
      if(!memberId||!newRole) return fail(400,"memberId and role required");
      if(!["super_admin","leader","pastor","welcoming"].includes(newRole)) return fail(400,"Invalid role");
      const {data:m}=await adb.from("members").select("name,group_name,subgroup").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      // 자기 부 사람에게만, 자기 부 부서로만 권한을 줄 수 있다.
      const setScope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
      if(!inScope(setScope,m.group_name,m.subgroup)) return fail(403,"Out of scope");
      if(group&&partitionOfGroup(group)!==role.partition) return fail(403,"Out of scope");
      await adb.from("member_roles").upsert({member_id:memberId,role:newRole,group_name:group||"",subgroup:subgroup||"",ministry:ministry||""});
      await addAudit(adb,"admin-add",xDev,(m as {name?:string}).name+" → "+newRole,role.partition);
      return ok({status:"ok"});
    }

    // Revoke a member's admin role (super-admin only). Refuses to remove the last super.
    if(req.method==="POST"&&p==="/api/admin/role/remove") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {memberId}=body; if(!memberId) return fail(400,"memberId required");
      const {data:tr}=await adb.from("member_roles").select("role").eq("member_id",memberId).single();
      if(!tr) return ok({status:"ok"});
      const {data:m}=await adb.from("members").select("name,group_name,subgroup").eq("id",memberId).single();
      // 다른 부의 관리자 권한은 보이지도, 지워지지도 않는다.
      const rmScope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
      if(m&&!inScope(rmScope,m.group_name,m.subgroup)) return fail(403,"Out of scope");
      if((tr as {role?:string}).role==="super_admin"){
        const {count}=await adb.from("member_roles").select("member_id",{count:"exact",head:true}).eq("role","super_admin");
        if((count||0)<=1) return fail(400,"Cannot remove the last super admin");
      }
      await adb.from("member_roles").delete().eq("member_id",memberId);
      await addAudit(adb,"admin-remove",xDev,((m as {name?:string}|null)?.name||memberId)+"",role.partition);
      return ok({status:"ok"});
    }

    // Edit a member. Pastor is read-only; a leader may only edit members in their own
    // 동산 (scope-checked). Renames propagate to the denormalized devices/attendance names.
    if(req.method==="PUT"&&p==="/api/admin/member") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberId}=body; if(!memberId) return fail(400,"memberId required");
      const {data:m}=await adb.from("members").select("name,group_name,subgroup").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      // 부 경계는 최고관리자에게도 적용된다 — scopeFilter가 자기 부만 돌려주므로 예외 없이 검사.
      const editScope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
      if(!inScope(editScope,m.group_name,m.subgroup)) return fail(403,"Out of scope");
      // 부서를 옮기는 것도 자기 부 안에서만 (장년부 사람을 청년부로 넘길 수 없다).
      if(body.group!==undefined&&!inScopeGroup(editScope,body.group)) return fail(403,"Out of scope");
      const COLS: Record<string,string>={name:"name",group:"group_name",subgroup:"subgroup",notes:"notes",memberRole:"member_role",gender:"gender",phone:"phone",birthDate:"birth_date",baptismStatus:"baptism_status",schoolOrWork:"school_or_work",faithDuration:"faith_duration",registrationDate:"registration_date",pastoralVisitRequested:"pastoral_visit_requested",isNewMember:"is_new_member",newMemberEduWeek1:"new_member_edu_week1",newMemberEduWeek2:"new_member_edu_week2",newMemberDongsan:"new_member_dongsan",kakaoId:"kakao_id",statusNote:"status_note",statusStart:"status_start",statusEnd:"status_end"};
      const DATE_COLS=new Set(["birth_date","registration_date","status_start","status_end","visit_date"]);
      const upd: any={updated_at:new Date().toISOString()};
      for(const [k,col] of Object.entries(COLS)){ if(body[k]!==undefined) upd[col]=DATE_COLS.has(col)?(body[k]||null):body[k]; }
      // 장년부 새교우 카드의 칸들 — **그 부에서만** 받는다. 이 컬럼들은 adult.members에만
      // 있으므로(20260808), 대학·청년부 요청에서 같은 이름이 와도 조용히 버린다. 넣으면
      // public.members에 없는 컬럼이라 업데이트 전체가 실패한다.
      if(role.partition==="adult"){
        for(const [k,col] of Object.entries(ADULT_CARD_COLS)){
          if(body[k]!==undefined) upd[col]=DATE_COLS.has(col)?(body[k]||null):body[k];
        }
        if(body.family!==undefined){
          if(!Array.isArray(body.family)) return fail(400,"family must be a list");
          upd.family=body.family.map((r:any)=>({
            nameKo:String(r?.nameKo??""), nameEn:String(r?.nameEn??""),
            relation:String(r?.relation??""), birthDate:String(r?.birthDate??""),
            gender:String(r?.gender??""), baptism:String(r?.baptism??""),
          }));
        }
      }
      // 상태 표기 목록 — 목록을 저장하고, 예전 단일 컬럼에는 현재(또는 최신) 표기를 남긴다.
      if(body.statusMarks!==undefined){
        const marks=cleanStatusMarks(body.statusMarks);
        if(!marks) return fail(400,"statusMarks must be a list");
        const cur=currentStatusMark(marks,localDate());
        upd.status_marks=marks;
        upd.status_note=cur.note; upd.status_start=cur.start; upd.status_end=cur.end;
      }
      await adb.from("members").update(upd).eq("id",memberId);
      // Attendance rows carry the 이름/부서/동산 they were stamped with at check-in, and the
      // 출석부 filters on those — so a 새가족 who gets assigned a 동산 after their first
      // Sundays would keep those rows filed under the old (usually empty) 동산 while the
      // member tab already shows the new one, i.e. the two views disagree. Carry any
      // identity/placement change onto the member's existing rows, the same propagation
      // the bulk 동산 transfer and the merge already do.
      const moved: any={};
      if(body.name!==undefined&&body.name!==m.name) moved.name=body.name;
      if(body.group!==undefined&&(body.group||"")!==(m.group_name||"")) moved.group_name=body.group||"";
      if(body.subgroup!==undefined&&(body.subgroup||"")!==(m.subgroup||"")) moved.subgroup=body.subgroup||"";
      if(Object.keys(moved).length){
        await adb.from("devices").update(moved).eq("member_id",memberId);
        await adb.from("attendance_log").update(moved).eq("member_id",memberId);
      }
      await addAudit(adb,"member-edit",xDev,(body.name||m.name)+" ("+memberId+")",role.partition);
      return ok({status:"ok"});
    }

    // Merge two members: reassign the source's devices + attendance into the target
    // (inheriting the target's name/group/동산), then delete the source member. Scoped
    // (a leader may only merge members in their own 동산); pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/merge") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {fromId,toId}=body; if(!fromId||!toId||fromId===toId) return fail(400,"fromId and a different toId required");
      const {data:from}=await adb.from("members").select("name,group_name,subgroup").eq("id",fromId).single();
      const {data:to}=await adb.from("members").select("name,group_name,subgroup").eq("id",toId).single();
      if(!from||!to) return fail(404,"Member not found");
      {
        const scope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
        for(const mm of [from,to]) if(!inScope(scope,mm.group_name,mm.subgroup)) return fail(403,"Out of scope");
      }
      // Reassign BEFORE deleting (devices.member_id is ON DELETE CASCADE). Migrated rows
      // inherit the target's denormalized name/group/동산 — matches the legacy merge.
      const denorm={name:to.name,group_name:to.group_name||"",subgroup:to.subgroup||""};
      await adb.from("devices").update({member_id:toId,...denorm}).eq("member_id",fromId);
      await adb.from("attendance_log").update({member_id:toId,...denorm}).eq("member_id",fromId);
      await adb.from("members").delete().eq("id",fromId);
      await addAudit(adb,"member-merge",xDev,from.name+" → "+to.name,role.partition);
      return ok({status:"ok"});
    }

    // Delete a member entirely: removes their attendance rows + the member (devices and
    // member_roles cascade via FK). Scoped (a leader may only delete members in their own
    // 동산); pastor read-only; audited. Irreversible.
    if(req.method==="POST"&&p==="/api/admin/member/delete") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberId}=body; if(!memberId) return fail(400,"memberId required");
      const {data:m}=await adb.from("members").select("name,group_name,subgroup").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      {
        const scope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
        if(!inScope(scope,m.group_name,m.subgroup)) return fail(403,"Out of scope");
      }
      // attendance_log.member_id is ON DELETE SET NULL, so the member's rows would orphan
      // (and keep counting) — delete them explicitly. devices + member_roles cascade.
      await adb.from("attendance_log").delete().eq("member_id",memberId);
      await adb.from("members").delete().eq("id",memberId);
      await addAudit(adb,"member-delete",xDev,m.name+" ("+memberId+")",role.partition);
      return ok({status:"ok"});
    }

    // Bulk 동산 (subgroup) reassignment: set or clear the 동산 for many members at once.
    // Allowed for super-admin OR a leader who is NOT a 동산지기/부동산지기. Out-of-scope
    // members are dropped server-side; subgroup "" removes them from any 동산. Audited.
    if(req.method==="POST"&&p==="/api/admin/members/bulk-subgroup") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      const cfg=await getCfg(sb,actingPartition);
      const part=role.partition, summer=summerNow(cfg,part);
      // super + staff (break-glass, all-access) may bulk-transfer freely; a leader may too
      // unless they're a 동산지기/부동산지기. Everyone else is rejected.
      if(role.role!=="super_admin"&&role.role!=="staff"){
        if(role.role!=="leader") return fail(403,"Not authorized");
        const {data:me}=await adb.from("members").select("name").eq("id",role.memberId).single();
        if(isDongsanLeaderName((me as any)?.name||"",role.group,role.subgroup,cfg?.dongsan_leaders,summer)) return fail(403,"동산지기/부동산지기는 사용할 수 없습니다");
      }
      const {memberIds,subgroup}=body;
      if(!Array.isArray(memberIds)||!memberIds.length) return fail(400,"memberIds required");
      const sub=(subgroup||"").trim();
      // 범위 밖 멤버는 조용히 빠진다 — 최고관리자도 다른 부 사람은 옮길 수 없다.
      const scope=scopeFilter(role,summer);
      const {data:ms}=await adb.from("members").select("id,group_name,subgroup").in("id",memberIds);
      const targetIds=(ms||[]).filter((m:any)=>inScope(scope,m.group_name,m.subgroup)).map((m:any)=>m.id);
      if(!targetIds.length) return ok({status:"ok",updated:0});
      const ts=new Date().toISOString();
      await adb.from("members").update({subgroup:sub,updated_at:ts}).in("id",targetIds);
      await adb.from("devices").update({subgroup:sub}).in("member_id",targetIds);
      await adb.from("attendance_log").update({subgroup:sub}).in("member_id",targetIds);
      await addAudit(adb,"bulk-transfer",xDev,targetIds.length+"명 → 동산 "+(sub||"(해제)"),part);
      return ok({status:"ok",updated:targetIds.length});
    }

    // Clear ALL attendance records **in the caller's 부**. Super-admin clears immediately; a
    // non-super admin (leader/welcoming who is NOT a 동산지기/부동산지기) files a request
    // held for super approval. Audited either way. 장년부에서 "전체 삭제"를 눌러도
    // 대학·청년부 출석은 한 줄도 지워지지 않는다 (그 반대도 마찬가지).
    if(req.method==="POST"&&p==="/api/admin/attendance/clear") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      const cfg=await getCfg(sb,actingPartition);
      const part=role.partition, summer=summerNow(cfg,part);
      if(role.role==="super_admin"){
        await clearPartitionAttendance(adb,scopeFilter(role,summer));
        await addAudit(adb,"clear-attendance",xDev,"모든 출석 기록 삭제",part);
        return ok({status:"cleared"});
      }
      // staff (break-glass 리더+새가족팀) is non-super, so like leader/welcoming it files a
      // request for super approval rather than clearing directly.
      if(role.role!=="leader"&&role.role!=="welcoming"&&role.role!=="staff") return fail(403,"Not authorized");
      const {data:me}=await adb.from("members").select("name").eq("id",role.memberId).single();
      if(isDongsanLeaderName((me as any)?.name||"",role.group,role.subgroup,cfg?.dongsan_leaders,summer)) return fail(403,"동산지기/부동산지기는 사용할 수 없습니다");
      const stored=cfg?.pending_clear;
      const pending=Array.isArray(stored)?stored:[];
      pending.push({requestedBy:xDev,requestedByName:(me as any)?.name||xDev,requestedAt:Date.now()});
      await adb.from("config").update({pending_clear:pending}).eq("id",1);
      await addAudit(adb,"clear-requested",xDev,"출석 기록 삭제 요청",part);
      return ok({status:"pending"});
    }

    // Pending clear-all requests for this 부 (super-admin only).
    if(req.method==="GET"&&p==="/api/admin/attendance/clear-pending") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const cfg=await getCfg(sb,actingPartition);
      const stored=cfg?.pending_clear;
      return ok({pending:Array.isArray(stored)?stored:[]});
    }

    // Approve pending clear → delete this 부's attendance + empty its queue (super-admin only).
    if(req.method==="POST"&&p==="/api/admin/attendance/clear-approve") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const part=role.partition;
      await clearPartitionAttendance(adb,scopeFilter(role,summerNow(await getCfg(sb,actingPartition),part)));
      await adb.from("config").update({pending_clear:[]}).eq("id",1);
      await addAudit(adb,"clear-attendance",xDev,"모든 출석 기록 삭제 (요청 승인)",part);
      return ok({status:"cleared"});
    }

    // Reject/dismiss pending clear requests (super-admin only).
    if(req.method==="POST"&&p==="/api/admin/attendance/clear-reject") {
      const role=await auth();
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      await adb.from("config").update({pending_clear:[]}).eq("id",1);
      await addAudit(adb,"clear-rejected",xDev,"출석 기록 삭제 요청 거절",role.partition);
      return ok({status:"ok"});
    }

    // Manual check-in (hardened, member-id based): mark a member present for today,
    // bypassing day/time/location. Scoped (a leader may only check in members in their
    // own 동산); pastor read-only; audited. Distinct from the legacy name-based
    // /api/admin/checkin used by the old client.
    if(req.method==="POST"&&p==="/api/admin/member-checkin") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberId}=body; if(!memberId) return fail(400,"memberId required");
      const {data:m}=await adb.from("members").select("name,group_name,subgroup,member_role").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      {
        const scope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
        if(!inScope(scope,m.group_name,m.subgroup)) return fail(403,"Out of scope");
      }
      const today=localDate(),time=localTime();
      const {data:exist}=await adb.from("attendance_log").select("time_str").eq("member_id",memberId).eq("date",today).limit(1);
      if(exist&&exist.length) return ok({status:"already",time:exist[0].time_str,name:m.name});
      const {count}=await adb.from("attendance_log").select("id",{count:"exact",head:true}).eq("member_id",memberId);
      const isFirst=(count||0)===0;
      const {data:dev}=await adb.from("devices").select("id").eq("member_id",memberId).limit(1);
      const did=(dev&&dev.length)?dev[0].id:("MANUAL-"+Date.now());
      await adb.from("attendance_log").insert({device_id:did,member_id:memberId,name:m.name,group_name:m.group_name||"",subgroup:m.subgroup||"",date:today,time_str:time,ts:Date.now(),is_manual:true,admin_added:true,first_visit:isFirst,member_role:m.member_role||null});
      await addAudit(adb,"admin-checkin",xDev,m.name+" | "+today,role.partition);
      return ok({status:"ok",time,name:m.name,firstVisit:isFirst});
    }

    // Manual attendance — add an entry for a member on ANY date (back-fill). Hardened,
    // member-id based, scoped; pastor read-only; deduped by member_id+date; audited.
    if(req.method==="POST"&&p==="/api/admin/log/add") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberId,date}=body; if(!memberId||!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400,"memberId and a YYYY-MM-DD date required");
      const {data:m}=await adb.from("members").select("name,group_name,subgroup,member_role").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      {
        const scope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
        if(!inScope(scope,m.group_name,m.subgroup)) return fail(403,"Out of scope");
      }
      const {data:exist}=await adb.from("attendance_log").select("id").eq("member_id",memberId).eq("date",date).limit(1);
      if(exist&&exist.length) return ok({status:"already"});
      const {data:dev}=await adb.from("devices").select("id").eq("member_id",memberId).limit(1);
      const did=(dev&&dev.length)?dev[0].id:("MANUAL-"+Date.now());
      await adb.from("attendance_log").insert({device_id:did,member_id:memberId,name:m.name,group_name:m.group_name||"",subgroup:m.subgroup||"",date,time_str:localTime(),ts:Date.now(),is_manual:true,admin_added:true,member_role:m.member_role||null});
      await addAudit(adb,"manual-add",xDev,m.name+" | "+date,role.partition);
      return ok({status:"ok"});
    }

    // Manual attendance — remove a single entry by its row id. Hardened: scope-checks the
    // entry's member; pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/log/remove") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {logId}=body; if(logId===undefined||logId===null) return fail(400,"logId required");
      const {data:row}=await adb.from("attendance_log").select("id,name,date,member_id,group_name,subgroup").eq("id",logId).single();
      if(!row) return fail(404,"Entry not found");
      {
        // 멤버가 달린 행은 멤버의 현재 부서/동산으로, 방문자 행은 찍힐 때의 부서로 판단한다.
        const scope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
        const {data:m}=row.member_id
          ?await adb.from("members").select("group_name,subgroup").eq("id",row.member_id).single()
          :{data:null};
        const owner=(m as any)||{group_name:row.group_name,subgroup:row.subgroup};
        if(!inScope(scope,owner.group_name,owner.subgroup)) return fail(403,"Out of scope");
      }
      await adb.from("attendance_log").delete().eq("id",logId);
      await addAudit(adb,"manual-remove",xDev,row.name+" | "+row.date,role.partition);
      return ok({status:"ok"});
    }

    // Bulk attendance — add an entry for many members on a chosen date. Hardened,
    // member-id based; pastor read-only; out-of-scope members are silently dropped;
    // members already present on that date are skipped; audited. Returns the count added.
    if(req.method==="POST"&&p==="/api/admin/log/add-bulk") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberIds,date}=body;
      if(!Array.isArray(memberIds)||!memberIds.length||!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400,"memberIds[] and a YYYY-MM-DD date required");
      const {data:mem}=await adb.from("members").select("id,name,group_name,subgroup,member_role").in("id",memberIds);
      const bulkScope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
      const scoped=(mem||[]).filter((m:any)=>inScope(bulkScope,m.group_name,m.subgroup));
      if(!scoped.length) return ok({status:"ok",added:0});
      const ids=scoped.map((m:any)=>m.id);
      const {data:existing}=await adb.from("attendance_log").select("member_id").in("member_id",ids).eq("date",date);
      const have=new Set((existing||[]).map((e:any)=>e.member_id));
      const toAdd=scoped.filter((m:any)=>!have.has(m.id));
      if(toAdd.length){
        const {data:devs}=await adb.from("devices").select("id,member_id").in("member_id",toAdd.map((m:any)=>m.id));
        const devByMember: Record<string,string>={}; (devs||[]).forEach((d:any)=>{if(!devByMember[d.member_id])devByMember[d.member_id]=d.id;});
        const now=Date.now();
        const rows=toAdd.map((m:any,i:number)=>({device_id:devByMember[m.id]||("MANUAL-"+(now+i)),member_id:m.id,name:m.name,group_name:m.group_name||"",subgroup:m.subgroup||"",date,time_str:localTime(),ts:now+i,is_manual:true,is_bulk:true,admin_added:true,member_role:m.member_role||null}));
        await adb.from("attendance_log").insert(rows);
      }
      await addAudit(adb,"bulk-add",xDev,date+" | "+toAdd.length+" members",role.partition);
      return ok({status:"ok",added:toAdd.length});
    }

    // Register a device (Devices tab 2.4): find-or-create the member by name (creating
    // it with the given 부서/동산 when new), then upsert a devices row linked to that
    // member with the denormalized name/group/동산. Any device (real or ROSTER) id is
    // allowed; ROSTER placeholders for the name are superseded. Pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/device/register") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {deviceId,name,group,subgroup}=body;
      const did=(deviceId||"").trim(); const nm=(name||"").trim();
      if(!did||!nm) return fail(400,"deviceId and name required");
      const grp=(group||"").trim(),sub=(subgroup||"").trim();
      // 자기 부의 부서로만 등록할 수 있다.
      if(!inScopeGroup(scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition)),grp)) return fail(403,"Out of scope");
      const {data:mm}=await adb.from("members").select("id").eq("name",nm).limit(1);
      let memberId=mm&&mm.length?mm[0].id:null;
      if(!memberId){
        const {data:created}=await adb.from("members").insert({name:nm,group_name:grp,subgroup:sub}).select("id").single();
        memberId=(created as {id?:string}|null)?.id||null;
      }
      await adb.from("devices").upsert({id:did,name:nm,group_name:grp,subgroup:sub,member_id:memberId});
      await supersedeRosterPlaceholders(adb,nm,did);
      await addAudit(adb,"device-register",xDev,nm+" ("+did+")",role.partition);
      return ok({status:"ok"});
    }

    // Link a device to an existing member (Devices tab 2.5): point an existing-or-new
    // device id at the chosen member, inheriting that member's denormalized
    // name/group/동산 (the device row is created if it doesn't exist). ROSTER
    // placeholders for the name are superseded. Pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/device/link") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {deviceId,memberId}=body;
      const did=(deviceId||"").trim();
      if(!did||!memberId) return fail(400,"deviceId and memberId required");
      const {data:m}=await adb.from("members").select("name,group_name,subgroup").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      {
        const scope=scopeFilter(role,summerNow(await getCfg(sb,actingPartition),role.partition));
        if(!inScope(scope,m.group_name,m.subgroup)) return fail(403,"Out of scope");
      }
      await adb.from("devices").upsert({id:did,name:m.name,group_name:m.group_name||"",subgroup:m.subgroup||"",member_id:memberId});
      await supersedeRosterPlaceholders(adb,m.name,did);
      await addAudit(adb,"device-edit",xDev,m.name+" ("+did+")",role.partition);
      return ok({status:"ok"});
    }

    // Kiosk guest (방문자) check-in (Phase 3.7): the kiosk runs on a verified admin
    // device, so this is hardened (verifyAdmin) and bypasses day/time/location. Records a
    // visitor attendance row for today; deduped by name+date; pastor read-only; audited.
    // `group` (대학부/청년부) puts the visitor on that 부서's 오늘 sheet / 출석부 이미지;
    // anything else is stored as "" (unassigned) like the pre-group rows.
    if(req.method==="POST"&&p==="/api/admin/guest-checkin") {
      const role=await auth();
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const name=(body.name||"").trim(); if(!name) return fail(400,"name required");
      // 방문자도 부서를 달고 기록된다 — 그래야 각 부의 오늘 명단/출석부에 자기 방문자만 뜬다.
      // 요청한 부서가 이 부의 것이 아니면 무시하고, 장년부는 장년부로 떨어뜨린다 (대학·청년부는
      // 부서 없는 방문자를 그대로 허용해 온 예전 동작 유지).
      const requestedGroup=(body.group||"").trim();
      const guestGroups=role.partition==="adult"?[ADULT_GROUP]:["대학부","청년부"];
      const group=guestGroups.includes(requestedGroup)?requestedGroup:(role.partition==="adult"?ADULT_GROUP:"");
      const today=localDate(),time=localTime();
      const {data:exist}=await adb.from("attendance_log").select("time_str").eq("name",name).eq("date",today).eq("is_guest",true).limit(1);
      if(exist&&exist.length) return ok({status:"already",time:exist[0].time_str,name});
      await adb.from("attendance_log").insert({device_id:"GUEST-"+Date.now(),name,group_name:group,subgroup:"",date:today,time_str:time,ts:Date.now(),is_manual:true,is_guest:true,member_role:"visitor"});
      await addAudit(adb,"guest-checkin",xDev,name+(group?" | "+group:"")+" | "+today,role.partition);
      return ok({status:"ok",time,name});
    }

    // Kiosk 새가족 (new-family) registration (Phase 3.8): creates a member with
    // is_new_member=true and the extended profile fields, links a NEW-{ts} device, then
    // immediately records today's attendance (first_visit) — unless body.skipCheckin
    // (admin card-scan path). Hardened (verifyAdmin); pastor read-only; audited.
    if(req.method==="POST"&&(p==="/api/admin/kiosk-new-member"||p==="/api/share/new-member")) {
      const viaShare=p==="/api/share/new-member";
      let newMemberPart: Partition="youth";
      const name=(body.name||"").trim(); const group=(body.group||"").trim();
      if(!name||!group) return fail(400,"name and group required");
      if(!viaShare) {
        const role=await auth();
        if(!role) return fail(401,"Not authorized");
        if(role.role==="pastor") return fail(403,"Read-only");
        newMemberPart=role.partition;
        // 자기 부의 부서로만 새 사람을 등록할 수 있다. (동산은 나중에 배정하므로 보지 않는다.)
        if(!inScopeGroup(scopeFilter(role,summerNow(await getCfg(sb,actingPartition),newMemberPart)),group)) return fail(403,"Out of scope");
      } else {
        // 로그인 없이 도는 새가족 카드 링크는 **부마다 따로**다. 링크가 어느 부의 것인지
        // 몸통이 말하고(partition), 그 말과 부서가 서로 맞을 때만 받는다 — 장년부 링크로
        // 대학부 사람을 넣거나 그 반대가 되지 않도록.
        const asked=body.partition==="adult"?"adult":"youth";
        if(partitionOfGroup(group)!==asked) return fail(403,"Out of scope");
        newMemberPart=asked;
      }
      // 로그인 경로에서는 auth()가 이미 adb를 그 부로 맞춰 두었지만, 공유 링크는 신원을
      // 풀지 않으므로 여기서 직접 손잡이를 고른다.
      const ndb=viaShare?dbOf(sb,newMemberPart):adb;
      const subgroup=(body.subgroup||"").trim();
      const today=localDate(),time=localTime();
      // 이미 같은 사람이 등록돼 있으면 행을 하나 더 만들지 않고 그 멤버에 최신 정보를 덮어쓴다
      // (출석 기록·기기가 그대로 이어진다).
      const dup=await findDuplicateMember(ndb,name,group,body);
      let memberId: string|null=null, merged=false;
      if(dup){
        await ndb.from("members").update(mergedMemberFields(dup,body,subgroup,today)).eq("id",dup.id);
        memberId=dup.id; merged=true;
      } else {
        const {data:created}=await ndb.from("members").insert({
          name,group_name:group,subgroup,is_new_member:true,
          gender:body.gender||"",phone:body.phone||"",kakao_id:body.kakaoId||"",
          birth_date:body.birthDate||null,baptism_status:body.baptismStatus||"해당없음",
          school_or_work:body.schoolOrWork||"",faith_duration:body.faithDuration||"",
          // 장년부 카드는 묻는 것이 다르다 (이름 영문·집 전화·주소·참석동기·동행가족 …).
          // 그 칸들은 adult.members에만 있으므로 그 부일 때만 얹는다.
          ...(newMemberPart==="adult"?adultCardFields(body):{}),
          // 등록일자 defaults to the date the member is added but the operator may set it
          // explicitly (e.g. back-fill someone who joined earlier). Attendance percentages
          // count from this date.
          registration_date:(body.registrationDate||"").trim()||today,pastoral_visit_requested:body.pastoralVisitRequested===true?true:body.pastoralVisitRequested===false?false:null,
        }).select("id").single();
        memberId=(created as {id?:string}|null)?.id||null;
      }
      if(!memberId) return fail(500,"Could not create member");
      // 기기: 병합이면 이미 연결된 기기를 재사용하고, 없을 때만 새로 만든다.
      const {data:existingDev}=merged?await ndb.from("devices").select("id").eq("member_id",memberId).limit(1):{data:null};
      const newId=(existingDev as {id?:string}[]|null)?.[0]?.id||("NEW-"+Date.now());
      if(!(existingDev as unknown[]|null)?.length){
        await ndb.from("devices").insert({id:newId,name,group_name:group,subgroup,member_id:memberId,is_new_member:true});
      } else {
        await ndb.from("devices").update({name,group_name:group,subgroup}).eq("id",newId);
      }
      // skipCheckin (admin card-scan path): create the member + device but don't record
      // today's attendance — e.g. entering a stack of paper cards later in the week.
      // The kiosk never sends the flag, so its check-them-in-now behavior is unchanged.
      // 병합된 사람이 오늘 이미 출석했다면 줄을 하나 더 남기지 않는다.
      const already=merged?(await ndb.from("attendance_log").select("id").eq("member_id",memberId).eq("date",today).limit(1)).data:null;
      if(!body.skipCheckin&&!(already as unknown[]|null)?.length){
        await ndb.from("attendance_log").insert({device_id:newId,member_id:memberId,name,group_name:group,subgroup,date:today,time_str:time,ts:Date.now(),is_manual:true,admin_added:false,first_visit:!merged});
      }
      await addAudit(ndb,merged?"new-member-merge":"new-member-register",xDev,name+" | "+group+(merged?" | 중복 등록 → 기존 멤버에 병합":"")+(body.skipCheckin?" | no-checkin":"")+(viaShare?" | share-link":""),newMemberPart);
      return ok({status:"ok",memberId,time,merged});
    }

    // 새가족 등록 카드 photo extraction: the admin panel sends a downscaled card photo
    // (base64 JPEG); a free vision model reads the handwriting/checkboxes into structured
    // JSON — one object per card, since a photo can show several — which the client
    // normalizes + shows for review. Nothing is written to the DB here.
    // Audit logs only size/type, never the extracted PII.
    if(req.method==="POST"&&(p==="/api/admin/extract-card"||p==="/api/share/extract-card")) {
      const viaExtractShare=p==="/api/share/extract-card";
      if(!viaExtractShare) {
        const role=await auth();
        if(!role) return fail(401,"Not authorized");
        if(role.role==="pastor") return fail(403,"Read-only");
      }
      const image=typeof body.image==="string"?body.image:"";
      const mediaType=["image/jpeg","image/png","image/webp"].includes(body.mediaType)?body.mediaType:"image/jpeg";
      if(!image) return fail(400,"image required");
      if(image.length>8_000_000) return fail(413,"Image too large — retake with a smaller photo");
      const usage=await cardScanUsage(sb);
      if(usage.used>=usage.limit) return fail(429,"오늘 카드 스캔 한도("+usage.limit+"회)를 모두 사용했습니다");
      const keys={google:Deno.env.get("GEMINI_API_KEY")||"",openrouter:Deno.env.get("OPENROUTER_API_KEY")||""};
      // Handwriting is hard and every model here is on a free tier, so one request may
      // walk several: a model that is rate-limited, unavailable, or answers with nothing
      // parseable hands off to the next. Models whose provider key is unset are skipped.
      const chain=availableCardModels(cardModelChain(Deno.env.get("CARD_MODEL_CHAIN")),keys);
      if(chain.length===0) return fail(500,"GEMINI_API_KEY not configured — set it in Supabase Edge Function secrets");
      // Record the attempt before calling out so every consumed try is reflected in the
      // live usage counter, even when every model in the chain errors. One row per
      // request (not per model), so the fallbacks don't eat the daily allowance.
      const usageRecorded=await addAudit(ndb,"extract-card",xDev,mediaType+" | "+Math.round(image.length*3/4/1024)+"KB | api-call"+(viaExtractShare?" | share-link":""));
      if(!usageRecorded) return fail(500,"Could not record card API usage — retry");
      let cards:Record<string,unknown>[]|null=null,used=chain[0],lastError="",rateLimited=false;
      // Capped so a long chain can't outlive the client's 60s budget (4 × 20s worst case).
      for(const model of chain.slice(0,CARD_MODEL_ATTEMPTS)) {
        used=model;
        try {
          const rq=buildCardRequest(model,image,mediaType,keys[model.provider]);
          const gr=await fetch(rq.url,{method:"POST",headers:rq.headers,body:JSON.stringify(rq.body),signal:AbortSignal.timeout(CARD_MODEL_TIMEOUT_MS)});
          if(!gr.ok) {
            const detail=await gr.text().catch(()=>"");
            if(gr.status===429) rateLimited=true;
            lastError=model.label+" "+gr.status+(detail?": "+detail.slice(0,160):"");
            continue;
          }
          cards=parseCardResponse(model,await gr.json().catch(()=>null));
          if(cards) break;
          lastError=model.label+": 카드를 읽지 못했습니다";
        } catch(e) {
          lastError=model.label+": "+((e as Error)?.message||"request failed");
        }
      }
      // One photo can hold several cards (a stack on the table) — every card read out
      // of it comes back in `cards`; `card` stays for older cached clients.
      // Every model rate-limited is a wait-and-retry, not an unreadable photo — say so.
      if(!cards&&rateLimited) return fail(429,"무료 AI 모델 사용량을 모두 소진했습니다 — 잠시 후 다시 시도해주세요 ("+lastError+")");
      if(!cards) return fail(502,"Could not read card fields from the image"+(lastError?" ("+lastError+")":""));
      // The audit row above is already committed, so return the new remaining value
      // immediately instead of making the client wait for its next polling interval.
      const publicUsage={limit:usage.limit,remaining:Math.max(0,usage.remaining-1),day:usage.day,resetsAt:usage.resetsAt,updatedAt:Date.now()};
      return ok({status:"ok",cards,card:cards[0],model:used.label,modelId:used.id,usage:publicUsage});
    }

    if(req.method==="POST"&&p==="/api/check-admin") {
      const {deviceId}=body; const cfg=await getCfg(sb); const ads: any[]=cfg.admin_devices||[];
      const noAdminsYet=!ads.length;
      let entry=noAdminsYet?{role:"super",group:"",subgroup:"",ministry:""}:ads.find((d:any)=>typeof d==="string"?d===deviceId:d.deviceId===deviceId);
      if(!noAdminsYet&&!entry) {
        const {data:dev}=await sb.from("devices").select("name").eq("id",deviceId).single();
        if(dev?.name) {
          const peers=await getDevsByName(sb,dev.name);
          entry=ads.find((d:any)=>peers.includes(typeof d==="string"?d:d.deviceId));
        }
      }
      return ok({isAdmin:noAdminsYet||!!entry,noAdminsYet,role:entry?(typeof entry==="string"?"super":entry.role||"super"):null,leaderGroup:entry&&typeof entry!=="string"?entry.group||"":"",leaderSubgroup:entry&&typeof entry!=="string"?entry.subgroup||"":"",ministry:entry&&typeof entry!=="string"?entry.ministry||"":""});
    }

    // Kiosk new member registration (새가족 등록)
    if(req.method==="POST"&&p==="/api/kiosk-new-member") {
      const {name,group,subgroup,gender,phone,birthDate,baptismStatus,schoolOrWork,faithDuration,pastoralVisitRequested,kakaoId}=body;
      if(!name?.trim()) return fail(400,"name required");
      if(!group) return fail(400,"group required");
      const regDate=localDate(); // 등록일자 = add date, always
      const newId="NEW-"+Date.now();
      await sb.from("devices").insert({
        id:newId,
        name:name.trim(),
        group_name:group||"",
        subgroup:subgroup||"",
        gender:gender||"",
        phone:phone||"",
        birth_date:birthDate||null,
        baptism_status:baptismStatus||"해당없음",
        school_or_work:schoolOrWork||"",
        faith_duration:faithDuration||"",
        registration_date:regDate,
        pastoral_visit_requested:!!pastoralVisitRequested,
        is_new_member:true,
        kakao_id:kakaoId||"",
      });
      const today=localDate();
      const time=localTime();
      await sb.from("attendance_log").insert({device_id:newId,name:name.trim(),group_name:group||"",subgroup:subgroup||"",date:today,time_str:time,ts:Date.now(),location_verified:false,first_visit:true,is_manual:true,admin_added:false});
      await addAudit(sb,"new-member-register",newId,name.trim()+" (새가족 등록)");
      return ok({status:"ok",name:name.trim(),deviceId:newId});
    }

    if(req.method==="POST"&&p==="/api/register") {
      const {deviceId,name,group,subgroup,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      await sb.from("devices").upsert({id:deviceId,name:name.trim(),group_name:group||"",subgroup:subgroup||""});
      await sb.from("attendance_log").update({name:name.trim(),group_name:group||"",subgroup:subgroup||""}).eq("device_id",deviceId);
      await supersedeRosterPlaceholders(sb,name.trim(),deviceId);
      await addAudit(sb,"device-register",adminDeviceId,name+" ("+deviceId+")");
      return ok({status:"ok"});
    }

    if(req.method==="PUT"&&p==="/api/device") {
      const {deviceId,name,group,subgroup,notes,memberRole,gender,phone,birthDate,baptismStatus,schoolOrWork,faithDuration,registrationDate,pastoralVisitRequested,isNewMember,newMemberEduWeek1,newMemberEduWeek2,kakaoId,adminDeviceId}=body;
      if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const {data:dev}=await sb.from("devices").select("*").eq("id",deviceId).single(); if(!dev) return ok({status:"ok"});
      const oldName=dev.name,newName=name?name.trim():oldName,newGroup=group!==undefined?group.trim():dev.group_name||"",newSub=subgroup!==undefined?subgroup.trim():dev.subgroup||"";
      const upd: any={name:newName,group_name:newGroup,subgroup:newSub,updated_at:new Date().toISOString()};
      if(notes!==undefined) upd.notes=notes;
      if(memberRole!==undefined) upd.member_role=memberRole;
      if(gender!==undefined) upd.gender=gender;
      if(phone!==undefined) upd.phone=phone;
      if(birthDate!==undefined) upd.birth_date=birthDate||null;
      if(baptismStatus!==undefined) upd.baptism_status=baptismStatus;
      if(schoolOrWork!==undefined) upd.school_or_work=schoolOrWork;
      if(faithDuration!==undefined) upd.faith_duration=faithDuration;
      if(registrationDate!==undefined) upd.registration_date=registrationDate||null;
      if(pastoralVisitRequested!==undefined) upd.pastoral_visit_requested=!!pastoralVisitRequested;
      if(isNewMember!==undefined) upd.is_new_member=!!isNewMember;
      if(newMemberEduWeek1!==undefined) upd.new_member_edu_week1=!!newMemberEduWeek1;
      if(newMemberEduWeek2!==undefined) upd.new_member_edu_week2=!!newMemberEduWeek2;
      if(kakaoId!==undefined) upd.kakao_id=kakaoId;
      if(oldName!==newName){await sb.from("devices").update(upd).eq("name",oldName);await sb.from("attendance_log").update({name:newName,group_name:newGroup,subgroup:newSub}).eq("name",oldName);}
      else{await sb.from("devices").update(upd).eq("id",deviceId);}
      await addAudit(sb,"device-edit",adminDeviceId,newName+" ("+deviceId+")");
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/link-device") {
      const {newDeviceId,existingName,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const {data:eds}=await sb.from("devices").select("group_name,subgroup").eq("name",existingName).limit(1);
      const ed=eds&&eds.length?eds[0]:{group_name:"",subgroup:""};
      await sb.from("devices").upsert({id:newDeviceId.trim(),name:existingName.trim(),group_name:ed.group_name||"",subgroup:ed.subgroup||""});
      await sb.from("attendance_log").update({name:existingName.trim(),group_name:ed.group_name||"",subgroup:ed.subgroup||""}).eq("device_id",newDeviceId.trim());
      await supersedeRosterPlaceholders(sb,existingName.trim(),newDeviceId.trim());
      return ok({status:"ok",devices:await getDevsByName(sb,existingName.trim())});
    }

    if(req.method==="DELETE"&&p.startsWith("/api/device/")) {
      const did=decodeURIComponent(p.replace("/api/device/","")); if(!await isAdmin(sb,xDev)) return fail(403,"Not authorized");
      await sb.from("devices").delete().eq("id",did); return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/remove-person") {
      const {name,deleteRecords,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const dids=await getDevsByName(sb,name);
      if(dids.length) await sb.from("devices").delete().in("id",dids);
      if(deleteRecords){if(dids.length) await sb.from("attendance_log").delete().in("device_id",dids); await sb.from("attendance_log").delete().eq("name",name);}
      await addAudit(sb,"person-remove",adminDeviceId,name+(deleteRecords?" (records deleted)":""));
      return ok({status:"ok"});
    }

    if(req.method==="DELETE"&&p==="/api/log"){if(!await isAdmin(sb,xDev))return fail(403,"Not authorized");await sb.from("attendance_log").delete().neq("id",0);return ok({status:"ok"});}
    if(req.method==="DELETE"&&p==="/api/devices"){if(!await isAdmin(sb,xDev))return fail(403,"Not authorized");await sb.from("devices").delete().neq("id","");return ok({status:"ok"});}
    if(req.method==="DELETE"&&p==="/api/all"){if(!await isAdmin(sb,xDev))return fail(403,"Not authorized");await Promise.all([sb.from("attendance_log").delete().neq("id",0),sb.from("devices").delete().neq("id","")]);return ok({status:"ok"});}

    if(req.method==="GET"&&p==="/api/name-order"){const cfg=await getCfg(sb);return ok({order:cfg.name_order||[]});}
    if(req.method==="POST"&&p==="/api/name-order"){const {order,adminDeviceId}=body;if(!await isAdmin(sb,adminDeviceId))return fail(403,"Not authorized");await sb.from("config").update({name_order:order||[]}).eq("id",1);return ok({status:"ok"});}

    if(req.method==="POST"&&p==="/api/log/add-manual") {
      const {name,date,time:mt,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized"); if(!name||!date) return fail(400,"name and date required");
      const ex=await checkedToday(sb,name,date);
      if(!ex){const dids=await getDevsByName(sb,name);const did=dids[0]||null;const {data:dv}=did?await sb.from("devices").select("group_name,subgroup").eq("id",did).single():{data:null};await sb.from("attendance_log").insert({device_id:did||("MANUAL-"+Date.now()),name,group_name:dv?.group_name||"",subgroup:dv?.subgroup||"",date,time_str:mt||localTime(),ts:Date.now(),is_manual:true,admin_added:true});await addAudit(sb,"manual-add",adminDeviceId,name+" | "+date);}
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/admin/checkin") {
      const {name,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized"); if(!name?.trim()) return fail(400,"name required");
      const today=localDate(),time=localTime();
      const ex=await checkedToday(sb,name.trim(),today); if(ex) return ok({status:"already",time:ex.time_str,name:name.trim()});
      const dids=await getDevsByName(sb,name.trim());const did=dids[0]||null;const {data:dv}=did?await sb.from("devices").select("group_name,subgroup").eq("id",did).single():{data:null};
      await sb.from("attendance_log").insert({device_id:did||("MANUAL-"+Date.now()),name:name.trim(),group_name:dv?.group_name||"",subgroup:dv?.subgroup||"",date:today,time_str:time,ts:Date.now(),is_manual:true,admin_added:true});
      const total=await countAtt(sb,name.trim()); await addAudit(sb,"admin-checkin",adminDeviceId,name.trim()+" | "+today);
      return ok({status:"ok",time,name:name.trim(),total});
    }

    if(req.method==="POST"&&p==="/api/guest-checkin") {
      const {name,lat,lng}=body; if(!name?.trim()) return fail(400,"name required");
      const cfg=await getCfg(sb); const allowedDays: number[]=cfg.checkin_days||[0]; const startMin: number=cfg.checkin_start_min??780,endMin: number=cfg.checkin_end_min??900;
      if(!cfg.demo_mode){
        const now=new Date(),eastern=new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"}));
        const day=eastern.getDay(),timeInMin=eastern.getHours()*60+eastern.getMinutes();
        const DAY=["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
        if(!allowedDays.includes(day)) return ok({status:"time-restricted",message:"출석 가능한 요일이 아닙니다",sub:"출석 가능 요일: "+allowedDays.map((d:number)=>DAY[d]).join(", ")});
        if(timeInMin<startMin||timeInMin>=endMin) return ok({status:"time-restricted",message:"출석 시간이 아닙니다",sub:"출석 가능 시간: "+fmtMin(startMin)+" ~ "+fmtMin(endMin)});
        const loc=checkLocation(lat,lng); if(loc==="required") return ok({status:"location-required",message:"위치 정보가 필요합니다. 위치 접근을 허용해주세요."});
        if(loc!==null) return ok({status:"location-restricted",message:"교회 근처에서만 출석할 수 있습니다.",distance:loc});
      }
      const today=localDate(),time=localTime();
      const {data:ex}=await sb.from("attendance_log").select("id").eq("name",name.trim()).eq("date",today).eq("is_guest",true).limit(1);
      if(!ex||!ex.length) await sb.from("attendance_log").insert({device_id:"GUEST-"+Date.now(),name:name.trim(),group_name:"",subgroup:"",date:today,time_str:time,ts:Date.now(),is_guest:true,member_role:"visitor"});
      return ok({status:"ok",time,name:name.trim()});
    }

    if(req.method==="POST"&&p==="/api/log/remove-entry") {
      const {ts,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const {data:removed}=await sb.from("attendance_log").select("*").eq("ts",ts).single();
      await sb.from("attendance_log").delete().eq("ts",ts);
      if(removed) await addAudit(sb,"manual-remove",adminDeviceId,removed.name+" | "+removed.date);
      return ok({status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/dongsan-names"){const cfg=await getCfg(sb);return ok({names:cfg.dongsan_names||{"대학부":["동산1","동산2","동산3","동산4"],"청년부":["동산1","동산2","동산3","동산4"]}});}

    if(req.method==="POST"&&p==="/api/dongsan-names") {
      const {group,index,name,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized"); if(!group||index===undefined||!name) return fail(400,"group, index, and name required");
      const cfg=await getCfg(sb); const dns=cfg.dongsan_names||{"대학부":["동산1","동산2","동산3","동산4"],"청년부":["동산1","동산2","동산3","동산4"]};
      if(!dns[group]) dns[group]=["동산1","동산2","동산3","동산4"];
      const oldName=dns[group][index]; dns[group][index]=name.trim();
      await sb.from("config").update({dongsan_names:dns}).eq("id",1);
      if(oldName&&oldName!==name.trim()){await sb.from("devices").update({subgroup:name.trim()}).eq("group_name",group).eq("subgroup",oldName);await sb.from("attendance_log").update({subgroup:name.trim()}).eq("group_name",group).eq("subgroup",oldName);}
      return ok({status:"ok",names:dns});
    }

    if(req.method==="GET"&&p==="/api/dongsan-leaders"){const cfg=await getCfg(sb);return ok({leaders:cfg.dongsan_leaders||{}});}

    if(req.method==="POST"&&p==="/api/dongsan-leaders") {
      const {group,subgroup,leader,subLeaders,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized"); if(!group||!subgroup) return fail(400,"group and subgroup required");
      const cfg=await getCfg(sb); const ldrs=cfg.dongsan_leaders||{}; if(!ldrs[group]) ldrs[group]={};
      ldrs[group][subgroup]={leader:leader||"",subLeaders:subLeaders||[]};
      await sb.from("config").update({dongsan_leaders:ldrs}).eq("id",1);
      await addAudit(sb,"config-change",adminDeviceId,"동산지기: "+group+" "+subgroup);
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/transfer-member") {
      const {name,newGroup,newSubgroup,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized"); if(!name||!newGroup) return fail(400,"name and newGroup required");
      await sb.from("devices").update({group_name:newGroup,subgroup:newSubgroup||""}).eq("name",name);
      await addAudit(sb,"transfer-member",adminDeviceId,name+" → "+newGroup+" "+(newSubgroup||""));
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/admin/add") {
      const {password,targetDeviceId,role,group,subgroup,ministry,adminDeviceId}=body; const cfg=await getCfg(sb);
      if(password!==cfg.admin_password) return fail(403,"Wrong password");
      // Only a super admin may add admins / assign roles. isSuperAdmin returns true when no admins exist yet, so first-time bootstrap still works.
      if(!await isSuperAdmin(sb,adminDeviceId)) return fail(403,"Super admin required");
      const {data:dev}=await sb.from("devices").select("name").eq("id",targetDeviceId.trim()).single();
      const deviceIdsToAdd: string[]=dev?.name?await getDevsByName(sb,dev.name):[targetDeviceId.trim()];
      let ads: any[]=[...(cfg.admin_devices||[])].filter((d:any)=>!deviceIdsToAdd.includes(typeof d==="string"?d:d.deviceId));
      for(const did of deviceIdsToAdd){const entry: any={deviceId:did,role:role||"super"};if(group) entry.group=group;if(subgroup) entry.subgroup=subgroup;if(ministry) entry.ministry=ministry;ads.push(entry);}
      await sb.from("config").update({admin_devices:ads}).eq("id",1);
      return ok({status:"ok",devicesAdded:deviceIdsToAdd.length});
    }

    if(req.method==="POST"&&p==="/api/admin/remove") {
      const {password,targetDeviceId,adminDeviceId}=body; const cfg=await getCfg(sb); if(password!==cfg.admin_password) return fail(403,"Wrong password");
      // Only a super admin may remove admins.
      if(!await isSuperAdmin(sb,adminDeviceId)) return fail(403,"Super admin required");
      const {data:dev}=await sb.from("devices").select("name").eq("id",targetDeviceId.trim()).single();
      const deviceIdsToRemove: string[]=dev?.name?await getDevsByName(sb,dev.name):[targetDeviceId.trim()];
      await sb.from("config").update({admin_devices:(cfg.admin_devices||[]).filter((d:any)=>!deviceIdsToRemove.includes(typeof d==="string"?d:d.deviceId))}).eq("id",1);
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/admin/list") {
      const {password,adminDeviceId}=body; const cfg=await getCfg(sb); if(password!==cfg.admin_password) return fail(403,"Wrong password");
      if(adminDeviceId&&!await isSuperAdmin(sb,adminDeviceId)) return fail(403,"Super admin required");
      const ads: any[]=cfg.admin_devices||[];
      const allEntries=await Promise.all(ads.map(async(d:any)=>{const did=typeof d==="string"?d:d.deviceId;const r=typeof d==="string"?"super":d.role||"super";const ministry=typeof d==="string"?"":d.ministry||"";const group=typeof d==="string"?"":d.group||"";const subgroup=typeof d==="string"?"":d.subgroup||"";const {data:dv}=await sb.from("devices").select("name").eq("id",did).single();return {deviceId:did,name:dv?.name||"Unknown",role:r,ministry,group,subgroup};}));
      const byName: Record<string,{name:string,role:string,deviceId:string,deviceCount:number,ministry:string,group:string,subgroup:string}>={};
      for(const e of allEntries){if(!byName[e.name])byName[e.name]={name:e.name,role:e.role,deviceId:e.deviceId,deviceCount:0,ministry:e.ministry,group:e.group,subgroup:e.subgroup};byName[e.name].deviceCount++;}
      return ok({adminDevices:Object.values(byName)});
    }

    // 부서 색과 학기 일정. 두 부의 값을 한 번에 돌려주고 (`adult` 블록), 웹이 로그인한 부에
    // 맞는 쪽을 골라 쓴다 — 이 경로는 랜딩 페이지도 부르는 무인증 경로라 여기서 신원을 푸느라
    // 왕복을 하나 더 쓰지 않으려는 것. 담긴 값은 날짜와 색뿐이라 사람 정보는 들어 있지 않다.
    if(req.method==="GET"&&p==="/api/config"){
      const cfg=await getCfg(sb);
      const block=(part: Partition)=>({
        summerMode:summerNow(cfg,part),
        semesterSchedule:scheduleOf(cfg?.semester_schedule),
        groupColors:cfg?.group_colors||defaultGroupColors(part),
        semesterDates:validSemesterDates(cfg?.semester_dates)?cfg?.semester_dates:null,
      });
      return ok({...block("youth"),adult:block("adult")});
    }

    if(req.method==="POST"&&p==="/api/config") {
      const {checkinDays,checkinStartMin,checkinEndMin,requireApproval,demoMode,individualCheckinEnabled,adminDeviceId}=body;
      if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const upd: any={updated_at:new Date().toISOString()};
      if(checkinDays!==undefined) upd.checkin_days=checkinDays;
      if(checkinStartMin!==undefined) upd.checkin_start_min=Number(checkinStartMin); if(checkinEndMin!==undefined) upd.checkin_end_min=Number(checkinEndMin);
      if(requireApproval!==undefined) upd.require_approval=!!requireApproval;
      // summerMode는 받지 않는다 — 여름학기 일정에서 계산된다 (summerNow).
      if(demoMode!==undefined){if(!await isSuperAdmin(sb,adminDeviceId))return fail(403,"Demo mode requires super admin");upd.demo_mode=!!demoMode;}
      if(individualCheckinEnabled!==undefined) upd.individual_checkin_enabled=!!individualCheckinEnabled;
      await sb.from("config").update(upd).eq("id",1); await addAudit(sb,"config-change",adminDeviceId,"config updated");
      return ok({status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/export/csv"){const gf=url.searchParams.get("group")||"",sf=url.searchParams.get("subgroup")||"";const csv=await buildCsvLog(sb,gf,sf);return new Response(csv,{headers:{...CORS,"Content-Type":"text/csv","Content-Disposition":'attachment; filename="attendance-log-'+(gf||"all")+"-"+localDate()+'.csv"'}});}
    if(req.method==="GET"&&p==="/api/export/grid"){const gf=url.searchParams.get("group")||"",sf=url.searchParams.get("subgroup")||"";const csv=await buildCsvGrid(sb,gf,sf);return new Response(csv,{headers:{...CORS,"Content-Type":"text/csv","Content-Disposition":'attachment; filename="attendance-grid-'+(gf||"all")+"-"+localDate()+'.csv"'}});}

    if(req.method==="POST"&&p==="/api/log/add-bulk") {
      const {names,date,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized"); if(!names||!date) return fail(400,"names and date required");
      let added=0;
      for(const name of names){const ex=await checkedToday(sb,name,date);if(ex)continue;const dids=await getDevsByName(sb,name);const did=dids[0]||null;const {data:dv}=did?await sb.from("devices").select("group_name,subgroup").eq("id",did).single():{data:null};await sb.from("attendance_log").insert({device_id:did||("BULK-"+Date.now()),name,group_name:dv?.group_name||"",subgroup:dv?.subgroup||"",date,time_str:"12:00:00 PM",ts:Date.now(),is_manual:true,is_bulk:true,admin_added:true});added++;}
      await addAudit(sb,"bulk-add",adminDeviceId,added+" members for "+date);
      return ok({status:"ok",added});
    }

    if(req.method==="GET"&&p==="/api/events") {
      const {data:evts}=await sb.from("events").select("*, event_attendees(device_id, name)").order("created_at",{ascending:false});
      return ok({events:(evts||[]).map((e:any)=>({id:e.id,name:e.name,date:e.date,type:e.type,group:e.group_name,notes:e.notes,createdBy:e.created_by,createdAt:new Date(e.created_at).getTime(),attendees:(e.event_attendees||[]).map((a:any)=>a.name||a.device_id)}))});
    }

    if(req.method==="POST"&&p==="/api/events") {
      const {name,date,type,group,notes,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized"); if(!name||!date) return fail(400,"name and date required");
      const id="evt-"+Date.now();
      await sb.from("events").insert({id,name:name.trim(),date,type:type||"기타",group_name:group||"",notes:notes||"",created_by:adminDeviceId});
      await addAudit(sb,"event-create",adminDeviceId,name+" ("+date+")");
      return ok({status:"ok",id});
    }

    if(req.method==="PUT"&&p.startsWith("/api/events/")&&!p.endsWith("/attend")) {
      const id=p.split("/api/events/")[1]; const {attendees,name,date,type,notes,adminDeviceId}=body;
      if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const upd: any={}; if(name!==undefined) upd.name=name.trim(); if(date!==undefined) upd.date=date; if(type!==undefined) upd.type=type; if(notes!==undefined) upd.notes=notes;
      if(Object.keys(upd).length) await sb.from("events").update(upd).eq("id",id);
      if(attendees!==undefined){await sb.from("event_attendees").delete().eq("event_id",id);if(attendees.length) await sb.from("event_attendees").insert(attendees.map((a:string)=>({event_id:id,device_id:"NAME-"+a,name:a})));}
      return ok({status:"ok"});
    }

    if(req.method==="DELETE"&&p.startsWith("/api/events/")) {
      const id=p.split("/api/events/")[1].split("/")[0]; if(!await isAdmin(sb,xDev)) return fail(403,"Not authorized");
      const {data:evt}=await sb.from("events").select("name").eq("id",id).single();
      await sb.from("events").delete().eq("id",id); if(evt) await addAudit(sb,"event-delete",xDev,evt.name);
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p.match(/^\/api\/events\/[^/]+\/attend$/)) {
      const id=p.split("/")[3]; const {name}=body; if(!name) return fail(400,"name required");
      await sb.from("event_attendees").upsert({event_id:id,device_id:"NAME-"+name,name});
      const {data:att}=await sb.from("event_attendees").select("name").eq("event_id",id);
      return ok({status:"ok",attendees:(att||[]).map((a:any)=>a.name)});
    }

    if(req.method==="GET"&&p==="/api/audit") {
      const adminId=xDev||url.searchParams.get("deviceId")||""; if(!await isAdmin(sb,adminId)) return fail(403,"Not authorized");
      const limit=parseInt(url.searchParams.get("limit")||"100");
      const {data:log}=await sb.from("audit_log").select("*").order("ts",{ascending:false}).limit(limit);
      return ok({log:(log||[]).map((e:any)=>({ts:e.ts,action:e.action,adminId:e.admin_id,adminName:e.admin_name,details:e.details}))});
    }

    if(req.method==="POST"&&p==="/api/merge-members") {
      const {fromName,toName,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized"); if(!fromName||!toName||fromName===toName) return fail(400,"Invalid names");
      const {data:tds}=await sb.from("devices").select("group_name,subgroup").eq("name",toName).limit(1);
      const td=tds&&tds.length?tds[0]:{group_name:"",subgroup:""};
      await sb.from("devices").update({name:toName.trim(),group_name:td.group_name||"",subgroup:td.subgroup||""}).eq("name",fromName);
      await sb.from("attendance_log").update({name:toName.trim(),group_name:td.group_name||"",subgroup:td.subgroup||""}).eq("name",fromName);
      const merged=await getDevsByName(sb,toName.trim());
      await addAudit(sb,"merge-members",adminDeviceId,fromName+" → "+toName+" ("+merged.length+" devices)");
      return ok({status:"ok",merged:merged.length});
    }

    if(req.method==="GET"&&p==="/api/pending"){const adminId=xDev||url.searchParams.get("deviceId")||"";if(!await isAdmin(sb,adminId))return fail(403,"Not authorized");const {data:pd}=await sb.from("pending_registrations").select("*").order("requested_at",{ascending:false});return ok({pending:(pd||[]).map((p:any)=>({deviceId:p.device_id,name:p.name,group:p.group_name,subgroup:p.subgroup,requestedAt:new Date(p.requested_at).getTime()}))});}
    if(req.method==="GET"&&p==="/api/pending/count"){const adminId=xDev||url.searchParams.get("deviceId")||"";if(!await isAdmin(sb,adminId))return ok({count:0});const {count}=await sb.from("pending_registrations").select("id",{count:"exact",head:true});return ok({count:count||0});}

    if(req.method==="POST"&&p==="/api/pending/approve") {
      const {pendingDeviceId,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const {data:pr}=await sb.from("pending_registrations").select("*").eq("device_id",pendingDeviceId).single(); if(!pr) return fail(404,"Not found in pending list");
      await sb.from("pending_registrations").delete().eq("device_id",pendingDeviceId);
      await sb.from("devices").upsert({id:pr.device_id,name:pr.name,group_name:pr.group_name||"",subgroup:pr.subgroup||""});
      await supersedeRosterPlaceholders(sb,pr.name,pr.device_id);
      await addAudit(sb,"pending-approve",adminDeviceId,pr.name+" ("+pr.device_id+")");
      return ok({status:"ok",name:pr.name});
    }

    if(req.method==="POST"&&p==="/api/pending/reject") {
      const {pendingDeviceId,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const {data:pr}=await sb.from("pending_registrations").select("*").eq("device_id",pendingDeviceId).single(); if(!pr) return fail(404,"Not found");
      await sb.from("pending_registrations").delete().eq("device_id",pendingDeviceId);
      await addAudit(sb,"pending-reject",adminDeviceId,pr.name+" ("+pr.device_id+")");
      return ok({status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/backup") {
      const adminId=xDev||url.searchParams.get("deviceId")||""; if(!await isAdmin(sb,adminId)) return fail(403,"Not authorized");
      const [{data:dd},{data:ld},{data:ed},{data:ad},{data:pd},cfg]=await Promise.all([(sb.from("devices").select("*")),(sb.from("attendance_log").select("*").order("ts",{ascending:false})),sb.from("events").select("*, event_attendees(device_id, name)"),sb.from("audit_log").select("*").order("ts",{ascending:false}),sb.from("pending_registrations").select("*"),getCfg(sb)]);
      const devices: Record<string,any>={}; (dd||[]).forEach((d:any)=>{devices[d.id]=rowToDev(d);});
      const bk={version:2,exportedAt:Date.now(),attendance:{devices,log:(ld||[]).map(rowToLog)},config:{adminDevices:cfg.admin_devices||[],nameOrder:cfg.name_order||[],dongsanNames:cfg.dongsan_names,checkinDays:cfg.checkin_days||[0],checkinStartMin:cfg.checkin_start_min??780,checkinEndMin:cfg.checkin_end_min??900,dongsanLeaders:cfg.dongsan_leaders||{},requireApproval:cfg.require_approval||false,individualCheckinEnabled:cfg.individual_checkin_enabled||false,semesterDates:validSemesterDates(cfg.semester_dates)?cfg.semester_dates:null},events:{events:(ed||[]).map((e:any)=>({id:e.id,name:e.name,date:e.date,type:e.type,group:e.group_name,notes:e.notes,createdBy:e.created_by,createdAt:new Date(e.created_at).getTime(),attendees:(e.event_attendees||[]).map((a:any)=>a.name||a.device_id)}))},audit:(ad||[]).map((e:any)=>({ts:e.ts,action:e.action,adminId:e.admin_id,adminName:e.admin_name,details:e.details})),pending:(pd||[]).map((p:any)=>({deviceId:p.device_id,name:p.name,group:p.group_name,subgroup:p.subgroup,requestedAt:new Date(p.requested_at).getTime()}))};
      return new Response(JSON.stringify(bk,null,2),{headers:{...CORS,"Content-Type":"application/json","Content-Disposition":'attachment; filename="kccp-backup-'+localDate()+'.json"'}});
    }

    if(req.method==="POST"&&p==="/api/restore") {
      if(!await isAdmin(sb,xDev)) return fail(403,"Not authorized"); const bk=body; if(!bk.version||!bk.attendance) return fail(400,"Invalid backup file");
      if(bk.attendance?.devices){await sb.from("devices").delete().neq("id","");const dr=Object.entries(bk.attendance.devices).map(([id,v]:any)=>({id,name:v.name,group_name:v.group||"",subgroup:v.subgroup||"",notes:v.notes||"",member_role:v.memberRole||"",gender:v.gender||"",phone:v.phone||"",birth_date:v.birthDate||null,baptism_status:v.baptismStatus||"해당없음",school_or_work:v.schoolOrWork||"",faith_duration:v.faithDuration||"",registration_date:v.registrationDate||null,pastoral_visit_requested:v.pastoralVisitRequested||false,is_new_member:v.isNewMember||false,new_member_edu_week1:v.newMemberEduWeek1||false,new_member_edu_week2:v.newMemberEduWeek2||false}));if(dr.length) await sb.from("devices").insert(dr);}
      if(bk.attendance?.log){await sb.from("attendance_log").delete().neq("id",0);const lr=bk.attendance.log.map((e:any)=>({device_id:e.deviceId,name:e.name,group_name:e.group||"",subgroup:e.subgroup||"",date:e.date,time_str:e.time,ts:e.ts,location_verified:!!e.locationVerified,admin_added:!!e.adminAdded,first_visit:!!e.firstVisit,is_manual:!!e.manual,is_bulk:!!e.bulk,is_guest:!!e.guest,member_role:e.memberRole||null}));if(lr.length) await sb.from("attendance_log").insert(lr);}
      if(bk.config){const c=bk.config;await sb.from("config").update({admin_devices:c.adminDevices||[],name_order:c.nameOrder||[],dongsan_names:c.dongsanNames,checkin_days:c.checkinDays||[0],checkin_start_min:c.checkinStartMin??780,checkin_end_min:c.checkinEndMin??900,dongsan_leaders:c.dongsanLeaders||{},require_approval:c.requireApproval||false,individual_checkin_enabled:c.individualCheckinEnabled||false,semester_dates:validSemesterDates(c.semesterDates)?c.semesterDates:null}).eq("id",1);}
      if(bk.events?.events){await sb.from("events").delete().neq("id","");for(const e of bk.events.events){await sb.from("events").insert({id:e.id,name:e.name,date:e.date,type:e.type||"기타",group_name:e.group||"",notes:e.notes||"",created_by:e.createdBy,created_at:e.createdAt?new Date(e.createdAt).toISOString():new Date().toISOString()});if(e.attendees?.length) await sb.from("event_attendees").insert(e.attendees.map((a:string)=>({event_id:e.id,device_id:"NAME-"+a,name:a})));}}
      await addAudit(sb,"restore",xDev,"Restored backup from "+(bk.exportedAt?new Date(bk.exportedAt).toLocaleString("ko-KR",{timeZone:"America/New_York"}):"unknown"));
      return ok({status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/report/html") {
      const gf=url.searchParams.get("group")||"",sf=url.searchParams.get("subgroup")||"",period=url.searchParams.get("period")||"all",fromP=url.searchParams.get("from")||"",toP=url.searchParams.get("to")||"";
      const today=localDate();
      let dq: any=(sb.from("devices").select("*")); if(gf) dq=dq.eq("group_name",gf); if(sf) dq=dq.eq("subgroup",sf);
      const {data:devData}=await dq;
      let lq: any=(sb.from("attendance_log").select("*").order("date",{ascending:true}));
      if(gf) lq=lq.eq("group_name",gf); if(sf) lq=lq.eq("subgroup",sf);
      if(period==="today") lq=lq.eq("date",today);
      else if(period==="weekly"){const d=new Date();d.setDate(d.getDate()-6);lq=lq.gte("date",d.toLocaleDateString("en-CA",{timeZone:"America/New_York"})).lte("date",today);}
      else if(period==="monthly") lq=lq.like("date",today.slice(0,7)+"%");
      else if(fromP||toP){if(fromP) lq=lq.gte("date",fromP);if(toP) lq=lq.lte("date",toP);}
      const {data:logData}=await lq;
      const logs=logData||[],devices=devData||[];
      const dates=[...new Set(logs.map((e:any)=>e.date as string))].sort();
      // regDate = earliest 등록일자 across the member's device rows; dates before it are
      // excluded from that member's 출석률 (등록 전 주일은 결석으로 치지 않음).
      const members: Record<string,{group:string;subgroup:string;devices:string[];regDate:string}>={}; devices.forEach((d:any)=>{if(!members[d.name])members[d.name]={group:d.group_name||"",subgroup:d.subgroup||"",devices:[],regDate:""};members[d.name].devices.push(d.id);const rd=d.registration_date||"";if(rd&&(!members[d.name].regDate||rd<members[d.name].regDate))members[d.name].regDate=rd;});
      const names=Object.keys(members).sort();
      const periodLabel=period==="today"?today:period==="weekly"?"최근 7일":period==="monthly"?today.slice(0,7):(fromP&&toP?fromP+" ~ "+toP:"전체");
      return new Response(buildReportHtml(names,dates,members,logs,periodLabel,gf,sf),{headers:{...CORS,"Content-Type":"text/html; charset=utf-8"}});
    }

    return fail(404,"Not found");
  } catch(e:any) {
    console.error("attendance-api error:",e);
    return new Response(JSON.stringify({error:e.message}),{status:400,headers:{...CORS,"Content-Type":"application/json"}});
  }
});
