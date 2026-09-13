'use client';

import { useEffect, useRef } from 'react';
import { initApp } from '@/lib/appLogic';

export default function Page() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    initApp();
  }, []);

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <span className="tag">STD LINE</span>
          <h1>ระบบมาตรฐานตำแหน่งบรรจุ — สายพาน</h1>
        </div>
        <div className="spacer"></div>
        <input className="search-box" id="searchBox" placeholder="ค้นหาเมนู..." />
        <button className="btn btn-ghost" id="overviewBtn">ตารางสรุปทั้งหมด</button>
        <button className="btn btn-amber" id="addMenuBtn">+ เพิ่มเมนู</button>
      </div>

      <div className="layout">
        <div className="sidebar" id="sidebar">
          <div className="cat-manage">
            <div className="cat-manage-row">
              <input type="text" id="newCatInput" placeholder="ชื่อหมวดหมู่ใหม่..." />
              <button id="addCatBtn">+ เพิ่มหมวดหมู่</button>
            </div>
          </div>
          <div className="cat-chips" id="catChips"></div>
          <div className="count" id="sidebarCount"></div>
          <div id="itemList"></div>
        </div>
        <div className="main" id="main"></div>
      </div>

      <div className="modal-bg" id="modalBg"><img id="modalImg" src="" alt="" /></div>
      <div className="toast" id="toast"><span className="dot"></span><span id="toastText">บันทึกแล้ว</span></div>
      <input type="file" id="hiddenFileInput" accept="image/*" style={{ display: 'none' }} />
      <input type="file" id="hiddenGalleryFileInput" accept="image/*" multiple style={{ display: 'none' }} />

      <div className="crop-modal" id="viewModal">
        <div className="crop-hint">ลากกรอบไปยังส่วนของรูปที่ต้องการให้แสดงในช่อง · เลื่อนแถบเพื่อซูม</div>
        <div className="view-body">
          <div className="crop-stage" id="viewStage">
            <img id="viewImg" alt="" />
            <div className="crop-box" id="viewBox"></div>
          </div>
          <div className="view-side">
            <div className="view-preview-label">ตัวอย่างในช่อง</div>
            <div className="view-preview" id="viewPreview"><img id="viewPreviewImg" alt="" /></div>
            <label className="view-zoom">
              <span>ซูม</span>
              <input type="range" id="viewZoom" min="100" max="400" step="5" defaultValue="100" />
              <b id="viewZoomLabel">100%</b>
            </label>
          </div>
        </div>
        <div className="cam-controls">
          <button className="btn btn-ghost" id="viewResetBtn">แสดงทั้งรูป (กลางภาพ)</button>
          <button className="btn btn-danger" id="viewCancelBtn">ยกเลิก</button>
          <button className="btn btn-amber" id="viewApplyBtn">✓ ใช้ตำแหน่งนี้</button>
        </div>
      </div>

    </>
  );
}
