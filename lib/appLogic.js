import { storage } from './kvStore';

let STATIC_ITEMS = [];


export async function initApp(){
  const RAW = await fetch('/data/payload.json').then(r => r.json());
  STATIC_ITEMS = RAW.items.map(it => ({...it, category: it.category || '', custom:false}));

  let CUSTOM_ITEMS = [];
  let CATEGORIES = [];
  let DELETED_IDS = new Set();
  let edited = {};
  let currentId = null;
  let currentCategoryFilter = null;
  let pendingUpload = null;
  let galleryDragData = null;
  let pendingGalleryTarget = null;
  
  function uid(){ return 'x' + Math.random().toString(36).slice(2,10); }
  function allItems(){ return STATIC_ITEMS.concat(CUSTOM_ITEMS).filter(it => !DELETED_IDS.has(it.id)); }
  function getItem(id){ if(edited[id]) return edited[id]; return allItems().find(i => i.id === id); }
  function isEdited(id){ return !!edited[id]; }
  
  function ensureEdited(id){
    if(!edited[id]){
      const base = allItems().find(i => i.id === id);
      edited[id] = JSON.parse(JSON.stringify(base));
    }
    if(!edited[id].belt) edited[id].belt = {headSlots:[], leftSlots:[], rightSlots:[], bars:[], arrows:[]};
    if(!edited[id].belt.arrows) edited[id].belt.arrows = [];
    if(!edited[id].belt.headSlots) edited[id].belt.headSlots = [];
    if(!edited[id].summary) edited[id].summary = {};
    return edited[id];
  }
  function getBelt(it){
    const b = it.belt || {headSlots:[], leftSlots:[], rightSlots:[], bars:[], arrows:[]};
    if(!b.arrows) b.arrows=[];
    if(!b.headSlots) b.headSlots=[];
    return b;
  }
  function slotsArrayFor(ed, side){
    if(side==='left') return ed.belt.leftSlots;
    if(side==='right') return ed.belt.rightSlots;
    return ed.belt.headSlots;
  }
  function syncStationsToSteps(id){
    const ed = ensureEdited(id);
    const maxLen = Math.max(ed.belt.leftSlots.length, ed.belt.rightSlots.length);
    for(let i=0;i<maxLen;i++){
      const l = ed.belt.leftSlots[i];
      const r = ed.belt.rightSlots[i];
      if((l && l.blank) && (r && r.blank)) continue;
      const label = (l && l.label) || (r && r.label) || '';
      const people = (l && l.people) || (r && r.people) || '';
      const rate = (l && l.rate) || (r && r.rate) || '';
      if(!label && !people && !rate) continue;
      if(!ed.steps[i]) ed.steps[i] = {order:i+1, process:'', people:'', position:'', rate:''};
      ed.steps[i].process = label;
      ed.steps[i].people = people;
      ed.steps[i].rate = rate;
      ed.steps[i].order = i+1;
    }
    ed.steps.forEach((s,i)=>{ s.order = i+1; });
  }
  function syncStepRateToStations(id, idx, rateValue){
    const ed = ensureEdited(id);
    if(ed.belt.leftSlots[idx]) ed.belt.leftSlots[idx].rate = rateValue;
    if(ed.belt.rightSlots[idx]) ed.belt.rightSlots[idx].rate = rateValue;
  }
  
  function sumPeople(steps){
    let total = 0, any = false;
    (steps||[]).forEach(s => { const n = parseFloat(s.people); if(!isNaN(n)){ total += n; any = true; } });
    return any ? total : '';
  }
  function minStationRate(belt){
    let vals = [];
    ['leftSlots','rightSlots','headSlots'].forEach(key=>{
      (belt[key]||[]).forEach(s=>{
        if(s.blank) return;
        const n = parseFloat(s.rate);
        if(!isNaN(n)) vals.push(n);
      });
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
          try{ const rr = await storage.get('item:' + id, true); if(rr && rr.value) CUSTOM_ITEMS.push(JSON.parse(rr.value)); }catch(e){}
        }
      }
    }catch(e){}
    try{
      const res = await storage.list('item:', true);
      if(res && res.keys){
        for(const k of res.keys){
          try{ const r = await storage.get(k, true); if(r && r.value){ const val = JSON.parse(r.value); edited[val.id] = val; } }catch(e){}
        }
      }
    }catch(e){}
  }
  async function persist(id){
    const data = edited[id] || getItem(id);
    try{ await storage.set('item:' + id, JSON.stringify(data), true); showToast('บันทึกแล้ว'); }
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
          <span>👥 ${fmtPeople(sumPeople(it.steps))} คน</span>
          <span>⚡ ${fmtPeople(it.summary.belt_speed)} Hz</span>
          <span>▮ ${belt.bars.length} ไม้กั้น</span>
          <span>⏱ ${minStationRate(belt)===''?'—':minStationRate(belt)} pc/hr</span>
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
        <td class="num">${fmtPeople(sumPeople(it.steps))}</td>
        <td class="num">${fmtPeople(it.summary.belt_speed)}</td>
        <td class="num">${belt.bars.length}</td>
        <td class="num">${minStationRate(belt)===''?'—':minStationRate(belt)}</td>
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
  function stationCellHtml(side, idx, s){
    const inner = (s.type==='image' && s.img)
      ? `<img src="${s.img}"><button class="clear-img" data-clearimg="${side}:${idx}" title="ล้างรูป">✕</button>`
      : `<span class="hint">＋</span>`;
    return `<div class="station-cell" data-cellupload="${side}:${idx}">${inner}<button class="capture-btn" data-capture="${side}:${idx}" title="ถ่ายรูปด้วยกล้อง">📷</button></div>`;
  }
  function stationRowHtml(side, idx, s, total){
    const btns = `<div class="station-btns">
          <select class="blank-select" data-blanksel="${side}:${idx}">
            <option value="normal" ${!s.blank?'selected':''}>ใช้งาน</option>
            <option value="blank" ${s.blank?'selected':''}>ว่าง</option>
          </select>
        </div>`;
    const handle = `<div class="station-icon drag-handle" title="ลากค้างเพื่อย้ายตำแหน่ง/สลับฝั่ง">⠿</div>`;
    const people = `<div class="people-field">
          <input class="people-input" type="text" placeholder="0" value="${escapeHtml(s.people)}" data-people="${side}:${idx}" title="จำนวนคน (ดึงเข้าตารางสรุป)">
          <span class="people-unit">คน</span>
        </div>`;
    const labelStack = `<div class="label-rate-stack">
          <input class="station-label" placeholder="ชื่อกิจกรรม..." value="${escapeHtml(s.label)}" data-label="${side}:${idx}">
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
          <div class="drag-handle" title="ลากค้างเพื่อย้ายตำแหน่ง">⠿</div>
        </div>
        <div class="head-card-fields">
          <div class="people-field">
            <input class="people-input" type="text" placeholder="0" value="${escapeHtml(s.people)}" data-people="head:${idx}" title="จำนวนคน">
            <span class="people-unit">คน</span>
          </div>
          <input class="station-label" placeholder="ชื่อกิจกรรม..." value="${escapeHtml(s.label)}" data-label="head:${idx}">
          <div class="rate-row"><input class="rate-input" type="text" placeholder="Rate" value="${escapeHtml(s.rate)}" data-rate="head:${idx}"><span class="rate-unit">pc/hr</span></div>
          ${stationCellHtml('head', idx, s)}
        </div>
      </div>`;
  }
  function renderHeadRow(headSlots){
    const cards = headSlots.map((s,i)=> headCardHtml(i, s, headSlots.length)).join('');
    const addDisabled = headSlots.length>=15 ? 'disabled' : '';
    return `<button class="btn btn-outline btn-small head-add-btn" data-addslot="head" ${addDisabled}>+ เพิ่มกิจกรรมหัวไลน์</button>
      <div class="head-row" id="headRow">${cards}</div>`;
  }
  function renderLane(side, slots){
    let html = slots.map((s,i) => stationRowHtml(side, i, s, slots.length)).join('');
    const addDisabled = slots.length>=15 ? 'disabled' : '';
    return `
      <div class="lane-title">ฝั่ง${side==='left'?'ซ้าย':'ขวา'} (${slots.length}/15)</div>
      ${html}
      <button class="btn btn-outline btn-small lane-add-btn" data-addslot="${side}" ${addDisabled}>+ เพิ่มสถานี</button>`;
  }
  
  /* ---- overlay rendering (draggable bars + flow arrows) ---- */
  function renderOverlay(bars, arrows){
    let html = '';
    bars.forEach((b, idx) => {
      const style = b.side==='left' ? `left:8px;width:calc(50% - 16px);` : `right:8px;width:calc(50% - 16px);`;
      html += `<div class="ov-bar" data-bar="${idx}" style="top:${b.top}%;${style}"><button class="ov-x" data-barrm="${idx}">✕</button></div>`;
    });
    arrows.forEach((a, idx) => {
      const glyph = a.dir==='left' ? '⟵' : '⟶';
      html += `<div class="ov-arrow" data-arrow="${idx}" style="top:${a.top}%;">
        <div class="arrow-body" data-arrowdrag="${idx}">${glyph}<button class="ov-x" data-arrowrm="${idx}">✕</button></div>
      </div>`;
    });
    return html;
  }
  
  function renderDetail(id){
    const it = getItem(id);
    const belt = getBelt(it);
    const main = document.getElementById('main');
  
    const imagesHtml = it.images.length
      ? it.images.map((b64,gi) => `<img src="data:image/jpeg;base64,${b64}" draggable="true" data-galleryimg="${gi}" title="ลากรูปนี้ไปวางบนสายพานได้" onclick="openModal(this.src)">`).join('')
      : '<div class="empty">ไม่มีรูปตำแหน่งจากไฟล์ต้นฉบับสำหรับเมนูนี้</div>';
  
    const stepsRows = it.steps.map((s, idx) => `
      <tr data-idx="${idx}" draggable="true" data-stepidx="${idx}">
        <td class="drag-col" title="ลากเพื่อสลับลำดับ">⠿</td>
        <td class="order-col">${idx+1}</td>
        <td><input type="text" value="${escapeHtml(s.process)}" data-field="process" data-idx="${idx}"></td>
        <td class="people-col"><input type="text" value="${escapeHtml(s.people)}" data-field="people" data-idx="${idx}"></td>
        <td class="rate-col"><input type="text" value="${escapeHtml(s.rate)}" data-field="rate" data-idx="${idx}" placeholder="—"></td>
        <td class="position-col"><input type="text" value="${escapeHtml(s.position)}" data-field="position" data-idx="${idx}"></td>
        <td class="action-col"><button class="icon-btn" title="ลบขั้นตอนนี้" data-del="${idx}">✕</button></td>
      </tr>`).join('');
  
    const peopleTotal = sumPeople(it.steps);
  
    main.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="detail-title-row">
            <input class="title-input" id="titleInput" type="text" value="${escapeHtml(it.clean_title)}">
            <select class="cat-select" id="catSelect">${catOptionsHtml(it.category)}</select>
          </div>
          <div class="code">${it.custom ? 'เมนูที่เพิ่มเอง' : 'ชีตต้นฉบับ: ' + escapeHtml(it.title)}${it.code? ' · รหัสสินค้า '+escapeHtml(it.code):''}</div>
        </div>
        <div class="detail-actions">
          ${isEdited(id) && !it.custom ? '<button class="btn btn-danger" id="resetBtn">↺ คืนค่าเดิม</button>' : ''}
          <button class="btn btn-danger" id="deleteMenuBtn">🗑 ลบเมนูนี้</button>
          <button class="btn btn-save" id="saveBtn">💾 บันทึก</button>
        </div>
      </div>
  
      <h3 class="section-h">โครงสายพาน + ตำแหน่งพนักงาน</h3>
      ${renderHeadRow(belt.headSlots)}
      <div class="belt-stage" id="beltStage">
        <div class="belt-grid">
          <div class="lane lane-left">${renderLane('left', belt.leftSlots)}</div>
          <div class="lane-divider"></div>
          <div class="lane lane-right">${renderLane('right', belt.rightSlots)}</div>
        </div>
        <div class="belt-overlay" id="beltOverlay">${renderOverlay(belt.bars, belt.arrows)}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-small" id="addBarBtn">+ เพิ่มไม้กั้น</button>
        <button class="btn btn-outline btn-small" id="addArrowBtn">+ เพิ่มลูกศรทิศทาง</button>
      </div>
      <div class="station-trash" id="stationTrash">🗑 ลากสถานีมาวางตรงนี้เพื่อลบ</div>
      <div class="belt-hint">ลากค้างที่ไอคอน ⠿ ในแต่ละสถานีเพื่อสลับตำแหน่งขึ้น/ลง หรือย้ายข้ามไปอีกฝั่งได้เลย (ปล่อยตรงไหนก็ไปแทรกตรงนั้น) · ลากไปปล่อยบนกล่องสีแดงด้านล่างเพื่อลบสถานี · คลิกค้างที่ไม้กั้น (แถบดำ) หรือลูกศรแดงแล้วลากขึ้น/ลง/ซ้าย/ขวาได้เลย · คลิกลูกศรสั้น ๆ (ไม่ลาก) เพื่อสลับทิศทาง · คลิกช่องสีน้ำเงินเพื่อวางรูปจากเครื่อง หรือกด 📷 เพื่อเปิดกล้องถ่ายสด · ลากรูปจาก "รูปตำแหน่งจากไฟล์ต้นฉบับ" ด้านล่างไปปล่อยบนช่องสายพานได้โดยตรง · เลือก "ว่าง" ที่สถานีใดก็ได้เพื่อเว้นช่องนั้นไว้</div>
  
      <h3 class="section-h">รูปตำแหน่งจากไฟล์ต้นฉบับ (${it.images.length})</h3>
      <div class="gallery-toolbar">
        <button class="btn btn-outline btn-small" id="addGalleryImgsBtn">+ เพิ่มรูปจากเครื่อง (เลือกได้หลายไฟล์)</button>
      </div>
      <div class="gallery">${imagesHtml}</div>
  
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
        <tr class="fb"><td>Rate บรรจุ <span style="font-weight:400;font-size:11px;">(ต่ำสุดจาก station)</span></td><td>${minStationRate(belt)===''?'—':minStationRate(belt)}</td><td>pc/hr</td></tr>
      </table>
    `;
  
    document.getElementById('saveBtn').onclick = () => saveCurrent(id);
    document.getElementById('deleteMenuBtn').onclick = () => deleteMenu(id);
    document.getElementById('addGalleryImgsBtn').onclick = () => {
      pendingGalleryTarget = id;
      document.getElementById('hiddenGalleryFileInput').click();
    };
    const resetBtn = document.getElementById('resetBtn');
    if(resetBtn) resetBtn.onclick = () => resetCurrent(id);
    document.getElementById('addRowBtn').onclick = () => addStepRow(id);
  
    document.getElementById('titleInput').addEventListener('input', (e)=>{ const ed = ensureEdited(id); ed.title = e.target.value; ed.clean_title = e.target.value; });
    document.getElementById('titleInput').addEventListener('blur', ()=> persist(id));
    document.getElementById('catSelect').addEventListener('change', (e)=>{
      const ed = ensureEdited(id); ed.category = e.target.value; persist(id);
      renderSidebar(document.getElementById('searchBox').value); renderCatChips();
    });
  
    main.querySelectorAll('#stepsBody input').forEach(inp=>{
      inp.addEventListener('input', (e)=>{
        const idx = parseInt(e.target.dataset.idx); const field = e.target.dataset.field;
        const ed = ensureEdited(id); ed.steps[idx][field] = e.target.value;
        if(field==='people'){ renderDetail(id); }
        if(field==='rate'){ syncStepRateToStations(id, idx, e.target.value); }
      });
      inp.addEventListener('blur', (e)=>{
        const field = e.target.dataset.field;
        if(field==='rate'){ persist(id); renderDetail(id); }
      });
    });
    main.querySelectorAll('[data-del]').forEach(btn=>{
      btn.onclick = (e)=>{
        const idx = parseInt(e.target.dataset.del); const ed = ensureEdited(id);
        ed.steps.splice(idx,1); ed.steps.forEach((s,i)=>s.order=i+1);
        renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
      };
    });
    document.getElementById('sumSpeed').addEventListener('input', (e)=>{ ensureEdited(id).summary.belt_speed = e.target.value; });
    document.getElementById('sumSpeed').addEventListener('blur', ()=> persist(id));
  
    main.querySelectorAll('[data-addslot]').forEach(b=> b.onclick = ()=> addSlot(id, b.dataset.addslot));
    main.querySelectorAll('[data-cellupload]').forEach(el=> el.onclick = (e)=>{
      if(e.target.closest('[data-clearimg]') || e.target.closest('[data-capture]')) return;
      const [side, idx] = el.dataset.cellupload.split(':');
      pendingUpload = {id, side, idx: parseInt(idx)};
      document.getElementById('hiddenFileInput').click();
    });
    main.querySelectorAll('[data-capture]').forEach(el=> el.onclick = (e)=>{
      e.stopPropagation();
      const [side, idx] = el.dataset.capture.split(':');
      pendingUpload = {id, side, idx: parseInt(idx)};
      openCamModal();
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
      el.addEventListener('input', (e)=>{
        const [side, idx] = e.target.dataset.label.split(':');
        const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
        arr[parseInt(idx)].label = e.target.value;
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
    main.querySelectorAll('[data-barrm]').forEach(el=> el.onclick = (e)=>{ e.stopPropagation(); removeBar(id, parseInt(el.dataset.barrm)); });
    main.querySelectorAll('[data-arrowrm]').forEach(el=> el.onclick = (e)=>{ e.stopPropagation(); removeArrow(id, parseInt(el.dataset.arrowrm)); });
  
    setupDragging(id);
    setupStationDnD(id);
    setupStepsDnD(id);
    setupGalleryDrag(id);
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
        arr[parseInt(idx)].type = 'image'; arr[parseInt(idx)].img = galleryDragData;
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
    function indexInContainerAt(container, clientY){
      const rows = Array.from(container.querySelectorAll('.station-row, .head-card'));
      for(let i=0;i<rows.length;i++){
        const r = rows[i].getBoundingClientRect();
        if(clientY < r.top + r.height/2) return i;
      }
      return rows.length;
    }
  
    main.querySelectorAll('.station-row, .head-card').forEach(row=>{
      row.addEventListener('dragstart', (e)=>{
        dragSource = {side: row.dataset.dragside, idx: parseInt(row.dataset.dragidx)};
        try{ e.dataTransfer.setData('text/plain', 'station'); }catch(err){}
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); });
    });
  
    main.querySelectorAll('.lane, #headRow').forEach(container=>{
      container.addEventListener('dragover', (e)=>{ if(dragSource) e.preventDefault(); });
      container.addEventListener('drop', (e)=>{
        if(!dragSource) return;
        e.preventDefault();
        const toSide = containerSideOf(container);
        const toIdx = indexInContainerAt(container, e.clientY);
        moveStationCrossLane(id, dragSource.side, dragSource.idx, toSide, toIdx);
        dragSource = null;
      });
    });
  
    const trash = document.getElementById('stationTrash');
    if(trash){
      trash.addEventListener('dragover', (e)=>{ if(dragSource){ e.preventDefault(); trash.classList.add('drag-over'); } });
      trash.addEventListener('dragleave', ()=> trash.classList.remove('drag-over'));
      trash.addEventListener('drop', (e)=>{
        if(!dragSource) return;
        e.preventDefault();
        trash.classList.remove('drag-over');
        removeSlot(id, dragSource.side, dragSource.idx);
        dragSource = null;
      });
    }
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
      if(toArr.length>=15){ showToast('ปลายทางเต็ม (สูงสุด 15 ช่อง)'); return; }
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
    if(!stage) return;
  
    stage.querySelectorAll('.ov-bar').forEach(el=>{
      el.addEventListener('mousedown', (e)=> startDrag(e, id, 'bar', parseInt(el.dataset.bar), stage));
      el.addEventListener('touchstart', (e)=> startDrag(e, id, 'bar', parseInt(el.dataset.bar), stage), {passive:false});
    });
    stage.querySelectorAll('.arrow-body').forEach(el=>{
      el.addEventListener('mousedown', (e)=> startDrag(e, id, 'arrow', parseInt(el.dataset.arrowdrag), stage));
      el.addEventListener('touchstart', (e)=> startDrag(e, id, 'arrow', parseInt(el.dataset.arrowdrag), stage), {passive:false});
    });
  }
  
  function startDrag(e, id, kind, idx, stage){
    if(e.target.closest('.ov-x')) return;
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    let moved = false;
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
  
    function onMove(ev){
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      if(Math.abs(cx-startX) + Math.abs(cy-startY) > 4) moved = true;
      const top = Math.max(0, Math.min(97, ((cy - rect.top) / rect.height) * 100));
      const ed = ensureEdited(id);
      if(kind==='bar'){
        const b = ed.belt.bars[idx]; if(!b) return;
        b.top = top;
        b.side = (cx - rect.left) < rect.width/2 ? 'left' : 'right';
      } else {
        const a = ed.belt.arrows[idx]; if(!a) return;
        a.top = top;
      }
      renderOverlayOnly(id);
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
  
  function renderOverlayOnly(id){
    const it = getItem(id); const belt = getBelt(it);
    const ov = document.getElementById('beltOverlay');
    if(ov) ov.innerHTML = renderOverlay(belt.bars, belt.arrows);
  }
  
  function addStepRow(id){
    const ed = ensureEdited(id);
    const beforeLen = ed.steps.length;
    syncStationsToSteps(id);
    if(ed.steps.length === beforeLen){
      ed.steps.push({order: ed.steps.length+1, process:'', people:'', position:'', rate:''});
    }
    persist(id);
    renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function saveCurrent(id){ ensureEdited(id); persist(id); renderSidebar(document.getElementById('searchBox').value); renderDetail(id); }
  function resetCurrent(id){
    delete edited[id]; storage.delete('item:' + id, true).catch(()=>{});
    renderSidebar(document.getElementById('searchBox').value); renderDetail(id); showToast('คืนค่าเดิมแล้ว');
  }
  function openModal(src){ document.getElementById('modalImg').src = src; document.getElementById('modalBg').classList.add('open'); }
  
  function addSlot(id, side){
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    if(arr.length>=15){ showToast('สูงสุด 15 ช่อง'); return; }
    arr.push({id:uid(), type:'person', label:'', img:null, blank:false, people:'', rate:''});
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function removeSlot(id, side, idx){
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    arr.splice(idx,1);
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
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
    if(to.length>=15){ showToast('ฝั่งตรงข้ามเต็ม (15 ช่อง)'); return; }
    const [item] = from.splice(idx,1); to.push(item);
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function clearSlotImage(id, side, idx){
    const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
    arr[idx].type='person'; arr[idx].img=null; persist(id); renderDetail(id);
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
      arr[idx].type='image'; arr[idx].img = dataUrl;
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
  
  /* ---- live camera capture modal (works when the browser/tab grants camera access) ---- */
  let camStream = null;
  async function openCamModal(){
    const modal = document.getElementById('camModal');
    const video = document.getElementById('camVideo');
    const msg = document.getElementById('camMsg');
    msg.textContent = '';
    modal.classList.add('open');
    try{
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = camStream;
      video.style.display = '';
    }catch(err){
      video.style.display = 'none';
      msg.textContent = 'เปิดกล้องไม่ได้ในหน้าต่างพรีวิวนี้ (เบราว์เซอร์/แซนด์บ็อกซ์อาจบล็อกสิทธิ์กล้อง) — ลองเปิดไฟล์นี้เป็นแท็บเว็บปกตินอก Claude แล้วกดถ่ายรูปอีกครั้ง หรือกด "แนบไฟล์แทน" เพื่อเลือกรูปจากเครื่อง/แกลเลอรี';
    }
  }
  function closeCamModal(){
    document.getElementById('camModal').classList.remove('open');
    if(camStream){ camStream.getTracks().forEach(t=>t.stop()); camStream = null; }
  }
  document.getElementById('camShotBtn').onclick = () => {
    const video = document.getElementById('camVideo');
    if(!camStream || !video.videoWidth){ showToast('ยังไม่พร้อมถ่ายรูป ลองอีกครั้ง'); return; }
    const canvas = document.createElement('canvas');
    const maxW = 240;
    const w = Math.min(maxW, video.videoWidth);
    const h = Math.round(video.videoHeight * (w / video.videoWidth));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.translate(w,0); ctx.scale(-1,1); // undo mirrored preview
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    if(pendingUpload){
      const {id, side, idx} = pendingUpload;
      const ed = ensureEdited(id); const arr = slotsArrayFor(ed, side);
      arr[idx].type='image'; arr[idx].img = dataUrl;
      persist(id); renderDetail(id);
    }
    pendingUpload = null;
    closeCamModal();
  };
  document.getElementById('camUploadInsteadBtn').onclick = () => {
    closeCamModal();
    document.getElementById('hiddenFileInput').click();
  };
  document.getElementById('camCancelBtn').onclick = () => { pendingUpload = null; closeCamModal(); };
  
  function addBar(id){
    const ed = ensureEdited(id); ed.belt.bars.push({id:uid(), top:40, side:'left'});
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function removeBar(id, idx){
    const ed = ensureEdited(id); ed.belt.bars.splice(idx,1);
    persist(id); renderDetail(id); renderSidebar(document.getElementById('searchBox').value);
  }
  function addArrow(id){
    const ed = ensureEdited(id); ed.belt.arrows.push({id:uid(), top:45, dir:'left'});
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
