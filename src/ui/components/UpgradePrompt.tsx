import Modal from './Modal'
import Button from './Button'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'

/**
 * "Save your progress" nudge (#9). Raised on a campaign stage clear while the
 * player is still an anonymous guest — once per new clear. Google 登入 / 遊戲帳號
 * 註冊 route (via the menu) to the matching auth flow; 取消 just dismisses.
 */
export default function UpgradePrompt() {
  const open = useAppStore((s) => s.upgradePrompt)
  const isAnonymous = usePlatformStore((s) => s.isAnonymous)
  const dismiss = useAppStore((s) => s.dismissUpgrade)
  const requestRegister = useAppStore((s) => s.requestRegister)
  const requestGoogle = useAppStore((s) => s.requestGoogle)

  if (!open || !isAnonymous) return null

  return (
    <Modal open onClose={dismiss} title="保存你的進度" width={360}>
      <p className="acct-note">
        恭喜過關！建議使用 Google 登入免記帳密，永久保存進度、解鎖收集與排行榜。訪客進度只留在這個瀏覽器，換裝置就會不見。
      </p>
      <Button full onClick={requestGoogle}>Google 登入</Button>
      <Button full variant="secondary" onClick={requestRegister}>遊戲帳號註冊</Button>
      <Button full variant="ghost" onClick={dismiss}>取消</Button>
    </Modal>
  )
}
