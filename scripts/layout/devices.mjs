// 截圖用的裝置。viewport = 網頁實際拿到的大小;screen = 手機螢幕(iOS 的 screen 永遠是直的)。
// 尺寸來源:iPhone 15 Pro 實測 393×852、Safari 橫向有網址列時可視高 ≈ 310(useBoardSizes 註解);
// 三星:S20 Ultra 412×915(使用者的手機)、S25 384×832、小台 360×800(也接近三星開「螢幕縮放」的大小)。
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G988B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const S25_UA =
  'Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

export const DEVICES = [
  // iPhone 15 Pro
  { id: 'ios-full', quick: true, os: 'ios', mobile: true, standalone: true, ua: IOS_UA, viewport: { width: 852, height: 393 }, screen: { width: 393, height: 852 } },
  { id: 'ios-fake', quick: true, os: 'ios', mobile: true, standalone: true, ua: IOS_UA, viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 } },
  { id: 'ios-web', quick: true, os: 'ios', mobile: true, standalone: false, ua: IOS_UA, viewport: { width: 852, height: 310 }, screen: { width: 393, height: 852 } },
  { id: 'ios-web-fake', os: 'ios', mobile: true, standalone: false, ua: IOS_UA, viewport: { width: 393, height: 660 }, screen: { width: 393, height: 852 } },
  // 三星 S20 Ultra(使用者自己的手機,412×915)
  { id: 'and-full', quick: true, os: 'android', mobile: true, standalone: true, ua: ANDROID_UA, viewport: { width: 915, height: 412 }, screen: { width: 915, height: 412 } },
  { id: 'and-fake', quick: true, os: 'android', mobile: true, standalone: true, ua: ANDROID_UA, viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 } },
  { id: 'and-web', os: 'android', mobile: true, standalone: false, ua: ANDROID_UA, viewport: { width: 915, height: 340 }, screen: { width: 915, height: 412 } },
  // 三星 S25(較新、較窄的代表,384×832;網頁版扣掉網址列 ≈ 72)
  { id: 's25-full', os: 'android', mobile: true, standalone: true, ua: S25_UA, viewport: { width: 832, height: 384 }, screen: { width: 832, height: 384 } },
  { id: 's25-web', quick: true, os: 'android', mobile: true, standalone: false, ua: S25_UA, viewport: { width: 832, height: 312 }, screen: { width: 832, height: 384 } },
  // 三星(小)
  { id: 'and-small', os: 'android', mobile: true, standalone: true, ua: ANDROID_UA, viewport: { width: 800, height: 360 }, screen: { width: 800, height: 360 } },
  // 電腦
  { id: 'desk-1440', quick: true, os: 'desktop', mobile: false, viewport: { width: 1440, height: 900 } },
  { id: 'desk-1280', os: 'desktop', mobile: false, viewport: { width: 1280, height: 720 } },
]
