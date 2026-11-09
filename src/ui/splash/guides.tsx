import type { ReactNode } from 'react'
import { AddHomeIcon, AutoRotateIcon, DotsIcon, InstallIcon, KebabIcon, MoreIcon, RotateIcon, RotationLockIcon, SafariIcon, ShareIcon, SwipeDownIcon } from './icons'
import './guides.css'

/**
 * 開場頁「最佳體驗設定」+ 各種引導的文字和圖解,全部集中在這裡(docs/MOBILE-LANDSCAPE-SPEC.md 改動 B)。
 * iOS / 安卓改版、按鈕換位置時只要改這個檔。圖解靠圖示,字越少越好。
 */
export type SetupId = 'a2hs' | 'install'

export const SETUP_TITLE = '最佳體驗設定'

export const SETUP: Record<SetupId, { label: string; gain: string; action: string; guideTitle: string }> = {
  a2hs: { label: '加入主畫面', gain: '全螢幕無網址列', action: '怎麼加？', guideTitle: '加入主畫面' },
  install: { label: '安裝 App', gain: '全螢幕無網址列', action: '一鍵安裝', guideTitle: '安裝 App' },
}

export const ENTER_TEXT = { ready: '進入遊戲', loading: '載入中…' }

interface Step {
  icon: ReactNode
  label: ReactNode
}

/** 一排步驟:圖示(畫成手機上實際看到的按鈕)+ 一兩個字,中間用箭頭接。 */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <div className="gsteps">
      {steps.map((s, i) => (
        <div key={i} className="gsteps__item">
          {i > 0 && <span className="gsteps__arrow" aria-hidden>›</span>}
          <div className="gsteps__card">
            <span className="gsteps__no">{i + 1}</span>
            <span className="gsteps__icon">{s.icon}</span>
            <span className="gsteps__label">{s.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** 「加入」那顆按鈕長這樣(文字按鈕,不是圖示) */
const TextKey = ({ children }: { children: ReactNode }) => <span className="gkey">{children}</span>

/** iOS Safari:加入主畫面。room = 用邀請連結進來時的房號。 */
export function A2hsGuide({ room }: { room: string | null }) {
  return (
    <>
      <Steps
        steps={[
          { icon: <ShareIcon />, label: '分享' },
          { icon: <AddHomeIcon />, label: '加入主畫面' },
          { icon: <TextKey>加入</TextKey>, label: '右上角' },
        ]}
      />
      <p className="gnote">
        找不到 <ShareIcon />？先點 <MoreIcon />
      </p>
      <p className="gnote gnote--soft">記住這三個圖示就好；關掉分享選單會回到這裡。</p>
      <p className="gnote gnote--soft">之後從主畫面的「七手撲克」圖示開啟{room ? `，再輸入房號 ${room}` : ''}。</p>
    </>
  )
}

/** 安卓:瀏覽器沒給一鍵安裝時,教 ⋮ 選單。 */
export function InstallGuide({ room }: { room: string | null }) {
  return (
    <>
      <Steps
        steps={[
          { icon: <KebabIcon />, label: '右上角選單' },
          { icon: <InstallIcon />, label: '安裝應用程式' },
          { icon: <TextKey>安裝</TextKey>, label: '確認' },
        ]}
      />
      <p className="gnote gnote--soft">之後從桌面的遊戲圖示開啟{room ? `，再輸入房號 ${room}` : ''}。</p>
    </>
  )
}

/** 內建瀏覽器(FB / IG / Threads / Messenger…)導出畫面(ui/components/InAppBrowserGate.tsx) */
export const IAB_TEXT = {
  why: (app: string) => `你正在用 ${app} 的內建瀏覽器開啟，沒辦法橫向全螢幕、也不能 Google 登入。`,
  // iOS:沒辦法自動跳出去,教玩家點右上角 ⋯
  iosTitle: '請改用 Safari 開啟',
  arrow: '點這裡',
  copy: '複製連結',
  copied: '已複製！打開 Safari，貼到網址列',
  copyFail: '複製不了，請長按上面的網址複製',
  fallback: '找不到選項？複製連結，打開 Safari 貼到網址列。',
  // 安卓:自動跳 Chrome
  androidTitle: '正在開啟 Chrome',
  androidBtn: '改用 Chrome 開啟',
}

/** iOS 內建瀏覽器:點右上角 ⋯ → 在外部瀏覽器開啟 */
export function IabSteps() {
  return (
    <Steps
      steps={[
        { icon: <DotsIcon />, label: '右上角 ⋯' },
        { icon: <SafariIcon />, label: '在外部瀏覽器開啟' },
      ]}
    />
  )
}

export const INSTALL_TEXT = {
  /** 安卓裝好了(appinstalled) */
  done: '安裝完成！請回桌面點擊遊戲圖示開啟，即可全螢幕遊玩。',
}

/** iOS 假橫向打字時的提醒(ui/components/TypingRotateTip.tsx) */
export const ROTATE_TIP = {
  line: '鍵盤是直的？開啟自動旋轉就正常',
  action: '怎麼開？',
  guideTitle: '開啟自動旋轉',
}

/** 開自動旋轉。iOS = 控制中心關掉直向鎖定;安卓 = 快速設定打開「自動旋轉」。 */
export function RotateGuide({ os }: { os: 'ios' | 'android' }) {
  return (
    <>
      {os === 'ios' ? (
        <Steps
          steps={[
            { icon: <SwipeDownIcon />, label: '直拿，右上角往下滑' },
            { icon: <RotationLockIcon />, label: '點鎖頭關掉' },
            { icon: <RotateIcon />, label: '轉回橫的' },
          ]}
        />
      ) : (
        <Steps
          steps={[
            { icon: <SwipeDownIcon from="top" />, label: '從螢幕上方往下滑' },
            { icon: <AutoRotateIcon />, label: '點「自動旋轉」打開' },
            { icon: <RotateIcon />, label: '轉回橫的' },
          ]}
        />
      )}
      {os === 'android' && <p className="gnote">你的瀏覽器沒辦法自動轉成橫向，開了自動旋轉就能正常橫著玩。</p>}
      <p className="gnote gnote--soft">已經開了還沒轉？把手機稍微立起來晃一下。</p>
    </>
  )
}
