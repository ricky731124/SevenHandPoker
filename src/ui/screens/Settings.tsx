import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import Button from '../components/Button'
import CardBack from '../components/CardBack'
import useMobileWebScale from '../hooks/useMobileWebScale'
import { sfx } from '../../audio/sfx'
import './Panel.css'

function Toggle({ on, onChange, disabled, enableSuccess }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; enableSuccess?: boolean }) {
  return (
    <div className="settings__seg">
      <button
        disabled={disabled}
        className={`settings__chip${on ? ' settings__chip--on' : ''}`}
        // 設定儲存回饋:開音效 → success(此時音效已開,聽得到);其它照 click。
        onClick={() => { if (enableSuccess) { onChange(true); sfx.success() } else { sfx.click(); onChange(true) } }}
      >
        開
      </button>
      <button
        disabled={disabled}
        className={`settings__chip${!on ? ' settings__chip--on' : ''}`}
        onClick={() => { sfx.click(); onChange(false) }}
      >
        關
      </button>
    </div>
  )
}

export default function Settings() {
  const go = useAppStore((s) => s.go)
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updateSettings)
  const mw = useMobileWebScale()

  return (
    <motion.div className="panel" initial={{ opacity: 0, y: 20, scale: mw }} animate={{ opacity: 1, y: 0, scale: mw }}>
      <h1 className="panel__h1">設定</h1>
      <div className="panel__scroll">
        <div className="settings__row">
          <label>音樂</label>
          <Toggle on={settings.music} onChange={(v) => update({ music: v })} disabled />
        </div>
        <div className="settings__row">
          <label>音效</label>
          <Toggle on={settings.sfx} onChange={(v) => update({ sfx: v })} enableSuccess />
        </div>

        <div className="settings__row">
          <label>牌背</label>
          <div className="settings__seg" style={{ alignItems: 'center' }}>
            {(['blue', 'green'] as const).map((key) => (
              <button
                key={key}
                className={`settings__chip${settings.cardBack === key ? ' settings__chip--on' : ''}`}
                style={{ padding: 6 }}
                onClick={() => { sfx.success(); update({ cardBack: key }) }}
              >
                <span style={{ display: 'inline-block', pointerEvents: 'none' }}>
                  <CardBack w={30} theme={key} />
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="panel__note">桌布主題與更多牌背將於後續開放切換。</p>
      </div>
      <Button size="md" onClick={() => go('menu')}>
        返回
      </Button>
    </motion.div>
  )
}
