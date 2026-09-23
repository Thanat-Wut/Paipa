# Paipa ☁️

เว็บสร้างห้องทริปกับเพื่อนตาม [plans.md](./plans.md) โดย Prototype เดิมอยู่ใน `tripmate_trip_collaboration_workspace.html` เพื่อใช้เป็นภาพอ้างอิงเท่านั้น

## สถานะ

โค้ด M1 Trip Core (รอเชื่อม Supabase project เพื่อทดสอบ end-to-end): Next.js App Router, Supabase Auth (Email และ Google), สร้าง/แก้ไข/เก็บ/ลบทริป, ลิงก์เชิญ, Join, รายชื่อสมาชิก, รูป/GIF และลายเซ็น

Money, Board, Chat, Vote และ Plan ยังอยู่ใน milestone ถัดไป

## เริ่มต้น

1. `npm install`
2. สร้าง Supabase project แล้วรัน migration ใน `supabase/migrations/`
3. คัดลอก `.env.example` เป็น `.env.local` และใส่ URL กับ publishable key ของ project
4. ตั้งค่า Supabase Auth URL Configuration: Site URL เป็น `http://localhost:3000` และเพิ่ม Redirect URL `http://localhost:3000/auth/callback*`
5. เปิด Google provider ใน Supabase หากจะใช้ Google Login (Email Login ใช้ได้โดยไม่ต้องเปิด Google)
6. `npm run dev`

ตรวจโค้ดด้วย `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`

**สำคัญ:** ใช้ publishable key ใน browser เท่านั้น ห้ามใส่ service role หรือ secret key ใน `NEXT_PUBLIC_*` ตัว migration เปิด RLS ในทุกตารางและเก็บลายเซ็นใน private bucket
