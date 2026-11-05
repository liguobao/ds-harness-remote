/**
 * 一套统一的多端适配基线，供页面按断点而不是魔法数判断布局。
 *
 * 断点取值对齐 DevEco「一次开发多端部署」与 ArkUI GridRow 的默认断点
 * （SDK 里 BreakPoints.value 的默认值就是 ["320vp", "600vp", "840vp"]），
 * 另外补一档 1440 给 PC / 2in1 的大窗口：
 *
 *   xs  < 320          小屏手机竖屏
 *   sm  320 – 600      常规手机竖屏
 *   md  600 – 840      手机横屏 / 小折叠展开 / 小平板
 *   lg  840 – 1440     平板、2in1 窗口
 *   xl  >= 1440        2in1 / PC 全屏
 *
 * 断点统一按「窗口宽度」算，不用屏幕宽度：2in1 上应用可以拉成任意大小的窗口，
 * 折叠屏展开/折叠也会直接体现为窗口尺寸变化，按窗口算才不会错位。
 */

export const BREAKPOINT_XS_END: number = 320;
export const BREAKPOINT_SM_END: number = 600;
export const BREAKPOINT_MD_END: number = 840;
export const BREAKPOINT_LG_END: number = 1440;

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** 按窗口宽度（vp）取断点；宽度未知时按手机竖屏处理。 */
export function breakpointOf(widthVp: number): Breakpoint {
  if (widthVp <= 0) {
    return 'sm';
  }
  if (widthVp < BREAKPOINT_XS_END) {
    return 'xs';
  }
  if (widthVp < BREAKPOINT_SM_END) {
    return 'sm';
  }
  if (widthVp < BREAKPOINT_MD_END) {
    return 'md';
  }
  if (widthVp < BREAKPOINT_LG_END) {
    return 'lg';
  }
  return 'xl';
}

/** 手机形态：xs / sm，单列、满宽。 */
export function isCompactWidth(breakpoint: Breakpoint): boolean {
  return breakpoint === 'xs' || breakpoint === 'sm';
}

/** 平板及更宽：lg / xl，可以并排、限宽居中。 */
export function isExpandedWidth(breakpoint: Breakpoint): boolean {
  return breakpoint === 'lg' || breakpoint === 'xl';
}

/** 内容列的最大宽度：随断点放宽，同时留出边距，避免贴边。 */
export function contentColumnWidth(breakpoint: Breakpoint, windowWidthVp: number): number {
  const width: number = windowWidthVp > 0 ? windowWidthVp : BREAKPOINT_SM_END;
  if (breakpoint === 'xl') {
    return Math.min(1200, width - 160);
  }
  if (breakpoint === 'lg') {
    return Math.min(1040, width - 120);
  }
  // md 及以下直接铺满窗口，交给外层 padding 控制留白
  return width;
}

/** 设备页要不要并排两列：只有真正宽起来（lg/xl）且有两台以上才分栏。 */
export function deviceColumns(breakpoint: Breakpoint, deviceCount: number): number {
  return isExpandedWidth(breakpoint) && deviceCount > 1 ? 2 : 1;
}

/**
 * 陪伴小人出场条件：纵向空间够。
 * 手机横屏约 405vp（md 断点、高度很矮）时让位给列表；平板/2in1 窗口够高就出来。
 */
export function mascotVisible(breakpoint: Breakpoint, windowHeightVp: number): boolean {
  if (windowHeightVp <= 0) {
    return !isCompactWidth(breakpoint);
  }
  return windowHeightVp >= 620;
}
