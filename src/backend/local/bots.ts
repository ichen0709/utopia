// 階段一的「模擬營火夥伴」。他們是資料庫裡標記為 isBot 的成員,行為由其中一個分頁(領頭的那個)驅動。
// 階段二接上 Supabase 後,這個檔案不會被使用。

import { nicknameKey } from '../../shared/nickname';
import type { RoomConfig } from '../types';
import { addFuel, addMessage, currentFireLevel, type LocalDb, type MemberRow } from './room';

export const BOT_NAMES = ['阿火', '小滿', '月亮', '毛毛', '阿寶'];
export const ROAMER = '路過的人';

const LINES = [
  '今天的風好大,火都被吹得歪歪的',
  '有人要喝熱可可嗎?',
  '我帶了棉花糖,誰要烤?',
  '剛剛好像聽到貓頭鷹的聲音',
  '星星今天特別多',
  '這個營火的位置真好',
  '你們有看到流星嗎?',
  '我先坐一下,腳好痠',
  '這個露營地點不錯 https://example.com/camp',
  '山上晚上真的好涼',
  '等下要不要來講個鬼故事?',
  '烤地瓜的味道好香',
  '剛剛那個笑話我笑了好久',
  '大家今天都去哪裡玩了?',
  '<b>這不是粗體</b>,只是普通的字',
];

const MENTION_LINES = ['你今天過得怎麼樣?', '你剛剛有聽到嗎?', '要不要一起烤棉花糖?', '你的柴呢?', '你覺得呢?'];

const pick = <T>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

function botRow(name: string, now: number, joinedAt = now): MemberRow {
  return {
    sessionId: `bot:${name}`,
    userId: `bot:${name}`,
    nickname: name,
    joinedAt,
    lastBeatAt: now,
    leavingAt: null,
    isBot: true,
    away: false,
  };
}

/** 第一次進來時,讓房間不是空的:夥伴坐好、有一些還沒過期的歷史訊息 */
export function seedDb(db: LocalDb, now: number, cfg: RoomConfig): void {
  const min = 60_000;
  const ttl = cfg.messageTtlSeconds * 1000;
  // 歷史訊息要在 TTL 之內,而且至少離到期還有幾分鐘,方便看到淡出
  const margin = Math.min(3 * min, ttl / 2);
  const at = (minutesAgo: number) => Math.max(now - ttl + margin, now - minutesAgo * min);
  BOT_NAMES.forEach((name, i) => db.members.push(botRow(name, now, at(24 - i))));

  const push = (kind: 'chat' | 'join' | 'fire', nickname: string, body: string | null, minutesAgo: number) => {
    const t = at(minutesAgo);
    const row = addMessage(db, { kind, nickname, body, userId: `bot:${nickname}` }, t, cfg);
    row.createdAt = t;
    row.expiresAt = t + ttl;
  };
  BOT_NAMES.forEach((name, i) => push('join', name, null, 24 - i));
  push('chat', '阿火', '大家晚安,今天營火看起來不錯', 19);
  push('chat', '小滿', '我帶了棉花糖,誰要烤?', 15);
  push('fire', '月亮', null, 11);
  push('chat', '毛毛', '星星今天特別多', 7);
  push('chat', '阿寶', '剛剛好像聽到貓頭鷹的聲音', 3);
  db.messages.sort((a, b) => a.createdAt - b.createdAt);
  db.fire = { level: 62, updatedAt: now, lastStokedBy: '月亮' };
}

/** 讓某位在場的夥伴說一句話;mentionNickname 有值時會 @ 那個人 */
export function botSpeak(
  db: LocalDb,
  now: number,
  cfg: RoomConfig,
  mentionNickname: string | null,
  rng: () => number = Math.random,
): void {
  const bots = db.members.filter((m) => m.isBot);
  if (!bots.length) return;
  const speaker = pick(bots, rng);
  const body = mentionNickname ? `@${mentionNickname} ${pick(MENTION_LINES, rng)}` : pick(LINES, rng);
  addMessage(db, { kind: 'chat', nickname: speaker.nickname, body, userId: speaker.userId }, now, cfg);
}

/** 領頭分頁每秒呼叫一次:夥伴偶爾說話、偶爾 @ 真人、偶爾加柴、「路過的人」來來去去 */
export function botStep(db: LocalDb, now: number, cfg: RoomConfig, rng: () => number = Math.random): void {
  // 確保基本夥伴在場
  for (const name of BOT_NAMES) {
    if (!db.members.some((m) => nicknameKey(m.nickname) === nicknameKey(name))) {
      db.members.push(botRow(name, now));
    }
  }
  if (db.botsQuiet) return;

  // 「路過的人」偶爾來去
  if (rng() < 1 / 50) {
    const roamer = db.members.find((m) => m.isBot && m.nickname === ROAMER);
    if (roamer) {
      db.members = db.members.filter((m) => m !== roamer);
      addMessage(db, { kind: 'leave', nickname: ROAMER, body: null, userId: roamer.userId }, now, cfg);
    } else if (!db.members.some((m) => nicknameKey(m.nickname) === nicknameKey(ROAMER))) {
      db.members.push(botRow(ROAMER, now));
      addMessage(db, { kind: 'join', nickname: ROAMER, body: null, userId: `bot:${ROAMER}` }, now, cfg);
    }
  }

  if (rng() < 1 / 18) {
    const humans = db.members.filter((m) => !m.isBot);
    const target = humans.length && rng() < 0.15 ? pick(humans, rng).nickname : null;
    botSpeak(db, now, cfg, target, rng);
  }

  // 夥伴偶爾也會暫離一下又回來(讓一個人打開示範頁面時,也看得到「暫離中」)
  if (rng() < 1 / 100) {
    const bots = db.members.filter((m) => m.isBot && m.nickname !== ROAMER);
    if (bots.length) {
      const b = pick(bots, rng);
      b.away = !b.away;
    }
  }

  // 夥伴很少救火,否則營火永遠不會熄
  const level = currentFireLevel(db, now, cfg);
  if (level > 25 && level < 45 && rng() < 1 / 300) {
    const bots = db.members.filter((m) => m.isBot);
    if (bots.length) {
      const b = pick(bots, rng);
      addFuel(db, b.nickname, b.userId, now, cfg);
    }
  }
}
