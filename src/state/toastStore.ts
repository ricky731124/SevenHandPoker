import { create } from 'zustand'

/** Tiny transient toast (top-center). Used for login/logout feedback etc. */
interface ToastStore {
  message: string | null
  show: (msg: string) => void
  clear: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  show: (msg) => {
    set({ message: msg })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => set({ message: null }), 1900)
  },
  clear: () => set({ message: null }),
}))
