ได้ครับ จากนี้ชื่อโปรเจกต์และชื่อเว็บเปลี่ยนจาก **TripMate → Paipa** ทั้งหมด

ผมจะยึด Prototype ที่คุณทำไว้เป็น **UI/UX Reference** โดย Prototype ปัจจุบันมีแกนหลักครบแล้วทั้ง Dashboard, Interactive Board, Piggy Bank, Squad Chat, Polls, Timeline และ Members  รวมถึงระบบตรวจสลิป  และ Chat ที่เตรียมแนวคิด Two-way Note Sync ไว้แล้ว 

# PAIPA — Development Plan

## 1. เป้าหมายของโปรเจกต์

**Paipa** คือเว็บสำหรับสร้างห้องทริปกับกลุ่มเพื่อน

แนวคิดหลัก:

```text
PAIPA

"ไปป่ะ?"

Create Trip
    ↓
ชวนเพื่อน
    ↓
ลงชื่อ / ยืนยันไปเที่ยว
    ↓
เสนอไอเดีย
    ↓
คุยกัน
    ↓
โหวต
    ↓
เก็บเงิน
    ↓
ตรวจสลิป
    ↓
บันทึกรายจ่าย
    ↓
เที่ยว
```

หนึ่งทริปจะเป็น Workspace หนึ่งชุด

```text
Trip
├── Dashboard
├── Members
├── Money
├── Board
├── Chat
├── Votes
├── Plan
└── Activity
```

---

# 2. Technology Stack

ล็อก Stack สำหรับโปรเจกต์นี้เป็น

```text
Framework
Next.js App Router

Frontend
React
TypeScript

Styling
Tailwind CSS

Validation
Zod

Client State
Zustand

Backend / Database
Supabase

Database
PostgreSQL

Authentication
Supabase Auth

Realtime
Supabase Realtime

File Storage
Supabase Storage

Hosting
Vercel

Source Control
GitHub
```

Architecture:

```text
Browser
   │
   ▼
Next.js / Vercel
   │
   ├── Server Components
   ├── Client Components
   ├── Server Actions
   └── Route Handlers
           │
           ▼
        Supabase
       ┌────┼─────┐
       │    │     │
      DB   Auth Storage
       │
    Realtime
```

---

# 3. หลักการ Architecture

Paipa จะใช้หลักว่า

```text
Server = Source of Truth

Client = Interaction
```

ดังนั้นข้อมูลสำคัญอย่าง

```text
Trip
Member
Contribution
Payment
Expense
Note
Comment
Vote
```

ไม่ควรเก็บเป็น Zustand state หลัก

ให้ Database เป็น Source of Truth

ส่วน Zustand ใช้กับ UI state เช่น

```text
Chat Reply

Selected Note

Dragging Note

Modal

Optimistic Message

UI Preference
```

---

# 4. Project Structure

โครงสร้างเริ่มต้น:

```text
paipa/
│
├── src/
│   │
│   ├── app/
│   │   ├── page.tsx
│   │   │
│   │   ├── auth/
│   │   │
│   │   ├── join/
│   │   │   └── [inviteCode]/
│   │   │
│   │   └── trips/
│   │       ├── page.tsx
│   │       │
│   │       └── [tripId]/
│   │           ├── layout.tsx
│   │           ├── page.tsx
│   │           │
│   │           ├── money/
│   │           ├── board/
│   │           ├── chat/
│   │           ├── votes/
│   │           ├── plan/
│   │           ├── members/
│   │           └── settings/
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── trip/
│   │   ├── members/
│   │   ├── money/
│   │   ├── board/
│   │   ├── chat/
│   │   ├── votes/
│   │   └── plan/
│   │
│   ├── actions/
│   ├── lib/
│   ├── hooks/
│   ├── stores/
│   ├── schemas/
│   ├── types/
│   └── utils/
│
├── public/
├── supabase/
├── package.json
└── README.md
```

---

# 5. Route Architecture

```text
/
Paipa Landing

/auth/login
Login

/trips
My Trips

/join/[inviteCode]
Join Trip

/trips/[tripId]
Dashboard

/trips/[tripId]/money
Money

/trips/[tripId]/board
Board

/trips/[tripId]/chat
Chat

/trips/[tripId]/votes
Polls

/trips/[tripId]/plan
Trip Plan

/trips/[tripId]/members
Members

/trips/[tripId]/settings
Settings
```

---

# 6. Database Architecture

ฐานข้อมูลหลัก:

```text
profiles
trips
trip_members
trip_invites

budget_categories
contributions
payment_submissions
expenses

board_notes
note_likes
note_comments

chat_rooms
chat_messages
chat_read_states

polls
poll_options
poll_votes

trip_plan_items

activities
```

Relationship ระดับสูง:

```text
profile
   │
   └── trip_member
           │
           ▼
          trip
       ┌────┼────────┬─────────┐
       │    │        │         │
     money board    chat      votes
       │    │        │
       │    └────────┤
       │             │
   payments      note discussion
```

---

# 7. Phase การพัฒนา

| Phase | ชื่อ                | Output                           |
| ----- | ------------------- | -------------------------------- |
| 0     | Prototype Migration | แยก Prototype เดิมเป็น Reference |
| 1     | Foundation          | Next.js Project                  |
| 2     | UI System           | Paipa Design System              |
| 3     | Database            | Supabase Schema                  |
| 4     | Authentication      | Login / Session                  |
| 5     | Trip Core           | Create / List / Edit Trip        |
| 6     | Invite & Join       | แชร์ลิงก์และเข้าทริป             |
| 7     | Members             | Profile / GIF / Signature        |
| 8     | Money Core          | Budget / Contributions           |
| 9     | Payment             | Slip / Verify / Reject           |
| 10    | Expenses            | รายจ่าย                          |
| 11    | Board               | Notes / Drag / Comment           |
| 12    | Chat                | Realtime Chat                    |
| 13    | Note ↔ Chat         | Two-way Discussion               |
| 14    | Poll                | Vote                             |
| 15    | Plan                | Timeline                         |
| 16    | Activity            | Event Feed                       |
| 17    | Realtime            | Live Sync                        |
| 18    | Permission          | RLS / Security                   |
| 19    | Testing             | Unit / Integration / E2E         |
| 20    | Deploy              | Vercel Production                |

---

# Phase 0 — Prototype Migration

Prototype ปัจจุบันจะไม่ถูกเอามาพัฒนาต่อโดยตรง

แต่ใช้เป็น

```text
Visual Reference
Interaction Reference
Component Reference
Feature Reference
```

ตัว Prototype มี Theme แบบ Toy Room พร้อมสี sky, blue, pink, yellow, mint และ lilac อยู่แล้ว 

เราจะย้ายแนวคิดนี้มาเป็น Paipa Design System

```text
TRIPMATE
↓
PAIPA
```

ตัวอย่าง Branding ใหม่:

```text
PAIPA ☁️

ไปป่ะ?
เที่ยวกับเพื่อนให้ง่ายกว่าคุยในกรุ๊ป
```

Prototype navigation เดิม:

```text
Dashboard
Memo Board
Piggy Bank
Squad Chat
Toy Polls
```

จะปรับภาษา Product ให้สั้นลง:

```text
Home
Board
Money
Chat
Vote
Plan
Members
```

---

# Phase 1 — Project Foundation

เริ่มสร้าง Repository:

```bash
npx create-next-app@latest paipa
```

Configuration:

```text
TypeScript      Yes
ESLint          Yes
Tailwind        Yes
src/            Yes
App Router      Yes
Turbopack       Yes
```

ติดตั้ง dependency หลัก:

```text
@supabase/ssr
@supabase/supabase-js

zustand
zod
dayjs

lucide-react

clsx
tailwind-merge
```

อาจเพิ่มภายหลัง:

```text
dnd-kit
react-signature-canvas
```

สำหรับ Board และ Signature

---

# Phase 2 — Paipa UI System

ก่อนสร้าง Feature ให้ย้าย Prototype เป็น Component System ก่อน

เช่น

```text
Button
Card
Modal
Drawer
Avatar
Badge
Progress
Tabs
Input
Textarea
FileUploader
EmptyState
Skeleton
Toast
ConfirmDialog
```

แล้วสร้าง Paipa-specific components:

```text
TripCard
TripHeader

MemberAvatar
MemberGroup

MoneySummary

PostIt
NoteCard

ChatBubble

PollCard

TimelineItem
```

Prototype มี Responsive Navigation สำหรับมือถืออยู่แล้ว เช่น HOME, BOARD, MONEY, CHAT และ MORE 

เราจะรักษา interaction นี้ไว้

Desktop:

```text
Sidebar
+
Top Bar
```

Mobile:

```text
Bottom Navigation
```

---

# Phase 3 — Supabase Setup

สร้าง Supabase Project

เตรียม environment:

```text
NEXT_PUBLIC_SUPABASE_URL

NEXT_PUBLIC_SUPABASE_ANON_KEY
```

จากนั้นสร้าง client สองแบบ

```text
src/lib/supabase/client.ts

src/lib/supabase/server.ts
```

หลักการ:

```text
Browser Component
→ client.ts

Server Component
→ server.ts

Server Action
→ server.ts
```

ห้ามเอา Service Role Key ไปไว้ Client

---

# Phase 4 — Authentication

Version แรกทำ

```text
Google Login
Email Login
```

หลังจากนั้นค่อยเพิ่ม

```text
Guest Join
```

สร้าง:

```text
profiles
```

ตัวอย่าง:

```text
id
display_name
avatar_url
created_at
updated_at
```

Auth Flow:

```text
Login
 ↓
Supabase Auth
 ↓
Profile
 ↓
/trips
```

---

# Phase 5 — Trip Core

สร้าง `trips`

```text
id
owner_id

name
description

destination

cover_url

start_date
end_date

budget_per_person
max_members

status

created_at
updated_at
```

Status:

```text
planning
upcoming
ongoing
completed
archived
```

สร้าง Feature:

```text
Create Trip
Edit Trip
View Trip
My Trips
Archive Trip
Delete Trip
```

Dashboard ตอนนี้ยังไม่ต้องมีข้อมูลทุกระบบ

แค่

```text
Trip
Members
Date
Budget
Countdown
```

ก่อน

---

# Phase 6 — Invite / Join

สร้าง:

```text
trip_invites
```

ตัวอย่าง:

```text
id
trip_id

code

created_by

expires_at
max_uses
usage_count

created_at
```

Invite URL:

```text
paipa.app/join/8Xa92K
```

Flow:

```text
เปิด Invite
 ↓
ดู Trip Preview
 ↓
Login / Guest
 ↓
Join
 ↓
สร้าง trip_member
 ↓
Trip Dashboard
```

---

# Phase 7 — Members

`trip_members`

```text
id
trip_id
user_id

display_name
avatar_url
avatar_type

signature_url

attendance

role

joined_at
```

Attendance:

```text
going
maybe
not_going
```

Role:

```text
owner
member
guest
```

Member สามารถใช้

```text
Image
GIF
Avatar
Signature
```

ลายเซ็นใช้ Canvas

```text
Draw
 ↓
Convert Image
 ↓
Supabase Storage
 ↓
signature_url
```

---

# Milestone 1

เมื่อมาถึงตรงนี้ Paipa ต้องสามารถใช้งาน Flow นี้ได้จริง:

```text
Nut Login

↓

Create
"Pattaya 2026"

↓

Paipa สร้าง Trip

↓

Copy Invite

↓

Beam เปิด Invite

↓

Beam Login

↓

Beam เลือก Profile

↓

Beam วาด Signature

↓

Beam Join

↓

Nut เห็น Beam
ใน Members
```

นี่คือ **M1 — Paipa Trip Core**

ถ้ายังไม่ผ่าน Flow นี้ ไม่ควรเริ่ม Money

---

# Phase 8 — Money Core

สร้าง:

```text
contributions
```

```text
id
trip_id
member_id

expected_amount
verified_amount

status
```

Status:

```text
unpaid
pending
partial
paid
```

Dashboard:

```text
Target

฿28,000

Collected

฿21,000

Pending

฿3,500
```

กฎ:

```text
Collected
=
Verified Payment เท่านั้น
```

Prototype มี UI แนวนี้อยู่แล้วและแยก `COLLECTED (VERIFIED)` ออกจาก `PENDING SLIP` ชัดเจน 

---

# Phase 9 — Payment Proof

สร้าง:

```text
payment_submissions
```

Fields:

```text
id
trip_id
member_id

amount

payment_method
transferred_at

proof_path

status

note

verified_by
verified_at

rejected_by
rejected_at
rejection_reason

created_at
```

Storage:

```text
payment-proofs
```

เป็น Private Bucket

Flow:

```text
Beam

↓

แจ้งโอน

฿3,500

↓

Upload Slip

↓

PENDING

↓

Nut ได้ Notification

↓

Open Slip

↓

Verify

↓

Contribution
3,500 / 3,500

↓

PAID
```

Reject:

```text
Reject
 ↓
Reason
 ↓
Member sees reason
 ↓
Resubmit
```

---

# Phase 10 — Expenses

สร้าง

```text
expenses
```

```text
id
trip_id

title
amount
category

paid_by
payment_source

receipt_path

spent_at

description
created_at
```

Payment Source:

```text
trip_fund
personal
```

คำนวณ:

```text
Available Fund

=

Verified Payments

-

Trip Fund Expenses
```

---

# Milestone 2

M2 ต้องผ่าน:

```text
8 Members

↓

Budget
฿3,500 / person

↓

Expected
฿28,000

↓

Beam Upload Slip
฿3,500

↓

Nut Verify

↓

Collected
+ ฿3,500

↓

Nut เพิ่ม Hotel Expense
฿2,000

↓

Available
ลด ฿2,000
```

---

# Phase 11 — Board

สร้าง Board หลัง Money เสถียร

Prototype เดิมมี Free Drag Board พร้อม Post-it อยู่แล้ว 

`board_notes`

```text
id
trip_id
author_id

content
category

color

position_x
position_y
rotation

image_path

created_at
updated_at
```

Categories:

```text
Food
Place
Activity
Idea
Question
Important
Random
```

Desktop:

```text
Free Drag Canvas
```

Mobile:

```text
Grid / Feed
```

แล้วค่อยเปิด Drag Mode

เพราะ UX การลาก Note บนมือถืออาจรบกวน Scroll

---

# Phase 12 — Comments

สร้าง:

```text
note_comments
```

```text
id
note_id
author_id

content

source

source_chat_message_id

created_at
updated_at
```

Source:

```text
board
chat
```

Field นี้สำคัญสำหรับระบบ Chat ใน Phase ต่อไป

---

# Phase 13 — Chat

`chat_rooms`

Version แรกง่ายมาก:

```text
1 Trip
=
1 Room
```

สร้าง

```text
chat_messages
```

Fields:

```text
id
trip_id
sender_id

type

content

image_path

referenced_note_id

reply_to_message_id

created_at
updated_at
deleted_at
```

Type:

```text
text
image
gif
note_reference
system
```

UI ใช้ Client Component

```text
ChatWindow

ChatMessages

ChatMessage

ChatComposer
```

แล้ว Subscribe Supabase Realtime

---

# Phase 14 — Board ↔ Chat

นี่คือ Feature Signature ของ Paipa

ตัวอย่าง:

```text
BOARD

📌 Beam

"อยากไปร้าน Seafood"

[ Discuss ]
```

กด Discuss

```text
↓

CHAT

📌 NOTE
อยากไปร้าน Seafood

Beam
```

แล้ว Boss กด

```text
Reply to Note
```

พิมพ์

```text
ร้านนี้น่าสนใจ ไปเลย
```

ระบบสร้าง:

```text
chat_messages

+

note_comments
```

พร้อมกัน

ผลคือ Board:

```text
📌 อยากไปร้าน Seafood

Comments

Boss
ร้านนี้น่าสนใจ ไปเลย
```

และ Chat:

```text
Boss
↪ Replying to Note

ร้านนี้น่าสนใจ ไปเลย
```

---

# Milestone 3

นี่จะเป็น Milestone ที่ทำให้ **Paipa เริ่มมี Character ของตัวเอง**

ต้องผ่าน Flow:

```text
Create Note

↓

Drag Note

↓

Like

↓

Comment

↓

Discuss in Chat

↓

Friend Reply from Chat

↓

Board Comment Updates Realtime
```

---

# Phase 15 — Poll

สร้าง:

```text
polls
poll_options
poll_votes
```

รองรับ:

```text
Single Choice

Multiple Choice

Anonymous

Closing Time
```

และ Flow:

```text
Note
 ↓
Create Poll
```

ตัวอย่าง

```text
📌 กิน Seafood ดีไหม?

↓

Create Poll

กินอะไรคืนแรก?

○ Seafood
○ BBQ
○ Japanese
```

---

# Phase 16 — Plan

สร้าง Trip Timeline

```text
trip_plan_items
```

Fields:

```text
trip_id

date

start_time
end_time

title
description
location

category

sort_order
```

UI:

```text
DAY 1
│
08:00 นัดเจอ
│
11:30 กินข้าว
│
14:00 Check-in
```

---

# Phase 17 — Activity

Activity Feed:

```text
Beam joined

Boss posted a Note

Nut created a Poll

Beam submitted payment

Nut verified Beam payment

Game added expense
```

Table:

```text
activities
```

ใช้สำหรับ Dashboard และ Notification ในอนาคต

---

# Phase 18 — Realtime

เปิด Realtime เฉพาะ Feature ที่เหมาะสม

```text
Chat

Note Comments

Votes

Payment Status

Members

Activity
```

ไม่จำเป็นต้อง realtime ทุก table

Channel:

```text
trip:{tripId}
```

---

# Phase 19 — Security

Supabase RLS ต้องทำก่อน Production

ตัวอย่าง Policy:

```text
Member of Trip
→ View Trip

Not Member
→ Deny

Member
→ Create own payment

Member
→ View own payment proof

Owner / Money Manager
→ View all payment proofs

Owner / Money Manager
→ Verify payment

Note Owner
→ Edit own Note

Trip Owner
→ Manage Members
```

File:

```text
Payment Slip
Signature
Receipt
```

ห้ามเปิด Public โดยไม่จำเป็น

---

# Phase 20 — Testing

Critical flows:

```text
Trip

Create
Invite
Join
Leave
Delete
```

```text
Money

Submit
Verify
Reject
Resubmit
Expense
```

```text
Social

Create Note
Comment
Share Chat
Reply Note
Realtime Sync
```

```text
Poll

Create
Vote
Close
Result
```

ทำ E2E โดยจำลองอย่างน้อย

```text
User A = Owner

User B = Member
```

เปิดคนละ Browser

---

# Phase 21 — Vercel Deployment

Workflow:

```text
GitHub

↓

Push main

↓

Vercel

↓

Preview Deployment

↓

Production
```

Branch Strategy:

```text
main
↑
develop
↑
feature/*
```

เช่น:

```text
feature/auth

feature/trip-core

feature/payment-proof

feature/board

feature/chat

feature/note-chat-sync
```

Vercel Preview Deployment ใช้ตรวจแต่ละ feature ก่อน merge เข้า `main`

---

# Roadmap ที่ควรทำจริง

ผมจะแบ่งการสร้างออกเป็น 5 Milestone ใหญ่:

| Milestone               | เป้าหมาย                                |
| ----------------------- | --------------------------------------- |
| **M1 Paipa Core**       | Auth + Trip + Invite + Join + Members   |
| **M2 Paipa Money**      | Budget + Contributions + Slip + Expense |
| **M3 Paipa Social**     | Board + Comment + Chat + Note Sync      |
| **M4 Paipa Decision**   | Vote + Plan + Activity                  |
| **M5 Paipa Production** | Realtime + RLS + Testing + Vercel       |

และ **จุดเริ่มเขียนโค้ดจริงควรเป็น M1 เท่านั้น** โดยลำดับแรกคือ `Next.js Foundation → Supabase → Auth → Trip Schema → Create Trip → Invite → Join → Members` อย่าเพิ่งให้ Coding Agent กระโดดไปทำ Chat หรือ Payment พร้อมกัน เพราะจะทำให้ Data Model และ Permission เปลี่ยนไปมาระหว่างทาง

จากนี้ชื่อในโค้ด, README, UI, metadata, repository และ environment naming ควรใช้ **`Paipa` / `paipa`** ทั้งหมด และเลิกใช้ `TripMate` เป็นชื่อระบบ เหลือไว้เพียง Prototype Reference เท่านั้น.
