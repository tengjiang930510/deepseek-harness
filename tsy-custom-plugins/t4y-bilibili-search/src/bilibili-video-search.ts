import { pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import {
  closeSession,
  createSession,
  type BrowserLaunchOptions,
  type BrowserSession,
} from './browser.ts';

export type BilibiliSearchOrder = 'default' | 'latest' | 'plays' | 'comments' | 'favorites' | 'danmaku';

export interface BilibiliSearchInput {
  keyword: string;
  limit?: number;
  openFirst?: boolean;
  order?: BilibiliSearchOrder;
}

export interface BilibiliVideo {
  title: string;
  author: string;
  publishTime?: string;
  playCount?: string;
  danmakuCount?: string;
  commentCount?: string;
  url: string;
}

export interface BilibiliSearchOutcome {
  videos: BilibiliVideo[];
  page: Page;
}

export class BilibiliSkillError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'EMPTY_KEYWORD'
      | 'PAGE_LOAD_FAILED'
      | 'SEARCH_BOX_MISSING'
      | 'EMPTY_RESULTS'
      | 'RESULT_STRUCTURE_CHANGED'
      | 'OPEN_VIDEO_FAILED'
      | 'INVALID_ORDER',
  ) {
    super(message);
    this.name = 'BilibiliSkillError';
  }
}

const HOME_URL = 'https://www.bilibili.com/';
const SEARCH_VIDEO_URL = 'https://search.bilibili.com/video';
const SHORT_TIMEOUT = 2_000;

const SEARCH_ORDER_QUERY: Record<Exclude<BilibiliSearchOrder, 'default'>, string> = {
  latest: 'pubdate',
  plays: 'click',
  comments: 'scores',
  favorites: 'stow',
  danmaku: 'dm',
};

const SEARCH_ORDER_LABEL: Record<Exclude<BilibiliSearchOrder, 'default'>, string> = {
  latest: '最新发布',
  plays: '最多播放',
  comments: '最多评论',
  favorites: '最多收藏',
  danmaku: '最多弹幕',
};

const SEARCH_ORDER_ALIASES: Record<string, BilibiliSearchOrder> = {
  default: 'default',
  totalrank: 'default',
  综合: 'default',
  综合排序: 'default',
  latest: 'latest',
  pubdate: 'latest',
  最新: 'latest',
  最新发布: 'latest',
  plays: 'plays',
  click: 'plays',
  最多播放: 'plays',
  播放最多: 'plays',
  comments: 'comments',
  scores: 'comments',
  最多评论: 'comments',
  评论最多: 'comments',
  favorites: 'favorites',
  stow: 'favorites',
  最多收藏: 'favorites',
  收藏最多: 'favorites',
  danmaku: 'danmaku',
  dm: 'danmaku',
  最多弹幕: 'danmaku',
  弹幕最多: 'danmaku',
};

export function parseSearchOrder(raw?: string): BilibiliSearchOrder {
  if (raw == null || raw.trim() === '') {
    return 'default';
  }
  const trimmed = raw.trim();
  const resolved = SEARCH_ORDER_ALIASES[trimmed] ?? SEARCH_ORDER_ALIASES[trimmed.toLowerCase()];
  if (!resolved) {
    throw new BilibiliSkillError(`不支持的排序: ${raw}`, 'INVALID_ORDER');
  }
  return resolved;
}

export function searchOrderQuery(order: BilibiliSearchOrder): string | undefined {
  return order === 'default' ? undefined : SEARCH_ORDER_QUERY[order];
}

function searchVideoPageUrl(keyword: string, order: BilibiliSearchOrder = 'default'): string {
  const params = new URLSearchParams({ keyword });
  const query = searchOrderQuery(order);
  if (query) {
    params.set('order', query);
  }
  return `${SEARCH_VIDEO_URL}?${params.toString()}`;
}

function requireKeyword(keyword: string): string {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new BilibiliSkillError('keyword 不能为空', 'EMPTY_KEYWORD');
  }
  return trimmed;
}

function resolveLimit(limit?: number): number {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return Math.floor(limit);
  }
  return 10;
}

export function normalizeBilibiliUrl(href: string | null | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  try {
    const absolute = href.startsWith('http')
      ? href
      : href.startsWith('//')
        ? `https:${href}`
        : new URL(href, HOME_URL).toString();
    const url = new URL(absolute);
    if (!url.hostname.endsWith('bilibili.com')) {
      return undefined;
    }
    if (!/\/video\/(BV[\w]+|av\d+)/i.test(url.pathname)) {
      return undefined;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function assertHomeLoaded(page: Page): Promise<void> {
  const title = await page.title();
  const url = page.url();
  if (!/bilibili|哔哩哔哩/i.test(title) && !/bilibili\.com/i.test(url)) {
    throw new BilibiliSkillError(`页面加载失败: unexpected title "${title}"`, 'PAGE_LOAD_FAILED');
  }
}

async function dismissBlockingDialogs(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
}

/**
 * Codegen: page.getByRole('textbox', { name: 'KEY725' })
 * KEY\d+ is a campaign accessible name and may change; keep role fallbacks.
 */
function searchBox(page: Page) {
  return page
    .getByRole('textbox', { name: 'KEY725' })
    .or(page.getByRole('textbox', { name: /^KEY\d+$/ }))
    .or(page.getByRole('searchbox'))
    .or(page.getByRole('textbox'))
    .first();
}

async function openBilibili(page: Page): Promise<void> {
  try {
    const response = await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) {
      throw new BilibiliSkillError(`页面加载失败: HTTP ${response.status()}`, 'PAGE_LOAD_FAILED');
    }
  } catch (error) {
    if (error instanceof BilibiliSkillError) {
      throw error;
    }
    throw new BilibiliSkillError(
      `页面加载失败: ${error instanceof Error ? error.message : String(error)}`,
      'PAGE_LOAD_FAILED',
    );
  }
  await assertHomeLoaded(page);
}

/**
 * Codegen flow:
 *   searchBox.click()
 *   searchBox.fill(keyword)
 *   const popupPromise = page.waitForEvent('popup')
 *   searchBox.press('Enter')
 *   const searchPage = await popupPromise
 */
async function submitKeywordSearch(
  page: Page,
  keyword: string,
  order: BilibiliSearchOrder = 'default',
): Promise<Page> {
  const box = searchBox(page);
  try {
    await box.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new BilibiliSkillError('搜索框不存在', 'SEARCH_BOX_MISSING');
  }

  await box.click();
  await box.fill(keyword);

  const popupPromise = page.waitForEvent('popup', { timeout: 8_000 }).catch(() => undefined);
  await box.press('Enter');
  const popup = await popupPromise;

  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
    await popup.waitForURL(/search\.bilibili\.com/, { timeout: 8_000 }).catch(() => undefined);
    if (/search\.bilibili\.com/.test(popup.url())) {
      return popup;
    }
  }

  if (/search\.bilibili\.com/.test(page.url())) {
    return page;
  }

  const opened = page.context().pages().find((item) => /search\.bilibili\.com/.test(item.url()));
  if (opened) {
    return opened;
  }

  await page.goto(searchVideoPageUrl(keyword, order), {
    waitUntil: 'domcontentloaded',
  });
  if (!/search\.bilibili\.com/.test(page.url())) {
    throw new BilibiliSkillError('页面加载失败: 搜索结果页未打开', 'PAGE_LOAD_FAILED');
  }
  return page;
}

async function applySearchOrder(page: Page, keyword: string, order: BilibiliSearchOrder): Promise<void> {
  if (order === 'default') {
    return;
  }
  const query = SEARCH_ORDER_QUERY[order];
  const label = SEARCH_ORDER_LABEL[order];
  try {
    if (new URL(page.url()).searchParams.get('order') === query) {
      return;
    }
  } catch {
    // Keep going and apply sort on the current page.
  }

  const sortControl = page
    .getByRole('link', { name: label, exact: true })
    .or(page.getByRole('button', { name: label, exact: true }))
    .or(page.getByRole('tab', { name: label, exact: true }))
    .or(page.getByText(label, { exact: true }))
    .first();

  try {
    await sortControl.waitFor({ state: 'visible', timeout: 8_000 });
    await sortControl.click();
    await page.waitForURL(new RegExp(`[?&]order=${query}(?:&|$)`), { timeout: 10_000 });
  } catch {
    await page.goto(searchVideoPageUrl(keyword, order), { waitUntil: 'domcontentloaded' });
  }

  if (!/search\.bilibili\.com/.test(page.url())) {
    throw new BilibiliSkillError('页面加载失败: 排序后搜索结果页未打开', 'PAGE_LOAD_FAILED');
  }
}

function parseAuthorAndTime(raw: string): { author: string; publishTime?: string } {
  const compact = raw.replace(/\s+/g, ' ').trim();
  const [authorPart, timePart] = compact.split(/[·•・]/).map((part) => part.trim());
  return {
    author: authorPart ?? '',
    publishTime: parsePublishTime(timePart || compact),
  };
}

const PUBLISH_TIME_RE =
  /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(分钟前|小时前|天前|周前|个月前|年前)|昨天|前天)/;

function parsePublishTime(raw: string): string | undefined {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return undefined;
  }
  return compact.match(PUBLISH_TIME_RE)?.[1];
}

/** Codegen: getByRole('link', { name: '皓晨音乐 · 2025年3月18日' }) */
const AUTHOR_LINK_NAME =
  /·\s*(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(分钟前|小时前|天前|周前|个月前|年前)|昨天|前天)/;

const STAT_TOKEN_RE = /^[\d.]+万?$/;

export function isStatToken(value: string): boolean {
  return STAT_TOKEN_RE.test(value);
}

function firstStatToken(raw: string): string | undefined {
  const token = raw.replace(/\s+/g, ' ').trim().split(' ')[0];
  return token && isStatToken(token) ? token : undefined;
}

export interface CardOverlayStats {
  playCount?: string;
  danmakuCount?: string;
}

/**
 * Codegen card name looks like:
 * `${title} 哔哩哔哩播放器 105.1万 2405 22:33:06`
 * After 哔哩哔哩播放器: play, danmaku, then duration. Comment count is not on the card.
 */
export function parseOverlayStatsFromCardName(text: string): CardOverlayStats {
  const compact = text.replace(/\s+/g, ' ').trim();
  const afterPlayer = compact.includes('哔哩哔哩播放器')
    ? compact.slice(compact.indexOf('哔哩哔哩播放器') + '哔哩哔哩播放器'.length)
    : compact;
  const stats = afterPlayer.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = stats.split(' ').filter(isStatToken);
  return {
    playCount: tokens[0],
    danmakuCount: tokens[1],
  };
}

export function parseCommentCountFromVideoText(text: string): string | undefined {
  const compact = text.replace(/\s+/g, ' ').trim();
  const match =
    compact.match(/评论\s*([\d.]+万?)/) ||
    compact.match(/([\d.]+万?)\s*条评论/) ||
    compact.match(/共\s*([\d.]+万?)\s*条评论/);
  const token = match?.[1];
  return token && isStatToken(token) ? token : undefined;
}

export function parsePlayCountFromCardName(text: string): string | undefined {
  return parseOverlayStatsFromCardName(text).playCount;
}

function videoCards(page: Page) {
  return page.locator('.bili-video-card__wrap').filter({
    has: page.locator('a.bili-video-card__info--owner'),
  }).filter({
    has: page.locator('a[href*="/video/BV"], a[href*="/video/av"]'),
  });
}

function coverLinks(page: Page) {
  return page.getByRole('link', { name: /哔哩哔哩播放器/ }).or(
    page.getByRole('link').filter({ has: page.getByRole('img') }),
  );
}

async function readText(locator: ReturnType<Page['locator']>, timeout = SHORT_TIMEOUT): Promise<string> {
  const raw = (await locator.textContent({ timeout }).catch(() => '')) ?? '';
  return raw.replace(/\s+/g, ' ').trim();
}

async function extractFromVideoCard(
  card: ReturnType<Page['locator']>,
): Promise<BilibiliVideo | undefined> {
  const url = normalizeBilibiliUrl(
    await card.locator('a.bili-video-card__image--link, a[href*="/video/BV"], a[href*="/video/av"]').first().getAttribute('href'),
  );
  if (!url) {
    return undefined;
  }

  const headingText = await readText(card.getByRole('heading', { level: 3 }).first());
  const titleFromClass = await readText(card.locator('.bili-video-card__info--tit').first());
  const titleFromImg = (await card.locator('img').first().getAttribute('alt', { timeout: SHORT_TIMEOUT }).catch(() => null))?.trim() ?? '';
  const title = headingText || titleFromClass || titleFromImg;
  if (!title) {
    return undefined;
  }

  const owner = card.locator('a.bili-video-card__info--owner').first();
  const ownerMeta = await owner
    .evaluate((element) => {
      const node = element as HTMLElement;
      return {
        author: node.querySelector('.bili-video-card__info--author')?.textContent?.trim() ?? '',
        date: node.querySelector('.bili-video-card__info--date')?.textContent?.trim() ?? '',
        accessible: (node.getAttribute('aria-label') || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    })
    .catch(() => ({ author: '', date: '', accessible: '' }));
  const fromOwner = parseAuthorAndTime(ownerMeta.accessible || `${ownerMeta.author} ${ownerMeta.date}`);
  const author =
    ownerMeta.author ||
    fromOwner.author ||
    parseAuthorAndTime(await readText(card.getByRole('link', { name: AUTHOR_LINK_NAME }).first())).author;

  const publishTime =
    parsePublishTime(ownerMeta.date) ||
    fromOwner.publishTime ||
    parsePublishTime(await readText(card.locator('.bili-video-card__info--date').first()));

  const cover = card.locator('a.bili-video-card__image--link').or(
    card.getByRole('link', { name: /哔哩哔哩播放器/ }),
  ).first();
  const statsItems = card.locator('.bili-video-card__stats--item');
  const statsCount = await statsItems.count();
  const itemStats: CardOverlayStats = {};
  for (let i = 0; i < statsCount; i += 1) {
    const token = firstStatToken(await readText(statsItems.nth(i)));
    if (!token) {
      continue;
    }
    if (!itemStats.playCount) {
      itemStats.playCount = token;
    } else if (!itemStats.danmakuCount) {
      itemStats.danmakuCount = token;
    }
  }
  const fromCover = parseOverlayStatsFromCardName(`哔哩哔哩播放器 ${await readText(cover)}`);
  const labeled = await card
    .evaluate((element) => {
      const statsRoot = element.querySelector('.bili-video-card__stats') as HTMLElement | null;
      const text = (statsRoot?.innerText || '').replace(/\s+/g, ' ');
      const labeledStat = (label: string) => {
        const match =
          text.match(new RegExp(`([\\d.]+万?)\\s*${label}`)) ??
          text.match(new RegExp(`${label}\\s*([\\d.]+万?)`));
        return match?.[1];
      };
      return {
        playCount: labeledStat('播放') || labeledStat('观看'),
        danmakuCount: labeledStat('弹幕'),
      };
    })
    .catch(() => ({ playCount: undefined, danmakuCount: undefined }));

  return {
    title,
    author,
    publishTime: publishTime || undefined,
    playCount: itemStats.playCount || fromCover.playCount || labeled.playCount,
    danmakuCount: itemStats.danmakuCount || fromCover.danmakuCount || labeled.danmakuCount,
    url,
  };
}

async function extractVideos(page: Page, limit: number): Promise<BilibiliVideo[]> {
  const cards = videoCards(page);
  try {
    await cards.first().waitFor({ state: 'visible', timeout: 25_000 });
  } catch {
    await page.getByRole('heading', { level: 3 }).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  }

  let total = await cards.count();
  const useCssCards = total > 0;
  if (!useCssCards) {
    await coverLinks(page).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  }

  const list = useCssCards ? cards : coverLinks(page);
  total = await list.count();
  if (total === 0) {
    throw new BilibiliSkillError('搜索结果为空', 'EMPTY_RESULTS');
  }

  const videos: BilibiliVideo[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < total && videos.length < limit; i += 1) {
    const item = list.nth(i);
    const video = useCssCards
      ? await extractFromVideoCard(item)
      : undefined;
    if (video && !seen.has(video.url)) {
      seen.add(video.url);
      videos.push(video);
    }
  }

  if (videos.length === 0) {
    throw new BilibiliSkillError(
      '搜索结果结构发生变化：找到结果标题但无法提取有效视频',
      'RESULT_STRUCTURE_CHANGED',
    );
  }

  return videos;
}

async function readCommentCountOnVideoPage(page: Page): Promise<string | undefined> {
  const fromState = await page
    .evaluate(() => {
      const state = (
        window as unknown as {
          __INITIAL_STATE__?: {
            videoData?: { stat?: { reply?: number } };
            videoInfo?: { stat?: { reply?: number } };
          };
        }
      ).__INITIAL_STATE__;
      return state?.videoData?.stat?.reply ?? state?.videoInfo?.stat?.reply;
    })
    .catch(() => undefined);
  if (typeof fromState === 'number' && Number.isFinite(fromState) && fromState >= 0) {
    return String(Math.floor(fromState));
  }

  const commentRoot = page.locator('#commentapp, #comment, bili-comments, .reply-wrap').first();
  await commentRoot.scrollIntoViewIfNeeded().catch(() => undefined);
  await commentRoot.waitFor({ state: 'attached', timeout: 12_000 }).catch(() => undefined);

  const headerHit = commentRoot.getByText(/评论\s*[\d.]+万?/).or(commentRoot.getByText(/[\d.]+万?\s*条评论/)).first();
  await headerHit.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  const fromVisible = parseCommentCountFromVideoText(await readText(headerHit, 3_000));
  if (fromVisible) {
    return fromVisible;
  }

  const fromDom = await page
    .evaluate(() => {
      const chunks: string[] = [];
      const visit = (node: Document | Element | ShadowRoot | null, depth: number) => {
        if (!node || depth > 8) {
          return;
        }
        const host = node as Element;
        if (host.shadowRoot) {
          const sample = (host.shadowRoot.textContent || '').replace(/\s+/g, ' ').trim();
          if (sample.includes('评论') && sample.length < 8_000) {
            chunks.push(sample);
          }
          visit(host.shadowRoot, depth + 1);
        }
        if ('querySelectorAll' in node) {
          for (const child of node.querySelectorAll('*')) {
            if (child.shadowRoot) {
              visit(child, depth + 1);
            }
          }
        }
      };
      visit(document.querySelector('#commentapp, #comment, bili-comments') || document.body, 0);
      return chunks.join(' | ');
    })
    .catch(() => '');
  return parseCommentCountFromVideoText(fromDom);
}

async function fillCommentCounts(searchPage: Page, videos: BilibiliVideo[]): Promise<void> {
  const detail = await searchPage.context().newPage();
  try {
    for (const video of videos) {
      try {
        const response = await detail.goto(video.url, { waitUntil: 'domcontentloaded' });
        if (response && response.status() >= 400) {
          continue;
        }
        await assertVideoPage(detail).catch(() => undefined);
        await dismissBlockingDialogs(detail);
        video.commentCount = await readCommentCountOnVideoPage(detail);
      } catch {
        // Keep search-card fields when a single video page fails.
      }
    }
  } finally {
    await detail.close();
  }
}

async function assertVideoPage(page: Page): Promise<void> {
  await page.waitForURL(/\/video\/(BV|av)/i, { timeout: 20_000 });
  const heading = page.getByRole('heading').first();
  const player = page.getByRole('generic', { name: '哔哩哔哩播放器' }).or(page.locator('video'));
  await Promise.race([
    heading.waitFor({ state: 'visible', timeout: 20_000 }),
    player.first().waitFor({ state: 'visible', timeout: 20_000 }),
  ]);
}

export async function openVideo(url: string, page: Page): Promise<void> {
  const normalized = normalizeBilibiliUrl(url);
  if (!normalized) {
    throw new BilibiliSkillError(`无法打开视频：无效 URL ${url}`, 'OPEN_VIDEO_FAILED');
  }

  try {
    const response = await page.goto(normalized, { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) {
      throw new BilibiliSkillError(`无法打开视频: HTTP ${response.status()}`, 'OPEN_VIDEO_FAILED');
    }
    await assertVideoPage(page);
  } catch (error) {
    if (error instanceof BilibiliSkillError) {
      throw error;
    }
    throw new BilibiliSkillError(
      `无法打开视频: ${error instanceof Error ? error.message : String(error)}`,
      'OPEN_VIDEO_FAILED',
    );
  }
}

/**
 * Codegen: click result link whose accessible name is `${title} 哔哩哔哩播放器`, then wait for popup.
 * Title comes from search results, never a hardcoded video name.
 */
export async function openSearchResult(searchPage: Page, video: BilibiliVideo): Promise<Page> {
  const titlePattern = escapeRegExp(video.title);
  const cardLink = searchPage
    .getByRole('link', { name: new RegExp(`${titlePattern}.*哔哩哔哩播放器`) })
    .or(searchPage.getByRole('link', { name: video.title }))
    .first();

  try {
    await cardLink.waitFor({ state: 'visible', timeout: 15_000 });
    const popupPromise = searchPage.waitForEvent('popup', { timeout: 15_000 });
    await cardLink.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await assertVideoPage(popup);
    return popup;
  } catch (error) {
    if (error instanceof BilibiliSkillError) {
      throw error;
    }
    await openVideo(video.url, searchPage);
    return searchPage;
  }
}

export async function searchVideosOnPage(
  page: Page,
  input: BilibiliSearchInput,
): Promise<BilibiliSearchOutcome> {
  const keyword = requireKeyword(input.keyword);
  const limit = resolveLimit(input.limit);
  const order = input.order ?? 'default';

  await openBilibili(page);
  await dismissBlockingDialogs(page);

  const searchPage = await submitKeywordSearch(page, keyword, order);
  await dismissBlockingDialogs(searchPage);
  await searchPage.getByRole('heading', { level: 3 }).first().waitFor({ state: 'visible', timeout: 25_000 });
  await applySearchOrder(searchPage, keyword, order);
  await searchPage.getByRole('heading', { level: 3 }).first().waitFor({ state: 'visible', timeout: 25_000 });

  const videos = await extractVideos(searchPage, limit);
  await fillCommentCounts(searchPage, videos);

  if (input.openFirst) {
    await openSearchResult(searchPage, videos[0]);
  }

  return { videos, page: searchPage };
}

export async function searchVideos(
  input: BilibiliSearchInput,
  launchOptions?: BrowserLaunchOptions,
): Promise<BilibiliVideo[]> {
  const session: BrowserSession = await createSession(launchOptions);
  try {
    const { videos } = await searchVideosOnPage(session.page, input);
    return videos;
  } finally {
    await closeSession(session);
  }
}

export function parseCliArgs(argv: string[]): BilibiliSearchInput {
  const input: BilibiliSearchInput = { keyword: '', openFirst: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keyword' || arg === '-k') {
      input.keyword = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--limit' || arg === '-n') {
      input.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--order' || arg === '-o') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new BilibiliSkillError('不支持的排序: 缺少 --order 值', 'INVALID_ORDER');
      }
      input.order = parseSearchOrder(value);
      i += 1;
    } else if (arg === '--open-first') {
      input.openFirst = true;
    } else if (!arg.startsWith('-') && !input.keyword) {
      input.keyword = arg;
    }
  }
  return input;
}

async function runCli(): Promise<void> {
  const input = parseCliArgs(process.argv.slice(2));
  const headed = process.env.HEADED === '1' || process.env.HEADED === 'true';
  process.stderr.write(
    `searching keyword=${input.keyword} limit=${input.limit ?? 10} order=${input.order ?? 'default'}\n`,
  );
  const videos = await searchVideos(input, { headed });
  process.stdout.write(`${JSON.stringify(videos, null, 2)}\n`);
}

const isCliMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliMain) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
