const DATA_REPO = process.env.GITHUB_DATA_REPO || "shrlak/kccp-attendance-data";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "kccpwelcome";

const FILES = {
  data: "attendance-data.json",
  config: "config.json",
  events: "events-data.json",
  audit: "audit-log.json",
  pending: "pending-registrations.json"
};

const DEFAULT_DONGSAN = { "대학부":["동산1","동산2","동산3","동산4"],"청년부":["동산1","동산2","동산3","동산4"] };
const DEFAULT_CONFIG = { adminDevices:[], nameOrder:[], dongsanNames:DEFAULT_DONGSAN, checkinDays:[0], checkinStartMin:780, checkinEndMin:900, dongsanLeaders:{}, requireApproval:false };
const DEFAULTS = {
  [FILES.data]: { devices:{}, log:[] },
  [FILES.config]: DEFAULT_CONFIG,
  [FILES.events]: { events:[] },
  [FILES.audit]: [],
  [FILES.pending]: []
};

// ─── GitHub Storage ───
function ghHeaders() {
  return { Authorization:`Bearer ${process.env.GITHUB_DATA_TOKEN}`, Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" };
}
async function ghGet(file) {
  const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${file}`, { headers:ghHeaders() });
  if (!r.ok) return { content:JSON.parse(JSON.stringify(DEFAULTS[file]??null)), sha:null };
  const d = await r.json();
  return { content:JSON.parse(Buffer.from(d.content,"base64").toString("utf-8")), sha:d.sha };
}
async function ghPut(file, content, sha, message) {
  const body = { message, content:Buffer.from(JSON.stringify(content,null,2)).toString("base64") };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${file}`, {
    method:"PUT", headers:{...ghHeaders(),"Content-Type":"application/json"}, body:JSON.stringify(body)
  });
  return { ok:r.ok, status:r.status };
}
async function update(file, fn, msg) {
  for (let i=0; i<3; i++) {
    const { content, sha } = await ghGet(file);
    const next = fn(content);
    const r = await ghPut(file, next, sha, msg);
    if (r.ok) return next;
    if (r.status===409||r.status===422) { await new Promise(x=>setTimeout(x,300*(i+1))); continue; }
    throw new Error(`gh write ${r.status}`);
  }
  throw new Error("write conflict");
}

// ─── Time ───
function localDate() { return new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"}); }
function localTime() { return new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function fmtDateWithDay(d) { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric",year:"numeric"}); }
function fmtMin(m) { const h=Math.floor(m/60),mn=m%60,h12=h%12||12; return `${String(h12).padStart(2,"0")}:${String(mn).padStart(2,"0")} ${h>=12?"PM":"AM"}`; }

// ─── Device helpers ───
function getDeviceInfo(data, did) { const v=data.devices[did]; if(!v)return null; return typeof v==="string"?{name:v,group:""}:v; }
function getDeviceName(data, did) { const i=getDeviceInfo(data,did); return i?i.name:null; }
function getDeviceGroup(data, did) { const i=getDeviceInfo(data,did); return i?i.group||"":""; }
function getDeviceSubgroup(data, did) { const i=getDeviceInfo(data,did); return i?i.subgroup||"":""; }
function setDevice(data, did, name, group, subgroup, extra={}) {
  const prev=(data.devices[did]&&typeof data.devices[did]==="object")?data.devices[did]:{};
  const d={name:name.trim(),group:(group||"").trim(),subgroup:(subgroup||"").trim()};
  d.notes=extra.notes!==undefined?extra.notes:(prev.notes||"");
  if (extra.memberRole!==undefined) d.memberRole=extra.memberRole;
  else if (prev.memberRole) d.memberRole=prev.memberRole;
  else if (prev.visitor) d.memberRole="visitor";
  data.devices[did]=d;
}
function getAllMembers(data) {
  const m={};
  Object.entries(data.devices).forEach(([did,v])=>{
    const i=typeof v==="string"?{name:v,group:"",subgroup:""}:v;
    if(!m[i.name])m[i.name]={group:i.group||"",subgroup:i.subgroup||"",devices:[]};
    m[i.name].devices.push(did);
  });
  return m;
}
function getDevicesForName(data, name) {
  return Object.entries(data.devices).filter(([,v])=>(typeof v==="string"?v:v.name)===name).map(([d])=>d);
}
function totalForName(data, name) {
  const dids=getDevicesForName(data,name),dates=new Set();
  data.log.forEach(e=>{if(dids.includes(e.deviceId))dates.add(e.date);}); return dates.size;
}
function checkedInToday(data, name, today) {
  const dids=getDevicesForName(data,name);
  return data.log.find(e=>dids.includes(e.deviceId)&&e.date===today)||null;
}

// ─── Auth ───
function isAdmin(config, did) {
  if(!config.adminDevices||!config.adminDevices.length)return true;
  return config.adminDevices.some(d=>typeof d==="string"?d===did:d.deviceId===did);
}
function getAdminEntry(config, did) {
  if(!config.adminDevices||!config.adminDevices.length)return{role:"super",group:"",subgroup:""};
  const e=config.adminDevices.find(d=>typeof d==="string"?d===did:d.deviceId===did);
  if(!e)return null;
  return typeof e==="string"?{deviceId:e,role:"super",group:"",subgroup:""}:{role:"super",group:"",subgroup:"",...e};
}

// ─── Audit ───
async function appendAudit(action, adminId, data, details) {
  try {
    await update(FILES.audit, log=>{
      const adminName=getDeviceName(data,adminId)||adminId;
      const next=[{ts:Date.now(),action,adminId,adminName,details},...(log||[])];
      return next.length>1000?next.slice(0,1000):next;
    }, `audit: ${action}`);
  } catch(e) { /* non-fatal */ }
}

// ─── CSV generators ───
function csvLog(data, gf, sf) {
  const h=["Name","Group","Subgroup","Day","Date","Time","Total"];
  let logs=[...data.log].sort((a,b)=>b.ts-a.ts);
  if(gf)logs=logs.filter(e=>{const i=getDeviceInfo(data,e.deviceId);return i&&i.group===gf;});
  if(sf)logs=logs.filter(e=>{const i=getDeviceInfo(data,e.deviceId);return i&&(i.subgroup||"")===sf;});
  const r=logs.map(e=>{
    const name=getDeviceName(data,e.deviceId)||e.name;
    const day=new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{timeZone:"America/New_York",weekday:"long"});
    return[name,getDeviceGroup(data,e.deviceId)||e.group||"",getDeviceSubgroup(data,e.deviceId)||e.subgroup||"",day,e.date,e.time,totalForName(data,name)];
  });
  return[h,...r].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
}
function csvGrid(data, gf, sf) {
  const members=getAllMembers(data);let names=Object.keys(members).sort();
  if(gf)names=names.filter(n=>members[n].group===gf);
  if(sf)names=names.filter(n=>(members[n].subgroup||"")===sf);
  const dates=[...new Set(data.log.map(e=>e.date))].sort();
  const h=["Name","Group","Subgroup","Total",...dates.map(d=>fmtDateWithDay(d))];
  const r=names.map(name=>{
    const dids=members[name].devices,total=totalForName(data,name);
    return[name,members[name].group,members[name].subgroup||"",total,...dates.map(d=>{const e=data.log.find(x=>dids.includes(x.deviceId)&&x.date===d);return e?e.time:"";})];
  });
  return[h,...r].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
}

// ─── Read body ───
async function readBody(req) {
  let b="";
  await new Promise(res=>{ req.on("data",c=>b+=c); req.on("end",res); });
  return JSON.parse(b);
}

// ─── Location check (returns null=ok, "required", or distance number) ───
const CHURCH_LAT=40.450218535488325,CHURCH_LNG=-79.93480148825721;
function checkLocation(lat,lng) {
  if(lat===undefined||lng===undefined)return"required";
  const R=6371000,dLat=(lat-CHURCH_LAT)*Math.PI/180,dLng=(lng-CHURCH_LNG)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(CHURCH_LAT*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLng/2)**2;
  const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  return dist>30?Math.round(dist):null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type,X-Device-Id");
  if(req.method==="OPTIONS"){res.status(204).end();return;}

  const url=new URL(req.url,"http://localhost");
  const p=url.pathname;
  const json=(code,obj)=>res.status(code).json(obj);

  try {
    if(req.method==="GET"&&p==="/api/health")return json(200,{status:"ok",ts:Date.now()});

    if(req.method==="GET"&&p==="/api/data"){
      const{content}=await ghGet(FILES.data);return json(200,content);
    }

    if(req.method==="POST"&&p==="/api/check-admin"){
      const{deviceId}=await readBody(req);
      const[{content:cfg},{content:data}]=await Promise.all([ghGet(FILES.config),ghGet(FILES.data)]);
      const entry=getAdminEntry(cfg,deviceId);
      return json(200,{isAdmin:isAdmin(cfg,deviceId),noAdminsYet:!cfg.adminDevices||!cfg.adminDevices.length,role:entry?entry.role:null,leaderGroup:entry?entry.group||"":"",leaderSubgroup:entry?entry.subgroup||"":""});
    }

    if(req.method==="POST"&&p==="/api/checkin"){
      const{deviceId,lat,lng}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);
      const now=new Date(),eastern=new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"}));
      const day=eastern.getDay(),timeInMin=eastern.getHours()*60+eastern.getMinutes();
      const allowedDays=cfg.checkinDays??[0],startMin=cfg.checkinStartMin??780,endMin=cfg.checkinEndMin??900;
      const DAY_NAMES=["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
      if(!allowedDays.includes(day))return json(200,{status:"time-restricted",message:"출석 가능한 요일이 아닙니다",sub:`출석 가능 요일: ${allowedDays.map(d=>DAY_NAMES[d]).join(", ")}`});
      if(timeInMin<startMin||timeInMin>=endMin)return json(200,{status:"time-restricted",message:"출석 시간이 아닙니다",sub:`출석 가능 시간: ${fmtMin(startMin)} ~ ${fmtMin(endMin)}`});
      const locResult=checkLocation(lat,lng);
      if(locResult==="required")return json(200,{status:"location-required",message:"위치 정보가 필요합니다. 위치 접근을 허용해주세요."});
      if(locResult!==null)return json(200,{status:"location-restricted",message:"교회 근처에서만 출석할 수 있습니다.",distance:locResult});
      const today=localDate(),time=localTime();
      let result;
      await update(FILES.data,data=>{
        const name=getDeviceName(data,deviceId),group=getDeviceGroup(data,deviceId),subgroup=getDeviceSubgroup(data,deviceId);
        const deviceInfo=getDeviceInfo(data,deviceId),memberRole=deviceInfo?(deviceInfo.memberRole||(deviceInfo.visitor?"visitor":"")):"";
        if(name){const ex=checkedInToday(data,name,today);if(ex){result={status:"already",time:ex.time,name,group,subgroup,totalAttendance:totalForName(data,name)};return data;}}
        else{const ex=data.log.find(e=>e.deviceId===deviceId&&e.date===today);if(ex){result={status:"already",time:ex.time,name:ex.name,group:"",subgroup:"",totalAttendance:0};return data;}}
        const displayName=name||`Unknown (${deviceId.slice(0,12)}...)`;
        const isFirstVisit=name?totalForName(data,name)===0:true;
        const entry={deviceId,name:displayName,group:group||"",subgroup:subgroup||"",date:today,time,ts:Date.now()};
        if(isFirstVisit)entry.firstVisit=true;
        if(memberRole)entry.memberRole=memberRole;
        data.log.unshift(entry);
        result={status:"ok",time,name:displayName,group,subgroup,isRegistered:!!name,totalAttendance:name?totalForName(data,name):1,firstVisit:isFirstVisit};
        return data;
      },"check-in: "+today);
      return json(200,result);
    }

    if(req.method==="POST"&&p==="/api/self-register"){
      const{deviceId,name,group,subgroup}=await readBody(req);
      if(!deviceId||!name)return json(400,{error:"deviceId and name required"});
      const[{content:cfg},{content:existingData}]=await Promise.all([ghGet(FILES.config),ghGet(FILES.data)]);
      const existing=getDeviceInfo(existingData,deviceId);
      if(existing)return json(200,{status:"already-registered",name:existing.name});
      if(cfg.requireApproval){
        await update(FILES.pending,pending=>{
          if(!pending.find(p=>p.deviceId===deviceId))pending.unshift({deviceId,name:name.trim(),group:group||"",subgroup:subgroup||"",requestedAt:Date.now()});
          return pending;
        },"pending: "+name);
        return json(200,{status:"pending",name:name.trim()});
      }
      await update(FILES.data,data=>{
        setDevice(data,deviceId,name,group||"",subgroup||"");
        data.log=data.log.map(e=>e.deviceId===deviceId.trim()?{...e,name:name.trim(),group:(group||"").trim(),subgroup:(subgroup||"").trim()}:e);
        return data;
      },"self-register: "+name);
      return json(200,{status:"ok",name:name.trim()});
    }

    if(req.method==="POST"&&p==="/api/register"){
      const{deviceId,name,group,subgroup,adminDeviceId}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      const data=await update(FILES.data,data=>{
        setDevice(data,deviceId,name,group||"",subgroup||"");
        data.log=data.log.map(e=>e.deviceId===deviceId.trim()?{...e,name:name.trim(),group:(group||"").trim(),subgroup:(subgroup||"").trim()}:e);
        return data;
      },"register: "+name);
      await appendAudit("device-register",adminDeviceId,data,`${name} (${deviceId})`);
      return json(200,{status:"ok"});
    }

    if(req.method==="PUT"&&p==="/api/device"){
      const{deviceId,name,group,subgroup,notes,memberRole,adminDeviceId}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      const data=await update(FILES.data,data=>{
        if(!data.devices[deviceId])return data;
        const oldName=getDeviceName(data,deviceId),extra={};
        if(notes!==undefined)extra.notes=notes;
        if(memberRole!==undefined)extra.memberRole=memberRole;
        const newName=name?name.trim():oldName,newGroup=group!==undefined?group.trim():getDeviceGroup(data,deviceId),newSub=subgroup!==undefined?subgroup.trim():getDeviceSubgroup(data,deviceId);
        setDevice(data,deviceId,newName,newGroup,newSub,extra);
        if(oldName&&name&&oldName!==newName){
          const allDids=getDevicesForName(data,oldName);
          allDids.forEach(did=>setDevice(data,did,newName,newGroup,newSub,extra));
          data.log=data.log.map(e=>allDids.includes(e.deviceId)?{...e,name:newName,group:newGroup,subgroup:newSub}:e);
        }
        return data;
      },"edit device: "+(name||deviceId));
      await appendAudit("device-edit",adminDeviceId,data,`${name||deviceId} (${deviceId})`);
      return json(200,{status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/link-device"){
      const{newDeviceId,existingName,adminDeviceId}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      let devicesResult;
      await update(FILES.data,data=>{
        const members=getAllMembers(data),group=members[existingName]?members[existingName].group:"",sub=members[existingName]?(members[existingName].subgroup||""):"";
        setDevice(data,newDeviceId.trim(),existingName.trim(),group,sub);
        data.log=data.log.map(e=>e.deviceId===newDeviceId.trim()?{...e,name:existingName.trim(),group,subgroup:sub}:e);
        devicesResult=getDevicesForName(data,existingName.trim());
        return data;
      },"link device: "+existingName);
      return json(200,{status:"ok",devices:devicesResult});
    }

    if(req.method==="DELETE"&&p.startsWith("/api/device/")){
      const did=decodeURIComponent(p.split("/api/device/")[1]);
      const adminId=req.headers["x-device-id"];
      const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminId))return json(403,{error:"Not authorized"});
      await update(FILES.data,data=>{delete data.devices[did];return data;},"unlink device: "+did);
      return json(200,{status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/remove-person"){
      const{name,deleteRecords,adminDeviceId}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      const data=await update(FILES.data,data=>{
        const dids=getDevicesForName(data,name);
        dids.forEach(did=>delete data.devices[did]);
        if(deleteRecords)data.log=data.log.filter(e=>!dids.includes(e.deviceId)&&(e.name||"").trim()!==name.trim());
        return data;
      },"remove person: "+name);
      await appendAudit("person-remove",adminDeviceId,data,`${name}${deleteRecords?" (records deleted)":""}`);
      return json(200,{status:"ok"});
    }

    if(req.method==="DELETE"&&p==="/api/log"){
      const adminId=req.headers["x-device-id"];const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminId))return json(403,{error:"Not authorized"});
      await update(FILES.data,data=>{data.log=[];return data;},"clear log");return json(200,{status:"ok"});
    }
    if(req.method==="DELETE"&&p==="/api/devices"){
      const adminId=req.headers["x-device-id"];const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminId))return json(403,{error:"Not authorized"});
      await update(FILES.data,data=>{data.devices={};return data;},"clear devices");return json(200,{status:"ok"});
    }
    if(req.method==="DELETE"&&p==="/api/all"){
      const adminId=req.headers["x-device-id"];const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminId))return json(403,{error:"Not authorized"});
      await update(FILES.data,_=>({devices:{},log:[]}),"clear all");return json(200,{status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/name-order"){
      const{content:cfg}=await ghGet(FILES.config);return json(200,{order:cfg.nameOrder||[]});
    }
    if(req.method==="POST"&&p==="/api/name-order"){
      const{order,adminDeviceId}=await readBody(req);const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      await update(FILES.config,c=>{c.nameOrder=order||[];return c;},"update name order");return json(200,{status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/log/add-manual"){
      const{name,date,time:manualTime,adminDeviceId}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      if(!name||!date)return json(400,{error:"name and date required"});
      const data=await update(FILES.data,data=>{
        if(checkedInToday(data,name,date))return data;
        const dids=getDevicesForName(data,name),did=dids[0]||null;
        data.log.unshift({deviceId:did||`MANUAL-${Date.now()}`,name,group:did?getDeviceGroup(data,did):"",subgroup:did?getDeviceSubgroup(data,did):"",date,time:manualTime||localTime(),ts:Date.now(),manual:true});
        return data;
      },"manual add: "+name+" "+date);
      await appendAudit("manual-add",adminDeviceId,data,`${name} | ${date}`);return json(200,{status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/admin/checkin"){
      const{name,adminDeviceId}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      if(!name||!name.trim())return json(400,{error:"name required"});
      const today=localDate(),time=localTime();let result;
      await update(FILES.data,data=>{
        const ex=checkedInToday(data,name.trim(),today);
        if(ex){result={status:"already",time:ex.time,name:name.trim()};return data;}
        const dids=getDevicesForName(data,name.trim()),did=dids[0]||null;
        data.log.unshift({deviceId:did||`MANUAL-${Date.now()}`,name:name.trim(),group:did?getDeviceGroup(data,did):"",subgroup:did?getDeviceSubgroup(data,did):"",date:today,time,ts:Date.now(),manual:true});
        result={status:"ok",time,name:name.trim(),total:totalForName(data,name.trim())};return data;
      },"admin checkin: "+name.trim());
      await appendAudit("admin-checkin",adminDeviceId,await ghGet(FILES.data).then(r=>r.content),`${name.trim()} | ${today}`);
      return json(200,result);
    }

    if(req.method==="POST"&&p==="/api/guest-checkin"){
      const{name,lat,lng}=await readBody(req);
      if(!name||!name.trim())return json(400,{error:"name required"});
      const{content:cfg}=await ghGet(FILES.config);
      const now=new Date(),eastern=new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"}));
      const day=eastern.getDay(),timeInMin=eastern.getHours()*60+eastern.getMinutes();
      const allowedDays=cfg.checkinDays??[0],startMin=cfg.checkinStartMin??780,endMin=cfg.checkinEndMin??900;
      const DAY_NAMES=["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
      if(!allowedDays.includes(day))return json(200,{status:"time-restricted",message:"출석 가능한 요일이 아닙니다",sub:`출석 가능 요일: ${allowedDays.map(d=>DAY_NAMES[d]).join(", ")}`});
      if(timeInMin<startMin||timeInMin>=endMin)return json(200,{status:"time-restricted",message:"출석 시간이 아닙니다",sub:`출석 가능 시간: ${fmtMin(startMin)} ~ ${fmtMin(endMin)}`});
      const locResult=checkLocation(lat,lng);
      if(locResult==="required")return json(200,{status:"location-required",message:"위치 정보가 필요합니다. 위치 접근을 허용해주세요."});
      if(locResult!==null)return json(200,{status:"location-restricted",message:"교회 근처에서만 출석할 수 있습니다.",distance:locResult});
      const today=localDate(),time=localTime();
      await update(FILES.data,data=>{
        if(!data.log.find(e=>e.name===name.trim()&&e.date===today&&e.guest))data.log.unshift({deviceId:`GUEST-${Date.now()}`,name:name.trim(),group:"",subgroup:"",date:today,time,ts:Date.now(),guest:true,memberRole:"visitor"});
        return data;
      },"guest checkin: "+name.trim());
      return json(200,{status:"ok",time,name:name.trim()});
    }

    if(req.method==="POST"&&p==="/api/log/remove-entry"){
      const{ts,adminDeviceId}=await readBody(req);const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      let removed;
      const data=await update(FILES.data,data=>{removed=data.log.find(e=>e.ts===ts);data.log=data.log.filter(e=>e.ts!==ts);return data;},"remove log entry");
      await appendAudit("manual-remove",adminDeviceId,data,removed?`${removed.name} | ${removed.date}`:`ts=${ts}`);return json(200,{status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/dongsan-names"){
      const{content:cfg}=await ghGet(FILES.config);return json(200,{names:cfg.dongsanNames||DEFAULT_DONGSAN});
    }
    if(req.method==="POST"&&p==="/api/dongsan-names"){
      const{group,index,name,adminDeviceId}=await readBody(req);
      const{content:cfg0}=await ghGet(FILES.config);
      if(!isAdmin(cfg0,adminDeviceId))return json(403,{error:"Not authorized"});
      if(!group||index===undefined||!name)return json(400,{error:"group, index, and name required"});
      let oldName,newNames;
      const updatedCfg=await update(FILES.config,cfg=>{
        if(!cfg.dongsanNames)cfg.dongsanNames=JSON.parse(JSON.stringify(DEFAULT_DONGSAN));
        if(!cfg.dongsanNames[group])cfg.dongsanNames[group]=["동산1","동산2","동산3","동산4"];
        oldName=cfg.dongsanNames[group][index];cfg.dongsanNames[group][index]=name.trim();newNames=cfg.dongsanNames;return cfg;
      },"rename dongsan: "+name);
      if(oldName&&oldName!==name.trim()){
        await update(FILES.data,data=>{
          const affected=Object.entries(data.devices).filter(([,v])=>typeof v!=="string"&&v.group===group&&v.subgroup===oldName).map(([did])=>did);
          affected.forEach(did=>{data.devices[did]={...data.devices[did],subgroup:name.trim()};});
          data.log=data.log.map(e=>affected.includes(e.deviceId)?{...e,subgroup:name.trim()}:e);return data;
        },"dongsan rename devices");
      }
      return json(200,{status:"ok",names:newNames});
    }

    if(req.method==="GET"&&p==="/api/dongsan-leaders"){
      const{content:cfg}=await ghGet(FILES.config);return json(200,{leaders:cfg.dongsanLeaders||{}});
    }
    if(req.method==="POST"&&p==="/api/dongsan-leaders"){
      const{group,subgroup,leader,subLeaders,adminDeviceId}=await readBody(req);
      const{content:cfg0}=await ghGet(FILES.config);
      if(!isAdmin(cfg0,adminDeviceId))return json(403,{error:"Not authorized"});
      if(!group||!subgroup)return json(400,{error:"group and subgroup required"});
      await update(FILES.config,cfg=>{
        if(!cfg.dongsanLeaders)cfg.dongsanLeaders={};if(!cfg.dongsanLeaders[group])cfg.dongsanLeaders[group]={};
        cfg.dongsanLeaders[group][subgroup]={leader:leader||"",subLeaders:subLeaders||[]};return cfg;
      },"update dongsan leaders");
      const{content:data}=await ghGet(FILES.data);
      await appendAudit("config-change",adminDeviceId,data,`동산지기: ${group} ${subgroup}`);return json(200,{status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/transfer-member"){
      const{name,newGroup,newSubgroup,adminDeviceId}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      if(!name||!newGroup)return json(400,{error:"name and newGroup required"});
      const data=await update(FILES.data,data=>{
        const dids=getDevicesForName(data,name);if(!dids.length)return data;
        dids.forEach(did=>{const cur=data.devices[did];data.devices[did]={name:typeof cur==="string"?cur:cur.name,group:newGroup,subgroup:newSubgroup||""};});return data;
      },"transfer: "+name);
      await appendAudit("transfer-member",adminDeviceId,data,`${name} → ${newGroup} ${newSubgroup||""}`);return json(200,{status:"ok"});
    }

    if(req.method==="POST"&&p==="/api/admin/add"){
      const{password,targetDeviceId,role,group,subgroup}=await readBody(req);
      if(password!==ADMIN_PASSWORD)return json(403,{error:"Wrong password",code:"WRONG_PASSWORD"});
      await update(FILES.config,cfg=>{
        if(!cfg.adminDevices)cfg.adminDevices=[];
        cfg.adminDevices=cfg.adminDevices.filter(d=>typeof d==="string"?d!==targetDeviceId.trim():d.deviceId!==targetDeviceId.trim());
        const entry={deviceId:targetDeviceId.trim(),role:role||"super"};if(group)entry.group=group;if(subgroup)entry.subgroup=subgroup;
        cfg.adminDevices.push(entry);return cfg;
      },"add admin: "+targetDeviceId);return json(200,{status:"ok"});
    }
    if(req.method==="POST"&&p==="/api/admin/remove"){
      const{password,targetDeviceId}=await readBody(req);
      if(password!==ADMIN_PASSWORD)return json(403,{error:"Wrong password"});
      await update(FILES.config,cfg=>{cfg.adminDevices=(cfg.adminDevices||[]).filter(d=>typeof d==="string"?d!==targetDeviceId:d.deviceId!==targetDeviceId);return cfg;},"remove admin: "+targetDeviceId);
      return json(200,{status:"ok"});
    }
    if(req.method==="POST"&&p==="/api/admin/list"){
      const{password}=await readBody(req);if(password!==ADMIN_PASSWORD)return json(403,{error:"Wrong password"});
      const[{content:cfg},{content:data}]=await Promise.all([ghGet(FILES.config),ghGet(FILES.data)]);
      return json(200,{adminDevices:(cfg.adminDevices||[]).map(d=>{const did=typeof d==="string"?d:d.deviceId,r=typeof d==="string"?"super":(d.role||"super");return{deviceId:did,name:getDeviceName(data,did)||"Unknown",role:r};})});
    }

    if(req.method==="GET"&&p==="/api/config"){
      const{content:cfg}=await ghGet(FILES.config);
      return json(200,{announcement:cfg.announcement||"",checkinDays:cfg.checkinDays??[0],checkinStartMin:cfg.checkinStartMin??780,checkinEndMin:cfg.checkinEndMin??900,requireApproval:cfg.requireApproval||false});
    }
    if(req.method==="POST"&&p==="/api/config"){
      const{announcement,checkinDays,checkinStartMin,checkinEndMin,requireApproval,adminDeviceId}=await readBody(req);
      const{content:cfg0}=await ghGet(FILES.config);
      if(!isAdmin(cfg0,adminDeviceId))return json(403,{error:"Not authorized"});
      await update(FILES.config,cfg=>{
        if(announcement!==undefined)cfg.announcement=announcement;if(checkinDays!==undefined)cfg.checkinDays=checkinDays;
        if(checkinStartMin!==undefined)cfg.checkinStartMin=Number(checkinStartMin);if(checkinEndMin!==undefined)cfg.checkinEndMin=Number(checkinEndMin);
        if(requireApproval!==undefined)cfg.requireApproval=!!requireApproval;return cfg;
      },"update config");
      const{content:data}=await ghGet(FILES.data);await appendAudit("config-change",adminDeviceId,data,"config updated");return json(200,{status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/export/csv"){
      const{content:data}=await ghGet(FILES.data);const gf=url.searchParams.get("group")||"",sf=url.searchParams.get("subgroup")||"";
      res.status(200).setHeader("Content-Type","text/csv").setHeader("Content-Disposition",`attachment; filename="attendance-log-${gf||"all"}-${localDate()}.csv"`).end(csvLog(data,gf,sf));return;
    }
    if(req.method==="GET"&&p==="/api/export/grid"){
      const{content:data}=await ghGet(FILES.data);const gf=url.searchParams.get("group")||"",sf=url.searchParams.get("subgroup")||"";
      res.status(200).setHeader("Content-Type","text/csv").setHeader("Content-Disposition",`attachment; filename="attendance-grid-${gf||"all"}-${localDate()}.csv"`).end(csvGrid(data,gf,sf));return;
    }

    if(req.method==="POST"&&p==="/api/log/add-bulk"){
      const{names,date,adminDeviceId}=await readBody(req);const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      if(!names||!date)return json(400,{error:"names and date required"});
      let addedCount=0;
      const data=await update(FILES.data,data=>{
        for(const name of names){if(checkedInToday(data,name,date))continue;const dids=getDevicesForName(data,name),did=dids[0]||null;data.log.unshift({deviceId:did||`BULK-${Date.now()}`,name,group:did?getDeviceGroup(data,did):"",subgroup:did?getDeviceSubgroup(data,did):"",date,time:"12:00:00 PM",ts:Date.now(),manual:true,bulk:true});addedCount++;}
        return data;
      },"bulk add: "+date);
      await appendAudit("bulk-add",adminDeviceId,data,`${addedCount} members for ${date}`);return json(200,{status:"ok",added:addedCount});
    }

    if(req.method==="GET"&&p==="/api/events"){
      const{content}=await ghGet(FILES.events);return json(200,content);
    }
    if(req.method==="POST"&&p==="/api/events"){
      const{name,date,type,group,notes,adminDeviceId}=await readBody(req);const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      if(!name||!date)return json(400,{error:"name and date required"});
      const id=`evt-${Date.now()}`;
      await update(FILES.events,ev=>{ev.events.unshift({id,name:name.trim(),date,type:type||"기타",group:group||"",notes:notes||"",attendees:[],createdBy:adminDeviceId,createdAt:Date.now()});return ev;},"create event: "+name);
      const{content:data}=await ghGet(FILES.data);await appendAudit("event-create",adminDeviceId,data,`${name} (${date})`);return json(200,{status:"ok",id});
    }
    if(req.method==="PUT"&&p.startsWith("/api/events/")&&!p.endsWith("/attend")){
      const id=p.split("/api/events/")[1];const{attendees,name,date,type,notes,adminDeviceId}=await readBody(req);
      const{content:cfg}=await ghGet(FILES.config);if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      await update(FILES.events,ev=>{const idx=ev.events.findIndex(e=>e.id===id);if(idx===-1)return ev;if(attendees!==undefined)ev.events[idx].attendees=attendees;if(name!==undefined)ev.events[idx].name=name.trim();if(date!==undefined)ev.events[idx].date=date;if(type!==undefined)ev.events[idx].type=type;if(notes!==undefined)ev.events[idx].notes=notes;return ev;},"update event: "+id);
      return json(200,{status:"ok"});
    }
    if(req.method==="DELETE"&&p.startsWith("/api/events/")){
      const id=p.split("/api/events/")[1].split("/")[0];const adminId=req.headers["x-device-id"];
      const{content:cfg}=await ghGet(FILES.config);if(!isAdmin(cfg,adminId))return json(403,{error:"Not authorized"});
      let deleted;await update(FILES.events,ev=>{deleted=ev.events.find(e=>e.id===id);ev.events=ev.events.filter(e=>e.id!==id);return ev;},"delete event: "+id);
      const{content:data}=await ghGet(FILES.data);if(deleted)await appendAudit("event-delete",adminId,data,deleted.name);return json(200,{status:"ok"});
    }
    if(req.method==="POST"&&p.match(/^\/api\/events\/[^/]+\/attend$/)){
      const id=p.split("/")[3];const{name}=await readBody(req);if(!name)return json(400,{error:"name required"});
      let attendees;
      await update(FILES.events,ev=>{const idx=ev.events.findIndex(e=>e.id===id);if(idx===-1)return ev;if(!ev.events[idx].attendees)ev.events[idx].attendees=[];if(!ev.events[idx].attendees.includes(name))ev.events[idx].attendees.push(name);attendees=ev.events[idx].attendees;return ev;},"event attend: "+id);
      return json(200,{status:"ok",attendees});
    }

    if(req.method==="GET"&&p==="/api/audit"){
      const adminId=req.headers["x-device-id"]||url.searchParams.get("deviceId");const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminId))return json(403,{error:"Not authorized"});
      const{content:log}=await ghGet(FILES.audit);const limit=parseInt(url.searchParams.get("limit")||"100");
      return json(200,{log:(log||[]).slice(0,limit)});
    }

    if(req.method==="POST"&&p==="/api/merge-members"){
      const{fromName,toName,adminDeviceId}=await readBody(req);const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      if(!fromName||!toName||fromName===toName)return json(400,{error:"Invalid names"});
      let mergedCount=0;
      const data=await update(FILES.data,data=>{
        const fromDids=getDevicesForName(data,fromName);if(!fromDids.length)return data;
        const allM=getAllMembers(data),toInfo=allM[toName],toGroup=toInfo?toInfo.group:"",toSub=toInfo?(toInfo.subgroup||""):"";
        fromDids.forEach(did=>setDevice(data,did,toName.trim(),toGroup,toSub));
        data.log=data.log.map(e=>fromDids.includes(e.deviceId)?{...e,name:toName.trim(),group:toGroup,subgroup:toSub}:e);
        mergedCount=fromDids.length;return data;
      },"merge: "+fromName+" → "+toName);
      await appendAudit("merge-members",adminDeviceId,data,`${fromName} → ${toName} (${mergedCount} devices)`);return json(200,{status:"ok",merged:mergedCount});
    }

    if(req.method==="GET"&&p==="/api/pending"){
      const adminId=req.headers["x-device-id"]||url.searchParams.get("deviceId");const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminId))return json(403,{error:"Not authorized"});
      const{content:pending}=await ghGet(FILES.pending);return json(200,{pending:pending||[]});
    }
    if(req.method==="GET"&&p==="/api/pending/count"){
      const adminId=req.headers["x-device-id"]||url.searchParams.get("deviceId");const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminId))return json(200,{count:0});
      const{content:pending}=await ghGet(FILES.pending);return json(200,{count:(pending||[]).length});
    }
    if(req.method==="POST"&&p==="/api/pending/approve"){
      const{pendingDeviceId,adminDeviceId}=await readBody(req);const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      let approved;
      await update(FILES.pending,pending=>{const idx=pending.findIndex(p=>p.deviceId===pendingDeviceId);if(idx===-1)return pending;approved=pending[idx];pending.splice(idx,1);return pending;},"approve: "+pendingDeviceId);
      if(!approved)return json(404,{error:"Not found in pending list"});
      const data=await update(FILES.data,data=>{setDevice(data,approved.deviceId,approved.name,approved.group,approved.subgroup);return data;},"approve register: "+approved.name);
      await appendAudit("pending-approve",adminDeviceId,data,`${approved.name} (${approved.deviceId})`);return json(200,{status:"ok",name:approved.name});
    }
    if(req.method==="POST"&&p==="/api/pending/reject"){
      const{pendingDeviceId,adminDeviceId}=await readBody(req);const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminDeviceId))return json(403,{error:"Not authorized"});
      let rejected;
      await update(FILES.pending,pending=>{const idx=pending.findIndex(p=>p.deviceId===pendingDeviceId);if(idx===-1)return pending;rejected=pending[idx];pending.splice(idx,1);return pending;},"reject: "+pendingDeviceId);
      if(!rejected)return json(404,{error:"Not found"});
      const{content:data}=await ghGet(FILES.data);await appendAudit("pending-reject",adminDeviceId,data,`${rejected.name} (${rejected.deviceId})`);return json(200,{status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/backup"){
      const adminId=req.headers["x-device-id"]||url.searchParams.get("deviceId");const{content:cfg}=await ghGet(FILES.config);
      if(!isAdmin(cfg,adminId))return json(403,{error:"Not authorized"});
      const[{content:data},{content:events},{content:audit},{content:pending}]=await Promise.all([ghGet(FILES.data),ghGet(FILES.events),ghGet(FILES.audit),ghGet(FILES.pending)]);
      const filename=`kccp-backup-${localDate()}.json`;
      res.status(200).setHeader("Content-Type","application/json").setHeader("Content-Disposition",`attachment; filename="${filename}"`).end(JSON.stringify({version:1,exportedAt:Date.now(),attendance:data,config:cfg,events,audit,pending},null,2));return;
    }
    if(req.method==="POST"&&p==="/api/restore"){
      const adminId=req.headers["x-device-id"];const{content:cfg0}=await ghGet(FILES.config);
      if(!isAdmin(cfg0,adminId))return json(403,{error:"Not authorized"});
      const body=await readBody(req);if(!body.version||!body.attendance)return json(400,{error:"Invalid backup file"});
      await Promise.all([
        body.attendance&&update(FILES.data,_=>body.attendance,"restore data"),
        body.config&&update(FILES.config,_=>body.config,"restore config"),
        body.events&&update(FILES.events,_=>body.events,"restore events"),
        body.audit&&update(FILES.audit,_=>body.audit,"restore audit"),
        body.pending&&update(FILES.pending,_=>body.pending,"restore pending")
      ].filter(Boolean));
      const{content:data}=await ghGet(FILES.data);
      const exportDateStr=body.exportedAt?new Date(body.exportedAt).toLocaleString("ko-KR",{timeZone:"America/New_York"}):"unknown";
      await appendAudit("restore",adminId,data,`Restored backup from ${exportDateStr}`);return json(200,{status:"ok"});
    }

    if(req.method==="GET"&&p==="/api/report/html"){
      const{content:data}=await ghGet(FILES.data);
      const gf=url.searchParams.get("group")||"",sf=url.searchParams.get("subgroup")||"",period=url.searchParams.get("period")||"all",fromP=url.searchParams.get("from")||"",toP=url.searchParams.get("to")||"";
      let logs=[...data.log];
      if(gf)logs=logs.filter(e=>(getDeviceGroup(data,e.deviceId)||e.group||"")===gf);
      if(sf)logs=logs.filter(e=>(getDeviceSubgroup(data,e.deviceId)||e.subgroup||"")===sf);
      const today=localDate();
      if(period==="today")logs=logs.filter(e=>e.date===today);
      else if(period==="weekly"){const d=new Date();d.setDate(d.getDate()-6);logs=logs.filter(e=>e.date>=d.toLocaleDateString("en-CA",{timeZone:"America/New_York"})&&e.date<=today);}
      else if(period==="monthly")logs=logs.filter(e=>e.date.startsWith(today.slice(0,7)));
      else if(fromP||toP){if(fromP)logs=logs.filter(e=>e.date>=fromP);if(toP)logs=logs.filter(e=>e.date<=toP);}
      const dates=[...new Set(logs.map(e=>e.date))].sort();
      const members={};
      Object.entries(data.devices).forEach(([did,v])=>{const info=typeof v==="string"?{name:v,group:"",subgroup:""}:v;if(gf&&info.group!==gf)return;if(sf&&(info.subgroup||"")!==sf)return;if(!members[info.name])members[info.name]={group:info.group||"",subgroup:info.subgroup||"",devices:[]};members[info.name].devices.push(did);});
      const names=Object.keys(members).sort();
      const periodLabel=period==="today"?today:period==="weekly"?"최근 7일":period==="monthly"?today.slice(0,7):(fromP&&toP?`${fromP} ~ ${toP}`:"전체");
      let gridRows="";
      names.forEach(name=>{const dids=members[name].devices,total=dates.filter(d=>logs.find(x=>dids.includes(x.deviceId)&&x.date===d)).length,rate=dates.length?Math.round(total/dates.length*100):0;let row=`<tr><td class="nc">${name}</td><td>${members[name].group}${members[name].subgroup?" / "+members[name].subgroup:""}</td><td class="tc">${total}</td><td class="tc" style="color:${rate>=80?"#16a34a":rate>=60?"#d97706":"#dc2626"}">${rate}%</td>`;dates.forEach(d=>{const e=logs.find(x=>dids.includes(x.deviceId)&&x.date===d);row+=e?`<td class="pc">✓</td>`:`<td class="ac">—</td>`;});gridRows+=row+"</tr>";});
      const totalByDate=dates.map(d=>{const s=new Set();logs.filter(e=>e.date===d).forEach(e=>s.add(getDeviceName(data,e.deviceId)||e.name));return s.size;});
      const totalRow=`<tr class="tot"><td class="nc">TOTAL</td><td></td><td></td><td></td>`+totalByDate.map(n=>`<td class="tc">${n}</td>`).join("")+"</tr>";
      const html=`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>KCCP 출석 보고서 — ${periodLabel}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;font-size:12px;color:#111;background:#fff;padding:24px}h1{font-size:20px;font-weight:800;margin-bottom:4px}.sub{font-size:13px;color:#555;margin-bottom:20px}.stats{display:flex;gap:16px;margin-bottom:20px}.stat{background:#f5f5f5;border-radius:8px;padding:10px 16px;text-align:center}.stat b{display:block;font-size:22px;font-weight:800}.stat span{font-size:10px;color:#777;text-transform:uppercase;letter-spacing:.8px}table{width:100%;border-collapse:collapse;font-size:11px}th{padding:6px 8px;background:#4a2d87;color:#fff;font-size:10px;white-space:nowrap;text-align:center}th.nc{text-align:left;min-width:110px}td{padding:5px 8px;border:1px solid #e5e5e5;text-align:center}td.nc{text-align:left;font-weight:600;font-size:12px;border-right:2px solid #ccc}td.tc{font-weight:700;background:#fafaf8}td.pc{color:#16a34a;font-weight:700}td.ac{color:#ccc}tr:nth-child(even) td{background:#fafaf8}tr.tot td{background:#ede9fe!important;font-weight:700;border-top:2px solid #7c3aed;color:#5b21b6}.btn{display:inline-block;margin-top:16px;padding:8px 20px;background:#6d28d9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700}@media print{.btn{display:none}}</style></head><body><h1>📊 KCCP 출석 보고서</h1><div class="sub">기간: ${periodLabel}${gf?" · "+gf:""}${sf?" / "+sf:""} &nbsp;·&nbsp; 생성: ${new Date().toLocaleString("ko-KR",{timeZone:"America/New_York"})}</div><div class="stats"><div class="stat"><b>${names.length}</b><span>멤버 수</span></div><div class="stat"><b>${dates.length}</b><span>주일 수</span></div><div class="stat"><b>${logs.length}</b><span>총 출석</span></div><div class="stat"><b>${dates.length?Math.round(totalByDate.reduce((a,b)=>a+b,0)/dates.length):0}</b><span>평균 출석</span></div></div>${names.length&&dates.length?`<div style="overflow-x:auto"><table><thead><tr><th class="nc">이름</th><th>그룹</th><th class="tc">합계</th><th class="tc">출석률</th>${dates.map(d=>`<th>${fmtDateWithDay(d).replace(/, \d{4}/,"")}</th>`).join("")}</tr></thead><tbody>${gridRows}${totalRow}</tbody></table></div>`:"<p style='color:#999;margin-top:16px;'>출석 기록이 없습니다.</p>"}<button class="btn" onclick="window.print()">🖨 PDF로 저장 / 인쇄</button></body></html>`;
      res.status(200).setHeader("Content-Type","text/html; charset=utf-8").end(html);return;
    }

    json(404,{error:"Not found"});
  } catch(e) { json(400,{error:e.message}); }
};
