import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveAdmin, scopeFilter } from "./auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Device-Id,X-Admin-Password,Authorization,apikey",
};
function localDate() { return new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"}); }
function localTime() { return new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function fmtDateWithDay(d: string) { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric",year:"numeric"}); }
function fmtMin(m: number) { const h=Math.floor(m/60),mn=m%60,h12=h%12||12; return String(h12).padStart(2,"0")+":"+String(mn).padStart(2,"0")+" "+(h>=12?"PM":"AM"); }

const CHURCH_LAT=40.450218535488325, CHURCH_LNG=-79.93480148825721;
function checkLocation(lat?: number | null, lng?: number | null) {
  if(lat==null||lng==null) return "required";
  const R=6371000,dLat=(lat-CHURCH_LAT)*Math.PI/180,dLng=(lng-CHURCH_LNG)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(CHURCH_LAT*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLng/2)**2;
  const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  return dist>30?Math.round(dist):null;
}

type SB = ReturnType<typeof createClient>;
async function getCfg(sb: SB) { const {data}=await sb.from("config").select("*").eq("id",1).single(); return data||{}; }
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
async function getDevsByName(sb: SB, name: string): Promise<string[]> { const {data}=await sb.from("devices").select("id").eq("name",name); return (data||[]).map((d:any)=>d.id); }
// When a real device is added for a member, it supersedes any ROSTER-… placeholder rows
// for that same name (seeded roster stubs with no real device). The placeholder's MEMBER
// IDENTITY is inherited onto the new personal device (so any member_roles grant on that
// member becomes usable from the personal device — e.g. a 동산지기/super whose only record
// was a ROSTER stub can now sign in), its attendance history is migrated, the legacy
// admin_devices entry is remapped, and the placeholders are deleted so the member has a
// single canonical device record. No-op unless devId is a personal (non-ROSTER) id and
// ROSTER- stubs for the name exist.
async function supersedeRosterPlaceholders(sb: SB, name: string, devId: string) {
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
async function addAudit(sb: SB, action: string, adminId: string, details: any) {
  try {
    const {data:d}=await sb.from("devices").select("name").eq("id",adminId).single();
    await sb.from("audit_log").insert({ts:Date.now(),action,admin_id:adminId,admin_name:d?.name||adminId,details:typeof details==="string"?{info:details}:details});
  } catch(_){}
}

async function buildCsvLog(sb: SB, gf: string, sf: string) {
  const [{data:logs},{data:devs}]=await Promise.all([
    (()=>{let q:any=sb.from("attendance_log").select("*").order("ts",{ascending:false});if(gf)q=q.eq("group_name",gf);if(sf)q=q.eq("subgroup",sf);return q;})(),
    sb.from("devices").select("*")
  ]);
  const dm: Record<string,any>={}; (devs||[]).forEach((d:any)=>{dm[d.id]=d;});
  const allLogs=(await sb.from("attendance_log").select("device_id,name,date")).data||[];
  const nt: Record<string,Set<string>>={};
  for(const e of allLogs){const nm=dm[e.device_id]?.name||e.name||"";if(!nt[nm])nt[nm]=new Set();nt[nm].add(e.date);}
  const h=["Name","Group","Subgroup","Day","Date","Time","Total"];
  const r=(logs||[]).map((e:any)=>{ const dv=dm[e.device_id]; const nm=dv?.name||e.name||""; const day=new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{timeZone:"America/New_York",weekday:"long"}); return [nm,dv?.group_name||e.group_name||"",dv?.subgroup||e.subgroup||"",day,e.date,e.time_str||"",nt[nm]?.size||0]; });
  const q='"',qq='""';
  return [h,...r].map((row:any[])=>row.map((c:any)=>q+String(c).replace(/"/g,qq)+q).join(",")).join("\n");
}
async function buildCsvGrid(sb: SB, gf: string, sf: string) {
  let dq: any=sb.from("devices").select("*"); if(gf) dq=dq.eq("group_name",gf); if(sf) dq=dq.eq("subgroup",sf);
  const {data:devs}=await dq;
  const members: Record<string,{group:string;subgroup:string;devices:string[]}>={};
  (devs||[]).forEach((d:any)=>{if(!members[d.name])members[d.name]={group:d.group_name||"",subgroup:d.subgroup||"",devices:[]};members[d.name].devices.push(d.id);});
  const names=Object.keys(members).sort();
  let lq: any=sb.from("attendance_log").select("*").order("date",{ascending:true}); if(gf) lq=lq.eq("group_name",gf); if(sf) lq=lq.eq("subgroup",sf);
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
  const ok=(obj:any)=>new Response(JSON.stringify(obj),{headers:{...CORS,"Content-Type":"application/json"}});
  const fail=(code:number,msg:string)=>new Response(JSON.stringify({error:msg}),{status:code,headers:{...CORS,"Content-Type":"application/json"}});
  let body: any={};
  if(req.method!=="GET"&&req.method!=="DELETE"){try{body=await req.json();}catch(_){}}
  try {
    if(req.method==="GET"&&p==="/api/health") return ok({status:"ok",ts:Date.now()});

    if(req.method==="GET"&&p==="/api/data") {
      // Hardened: the full dump is super-admin only — closes the legacy world-readable PII hole.
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Not authorized");
      const [{data:devData},{data:logData}]=await Promise.all([sb.from("devices").select("*"),sb.from("attendance_log").select("*").order("ts",{ascending:false})]);
      const devices: Record<string,any>={}; (devData||[]).forEach((d:any)=>{devices[d.id]=rowToDev(d);});
      return ok({devices,log:(logData||[]).map(rowToLog)});
    }

    // ── Hardened admin auth: Google JWT, or the master password from ANY device (break-glass) ──
    if(req.method==="POST"&&p==="/api/admin/verify") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      return ok({role:role.role,group:role.group,subgroup:role.subgroup,ministry:role.ministry});
    }

    // Scoped roster (replaces the world-readable /api/data for staff): super/pastor → all
    // members; leader → their 동산 (summer-mode 합동 handled by scopeFilter).
    if(req.method==="GET"&&p==="/api/roster") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
      let mq:any=sb.from("members").select("*").order("name",{ascending:true});
      if(!scope.all){mq=mq.in("group_name",scope.groups);if(scope.subgroup)mq=mq.eq("subgroup",scope.subgroup);}
      const {data:members}=await mq;
      const ids=(members||[]).map((m:any)=>m.id);
      const {data:md}=ids.length?await sb.from("attendance_log").select("*").in("member_id",ids).order("ts",{ascending:false}):{data:[] as any[]};
      let logs:any[]=md||[];
      // 방문자(guests) have no member_id and no 부서/동산, so the member-id filter above
      // drops them. Fold them in for unscoped admins (super/pastor) so they appear in — and
      // count toward — the 오늘 tab; scoped leaders keep just their 동산 (guests aren't theirs).
      if(scope.all){const {data:gd}=await sb.from("attendance_log").select("*").eq("is_guest",true).order("ts",{ascending:false});if(gd&&gd.length)logs=logs.concat(gd);}
      // Bulk 동산 reassignment: super-admins + staff + leaders who are NOT 동산지기/부동산지기.
      // Clear-all-attendance: super (direct) + staff/leader/welcoming non-동산지기 (request).
      // staff (break-glass 리더+새가족팀) has no 동산지기 tag, so it gets both.
      let canBulkSubgroup=role.role==="super_admin"||role.role==="staff";
      let canClearAttendance=role.role==="super_admin"||role.role==="staff";
      if(role.role==="leader"||role.role==="welcoming"){
        const {data:me}=await sb.from("members").select("name").eq("id",role.memberId).single();
        const tag=isDongsanLeaderName((me as any)?.name||"",role.group,role.subgroup,cfg.dongsan_leaders,!!cfg.summer_mode);
        if(role.role==="leader") canBulkSubgroup=!tag;
        canClearAttendance=!tag;
      }
      return ok({role:role.role,canBulkSubgroup,canClearAttendance,members:members||[],log:(logs||[]).map(rowToLog)});
    }

    // Settings (super-admin only): the adjustable check-in window — day(s) + start/end.
    if(req.method==="POST"&&p==="/api/admin/settings") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {checkinDays,checkinStartMin,checkinEndMin,announcement,summerMode,demoMode,individualCheckinEnabled,requireApproval}=body;
      const upd: any={updated_at:new Date().toISOString()};
      if(checkinDays!==undefined) upd.checkin_days=checkinDays;
      if(checkinStartMin!==undefined) upd.checkin_start_min=Number(checkinStartMin);
      if(checkinEndMin!==undefined) upd.checkin_end_min=Number(checkinEndMin);
      if(announcement!==undefined) upd.announcement=announcement;
      if(summerMode!==undefined) upd.summer_mode=!!summerMode;
      if(demoMode!==undefined) upd.demo_mode=!!demoMode;
      if(individualCheckinEnabled!==undefined) upd.individual_checkin_enabled=!!individualCheckinEnabled;
      if(requireApproval!==undefined) upd.require_approval=!!requireApproval;
      await sb.from("config").update(upd).eq("id",1);
      return ok({status:"ok"});
    }

    // 동산 (dongsan) names editor — read (super-admin only). Returns config.dongsan_names,
    // shaped { "대학부": [...], "청년부": [...] }, falling back to the seeded defaults.
    if(req.method==="GET"&&p==="/api/admin/dongsan-names") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const cfg=await getCfg(sb);
      return ok({names:cfg.dongsan_names||{"대학부":["동산1","동산2","동산3","동산4"],"청년부":["동산1","동산2","동산3","동산4"]}});
    }

    // 동산 names editor — write (super-admin only). Replaces config.dongsan_names with the
    // posted map { [group]: string[] }. Audited as a config-change.
    if(req.method==="POST"&&p==="/api/admin/dongsan-names") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {names}=body;
      if(!names||typeof names!=="object"||Array.isArray(names)) return fail(400,"names map required");
      await sb.from("config").update({dongsan_names:names,updated_at:new Date().toISOString()}).eq("id",1);
      await addAudit(sb,"config-change",xDev,"동산 이름 수정");
      return ok({status:"ok"});
    }

    // 동산지기/부동산지기 display roles — read (any verified admin, so leaders/pastor/
    // welcoming also see the 👑/⭐ badges on member cards + the Today list). Returns the
    // full config.dongsan_leaders map { [group|"합동"]: { [동산]: { leader, subLeaders } } }.
    if(req.method==="GET"&&p==="/api/admin/dongsan-leaders") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      const cfg=await getCfg(sb);
      return ok({leaders:cfg.dongsan_leaders||{}});
    }

    // 동산지기/부동산지기 editor — write one 동산's leader + sub-leaders (super-admin only).
    // Mirrors the legacy /api/dongsan-leaders shape; in summer mode the group key is "합동".
    // Audited as a config-change.
    if(req.method==="POST"&&p==="/api/admin/dongsan-leaders") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {group,subgroup,leader,subLeaders}=body;
      if(!group||!subgroup) return fail(400,"group and subgroup required");
      const cfg=await getCfg(sb); const ldrs=cfg.dongsan_leaders||{}; if(!ldrs[group]) ldrs[group]={};
      ldrs[group][subgroup]={leader:leader||"",subLeaders:Array.isArray(subLeaders)?subLeaders:[]};
      await sb.from("config").update({dongsan_leaders:ldrs,updated_at:new Date().toISOString()}).eq("id",1);
      await addAudit(sb,"config-change",xDev,"동산지기 수정: "+group+" "+subgroup);
      return ok({status:"ok"});
    }

    // 임원 display-badge roster — read (any verified admin, so the 🎖️ badge shows for
    // everyone who can see the roster). Returns config.officers as a name list.
    if(req.method==="GET"&&p==="/api/admin/officers") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      const cfg=await getCfg(sb);
      return ok({officers:Array.isArray(cfg.officers)?cfg.officers:[]});
    }

    // 임원 editor — replace the whole officer name list (super-admin only). Audited as a
    // config-change. A display badge like 동산지기, independent of admin roles.
    if(req.method==="POST"&&p==="/api/admin/officers") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {officers}=body;
      if(!Array.isArray(officers)||officers.some((n:any)=>typeof n!=="string")) return fail(400,"officers array required");
      const clean=Array.from(new Set(officers.map((n:string)=>n.trim()).filter((n:string)=>n.length>0)));
      await sb.from("config").update({officers:clean,updated_at:new Date().toISOString()}).eq("id",1);
      await addAudit(sb,"config-change",xDev,"임원 수정");
      return ok({status:"ok"});
    }

    // List all admin role grants (member_roles ⨝ member names). Super-admin only.
    if(req.method==="GET"&&p==="/api/admin/roles") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {data:roles}=await sb.from("member_roles").select("*");
      const ids=(roles||[]).map((r:any)=>r.member_id);
      const {data:mem}=ids.length?await sb.from("members").select("id,name").in("id",ids):{data:[] as any[]};
      const nameById: Record<string,string>={}; (mem||[]).forEach((m:any)=>{nameById[m.id]=m.name;});
      return ok({roles:(roles||[]).map((r:any)=>({memberId:r.member_id,name:nameById[r.member_id]||"—",role:r.role,group:r.group_name||"",subgroup:r.subgroup||"",ministry:r.ministry||""}))});
    }

    // Audit log — most recent admin actions, newest first. Super-admin only.
    if(req.method==="GET"&&p==="/api/admin/audit") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const limit=Math.min(parseInt(url.searchParams.get("limit")||"100")||100,200);
      const {data:log}=await sb.from("audit_log").select("*").order("ts",{ascending:false}).limit(limit);
      return ok({log:(log||[]).map((e:any)=>({ts:e.ts,action:e.action,adminName:e.admin_name,details:e.details}))});
    }

    // Full v2 JSON snapshot — devices, log, config, events, audit, pending. Super-admin
    // only. Reuses the legacy /api/backup builder's exact shape so a backup taken here is
    // interchangeable with the legacy one (and restorable through /api/admin/restore).
    if(req.method==="GET"&&p==="/api/admin/backup") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const [{data:dd},{data:ld},{data:ed},{data:ad},{data:pd},cfg]=await Promise.all([sb.from("devices").select("*"),sb.from("attendance_log").select("*").order("ts",{ascending:false}),sb.from("events").select("*, event_attendees(device_id, name)"),sb.from("audit_log").select("*").order("ts",{ascending:false}),sb.from("pending_registrations").select("*"),getCfg(sb)]);
      const devices: Record<string,any>={}; (dd||[]).forEach((d:any)=>{devices[d.id]=rowToDev(d);});
      const bk={version:2,exportedAt:Date.now(),attendance:{devices,log:(ld||[]).map(rowToLog)},config:{adminDevices:cfg.admin_devices||[],nameOrder:cfg.name_order||[],dongsanNames:cfg.dongsan_names,checkinDays:cfg.checkin_days||[0],checkinStartMin:cfg.checkin_start_min??780,checkinEndMin:cfg.checkin_end_min??900,dongsanLeaders:cfg.dongsan_leaders||{},requireApproval:cfg.require_approval||false,announcement:cfg.announcement||"",individualCheckinEnabled:cfg.individual_checkin_enabled||false},events:{events:(ed||[]).map((e:any)=>({id:e.id,name:e.name,date:e.date,type:e.type,group:e.group_name,notes:e.notes,createdBy:e.created_by,createdAt:new Date(e.created_at).getTime(),attendees:(e.event_attendees||[]).map((a:any)=>a.name||a.device_id)}))},audit:(ad||[]).map((e:any)=>({ts:e.ts,action:e.action,adminId:e.admin_id,adminName:e.admin_name,details:e.details})),pending:(pd||[]).map((p:any)=>({deviceId:p.device_id,name:p.name,group:p.group_name,subgroup:p.subgroup,requestedAt:new Date(p.requested_at).getTime()}))};
      return new Response(JSON.stringify(bk,null,2),{headers:{...CORS,"Content-Type":"application/json","Content-Disposition":'attachment; filename="kccp-backup-'+localDate()+'.json"'}});
    }

    // Destructive restore from a posted v2 snapshot — replaces devices, attendance_log,
    // config, and events wholesale. Super-admin only. Reuses the legacy /api/restore
    // logic; writes a `restore` audit entry.
    if(req.method==="POST"&&p==="/api/admin/restore") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const bk=body; if(!bk.version||!bk.attendance) return fail(400,"Invalid backup file");
      if(bk.attendance?.devices){await sb.from("devices").delete().neq("id","");const dr=Object.entries(bk.attendance.devices).map(([id,v]:any)=>({id,name:v.name,group_name:v.group||"",subgroup:v.subgroup||"",notes:v.notes||"",member_role:v.memberRole||"",gender:v.gender||"",phone:v.phone||"",birth_date:v.birthDate||null,baptism_status:v.baptismStatus||"해당없음",school_or_work:v.schoolOrWork||"",faith_duration:v.faithDuration||"",registration_date:v.registrationDate||null,pastoral_visit_requested:v.pastoralVisitRequested||false,is_new_member:v.isNewMember||false,new_member_edu_week1:v.newMemberEduWeek1||false,new_member_edu_week2:v.newMemberEduWeek2||false}));if(dr.length) await sb.from("devices").insert(dr);}
      if(bk.attendance?.log){await sb.from("attendance_log").delete().neq("id",0);const lr=bk.attendance.log.map((e:any)=>({device_id:e.deviceId,name:e.name,group_name:e.group||"",subgroup:e.subgroup||"",date:e.date,time_str:e.time,ts:e.ts,location_verified:!!e.locationVerified,admin_added:!!e.adminAdded,first_visit:!!e.firstVisit,is_manual:!!e.manual,is_bulk:!!e.bulk,is_guest:!!e.guest,member_role:e.memberRole||null}));if(lr.length) await sb.from("attendance_log").insert(lr);}
      if(bk.config){const c=bk.config;await sb.from("config").update({admin_devices:c.adminDevices||[],name_order:c.nameOrder||[],dongsan_names:c.dongsanNames,checkin_days:c.checkinDays||[0],checkin_start_min:c.checkinStartMin??780,checkin_end_min:c.checkinEndMin??900,dongsan_leaders:c.dongsanLeaders||{},require_approval:c.requireApproval||false,announcement:c.announcement||"",individual_checkin_enabled:c.individualCheckinEnabled||false}).eq("id",1);}
      if(bk.events?.events){await sb.from("events").delete().neq("id","");for(const e of bk.events.events){await sb.from("events").insert({id:e.id,name:e.name,date:e.date,type:e.type||"기타",group_name:e.group||"",notes:e.notes||"",created_by:e.createdBy,created_at:e.createdAt?new Date(e.createdAt).toISOString():new Date().toISOString()});if(e.attendees?.length) await sb.from("event_attendees").insert(e.attendees.map((a:string)=>({event_id:e.id,device_id:"NAME-"+a,name:a})));}}
      await addAudit(sb,"restore",xDev,"Restored backup from "+(bk.exportedAt?new Date(bk.exportedAt).toLocaleString("ko-KR",{timeZone:"America/New_York"}):"unknown"));
      return ok({status:"ok"});
    }

    // Pending self-registrations (when require_approval is on). Any verified admin may
    // view; pastor is read-only for the approve/reject mutations below.
    if(req.method==="GET"&&p==="/api/admin/pending") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      const {data:pd}=await sb.from("pending_registrations").select("*").order("requested_at",{ascending:false});
      return ok({pending:(pd||[]).map((p:any)=>({deviceId:p.device_id,name:p.name,group:p.group_name||"",subgroup:p.subgroup||"",requestedAt:new Date(p.requested_at).getTime()}))});
    }

    // Approve a pending registration: find-or-create the member, link the device to it,
    // then clear the pending row. Audited.
    if(req.method==="POST"&&p==="/api/admin/pending/approve") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {deviceId}=body; if(!deviceId) return fail(400,"deviceId required");
      const {data:pr}=await sb.from("pending_registrations").select("*").eq("device_id",deviceId).single();
      if(!pr) return fail(404,"Not found in pending list");
      const {data:mm}=await sb.from("members").select("id").eq("name",pr.name).limit(1);
      let memberId=mm&&mm.length?mm[0].id:null;
      if(!memberId){
        const {data:nm}=await sb.from("members").insert({name:pr.name,group_name:pr.group_name||"",subgroup:pr.subgroup||""}).select("id").single();
        memberId=(nm as {id?:string}|null)?.id||null;
      }
      await sb.from("devices").upsert({id:pr.device_id,name:pr.name,group_name:pr.group_name||"",subgroup:pr.subgroup||"",member_id:memberId});
      await sb.from("pending_registrations").delete().eq("device_id",deviceId);
      await addAudit(sb,"pending-approve",xDev,pr.name+" ("+pr.device_id+")");
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/admin/pending/reject") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {deviceId}=body; if(!deviceId) return fail(400,"deviceId required");
      const {data:pr}=await sb.from("pending_registrations").select("name").eq("device_id",deviceId).single();
      await sb.from("pending_registrations").delete().eq("device_id",deviceId);
      await addAudit(sb,"pending-reject",xDev,((pr as {name?:string}|null)?.name||deviceId)+" ("+deviceId+")");
      return ok({status:"ok"});
    }

    // Assign/replace a member's admin role (super-admin only). Upsert into member_roles.
    if(req.method==="POST"&&p==="/api/admin/role/set") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {memberId,role:newRole,group,subgroup,ministry}=body;
      if(!memberId||!newRole) return fail(400,"memberId and role required");
      if(!["super_admin","leader","pastor","welcoming"].includes(newRole)) return fail(400,"Invalid role");
      const {data:m}=await sb.from("members").select("name").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      await sb.from("member_roles").upsert({member_id:memberId,role:newRole,group_name:group||"",subgroup:subgroup||"",ministry:ministry||""});
      await addAudit(sb,"admin-add",xDev,(m as {name?:string}).name+" → "+newRole);
      return ok({status:"ok"});
    }

    // Revoke a member's admin role (super-admin only). Refuses to remove the last super.
    if(req.method==="POST"&&p==="/api/admin/role/remove") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const {memberId}=body; if(!memberId) return fail(400,"memberId required");
      const {data:tr}=await sb.from("member_roles").select("role").eq("member_id",memberId).single();
      if(!tr) return ok({status:"ok"});
      if((tr as {role?:string}).role==="super_admin"){
        const {count}=await sb.from("member_roles").select("member_id",{count:"exact",head:true}).eq("role","super_admin");
        if((count||0)<=1) return fail(400,"Cannot remove the last super admin");
      }
      const {data:m}=await sb.from("members").select("name").eq("id",memberId).single();
      await sb.from("member_roles").delete().eq("member_id",memberId);
      await addAudit(sb,"admin-remove",xDev,((m as {name?:string}|null)?.name||memberId)+"");
      return ok({status:"ok"});
    }

    // Edit a member. Pastor is read-only; a leader may only edit members in their own
    // 동산 (scope-checked). Renames propagate to the denormalized devices/attendance names.
    if(req.method==="PUT"&&p==="/api/admin/member") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberId}=body; if(!memberId) return fail(400,"memberId required");
      const {data:m}=await sb.from("members").select("name,group_name,subgroup").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      if(role.role!=="super_admin"){
        const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
        if(!scope.all){
          if(!scope.groups.includes(m.group_name)) return fail(403,"Out of scope");
          if(scope.subgroup&&m.subgroup!==scope.subgroup) return fail(403,"Out of scope");
        }
      }
      const COLS: Record<string,string>={name:"name",group:"group_name",subgroup:"subgroup",notes:"notes",memberRole:"member_role",gender:"gender",phone:"phone",birthDate:"birth_date",baptismStatus:"baptism_status",schoolOrWork:"school_or_work",faithDuration:"faith_duration",registrationDate:"registration_date",pastoralVisitRequested:"pastoral_visit_requested",isNewMember:"is_new_member",newMemberEduWeek1:"new_member_edu_week1",newMemberEduWeek2:"new_member_edu_week2",kakaoId:"kakao_id",statusNote:"status_note",statusStart:"status_start",statusEnd:"status_end"};
      const DATE_COLS=new Set(["birth_date","registration_date","status_start","status_end"]);
      const upd: any={updated_at:new Date().toISOString()};
      for(const [k,col] of Object.entries(COLS)){ if(body[k]!==undefined) upd[col]=DATE_COLS.has(col)?(body[k]||null):body[k]; }
      await sb.from("members").update(upd).eq("id",memberId);
      if(body.name!==undefined&&body.name!==m.name){
        await sb.from("devices").update({name:body.name}).eq("member_id",memberId);
        await sb.from("attendance_log").update({name:body.name}).eq("member_id",memberId);
      }
      await addAudit(sb,"member-edit",xDev,(body.name||m.name)+" ("+memberId+")");
      return ok({status:"ok"});
    }

    // Merge two members: reassign the source's devices + attendance into the target
    // (inheriting the target's name/group/동산), then delete the source member. Scoped
    // (a leader may only merge members in their own 동산); pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/merge") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {fromId,toId}=body; if(!fromId||!toId||fromId===toId) return fail(400,"fromId and a different toId required");
      const {data:from}=await sb.from("members").select("name,group_name,subgroup").eq("id",fromId).single();
      const {data:to}=await sb.from("members").select("name,group_name,subgroup").eq("id",toId).single();
      if(!from||!to) return fail(404,"Member not found");
      if(role.role!=="super_admin"){
        const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
        if(!scope.all){
          for(const mm of [from,to]){
            if(!scope.groups.includes(mm.group_name)) return fail(403,"Out of scope");
            if(scope.subgroup&&mm.subgroup!==scope.subgroup) return fail(403,"Out of scope");
          }
        }
      }
      // Reassign BEFORE deleting (devices.member_id is ON DELETE CASCADE). Migrated rows
      // inherit the target's denormalized name/group/동산 — matches the legacy merge.
      const denorm={name:to.name,group_name:to.group_name||"",subgroup:to.subgroup||""};
      await sb.from("devices").update({member_id:toId,...denorm}).eq("member_id",fromId);
      await sb.from("attendance_log").update({member_id:toId,...denorm}).eq("member_id",fromId);
      await sb.from("members").delete().eq("id",fromId);
      await addAudit(sb,"member-merge",xDev,from.name+" → "+to.name);
      return ok({status:"ok"});
    }

    // Delete a member entirely: removes their attendance rows + the member (devices and
    // member_roles cascade via FK). Scoped (a leader may only delete members in their own
    // 동산); pastor read-only; audited. Irreversible.
    if(req.method==="POST"&&p==="/api/admin/member/delete") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberId}=body; if(!memberId) return fail(400,"memberId required");
      const {data:m}=await sb.from("members").select("name,group_name,subgroup").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      if(role.role!=="super_admin"){
        const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
        if(!scope.all){
          if(!scope.groups.includes(m.group_name)) return fail(403,"Out of scope");
          if(scope.subgroup&&m.subgroup!==scope.subgroup) return fail(403,"Out of scope");
        }
      }
      // attendance_log.member_id is ON DELETE SET NULL, so the member's rows would orphan
      // (and keep counting) — delete them explicitly. devices + member_roles cascade.
      await sb.from("attendance_log").delete().eq("member_id",memberId);
      await sb.from("members").delete().eq("id",memberId);
      await addAudit(sb,"member-delete",xDev,m.name+" ("+memberId+")");
      return ok({status:"ok"});
    }

    // Bulk 동산 (subgroup) reassignment: set or clear the 동산 for many members at once.
    // Allowed for super-admin OR a leader who is NOT a 동산지기/부동산지기. Out-of-scope
    // members are dropped server-side; subgroup "" removes them from any 동산. Audited.
    if(req.method==="POST"&&p==="/api/admin/members/bulk-subgroup") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      const cfg=await getCfg(sb);
      // super + staff (break-glass, all-access) may bulk-transfer freely; a leader may too
      // unless they're a 동산지기/부동산지기. Everyone else is rejected.
      if(role.role!=="super_admin"&&role.role!=="staff"){
        if(role.role!=="leader") return fail(403,"Not authorized");
        const {data:me}=await sb.from("members").select("name").eq("id",role.memberId).single();
        if(isDongsanLeaderName((me as any)?.name||"",role.group,role.subgroup,cfg.dongsan_leaders,!!cfg.summer_mode)) return fail(403,"동산지기/부동산지기는 사용할 수 없습니다");
      }
      const {memberIds,subgroup}=body;
      if(!Array.isArray(memberIds)||!memberIds.length) return fail(400,"memberIds required");
      const sub=(subgroup||"").trim();
      let targetIds: string[]=memberIds;
      if(role.role!=="super_admin"){
        const scope=scopeFilter(role,!!cfg.summer_mode);
        if(!scope.all){
          const {data:ms}=await sb.from("members").select("id,group_name,subgroup").in("id",memberIds);
          targetIds=(ms||[]).filter((m:any)=>scope.groups.includes(m.group_name)&&(!scope.subgroup||m.subgroup===scope.subgroup)).map((m:any)=>m.id);
        }
      }
      if(!targetIds.length) return ok({status:"ok",updated:0});
      const ts=new Date().toISOString();
      await sb.from("members").update({subgroup:sub,updated_at:ts}).in("id",targetIds);
      await sb.from("devices").update({subgroup:sub}).in("member_id",targetIds);
      await sb.from("attendance_log").update({subgroup:sub}).in("member_id",targetIds);
      await addAudit(sb,"bulk-transfer",xDev,targetIds.length+"명 → 동산 "+(sub||"(해제)"));
      return ok({status:"ok",updated:targetIds.length});
    }

    // Clear ALL attendance records. Super-admin clears immediately; a non-super admin
    // (leader/welcoming who is NOT a 동산지기/부동산지기) files a request held for super
    // approval. Audited either way.
    if(req.method==="POST"&&p==="/api/admin/attendance/clear") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="super_admin"){
        await sb.from("attendance_log").delete().neq("id",0);
        await addAudit(sb,"clear-attendance",xDev,"모든 출석 기록 삭제");
        return ok({status:"cleared"});
      }
      // staff (break-glass 리더+새가족팀) is non-super, so like leader/welcoming it files a
      // request for super approval rather than clearing directly.
      if(role.role!=="leader"&&role.role!=="welcoming"&&role.role!=="staff") return fail(403,"Not authorized");
      const cfg=await getCfg(sb);
      const {data:me}=await sb.from("members").select("name").eq("id",role.memberId).single();
      if(isDongsanLeaderName((me as any)?.name||"",role.group,role.subgroup,cfg.dongsan_leaders,!!cfg.summer_mode)) return fail(403,"동산지기/부동산지기는 사용할 수 없습니다");
      const pending=Array.isArray(cfg.pending_clear)?cfg.pending_clear:[];
      pending.push({requestedBy:xDev,requestedByName:(me as any)?.name||xDev,requestedAt:Date.now()});
      await sb.from("config").update({pending_clear:pending}).eq("id",1);
      await addAudit(sb,"clear-requested",xDev,"출석 기록 삭제 요청");
      return ok({status:"pending"});
    }

    // Pending clear-all requests (super-admin only).
    if(req.method==="GET"&&p==="/api/admin/attendance/clear-pending") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      const cfg=await getCfg(sb);
      return ok({pending:Array.isArray(cfg.pending_clear)?cfg.pending_clear:[]});
    }

    // Approve pending clear → delete ALL attendance + empty the queue (super-admin only).
    if(req.method==="POST"&&p==="/api/admin/attendance/clear-approve") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      await sb.from("attendance_log").delete().neq("id",0);
      await sb.from("config").update({pending_clear:[]}).eq("id",1);
      await addAudit(sb,"clear-attendance",xDev,"모든 출석 기록 삭제 (요청 승인)");
      return ok({status:"cleared"});
    }

    // Reject/dismiss pending clear requests (super-admin only).
    if(req.method==="POST"&&p==="/api/admin/attendance/clear-reject") {
      const role=await resolveAdmin(sb,req);
      if(role?.role!=="super_admin") return fail(403,"Super admin required");
      await sb.from("config").update({pending_clear:[]}).eq("id",1);
      await addAudit(sb,"clear-rejected",xDev,"출석 기록 삭제 요청 거절");
      return ok({status:"ok"});
    }

    // Manual check-in (hardened, member-id based): mark a member present for today,
    // bypassing day/time/location. Scoped (a leader may only check in members in their
    // own 동산); pastor read-only; audited. Distinct from the legacy name-based
    // /api/admin/checkin used by the old client.
    if(req.method==="POST"&&p==="/api/admin/member-checkin") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberId}=body; if(!memberId) return fail(400,"memberId required");
      const {data:m}=await sb.from("members").select("name,group_name,subgroup,member_role").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      if(role.role!=="super_admin"){
        const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
        if(!scope.all){
          if(!scope.groups.includes(m.group_name)) return fail(403,"Out of scope");
          if(scope.subgroup&&m.subgroup!==scope.subgroup) return fail(403,"Out of scope");
        }
      }
      const today=localDate(),time=localTime();
      const {data:exist}=await sb.from("attendance_log").select("time_str").eq("member_id",memberId).eq("date",today).limit(1);
      if(exist&&exist.length) return ok({status:"already",time:exist[0].time_str,name:m.name});
      const {count}=await sb.from("attendance_log").select("id",{count:"exact",head:true}).eq("member_id",memberId);
      const isFirst=(count||0)===0;
      const {data:dev}=await sb.from("devices").select("id").eq("member_id",memberId).limit(1);
      const did=(dev&&dev.length)?dev[0].id:("MANUAL-"+Date.now());
      await sb.from("attendance_log").insert({device_id:did,member_id:memberId,name:m.name,group_name:m.group_name||"",subgroup:m.subgroup||"",date:today,time_str:time,ts:Date.now(),is_manual:true,admin_added:true,first_visit:isFirst,member_role:m.member_role||null});
      await addAudit(sb,"admin-checkin",xDev,m.name+" | "+today);
      return ok({status:"ok",time,name:m.name,firstVisit:isFirst});
    }

    // Manual attendance — add an entry for a member on ANY date (back-fill). Hardened,
    // member-id based, scoped; pastor read-only; deduped by member_id+date; audited.
    if(req.method==="POST"&&p==="/api/admin/log/add") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberId,date}=body; if(!memberId||!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400,"memberId and a YYYY-MM-DD date required");
      const {data:m}=await sb.from("members").select("name,group_name,subgroup,member_role").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      if(role.role!=="super_admin"){
        const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
        if(!scope.all){
          if(!scope.groups.includes(m.group_name)) return fail(403,"Out of scope");
          if(scope.subgroup&&m.subgroup!==scope.subgroup) return fail(403,"Out of scope");
        }
      }
      const {data:exist}=await sb.from("attendance_log").select("id").eq("member_id",memberId).eq("date",date).limit(1);
      if(exist&&exist.length) return ok({status:"already"});
      const {data:dev}=await sb.from("devices").select("id").eq("member_id",memberId).limit(1);
      const did=(dev&&dev.length)?dev[0].id:("MANUAL-"+Date.now());
      await sb.from("attendance_log").insert({device_id:did,member_id:memberId,name:m.name,group_name:m.group_name||"",subgroup:m.subgroup||"",date,time_str:localTime(),ts:Date.now(),is_manual:true,admin_added:true,member_role:m.member_role||null});
      await addAudit(sb,"manual-add",xDev,m.name+" | "+date);
      return ok({status:"ok"});
    }

    // Manual attendance — remove a single entry by its row id. Hardened: scope-checks the
    // entry's member; pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/log/remove") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {logId}=body; if(logId===undefined||logId===null) return fail(400,"logId required");
      const {data:row}=await sb.from("attendance_log").select("id,name,date,member_id").eq("id",logId).single();
      if(!row) return fail(404,"Entry not found");
      if(role.role!=="super_admin"&&row.member_id){
        const {data:m}=await sb.from("members").select("group_name,subgroup").eq("id",row.member_id).single();
        const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
        if(m&&!scope.all){
          if(!scope.groups.includes(m.group_name)) return fail(403,"Out of scope");
          if(scope.subgroup&&m.subgroup!==scope.subgroup) return fail(403,"Out of scope");
        }
      }
      await sb.from("attendance_log").delete().eq("id",logId);
      await addAudit(sb,"manual-remove",xDev,row.name+" | "+row.date);
      return ok({status:"ok"});
    }

    // Bulk attendance — add an entry for many members on a chosen date. Hardened,
    // member-id based; pastor read-only; out-of-scope members are silently dropped;
    // members already present on that date are skipped; audited. Returns the count added.
    if(req.method==="POST"&&p==="/api/admin/log/add-bulk") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {memberIds,date}=body;
      if(!Array.isArray(memberIds)||!memberIds.length||!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400,"memberIds[] and a YYYY-MM-DD date required");
      const {data:mem}=await sb.from("members").select("id,name,group_name,subgroup,member_role").in("id",memberIds);
      let scoped=mem||[];
      if(role.role!=="super_admin"){
        const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
        if(!scope.all) scoped=scoped.filter((m:any)=>scope.groups.includes(m.group_name)&&(!scope.subgroup||m.subgroup===scope.subgroup));
      }
      if(!scoped.length) return ok({status:"ok",added:0});
      const ids=scoped.map((m:any)=>m.id);
      const {data:existing}=await sb.from("attendance_log").select("member_id").in("member_id",ids).eq("date",date);
      const have=new Set((existing||[]).map((e:any)=>e.member_id));
      const toAdd=scoped.filter((m:any)=>!have.has(m.id));
      if(toAdd.length){
        const {data:devs}=await sb.from("devices").select("id,member_id").in("member_id",toAdd.map((m:any)=>m.id));
        const devByMember: Record<string,string>={}; (devs||[]).forEach((d:any)=>{if(!devByMember[d.member_id])devByMember[d.member_id]=d.id;});
        const now=Date.now();
        const rows=toAdd.map((m:any,i:number)=>({device_id:devByMember[m.id]||("MANUAL-"+(now+i)),member_id:m.id,name:m.name,group_name:m.group_name||"",subgroup:m.subgroup||"",date,time_str:localTime(),ts:now+i,is_manual:true,is_bulk:true,admin_added:true,member_role:m.member_role||null}));
        await sb.from("attendance_log").insert(rows);
      }
      await addAudit(sb,"bulk-add",xDev,date+" | "+toAdd.length+" members");
      return ok({status:"ok",added:toAdd.length});
    }

    // Register a device (Devices tab 2.4): find-or-create the member by name (creating
    // it with the given 부서/동산 when new), then upsert a devices row linked to that
    // member with the denormalized name/group/동산. Any device (real or ROSTER) id is
    // allowed; ROSTER placeholders for the name are superseded. Pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/device/register") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {deviceId,name,group,subgroup}=body;
      const did=(deviceId||"").trim(); const nm=(name||"").trim();
      if(!did||!nm) return fail(400,"deviceId and name required");
      const grp=(group||"").trim(),sub=(subgroup||"").trim();
      const {data:mm}=await sb.from("members").select("id").eq("name",nm).limit(1);
      let memberId=mm&&mm.length?mm[0].id:null;
      if(!memberId){
        const {data:created}=await sb.from("members").insert({name:nm,group_name:grp,subgroup:sub}).select("id").single();
        memberId=(created as {id?:string}|null)?.id||null;
      }
      await sb.from("devices").upsert({id:did,name:nm,group_name:grp,subgroup:sub,member_id:memberId});
      await supersedeRosterPlaceholders(sb,nm,did);
      await addAudit(sb,"device-register",xDev,nm+" ("+did+")");
      return ok({status:"ok"});
    }

    // Link a device to an existing member (Devices tab 2.5): point an existing-or-new
    // device id at the chosen member, inheriting that member's denormalized
    // name/group/동산 (the device row is created if it doesn't exist). ROSTER
    // placeholders for the name are superseded. Pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/device/link") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const {deviceId,memberId}=body;
      const did=(deviceId||"").trim();
      if(!did||!memberId) return fail(400,"deviceId and memberId required");
      const {data:m}=await sb.from("members").select("name,group_name,subgroup").eq("id",memberId).single();
      if(!m) return fail(404,"Member not found");
      if(role.role!=="super_admin"){
        const cfg=await getCfg(sb); const scope=scopeFilter(role,!!cfg.summer_mode);
        if(!scope.all){
          if(!scope.groups.includes(m.group_name)) return fail(403,"Out of scope");
          if(scope.subgroup&&m.subgroup!==scope.subgroup) return fail(403,"Out of scope");
        }
      }
      await sb.from("devices").upsert({id:did,name:m.name,group_name:m.group_name||"",subgroup:m.subgroup||"",member_id:memberId});
      await supersedeRosterPlaceholders(sb,m.name,did);
      await addAudit(sb,"device-edit",xDev,m.name+" ("+did+")");
      return ok({status:"ok"});
    }

    // Kiosk guest (방문자) check-in (Phase 3.7): the kiosk runs on a verified admin
    // device, so this is hardened (verifyAdmin) and bypasses day/time/location. Records a
    // visitor attendance row for today; deduped by name+date; pastor read-only; audited.
    // `group` (대학부/청년부) puts the visitor on that 부서's 오늘 sheet / 출석부 이미지;
    // anything else is stored as "" (unassigned) like the pre-group rows.
    if(req.method==="POST"&&p==="/api/admin/guest-checkin") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const name=(body.name||"").trim(); if(!name) return fail(400,"name required");
      const group=body.group==="대학부"||body.group==="청년부"?body.group:"";
      const today=localDate(),time=localTime();
      const {data:exist}=await sb.from("attendance_log").select("time_str").eq("name",name).eq("date",today).eq("is_guest",true).limit(1);
      if(exist&&exist.length) return ok({status:"already",time:exist[0].time_str,name});
      await sb.from("attendance_log").insert({device_id:"GUEST-"+Date.now(),name,group_name:group,subgroup:"",date:today,time_str:time,ts:Date.now(),is_manual:true,is_guest:true,member_role:"visitor"});
      await addAudit(sb,"guest-checkin",xDev,name+(group?" | "+group:"")+" | "+today);
      return ok({status:"ok",time,name});
    }

    // Kiosk 새가족 (new-family) registration (Phase 3.8): creates a member with
    // is_new_member=true and the extended profile fields, links a NEW-{ts} device, then
    // immediately records today's attendance (first_visit). Hardened (verifyAdmin);
    // pastor read-only; audited.
    if(req.method==="POST"&&p==="/api/admin/kiosk-new-member") {
      const role=await resolveAdmin(sb,req);
      if(!role) return fail(401,"Not authorized");
      if(role.role==="pastor") return fail(403,"Read-only");
      const name=(body.name||"").trim(); const group=(body.group||"").trim();
      if(!name||!group) return fail(400,"name and group required");
      const subgroup=(body.subgroup||"").trim();
      const today=localDate(),time=localTime();
      const {data:created}=await sb.from("members").insert({
        name,group_name:group,subgroup,is_new_member:true,
        gender:body.gender||"",phone:body.phone||"",kakao_id:body.kakaoId||"",
        birth_date:body.birthDate||null,baptism_status:body.baptismStatus||"해당없음",
        school_or_work:body.schoolOrWork||"",faith_duration:body.faithDuration||"",
        // 등록일자 defaults to the date the member is added but the operator may set it
        // explicitly (e.g. back-fill someone who joined earlier). Attendance percentages
        // count from this date.
        registration_date:(body.registrationDate||"").trim()||today,pastoral_visit_requested:!!body.pastoralVisitRequested,
      }).select("id").single();
      const memberId=(created as {id?:string}|null)?.id||null;
      if(!memberId) return fail(500,"Could not create member");
      const newId="NEW-"+Date.now();
      await sb.from("devices").insert({id:newId,name,group_name:group,subgroup,member_id:memberId,is_new_member:true});
      await sb.from("attendance_log").insert({device_id:newId,member_id:memberId,name,group_name:group,subgroup,date:today,time_str:time,ts:Date.now(),is_manual:true,admin_added:false,first_visit:true});
      await addAudit(sb,"new-member-register",xDev,name+" | "+group);
      return ok({status:"ok",memberId,time});
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

    if(req.method==="POST"&&p==="/api/checkin") {
      const {deviceId,lat,lng}=body;
      const [cfg,{data:device}]=await Promise.all([getCfg(sb),sb.from("devices").select("*").eq("id",deviceId).single()]);
      const allowedDays: number[]=cfg.checkin_days||[0]; const startMin: number=cfg.checkin_start_min??780; const endMin: number=cfg.checkin_end_min??900;
      if(!cfg.demo_mode){
        const now=new Date(); const eastern=new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"}));
        const day=eastern.getDay(),timeInMin=eastern.getHours()*60+eastern.getMinutes();
        const DAY=["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
        if(!allowedDays.includes(day)) return ok({status:"time-restricted",message:"출석 가능한 요일이 아닙니다",sub:"출석 가능 요일: "+allowedDays.map((d:number)=>DAY[d]).join(", ")});
        if(timeInMin<startMin||timeInMin>=endMin) return ok({status:"time-restricted",message:"출석 시간이 아닙니다",sub:"출석 가능 시간: "+fmtMin(startMin)+" ~ "+fmtMin(endMin)});
        const loc=checkLocation(lat,lng);
        if(loc==="required") return ok({status:"location-required",message:"위치 정보가 필요합니다. 위치 접근을 허용해주세요."});
        if(loc!==null) return ok({status:"location-restricted",message:"교회 근처에서만 출석할 수 있습니다.",distance:loc});
      }
      const today=localDate(),time=localTime(),ts=Date.now();
      const name=device?.name,group=device?.group_name||"",subgroup=device?.subgroup||"",memberRole=device?.member_role||"";
      if(name){const ex=await checkedToday(sb,name,today);if(ex){const total=await countAtt(sb,name);return ok({status:"already",time:ex.time_str,name,group,subgroup,totalAttendance:total});}}
      else{const {data:ex}=await sb.from("attendance_log").select("*").eq("device_id",deviceId).eq("date",today).limit(1);if(ex&&ex.length)return ok({status:"already",time:ex[0].time_str,name:ex[0].name,group:"",subgroup:"",totalAttendance:0});}
      const totalCount=name?await countAtt(sb,name):0; const isFirst=totalCount===0; const dname=name||("Unknown ("+deviceId.slice(0,12)+"...)");
      await sb.from("attendance_log").insert({device_id:deviceId,name:dname,group_name:group,subgroup,date:today,time_str:time,ts,location_verified:true,first_visit:isFirst,member_role:memberRole||null});
      return ok({status:"ok",time,name:dname,group,subgroup,isRegistered:!!name,totalAttendance:totalCount+1,firstVisit:isFirst});
    }

    if(req.method==="POST"&&p==="/api/self-register") {
      const {deviceId,name,group,subgroup}=body; if(!deviceId||!name) return fail(400,"deviceId and name required");
      const cleanName=name.trim();
      const {data:ex}=await sb.from("devices").select("id,name").eq("id",deviceId).single();
      if(ex) return ok({status:"already-registered",name:ex.name});
      // If a person with this name already exists, this device is being added for
      // access purposes — combine it with the existing record (inherit their
      // group/동산) instead of creating a divergent duplicate, and never flag it
      // as 새가족.
      const {data:matches}=await sb.from("devices").select("group_name,subgroup").eq("name",cleanName).limit(1);
      const match=matches&&matches.length?matches[0]:null;
      const finalGroup=match?(match.group_name||""):(group||"");
      const finalSub=match?(match.subgroup||""):(subgroup||"");
      const cfg=await getCfg(sb);
      if(cfg.require_approval){
        const {data:al}=await sb.from("pending_registrations").select("id").eq("device_id",deviceId).single();
        if(!al) await sb.from("pending_registrations").insert({device_id:deviceId,name:cleanName,group_name:finalGroup,subgroup:finalSub});
        return ok({status:"pending",name:cleanName});
      }
      // Link this device to the person's existing member (a linked device's member, else
      // the members row by name) so a returning admin's personal device inherits their
      // member — and any member_roles grant on it. supersede below also covers the ROSTER
      // stub case; this additionally handles a 2nd personal device (no stub left).
      let memberId: string|null=null;
      const {data:linked}=await sb.from("devices").select("member_id").eq("name",cleanName).not("member_id","is",null).limit(1);
      if(linked&&linked.length) memberId=(linked[0] as {member_id?:string}).member_id||null;
      else { const {data:mm}=await sb.from("members").select("id").eq("name",cleanName).limit(1); if(mm&&mm.length) memberId=(mm[0] as {id?:string}).id||null; }
      await sb.from("devices").upsert({id:deviceId,name:cleanName,group_name:finalGroup,subgroup:finalSub,is_new_member:false,member_id:memberId});
      await sb.from("attendance_log").update({name:cleanName,group_name:finalGroup,subgroup:finalSub}).eq("device_id",deviceId);
      await supersedeRosterPlaceholders(sb,cleanName,deviceId);
      return ok({status:"ok",name:cleanName,combined:!!match});
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

    if(req.method==="GET"&&p==="/api/config"){
      const cfg=await getCfg(sb);
      return ok({
        announcement:cfg.announcement||"",
        checkinDays:cfg.checkin_days||[0],
        checkinStartMin:cfg.checkin_start_min??780,
        checkinEndMin:cfg.checkin_end_min??900,
        requireApproval:cfg.require_approval||false,
        summerMode:cfg.summer_mode||false,
        demoMode:cfg.demo_mode||false,
        individualCheckinEnabled:cfg.individual_checkin_enabled||false,
      });
    }

    if(req.method==="POST"&&p==="/api/config") {
      const {announcement,checkinDays,checkinStartMin,checkinEndMin,requireApproval,summerMode,demoMode,individualCheckinEnabled,adminDeviceId}=body;
      if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const upd: any={updated_at:new Date().toISOString()};
      if(announcement!==undefined) upd.announcement=announcement; if(checkinDays!==undefined) upd.checkin_days=checkinDays;
      if(checkinStartMin!==undefined) upd.checkin_start_min=Number(checkinStartMin); if(checkinEndMin!==undefined) upd.checkin_end_min=Number(checkinEndMin);
      if(requireApproval!==undefined) upd.require_approval=!!requireApproval;
      if(summerMode!==undefined) upd.summer_mode=!!summerMode;
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
      const [{data:dd},{data:ld},{data:ed},{data:ad},{data:pd},cfg]=await Promise.all([sb.from("devices").select("*"),sb.from("attendance_log").select("*").order("ts",{ascending:false}),sb.from("events").select("*, event_attendees(device_id, name)"),sb.from("audit_log").select("*").order("ts",{ascending:false}),sb.from("pending_registrations").select("*"),getCfg(sb)]);
      const devices: Record<string,any>={}; (dd||[]).forEach((d:any)=>{devices[d.id]=rowToDev(d);});
      const bk={version:2,exportedAt:Date.now(),attendance:{devices,log:(ld||[]).map(rowToLog)},config:{adminDevices:cfg.admin_devices||[],nameOrder:cfg.name_order||[],dongsanNames:cfg.dongsan_names,checkinDays:cfg.checkin_days||[0],checkinStartMin:cfg.checkin_start_min??780,checkinEndMin:cfg.checkin_end_min??900,dongsanLeaders:cfg.dongsan_leaders||{},requireApproval:cfg.require_approval||false,announcement:cfg.announcement||"",individualCheckinEnabled:cfg.individual_checkin_enabled||false},events:{events:(ed||[]).map((e:any)=>({id:e.id,name:e.name,date:e.date,type:e.type,group:e.group_name,notes:e.notes,createdBy:e.created_by,createdAt:new Date(e.created_at).getTime(),attendees:(e.event_attendees||[]).map((a:any)=>a.name||a.device_id)}))},audit:(ad||[]).map((e:any)=>({ts:e.ts,action:e.action,adminId:e.admin_id,adminName:e.admin_name,details:e.details})),pending:(pd||[]).map((p:any)=>({deviceId:p.device_id,name:p.name,group:p.group_name,subgroup:p.subgroup,requestedAt:new Date(p.requested_at).getTime()}))};
      return new Response(JSON.stringify(bk,null,2),{headers:{...CORS,"Content-Type":"application/json","Content-Disposition":'attachment; filename="kccp-backup-'+localDate()+'.json"'}});
    }

    if(req.method==="POST"&&p==="/api/restore") {
      if(!await isAdmin(sb,xDev)) return fail(403,"Not authorized"); const bk=body; if(!bk.version||!bk.attendance) return fail(400,"Invalid backup file");
      if(bk.attendance?.devices){await sb.from("devices").delete().neq("id","");const dr=Object.entries(bk.attendance.devices).map(([id,v]:any)=>({id,name:v.name,group_name:v.group||"",subgroup:v.subgroup||"",notes:v.notes||"",member_role:v.memberRole||"",gender:v.gender||"",phone:v.phone||"",birth_date:v.birthDate||null,baptism_status:v.baptismStatus||"해당없음",school_or_work:v.schoolOrWork||"",faith_duration:v.faithDuration||"",registration_date:v.registrationDate||null,pastoral_visit_requested:v.pastoralVisitRequested||false,is_new_member:v.isNewMember||false,new_member_edu_week1:v.newMemberEduWeek1||false,new_member_edu_week2:v.newMemberEduWeek2||false}));if(dr.length) await sb.from("devices").insert(dr);}
      if(bk.attendance?.log){await sb.from("attendance_log").delete().neq("id",0);const lr=bk.attendance.log.map((e:any)=>({device_id:e.deviceId,name:e.name,group_name:e.group||"",subgroup:e.subgroup||"",date:e.date,time_str:e.time,ts:e.ts,location_verified:!!e.locationVerified,admin_added:!!e.adminAdded,first_visit:!!e.firstVisit,is_manual:!!e.manual,is_bulk:!!e.bulk,is_guest:!!e.guest,member_role:e.memberRole||null}));if(lr.length) await sb.from("attendance_log").insert(lr);}
      if(bk.config){const c=bk.config;await sb.from("config").update({admin_devices:c.adminDevices||[],name_order:c.nameOrder||[],dongsan_names:c.dongsanNames,checkin_days:c.checkinDays||[0],checkin_start_min:c.checkinStartMin??780,checkin_end_min:c.checkinEndMin??900,dongsan_leaders:c.dongsanLeaders||{},require_approval:c.requireApproval||false,announcement:c.announcement||"",individual_checkin_enabled:c.individualCheckinEnabled||false}).eq("id",1);}
      if(bk.events?.events){await sb.from("events").delete().neq("id","");for(const e of bk.events.events){await sb.from("events").insert({id:e.id,name:e.name,date:e.date,type:e.type||"기타",group_name:e.group||"",notes:e.notes||"",created_by:e.createdBy,created_at:e.createdAt?new Date(e.createdAt).toISOString():new Date().toISOString()});if(e.attendees?.length) await sb.from("event_attendees").insert(e.attendees.map((a:string)=>({event_id:e.id,device_id:"NAME-"+a,name:a})));}}
      await addAudit(sb,"restore",xDev,"Restored backup from "+(bk.exportedAt?new Date(bk.exportedAt).toLocaleString("ko-KR",{timeZone:"America/New_York"}):"unknown"));
      return ok({status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/report/html") {
      const gf=url.searchParams.get("group")||"",sf=url.searchParams.get("subgroup")||"",period=url.searchParams.get("period")||"all",fromP=url.searchParams.get("from")||"",toP=url.searchParams.get("to")||"";
      const today=localDate();
      let dq: any=sb.from("devices").select("*"); if(gf) dq=dq.eq("group_name",gf); if(sf) dq=dq.eq("subgroup",sf);
      const {data:devData}=await dq;
      let lq: any=sb.from("attendance_log").select("*").order("date",{ascending:true});
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
