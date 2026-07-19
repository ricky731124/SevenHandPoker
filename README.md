# Seven Hand Poker 七手撲克

梭哈式對決的雙人網頁遊戲。可對戰電腦，未來支援雙人連線；適合桌面與手機橫放。

規格見 [docs/SPEC.md](docs/SPEC.md)。

## 本機開發

```bash
npm install
npm run dev        # 開發伺服器（預設 http://localhost:5173）
npm test           # 規則引擎單元測試
npm run build      # 產出 dist/（GitHub Pages 用）
```

GitHub Pages 專案站台需設定 base：

```bash
VITE_BASE=/SevenHandPoker/ npm run build
```

## 技術

React + TypeScript + Vite · Framer Motion（動畫）· Zustand（狀態）·
Howler + WebAudio（音效）· Firebase Realtime Database（連線，開發中）。

## 進度

- [x] 主選單 / 如何遊玩 / 設定 + 設計系統 + 佔位美術
- [x] 規則引擎（洗牌 / 發牌 / 比牌 / 勝負 / 補牌）+ 單元測試
- [x] 單機對戰電腦：擲硬幣、選牌 / 放置、對決、金幣、放大鏡、續局
- [ ] 雙人連線（Firebase）
- [ ] 打磨：音效、手機橫放、部署

## 可覆蓋的美術資產

- 主畫面標題大圖：放 `public/title.png`（未放則顯示文字備援）。
- 頭像 / 牌背 / 桌布：內建程序化 SVG，之後可換 PNG 或增加主題。
