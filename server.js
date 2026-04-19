const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const DATA_FILE = path.join(__dirname, "attendance-data.json");
const CONFIG_FILE = path.join(__dirname, "config.json");
const EVENTS_FILE = path.join(__dirname, "events-data.json");
const AUDIT_FILE = path.join(__dirname, "audit-log.json");
const PENDING_FILE = path.join(__dirname, "pending-registrations.json");

// ─── Change this before first run! ───
const ADMIN_PASSWORD = "kccpwelcome";

const DEFAULT_DONGSAN = { "대학부": ["동산1","동산2","동산3","동산4"], "청년부": ["동산1","동산2","동산3","동산4"] };
const DEFAULT_CONFIG = { adminDevices: [], nameOrder: [], dongsanNames: DEFAULT_DONGSAN, checkinDays: [0], checkinStartMin: 780, checkinEndMin: 900, dongsanLeaders: {}, requireApproval: false };
// devices format: { "DEV-xxx": { name: "김호연", group: "대학부", subgroup: "동산1" } }
// Backward compat: if value is string, treat as { name: string, group: "", subgroup: "" }

function loadJSON(file, fb) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")); } catch(e) { console.error(e.message); }
  return JSON.parse(JSON.stringify(fb));
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8"); }

if (!fs.existsSync(DATA_FILE)) saveJSON(DATA_FILE, { devices: {}, log: [] });
if (!fs.existsSync(CONFIG_FILE)) saveJSON(CONFIG_FILE, DEFAULT_CONFIG);
if (!fs.existsSync(EVENTS_FILE)) saveJSON(EVENTS_FILE, { events: [] });
if (!fs.existsSync(AUDIT_FILE)) saveJSON(AUDIT_FILE, []);
if (!fs.existsSync(PENDING_FILE)) saveJSON(PENDING_FILE, []);

// ─── Eastern Time ───
function localDate() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
function localTime() { return new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function fmtDateWithDay(d) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" }); }

// ─── Device info helpers (backward compatible) ───
function getDeviceInfo(data, deviceId) {
  const v = data.devices[deviceId];
  if (!v) return null;
  if (typeof v === "string") return { name: v, group: "" };
  return v;
}
function getDeviceName(data, deviceId) {
  const info = getDeviceInfo(data, deviceId);
  return info ? info.name : null;
}
function getDeviceGroup(data, deviceId) {
  const info = getDeviceInfo(data, deviceId);
  return info ? info.group || "" : "";
}
function getDeviceSubgroup(data, deviceId) {
  const info = getDeviceInfo(data, deviceId);
  return info ? info.subgroup || "" : "";
}
function setDevice(data, deviceId, name, group, subgroup, extra = {}) {
  const prev = (data.devices[deviceId] && typeof data.devices[deviceId] === "object") ? data.devices[deviceId] : {};
  const d = { name: name.trim(), group: (group || "").trim(), subgroup: (subgroup || "").trim() };
  d.notes = extra.notes !== undefined ? extra.notes : (prev.notes || "");
  // memberRole supersedes old visitor boolean
  if (extra.memberRole !== undefined) d.memberRole = extra.memberRole;
  else if (prev.memberRole) d.memberRole = prev.memberRole;
  else if (prev.visitor) d.memberRole = "visitor"; // migrate old visitor flag
  data.devices[deviceId] = d;
}

// ─── Get all unique names with their group ───
function getAllMembers(data) {
  const members = {};
  Object.entries(data.devices).forEach(([did, v]) => {
    const info = typeof v === "string" ? { name: v, group: "", subgroup: "" } : v;
    if (!members[info.name]) members[info.name] = { group: info.group || "", subgroup: info.subgroup || "", devices: [] };
    members[info.name].devices.push(did);
  });
  return members;
}

function getDevicesForName(data, name) {
  return Object.entries(data.devices).filter(([did, v]) => {
    const n = typeof v === "string" ? v : v.name;
    return n === name;
  }).map(([did]) => did);
}

function totalForName(data, name) {
  const dids = getDevicesForName(data, name);
  const dates = new Set();
  data.log.forEach(e => { if (dids.includes(e.deviceId)) dates.add(e.date); });
  return dates.size;
}

function checkedInToday(data, name, today) {
  const dids = getDevicesForName(data, name);
  return data.log.find(e => dids.includes(e.deviceId) && e.date === today) || null;
}

// ─── CSV: log format ───
function csvLog(data, groupFilter, subgroupFilter) {
  const h = ["Name", "Group", "Subgroup", "Day", "Date", "Time", "Total"];
  let logs = [...data.log].sort((a, b) => b.ts - a.ts);
  if (groupFilter) {
    logs = logs.filter(e => {
      const info = getDeviceInfo(data, e.deviceId);
      return info && info.group === groupFilter;
    });
  }
  if (subgroupFilter) {
    logs = logs.filter(e => {
      const info = getDeviceInfo(data, e.deviceId);
      return info && (info.subgroup || "") === subgroupFilter;
    });
  }
  const r = logs.map(e => {
    const name = getDeviceName(data, e.deviceId) || e.name;
    const group = getDeviceGroup(data, e.deviceId) || e.group || "";
    const subgroup = getDeviceSubgroup(data, e.deviceId) || e.subgroup || "";
    const day = new Date(e.date + "T12:00:00").toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
    return [name, group, subgroup, day, e.date, e.time, totalForName(data, name)];
  });
  return [h, ...r].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

// ─── CSV: grid format ───
function csvGrid(data, groupFilter, subgroupFilter) {
  const members = getAllMembers(data);
  let names = Object.keys(members).sort();
  if (groupFilter) names = names.filter(n => members[n].group === groupFilter);
  if (subgroupFilter) names = names.filter(n => (members[n].subgroup || "") === subgroupFilter);
  const dates = [...new Set(data.log.map(e => e.date))].sort();

  const h = ["Name", "Group", "Subgroup", "Total", ...dates.map(d => fmtDateWithDay(d))];
  const r = names.map(name => {
    const dids = members[name].devices;
    const total = totalForName(data, name);
    return [name, members[name].group, members[name].subgroup || "", total, ...dates.map(d => {
      const e = data.log.find(x => dids.includes(x.deviceId) && x.date === d);
      return e ? e.time : "";
    })];
  });
  return [h, ...r].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function readBody(req) {
  return new Promise((res, rej) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
}
function isAdmin(deviceId) {
  const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
  if (!config.adminDevices || config.adminDevices.length === 0) return true;
  return config.adminDevices.some(d => typeof d === "string" ? d === deviceId : d.deviceId === deviceId);
}
function getAdminRole(deviceId) {
  const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
  if (!config.adminDevices || config.adminDevices.length === 0) return "super";
  const entry = config.adminDevices.find(d => typeof d === "string" ? d === deviceId : d.deviceId === deviceId);
  if (!entry) return null;
  return (typeof entry === "string") ? "super" : (entry.role || "super");
}
function getAdminEntry(deviceId) {
  const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
  if (!config.adminDevices || config.adminDevices.length === 0) return { role: "super", group: "", subgroup: "" };
  const entry = config.adminDevices.find(d => typeof d === "string" ? d === deviceId : d.deviceId === deviceId);
  if (!entry) return null;
  return typeof entry === "string" ? { deviceId: entry, role: "super", group: "", subgroup: "" } : { role: "super", group: "", subgroup: "", ...entry };
}
function appendAudit(action, adminId, data, details) {
  try {
    const log = loadJSON(AUDIT_FILE, []);
    const adminName = getDeviceName(data, adminId) || adminId;
    log.unshift({ ts: Date.now(), action, adminId, adminName, details });
    if (log.length > 1000) log.splice(1000);
    saveJSON(AUDIT_FILE, log);
  } catch(e) { console.error("Audit error:", e.message); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Device-Id");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

  try {
    // Serve HTML
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const p = path.join(__dirname, "index.html");
      if (fs.existsSync(p)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(p, "utf-8")); }
      return json(404, { error: "index.html not found" });
    }
    if (req.method === "GET" && url.pathname === "/logo.jpeg") {
      const p = path.join(__dirname, "logo.jpeg");
      if (fs.existsSync(p)) { res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" }); return res.end(fs.readFileSync(p)); }
      res.writeHead(404); return res.end();
    }

    // PWA files
    if (req.method === "GET" && url.pathname === "/manifest.json") {
      const p = path.join(__dirname, "manifest.json");
      if (fs.existsSync(p)) { res.writeHead(200, { "Content-Type": "application/manifest+json" }); return res.end(fs.readFileSync(p)); }
      res.writeHead(404); return res.end();
    }
    if (req.method === "GET" && url.pathname === "/sw.js") {
      const p = path.join(__dirname, "sw.js");
      if (fs.existsSync(p)) { res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }); return res.end(fs.readFileSync(p)); }
      res.writeHead(404); return res.end();
    }
    if (req.method === "GET" && (url.pathname === "/icon-192.png" || url.pathname === "/icon-512.png")) {
      const p = path.join(__dirname, url.pathname.slice(1));
      if (fs.existsSync(p)) { res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }); return res.end(fs.readFileSync(p)); }
      res.writeHead(404); return res.end();
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/api/health") return json(200, { status: "ok", ts: Date.now() });

    // Data
    if (req.method === "GET" && url.pathname === "/api/data") return json(200, loadJSON(DATA_FILE, { devices: {}, log: [] }));

    // Check admin
    if (req.method === "POST" && url.pathname === "/api/check-admin") {
      const { deviceId } = await readBody(req); const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      const entry = getAdminEntry(deviceId);
      return json(200, { isAdmin: isAdmin(deviceId), noAdminsYet: !config.adminDevices || config.adminDevices.length === 0, role: entry ? entry.role : null, leaderGroup: entry ? (entry.group || "") : "", leaderSubgroup: entry ? (entry.subgroup || "") : "" });
    }

    // Check in
    if (req.method === "POST" && url.pathname === "/api/checkin") {
      const { deviceId, lat, lng } = await readBody(req); const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      
      // Time restriction — configurable via /api/config
      const now = new Date();
      const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = eastern.getDay();
      const hour = eastern.getHours();
      const min = eastern.getMinutes();
      const timeInMin = hour * 60 + min;
      const cfg2 = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      const allowedDays = cfg2.checkinDays !== undefined ? cfg2.checkinDays : [0];
      const startMin = cfg2.checkinStartMin !== undefined ? cfg2.checkinStartMin : 780;
      const endMin = cfg2.checkinEndMin !== undefined ? cfg2.checkinEndMin : 900;
      const DAY_NAMES = ["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
      const allowedDayNames = allowedDays.map(d => DAY_NAMES[d]).join(", ");
      const fmtMin = m => { const h=Math.floor(m/60); const mn=m%60; const h12=h%12||12; return `${String(h12).padStart(2,"0")}:${String(mn).padStart(2,"0")} ${h>=12?"PM":"AM"}`; };
      if (!allowedDays.includes(day)) {
        return json(200, { status: "time-restricted", message: "출석 가능한 요일이 아닙니다", sub: `출석 가능 요일: ${allowedDayNames}` });
      }
      if (timeInMin < startMin || timeInMin >= endMin) {
        return json(200, { status: "time-restricted", message: "출석 시간이 아닙니다", sub: `출석 가능 시간: ${fmtMin(startMin)} ~ ${fmtMin(endMin)}` });
      }

      // Location restriction: must be within ~30m (~100ft) of church
      const CHURCH_LAT = 40.450218535488325;
      const CHURCH_LNG = -79.93480148825721;
      const MAX_DISTANCE_M = 30;
      if (lat !== undefined && lng !== undefined) {
        const R = 6371000;
        const dLat = (lat - CHURCH_LAT) * Math.PI / 180;
        const dLng = (lng - CHURCH_LNG) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(CHURCH_LAT*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLng/2)**2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (dist > MAX_DISTANCE_M) {
          return json(200, { status: "location-restricted", message: "교회 근처에서만 출석할 수 있습니다.", distance: Math.round(dist) });
        }
      } else {
        return json(200, { status: "location-required", message: "위치 정보가 필요합니다. 위치 접근을 허용해주세요." });
      }

      const today = localDate(); const time = localTime();
      const name = getDeviceName(data, deviceId);
      const group = getDeviceGroup(data, deviceId);
      const subgroup = getDeviceSubgroup(data, deviceId);
      const deviceInfo = getDeviceInfo(data, deviceId);
      const memberRole = deviceInfo ? (deviceInfo.memberRole || (deviceInfo.visitor ? "visitor" : "")) : "";
      if (name) {
        const existing = checkedInToday(data, name, today);
        if (existing) return json(200, { status: "already", time: existing.time, name, group, subgroup, totalAttendance: totalForName(data, name) });
      } else {
        const existing = data.log.find(e => e.deviceId === deviceId && e.date === today);
        if (existing) return json(200, { status: "already", time: existing.time, name: existing.name, group: "", subgroup: "", totalAttendance: 0 });
      }
      const displayName = name || `Unknown (${deviceId.slice(0, 12)}...)`;
      const currentTotal = name ? totalForName(data, name) : 0;
      const isFirstVisit = currentTotal === 0;
      const entry = { deviceId, name: displayName, group: group || "", subgroup: subgroup || "", date: today, time, ts: Date.now() };
      if (isFirstVisit) entry.firstVisit = true;
      if (memberRole) entry.memberRole = memberRole;
      data.log.unshift(entry); saveJSON(DATA_FILE, data);
      const total = name ? totalForName(data, name) : 1;
      console.log(`[CHECK-IN] ${displayName} (${group || "no group"}${subgroup ? "/" + subgroup : ""}${isFirstVisit ? " FIRST" : ""}) | ${today} ${time} | Total: ${total}`);
      return json(200, { status: "ok", time, name: displayName, group, subgroup, isRegistered: !!name, totalAttendance: total, firstVisit: isFirstVisit });
    }

    // Self-register with group
    if (req.method === "POST" && url.pathname === "/api/self-register") {
      const { deviceId, name, group, subgroup } = await readBody(req);
      if (!deviceId || !name) throw new Error("deviceId and name required");
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const existing = getDeviceInfo(data, deviceId);
      if (existing) return json(200, { status: "already-registered", name: existing.name });
      const cfg = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      if (cfg.requireApproval) {
        const pending = loadJSON(PENDING_FILE, []);
        const alreadyPending = pending.find(p => p.deviceId === deviceId);
        if (alreadyPending) return json(200, { status: "pending", name: alreadyPending.name });
        pending.unshift({ deviceId, name: name.trim(), group: group || "", subgroup: subgroup || "", requestedAt: Date.now() });
        saveJSON(PENDING_FILE, pending);
        console.log(`[PENDING-REGISTER] ${name.trim()} (${group || "no group"}${subgroup ? "/" + subgroup : ""})`);
        return json(200, { status: "pending", name: name.trim() });
      }
      setDevice(data, deviceId, name, group || "", subgroup || "");
      data.log = data.log.map(e => e.deviceId === deviceId.trim() ? { ...e, name: name.trim(), group: (group || "").trim(), subgroup: (subgroup || "").trim() } : e);
      saveJSON(DATA_FILE, data);
      console.log(`[SELF-REGISTER] ${name.trim()} (${group || "no group"}${subgroup ? "/" + subgroup : ""})`);
      return json(200, { status: "ok", name: name.trim() });
    }

    // Admin register device with group
    if (req.method === "POST" && url.pathname === "/api/register") {
      const { deviceId, name, group, subgroup, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      setDevice(data, deviceId, name, group || "", subgroup || "");
      data.log = data.log.map(e => e.deviceId === deviceId.trim() ? { ...e, name: name.trim(), group: (group || "").trim(), subgroup: (subgroup || "").trim() } : e);
      saveJSON(DATA_FILE, data);
      appendAudit("device-register", adminDeviceId, data, `${name} (${deviceId})`);
      return json(200, { status: "ok" });
    }

    // Edit device info (rename, change group, notes, visitor)
    if (req.method === "PUT" && url.pathname === "/api/device") {
      const { deviceId, name, group, subgroup, notes, memberRole, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      if (!data.devices[deviceId]) return json(404, { error: "Device not found" });
      const oldName = getDeviceName(data, deviceId);
      const oldSubgroup = getDeviceSubgroup(data, deviceId);
      const extra = {};
      if (notes !== undefined) extra.notes = notes;
      if (memberRole !== undefined) extra.memberRole = memberRole;
      setDevice(data, deviceId, name || oldName, group !== undefined ? group : getDeviceGroup(data, deviceId), subgroup !== undefined ? subgroup : oldSubgroup, extra);
      const newName = name ? name.trim() : oldName;
      const newGroup = group !== undefined ? group.trim() : getDeviceGroup(data, deviceId);
      const newSubgroup = subgroup !== undefined ? subgroup.trim() : oldSubgroup;
      // Update log entries for all devices with the old name
      if (oldName && name && oldName !== newName) {
        const allDids = getDevicesForName(data, oldName);
        allDids.forEach(did => setDevice(data, did, newName, newGroup, newSubgroup, extra));
        data.log = data.log.map(e => allDids.includes(e.deviceId) ? { ...e, name: newName, group: newGroup, subgroup: newSubgroup } : e);
      }
      saveJSON(DATA_FILE, data);
      appendAudit("device-edit", adminDeviceId, data, `${newName} (${deviceId})`);
      return json(200, { status: "ok" });
    }

    // Link device
    if (req.method === "POST" && url.pathname === "/api/link-device") {
      const { newDeviceId, existingName, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const members = getAllMembers(data);
      const group = members[existingName] ? members[existingName].group : "";
      const subgroup = members[existingName] ? (members[existingName].subgroup || "") : "";
      setDevice(data, newDeviceId.trim(), existingName.trim(), group, subgroup);
      data.log = data.log.map(e => e.deviceId === newDeviceId.trim() ? { ...e, name: existingName.trim(), group, subgroup } : e);
      saveJSON(DATA_FILE, data);
      return json(200, { status: "ok", devices: getDevicesForName(data, existingName.trim()) });
    }

    // Remove single device
    if (req.method === "DELETE" && url.pathname.startsWith("/api/device/")) {
      const did = decodeURIComponent(url.pathname.split("/api/device/")[1]);
      const adminId = req.headers["x-device-id"];
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      delete data.devices[did];
      saveJSON(DATA_FILE, data);
      return json(200, { status: "ok" });
    }

    // Remove person and all their devices + log entries
    if (req.method === "POST" && url.pathname === "/api/remove-person") {
      const { name, deleteRecords, adminDeviceId } = await readBody(req);
      console.log(`[REMOVE-REQ] name="${name}" deleteRecords=${deleteRecords} adminDeviceId="${adminDeviceId}" isAdmin=${isAdmin(adminDeviceId)}`);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const dids = getDevicesForName(data, name);
      console.log(`[REMOVE] found ${dids.length} devices for "${name}": ${dids.join(", ")}`);
      dids.forEach(did => delete data.devices[did]);
      if (deleteRecords) {
        const before = data.log.length;
        data.log = data.log.filter(e => !dids.includes(e.deviceId) && (e.name || "").trim() !== name.trim());
        console.log(`[REMOVE] log: ${before} → ${data.log.length} entries`);
      }
      saveJSON(DATA_FILE, data);
      appendAudit("person-remove", adminDeviceId, data, `${name}${deleteRecords ? " (records deleted)" : ""}`);
      console.log(`[REMOVE] done: "${name}"`);
      return json(200, { status: "ok" });
    }

    // Clear log
    if (req.method === "DELETE" && url.pathname === "/api/log") {
      const adminId = req.headers["x-device-id"];
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] }); data.log = []; saveJSON(DATA_FILE, data);
      return json(200, { status: "ok" });
    }

    // Clear all devices (keep log)
    if (req.method === "DELETE" && url.pathname === "/api/devices") {
      const adminId = req.headers["x-device-id"];
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] }); data.devices = {}; saveJSON(DATA_FILE, data);
      console.log("[CLEAR] All devices removed");
      return json(200, { status: "ok" });
    }

    // Clear everything (devices + log)
    if (req.method === "DELETE" && url.pathname === "/api/all") {
      const adminId = req.headers["x-device-id"];
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      saveJSON(DATA_FILE, { devices: {}, log: [] });
      console.log("[CLEAR] All data wiped");
      return json(200, { status: "ok" });
    }

    // Save custom name order
    if (req.method === "POST" && url.pathname === "/api/name-order") {
      const { order, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      config.nameOrder = order || [];
      saveJSON(CONFIG_FILE, config);
      return json(200, { status: "ok" });
    }

    // Get custom name order
    if (req.method === "GET" && url.pathname === "/api/name-order") {
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      return json(200, { order: config.nameOrder || [] });
    }

    // Manually add an attendance entry (admin only)
    if (req.method === "POST" && url.pathname === "/api/log/add-manual") {
      const { name, date, time: manualTime, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      if (!name || !date) return json(400, { error: "name and date required" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const existing = checkedInToday(data, name, date);
      if (existing) return json(200, { status: "already" });
      const dids = getDevicesForName(data, name);
      const did = dids[0] || null;
      const group = did ? getDeviceGroup(data, did) : "";
      const subgroup = did ? getDeviceSubgroup(data, did) : "";
      const entry = { deviceId: did || `MANUAL-${Date.now()}`, name, group, subgroup, date, time: manualTime || localTime(), ts: Date.now(), manual: true };
      data.log.unshift(entry);
      saveJSON(DATA_FILE, data);
      appendAudit("manual-add", adminDeviceId, data, `${name} | ${date}`);
      console.log(`[MANUAL ADD] ${name} | ${date} (by admin)`);
      return json(200, { status: "ok" });
    }

    // Admin check-in: bypasses time/location, for today only
    if (req.method === "POST" && url.pathname === "/api/admin/checkin") {
      const { name, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      if (!name || !name.trim()) return json(400, { error: "name required" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const today = localDate(); const time = localTime();
      const existing = checkedInToday(data, name.trim(), today);
      if (existing) return json(200, { status: "already", time: existing.time, name: name.trim() });
      const dids = getDevicesForName(data, name.trim());
      const did = dids[0] || null;
      const group = did ? getDeviceGroup(data, did) : "";
      const subgroup = did ? getDeviceSubgroup(data, did) : "";
      const entry = { deviceId: did || `MANUAL-${Date.now()}`, name: name.trim(), group, subgroup, date: today, time, ts: Date.now(), manual: true };
      data.log.unshift(entry);
      saveJSON(DATA_FILE, data);
      appendAudit("admin-checkin", adminDeviceId, data, `${name.trim()} | ${today} ${time}`);
      console.log(`[ADMIN CHECK-IN] ${name.trim()} | ${today} ${time}`);
      return json(200, { status: "ok", time, name: name.trim(), total: totalForName(data, name.trim()) });
    }

    // Guest check-in (no device registration, respects time/location)
    if (req.method === "POST" && url.pathname === "/api/guest-checkin") {
      const { name, lat, lng } = await readBody(req);
      if (!name || !name.trim()) return json(400, { error: "name required" });
      const now2 = new Date();
      const eastern2 = new Date(now2.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day2 = eastern2.getDay();
      const timeInMin2 = eastern2.getHours() * 60 + eastern2.getMinutes();
      const cfg3 = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      const allowedDays2 = cfg3.checkinDays !== undefined ? cfg3.checkinDays : [0];
      const startMin2 = cfg3.checkinStartMin !== undefined ? cfg3.checkinStartMin : 780;
      const endMin2 = cfg3.checkinEndMin !== undefined ? cfg3.checkinEndMin : 900;
      const DAY_NAMES2 = ["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
      const fmtMin2 = m => { const h=Math.floor(m/60),mn=m%60,h12=h%12||12; return `${String(h12).padStart(2,"0")}:${String(mn).padStart(2,"0")} ${h>=12?"PM":"AM"}`; };
      if (!allowedDays2.includes(day2)) return json(200, { status: "time-restricted", message: "출석 가능한 요일이 아닙니다", sub: `출석 가능 요일: ${allowedDays2.map(d=>DAY_NAMES2[d]).join(", ")}` });
      if (timeInMin2 < startMin2 || timeInMin2 >= endMin2) return json(200, { status: "time-restricted", message: "출석 시간이 아닙니다", sub: `출석 가능 시간: ${fmtMin2(startMin2)} ~ ${fmtMin2(endMin2)}` });
      const CHURCH_LAT2 = 40.450218535488325, CHURCH_LNG2 = -79.93480148825721;
      if (lat !== undefined && lng !== undefined) {
        const R=6371000, dLat=(lat-CHURCH_LAT2)*Math.PI/180, dLng=(lng-CHURCH_LNG2)*Math.PI/180;
        const a=Math.sin(dLat/2)**2+Math.cos(CHURCH_LAT2*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLng/2)**2;
        const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
        if (dist > 30) return json(200, { status: "location-restricted", message: "교회 근처에서만 출석할 수 있습니다.", distance: Math.round(dist) });
      } else {
        return json(200, { status: "location-required", message: "위치 정보가 필요합니다. 위치 접근을 허용해주세요." });
      }
      const today = localDate(); const time = localTime();
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const existing = data.log.find(e => e.name === name.trim() && e.date === today && e.guest);
      if (existing) return json(200, { status: "already", time: existing.time, name: name.trim() });
      const guestId = `GUEST-${Date.now()}`;
      const entry = { deviceId: guestId, name: name.trim(), group: "", subgroup: "", date: today, time, ts: Date.now(), guest: true, memberRole: "visitor" };
      data.log.unshift(entry);
      saveJSON(DATA_FILE, data);
      console.log(`[GUEST CHECK-IN] ${name.trim()} | ${today} ${time}`);
      return json(200, { status: "ok", time, name: name.trim() });
    }

    // Remove a specific attendance entry by ts (admin only)
    if (req.method === "POST" && url.pathname === "/api/log/remove-entry") {
      const { ts, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const removed = data.log.find(e => e.ts === ts);
      data.log = data.log.filter(e => e.ts !== ts);
      saveJSON(DATA_FILE, data);
      appendAudit("manual-remove", adminDeviceId, data, removed ? `${removed.name} | ${removed.date}` : `ts=${ts}`);
      console.log(`[REMOVE ENTRY] ts=${ts}`);
      return json(200, { status: "ok" });
    }

    // Get 동산 names
    if (req.method === "GET" && url.pathname === "/api/dongsan-names") {
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      return json(200, { names: config.dongsanNames || DEFAULT_DONGSAN });
    }

    // Update a 동산 name (and rename all devices/logs that used the old name)
    if (req.method === "POST" && url.pathname === "/api/dongsan-names") {
      const { group, index, name, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      if (!group || index === undefined || !name) return json(400, { error: "group, index, and name required" });
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      if (!config.dongsanNames) config.dongsanNames = JSON.parse(JSON.stringify(DEFAULT_DONGSAN));
      if (!config.dongsanNames[group]) config.dongsanNames[group] = ["동산1","동산2","동산3","동산4"];
      const oldName = config.dongsanNames[group][index];
      const newName = name.trim();
      config.dongsanNames[group][index] = newName;
      saveJSON(CONFIG_FILE, config);
      // Rename devices and logs that had the old subgroup name in this group
      if (oldName && oldName !== newName) {
        const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
        const affected = Object.entries(data.devices)
          .filter(([, v]) => typeof v !== "string" && v.group === group && v.subgroup === oldName)
          .map(([did]) => did);
        affected.forEach(did => { data.devices[did] = { ...data.devices[did], subgroup: newName }; });
        data.log = data.log.map(e => affected.includes(e.deviceId) ? { ...e, subgroup: newName } : e);
        saveJSON(DATA_FILE, data);
        console.log(`[DONGSAN RENAME] ${group} "${oldName}" → "${newName}" (${affected.length} devices updated)`);
      }
      return json(200, { status: "ok", names: config.dongsanNames });
    }

    // Get 동산 leaders
    if (req.method === "GET" && url.pathname === "/api/dongsan-leaders") {
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      return json(200, { leaders: config.dongsanLeaders || {} });
    }

    // Set 동산 leaders
    if (req.method === "POST" && url.pathname === "/api/dongsan-leaders") {
      const { group, subgroup, leader, subLeaders, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      if (!group || !subgroup) return json(400, { error: "group and subgroup required" });
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      if (!config.dongsanLeaders) config.dongsanLeaders = {};
      if (!config.dongsanLeaders[group]) config.dongsanLeaders[group] = {};
      config.dongsanLeaders[group][subgroup] = { leader: leader || "", subLeaders: subLeaders || [] };
      saveJSON(CONFIG_FILE, config);
      appendAudit("config-change", adminDeviceId, loadJSON(DATA_FILE, { devices: {}, log: [] }), `동산지기: ${group} ${subgroup}`);
      return json(200, { status: "ok", leaders: config.dongsanLeaders });
    }

    // Transfer member to a different group/subgroup
    if (req.method === "POST" && url.pathname === "/api/transfer-member") {
      const { name, newGroup, newSubgroup, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      if (!name || !newGroup) return json(400, { error: "name and newGroup required" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const dids = getDevicesForName(data, name);
      if (!dids.length) return json(404, { error: "Member not found" });
      dids.forEach(did => {
        const cur = data.devices[did];
        data.devices[did] = { name: typeof cur === "string" ? cur : cur.name, group: newGroup, subgroup: newSubgroup || "" };
      });
      saveJSON(DATA_FILE, data);
      appendAudit("transfer-member", adminDeviceId, data, `${name} → ${newGroup} ${newSubgroup || ""}`);
      console.log(`[TRANSFER] ${name} → ${newGroup} ${newSubgroup || ""}`);
      return json(200, { status: "ok" });
    }

    // Admin management
    if (req.method === "POST" && url.pathname === "/api/admin/add") {
      const { password, targetDeviceId, role, group, subgroup } = await readBody(req);
      if (password !== ADMIN_PASSWORD) return json(403, { error: "Wrong password" });
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      if (!config.adminDevices) config.adminDevices = [];
      config.adminDevices = config.adminDevices.filter(d => typeof d === "string" ? d !== targetDeviceId.trim() : d.deviceId !== targetDeviceId.trim());
      const entry = { deviceId: targetDeviceId.trim(), role: role || "super" };
      if (group) entry.group = group;
      if (subgroup) entry.subgroup = subgroup;
      config.adminDevices.push(entry);
      saveJSON(CONFIG_FILE, config);
      const dataForAudit = loadJSON(DATA_FILE, { devices: {}, log: [] });
      appendAudit("admin-add", targetDeviceId.trim(), dataForAudit, `${getDeviceName(dataForAudit, targetDeviceId.trim())||targetDeviceId} role=${role||"super"}`);
      return json(200, { status: "ok" });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/remove") {
      const { password, targetDeviceId } = await readBody(req);
      if (password !== ADMIN_PASSWORD) return json(403, { error: "Wrong password" });
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      config.adminDevices = (config.adminDevices || []).filter(d => typeof d === "string" ? d !== targetDeviceId : d.deviceId !== targetDeviceId);
      saveJSON(CONFIG_FILE, config);
      const dataForAudit2 = loadJSON(DATA_FILE, { devices: {}, log: [] });
      appendAudit("admin-remove", targetDeviceId, dataForAudit2, `${getDeviceName(dataForAudit2, targetDeviceId)||targetDeviceId}`);
      return json(200, { status: "ok" });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/list") {
      const { password } = await readBody(req);
      if (password !== ADMIN_PASSWORD) return json(403, { error: "Wrong password" });
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG); const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      return json(200, { adminDevices: (config.adminDevices || []).map(d => {
        const did = typeof d === "string" ? d : d.deviceId;
        const r = typeof d === "string" ? "super" : (d.role || "super");
        return { deviceId: did, name: getDeviceName(data, did) || "Unknown", role: r };
      }) });
    }

    // Get app config
    if (req.method === "GET" && url.pathname === "/api/config") {
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      return json(200, {
        announcement: config.announcement || "",
        checkinDays: config.checkinDays !== undefined ? config.checkinDays : [0],
        checkinStartMin: config.checkinStartMin !== undefined ? config.checkinStartMin : 780,
        checkinEndMin: config.checkinEndMin !== undefined ? config.checkinEndMin : 900,
        requireApproval: config.requireApproval || false
      });
    }

    // Save app config
    if (req.method === "POST" && url.pathname === "/api/config") {
      const { announcement, checkinDays, checkinStartMin, checkinEndMin, requireApproval, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      if (announcement !== undefined) config.announcement = announcement;
      if (checkinDays !== undefined) config.checkinDays = checkinDays;
      if (checkinStartMin !== undefined) config.checkinStartMin = Number(checkinStartMin);
      if (checkinEndMin !== undefined) config.checkinEndMin = Number(checkinEndMin);
      if (requireApproval !== undefined) config.requireApproval = !!requireApproval;
      saveJSON(CONFIG_FILE, config);
      const dataForCfg = loadJSON(DATA_FILE, { devices: {}, log: [] });
      appendAudit("config-change", adminDeviceId, dataForCfg, `config updated`);
      return json(200, { status: "ok" });
    }

    // CSV exports with optional group filter
    if (req.method === "GET" && url.pathname === "/api/export/csv") {
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] }); const t = localDate();
      const group = url.searchParams.get("group") || "";
      const subgroup = url.searchParams.get("subgroup") || "";
      res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="attendance-log-${group || "all"}-${t}.csv"` });
      return res.end(csvLog(data, group, subgroup));
    }
    if (req.method === "GET" && url.pathname === "/api/export/grid") {
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] }); const t = localDate();
      const group = url.searchParams.get("group") || "";
      const subgroup = url.searchParams.get("subgroup") || "";
      res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="attendance-grid-${group || "all"}-${t}.csv"` });
      return res.end(csvGrid(data, group, subgroup));
    }

    // ─── Bulk attendance ───
    if (req.method === "POST" && url.pathname === "/api/log/add-bulk") {
      const { names, date, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      if (!names || !date) return json(400, { error: "names and date required" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const added = [];
      for (const name of names) {
        if (checkedInToday(data, name, date)) continue;
        const dids = getDevicesForName(data, name);
        const did = dids[0] || null;
        const group = did ? getDeviceGroup(data, did) : "";
        const subgroup = did ? getDeviceSubgroup(data, did) : "";
        const entry = { deviceId: did || `BULK-${Date.now()}`, name, group, subgroup, date, time: "12:00:00 PM", ts: Date.now(), manual: true, bulk: true };
        data.log.unshift(entry);
        added.push(name);
      }
      saveJSON(DATA_FILE, data);
      appendAudit("bulk-add", adminDeviceId, data, `${added.length} members for ${date}`);
      return json(200, { status: "ok", added: added.length });
    }

    // ─── Events CRUD ───
    if (req.method === "GET" && url.pathname === "/api/events") {
      return json(200, loadJSON(EVENTS_FILE, { events: [] }));
    }
    if (req.method === "POST" && url.pathname === "/api/events") {
      const { name, date, type, group, notes, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      if (!name || !date) return json(400, { error: "name and date required" });
      const ev = loadJSON(EVENTS_FILE, { events: [] });
      const id = `evt-${Date.now()}`;
      ev.events.unshift({ id, name: name.trim(), date, type: type || "기타", group: group || "", notes: notes || "", attendees: [], createdBy: adminDeviceId, createdAt: Date.now() });
      saveJSON(EVENTS_FILE, ev);
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      appendAudit("event-create", adminDeviceId, data, `${name} (${date})`);
      return json(200, { status: "ok", id });
    }
    if (req.method === "PUT" && url.pathname.startsWith("/api/events/") && !url.pathname.endsWith("/attend")) {
      const id = url.pathname.split("/api/events/")[1];
      const { attendees, name, date, type, notes, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const ev = loadJSON(EVENTS_FILE, { events: [] });
      const idx = ev.events.findIndex(e => e.id === id);
      if (idx === -1) return json(404, { error: "Event not found" });
      if (attendees !== undefined) ev.events[idx].attendees = attendees;
      if (name !== undefined) ev.events[idx].name = name.trim();
      if (date !== undefined) ev.events[idx].date = date;
      if (type !== undefined) ev.events[idx].type = type;
      if (notes !== undefined) ev.events[idx].notes = notes;
      saveJSON(EVENTS_FILE, ev);
      return json(200, { status: "ok" });
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/events/")) {
      const id = url.pathname.split("/api/events/")[1].split("/")[0];
      const adminId = req.headers["x-device-id"];
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      const ev = loadJSON(EVENTS_FILE, { events: [] });
      const deleted = ev.events.find(e => e.id === id);
      ev.events = ev.events.filter(e => e.id !== id);
      saveJSON(EVENTS_FILE, ev);
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      if (deleted) appendAudit("event-delete", adminId, data, deleted.name);
      return json(200, { status: "ok" });
    }
    // Mark self as attending an event (any registered user)
    if (req.method === "POST" && url.pathname.match(/^\/api\/events\/[^/]+\/attend$/)) {
      const id = url.pathname.split("/")[3];
      const { name, deviceId: attendeeDeviceId } = await readBody(req);
      if (!name) return json(400, { error: "name required" });
      const ev = loadJSON(EVENTS_FILE, { events: [] });
      const idx = ev.events.findIndex(e => e.id === id);
      if (idx === -1) return json(404, { error: "Event not found" });
      if (!ev.events[idx].attendees) ev.events[idx].attendees = [];
      if (!ev.events[idx].attendees.includes(name)) ev.events[idx].attendees.push(name);
      saveJSON(EVENTS_FILE, ev);
      return json(200, { status: "ok", attendees: ev.events[idx].attendees });
    }

    // ─── Audit log ───
    if (req.method === "GET" && url.pathname === "/api/audit") {
      const adminId = req.headers["x-device-id"] || url.searchParams.get("deviceId");
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      const log = loadJSON(AUDIT_FILE, []);
      const limit = parseInt(url.searchParams.get("limit") || "100");
      return json(200, { log: log.slice(0, limit) });
    }

    // ─── HTML Report ───
    if (req.method === "GET" && url.pathname === "/api/report/html") {
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const config = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
      const groupFilter = url.searchParams.get("group") || "";
      const subgroupFilter = url.searchParams.get("subgroup") || "";
      const period = url.searchParams.get("period") || "all";
      const fromParam = url.searchParams.get("from") || "";
      const toParam = url.searchParams.get("to") || "";

      let filteredLog = [...data.log];
      if (groupFilter) filteredLog = filteredLog.filter(e => (getDeviceGroup(data, e.deviceId) || e.group || "") === groupFilter);
      if (subgroupFilter) filteredLog = filteredLog.filter(e => (getDeviceSubgroup(data, e.deviceId) || e.subgroup || "") === subgroupFilter);

      const today = localDate();
      if (period === "today") filteredLog = filteredLog.filter(e => e.date === today);
      else if (period === "weekly") {
        const d = new Date(); d.setDate(d.getDate() - 6);
        const from = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        filteredLog = filteredLog.filter(e => e.date >= from && e.date <= today);
      } else if (period === "monthly") {
        const m = today.slice(0, 7);
        filteredLog = filteredLog.filter(e => e.date.startsWith(m));
      } else if (fromParam || toParam) {
        if (fromParam) filteredLog = filteredLog.filter(e => e.date >= fromParam);
        if (toParam) filteredLog = filteredLog.filter(e => e.date <= toParam);
      }

      const dates = [...new Set(filteredLog.map(e => e.date))].sort();
      const members = {};
      Object.entries(data.devices).forEach(([did, v]) => {
        const info = typeof v === "string" ? { name: v, group: "", subgroup: "" } : v;
        if (groupFilter && info.group !== groupFilter) return;
        if (subgroupFilter && (info.subgroup || "") !== subgroupFilter) return;
        if (!members[info.name]) members[info.name] = { group: info.group || "", subgroup: info.subgroup || "", devices: [] };
        members[info.name].devices.push(did);
      });
      const names = Object.keys(members).sort();
      const periodLabel = period === "today" ? today : period === "weekly" ? "최근 7일" : period === "monthly" ? today.slice(0, 7) : (fromParam && toParam ? `${fromParam} ~ ${toParam}` : "전체");

      let gridRows = "";
      names.forEach(name => {
        const dids = members[name].devices;
        const total = dates.filter(d => filteredLog.find(x => dids.includes(x.deviceId) && x.date === d)).length;
        const rate = dates.length ? Math.round(total / dates.length * 100) : 0;
        let row = `<tr><td class="nc">${name}</td><td>${members[name].group}${members[name].subgroup ? " / " + members[name].subgroup : ""}</td><td class="tc">${total}</td><td class="tc" style="color:${rate >= 80 ? "#16a34a" : rate >= 60 ? "#d97706" : "#dc2626"}">${rate}%</td>`;
        dates.forEach(d => {
          const e = filteredLog.find(x => dids.includes(x.deviceId) && x.date === d);
          row += e ? `<td class="pc"${e.late ? ` style="color:#d97706"` : ""}>✓</td>` : `<td class="ac">—</td>`;
        });
        gridRows += row + "</tr>";
      });

      const totalByDate = dates.map(d => { const p = new Set(); filteredLog.filter(e => e.date === d).forEach(e => p.add(getDeviceName(data, e.deviceId) || e.name)); return p.size; });
      let totalRow = `<tr class="tot"><td class="nc">TOTAL</td><td></td><td></td><td></td>` + totalByDate.map(n => `<td class="tc">${n}</td>`).join("") + "</tr>";

      const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>KCCP 출석 보고서 — ${periodLabel}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;font-size:12px;color:#111;background:#fff;padding:24px}
h1{font-size:20px;font-weight:800;margin-bottom:4px}
.sub{font-size:13px;color:#555;margin-bottom:20px}
.stats{display:flex;gap:16px;margin-bottom:20px}
.stat{background:#f5f5f5;border-radius:8px;padding:10px 16px;text-align:center}
.stat b{display:block;font-size:22px;font-weight:800}
.stat span{font-size:10px;color:#777;text-transform:uppercase;letter-spacing:.8px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{padding:6px 8px;background:#4a2d87;color:#fff;font-size:10px;white-space:nowrap;text-align:center}
th.nc{text-align:left;min-width:110px}
td{padding:5px 8px;border:1px solid #e5e5e5;text-align:center}
td.nc{text-align:left;font-weight:600;font-size:12px;border-right:2px solid #ccc}
td.tc{font-weight:700;background:#fafaf8}
td.pc{color:#16a34a;font-weight:700}td.ac{color:#ccc}
tr:nth-child(even) td{background:#fafaf8}tr:nth-child(even) td.tc{background:#f0f0ec}
tr.tot td{background:#ede9fe!important;font-weight:700;border-top:2px solid #7c3aed;color:#5b21b6}
.btn{display:inline-block;margin-top:16px;padding:8px 20px;background:#6d28d9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700}
@media print{.btn{display:none}body{padding:12px}h1{font-size:16px}}
</style></head>
<body>
<h1>📊 KCCP 출석 보고서</h1>
<div class="sub">기간: ${periodLabel}${groupFilter ? " · " + groupFilter : ""}${subgroupFilter ? " / " + subgroupFilter : ""} &nbsp;·&nbsp; 생성: ${new Date().toLocaleString("ko-KR", { timeZone: "America/New_York" })}</div>
<div class="stats">
  <div class="stat"><b>${names.length}</b><span>멤버 수</span></div>
  <div class="stat"><b>${dates.length}</b><span>주일 수</span></div>
  <div class="stat"><b>${filteredLog.length}</b><span>총 출석</span></div>
  <div class="stat"><b>${dates.length ? Math.round(totalByDate.reduce((a,b)=>a+b,0)/dates.length) : 0}</b><span>평균 출석</span></div>
</div>
${names.length && dates.length ? `
<div style="overflow-x:auto">
<table><thead><tr><th class="nc">이름</th><th>그룹</th><th class="tc">합계</th><th class="tc">출석률</th>${dates.map(d => `<th>${fmtDateWithDay(d).replace(/, \d{4}/, "")}</th>`).join("")}</tr></thead>
<tbody>${gridRows}${totalRow}</tbody></table>
</div>` : "<p style='color:#999;margin-top:16px;'>출석 기록이 없습니다.</p>"}
<button class="btn" onclick="window.print()">🖨 PDF로 저장 / 인쇄</button>
</body></html>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // ─── Merge members ───
    if (req.method === "POST" && url.pathname === "/api/merge-members") {
      const { fromName, toName, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      if (!fromName || !toName || fromName === toName) return json(400, { error: "Invalid names" });
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const fromDids = getDevicesForName(data, fromName);
      if (!fromDids.length) return json(404, { error: "Source member not found" });
      const allM = getAllMembers(data);
      const toInfo = allM[toName];
      const toGroup = toInfo ? toInfo.group : "";
      const toSubgroup = toInfo ? (toInfo.subgroup || "") : "";
      fromDids.forEach(did => setDevice(data, did, toName.trim(), toGroup, toSubgroup));
      data.log = data.log.map(e => fromDids.includes(e.deviceId) ? { ...e, name: toName.trim(), group: toGroup, subgroup: toSubgroup } : e);
      saveJSON(DATA_FILE, data);
      appendAudit("merge-members", adminDeviceId, data, `${fromName} → ${toName} (${fromDids.length} devices)`);
      return json(200, { status: "ok", merged: fromDids.length });
    }

    // ─── Pending Registration Management ───
    if (req.method === "GET" && url.pathname === "/api/pending") {
      const adminId = req.headers["x-device-id"] || url.searchParams.get("deviceId");
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      return json(200, { pending: loadJSON(PENDING_FILE, []) });
    }
    if (req.method === "GET" && url.pathname === "/api/pending/count") {
      const adminId = req.headers["x-device-id"] || url.searchParams.get("deviceId");
      if (!isAdmin(adminId)) return json(200, { count: 0 });
      return json(200, { count: loadJSON(PENDING_FILE, []).length });
    }
    if (req.method === "POST" && url.pathname === "/api/pending/approve") {
      const { pendingDeviceId, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const pending = loadJSON(PENDING_FILE, []);
      const idx = pending.findIndex(p => p.deviceId === pendingDeviceId);
      if (idx === -1) return json(404, { error: "Not found in pending list" });
      const p = pending[idx];
      pending.splice(idx, 1);
      saveJSON(PENDING_FILE, pending);
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      setDevice(data, p.deviceId, p.name, p.group, p.subgroup);
      saveJSON(DATA_FILE, data);
      appendAudit("pending-approve", adminDeviceId, data, `${p.name} (${p.deviceId})`);
      console.log(`[PENDING-APPROVE] ${p.name}`);
      return json(200, { status: "ok", name: p.name });
    }
    if (req.method === "POST" && url.pathname === "/api/pending/reject") {
      const { pendingDeviceId, adminDeviceId } = await readBody(req);
      if (!isAdmin(adminDeviceId)) return json(403, { error: "Not authorized" });
      const pending = loadJSON(PENDING_FILE, []);
      const idx = pending.findIndex(p => p.deviceId === pendingDeviceId);
      if (idx === -1) return json(404, { error: "Not found" });
      const p = pending[idx];
      pending.splice(idx, 1);
      saveJSON(PENDING_FILE, pending);
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      appendAudit("pending-reject", adminDeviceId, data, `${p.name} (${p.deviceId})`);
      console.log(`[PENDING-REJECT] ${p.name}`);
      return json(200, { status: "ok" });
    }

    // ─── Weekly Summary Report ───
    if (req.method === "GET" && url.pathname === "/api/report/weekly-summary") {
      const data = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const groupFilter = url.searchParams.get("group") || "";
      const allDates = [...new Set(data.log.map(e => e.date))].sort();
      if (!allDates.length) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;color:#666;text-align:center;"><h2>No attendance records yet.</h2></body></html>`);
      }
      const lastDate = allDates[allDates.length - 1];
      const recentDates = allDates.slice(-8);
      const trendData = recentDates.map(d => {
        let entries = data.log.filter(e => e.date === d);
        if (groupFilter) entries = entries.filter(e => (getDeviceGroup(data, e.deviceId) || e.group || "") === groupFilter);
        const people = new Set(entries.filter(e => { const v = data.devices[e.deviceId]; return !(v && typeof v === "object" && (v.memberRole || v.visitor)); }).map(e => getDeviceName(data, e.deviceId) || e.name));
        return { date: d, count: people.size, firstVisits: entries.filter(e => e.firstVisit).length };
      });
      let lastEntries = data.log.filter(e => e.date === lastDate);
      if (groupFilter) lastEntries = lastEntries.filter(e => (getDeviceGroup(data, e.deviceId) || e.group || "") === groupFilter);
      const attendeeNames = [...new Set(lastEntries.filter(e => { const v = data.devices[e.deviceId]; return !(v && typeof v === "object" && (v.memberRole || v.visitor)); }).map(e => getDeviceName(data, e.deviceId) || e.name))].sort();
      const firstVisitors = lastEntries.filter(e => e.firstVisit).map(e => getDeviceName(data, e.deviceId) || e.name);
      const dateLabel = new Date(lastDate + "T12:00:00").toLocaleDateString("ko-KR", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric", weekday: "long" });
      const groupLabel = groupFilter || "전체";
      const byGroup = {};
      lastEntries.forEach(e => { const g = getDeviceGroup(data, e.deviceId) || e.group || "기타"; if (!byGroup[g]) byGroup[g] = new Set(); byGroup[g].add(getDeviceName(data, e.deviceId) || e.name); });
      const groupRows = Object.entries(byGroup).map(([g, names]) => `<tr><td style="padding:8px 12px;">${g}</td><td style="padding:8px 12px;text-align:center;font-weight:700;color:#16a34a;">${names.size}</td></tr>`).join("");
      const avg4 = trendData.length >= 2 ? Math.round(trendData.slice(-4).reduce((s, t) => s + t.count, 0) / Math.min(4, trendData.length)) : "—";
      const chartLabels = JSON.stringify(trendData.map(t => fmtDateWithDay(t.date).replace(/, \d{4}/, "")));
      const chartData = JSON.stringify(trendData.map(t => t.count));
      const attendeeHtml = attendeeNames.map((n, i) => `<span style="display:inline-block;padding:4px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:20px;font-size:12px;margin:3px;">${i + 1}. ${n}</span>`).join("");
      const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>KCCP 주간 출석 요약</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f8f9fa;color:#111}.header{background:linear-gradient(135deg,#4a2d87,#7c3aed);color:#fff;padding:32px 24px 24px;text-align:center}.header h1{font-size:22px;font-weight:800;margin-bottom:4px}.header .sub{font-size:13px;opacity:.8}.container{max-width:640px;margin:0 auto;padding:20px 16px}.stat-row{display:flex;gap:12px;margin-bottom:20px}.stat{flex:1;background:#fff;border-radius:12px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08)}.stat .val{font-size:28px;font-weight:800;color:#16a34a}.stat .lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.8px;margin-top:2px}.card{background:#fff;border-radius:12px;padding:18px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.08)}.card h2{font-size:14px;font-weight:700;margin-bottom:14px;color:#333}table{width:100%;border-collapse:collapse;font-size:13px}th{padding:8px 12px;background:#f3f4f6;text-align:left;font-size:11px;font-weight:700;color:#666;letter-spacing:.5px}td{border-top:1px solid #f0f0f0}.footer{text-align:center;padding:20px;font-size:11px;color:#aaa}.btn{display:inline-block;margin-top:8px;padding:8px 20px;background:#6d28d9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700}@media print{.btn{display:none}}</style></head>
<body><div class="header"><div style="font-size:32px;margin-bottom:8px;">⛪</div><h1>KCCP 주간 출석 요약</h1><div class="sub">${dateLabel}${groupLabel !== "전체" ? " · " + groupLabel : ""}</div></div>
<div class="container">
<div class="stat-row"><div class="stat"><div class="val">${attendeeNames.length}</div><div class="lbl">출석 인원</div></div><div class="stat"><div class="val">${firstVisitors.length || "—"}</div><div class="lbl">첫 방문</div></div><div class="stat"><div class="val">${avg4}</div><div class="lbl">4주 평균</div></div></div>
${trendData.length > 1 ? `<div class="card"><h2>📈 출석 트렌드 (최근 ${trendData.length}주)</h2><canvas id="tc" height="180"></canvas></div>` : ""}
${Object.keys(byGroup).length > 1 ? `<div class="card"><h2>👥 그룹별 출석</h2><table><thead><tr><th>그룹</th><th style="text-align:center;">인원</th></tr></thead><tbody>${groupRows}</tbody></table></div>` : ""}
<div class="card"><h2>✅ 출석 명단 (${attendeeNames.length}명)</h2><div style="line-height:2;">${attendeeHtml || '<span style="color:#aaa;font-size:13px;">출석 기록 없음</span>'}</div></div>
${firstVisitors.length ? `<div class="card" style="border-left:3px solid #7c3aed;"><h2>🌟 첫 방문자</h2>${firstVisitors.map(n => `<div style="padding:6px 0;font-size:14px;font-weight:600;">${n}</div>`).join("")}</div>` : ""}
<button class="btn" onclick="window.print()">🖨 PDF로 저장 / 인쇄</button>
<div class="footer">Generated · ${new Date().toLocaleString("ko-KR", { timeZone: "America/New_York" })}</div>
</div>${trendData.length > 1 ? `<script>new Chart(document.getElementById("tc"),{type:"line",data:{labels:${chartLabels},datasets:[{label:"출석",data:${chartData},borderColor:"#7c3aed",backgroundColor:"rgba(124,58,237,.1)",borderWidth:2.5,pointBackgroundColor:"#7c3aed",pointRadius:5,fill:true,tension:0.3}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}}}}});<\/script>` : ""}
</body></html>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // ─── Data Backup ───
    if (req.method === "GET" && url.pathname === "/api/backup") {
      const adminId = req.headers["x-device-id"] || url.searchParams.get("deviceId");
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      const bundle = {
        version: 1,
        exportedAt: Date.now(),
        attendance: loadJSON(DATA_FILE, { devices: {}, log: [] }),
        config: loadJSON(CONFIG_FILE, DEFAULT_CONFIG),
        events: loadJSON(EVENTS_FILE, { events: [] }),
        audit: loadJSON(AUDIT_FILE, []),
        pending: loadJSON(PENDING_FILE, [])
      };
      const filename = `kccp-backup-${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })}.json`;
      res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${filename}"` });
      return res.end(JSON.stringify(bundle, null, 2));
    }

    // ─── Data Restore ───
    if (req.method === "POST" && url.pathname === "/api/restore") {
      const adminId = req.headers["x-device-id"];
      if (!isAdmin(adminId)) return json(403, { error: "Not authorized" });
      const body = await readBody(req);
      if (!body.version || !body.attendance) return json(400, { error: "Invalid backup file" });
      if (body.attendance) saveJSON(DATA_FILE, body.attendance);
      if (body.config) saveJSON(CONFIG_FILE, body.config);
      if (body.events) saveJSON(EVENTS_FILE, body.events);
      if (body.audit) saveJSON(AUDIT_FILE, body.audit);
      if (body.pending) saveJSON(PENDING_FILE, body.pending);
      const dataForAudit = loadJSON(DATA_FILE, { devices: {}, log: [] });
      const exportDateStr = body.exportedAt ? new Date(body.exportedAt).toLocaleString("ko-KR", { timeZone: "America/New_York" }) : "unknown";
      appendAudit("restore", adminId, dataForAudit, `Restored backup from ${exportDateStr}`);
      console.log(`[RESTORE] Data restored from backup (${exportDateStr})`);
      return json(200, { status: "ok" });
    }

    json(404, { error: "Not found" });
  } catch (e) { json(400, { error: e.message }); }
});

server.listen(PORT, () => {
  const c = loadJSON(CONFIG_FILE, DEFAULT_CONFIG);
  console.log(`\n  KCCP — NFC Attendance System`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Server:   http://localhost:${PORT}`);
  console.log(`  Admins:   ${(c.adminDevices || []).length || "NONE (open access)"}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log(`\n  ⚠  Change ADMIN_PASSWORD in server.js before deploying!\n`);
});
