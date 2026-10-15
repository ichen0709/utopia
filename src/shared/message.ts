import { chars } from './text';

// 控制字元、零寬字元、雙向文字控制字元(可用來偽裝文字順序)。保留換行與表情符號需要的 ZWJ。
const BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​‎‏‪-‮⁠⁦-⁩﻿]/gu;

/** 清理訊息:換行統一、去掉不可見的控制字元、連續空行縮成一行、去掉前後空白。結果仍然只是純文字。 */
export function cleanMessage(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(BAD, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function messageLength(raw: string): number {
  return chars(cleanMessage(raw));
}
