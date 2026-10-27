import { create } from 'zustand'

/** Tiny transient toast (top-center). Used for login/logout feedback etc. */
interface ToastStore {
  message: string | null
  /** ms:停留時間(預設 1.9 秒;卡片說明這種要讀的字可以給長一點) */
  show: (msg: string, ms?: number) => void
  clear: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  show: (msg, ms = 1900) => {
    set({ message: msg })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => set({ message: null }), ms)
  },
  clear: () => set({ message: null }),
}))
