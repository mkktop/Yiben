/**
 * 雨读品牌方标「雨帘涟漪」——与雨番 Framix「霓虹环彩键」同系列设计语言：
 * 暗夜底 #12172a + 粉→紫→青渐变。构图：三条斜雨丝落地两圈涟漪。
 * 与 scripts/make-icon.js（build/icon.ico / resources/icon.png）同源，改版需同步；
 * 候选画板见 scripts/brand/icon-candidates.png（2026-09-25 定稿第 5 号）。
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="雨读">
      <defs>
        <filter id="yudu-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.8" />
        </filter>
      </defs>
      <rect width="64" height="64" rx="15" fill="#12172a" />
      <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="rgba(255,255,255,.1)" />
      <path
        d="M20 13 L26 34" stroke="#ff5c8a" strokeWidth="4.5" strokeLinecap="round"
        filter="url(#yudu-blur)" opacity=".5"
      />
      <path d="M20 13 L26 34" stroke="#ff5c8a" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M32 10 L38 31" stroke="#a78bfa" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M44 13 L50 34" stroke="#22d3ee" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M17 46 Q32 53 47 46" fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" />
      <path d="M24 53 Q32 57 40 53" fill="none" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
