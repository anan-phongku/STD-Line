# STD Line — ระบบมาตรฐานตำแหน่งบรรจุ (Next.js + Supabase)

พอร์ตมาจากเวอร์ชัน Claude Artifact เดิม (ไฟล์ HTML เดียว) ให้เป็นโปรเจกต์ Next.js
พร้อม deploy ขึ้น Vercel และเก็บข้อมูล/การแก้ไขไว้ใน Supabase แทน `window.storage`
เดิมที่ใช้ได้เฉพาะใน Claude.ai

ข้อมูลเมนูทั้ง 54 เมนู (ขั้นตอน, รูปที่ crop มาจากไฟล์ Excel ต้นฉบับ, หมวดหมู่ที่จัดไว้แล้ว)
รวมอยู่ใน `public/data/payload.json` เรียบร้อย ไม่ต้องเริ่มนับหนึ่งใหม่

## 1. ติดตั้ง

```bash
npm install
```

## 2. สร้าง Supabase project

1. ไปที่ [supabase.com](https://supabase.com) สร้างโปรเจกต์ใหม่ (ฟรี)
2. เปิด **SQL Editor** แล้ววางเนื้อหาทั้งหมดจากไฟล์ `supabase/schema.sql` ในโปรเจกต์นี้ กด Run
   (จะสร้างตาราง `kv_store` ที่ใช้เก็บการแก้ไขทั้งหมด — เหมือน `window.storage` เดิมทุกประการ)
3. ไปที่ **Project Settings → API** คัดลอกค่า `Project URL` และ `anon public` key

## 3. ตั้งค่า environment variables

```bash
cp .env.local.example .env.local
```

แล้วแก้ค่าในไฟล์ `.env.local` ให้เป็นของโปรเจกต์ Supabase ที่สร้างไว้:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxxxxxxxxxxxxx
```

## 4. รันทดสอบในเครื่อง

```bash
npm run dev
```

เปิด http://localhost:3000 — ควรเห็นแอปเหมือนตอนใช้งานใน Claude ทุกอย่าง (เพิ่ม/ลบเมนู, ลากไม้กั้น,
ลากสถานี, จัดหมวดหมู่ ฯลฯ) เพียงแต่ตอนนี้การแก้ไขทั้งหมดจะถูกบันทึกลง Supabase แทน

## 5. Deploy ขึ้น GitHub + Vercel

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <ลิงก์ repo GitHub ของคุณ>
git push -u origin main
```

จากนั้น:
1. เข้า [vercel.com](https://vercel.com) → New Project → เลือก repo นี้
2. ในหน้า "Environment Variables" ใส่ `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   ให้ตรงกับที่ตั้งไว้ใน `.env.local`
3. กด Deploy

ทุกครั้งที่ push โค้ดใหม่ขึ้น GitHub, Vercel จะ deploy ให้อัตโนมัติ

## โครงสร้างไฟล์สำคัญ

```
app/page.tsx          โครง HTML หลัก (topbar, sidebar, main) + เรียก initApp()
app/globals.css       สไตล์ทั้งหมด (ย้ายมาจากไฟล์เดิมตรง ๆ)
lib/appLogic.js       ตรรกะแอปทั้งหมด (render, drag-and-drop, สถานี, ไม้กั้น ฯลฯ)
lib/kvStore.js        ตัวแทน window.storage เดิม แต่คุยกับ Supabase แทน
lib/supabaseClient.js ตัวเชื่อมต่อ Supabase
public/data/payload.json   ข้อมูลตั้งต้นทั้ง 54 เมนู (steps, belt, รูปที่ crop ไว้แล้ว, หมวดหมู่)
supabase/schema.sql   คำสั่งสร้างตารางที่ต้องรันใน Supabase ครั้งแรก
```

## เรื่องรูปภาพ

ข้อมูลตั้งต้น (54 เมนู) ฝังรูปเป็น base64 อยู่ใน `payload.json` เหมือนตอนอยู่ใน Claude —
ใช้งานได้ปกติทันทีไม่ต้องทำอะไรเพิ่ม

รูปที่ **เพิ่มใหม่หลัง deploy** (ถ่ายรูปผ่านกล้อง, อัปโหลดจากเครื่อง, ลากรูปจากแกลเลอรี) ในเวอร์ชันนี้
ยังคงเก็บเป็น base64 อยู่ในฐานข้อมูล (`kv_store.value`) เพื่อความง่าย — ถ้าจะให้เว็บโหลดเร็วขึ้นและไม่พึ่ง
ขนาด JSON ที่บวมขึ้นเรื่อย ๆ แนะนำให้ปรับ `lib/appLogic.js` ส่วน `fileToResizedDataURL` /
`handleUploadedFile` ให้อัปโหลดไฟล์เข้า Supabase Storage bucket (`station-photos`) แล้วเก็บแค่ URL
แทน — บอกได้ถ้าอยากให้ช่วยเขียนส่วนนี้เพิ่ม

## หมายเหตุเรื่องสิทธิ์การเข้าถึง

`supabase/schema.sql` เปิดให้ทุกคนอ่าน/เขียนข้อมูลได้หมด (เหมาะกับการใช้งานภายในทีมที่ไม่มีระบบ login)
ถ้าต้องการจำกัดสิทธิ์ภายหลัง (เช่น ต้อง login ก่อนแก้ไข) ให้เพิ่ม Supabase Auth แล้วแก้ policy ในตาราง
`kv_store` ตามความเหมาะสม
