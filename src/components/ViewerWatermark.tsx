import { useMemo } from 'react'

import { useAuth } from '@/context/AuthContext'

type Props = {
  /** 覆盖默认文案；默认取当前登录人姓名/账号 */
  text?: string
}

/**
 * 页面查看人水印：斜向平铺，不拦截点击。
 * 用于工资核算等敏感页，便于截图溯源。
 */
export default function ViewerWatermark({ text }: Props) {
  const { user } = useAuth()
  const label = useMemo(() => {
    if (text?.trim()) return text.trim()
    const name = (user?.name || '').trim()
    const username = (user?.username || '').trim()
    if (name && username && name !== username) return `${name} · ${username}`
    return name || username || '未登录'
  }, [text, user?.name, user?.username])

  const tiles = useMemo(() => Array.from({ length: 60 }, (_, i) => i), [])

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden select-none"
      aria-hidden
    >
      <div
        className="absolute inset-[-25%] flex flex-wrap content-around justify-around gap-x-28 gap-y-32 rotate-[-22deg]"
        style={{ opacity: 0.09 }}
      >
        {tiles.map((i) => (
          <span
            key={i}
            className="whitespace-nowrap text-[13px] font-medium tracking-wide text-slate-800"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
