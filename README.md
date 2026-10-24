<div align="center">

# Instagram Follower Inspector
### IG 粉絲與追蹤分析工具

100% 本地端解析・免帳號密碼・零伺服器傳輸

[![Platform](https://img.shields.io/badge/Platform-Desktop_Only-38bdf8?style=flat-square)](README.md)
[![Release](https://img.shields.io/badge/Release-v1.0.3-a855f7?style=flat-square)](https://github.com/huangzz02/InstagramFollowerInspector/releases)

</div>

---

> [!NOTE]
> **裝置支援說明**  
> 本工具目前針對**電腦版網頁**最佳化，以確保名單交叉比對、Shift 範圍多選與多欄排版體驗。行動裝置適配已列入後續開發計畫。

---

## 核心特性

- **零信任本機沙盒 (Zero-Trust Local Execution)**  
  運算全生命週期侷限於瀏覽器沙盒記憶體內，無任何外部網路連線，從根源杜絕帳號密碼外洩與封號風險。

- **雙向集合差分引擎 (Bidirectional Set Operations)**  
  基於集合論的高效比對機制，瞬間計算 Followers 與 Following 的交集與補集，秒級收斂萬級帳號的互追與單向追蹤關係。

- **非破壞性狀態繼承 (Non-Destructive State Persistence)**  
  區隔「唯讀原始備份數據」與「本機標籤擴充層」，更換同帳號的新匯出檔時，系統以 Username 為唯一識別進行狀態自動繼承與增量更新。

---

## 系統架構

本系統採用純前端單向資料流設計，所有模組均在客戶端完全解耦運作：

| 架構層級 | 核心模組 | 運作機制與設計原則 |
| :--- | :--- | :--- |
| **數據解析層** | Ingestion & Parser | 本機串流讀取 `.zip` 壓縮封裝，自動適應新舊版 JSON 節點結構，解構 Followers 與 Following 數據陣列。 |
| **差分分析引擎** | Set Diff Engine | 運用雜湊映射（Hash Map）以 $O(N+M)$ 時間複雜度執行集合差分運算，精確劃分「未回追」、「未追蹤」與「互追」。 |
| **狀態持久層** | State & Storage | 維護活躍帳號設定檔，將自訂分類標籤與使用者標註隔離持久化至 `localStorage`，支援跨版本自動對齊。 |
| **視覺呈現層** | Chunked View | 採用分塊排程（DOM Chunking）解決大量名單渲染效能瓶頸，結合 SVG 數據圖表焦點聯動與鍵盤範圍選取。 |

---

## 快速開始

1. **取得官方備份**：依網頁內圖文教學向 Instagram 官方申請個人資料備份檔（`.zip`）。
2. **載入檔案**：使用電腦瀏覽器開啟網頁，將未解壓縮的 `.zip` 壓縮檔直接拖曳至上傳區。
3. **分析與標註**：系統將自動完成解析與比對，即可進行深度檢視、自訂分類與批次標記。

---

## 常見問題

**為什麼顯示的人數會比手機 App 多？**  
Meta 官方匯出的是資料庫底層的完整歷史關係。若你過去追蹤的帳號後來遭官方封禁（Ban）、自行暫時停用或註銷，不同於手機 App 只會顯示即時活躍帳號，該筆記錄依然會存在於下載檔中，因此人數通常會略高於手機 App。

**如何快速辨識停用或遭封禁帳號？**  
若點擊帳號跳轉至 Instagram 顯示「很抱歉，此頁面無法使用」，表示該帳號目前處於暫時停用、遭封禁或已移除狀態。

**關閉網頁或換檔案後標籤是否會遺失？**  
標籤資料皆安全存放於瀏覽器 `localStorage`，更換同帳號新檔案時會自動對齊並繼承歷史分類。

---

## 免責聲明

本專案為開源分析工具，僅供個人針對自身合法下載之 Instagram 備份資料進行離線檢視，與 Meta / Instagram 無任何商業或官方關聯。
