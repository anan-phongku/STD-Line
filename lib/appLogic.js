import { storage } from './kvStore';

let STATIC_ITEMS = [];


// ข้อมูลเก่าใน Supabase บางแถวมี null คั่นใน steps / belt slots
// (เกิดจาก syncStationsToSteps เดิมเขียนข้าม index แล้ว JSON.stringify แปลงรูเป็น null)
// ตัว render ทั้งหมดสมมติว่าสมาชิกทุกตัวเป็น object — ต้องกรอง null ทิ้งก่อนใช้เสมอ
function compactItemArrays(it){
  if(!it || typeof it !== 'object') return it;
  if(Array.isArray(it.steps)) it.steps = it.steps.filter(s => s != null);
  if(it.belt && typeof it.belt === 'object'){
    ['headSlots','leftSlots','rightSlots','bars','arrows','machines'].forEach(k => {
      if(Array.isArray(it.belt[k])) it.belt[k] = it.belt[k].filter(x => x != null);
    });
  }
  return it;
}

export async function initApp(){
  const RAW = await fetch('/data/payload.json').then(r => r.json());
  STATIC_ITEMS = RAW.items.map(it => compactItemArrays({...it, category: it.category || '', custom:false}));

  let CUSTOM_ITEMS = [];
  let CATEGORIES = [];
  let DELETED_IDS = new Set();
  let edited = {};
  let currentId = null;
  let currentCategoryFilter = null;
  let pendingUpload = null;
  let galleryDragData = null;
  let pendingGalleryTarget = null;

  // ระดับย่อ/ขยายไดอะแกรมสายพาน — เป็นค่าการมองเห็นส่วนตัว เก็บไว้ต่อเครื่อง ไม่ต้องแชร์ให้คนอื่น
  // จำว่าผู้ใช้หุบแกลเลอรีรูปต้นฉบับไว้หรือเปล่า (ค่าการมองเห็นส่วนตัว เก็บต่อเครื่อง)
  const GAL_KEY = 'std_line_gallery_collapsed';
  let galleryCollapsed = false;
  try{ galleryCollapsed = window.localStorage.getItem(GAL_KEY) === '1'; }catch(e){}
  function galleryToggleLabel(n){ return (galleryCollapsed ? '▸ ' : '▾ ') + 'รูปตำแหน่งจากไฟล์ต้นฉบับ (' + n + ')'; }

  const ZOOM_KEY = 'std_line_belt_zoom';
  const ZOOM_STEPS = [0.35, 0.45, 0.55, 0.7, 0.85, 1, 1.2, 1.45, 1.75];
  let beltZoom = 1;
  try{
    const z = parseFloat(window.localStorage.getItem(ZOOM_KEY));
    if(z >= 0.3 && z <= 2) beltZoom = z;
  }catch(e){}

  function applyBeltZoom(){
    const vp = document.getElementById('beltViewport');
    const wrap = document.getElementById('beltZoomWrap');
    const lbl = document.getElementById('zoomResetBtn');
    if(lbl) lbl.textContent = Math.round(beltZoom * 100) + '%';
    if(!vp || !wrap) return;
    vp.style.transform = beltZoom === 1 ? '' : 'scale(' + beltZoom + ')';
    // transform ไม่กินพื้นที่ layout ต้องจองขนาดหลังสเกลไว้เอง ไม่งั้นจะเหลือที่ว่างค้างหรือโดนตัด
    wrap.style.width = Math.ceil(vp.offsetWidth * beltZoom) + 'px';
    wrap.style.height = Math.ceil(vp.offsetHeight * beltZoom) + 'px';
  }
  function setBeltZoom(z){
    beltZoom = Math.max(0.3, Math.min(2, z));
    try{ window.localStorage.setItem(ZOOM_KEY, String(beltZoom)); }catch(e){}
    applyBeltZoom();
  }
  function stepBeltZoom(dir){
    if(dir > 0){
      const up = ZOOM_STEPS.find(v => v > beltZoom + 0.001);
      setBeltZoom(up === undefined ? 2 : up);
    }else{
      const down = ZOOM_STEPS.filter(v => v < beltZoom - 0.001);
      setBeltZoom(down.length ? down[down.length - 1] : 0.3);
    }
  }
  // ย่อให้ความกว้างของไลน์พอดีกับพื้นที่ที่มอง (ไม่ขยายเกิน 100% เพราะจะเบลอเปล่า ๆ)
  function fitBeltZoom(){
    const vp = document.getElementById('beltViewport');
    const sc = document.getElementById('beltScroll');
    if(!vp || !sc || !vp.offsetWidth) return;
    setBeltZoom(Math.min(1, (sc.clientWidth - 2) / vp.offsetWidth));
  }
  
  const MAX_SLOTS = 20; // จำนวนสถานีสูงสุดต่อหนึ่งเลน

  function uid(){ return 'x' + Math.random().toString(36).slice(2,10); }

  // คลิปบอร์ดสถานี — เก็บใน localStorage เพื่อให้ข้ามเมนู/รีเฟรชหน้าแล้วยังวางได้
  // (เป็นของใช้ส่วนตัวระหว่างแก้งาน ไม่ควรแชร์ให้คนอื่นเห็นเหมือนข้อมูลไลน์)
  const CLIP_KEY = 'std_line_station_clipboard';
  function readStationClip(){
    try{
      const raw = window.localStorage.getItem(CLIP_KEY);
      if(!raw) return [];
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []); // รองรับคลิปบอร์ดรูปแบบเดิมที่เก็บสถานีเดียว
    }catch(e){ return []; }
  }
  function writeStationClip(list){
    try{ window.localStorage.setItem(CLIP_KEY, JSON.stringify(list)); return true; }
    catch(e){ showToast('คัดลอกไม่สำเร็จ (พื้นที่เก็บในเครื่องเต็ม)'); return false; }
  }
  function clipName(clip){ return ((clip && clip.label) || '').trim() || 'ไม่มีชื่อ'; }
  function clipSummary(list){
    if(!list.length) return '';
    return list.length === 1 ? '"' + clipName(list[0]) + '"' : (list.length + ' สถานี');
  }
  // เซ็ตของสถานีที่อยู่ในคลิปบอร์ดตอนนี้ ใช้ทำสถานะ "คัดลอกแล้ว" บนปุ่ม
  // คำนวณครั้งเดียวต่อการ render แทนที่จะอ่าน localStorage ทีละสถานี
  let renderingId = null;
  let clipKeys = new Set();
  function clipKeyOf(side, idx){ return renderingId + '|' + side + ':' + idx; }

  // คลิปบอร์ดของ "ทั้งสายพาน" — แยกคีย์จากคลิปบอร์ดสถานีรายตัว จะได้ไม่ทับกัน
  const BELT_CLIP_KEY = 'std_line_belt_clipboard';
  const BELT_PARTS = ['headSlots','leftSlots','rightSlots','bars','arrows','machines'];
  function readBeltClip(){
    try{ const raw = window.localStorage.getItem(BELT_CLIP_KEY); return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
  }
  function beltClipCount(clip){
    if(!clip || !clip.belt) return 0;
    return (clip.belt.headSlots||[]).length + (clip.belt.leftSlots||[]).length + (clip.belt.rightSlots||[]).length;
  }
  function allItems(){ return STATIC_ITEMS.concat(CUSTOM_ITEMS).filter(it => !DELETED_IDS.has(it.id)); }
  function getItem(id){ if(edited[id]) return edited[id]; return allItems().find(i => i.id === id); }
  function isEdited(id){ return !!edited[id]; }
  
  function ensureEdited(id){
    if(!edited[id]){
      const base = allItems().find(i => i.id === id);
      edited[id] = compactItemArrays(JSON.parse(JSON.stringify(base)));
    }
    if(!edited[id].belt) edited[id].belt = {headSlots:[], leftSlots:[], rightSlots:[], bars:[], arrows:[], machines:[]};
    if(!edited[id].belt.arrows) edited[id].belt.arrows = [];
    if(!edited[id].belt.headSlots) edited[id].belt.headSlots = [];
    if(!edited[id].belt.machines) edited[id].belt.machines = [];
    if(!edited[id].summary) edited[id].summary = {};
    return edited[id];
  }
  function getBelt(it){
    const b = it.belt || {headSlots:[], leftSlots:[], rightSlots:[], bars:[], arrows:[], machines:[]};
    if(!b.arrows) b.arrows=[];
    if(!b.headSlots) b.headSlots=[];
    if(!b.machines) b.machines=[];
    return b;
  }
  function slotsArrayFor(ed, side){
    if(side==='left') return ed.belt.leftSlots;
    if(side==='right') return ed.belt.rightSlots;
    // เครื่องจักรใช้ช่องรูปตัวเดียวกับสถานี (อัปโหลด/ลากจากแกลเลอรี) จึงต้องอยู่ในตารางนี้ด้วย
    if(side==='machine') return ed.belt.machines;
    return ed.belt.headSlots;
  }
  // ยุบแถวที่ "ชื่อกิจกรรม" ซ้ำกันให้เหลือบรรทัดเดียว บวกจำนวนคน + Rate ของทุกจุดเข้าด้วยกัน
  // (_n = จำนวนสถานีที่ยุบรวม). idempotent: ถ้ารับ array ที่ยุบแล้วมาซ้ำ ค่า _n ยังคงเดิม
  function mergeSteps(steps){
    const out = [];
    const byName = new Map();
    (steps||[]).forEach(s=>{
      if(!s) return;
      const name = (s.process||'').trim();
      const addN = s._n || 1;
      const p = parseFloat(s.people), r = parseFloat(s.rate);
      if(name && byName.has(name)){
        const m = byName.get(name);
        m._n += addN;
        if(!isNaN(p)) m.people = (parseFloat(m.people)||0) + p;
        if(!isNaN(r)) m.rate   = (parseFloat(m.rate)||0)   + r;
        if(!m.position && s.position) m.position = s.position;
      }else{
        const c = {...s, _n: addN};
        out.push(c);
        if(name) byName.set(name, c);
      }
    });
    out.forEach((s,i)=>{ s.order = i+1; });
    return out;
  }
  // สร้างตารางกระบวนการจากสถานีบนสายพาน — นับ "ทุกสถานี" ทั้งหัวไลน์และสองเลน
  // (เดิมใช้ ซ้าย[i] || ขวา[i] เอาแค่ฝั่งเดียวต่อแถว ฝั่งขวาเลยไม่เคยถูกนับ)
  // แล้วยุบชื่อกิจกรรมที่ซ้ำกันเป็นบรรทัดเดียว บวกคน + Rate. เป็น pure function ไม่แก้ข้อมูล
  // เครื่องจักรขนาดตายตัว วางได้ 3 คอลัมน์ (ซ้าย/กลาง/ขวา) เหมือนช่องสถานีที่เป็นบล็อก
  // leftPct เป็น % ของความกว้างราง จึงเรียง 3 เครื่องได้ทั้งบนคอมและมือถือ
  // ค่าที่ไม่ตรงคอลัมน์ (ของเก่า/จากช่วงที่ลากอิสระ) ปัดเข้าคอลัมน์ที่ใกล้สุด
  const MACHINE_W = 31;
  const MACHINE_COLS = [1.5, 34.5, 67.5];
  function nearestMachineCol(leftPct){
    return MACHINE_COLS.reduce((best, c)=> Math.abs(c - leftPct) < Math.abs(best - leftPct) ? c : best, MACHINE_COLS[1]);
  }
  function machineBox(m){
    const raw = (m && isFinite(parseFloat(m.leftPct))) ? parseFloat(m.leftPct) : MACHINE_COLS[1];
    return {left: nearestMachineCol(raw), w: MACHINE_W};
  }
  function computeSteps(it){
    const belt = getBelt(it);
    // "ตำแหน่ง" ผู้ใช้กรอกเองในตาราง ไม่ได้มาจากสถานี — คืนกลับตามชื่อกิจกรรม
    const prevPos = new Map();
    (it.steps||[]).forEach(s=>{ const n=((s&&s.process)||'').trim(); if(n && !prevPos.has(n)) prevPos.set(n, s.position||''); });
    const raw = [];
    const take = (s)=>{
      if(!s || s.blank) return;
      const label = s.label || '';
      const people = s.people || '';
      const rate = s.rate || '';
      if(!label && !people && !rate) return;
      raw.push({order: raw.length+1, process: label, people, rate, position: prevPos.get(label.trim()) || ''});
    };
    const takeMachine = (m)=>{
      if(!m) return;
      const label = m.name || '';
      const people = m.people || '';
      const rate = m.rate || '';
      if(!label && !people && !rate) return;
      raw.push({order: raw.length+1, process: label, people, rate, position: prevPos.get(label.trim()) || ''});
    };
    const L = belt.leftSlots || [], R = belt.rightSlots || [];
    const maxLen = Math.max(L.length, R.length);
    // เครื่องจักรลอยอยู่กลางราง ไม่มี index ของตัวเอง — เทียบ top% กลับเป็นช่องที่ใกล้ที่สุดเพื่อเรียงแทรก
    const M = (belt.machines || []).filter(Boolean).sort((a, b)=> machineBox(a).left - machineBox(b).left);
    const slotOf = (m)=> Math.round(((parseFloat(m.top) || 0) / 100) * maxLen);
    // หัวไลน์คือจุดเริ่มของสายพาน จึงขึ้นก่อนสถานีในเลน (เดิมตกหล่น ไม่ถูกนับทั้งคนและ Rate)
    (belt.headSlots || []).forEach(take);
    for(let i=0;i<maxLen;i++){
      M.forEach(m=>{ if(slotOf(m) === i) takeMachine(m); });
      take(L[i]); take(R[i]);
    }
    M.forEach(m=>{ if(slotOf(m) >= maxLen) takeMachine(m); });
    return mergeSteps(raw);
  }
  function syncStationsToSteps(id){
    const ed = ensureEdited(id);
    ed.steps = computeSteps(ed);
  }
  // หาสถานีตัวเดียวที่ชื่อกิจกรรมตรงกับ name — คืน null ถ้าไม่เจอ หรือเจอมากกว่าหนึ่ง
  // (ใช้ตอนแก้ค่าในตารางกระบวนการของแถวที่ไม่ได้ยุบรวม ให้เขียนกลับไปที่สถานีได้ถูกตัว)
  function findLoneStation(ed, name){
    if(!name) return null;
    let found = null, count = 0;
    ['leftSlots','rightSlots','headSlots'].forEach(k=>{
      (ed.belt[k]||[]).forEach(s=>{ if(s && !s.blank && (s.label||'').trim()===name){ found = s; count++; } });
    });
    return count===1 ? found : null;
  }
  
  function sumPeople(steps){
    let total = 0, any = false;
    (steps||[]).forEach(s => { if(!s) return; const n = parseFloat(s.people); if(!isNaN(n)){ total += n; any = true; } });
    return any ? total : '';
  }
  // Rate บรรจุของทั้งไลน์ = คอขวด = ค่าต่ำสุดจาก "แถวในตารางกระบวนการ"
  // ต้องคิดจากแถวที่ยุบรวมแล้ว เพราะงานเดียวกันที่ทำขนานหลายจุดมีกำลังผลิตรวมกัน
  // (ชั่งข้าว 4 จุด จุดละ 850 = 3400 ไม่ใช่ 850) — คิดจากสถานีเดี่ยวจะได้คอขวดต่ำเกินจริง
  function lineRate(it){
    const vals = [];
    computeSteps(it).forEach(s=>{
      const n = parseFloat(s.rate);
      if(!isNaN(n)) vals.push(n);
    });
    return vals.length ? Math.min(...vals) : '';
  }
  
  async function loadAllEdits(){
    try{ const r = await storage.get('categories_list', true); if(r && r.value) CATEGORIES = JSON.parse(r.value); }catch(e){}
    try{ const r = await storage.get('deleted_items', true); if(r && r.value) DELETED_IDS = new Set(JSON.parse(r.value)); }catch(e){}
    try{
      const r = await storage.get('custom_items_index', true);
      if(r && r.value){
        const ids = JSON.parse(r.value);
        for(const id of ids){
          try{ const rr = await storage.get('item:' + id, true); if(rr && rr.value) CUSTOM_ITEMS.push(compactItemArrays(JSON.parse(rr.value))); }catch(e){}
        }
      }
    }catch(e){}
    try{
      const res = await storage.list('item:', true);
      if(res && res.keys){
        for(const k of res.keys){
          try{ const r = await storage.get(k, true); if(r && r.value){ const val = compactItemArrays(JSON.parse(r.value)); edited[val.id] = val; } }catch(e){}
        }
      }
    }catch(e){}
  }
  async function persist(id, okMsg){
    const data = edited[id] || getItem(id);
    try{ await storage.set('item:' + id, JSON.stringify(data), true); showToast(okMsg || 'บันทึกแล้ว'); }
    catch(e){ showToast('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }
  async function persistCategories(){ try{ await storage.set('categories_list', JSON.stringify(CATEGORIES), true); }catch(e){} }
  async function persistCustomIndex(){ try{ await storage.set('custom_items_index', JSON.stringify(CUSTOM_ITEMS.map(i=>i.id)), true); }catch(e){} }
  async function deleteMenu(id){
    const it = getItem(id);
    const name = it ? it.clean_title : id;
    if(!window.confirm('ลบเมนู "' + name + '" ถาวรเลยหรือไม่? ทุกคนที่เปิดหน้านี้จะไม่เห็นเมนูนี้อีก')) return;
    DELETED_IDS.add(id);
    try{ await storage.set('deleted_items', JSON.stringify(Array.from(DELETED_IDS)), true); }catch(e){}
    const cidx = CUSTOM_ITEMS.findIndex(i=>i.id===id);
    if(cidx>=0){ CUSTOM_ITEMS.splice(cidx,1); await persistCustomIndex(); }
    try{ await storage.delete('item:' + id, true); }catch(e){}
    delete edited[id];
    if(currentId===id) currentId = null;
    renderAll();
    showToast('ลบเมนู "' + name + '" แล้ว');
  }
  
  // คัดลอกเมนูทั้งก้อน (สถานี รูป ไม้กั้น ลูกศร เครื่องจักร ตารางกระบวนการ) เป็นเมนูใหม่
  // เมนูหลายตัวหน้าตาคล้ายกัน ก๊อปแล้วแก้ต่อเร็วกว่าสร้างใหม่ทั้งหมด
  async function duplicateMenu(id){
    const src = getItem(id);
    if(!src) return;
    const srcName = src.clean_title || src.title || '';
    const name = window.prompt('ชื่อเมนูใหม่ (คัดลอกจาก "' + srcName + '")', srcName + ' (สำเนา)');
    if(!name || !name.trim()) return;

    const newId = 'custom-' + Date.now();
    const copy = compactItemArrays(JSON.parse(JSON.stringify(src)));
    copy.id = newId;
    copy.title = copy.clean_title = name.trim();
    copy.custom = true;
    copy.mode = 'custom';
    copy.code = null; // รหัสสินค้าเป็นของเมนูต้นฉบับ ให้กรอกใหม่เอง จะได้ไม่ซ้ำกัน
    if(!copy.belt) copy.belt = {headSlots:[], leftSlots:[], rightSlots:[], bars:[], arrows:[], machines:[]};
    if(!copy.summary) copy.summary = {};
    // ชิ้นส่วนบนสายพานมี id ของตัวเอง ต้องสุ่มใหม่ ไม่ให้ชนกับต้นฉบับ
    ['headSlots','leftSlots','rightSlots','bars','arrows','machines'].forEach(k=>{
      if(!Array.isArray(copy.belt[k])) copy.belt[k] = [];
      copy.belt[k].forEach(x=>{ if(x) x.id = uid(); });
    });

    CUSTOM_ITEMS.push(copy);
    await persistCustomIndex();
    try{ await storage.set('item:' + newId, JSON.stringify(copy), true); }
    catch(e){ showToast('คัดลอกไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
    currentId = newId;
    renderAll();
    showToast('คัดลอกเป็นเมนู "' + name.trim() + '" แล้ว');
  }

  function showToast(msg){
    const t = document.getElementById('toast');
    document.getElementById('toastText').textContent = msg;
    t.classList.add('show');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
  }
  function fmtPeople(v){ return (v===null||v===undefined) ? '' : v; }
  function escapeHtml(s){
    if(s===null||s===undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function matchesCategoryFilter(it){
    if(currentCategoryFilter===null) return true;
    if(currentCategoryFilter==='__uncat__') return !it.category;
    return it.category === currentCategoryFilter;
  }
  function renderCatChips(){
    const wrap = document.getElementById('catChips');
    let html = `<div class="cat-chip ${currentCategoryFilter===null?'active':''}" data-cat="__all__">ทั้งหมด</div>`;
    CATEGORIES.forEach(c => { html += `<div class="cat-chip ${currentCategoryFilter===c?'active':''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</div>`; });
    html += `<div class="cat-chip ${currentCategoryFilter==='__uncat__'?'active':''}" data-cat="__uncat__">ไม่ระบุหมวดหมู่</div>`;
    wrap.innerHTML = html;
    wrap.querySelectorAll('.cat-chip').forEach(chip=>{
      chip.onclick = () => { const c = chip.dataset.cat; currentCategoryFilter = (c==='__all__') ? null : c; renderAll(); };
    });
  }
  function renderSidebar(filter){
    const list = document.getElementById('itemList');
    const f = (filter||'').trim().toLowerCase();
    const filtered = allItems().map(base => getItem(base.id))
      .filter(it => matchesCategoryFilter(it))
      .filter(it => !f || it.clean_title.toLowerCase().includes(f) || it.title.toLowerCase().includes(f));

    // จำยอดคนไว้ ใช้ทั้งตอนเรียงและตอนวาดแถว (computeSteps ไล่สถานีทุกตัว ไม่ควรคิดซ้ำ)
    const peopleCache = new Map();
    const peopleOf = (it)=>{
      if(!peopleCache.has(it.id)){
        const n = parseFloat(sumPeople(computeSteps(it)));
        peopleCache.set(it.id, isNaN(n) ? -1 : n);
      }
      return peopleCache.get(it.id);
    };
    // เรียงเมนูที่ใช้คนเยอะสุดขึ้นก่อน ทั้งตอนดู "ทั้งหมด" และตอนเลือกหมวด
    // (เลือก "ทั้งหมด" ไม่แยกกลุ่มตามหมวด เพราะต้องการเห็นไลน์ที่ใช้คนมากสุดของทั้งโรงงาน)
    // คนเท่ากันเรียงตามชื่อ เมนูที่ยังไม่มีข้อมูลคนอยู่ท้ายสุด
    filtered.sort((a,b)=>
      peopleOf(b) - peopleOf(a)
      || (a.clean_title||'').localeCompare(b.clean_title||'', 'th'));

    document.getElementById('sidebarCount').textContent = filtered.length + ' เมนู';
    list.innerHTML = '';
    filtered.forEach(it => {
      const belt = getBelt(it);
      const row = document.createElement('div');
      row.className = 'item-row' + (it.id===currentId?' active':'') + (isEdited(it.id)?' edited':'');
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
          <div class="title">${escapeHtml(it.clean_title)}</div>
          <button class="sidebar-del-btn" data-delmenu="${it.id}" title="ลบเมนูนี้">🗑</button>
        </div>
        <div class="meta">
          <span class="meta-key meta-people">👥 <b>${peopleOf(it) < 0 ? '—' : peopleOf(it)}</b> คน</span>
          <span class="meta-key meta-rate">⏱ <b>${lineRate(it)===''?'—':lineRate(it)}</b> pc/hr</span>
          <span>⚡ ${fmtPeople(it.summary.belt_speed)} Hz</span>
          <span>▮ ${belt.bars.length} ไม้กั้น</span>
          ${it.category ? `<span class="pill">${escapeHtml(it.category)}</span>` : ''}
        </div>`;
      row.onclick = () => { currentId = it.id; renderAll(); };
      row.querySelector('[data-delmenu]').onclick = (e) => { e.stopPropagation(); deleteMenu(it.id); };
      list.appendChild(row);
    });
    if(filtered.length===0) list.innerHTML = '<div class="empty-state">ไม่พบเมนูที่ค้นหา</div>';
  }
  function renderOverview(){
    const main = document.getElementById('main');
    const items = allItems().map(base => getItem(base.id)).filter(it => matchesCategoryFilter(it));
    let rows = '';
    items.forEach(it => {
      const belt = getBelt(it);
      rows += `<tr class="clickable" data-id="${it.id}">
        <td>${escapeHtml(it.clean_title)}${isEdited(it.id)?' <span class="pill">แก้ไขแล้ว</span>':''}</td>
        <td>${escapeHtml(it.category||'—')}</td>
        <td>${escapeHtml(it.code||'—')}</td>
        <td class="num">${fmtPeople(sumPeople(computeSteps(it)))}</td>
        <td class="num">${fmtPeople(it.summary.belt_speed)}</td>
        <td class="num">${belt.bars.length}</td>
        <td class="num">${lineRate(it)===''?'—':lineRate(it)}</td>
        <td class="num">${it.images.length}</td>
        <td class="num"><button class="icon-btn" data-delmenu="${it.id}" title="ลบเมนูนี้">✕</button></td>
      </tr>`;
    });
    main.innerHTML = `
      <div class="overview">
        <h2>ตารางสรุปรวมทุกเมนู</h2>
        <p class="lead">คลิกที่แถวเพื่อดู/แก้ไขรายละเอียดตำแหน่งบรรจุของแต่ละเมนู ${currentCategoryFilter ? '(กรองตามหมวดหมู่ที่เลือก) ' : ''}ทั้งหมด ${items.length} เมนู</p>
        <table class="ov-table">
          <thead><tr><th>เมนู</th><th>หมวดหมู่</th><th>รหัสสินค้า</th><th class="num">จำนวนคน</th><th class="num">ความเร็วสายพาน (Hz)</th><th class="num">ไม้กั้น</th><th class="num">Rate (pc/hr)</th><th class="num">รูปตำแหน่ง</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    main.querySelectorAll('tr.clickable').forEach(tr=>{
      tr.onclick = () => { currentId = tr.dataset.id; renderAll(); };
      const delBtn = tr.querySelector('[data-delmenu]');
      if(delBtn) delBtn.onclick = (e) => { e.stopPropagation(); deleteMenu(tr.dataset.id); };
    });
  }
  function catOptionsHtml(selected){
    let html = `<option value="" ${!selected?'selected':''}>ไม่ระบุหมวดหมู่</option>`;
    CATEGORIES.forEach(c => { html += `<option value="${escapeHtml(c)}" ${selected===c?'selected':''}>${escapeHtml(c)}</option>`; });
    return html;
  }
  
  /* ---- lane rendering (stations only; bars/arrows now live in the overlay) ---- */
  // ตำแหน่งที่แสดงเก็บเป็น "จุดกลาง + ซูม" แยกจากตัวรูป รูปต้นฉบับจึงไม่ถูกตัดทิ้ง
  // (เดิมครอบรูปจริง ครอบซ้ำหลายรอบรูปเล็กลงเรื่อยๆ จนเหมือนซูมเข้าไปไม่หยุด และย้อนกลับไม่ได้)
  function imgViewAttr(s){
    const v = s && s.imgView;
    if(!v || !(Number(v.z) > 0)) return '';
    return ` data-view="${[v.cx, v.cy, v.z].map(n => Number(n) || 0).join(',')}"`;
  }
  // ขนาด/ตำแหน่งของรูปเป็น % ของกล่อง — ใช้ร่วมกันทั้งช่องบนสายพานและตัวอย่างในหน้าต่างจัดตำแหน่ง
  // ab (สัดส่วนกล่อง) ต่างกันระหว่างคอมกับมือถือ จึงต้องคำนวณตอนแสดง ไม่เก็บเป็นค่าตายตัว
  function viewRect(cx, cy, z, ai, ab){
    const w = 100 * z * Math.max(1, ai / ab);
    const h = w * ab / ai;
    return {
      w, h,
      l: Math.min(0, Math.max(100 - w, 50 - cx * w)),
      t: Math.min(0, Math.max(100 - h, 50 - cy * h)),
    };
  }
  function placeViewImg(img, box, cx, cy, z){
    const bw = box.clientWidth, bh = box.clientHeight;
    if(!img.naturalWidth || !bw || !bh) return false;
    const r = viewRect(cx, cy, z, img.naturalWidth / img.naturalHeight, bw / bh);
    Object.assign(img.style, {position:'absolute', maxWidth:'none', objectFit:'fill',
      width: r.w + '%', height: r.h + '%', left: r.l + '%', top: r.t + '%'});
    return true;
  }
  function applyImgViews(root){
    if(!root) return;
    root.querySelectorAll('.station-cell img[data-view]').forEach(img=>{
      const [cx, cy, z] = img.dataset.view.split(',').map(Number);
      const go = ()=> placeViewImg(img, img.parentElement, cx, cy, z);
      if(!go() && !img.complete) img.addEventListener('load', go, {once:true});
    });
  }
  function stationCellHtml(side, idx, s){
    const inner = (s.type==='image' && s.img)
      ? `<img src="${s.img}"${imgViewAttr(s)}><button class="clear-img" data-clearimg="${side}:${idx}" title="ล้างรูป">✕</button><button class="crop-img-btn" data-viewimg="${side}:${idx}" title="เลือกส่วนของรูปที่จะแสดง">✥</button>`
      : `<span class="hint">＋</span>`;
    return `<div class="station-cell" data-cellupload="${side}:${idx}">${inner}</div>`;
  }
  function stationRowHtml(side, idx, s, total){
    const btns = `<div class="station-btns">
          <select class="blank-select" data-blanksel="${side}:${idx}">
            <option value="normal" ${!s.blank?'selected':''}>ใช้งาน</option>
            <option value="blank" ${s.blank?'selected':''}>ว่าง</option>
          </select>
          <button class="station-copy-btn ${clipKeys.has(clipKeyOf(side, idx))?'picked':''}" data-copystation="${side}:${idx}" title="คัดลอกสถานีนี้ (กดซ้ำเพื่อเอาออก) เลือกหลายสถานีแล้ววางทีเดียวได้">${clipKeys.has(clipKeyOf(side, idx))?'✓ เลือกแล้ว':'⧉ คัดลอก'}</button>
        </div>`;
    const handle = `<div class="station-icon drag-handle" title="ลากค้างเพื่อย้ายตำแหน่ง/สลับฝั่ง">⠿</div>`;
    const people = `<div class="people-field">
          <input class="people-input" type="text" placeholder="0" value="${escapeHtml(s.people)}" data-people="${side}:${idx}" title="จำนวนคน (ดึงเข้าตารางสรุป)">
          <span class="people-unit">คน</span>
        </div>`;
    const labelStack = `<div class="label-rate-stack">
          <textarea class="station-label" rows="1" placeholder="ชื่อกิจกรรม..." data-label="${side}:${idx}">${escapeHtml(s.label)}</textarea>
          <div class="rate-row"><input class="rate-input" type="text" placeholder="Rate" value="${escapeHtml(s.rate)}" data-rate="${side}:${idx}"><span class="rate-unit">pc/hr</span></div>
        </div>`;
    const cell = stationCellHtml(side, idx, s);
    const inner = side==='right'
      ? cell + people + labelStack + handle + btns
      : btns + handle + people + labelStack + cell;
    return `<div class="station-row ${s.blank?'blank':''}" draggable="true" data-dragside="${side}" data-dragidx="${idx}">${inner}</div>`;
  }
  function headCardHtml(idx, s, total){
    return `
      <div class="head-card ${s.blank?'blank':''}" draggable="true" data-dragside="head" data-dragidx="${idx}">
        <div class="head-card-top">
          <select class="blank-select" data-blanksel="head:${idx}">
            <option value="normal" ${!s.blank?'selected':''}>ใช้งาน</option>
            <option value="blank" ${s.blank?'selected':''}>ว่าง</option>
          </select>
          <button class="station-copy-btn ${clipKeys.has(clipKeyOf('head', idx))?'picked':''}" data-copystation="head:${idx}" title="คัดลอกสถานีนี้ (กดซ้ำเพื่อเอาออก)">${clipKeys.has(clipKeyOf('head', idx))?'✓':'⧉'}</button>
          <div class="drag-handle" title="ลากค้างเพื่อย้ายตำแหน่ง">⠿</div>
        </div>
        <div class="head-card-fields">
          <div class="people-field">
            <input class="people-input" type="text" placeholder="0" value="${escapeHtml(s.people)}" data-people="head:${idx}" title="จำนวนคน">
            <span class="people-unit">คน</span>
          </div>
          <textarea class="station-label" rows="1" placeholder="ชื่อกิจกรรม..." data-label="head:${idx}">${escapeHtml(s.label)}</textarea>
          <div class="rate-row"><input class="rate-input" type="text" placeholder="Rate" value="${escapeHtml(s.rate)}" data-rate="head:${idx}"><span class="rate-unit">pc/hr</span></div>
          ${stationCellHtml('head', idx, s)}
        </div>
      </div>`;
  }
  function pasteBtnHtml(side, full){
    const list = readStationClip();
    if(!list.length) return '';
    return `<button class="btn btn-outline btn-small lane-paste-btn" data-pasteslot="${side}" ${full?'disabled':''} title="วางสถานีที่คัดลอกไว้ลงตรงนี้">📋 วาง ${escapeHtml(clipSummary(list))}</button>`;
  }
  function renderHeadRow(headSlots){
    const cards = headSlots.map((s,i)=> headCardHtml(i, s, headSlots.length)).join('');
    const full = headSlots.length>=MAX_SLOTS;
    return `<div class="head-add-row">
        <button class="btn btn-outline btn-small head-add-btn" data-addslot="head" ${full?'disabled':''}>+ เพิ่มกิจกรรมหัวไลน์</button>
        ${pasteBtnHtml('head', full)}
      </div>
      <div class="head-row" id="headRow">${cards}</div>`;
  }
  function renderLane(side, slots){
    let html = slots.map((s,i) => stationRowHtml(side, i, s, slots.length)).join('');
    const addDisabled = slots.length>=MAX_SLOTS ? 'disabled' : '';
    return `
      <div class="lane-title">ฝั่ง${side==='left'?'ซ้าย':'ขวา'} (${slots.length}/${MAX_SLOTS})</div>
      ${html}
      <button class="btn btn-outline btn-small lane-add-btn" data-addslot="${side}" ${addDisabled}>+ เพิ่มสถานี</button>
      ${pasteBtnHtml(side, slots.length>=MAX_SLOTS)}`;
  }
  
  /* ---- overlay rendering (draggable bars + flow arrows) ---- */
  // ความสูงจริงของรางตามเลย์เอาต์ (ไม่รวมผลของการซูม — offsetHeight ไม่โดน transform)
  function beltLayoutHeight(){
    const ov = document.getElementById('beltOverlay');
    return ov ? ov.offsetHeight : 0;
  }
  // เดิมเก็บตำแหน่งเป็น % ของความสูงราง พอเพิ่ม/ลบสถานีแล้วรางสูงขึ้น-เตี้ยลง
  // ของที่ลอยอยู่ (ไม้กั้น ลูกศร เครื่องจักร) เลยเลื่อนตามไปด้วย
  // เปลี่ยนมาเก็บเป็น px จากขอบบนราง จึงอยู่กับที่เมื่อจำนวนสถานีเปลี่ยน
  // (% เก็บไว้เป็นค่าสำรองของข้อมูลเก่าที่ยังไม่ถูกแปลง)
  function ovTop(o){
    return (typeof o.topPx === 'number' && isFinite(o.topPx)) ? (o.topPx + 'px') : ((parseFloat(o.top) || 0) + '%');
  }
  // เติม topPx ให้ของเก่าที่มีแต่ % โดยอิงความสูงรางที่วาดอยู่ตอนนี้ — ตำแหน่งบนจอจึงไม่ขยับ
  // ทำเฉพาะเมนูที่อยู่ใน edited อยู่แล้ว จะได้ไม่ไปตีตรา "แก้ไขแล้ว" ให้เมนูที่ยังไม่เคยแก้
  // topPx ถูกบันทึกตอนสถานีห่างกัน belt.rowGap px (ของเก่าไม่มีค่านี้ = 6)
  // ถ้าระยะห่างใน CSS ตอนนี้ต่างไป ให้ยืดตำแหน่งตามจำนวนช่องที่อยู่เหนือมัน ไม่งั้นไม้กั้นจะค่อยๆ เหลื่อมไปทีละช่อง
  const LEGACY_ROW_GAP = 6;
  function migrateRowGap(belt){
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--station-gap'));
    if(!belt || !isFinite(gap)) return;
    const oldGap = typeof belt.rowGap === 'number' ? belt.rowGap : LEGACY_ROW_GAP;
    if(oldGap === gap) return;
    const row = document.querySelector('#beltStage .station-row');
    if(row){
      const y0 = row.offsetTop, k = (row.offsetHeight + gap) / (row.offsetHeight + oldGap);
      ['bars','arrows','machines'].forEach(key=>{
        (belt[key] || []).forEach(o=>{
          if(o && typeof o.topPx === 'number' && o.topPx > y0) o.topPx = Math.round(y0 + (o.topPx - y0) * k);
        });
      });
      const ov = document.getElementById('beltOverlay');
      if(ov){
        [['bars','data-bar'], ['arrows','data-arrow'], ['machines','data-machine']].forEach(([key, attr])=>{
          ov.querySelectorAll('[' + attr + ']').forEach(el=>{
            const o = (belt[key] || [])[parseInt(el.getAttribute(attr))];
            if(o) el.style.top = ovTop(o);
          });
        });
      }
    }
    belt.rowGap = gap;
  }
  function migrateOverlayPositions(id){
    const ed = edited[id];
    if(!ed || !ed.belt) return;
    const h = beltLayoutHeight();
    if(!h) return;
    migrateRowGap(ed.belt);
    ['bars','arrows','machines'].forEach(k=>{
      (ed.belt[k] || []).forEach(o=>{
        if(o && typeof o.topPx !== 'number') o.topPx = Math.round(((parseFloat(o.top) || 0) / 100) * h);
      });
    });
  }

  function renderOverlay(belt){
    const bars = belt.bars || [], arrows = belt.arrows || [], machines = belt.machines || [];
    let html = '';
    bars.forEach((b, idx) => {
      const style = b.side==='left' ? `left:8px;width:calc(50% - 16px);` : `right:8px;width:calc(50% - 16px);`;
      html += `<div class="ov-bar" data-bar="${idx}" style="top:${ovTop(b)};${style}"><button class="ov-x" data-barrm="${idx}">✕</button></div>`;
    });
    arrows.forEach((a, idx) => {
      const pointRight = a.dir !== 'left';
      const glyph = `<span class="arrow-glyph">${pointRight ? '⟶' : '⟵'}</span>`;
      const xBtn = `<button class="ov-x" data-arrowrm="${idx}">✕</button>`;
      // ปุ่มลบอยู่ "ท้ายลูกศร" เสมอ: พุ่งขวา → ปุ่มไปอยู่ซ้าย, พุ่งซ้าย → ปุ่มไปอยู่ขวา
      const inner = pointRight ? xBtn + glyph : glyph + xBtn;
      html += `<div class="ov-arrow" data-arrow="${idx}" style="top:${ovTop(a)};">
        <div class="arrow-body" data-arrowdrag="${idx}">${inner}</div>
      </div>`;
    });
    // เครื่องจักรคร่อมกลางราง สูงเท่า 3 ช่องสถานี ลากขึ้น/ลงได้ที่แถบหัวกล่อง
    machines.forEach((m, idx) => {
      if(!m) return;
      const box = machineBox(m);
      html += `<div class="ov-machine" data-machine="${idx}" style="top:${ovTop(m)};left:${box.left}%;width:${box.w}%;">
        <div class="machine-head" data-machinedrag="${idx}" title="ลากค้างเพื่อย้ายตำแหน่ง (ขึ้น/ลง/ซ้าย/ขวา)">
          <span class="machine-grip">⠿ เครื่องจักร</span>
          <button class="ov-x" data-machinerm="${idx}" title="ลบเครื่องจักรนี้">✕</button>
        </div>
        <input class="machine-name" placeholder="ชื่อเครื่องจักร..." value="${escapeHtml(m.name)}" data-machinename="${idx}">
        <div class="machine-fields">
          <div class="people-field">
            <input class="people-input" type="text" placeholder="0" value="${escapeHtml(m.people)}" data-machinepeople="${idx}" title="จำนวนคนที่คุมเครื่องนี้">
            <span class="people-unit">คน</span>
          </div>
          <div class="rate-row">
            <input class="rate-input" type="text" placeholder="Rate" value="${escapeHtml(m.rate)}" data-machinerate="${idx}">
            <span class="rate-unit">pc/hr</span>
          </div>
        </div>
        ${stationCellHtml('machine', idx, m)}
      </div>`;
    });
    return html;
  }
  
  function renderDetail(id){
    renderingId = id;
    const clipNow = readStationClip();
    const beltClipNow = readBeltClip();
    clipKeys = new Set(clipNow.map(c => c && c.__src).filter(Boolean));
    const it = getItem(id);
    const belt = getBelt(it);
    const main = document.getElementById('main');
  
    const imagesHtml = it.images.length
      ? it.images.map((b64,gi) => `<img src="data:image/jpeg;base64,${b64}" draggable="true" data-galleryimg="${gi}" title="ลากรูปนี้ไปวางบนสายพานได้" onclick="openModal(this.src)">`).join('')
      : '<div class="empty">ไม่มีรูปตำแหน่งจากไฟล์ต้นฉบับสำหรับเมนูนี้</div>';
  
    // ตารางคำนวณจากสถานีบนสายพานเสมอ (ไม่ใช่ค่าที่เซฟไว้) จะได้ตรงกับที่เห็นบนราง
    const steps = computeSteps(it);
    const stepsRows = steps.map((s, idx) => {
      // แถวที่ยุบรวมจากหลายสถานี (_n>1): ค่า ชื่อ/คน/Rate เป็นผลรวม แก้ที่ตารางไม่ได้
      // ให้ไปแก้ที่สถานีแทน — แสดงเป็นข้อความ ไม่ใช่ช่องกรอก
      const agg = (s._n || 1) > 1;
      const nameCell = agg
        ? `<td><span class="step-agg">${escapeHtml(s.process)} <em>รวม ${s._n} จุด</em></span></td>`
        : `<td><input type="text" value="${escapeHtml(s.process)}" data-field="process" data-idx="${idx}"></td>`;
      const peopleCell = agg
        ? `<td class="people-col"><span class="step-agg">${escapeHtml(s.people)}</span></td>`
        : `<td class="people-col"><input type="text" value="${escapeHtml(s.people)}" data-field="people" data-idx="${idx}"></td>`;
      const rateCell = agg
        ? `<td class="rate-col"><span class="step-agg">${escapeHtml(s.rate)}</span></td>`
        : `<td class="rate-col"><input type="text" value="${escapeHtml(s.rate)}" data-field="rate" data-idx="${idx}" placeholder="—"></td>`;
      return `
      <tr data-idx="${idx}" draggable="true" data-stepidx="${idx}">
        <td class="drag-col" title="ลากเพื่อสลับลำดับ">⠿</td>
        <td class="order-col">${idx+1}</td>
        ${nameCell}
        ${peopleCell}
        ${rateCell}
        <td class="position-col"><input type="text" value="${escapeHtml(s.position)}" data-field="position" data-idx="${idx}"></td>
        <td class="action-col"><button class="icon-btn" title="ลบขั้นตอนนี้" data-del="${idx}">✕</button></td>
      </tr>`;
    }).join('');
  
    const peopleTotal = sumPeople(steps);
  
    main.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="detail-title-row">
            <input class="title-input" id="titleInput" type="text" value="${escapeHtml(it.clean_title)}">
            <select class="cat-select" id="catSelect">${catOptionsHtml(it.category)}</select>
          </div>
          <div class="code">
            <span class="code-src">${it.custom ? 'เมนูที่เพิ่มเอง' : 'ชีตต้นฉบับ: ' + escapeHtml(it.title)}</span>
            <span class="code-field">รหัสสินค้า <input id="codeInput" type="text" value="${escapeHtml(it.code)}" placeholder="ยังไม่ระบุ"></span>
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-outline" id="copyMenuBtn">⧉ คัดลอกเมนู</button>
          <button class="btn btn-danger" id="deleteMenuBtn">🗑 ลบเมนูนี้</button>
          <button class="btn btn-save" id="saveBtn">💾 บันทึก</button>
        </div>
      </div>
  
      <h3 class="section-h">โครงสายพาน + ตำแหน่งพนักงาน</h3>
      <div class="gallery-block">
        <div class="gallery-head">
          <button class="gallery-toggle" id="galleryToggleBtn" title="ซ่อน/แสดงรูปต้นฉบับ">${galleryToggleLabel(it.images.length)}</button>
          <button class="btn btn-outline btn-small" id="addGalleryImgsBtn">+ เพิ่มรูปจากเครื่อง (เลือกได้หลายไฟล์)</button>
        </div>
        <div class="gallery ${galleryCollapsed ? 'collapsed' : ''}" id="galleryBody">${imagesHtml}</div>
      </div>
      <div class="belt-zoombar">
        <span class="zoom-label">ขนาดที่แสดง</span>
        <button class="btn btn-outline btn-small" id="zoomOutBtn" title="ย่อลง">−</button>
        <button class="btn btn-outline btn-small zoom-level" id="zoomResetBtn" title="กลับไปขนาดปกติ 100%">100%</button>
        <button class="btn btn-outline btn-small" id="zoomInBtn" title="ขยายขึ้น">+</button>
        <button class="btn btn-outline btn-small" id="zoomFitBtn" title="ย่อให้เห็นทั้งไลน์พอดีความกว้างจอ">⤢ พอดีจอ</button>
      </div>
      <div class="belt-scroll" id="beltScroll">
        <div class="belt-zoomwrap" id="beltZoomWrap">
          <div class="belt-viewport" id="beltViewport">
            ${renderHeadRow(belt.headSlots)}
            <div class="belt-stage" id="beltStage">
              <div class="belt-grid">
                <div class="lane lane-left">${renderLane('left', belt.leftSlots)}</div>
                <div class="lane-divider"></div>
                <div class="lane lane-right">${renderLane('right', belt.rightSlots)}</div>
                <div class="belt-overlay" id="beltOverlay">${renderOverlay(belt)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-small" id="addBarBtn">+ เพิ่มไม้กั้น</button>
        <button class="btn btn-outline btn-small" id="addArrowBtn">+ เพิ่มลูกศรทิศทาง</button>
        <button class="btn btn-outline btn-small" id="addMachineBtn">⚙ แทรกเครื่องจักร</button>
        <button class="btn btn-outline btn-small" id="copyBeltBtn" title="คัดลอกทั้งสายพาน (สถานีสองเลน หัวไลน์ ไม้กั้น ลูกศร เครื่องจักร) ไปวางที่เมนูอื่น">⧉ คัดลอกทั้งสายพาน</button>
        ${beltClipNow ? `<span class="clip-status">
          <button class="btn btn-outline btn-small lane-paste-btn" id="pasteBeltBtn" title="วางทับสายพานของเมนูนี้">📋 วางทั้งสายพาน (${beltClipCount(beltClipNow)} สถานี จาก "${escapeHtml(beltClipNow.from)}")</button>
          <button id="clearBeltClipBtn" title="ล้างสายพานที่คัดลอกไว้">ล้าง</button>
        </span>` : ''}
        ${clipNow.length ? `<span class="clip-status">📋 คัดลอกไว้ ${clipNow.length} สถานี: ${escapeHtml(clipNow.slice(0,3).map(clipName).join(', '))}${clipNow.length>3?' …':''} <button id="clearClipBtn">ล้าง</button></span>` : ''}
      </div>
      <div class="belt-hint">ลากค้างที่ไอคอน ⠿ ในแต่ละสถานีเพื่อสลับตำแหน่งขึ้น/ลง หรือย้ายข้ามไปอีกฝั่งได้เลย (ปล่อยตรงไหนก็ไปแทรกตรงนั้น) · <b>ลากออกไปปล่อยข้าง ๆ หรือใต้รางสายพานเพื่อลบสถานีนั้น</b> (ปล่อยเหนือรางจะย้ายขึ้นหัวไลน์ ไม่ลบ) · คลิกค้างที่ไม้กั้น (แถบดำ) หรือลูกศรแดงแล้วลากขึ้น/ลง/ซ้าย/ขวาได้เลย · คลิกลูกศรสั้น ๆ (ไม่ลาก) เพื่อสลับทิศทาง · คลิกช่องสีน้ำเงินเพื่อวางรูปจากเครื่อง · กด ✥ บนรูปเพื่อเลือกส่วนที่จะแสดง · ลากรูปจาก "รูปตำแหน่งจากไฟล์ต้นฉบับ" ด้านบนไปปล่อยบนช่องสายพานได้โดยตรง · เลือก "ว่าง" ที่สถานีใดก็ได้เพื่อเว้นช่องนั้นไว้</div>
  
      <h3 class="section-h">ตารางกระบวนการ / ตำแหน่ง</h3>
      <table class="steps-table">
        <thead><tr><th></th><th>ลำดับ</th><th>กระบวนการ</th><th>จำนวนคน</th><th>Rate (pc/hr)</th><th>ตำแหน่ง</th><th></th></tr></thead>
        <tbody id="stepsBody">${stepsRows}</tbody>
      </table>
      <button class="btn btn-outline btn-small add-row-btn" id="addRowBtn">+ เพิ่มขั้นตอน</button>
  
      <table class="foot-table">
        <tr class="fy"><td>รวม</td><td>${peopleTotal===''?'—':peopleTotal}</td><td>คน</td></tr>
        <tr class="fo"><td>ความเร็วสายพาน ไลน์1</td><td><input id="sumSpeed" type="text" value="${escapeHtml(it.summary.belt_speed)}"></td><td>Hz</td></tr>
        <tr class="fg"><td>จำนวนไม้กั้น</td><td>${belt.bars.length}</td><td>pc</td></tr>
        <tr class="fb"><td>Rate บรรจุ <span style="font-weight:400;font-size:11px;">(ต่ำสุดจากตารางกระบวนการ)</span></td><td>${lineRate(it)===''?'—':lineRate(it)}</td><td>pc/hr</td></tr>
      </table>
    `;
  
    document.getElementById('saveBtn').onclick = () => saveCurrent(id);
    document.getElementById('deleteMenuBtn').onclick = () => deleteMenu(id);
    document.getElementById('copyMenuBtn').onclick = () => duplicateMenu(id);
    document.getElementById('addGalleryImgsBtn').onclick = () => {
      pendingGalleryTarget = id;
      document.getElementById('hiddenGalleryFileInput').click();
    };
    document.getElementById('addRowBtn').onclick = () => addStepRow(id);
  
    const codeInput = document.getElementById('codeInput');
    codeInput.addEventListener('input', (e)=>{ ensureEdited(id).code = e.target.value.trim() || null; });
    codeInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); e.target.blur(); } });
    codeInput.addEventListener('blur', ()=> persist(id));

    document.getElementById('titleInput').addEventListener('input', (e)=>{ const ed = ensureEdited(id); ed.title = e.target.value; ed.clean_title = e.target.value; });
    document.getElementById('titleInput').addEventListener('blur', ()=> persist(id));
    document.getElementById('catSelect').addEventListener('change', (e)=>{
      const ed = ensureEdited(id); ed.category = e.target.value; persist(id);
      renderSidebar(document.getElementById('searchBox').value); renderCatChips();
    });
  
    main.querySelectorAll('#stepsBody input').forEach(inp=>{
      inp.addEventListener('input', (e)=>{
        const idx = parseInt(e.target.dataset.idx); const field = e.target.dataset.field; const val = e.target.value;
        const ed = ensureEdited(id);
        // อ้างอิงแถวจากมุมมองที่ยุบรวมแล้ว (ตรงกับที่ render) ไม่ใช่ ed.steps ดิบ
        const row = computeSteps(ed)[idx];
        if(!row) return;
        const name = (row.process || '').trim();
        if(field==='position'){
          // เขียน "ตำแหน่ง" กลับเข้า ed.steps ทุกแถวชื่อเดียวกัน (position ไม่ได้มาจากสถานี)
          let hit = false;
          (ed.steps||[]).forEach(s=>{ if(s && (s.process||'').trim()===name){ s.position = val; hit = true; } });
          if(!hit && ed.steps[idx]) ed.steps[idx].position = val;
          return;
        }
        // ช่อง ชื่อ/คน/Rate จะแก้ได้เฉพาะแถวที่ไม่ได้ยุบรวม → เขียนกลับไปที่สถานีตัวเดียวนั้น
        const target = findLoneStation(ed, name);
        if(!target) return;
        if(field==='process') target.label = val;
        else if(field==='people') target.people = val;
        else if(field==='rate') target.rate = val;
      });
      inp.addEventListener('blur', (e)=>{
        const field = e.target.dataset.field;
        if(field!=='position') syncStationsToSteps(id);
        persist(id); renderDetail(id);
        if(field!=='position') renderSidebar(document.getElementById('searchBox').value);
      });
    });
    main.querySelectorAll('[data-del]').forEach(btn=>{
      btn.onclick = (e)=>{
        const idx = parseInt(e.target.dataset.del); const ed = ensureEdited(id);
        const row = computeSteps(ed)[idx];
        if(!row) return;
        const name = (row.process || '').trim();
        if(name){
          // ตารางยุบรวมมาจากสถานีบนสายพาน — ลบแถว = ลบทุกสถานีที่ชื่อกิจกรรมนี้
          const n = ((ed.belt.leftSlots||[]).concat(ed.belt.rightSlots||[])).filter(s=>s && !s.blank && (s.label||'').trim()===name).length;
          if(!window.confirm('ลบกิจกรรม "'+name+'" ออกจากสายพาน'+(n>1?(' ทั้ง '+n+' จุด'):'')+'?')) return;
          ['leftSlots','rightSlots'].forEach(k=>{
            ed.belt[k] = (ed.belt[k]||[]).filter(s=> !(s && (s.label||'').trim()===name));
          });
          syncStationsToSteps(id);
        }else{
          ed.steps = computeSteps(ed); ed.steps.splice(idx,1);
        }
        persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
      };
    });
    document.getElementById('sumSpeed').addEventListener('input', (e)=>{ ensureEdited(id).summary.belt_speed = e.target.value; });
    document.getElementById('sumSpeed').addEventListener('blur', ()=> persist(id));
  
    main.querySelectorAll('[data-addslot]').forEach(b=> b.onclick = ()=> addSlot(id, b.dataset.addslot));
    main.querySelectorAll('[data-pasteslot]').forEach(b=> b.onclick = ()=> pasteStation(id, b.dataset.pasteslot));
    main.querySelectorAll('[data-copystation]').forEach(b=> b.onclick = (e)=>{
      e.stopPropagation();
      const [side, sidx] = b.dataset.copystation.split(':');
      toggleCopyStation(id, side, parseInt(sidx));
    });
    const clearClipBtn = document.getElementById('clearClipBtn');
    if(clearClipBtn) clearClipBtn.onclick = () => clearStationClip(id);
    const galleryToggleBtn = document.getElementById('galleryToggleBtn');
    galleryToggleBtn.onclick = () => {
      galleryCollapsed = !galleryCollapsed;
      try{ window.localStorage.setItem(GAL_KEY, galleryCollapsed ? '1' : '0'); }catch(e){}
      // สลับที่ DOM ตรง ๆ ไม่ render ใหม่ทั้งหน้า จะได้ไม่เด้งตำแหน่งที่เลื่อนอยู่
      document.getElementById('galleryBody').classList.toggle('collapsed', galleryCollapsed);
      galleryToggleBtn.textContent = galleryToggleLabel(getItem(id).images.length);
    };
    document.getElementById('copyBeltBtn').onclick = () => copyWholeBelt(id);
    const pasteBeltBtn = document.getElementById('pasteBeltBtn');
    if(pasteBeltBtn) pasteBeltBtn.onclick = () => pasteWholeBelt(id);
    const clearBeltClipBtn = document.getElementById('clearBeltClipBtn');
    if(clearBeltClipBtn) clearBeltClipBtn.onclick = () => clearBeltClip(id);
    main.querySelectorAll('[data-cellupload]').forEach(el=> el.onclick = (e)=>{
      if(e.target.closest('[data-clearimg]') || e.target.closest('[data-viewimg]')) return;
      const [side, idx] = el.dataset.cellupload.split(':');
      pendingUpload = {id, side, idx: parseInt(idx)};
      document.getElementById('hiddenFileInput').click();
    });
    main.querySelectorAll('[data-viewimg]').forEach(el=> el.onclick = (e)=>{
      e.stopPropagation();
      const [side, cidx] = el.dataset.viewimg.split(':');
      openViewModal(id, side, parseInt(cidx), el.closest('.station-cell'));
    });
    main.querySelectorAll('[data-clearimg]').forEach(el=> el.onclick = (e)=>{
      e.stopPropagation();
      const [side, idx] = el.dataset.clearimg.split(':'); clearSlotImage(id, side, parseInt(idx));
    });
    main.querySelectorAll('[data-blanksel]').forEach(el=> el.addEventListener('change', (e)=>{
      const [side, idx] = e.target.dataset.blanksel.split(':');
      const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
      arr[parseInt(idx)].blank = (e.target.value==='blank');
      syncStationsToSteps(id);
      persist(id); renderDetail(id);
    }));
    main.querySelectorAll('[data-label]').forEach(el=>{
      el.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); e.target.blur(); } });
      el.addEventListener('input', (e)=>{
        const [side, idx] = e.target.dataset.label.split(':');
        const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
        arr[parseInt(idx)].label = e.target.value;
        autoSizeLabel(e.target);
      });
      el.addEventListener('blur', ()=>{
        syncStationsToSteps(id);
        persist(id); renderDetail(id);
      });
    });
    main.querySelectorAll('[data-people]').forEach(el=>{
      el.addEventListener('input', (e)=>{
        const [side, idx] = e.target.dataset.people.split(':');
        const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
        arr[parseInt(idx)].people = e.target.value;
      });
      el.addEventListener('blur', ()=>{
        syncStationsToSteps(id);
        persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
      });
    });
    main.querySelectorAll('[data-rate]').forEach(el=>{
      el.addEventListener('input', (e)=>{
        const [side, idx] = e.target.dataset.rate.split(':');
        const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
        arr[parseInt(idx)].rate = e.target.value;
      });
      el.addEventListener('blur', ()=> persist(id));
    });
  
    document.getElementById('addBarBtn').onclick = () => addBar(id);
    document.getElementById('addArrowBtn').onclick = () => addArrow(id);
    document.getElementById('addMachineBtn').onclick = () => addMachine(id);
    main.querySelectorAll('[data-machinerm]').forEach(el=> el.onclick = (e)=>{ e.stopPropagation(); removeMachine(id, parseInt(el.dataset.machinerm)); });
    [['machinename','name'],['machinepeople','people'],['machinerate','rate']].forEach(([attr, field])=>{
      main.querySelectorAll('[data-' + attr + ']').forEach(el=>{
        el.addEventListener('input', (e)=>{
          const m = ensureEdited(id).belt.machines[parseInt(e.target.dataset[attr])];
          if(m) m[field] = e.target.value;
        });
        // คน/Rate ของเครื่องจักรไหลเข้าตารางสรุปด้วย จึง render ใหม่ทั้งหน้าเมื่อแก้เสร็จ
        el.addEventListener('blur', ()=>{ persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value); });
      });
    });
    main.querySelectorAll('[data-barrm]').forEach(el=> el.onclick = (e)=>{ e.stopPropagation(); removeBar(id, parseInt(el.dataset.barrm)); });
    main.querySelectorAll('[data-arrowrm]').forEach(el=> el.onclick = (e)=>{ e.stopPropagation(); removeArrow(id, parseInt(el.dataset.arrowrm)); });
  
    document.getElementById('zoomOutBtn').onclick = () => stepBeltZoom(-1);
    document.getElementById('zoomInBtn').onclick = () => stepBeltZoom(1);
    document.getElementById('zoomResetBtn').onclick = () => setBeltZoom(1);
    document.getElementById('zoomFitBtn').onclick = () => fitBeltZoom();

    setupDragging(id);
    setupStationDnD(id);
    setupStepsDnD(id);
    setupGalleryDrag(id);
    autoSizeAllLabels(main);
    applyBeltZoom();
    applyImgViews(main);
    migrateOverlayPositions(id);
  }
  
  function autoSizeLabel(el){
    if(!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }
  function autoSizeAllLabels(root){
    (root || document).querySelectorAll('textarea.station-label').forEach(autoSizeLabel);
  }

  function setupGalleryDrag(id){
    const main = document.getElementById('main');
    main.querySelectorAll('.gallery img[data-galleryimg]').forEach(img=>{
      img.addEventListener('dragstart', (e)=>{
        const gi = parseInt(img.dataset.galleryimg);
        const it = getItem(id);
        galleryDragData = it.images[gi] ? ('data:image/jpeg;base64,' + it.images[gi]) : null;
        try{ e.dataTransfer.setData('text/plain', 'gallery'); }catch(err){}
        e.dataTransfer.effectAllowed = 'copy';
      });
      img.addEventListener('dragend', ()=>{ galleryDragData = null; });
    });
    main.querySelectorAll('.station-cell[data-cellupload]').forEach(cell=>{
      cell.addEventListener('dragover', (e)=>{
        if(!galleryDragData) return;
        e.preventDefault(); e.stopPropagation();
        cell.classList.add('drop-hover');
      });
      cell.addEventListener('dragleave', ()=> cell.classList.remove('drop-hover'));
      cell.addEventListener('drop', (e)=>{
        if(!galleryDragData) return;
        e.preventDefault(); e.stopPropagation();
        cell.classList.remove('drop-hover');
        const [side, idx] = cell.dataset.cellupload.split(':');
        const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
        arr[parseInt(idx)].type = 'image'; arr[parseInt(idx)].img = galleryDragData; arr[parseInt(idx)].imgView = null;
        galleryDragData = null;
        persist(id); renderDetail(id);
      });
    });
  }
  
  function setupStationDnD(id){
    const main = document.getElementById('main');
    let dragSource = null; // {side, idx}
  
    function containerSideOf(container){
      if(container.classList.contains('lane-left')) return 'left';
      if(container.classList.contains('lane-right')) return 'right';
      return 'head';
    }
    // หัวไลน์เรียงแนวนอน (ขึ้นบรรทัดใหม่ได้) ต้องหาตำแหน่งจากทั้งแกน X และ Y ไม่ใช่ Y อย่างเดียวแบบราง
    function headIndexAt(clientX, clientY){
      const cards = Array.from(document.querySelectorAll('#headRow .head-card'));
      for(let i=0;i<cards.length;i++){
        const r = cards[i].getBoundingClientRect();
        if(clientY < r.top) return i;
        if(clientY <= r.bottom && clientX < r.left + r.width/2) return i;
      }
      return cards.length;
    }
    function indexInContainerAt(container, clientX, clientY){
      if(containerSideOf(container) === 'head') return headIndexAt(clientX, clientY);
      const rows = Array.from(container.querySelectorAll('.station-row, .head-card'));
      for(let i=0;i<rows.length;i++){
        const r = rows[i].getBoundingClientRect();
        if(clientY < r.top + r.height/2) return i;
      }
      return rows.length;
    }
  
    // ปล่อยนอกรางสายพาน = ลบสถานีนั้น (เดิมต้องลากลงไปถึงกล่องถังขยะใต้ไลน์ ซึ่งไลน์ยาว ๆ ลากลำบาก)
    // ต้องดัก dragover ที่ document ด้วย ไม่งั้นเบราว์เซอร์จะไม่ยอมให้ปล่อยนอกพื้นที่ที่รับ drop
    function allowOutsideDrop(e){ if(dragSource) e.preventDefault(); }
    function outsideDrop(e){
      if(!dragSource) return; // รางรับไปแล้ว (handler ของรางเคลียร์ dragSource ทิ้งก่อน event จะขึ้นมาถึงนี่)
      e.preventDefault();
      const {side, idx} = dragSource;
      // ปล่อยเหนือรางสายพาน = ตั้งใจย้ายขึ้นหัวไลน์ ไม่ใช่ลบ
      // (แถวหัวไลน์ตอนยังว่างสูงแทบเป็น 0 ปล่อยให้โดนกล่องตรง ๆ แทบไม่ได้ จึงนับทั้งพื้นที่เหนือราง)
      if(isAboveBelt(e.clientX, e.clientY)){
        endDrag();
        moveStationCrossLane(id, side, idx, 'head', headIndexAt(e.clientX, e.clientY));
        return;
      }
      const s = slotsArrayFor(ensureEdited(id), side)[idx];
      const name = ((s && s.label) || '').trim();
      endDrag();
      removeSlot(id, side, idx, name ? ('ลบสถานี "' + name + '" แล้ว') : 'ลบสถานีแล้ว');
    }
    function isAboveBelt(clientX, clientY){
      const grid = main.querySelector('#beltStage .belt-grid');
      const scroll = document.getElementById('beltScroll');
      if(!grid || !scroll) return false;
      const g = grid.getBoundingClientRect(), s = scroll.getBoundingClientRect();
      return clientY < g.top && clientX >= s.left && clientX <= s.right;
    }
    // ถอด listener ทิ้งเองทุกครั้งที่จบการลาก เพราะ renderDetail อาจลบแถวต้นทางไปก่อน dragend จะยิง
    function endDrag(){
      document.removeEventListener('dragover', allowOutsideDrop);
      document.removeEventListener('drop', outsideDrop);
      document.body.classList.remove('station-dragging');
      dragSource = null;
    }

    main.querySelectorAll('.station-row, .head-card').forEach(row=>{
      row.addEventListener('dragstart', (e)=>{
        dragSource = {side: row.dataset.dragside, idx: parseInt(row.dataset.dragidx)};
        try{ e.dataTransfer.setData('text/plain', 'station'); }catch(err){}
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
        document.body.classList.add('station-dragging');
        document.addEventListener('dragover', allowOutsideDrop);
        document.addEventListener('drop', outsideDrop);
      });
      row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); endDrag(); });
    });
  
    main.querySelectorAll('.lane, #headRow').forEach(container=>{
      container.addEventListener('dragover', (e)=>{ if(dragSource) e.preventDefault(); });
      container.addEventListener('drop', (e)=>{
        if(!dragSource) return;
        e.preventDefault();
        const {side, idx} = dragSource;
        const toSide = containerSideOf(container);
        const toIdx = indexInContainerAt(container, e.clientX, e.clientY);
        endDrag();
        moveStationCrossLane(id, side, idx, toSide, toIdx);
      });
    });
  }
  
  function moveStationCrossLane(id, fromSide, fromIdx, toSide, toIdx){
    const ed = ensureEdited(id);
    const fromArr = slotsArrayFor(ed, fromSide);
    const toArr = slotsArrayFor(ed, toSide);
    if(fromSide===toSide){
      if(fromIdx===toIdx || fromIdx+1===toIdx) return;
      const [item] = fromArr.splice(fromIdx,1);
      let insertAt = toIdx;
      if(fromIdx < toIdx) insertAt -= 1;
      fromArr.splice(insertAt,0,item);
    }else{
      if(toArr.length>=MAX_SLOTS){ showToast('ปลายทางเต็ม (สูงสุด ' + MAX_SLOTS + ' ช่อง)'); return; }
      const [item] = fromArr.splice(fromIdx,1);
      toArr.splice(Math.min(toIdx, toArr.length),0,item);
    }
    syncStationsToSteps(id);
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  
  function setupStepsDnD(id){
    const body = document.getElementById('stepsBody');
    if(!body) return;
    let dragIdx = null;
    body.querySelectorAll('tr').forEach(tr=>{
      tr.addEventListener('dragstart', (e)=>{
        dragIdx = parseInt(tr.dataset.stepidx);
        try{ e.dataTransfer.setData('text/plain', 'step'); }catch(err){}
        e.dataTransfer.effectAllowed = 'move';
        tr.classList.add('dragging');
      });
      tr.addEventListener('dragend', ()=> tr.classList.remove('dragging'));
    });
    body.addEventListener('dragover', (e)=>{ if(dragIdx!==null) e.preventDefault(); });
    body.addEventListener('drop', (e)=>{
      if(dragIdx===null) return;
      e.preventDefault();
      const rows = Array.from(body.querySelectorAll('tr'));
      let targetIdx = rows.length;
      for(let i=0;i<rows.length;i++){
        const r = rows[i].getBoundingClientRect();
        if(e.clientY < r.top + r.height/2){ targetIdx = i; break; }
      }
      const ed = ensureEdited(id);
      ed.steps = computeSteps(ed); // ให้ index ตรงกับแถวที่แสดง (ยุบรวมแล้ว)
      const [item] = ed.steps.splice(dragIdx,1);
      let insertAt = targetIdx;
      if(dragIdx < targetIdx) insertAt -= 1;
      ed.steps.splice(insertAt,0,item);
      ed.steps.forEach((s,i)=> s.order = i+1);
      dragIdx = null;
      persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
    });
  }
  
  function setupDragging(id){
    const stage = document.getElementById('beltStage');
    const overlay = document.getElementById('beltOverlay');
    if(!stage || !overlay) return;

    // ลากอ้างอิงกรอบของ overlay ซึ่งตอนนี้เท่ากับกล่องรางสายพานจริงเป๊ะ
    // (เดิมอ้างอิง beltStage ที่กว้างกว่าราง ทำให้ไม้กั้นฝั่งขวาเยื้องไม่สมดุล)
    stage.querySelectorAll('.ov-bar').forEach(el=>{
      el.addEventListener('mousedown', (e)=> startDrag(e, id, 'bar', parseInt(el.dataset.bar), overlay));
      el.addEventListener('touchstart', (e)=> startDrag(e, id, 'bar', parseInt(el.dataset.bar), overlay), {passive:false});
    });
    stage.querySelectorAll('.arrow-body').forEach(el=>{
      el.addEventListener('mousedown', (e)=> startDrag(e, id, 'arrow', parseInt(el.dataset.arrowdrag), overlay));
      el.addEventListener('touchstart', (e)=> startDrag(e, id, 'arrow', parseInt(el.dataset.arrowdrag), overlay), {passive:false});
    });
    // ลากได้เฉพาะแถบหัวกล่อง ไม่งั้น preventDefault จะทำให้คลิกเข้าช่องกรอกในกล่องไม่ได้
    stage.querySelectorAll('.machine-head').forEach(el=>{
      el.addEventListener('mousedown', (e)=> startMachineDrag(e, id, parseInt(el.dataset.machinedrag), overlay));
      el.addEventListener('touchstart', (e)=> startMachineDrag(e, id, parseInt(el.dataset.machinedrag), overlay), {passive:false});
    });
  }
  
  // ขอบบนของแต่ละช่องสถานี (หน่วย px ในราง) ใช้เป็นจุดล็อกแนวตั้งของเครื่องจักร
  // เอาจากแถวจริงในเลนที่ยาวกว่า แล้วต่อระยะเดิมลงไปจนครบ MAX_SLOTS จะได้วางต่ำกว่าสถานีสุดท้ายได้
  function machineRowTops(){
    const pick = (s)=> Array.from(document.querySelectorAll('#beltStage ' + s + ' .station-row'));
    const L = pick('.lane-left'), R = pick('.lane-right');
    const rows = L.length >= R.length ? L : R;
    const cs = getComputedStyle(document.documentElement);
    const gap = parseFloat(cs.getPropertyValue('--station-gap')) || 0;
    const sh = parseFloat(cs.getPropertyValue('--station-h')) || 84;
    let tops, pitch;
    if(rows.length){
      tops = rows.map(r => r.offsetTop);
      pitch = rows.length > 1 ? (tops[tops.length-1] - tops[0]) / (rows.length - 1) : rows[0].offsetHeight + gap;
    }else{
      const t = document.querySelector('#beltStage .lane-title');
      tops = [t ? t.offsetTop + t.offsetHeight + (parseFloat(getComputedStyle(t).marginBottom) || 0) : 0];
      pitch = sh + gap;
    }
    while(tops.length < MAX_SLOTS) tops.push(tops[tops.length-1] + pitch);
    return tops;
  }
  function nearestOf(list, v){
    return list.reduce((best, x)=> Math.abs(x - v) < Math.abs(best - v) ? x : best, list[0]);
  }
  // ลากเครื่องจักรแล้วกล่องกระโดดเป็นบล็อก: แนวตั้งล็อกกับขอบบนช่องสถานี แนวนอนล็อก 3 คอลัมน์
  // ระหว่างลากแก้แค่ style ของกล่องเดิม ไม่วาด DOM ใหม่ (วาดใหม่แล้ว touch บนมือถือหลุด)
  function startMachineDrag(e, id, idx, ref){
    if(e.target.closest('.ov-x')) return;
    e.preventDefault(); e.stopPropagation();
    const item = ref.querySelector('.ov-machine[data-machine="' + idx + '"]');
    if(!item) return;
    const rect = ref.getBoundingClientRect();
    const W = ref.offsetWidth || 1, H = ref.offsetHeight || 1;
    const scale = rect.width / W || 1; // ซูมราง: ระยะบนจอ ÷ scale = ระยะในเลย์เอาต์
    const start = {left: item.offsetLeft, top: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight};
    // ไม่ให้ล้นใต้ราง — ถ้าสถานีน้อยจนไม่มีช่องไหนพอดี ใช้ช่องบนสุด
    const allTops = machineRowTops();
    const fit = allTops.filter(t => t + start.h <= H + 2);
    const tops = fit.length ? fit : [allTops[0]];
    const others = Array.from(ref.querySelectorAll('.ov-machine')).filter(el => el !== item)
      .map(el => ({col: nearestMachineCol(el.offsetLeft / W * 100), top: el.offsetTop}));
    const sx = e.touches ? e.touches[0].clientX : e.clientX;
    const sy = e.touches ? e.touches[0].clientY : e.clientY;
    let moved = false;
    function onMove(ev){
      if(ev.cancelable) ev.preventDefault();
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dx = (cx - sx) / scale, dy = (cy - sy) / scale;
      if(Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      const m = ensureEdited(id).belt.machines[idx]; if(!m) return;
      const col = nearestMachineCol((start.left + dx) / W * 100);
      const top = Math.round(nearestOf(tops, start.top + dy));
      // บล็อกที่มีเครื่องอื่นอยู่แล้วห้ามวางทับ — ค้างไว้ที่ตำแหน่งล่าสุดที่ว่าง
      if(others.some(o => o.col === col && Math.abs(o.top - top) < start.h - 2)) return;
      m.leftPct = col;
      m.topPx = top; m.top = m.topPx / H * 100;
      delete m.wPct; delete m.hPx; // ค่าจากช่วงที่ปรับขนาดอิสระได้ ไม่ใช้แล้ว
      item.style.left = m.leftPct + '%'; item.style.top = m.topPx + 'px';
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if(!moved) return;
      syncStationsToSteps(id); // ลำดับเครื่องจักรในตารางขึ้นกับตำแหน่ง
      persist(id);
      renderDetail(id);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, {passive:false});
    document.addEventListener('touchend', onUp);
  }
  function startDrag(e, id, kind, idx, ref){
    if(e.target.closest('.ov-x')) return;
    e.preventDefault();
    const rect = ref.getBoundingClientRect();
    const layoutH = ref.offsetHeight || rect.height || 1; // ความสูงก่อนซูม ใช้เป็นหน่วยของ topPx
    const item = e.target.closest('.ov-bar, .ov-arrow, .ov-machine');
    const itemH = item ? item.offsetHeight : 8;
    let moved = false;
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startY = e.touches ? e.touches[0].clientY : e.clientY;

    function onMove(ev){
      // กันหน้าจอเลื่อน/แพนระหว่างลากบนมือถือ (touchmove ผูกแบบ passive:false ไว้แล้ว)
      if(ev.cancelable) ev.preventDefault();
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      if(Math.abs(cx-startX) + Math.abs(cy-startY) > 4) moved = true;
      // rect ถูกซูมแล้ว แต่ topPx เป็นหน่วยก่อนซูม จึงเทียบเป็นอัตราส่วนก่อนคูณความสูงจริง
      const ratio = rect.height ? (cy - rect.top) / rect.height : 0;
      const py = Math.max(0, Math.min(Math.max(0, layoutH - itemH), ratio * layoutH));
      const setPos = (o)=>{ o.topPx = Math.round(py); o.top = layoutH ? (py / layoutH) * 100 : 0; };
      const ed = ensureEdited(id);
      if(kind==='bar'){
        const b = ed.belt.bars[idx]; if(!b) return;
        setPos(b);
        b.side = (cx - rect.left) < rect.width/2 ? 'left' : 'right';
        if(item){
          if(b.side === 'left'){ item.style.left = '8px'; item.style.right = ''; }
          else { item.style.right = '8px'; item.style.left = ''; }
        }
      } else if(kind==='machine'){
        const m = ed.belt.machines[idx]; if(!m) return;
        setPos(m);
      } else {
        const a = ed.belt.arrows[idx]; if(!a) return;
        setPos(a);
      }
      if(item) item.style.top = Math.round(py) + 'px';
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if(!moved && kind==='arrow'){
        const ed = ensureEdited(id); const a = ed.belt.arrows[idx];
        if(a) a.dir = a.dir==='left' ? 'right' : 'left';
      }
      if(moved || kind==='arrow'){ persist(id); }
      renderDetail(id);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, {passive:false});
    document.addEventListener('touchend', onUp);
  }
  
  
  // ตารางกระบวนการยุบรวมมาจากสถานีบนสายพานแล้ว การ "เพิ่มขั้นตอน" = เพิ่มสถานีฝั่งซ้าย
  // (พิมพ์ชื่อกิจกรรมที่สถานีนั้น เดี๋ยวจะโผล่เป็นแถวในตารางเอง)
  function addStepRow(id){ addSlot(id, 'left'); }
  function saveCurrent(id){ ensureEdited(id); persist(id); renderSidebar(document.getElementById('searchBox').value); renderDetail(id); }
  function openModal(src){ document.getElementById('modalImg').src = src; document.getElementById('modalBg').classList.add('open'); }
  
  // กดปุ่มคัดลอกซ้ำที่สถานีเดิม = เอาออกจากคลิปบอร์ด เลือกสะสมหลายสถานีแล้ววางทีเดียวได้
  function toggleCopyStation(id, side, idx){
    // อ่านจากข้อมูลที่แสดงอยู่ ไม่ใช้ ensureEdited จะได้ไม่ไปแตะสถานะ "แก้ไขแล้ว" ของเมนูต้นทาง
    const belt = getBelt(getItem(id));
    const arr = side==='left' ? belt.leftSlots : side==='right' ? belt.rightSlots : belt.headSlots;
    const src = (arr || [])[idx];
    if(!src) return;
    const key = id + '|' + side + ':' + idx;
    const list = readStationClip();
    const at = list.findIndex(c => c && c.__src === key);
    if(at >= 0){
      list.splice(at, 1);
      if(!writeStationClip(list)) return;
      showToast(list.length ? ('เอาออกแล้ว เหลือคัดลอกไว้ ' + list.length + ' สถานี') : 'ล้างคลิปบอร์ดแล้ว');
    }else{
      const clip = JSON.parse(JSON.stringify(src));
      delete clip.id;
      clip.__src = key; // ไว้เช็คว่าสถานีนี้ถูกเลือกอยู่หรือยัง (ตัดทิ้งตอนวาง)
      list.push(clip);
      if(!writeStationClip(list)) return;
      showToast('คัดลอกไว้ ' + list.length + ' สถานี — เปิดเมนูที่ต้องการแล้วกดปุ่ม "วาง"');
    }
    renderDetail(id);
  }
  function clearStationClip(id){
    writeStationClip([]);
    showToast('ล้างคลิปบอร์ดแล้ว');
    renderDetail(id);
  }
  function pasteStation(id, side){
    const list = readStationClip();
    if(!list.length) return;
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    const room = MAX_SLOTS - arr.length;
    if(room <= 0){ showToast('สูงสุด ' + MAX_SLOTS + ' ช่อง'); return; }
    const put = list.slice(0, room);
    put.forEach(c=>{
      const copy = JSON.parse(JSON.stringify(c));
      delete copy.__src;
      copy.id = uid();
      arr.push(copy);
    });
    syncStationsToSteps(id);
    persist(id, put.length < list.length
      ? ('วางได้ ' + put.length + ' สถานี — เลนนี้เต็ม ' + MAX_SLOTS + ' ช่องแล้ว')
      : ('วาง ' + (put.length === 1 ? ('สถานี "' + clipName(put[0]) + '"') : (put.length + ' สถานี')) + ' แล้ว'));
    renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function copyWholeBelt(id){
    const it = getItem(id);
    if(!it) return;
    const belt = getBelt(it);
    const payload = { from: ((it.clean_title || it.title || '').trim() || 'ไม่มีชื่อ'), belt: {},
                      belt_speed: (it.summary && it.summary.belt_speed) || '' };
    BELT_PARTS.forEach(k => { payload.belt[k] = JSON.parse(JSON.stringify((belt[k] || []).filter(Boolean))); });
    if(typeof belt.rowGap === 'number') payload.rowGap = belt.rowGap;
    try{ window.localStorage.setItem(BELT_CLIP_KEY, JSON.stringify(payload)); }
    catch(e){ showToast('คัดลอกไม่สำเร็จ (พื้นที่เก็บในเครื่องเต็ม — สายพานนี้มีรูปเยอะเกินไป)'); return; }
    showToast('คัดลอกสายพานจาก "' + payload.from + '" แล้ว (' + beltClipCount(payload) + ' สถานี) — เปิดเมนูปลายทางแล้วกด "วางทั้งสายพาน"');
    renderDetail(id);
  }
  function pasteWholeBelt(id){
    const clip = readBeltClip();
    if(!clip || !clip.belt) return;
    const cur = getBelt(getItem(id));
    const had = BELT_PARTS.reduce((n,k)=> n + (cur[k]||[]).length, 0);
    // วางทั้งสายพาน = ทับของเดิมทั้งหมด ถามก่อนถ้าเมนูนี้มีของอยู่แล้ว
    if(had && !window.confirm('วางสายพานจาก "' + clip.from + '" ทับของเดิมในเมนูนี้? สถานี ไม้กั้น ลูกศร และเครื่องจักรทั้งหมดที่มีอยู่จะถูกแทนที่')) return;
    const ed = ensureEdited(id);
    const fresh = JSON.parse(JSON.stringify(clip.belt));
    BELT_PARTS.forEach(k=>{
      ed.belt[k] = (fresh[k] || []).filter(Boolean);
      ed.belt[k].forEach(x=>{ x.id = uid(); }); // สุ่ม id ใหม่ ไม่ให้ชนกับเมนูต้นทาง
    });
    if(typeof clip.rowGap === 'number') ed.belt.rowGap = clip.rowGap; else delete ed.belt.rowGap;
    if(clip.belt_speed) ed.summary.belt_speed = clip.belt_speed;
    syncStationsToSteps(id);
    persist(id, 'วางสายพานจาก "' + clip.from + '" แล้ว');
    renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function clearBeltClip(id){
    try{ window.localStorage.removeItem(BELT_CLIP_KEY); }catch(e){}
    showToast('ล้างสายพานที่คัดลอกไว้แล้ว');
    renderDetail(id);
  }
  function addSlot(id, side){
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    if(arr.length>=MAX_SLOTS){ showToast('สูงสุด ' + MAX_SLOTS + ' ช่อง'); return; }
    arr.push({id:uid(), type:'person', label:'', img:null, blank:false, people:'', rate:''});
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function removeSlot(id, side, idx, okMsg){
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    arr.splice(idx,1);
    syncStationsToSteps(id);
    persist(id, okMsg); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function moveSlot(id, side, idx, dir){
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    const j = idx+dir; if(j<0||j>=arr.length) return;
    [arr[idx],arr[j]] = [arr[j],arr[idx]]; persist(id); renderDetail(id);
  }
  function swapSlotSide(id, side, idx){
    if(side==='head'){ showToast('ย้ายจากแถวหัวสายพานได้เฉพาะ ลบ/แก้ไข'); return; }
    const ed = ensureEdited(id);
    const from = slotsArrayFor(ed, side);
    const to = slotsArrayFor(ed, side==='left'?'right':'left');
    if(to.length>=MAX_SLOTS){ showToast('ฝั่งตรงข้ามเต็ม (' + MAX_SLOTS + ' ช่อง)'); return; }
    const [item] = from.splice(idx,1); to.push(item);
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function clearSlotImage(id, side, idx){
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    arr[idx].type='person'; arr[idx].img=null; arr[idx].imgView=null; persist(id); renderDetail(id);
  }
  function fileToResizedDataURL(file, maxW){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = (e)=>{
        const img = new Image();
        img.onload = ()=>{
          let w = img.width, h = img.height;
          if(w>maxW){ h = Math.round(h*maxW/w); w = maxW; }
          const canvas = document.createElement('canvas');
          canvas.width=w; canvas.height=h;
          canvas.getContext('2d').drawImage(img,0,0,w,h);
          resolve(canvas.toDataURL('image/jpeg',0.75));
        };
        img.onerror = reject; img.src = e.target.result;
      };
      reader.onerror = reject; reader.readAsDataURL(file);
    });
  }
  async function handleUploadedFile(file){
    if(!file || !pendingUpload) return;
    const {id, side, idx} = pendingUpload;
    try{
      const dataUrl = await fileToResizedDataURL(file, 240);
      const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
      arr[idx].type='image'; arr[idx].img = dataUrl; arr[idx].imgView = null;
      persist(id); renderDetail(id);
    }catch(err){ showToast('อัปโหลดรูปไม่สำเร็จ'); }
    pendingUpload = null;
  }
  document.getElementById('hiddenFileInput').addEventListener('change', (e)=>{ const f=e.target.files[0]; e.target.value=''; handleUploadedFile(f); });
  document.getElementById('hiddenGalleryFileInput').addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if(!files.length || !pendingGalleryTarget) return;
    const id = pendingGalleryTarget;
    const ed = ensureEdited(id);
    if(!ed.images) ed.images = [];
    for(const file of files){
      try{
        const dataUrl = await fileToResizedDataURL(file, 260);
        ed.images.push(dataUrl.split(',')[1]);
      }catch(err){}
    }
    pendingGalleryTarget = null;
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
    showToast('เพิ่มรูปแล้ว ' + files.length + ' รูป');
  });
  
  /* ---- เลือกส่วนของรูปที่จะแสดงในช่อง (ไม่แก้ไฟล์รูป) ---- */
  let pendingView = null;
  const view = {cx:0.5, cy:0.5, z:1, ab:1};
  function viewEls(){
    return {
      img: document.getElementById('viewImg'), box: document.getElementById('viewBox'),
      prev: document.getElementById('viewPreview'), prevImg: document.getElementById('viewPreviewImg'),
      zoom: document.getElementById('viewZoom'), zoomLbl: document.getElementById('viewZoomLabel'),
    };
  }
  // สัดส่วนกรอบบนรูป (0..1) = ส่วนที่จะมองเห็นในช่อง
  function viewFrame(){
    const {img} = viewEls();
    const r = viewRect(view.cx, view.cy, view.z, img.naturalWidth / img.naturalHeight, view.ab);
    return {x: -r.l / r.w, y: -r.t / r.h, w: 100 / r.w, h: 100 / r.h};
  }
  // บีบจุดกลางไม่ให้กรอบล้นขอบรูป — ลากต่อไปทางขอบแล้วกรอบไม่ค้างที่ค่าที่มองไม่เห็นผล
  function clampView(){
    const f = viewFrame();
    view.cx = Math.min(1 - f.w / 2, Math.max(f.w / 2, view.cx));
    view.cy = Math.min(1 - f.h / 2, Math.max(f.h / 2, view.cy));
  }
  function drawView(){
    const {img, box, prev, prevImg, zoom, zoomLbl} = viewEls();
    if(!img.naturalWidth || !img.clientWidth) return;
    clampView();
    const f = viewFrame(), W = img.clientWidth, H = img.clientHeight;
    box.style.left = (f.x * W) + 'px'; box.style.top = (f.y * H) + 'px';
    box.style.width = (f.w * W) + 'px'; box.style.height = (f.h * H) + 'px';
    placeViewImg(prevImg, prev, view.cx, view.cy, view.z);
    zoom.value = String(Math.round(view.z * 100));
    zoomLbl.textContent = Math.round(view.z * 100) + '%';
  }
  function openViewModal(id, side, idx, cell){
    const belt = getBelt(getItem(id));
    const arr = side==='left' ? belt.leftSlots : side==='right' ? belt.rightSlots : side==='machine' ? belt.machines : belt.headSlots;
    const slot = (arr || [])[idx];
    if(!slot || !slot.img) return;
    pendingView = {id, side, idx};
    const v = slot.imgView || {};
    view.cx = isFinite(Number(v.cx)) && v.cx !== null && v.cx !== undefined ? Number(v.cx) : 0.5;
    view.cy = isFinite(Number(v.cy)) && v.cy !== null && v.cy !== undefined ? Number(v.cy) : 0.5;
    view.z = Number(v.z) > 0 ? Number(v.z) : 1;
    // ตัวอย่างใช้สัดส่วนเดียวกับช่องที่กดมา (ช่องสถานี หัวไลน์ และเครื่องจักร กว้าง-สูงไม่เท่ากัน)
    view.ab = (cell && cell.clientWidth && cell.clientHeight) ? cell.clientWidth / cell.clientHeight : 96 / 84;
    const {img, prev, prevImg} = viewEls();
    const pw = view.ab >= 1 ? 180 : Math.round(180 * view.ab);
    prev.style.width = pw + 'px'; prev.style.height = Math.round(pw / view.ab) + 'px';
    // เปิดกล่องก่อนตั้ง src — ตอนกล่องยังซ่อน รูปมีขนาดแสดงเป็น 0 วางกรอบไม่ได้
    document.getElementById('viewModal').classList.add('open');
    img.onload = () => { img.classList.toggle('tall', img.naturalHeight > img.naturalWidth); drawView(); };
    prevImg.onload = () => drawView();
    img.src = slot.img; prevImg.src = slot.img;
    if(img.complete) requestAnimationFrame(()=> img.onload());
  }
  function closeViewModal(){
    document.getElementById('viewModal').classList.remove('open');
    pendingView = null;
  }
  (function setupViewPicker(){
    const stage = document.getElementById('viewStage');
    let drag = null;
    // ใช้ pointer events + setPointerCapture ให้ลากได้ทั้งเมาส์และนิ้ว และไม่วาด DOM ใหม่ระหว่างลาก
    // จิ้มนอกกรอบ = ย้ายกรอบไปที่จุดนั้นทันที (บนมือถือกรอบเล็ก จับให้โดนยาก)
    stage.addEventListener('pointerdown', (e)=>{
      const {img} = viewEls();
      if(!img.clientWidth) return;
      e.preventDefault();
      const rect = img.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width, py = (e.clientY - rect.top) / rect.height;
      const f = viewFrame();
      if(!(px >= f.x && px <= f.x + f.w && py >= f.y && py <= f.y + f.h)){
        view.cx = px; view.cy = py; drawView();
      }
      drag = {sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy, W: rect.width, H: rect.height};
      try{ stage.setPointerCapture(e.pointerId); }catch(err){}
    });
    stage.addEventListener('pointermove', (e)=>{
      if(!drag) return;
      view.cx = drag.cx + (e.clientX - drag.sx) / drag.W;
      view.cy = drag.cy + (e.clientY - drag.sy) / drag.H;
      drawView();
    });
    const end = ()=>{ drag = null; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    document.getElementById('viewZoom').addEventListener('input', (e)=>{
      view.z = Math.max(1, (parseFloat(e.target.value) || 100) / 100);
      drawView();
    });
  })();
  document.getElementById('viewResetBtn').onclick = () => { view.cx = 0.5; view.cy = 0.5; view.z = 1; drawView(); };
  document.getElementById('viewCancelBtn').onclick = () => closeViewModal();
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && document.getElementById('viewModal').classList.contains('open')) closeViewModal();
  });
  document.getElementById('viewApplyBtn').onclick = () => {
    if(!pendingView) return;
    const {id, side, idx} = pendingView;
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    closeViewModal();
    if(!arr || !arr[idx]) return;
    const isDefault = view.z === 1 && Math.abs(view.cx - 0.5) < 0.001 && Math.abs(view.cy - 0.5) < 0.001;
    arr[idx].imgView = isDefault ? null
      : {cx: Math.round(view.cx * 1000) / 1000, cy: Math.round(view.cy * 1000) / 1000, z: Math.round(view.z * 100) / 100};
    persist(id, 'บันทึกตำแหน่งรูปแล้ว'); renderDetail(id);
  };

  function addBar(id){
    const h = beltLayoutHeight();
    const ed = ensureEdited(id); ed.belt.bars.push({id:uid(), top:40, topPx: h ? Math.round(h*0.4) : undefined, side:'left'});
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function removeBar(id, idx){
    const ed = ensureEdited(id); ed.belt.bars.splice(idx,1);
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function addMachine(id){
    const h = beltLayoutHeight();
    const ed = ensureEdited(id);
    // เครื่องใหม่หาบล็อกว่างให้เอง: เริ่มจากแถวกลางราง ไล่ออกไปทีละแถว แต่ละแถวลอง กลาง → ซ้าย → ขวา
    const cs = getComputedStyle(document.documentElement);
    const mh = (parseFloat(cs.getPropertyValue('--station-h')) || 84) * 2 + (parseFloat(cs.getPropertyValue('--station-gap')) || 0);
    const target = h ? h*0.4 : 0;
    const tops = machineRowTops().slice().sort((x, y)=> Math.abs(x - target) - Math.abs(y - target));
    const order = [MACHINE_COLS[1], MACHINE_COLS[0], MACHINE_COLS[2]];
    const existing = (ed.belt.machines || []).filter(m => m && typeof m.topPx === 'number');
    let topPx = h ? tops[0] : undefined, leftPct = order[0];
    outer: for(const t of tops){
      for(const c of order){
        if(!existing.some(m => machineBox(m).left === c && Math.abs(m.topPx - t) < mh - 2)){ topPx = t; leftPct = c; break outer; }
      }
    }
    ed.belt.machines.push({id:uid(), top: h && topPx !== undefined ? topPx / h * 100 : 40, topPx, leftPct, name:'', people:'', rate:'', type:'person', img:null});
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function removeMachine(id, idx){
    const ed = ensureEdited(id); ed.belt.machines.splice(idx,1);
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function addArrow(id){
    const h = beltLayoutHeight();
    const ed = ensureEdited(id); ed.belt.arrows.push({id:uid(), top:45, topPx: h ? Math.round(h*0.45) : undefined, dir:'left'});
    persist(id); renderDetail(id);
  }
  function removeArrow(id, idx){
    const ed = ensureEdited(id); ed.belt.arrows.splice(idx,1);
    persist(id); renderDetail(id);
  }
  
  document.getElementById('modalBg').onclick = ()=> document.getElementById('modalBg').classList.remove('open');
  
  function renderAll(){
    renderCatChips(); renderSidebar(document.getElementById('searchBox').value);
    if(currentId) renderDetail(currentId); else renderOverview();
  }
  window.addEventListener('resize', ()=>{ applyBeltZoom(); applyImgViews(document.getElementById('main')); });
  document.getElementById('searchBox').addEventListener('input', (e)=> renderSidebar(e.target.value));
  document.getElementById('overviewBtn').onclick = ()=>{ currentId=null; renderAll(); };
  document.getElementById('addCatBtn').onclick = () => {
    const input = document.getElementById('newCatInput'); const name = input.value.trim();
    if(!name) return;
    if(!CATEGORIES.includes(name)){ CATEGORIES.push(name); persistCategories(); }
    input.value=''; renderCatChips(); showToast('เพิ่มหมวดหมู่ "' + name + '" แล้ว');
  };
  document.getElementById('addMenuBtn').onclick = async () => {
    const name = window.prompt('ชื่อเมนูใหม่:');
    if(!name || !name.trim()) return;
    const id = 'custom-' + Date.now();
    const newItem = {
      id, title: name.trim(), clean_title: name.trim(), code: null,
      steps: [], summary: {belt_speed:'', rate:''},
      images: [], category: '', custom: true, mode: 'custom',
      belt: {headSlots:[], leftSlots:[], rightSlots:[], bars:[], arrows:[]}
    };
    CUSTOM_ITEMS.push(newItem);
    await persistCustomIndex();
    await storage.set('item:' + id, JSON.stringify(newItem), true);
    currentId = id; renderAll();
    showToast('เพิ่มเมนู "' + name.trim() + '" แล้ว');
  };
  
  async function runCategoryMigration_v1(){
    const FLAG_KEY = 'category_migration_v1_done';
    try{
      const flag = await storage.get(FLAG_KEY, true);
      if(flag && flag.value === 'true') return;
    }catch(e){}
  
    const NEW_CATEGORIES = ['FFS 2','Top seal 1 หลุม','Top seal 2 หลุม','Banding','FFS 1','Top seal ข้าวเหนียว'];
    const MAPPING = {
      '1.ข้าวสวย':'FFS 2', '1.ข้าวสวย เก่า':'FFS 2', '1.ข้าวสวย ใหม่':'FFS 2',
      '2.ข้าวไรซ์':'FFS 2',
      '3.ข้าวกล้อง':'FFS 2',
      '4.ข้าวสวย 280 g':'Top seal 1 หลุม',
      '5.ข้าวผัดปู':'Top seal 1 หลุม', '5.ข้าวผัดปู (2)':'Top seal 1 หลุม',
      '6.ข้าวหมกไก่':'Top seal 1 หลุม',
      '7.ข้าวผัดคะน้ากุ้ง':'Top seal 1 หลุม', '7.ข้าวผัดคะน้ากุ้ง (2)':'Top seal 1 หลุม',
      '8.ข้าวกะเพราหมู':'Top seal 2 หลุม', '8.ข้าวกะเพราหมู New':'Top seal 2 หลุม',
      '9.ข้าวกะเพราไก่ไข่ดาว':'Top seal 2 หลุม',
      '10.ข้าวไข่เจียวกุ้ง':'Top seal 2 หลุม',
      '11.ข้าวปลาผัดพริก':'Top seal 2 หลุม',
      '12.ข้าวพะแนงหมูไข่เจียว':'Top seal 2 หลุม',
      '13.ข้าวคั่วกลิ้งหมูไข่เจียว':'Top seal 2 หลุม',
      '14.ข้าวคะน้าฮ่องกงหมูนุ่ม':'Top seal 2 หลุม',
      '15.ข้าวผัดหมู':'Banding', 'ข้าวผัดหมู Rate 1200':'Banding', 'ข้าวผัดหมู Rate 1000':'Banding',
      '16.ข้าวไก่กระเทียม':'Banding',
      '17.ข้าวกะเพราไก่คั่ว':'Banding',
      '18.ข้าวไก่ทอด':'Banding',
      '19.ข้าวกะเพราทะเล':'FFS 1',
      '20.ข้าวเหนียวหมูทอด':'Top seal ข้าวเหนียว',
      '21.ข้าวเหนียวไก่ทอด':'Top seal ข้าวเหนียว',
      '22.ข้าวเหนียวชาววัง':'Top seal ข้าวเหนียว',
      '23.โจ๊ก':'FFS 1',
      '24.แกงจืด':'FFS 1',
      '25. ราดหน้า':'Banding',
      '26. บะหมี่หมูแดง':'Banding',
      '27. ข้าวซอย':'Banding',
      '28.ผัดอิ้วหมู':'Top seal 1 หลุม', '28.ผัดอิ้วหมู (2)':'Top seal 1 หลุม',
      '29.มักกะโรนี':'FFS 1',
      '30.สปาเก็ตตี้เส้นดำ':'FFS 1',
      '31.เย็นตาโฟ':'Banding',
      '32.ก๋วยเตี๋ยวคั่วกุ้ง':'Top seal 1 หลุม',
      '33.บะหมี่ต้มยำทะเล':'Banding',
      '34.ขนมจีน':'Banding',
    };
  
    CATEGORIES = NEW_CATEGORIES.slice();
    await persistCategories();
  
    for(const base of allItems()){
      const cat = MAPPING[base.id] || '';
      const ed = ensureEdited(base.id);
      ed.category = cat;
      try{ await storage.set('item:' + base.id, JSON.stringify(ed), true); }catch(e){}
    }
    try{ await storage.set(FLAG_KEY, 'true', true); }catch(e){}
  }
  
  await loadAllEdits();
    await runCategoryMigration_v1();
    renderAll();
  
}
