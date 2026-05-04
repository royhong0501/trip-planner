  🟦 行程相關（互相關聯，6 張）

  ┌───────────────────┬──────────────────────────────────────────────┐
  │        表         │                     角色                     │
  ├───────────────────┼──────────────────────────────────────────────┤
  │ trips             │ 🌳 樹根：行程主檔（去日本五天四夜這種）      │
  ├───────────────────┼──────────────────────────────────────────────┤
  │ trip_participants │ 行程的成員（小明、小華...）                  │
  ├───────────────────┼──────────────────────────────────────────────┤
  │ expenses          │ 一筆筆花費（晚餐 1500、車票 300...）         │
  ├───────────────────┼──────────────────────────────────────────────┤
  │ expense_splits    │ 每筆花費怎麼拆給誰（小明欠 500、小華欠 500） │
  ├───────────────────┼──────────────────────────────────────────────┤
  │ todos             │ 提醒事項（出發前一天提醒帶護照）             │
  └───────────────────┴──────────────────────────────────────────────┘

  🟥 獨立的 3 張（沒有任何外鍵）

  ┌───────────────────┬──────────────────────────────────┐
  │        表         │               用途               │
  ├───────────────────┼──────────────────────────────────┤
  │ admin_users       │ 後台登入帳號                     │
  ├───────────────────┼──────────────────────────────────┤
  │ homepage_settings │ 首頁的 KV 設定（標題、橫幅圖等） │
  ├───────────────────┼──────────────────────────────────┤
  │ email_job_logs    │ 寄信工作的稽核紀錄               │
  └───────────────────┴──────────────────────────────────┘


  🔗 關聯 1：trips → trip_participants

  trips (1) ─────────► trip_participants (N)
                一個行程有多個成員
  - 外鍵：trip_participants.trip_id → trips.id
  - 刪除策略：CASCADE
  - 白話：刪掉這個行程，它的成員也一起清光。
  為什麼？ 成員是「依附在某個 trip 之下」的——脫離 trip 沒意義。

  ---
  🔗 關聯 2：trips → expenses

  trips (1) ─────────► expenses (N)
                一個行程有多筆花費
  - 外鍵：expenses.trip_id → trips.id
  - 刪除策略：CASCADE
  - 白話：刪行程，這趟所有花費紀錄一起刪。

  ---
  🔗 關聯 3：trips → todos

  trips (1) ─────────► todos (N)
                一個行程有多個提醒
  - 外鍵：todos.trip_id → trips.id
  - 刪除策略：CASCADE
  - 白話：刪行程，這趟的提醒事項也一併刪除。

  ▎ ✨ 觀察：以上 3 條都是 CASCADE，因為子表的存在意義完全綁在 trip 上——這就是為什麼 trips 是「樹根」。

  ---
  🔗 關聯 4：trip_participants → expenses（payer，付款人）

  trip_participants (1) ──[payer_id]──► expenses (N)
                          一個成員可以墊很多筆
  - 外鍵：expenses.payer_id → trip_participants.id
  - 刪除策略：RESTRICT ⚠️
  - 白話：只要這個成員還有付過任何錢，就不准把他刪掉。要刪他，得先把他付的那些 expense 處理掉。
  - 為什麼？ 帳目不能憑空失去付款人——少了 payer，分帳邏輯整個壞掉。RESTRICT 就是一道保險。

  ▎ 💡 注意：上面關聯 1 是 CASCADE（刪 trip 時可以連 participant 一起殺），但這裡是 RESTRICT。順序是 Postgres
  ▎ 自己處理的——刪 trip 時會先 CASCADE 刪 expense，expense 沒了 payer 就不再被指著，最後才刪 participant。

  ---
  🔗 關聯 5：trip_participants → expense_splits（分帳對象）

  trip_participants (1) ──[participant_id]──► expense_splits (N)
                          一個成員會出現在多筆分帳裡
  - 外鍵：expense_splits.participant_id → trip_participants.id
  - 刪除策略：CASCADE
  - 白話：成員被刪時，他在分帳明細裡的「該欠多少」紀錄一起清掉。
  - 為什麼這條是 CASCADE，關聯 4 卻是 RESTRICT？
  因為角色不同——
    - expenses.payer = 「我付的錢」→ 失去付款人帳會壞 → RESTRICT 擋住
    - expense_splits.participant = 「我欠的錢」→ 是衍生資料，可以重新計算 → CASCADE 清掉

  ---
  🔗 關聯 6：trip_participants → todos（assignedParticipant，被指派人）

  trip_participants (1) ──[assigned_participant_id]──► todos (N)
                          可以被派多個提醒；但 todo 也可以「沒人接手」
  - 外鍵：todos.assigned_participant_id → trip_participants.id
  - 特別：這個欄位可以是 NULL（schema 寫的是 String?）
  - 刪除策略：SET NULL
  - 白話：成員被刪時，原本派給他的 todo 不會被刪，只是 assigned_participant_id 變成 NULL，等同「未指派」。
  - 為什麼？ 提醒事項本身（「出發前一天帶護照」）跟誰負責是兩回事——人離開了，事還是要做。

  ---
  🔗 關聯 7：expenses → expense_splits

  expenses (1) ─────────► expense_splits (N)
                一筆花費被拆成多筆分帳
  - 外鍵：expense_splits.expense_id → expenses.id
  - 刪除策略：CASCADE
  - 白話：刪一筆 expense，對應的分帳明細整批刪光。
  - 為什麼？ 沒了花費單，分帳明細毫無意義。