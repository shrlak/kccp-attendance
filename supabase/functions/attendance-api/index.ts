import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Device-Id,Authorization,apikey",
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
  return ads.some((d:any)=>typeof d==="string"?d===did:d.deviceId===did);
}
async function isSuperAdmin(sb: SB, did: string) {
  const cfg=await getCfg(sb); const ads: any[]=cfg.admin_devices||[];
  if(!ads.length) return true;
  const entry=ads.find((d:any)=>typeof d==="string"?d===did:d.deviceId===did);
  if(!entry) return false;
  return typeof entry==="string"||(entry.role||"super")==="super";
}
function rowToDev(d: any) { return {name:d.name,group:d.group_name||"",subgroup:d.subgroup||"",notes:d.notes||"",memberRole:d.member_role||""}; }
function rowToLog(e: any) { return {deviceId:e.device_id,name:e.name,group:e.group_name||"",subgroup:e.subgroup||"",date:e.date,time:e.time_str,ts:e.ts,locationVerified:e.location_verified,adminAdded:e.admin_added,manual:e.is_manual,bulk:e.is_bulk,guest:e.is_guest,firstVisit:e.first_visit,memberRole:e.member_role}; }
async function getDevsByName(sb: SB, name: string): Promise<string[]> { const {data}=await sb.from("devices").select("id").eq("name",name); return (data||[]).map((d:any)=>d.id); }
async function countAtt(sb: SB, name: string): Promise<number> {
  const dids=await getDevsByName(sb,name); if(!dids.length) return 0;
  const {data}=await sb.from("attendance_log").select("date").in("device_id",dids);
  return new Set((data||[]).map((e:any)=>e.date)).size;
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
  // Compute per-name unique-date totals from all log data (no extra queries)
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
    const total=dates.filter((d:string)=>logs.find((e:any)=>dids.includes(e.device_id)&&e.date===d)).length;
    const rate=dates.length?Math.round(total/dates.length*100):0;
    const rc=rate>=80?"#16a34a":rate>=60?"#d97706":"#dc2626";
    let row='<tr><td class="nc">'+name+'</td><td>'+members[name].group+(members[name].subgroup?' / '+members[name].subgroup:'')+'</td><td class="tc">'+total+'</td><td class="tc" style="color:'+rc+'">'+rate+'%</td>';
    for(const d of dates) { const e=logs.find((x:any)=>dids.includes(x.device_id)&&x.date===d); row+=e?'<td class="pc">&#x2713;</td>':'<td class="ac">&mdash;</td>'; }
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
      const [{data:devData},{data:logData}]=await Promise.all([sb.from("devices").select("*"),sb.from("attendance_log").select("*").order("ts",{ascending:false})]);
      const devices: Record<string,any>={}; (devData||[]).forEach((d:any)=>{devices[d.id]=rowToDev(d);});
      return ok({devices,log:(logData||[]).map(rowToLog)});
    }

    if(req.method==="POST"&&p==="/api/check-admin") {
      const {deviceId}=body; const cfg=await getCfg(sb); const ads: any[]=cfg.admin_devices||[];
      const noAdminsYet=!ads.length;
      const entry=noAdminsYet?{role:"super",group:"",subgroup:"",ministry:""}:ads.find((d:any)=>typeof d==="string"?d===deviceId:d.deviceId===deviceId);
      return ok({isAdmin:noAdminsYet||!!entry,noAdminsYet,role:entry?(typeof entry==="string"?"super":entry.role||"super"):null,leaderGroup:entry&&typeof entry!=="string"?entry.group||"":"",leaderSubgroup:entry&&typeof entry!=="string"?entry.subgroup||"":"",ministry:entry&&typeof entry!=="string"?entry.ministry||"":""});
    }

    if(req.method==="POST"&&p==="/api/checkin") {
      const {deviceId,lat,lng}=body;
      // Fetch config and device in parallel to minimize round-trips
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
      const {data:ex}=await sb.from("devices").select("id,name").eq("id",deviceId).single();
      if(ex) return ok({status:"already-registered",name:ex.name});
      const cfg=await getCfg(sb);
      if(cfg.require_approval){
        const {data:al}=await sb.from("pending_registrations").select("id").eq("device_id",deviceId).single();
        if(!al) await sb.from("pending_registrations").insert({device_id:deviceId,name:name.trim(),group_name:group||"",subgroup:subgroup||""});
        return ok({status:"pending",name:name.trim()});
      }
      await sb.from("devices").upsert({id:deviceId,name:name.trim(),group_name:group||"",subgroup:subgroup||""});
      await sb.from("attendance_log").update({name:name.trim(),group_name:group||"",subgroup:subgroup||""}).eq("device_id",deviceId);
      return ok({status:"ok",name:name.trim()});
    }

    if(req.method==="POST"&&p==="/api/register") {
      const {deviceId,name,group,subgroup,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      await sb.from("devices").upsert({id:deviceId,name:name.trim(),group_name:group||"",subgroup:subgroup||""});
      await sb.from("attendance_log").update({name:name.trim(),group_name:group||"",subgroup:subgroup||""}).eq("device_id",deviceId);
      await addAudit(sb,"device-register",adminDeviceId,name+" ("+deviceId+")");
      return ok({status:"ok"});
    }

    if(req.method==="PUT"&&p==="/api/device") {
      const {deviceId,name,group,subgroup,notes,memberRole,adminDeviceId}=body; if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const {data:dev}=await sb.from("devices").select("*").eq("id",deviceId).single(); if(!dev) return ok({status:"ok"});
      const oldName=dev.name,newName=name?name.trim():oldName,newGroup=group!==undefined?group.trim():dev.group_name||"",newSub=subgroup!==undefined?subgroup.trim():dev.subgroup||"";
      const upd: any={name:newName,group_name:newGroup,subgroup:newSub,updated_at:new Date().toISOString()};
      if(notes!==undefined) upd.notes=notes; if(memberRole!==undefined) upd.member_role=memberRole;
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
      const {password,targetDeviceId,role,group,subgroup,ministry}=body; const cfg=await getCfg(sb);
      if(password!==cfg.admin_password) return fail(403,"Wrong password");
      const ads: any[]=[...(cfg.admin_devices||[])].filter((d:any)=>typeof d==="string"?d!==targetDeviceId.trim():d.deviceId!==targetDeviceId.trim());
      const entry: any={deviceId:targetDeviceId.trim(),role:role||"super"}; if(group) entry.group=group; if(subgroup) entry.subgroup=subgroup; if(ministry) entry.ministry=ministry;
      ads.push(entry); await sb.from("config").update({admin_devices:ads}).eq("id",1);
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/admin/remove") {
      const {password,targetDeviceId}=body; const cfg=await getCfg(sb); if(password!==cfg.admin_password) return fail(403,"Wrong password");
      await sb.from("config").update({admin_devices:(cfg.admin_devices||[]).filter((d:any)=>typeof d==="string"?d!==targetDeviceId:d.deviceId!==targetDeviceId)}).eq("id",1);
      return ok({status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/admin/list") {
      const {password}=body; const cfg=await getCfg(sb); if(password!==cfg.admin_password) return fail(403,"Wrong password");
      const ads: any[]=cfg.admin_devices||[];
      const result=await Promise.all(ads.map(async(d:any)=>{const did=typeof d==="string"?d:d.deviceId;const r=typeof d==="string"?"super":d.role||"super";const ministry=typeof d==="string"?"":d.ministry||"";const group=typeof d==="string"?"":d.group||"";const subgroup=typeof d==="string"?"":d.subgroup||"";const {data:dv}=await sb.from("devices").select("name").eq("id",did).single();return {deviceId:did,name:dv?.name||"Unknown",role:r,ministry,group,subgroup};}));
      return ok({adminDevices:result});
    }

    if(req.method==="GET"&&p==="/api/config"){const cfg=await getCfg(sb);return ok({announcement:cfg.announcement||"",checkinDays:cfg.checkin_days||[0],checkinStartMin:cfg.checkin_start_min??780,checkinEndMin:cfg.checkin_end_min??900,requireApproval:cfg.require_approval||false,summerMode:cfg.summer_mode||false,demoMode:cfg.demo_mode||false});}

    if(req.method==="POST"&&p==="/api/config") {
      const {announcement,checkinDays,checkinStartMin,checkinEndMin,requireApproval,summerMode,demoMode,adminDeviceId}=body;
      if(!await isAdmin(sb,adminDeviceId)) return fail(403,"Not authorized");
      const upd: any={updated_at:new Date().toISOString()};
      if(announcement!==undefined) upd.announcement=announcement; if(checkinDays!==undefined) upd.checkin_days=checkinDays;
      if(checkinStartMin!==undefined) upd.checkin_start_min=Number(checkinStartMin); if(checkinEndMin!==undefined) upd.checkin_end_min=Number(checkinEndMin);
      if(requireApproval!==undefined) upd.require_approval=!!requireApproval;
      if(summerMode!==undefined) upd.summer_mode=!!summerMode;
      if(demoMode!==undefined){if(!await isSuperAdmin(sb,adminDeviceId))return fail(403,"Demo mode requires super admin");upd.demo_mode=!!demoMode;}
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
      const bk={version:2,exportedAt:Date.now(),attendance:{devices,log:(ld||[]).map(rowToLog)},config:{adminDevices:cfg.admin_devices||[],nameOrder:cfg.name_order||[],dongsanNames:cfg.dongsan_names,checkinDays:cfg.checkin_days||[0],checkinStartMin:cfg.checkin_start_min??780,checkinEndMin:cfg.checkin_end_min??900,dongsanLeaders:cfg.dongsan_leaders||{},requireApproval:cfg.require_approval||false,announcement:cfg.announcement||""},events:{events:(ed||[]).map((e:any)=>({id:e.id,name:e.name,date:e.date,type:e.type,group:e.group_name,notes:e.notes,createdBy:e.created_by,createdAt:new Date(e.created_at).getTime(),attendees:(e.event_attendees||[]).map((a:any)=>a.name||a.device_id)}))},audit:(ad||[]).map((e:any)=>({ts:e.ts,action:e.action,adminId:e.admin_id,adminName:e.admin_name,details:e.details})),pending:(pd||[]).map((p:any)=>({deviceId:p.device_id,name:p.name,group:p.group_name,subgroup:p.subgroup,requestedAt:new Date(p.requested_at).getTime()}))};
      return new Response(JSON.stringify(bk,null,2),{headers:{...CORS,"Content-Type":"application/json","Content-Disposition":'attachment; filename="kccp-backup-'+localDate()+'.json"'}});
    }

    if(req.method==="POST"&&p==="/api/restore") {
      if(!await isAdmin(sb,xDev)) return fail(403,"Not authorized"); const bk=body; if(!bk.version||!bk.attendance) return fail(400,"Invalid backup file");
      if(bk.attendance?.devices){await sb.from("devices").delete().neq("id","");const dr=Object.entries(bk.attendance.devices).map(([id,v]:any)=>({id,name:v.name,group_name:v.group||"",subgroup:v.subgroup||"",notes:v.notes||"",member_role:v.memberRole||""}));if(dr.length) await sb.from("devices").insert(dr);}
      if(bk.attendance?.log){await sb.from("attendance_log").delete().neq("id",0);const lr=bk.attendance.log.map((e:any)=>({device_id:e.deviceId,name:e.name,group_name:e.group||"",subgroup:e.subgroup||"",date:e.date,time_str:e.time,ts:e.ts,location_verified:!!e.locationVerified,admin_added:!!e.adminAdded,first_visit:!!e.firstVisit,is_manual:!!e.manual,is_bulk:!!e.bulk,is_guest:!!e.guest,member_role:e.memberRole||null}));if(lr.length) await sb.from("attendance_log").insert(lr);}
      if(bk.config){const c=bk.config;await sb.from("config").update({admin_devices:c.adminDevices||[],name_order:c.nameOrder||[],dongsan_names:c.dongsanNames,checkin_days:c.checkinDays||[0],checkin_start_min:c.checkinStartMin??780,checkin_end_min:c.checkinEndMin??900,dongsan_leaders:c.dongsanLeaders||{},require_approval:c.requireApproval||false,announcement:c.announcement||""}).eq("id",1);}
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
      const members: Record<string,{group:string;subgroup:string;devices:string[]}>={}; devices.forEach((d:any)=>{if(!members[d.name])members[d.name]={group:d.group_name||"",subgroup:d.subgroup||"",devices:[]};members[d.name].devices.push(d.id);});
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
