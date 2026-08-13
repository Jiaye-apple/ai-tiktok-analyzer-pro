/**
 * 官网品牌素材，内嵌成 data URI / 内联 SVG。
 * 内嵌是为了让官网页面完全自包含 —— 不用再单独部署静态资源，
 * 也不会因为图片挂了导致登录页显示成裂图。
 *
 * 视觉体系是「情报纸」：暖纸面 + 墨色；品牌图标沿用插件的新标识系统。
 * LOGO_ICON 由近黑底、青红错位、播放/下载符号与 AI 星芒组成，文字商标不放图片里，
 * 页头用 <span class="brand"> 排 —— 能跟随暗色模式。
 */

export const LOGO_ICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22512%22%20height%3D%22512%22%20viewBox%3D%220%200%20512%20512%22%20fill%3D%22none%22%3E%3Cdefs%3E%3Cg%20id%3D%22download-note%22%3E%3Ccircle%20cx%3D%22222%22%20cy%3D%22230%22%20r%3D%2288%22%2F%3E%3Crect%20x%3D%22282%22%20y%3D%22104%22%20width%3D%2260%22%20height%3D%22174%22%20rx%3D%2230%22%2F%3E%3Crect%20x%3D%22216%22%20y%3D%22280%22%20width%3D%2280%22%20height%3D%2270%22%20rx%3D%2218%22%2F%3E%3Cpath%20d%3D%22M160%20332H216V312H296V332H352C362%20332%20367%20344%20359%20351L269%20424C262%20430%20250%20430%20243%20424L153%20351C145%20344%20150%20332%20160%20332Z%22%2F%3E%3C%2Fg%3E%3C%2Fdefs%3E%3Crect%20x%3D%2264%22%20y%3D%2264%22%20width%3D%22384%22%20height%3D%22384%22%20rx%3D%2296%22%20fill%3D%22%23121212%22%2F%3E%3Cuse%20href%3D%22%23download-note%22%20transform%3D%22translate(-8%20-3)%22%20fill%3D%22%2325F4EE%22%2F%3E%3Cuse%20href%3D%22%23download-note%22%20transform%3D%22translate(8%203)%22%20fill%3D%22%23FE2C55%22%2F%3E%3Cuse%20href%3D%22%23download-note%22%20fill%3D%22%23FFFFFF%22%2F%3E%3Cpath%20d%3D%22M190%20195V266L252%20230.5L190%20195Z%22%20fill%3D%22%23121212%22%2F%3E%3Cpath%20d%3D%22M378%2096C381%20114%20392%20125%20410%20128C392%20131%20381%20142%20378%20160C375%20142%20364%20131%20346%20128C364%20125%20375%20114%20378%2096Z%22%20fill%3D%22%2325F4EE%22%2F%3E%3Cpath%20d%3D%22M386%20102C389%20120%20400%20131%20418%20134C400%20137%20389%20148%20386%20166C383%20148%20372%20137%20354%20134C372%20131%20383%20120%20386%20102Z%22%20fill%3D%22%23FE2C55%22%2F%3E%3Cpath%20d%3D%22M382%2099C385%20117%20396%20128%20414%20131C396%20134%20385%20145%20382%20163C379%20145%20368%20134%20350%20131C368%20128%20379%20117%20382%2099Z%22%20fill%3D%22%23FFFFFF%22%2F%3E%3C%2Fsvg%3E";

/**
 * 线性图标集（stroke 风格，currentColor 取色）。
 * 页面里原先的 emoji 图标全部换成这套 —— emoji 在不同平台渲染不一致，
 * 也压不住整体的印刷风格。用法：ic('search') / ic('download', 26)。
 */
const ICON_PATHS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10.5 9 5 3-5 3z"/>',
  bag: '<path d="M6.5 8h11l-.9 12H7.4z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  shop: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M3 9.5h18"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-5.5h5V20"/>',
  trophy:
    '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5v1a3.2 3.2 0 0 0 3 3.2"/><path d="M16 5h3v1a3.2 3.2 0 0 1-3 3.2"/><path d="M12 13v4"/><path d="M8.5 20h7"/><path d="M9.2 20c.2-2 .9-3 2.8-3s2.6 1 2.8 3"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  megaphone: '<path d="M19 5 8 9.5H4v5h4L19 19z"/><path d="m9.5 14.8.8 5.2h2.1l-.9-5.4"/>',
  alert: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v5"/><path d="M12 17.4v.2"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17"/><path d="M8.5 3v4M15.5 3v4"/>',
  chat: '<path d="M4 5h16v11H10l-5.2 4z"/>',
  download: '<path d="M12 4v10"/><path d="m7 10 5 5 5-5"/><path d="M5 19.5h14"/>',
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.3 3.9 5.1 3.9 8.5s-1.3 6.2-3.9 8.5c-2.6-2.3-3.9-5.1-3.9-8.5s1.3-6.2 3.9-8.5z"/>',
  chart: '<path d="M5 20v-8M11 20V6M17 20V10"/><path d="M3.5 20h17"/>',
  sparkle:
    '<path d="M11 3.5 12.7 9l5.5 1.8-5.5 1.8L11 18.1l-1.7-5.5-5.5-1.8L9.3 9z"/><path d="m18.5 14.5.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8z"/>',
};

export function ic(name: string, size = 20): string {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    ICON_PATHS[name] ?? ''
  }</svg>`;
}
