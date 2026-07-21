// ==UserScript==
// @name         AliExpress Activity Helper
// @namespace    local.ae.activity.helper
// @version      0.9.3
// @description  速卖通活动助手：批量读取商品管理 SALE 数据并一键普通退出；新品闪电推不支持退出，将自动忽略。
// @homepageURL  https://xinhuaya.github.io/aliexpress-activity-helper/
// @supportURL   https://github.com/xinhuaya/aliexpress-activity-helper/issues
// @updateURL    https://xinhuaya.github.io/aliexpress-activity-helper/stable/aliexpress-activity-helper.meta.js
// @downloadURL  https://xinhuaya.github.io/aliexpress-activity-helper/stable/aliexpress-activity-helper.user.js
// @match        https://*.aliexpress.com/*
// @match        https://gsp.aliexpress.com/*
// @match        https://csp.aliexpress.com/*
// @match        https://seller.aliexpress.com/*
// @match        https://sell.aliexpress.com/*
// @match        https://sale.aliexpress.com/*
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const STORE_KEY = 'ae.activity.assistant.v4';
  const SCRIPT_VERSION = '0.9.3';
  const MAX_BATCH_PRODUCTS = 10;
  const UNIFIED_NAVIGATION_TIMEOUT = 45000;
  const UNIFIED_BUTTON_STABLE_MS = 4000;
  const STOCKOUT_REASON = '库存不足';
  const REQUEST_TIMEOUT_MS = 20000;
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const pageChannelId = new URLSearchParams(pageWindow.location.search).get('channelId') || '';

  const state = {
    productId: '',
    busy: false,
    paused: false,
    pauseReason: '',
    logs: [],
    plan: [],
    scanProductIds: [],
    scanResults: [],
    exitQueue: [],
    exitBatch: null,
    exitFlow: null,
    completionNotice: null,
    autoExit: false,
    lastScanAt: '',
    channelId: '',
    scriptVersion: '',
    ...safeJson(localStorage.getItem(STORE_KEY), {})
  };
  delete state.dryRun;
  delete state.includeEnded;
  const upgradedFromOldVersion = state.scriptVersion !== SCRIPT_VERSION;
  if (upgradedFromOldVersion) {
    state.logs = [];
    state.plan = [];
    state.scanProductIds = [];
    state.scanResults = [];
    state.exitQueue = [];
    state.exitBatch = null;
    state.exitFlow = null;
    state.completionNotice = null;
    state.autoExit = false;
    state.paused = false;
    state.pauseReason = '';
    state.scriptVersion = SCRIPT_VERSION;
  }
  state.paused = Boolean(state.paused);
  state.pauseReason = String(state.pauseReason || '');
  if (!state.autoExit) {
    state.paused = false;
    state.pauseReason = '';
  }
  if (pageChannelId) state.channelId = String(pageChannelId);

  let root;
  let mtopReadyLogged = false;

  function safeJson(text, fallback) {
    try {
      return JSON.parse(text || '');
    } catch {
      return fallback;
    }
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      productId: state.productId,
      logs: state.logs.slice(0, 40),
      plan: state.plan,
      scanProductIds: state.scanProductIds,
      scanResults: state.scanResults,
      exitQueue: state.exitQueue,
      exitBatch: state.exitBatch,
      exitFlow: state.exitFlow,
      completionNotice: state.completionNotice,
      autoExit: state.autoExit,
      paused: state.paused,
      pauseReason: state.pauseReason,
      lastScanAt: state.lastScanAt,
      channelId: state.channelId,
      scriptVersion: SCRIPT_VERSION
    }));
  }

  function formatError(error) {
    if (error == null) return '未知错误';
    if (typeof error === 'string') return error;
    if (error instanceof Error && error.message) return error.message;

    const values = [
      error.message,
      error.msg,
      error.errorMessage,
      error.errorMsg,
      error.ret,
      error.data && (error.data.message || error.data.msg || error.data.ret)
    ];
    for (const value of values) {
      if (Array.isArray(value) && value.length) return value.map(String).join('；');
      if (typeof value === 'string' && value.trim()) return value.trim();
    }

    try {
      const text = JSON.stringify(error);
      if (text && text !== '{}') return text.slice(0, 500);
    } catch {
      // Fall through to a stable message when the platform object is circular.
    }
    return '平台返回了无法识别的错误';
  }

  function scriptError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function isVisibleElement(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasSecurityChallenge() {
    if (typeof document.querySelector !== 'function') return false;
    const punishFrame = document.querySelector('iframe[src*="_____tmd_____/punish"]');
    const baxiaMask = document.querySelector('.baxia-dialog-mask');
    return isVisibleElement(punishFrame) || isVisibleElement(baxiaMask);
  }

  function guardPlatformRequest(request, timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let pollTimer;
      let timeoutTimer;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (pollTimer !== undefined) clearInterval(pollTimer);
        if (timeoutTimer !== undefined && typeof clearTimeout === 'function') clearTimeout(timeoutTimer);
        callback(value);
      };

      if (hasSecurityChallenge()) {
        finish(reject, scriptError('AE_SECURITY_CHALLENGE', '速卖通触发了安全验证，查询已停止。请先手动完成验证或刷新页面，稍后再试。'));
        return;
      }

      pollTimer = setInterval(() => {
        if (hasSecurityChallenge()) {
          finish(reject, scriptError('AE_SECURITY_CHALLENGE', '速卖通触发了安全验证，查询已停止。请先手动完成验证或刷新页面，稍后再试。'));
        }
      }, 250);
      timeoutTimer = setTimeout(() => {
        finish(reject, scriptError('AE_REQUEST_TIMEOUT', `单个活动查询超过 ${Math.round(timeoutMs / 1000)} 秒，已跳过。`));
      }, timeoutMs);
      Promise.resolve(request).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
    });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseProductIds(value = state.productId) {
    const seen = new Set();
    return String(value || '')
      .split(/[\s,，;；]+/)
      .map((item) => item.trim())
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }

  function validatedProductIds() {
    const productIds = parseProductIds();
    if (!productIds.length) {
      log('warn', '请先输入至少一个商品 ID。');
      return [];
    }
    if (productIds.length > MAX_BATCH_PRODUCTS) {
      log('warn', `一次最多处理 ${MAX_BATCH_PRODUCTS} 个商品 ID，当前输入了 ${productIds.length} 个。`);
      return [];
    }
    const invalid = productIds.filter((productId) => !/^\d{10,20}$/.test(productId));
    if (invalid.length) {
      log('warn', `以下商品 ID 格式不正确：${invalid.join('、')}`);
      return [];
    }
    return productIds;
  }

  function sameProductIds(left, right) {
    if (!Array.isArray(left) || left.length !== right.length) return false;
    return left.every((item, index) => String(item) === String(right[index]));
  }

  function log(level, message) {
    state.logs.unshift({
      level,
      message: String(message),
      time: new Date().toLocaleTimeString()
    });
    state.logs = state.logs.slice(0, 80);
    save();
    render();
  }

  function setBusy(value) {
    state.busy = value;
    render();
  }

  function ensureExitQueueRunning() {
    if (state.paused) {
      throw scriptError('AE_USER_PAUSED', state.pauseReason || '用户手动暂停了退出队列。');
    }
  }

  function toggleExitQueuePause() {
    if (!state.autoExit) {
      log('warn', '当前没有正在运行的退出队列。');
      return;
    }
    if (state.paused) {
      state.paused = false;
      state.pauseReason = '';
      log('ok', '已继续退出队列。');
      setTimeout(processExitQueue, 0);
      return;
    }
    state.paused = true;
    state.pauseReason = '用户手动暂停';
    log('warn', '已手动暂停退出队列，当前页面不会再自动操作。');
  }

  function getMtop() {
    return pageWindow.lib && pageWindow.lib.mtop && pageWindow.lib.mtop.request;
  }

  function getQuery() {
    return Object.fromEntries(new URLSearchParams(pageWindow.location.search).entries());
  }

  function getChannelId() {
    const queryChannelId = getQuery().channelId;
    const configChannelId = pageWindow.mtopConfig
      && pageWindow.mtopConfig.queryStringParameters
      && (pageWindow.mtopConfig.queryStringParameters['__channel-id__'] || pageWindow.mtopConfig.queryStringParameters.channelId);
    const detectedChannelId = queryChannelId || configChannelId;
    if (detectedChannelId && String(detectedChannelId) !== String(state.channelId || '')) {
      state.channelId = String(detectedChannelId);
      save();
    }
    return String(detectedChannelId || state.channelId || '');
  }

  async function mtopRequest(options) {
    const request = getMtop();
    if (typeof request !== 'function') {
      throw new Error('页面 MTop 客户端还没加载好，请等页面加载完成后再点一次。');
    }
    const response = await request({
      v: '1.0',
      dataType: 'json',
      ...options
    });
    const ret = response && response.ret;
    if (Array.isArray(ret) && ret.length && !ret.some((item) => String(item).startsWith('SUCCESS'))) {
      throw response;
    }
    return response;
  }

  async function getActivityRender() {
    const query = getQuery();
    if (!query.campaignId || !query.activityId) {
      throw new Error('请先打开任意一个活动报名页，例如“营销 > 平台活动 > 报名活动商品”页面。');
    }
    const response = await mtopRequest({
      api: 'mtop.global.campaign.merchants.activity.render.v2',
      type: 'GET',
      data: {
        campaignId: query.campaignId,
        activityId: query.activityId,
        channelId: getChannelId()
      }
    });
    return response && response.data && response.data.data;
  }

  function collectActivityLists(renderData) {
    const activity = renderData && renderData.activity;
    const query = getQuery();
    const channelId = getChannelId();
    const groups = [];
    if (activity && activity.unionSignGroupInfo) groups.push(activity.unionSignGroupInfo);
    if (activity && Array.isArray(activity.fastSignUnionSignGroups)) {
      groups.push(...activity.fastSignUnionSignGroups);
    }

    const rows = [];
    for (const group of groups) {
      const groupName = group.groupTypeName || group.name || '';
      for (const item of group.activityList || []) {
        rows.push({
          groupName,
          campaignName: item.campaignName || '',
          campaignId: String(item.campaignId || ''),
          activityId: String(item.activityId || ''),
          activityName: item.activityName || item.name || '',
          activityStartTime: String(item.activityStartTime || ''),
          activityEndTime: String(item.activityEndTime || ''),
          showStartTime: String(item.showStartTime || ''),
          oneWayType: item.oneWayType || '',
          activityUrl: item.activityUrl || '',
          channelId: String(item.channelId || channelId)
        });
      }
    }

    if (activity && query.campaignId && query.activityId) {
      rows.push({
        groupName: '当前活动',
        campaignName: activity.campaignName || '',
        campaignId: String(query.campaignId),
        activityId: String(query.activityId),
        activityName: activity.activityName || activity.campaignName || document.title,
        activityStartTime: String(activity.activityStartTime || ''),
        activityEndTime: String(activity.activityEndTime || ''),
        showStartTime: String(activity.showStartTime || ''),
        oneWayType: 'current',
        activityUrl: pageWindow.location.pathname + pageWindow.location.search,
        channelId
      });
    }

    return dedupeActivities(rows).filter((item) => item.campaignId && item.activityId);
  }

  function dedupeActivities(rows) {
    const seen = new Set();
    return rows.filter((item) => {
      const key = `${item.campaignId}:${item.activityId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function unwrapMtopData(response) {
    if (response && response.data && response.data.data !== undefined) return response.data.data;
    if (response && response.data !== undefined) return response.data;
    return response || {};
  }

  function normalizeCatalogActivities(campaignList, tabType) {
    const channelId = getChannelId();
    const rows = [];
    for (const campaign of campaignList || []) {
      for (const activity of campaign.activityList || []) {
        const activityTimeRange = activity.activityTimeRange || {};
        const localizedTimeRanges = parseLocalizedTimeRanges(activity.localizeActTime);
        const localizedTimes = summarizeLocalizedTimes(activity.localizeActTime);
        rows.push({
          groupName: `全店活动/${tabType}`,
          campaignName: campaign.campaignName || campaign.activityName || '',
          campaignId: String(activity.campaignId || campaign.campaignId || ''),
          activityId: String(activity.activityId || ''),
          activityName: activity.activityName || campaign.campaignName || campaign.activityName || '',
          activityStartTime: String(
            activity.activityStartTime || localizedTimes.startTime || activity.onlineStartTime ||
            activity.startTime || activityTimeRange.startTime ||
            campaign.activityStartTime || campaign.startTime || ''
          ),
          activityEndTime: String(
            activity.activityEndTime || localizedTimes.endTime || activity.onlineEndTime ||
            activity.endTime || activityTimeRange.endTime ||
            campaign.activityEndTime || campaign.endTime || ''
          ),
          showStartTime: String(
            activity.showStartTime || localizedTimes.showStartTime || activity.displayStartTime ||
            activity.onlineStartTime || campaign.showStartTime || ''
          ),
          oneWayType: activity.oneWayType || '',
          activityUrl: activity.activityUrl || '',
          channelId: String(activity.channelId || campaign.channelId || channelId),
          localizedTimeRanges
        });
      }
    }
    return rows.filter((item) => item.campaignId && item.activityId);
  }

  function parseLocalizedTimeRanges(value) {
    const rows = Array.isArray(value) ? value : safeJson(value, []);
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      showStartTime: String(row && (row.showStartTime || row.displayStartTime) || ''),
      activityStartTime: String(row && (row.activityStartTime || row.startTime || row.onlineStartTime) || ''),
      activityEndTime: String(row && (row.activityEndTime || row.endTime || row.onlineEndTime) || '')
    })).filter((row) => row.showStartTime || row.activityStartTime || row.activityEndTime);
  }

  function summarizeLocalizedTimes(value) {
    const rows = parseLocalizedTimeRanges(value);
    if (!rows.length) return {};
    const numericValues = (key) => rows
      .map((row) => Number(row && row[key]))
      .filter((item) => Number.isFinite(item) && item > 0);
    const showStarts = numericValues('showStartTime');
    const starts = numericValues('activityStartTime');
    const ends = numericValues('activityEndTime');
    return {
      showStartTime: showStarts.length ? Math.min(...showStarts) : '',
      startTime: starts.length ? Math.min(...starts) : '',
      endTime: ends.length ? Math.max(...ends) : ''
    };
  }

  async function queryActivityCatalogPage(tabType, currentPage) {
    const data = {
      current: currentPage,
      pageSize: 50,
      tabType,
      merchantsType: 'ITEM_MERCHANTS',
      campaignType: 'ALL',
      channelType: '',
      activityJoinStatus: 'ALL',
      promotionType: 'ALL',
      channelId: getChannelId()
    };
    if (tabType === 'ALL') data.activityQualification = 'VALID';

    const response = await mtopRequest({
      api: 'mtop.global.campaign.merchants.activity.list.nodada.data',
      type: 'GET',
      data
    });
    return unwrapMtopData(response);
  }

  async function discoverActivities() {
    const tabTypes = ['PASS', 'AUDITING', 'ALL'];
    const rows = [];

    for (const tabType of tabTypes) {
      let currentPage = 1;
      for (let pageCount = 0; pageCount < 20; pageCount += 1) {
        const data = await queryActivityCatalogPage(tabType, currentPage);
        const campaignList = Array.isArray(data.campaignList) ? data.campaignList : [];
        rows.push(...normalizeCatalogActivities(campaignList, tabType));

        const responsePage = Number(data.currentPage || currentPage);
        const pageSize = Number(data.pageSize || 50);
        const totalCount = Number(data.totalCount || 0);
        if (!campaignList.length || !totalCount || responsePage * pageSize >= totalCount) break;
        currentPage = responsePage + 1;
      }
    }

    return dedupeActivities(rows);
  }

  async function resolveActivities() {
    const query = getQuery();
    let renderError;

    if (query.campaignId && query.activityId) {
      try {
        const renderData = await getActivityRender();
        const related = collectActivityLists(renderData);
        if (related.length) return related;
      } catch (error) {
        renderError = error;
      }
    }

    try {
      log('ok', '正在读取活动编号目录；只用于匹配 SALE 中已经显示的活动，不会逐个查询商品。');
      const activities = await discoverActivities();
      if (!activities.length) throw new Error('平台活动目录为空。');
      return activities;
    } catch (error) {
      if (renderError) {
        throw new Error(`关联活动读取失败：${formatError(renderError)}；全店活动读取失败：${formatError(error)}`);
      }
      throw error;
    }
  }

  function parseTimeRange(text) {
    const match = String(text || '').match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
    return match ? { start: match[1].replace(/\s+/, ' '), end: match[2].replace(/\s+/, ' ') } : null;
  }

  function parseSaleTooltip(tooltip) {
    const activities = [];
    for (const list of tooltip.querySelectorAll('dl')) {
      const sourceText = textOfElement(list.querySelector('dt'));
      const source = sourceText.includes('平台活动') ? '平台活动' : sourceText.includes('店铺活动') ? '店铺活动' : '';
      if (!source) continue;
      let pendingName = '';
      for (const definition of list.querySelectorAll('dd')) {
        const text = textOfElement(definition);
        const range = parseTimeRange(text);
        if (range && pendingName) {
          activities.push({ source, name: pendingName, start: range.start, end: range.end });
          pendingName = '';
        } else if (!range && text) {
          pendingName = text;
        }
      }
    }
    return activities;
  }

  function parseSaleHtml(html) {
    const container = document.createElement('div');
    container.innerHTML = String(html || '');
    return parseSaleTooltip(container);
  }

  function productRowsFromResponse(response) {
    const candidates = [response, response && response.data, response && response.data && response.data.data];
    for (const candidate of candidates) {
      const value = typeof candidate === 'string' ? safeJson(candidate, {}) : candidate;
      const rows = value && value.table && value.table.dataSource;
      if (Array.isArray(rows)) return rows;
    }
    return [];
  }

  function saleActivitiesFromProduct(product) {
    const iconList = product && product.itemDesc && product.itemDesc.iconList;
    if (!Array.isArray(iconList)) return [];
    const saleIcon = iconList.find((icon) => (
      icon && icon.uiType === 'hoverTip' && icon.type === 'text' && String(icon.text || '').trim().toUpperCase() === 'SALE'
    )) || iconList.find((icon) => {
      const html = (icon && icon.hoverTip || [])
        .flatMap((tip) => Array.isArray(tip && tip.dataSource) ? tip.dataSource : [])
        .join('');
      return icon && icon.uiType === 'hoverTip' && /平台活动|店铺活动/.test(html);
    });
    if (!saleIcon) return [];
    const html = (saleIcon.hoverTip || [])
      .flatMap((tip) => Array.isArray(tip && tip.dataSource) ? tip.dataSource : [])
      .join('');
    return parseSaleHtml(html);
  }

  async function queryProductSaleActivities(productId) {
    const channelId = getChannelId();
    if (!channelId) {
      throw new Error('无法识别当前店铺渠道编号。请打开速卖通卖家后台中带 channelId 的页面并刷新后重试。');
    }
    const jsonBody = {
      filter: {
        querySelectInput: { key: 1, value: productId },
        queryRemoveReason: -1,
        queryGroup: '',
        queryRegionalPricing: null,
        queryShippingTemplate: null,
        queryOwner: null,
        queryAuditFailureReason: null,
        queryCategory: '',
        queryEuManage: null,
        queryManufacturer: null,
        queryTurkeyRep: null,
        queryBrand: ''
      },
      pagination: { current: 1, pageSize: 10 },
      tab: 'online_product',
      table: { sort: {} }
    };
    const response = await guardPlatformRequest(mtopRequest({
      api: 'mtop.global.merchant.new.product.manager.render.list',
      type: 'GET',
      data: {
        jsonBody: JSON.stringify(jsonBody),
        from: 'AE-NEW-LISTING',
        bizParam: JSON.stringify({ version: 'simple' }),
        channelId
      }
    }));
    const product = productRowsFromResponse(response)
      .find((item) => String(item && item.productId) === String(productId));
    if (!product) {
      throw new Error(`当前店铺的在售商品中没有找到 ${productId}。请确认商品 ID 和登录店铺正确。`);
    }
    return saleActivitiesFromProduct(product);
  }

  function formatTimeKey(value) {
    if (!value) return '';
    let date;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      date = new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
    } else {
      date = new Date(String(value).replace(/-/g, '/'));
    }
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function normalizeCampaignKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/2026年/g, '')
      .replace(/pay\s*day/g, 'payday')
      .replace(/[\s【】\[\]（）()，,、:_：\-—]/g, '');
  }

  function campaignKey(value) {
    const text = String(value || '');
    const match = text.match(/[【\[]([^】\]]+)[】\]]/);
    return normalizeCampaignKey(match ? match[1] : text);
  }

  function activityKind(value) {
    const text = String(value || '');
    if (text.includes('外围活动')) return '外围';
    if (text.includes('非入围')) return '非入围';
    if (text.includes('入围活动')) return '入围';
    if (text.includes('外围')) return '外围';
    if (text.includes('入围')) return '入围';
    return '';
  }

  function isNewProductFlashActivity(value) {
    const names = value && typeof value === 'object'
      ? [value.name, value.activityName, value.catalogActivityName, value.campaignName]
      : [value];
    return names.some((name) => /新品(?:闪电推|闪推)/.test(String(name || '')));
  }

  function normalizeActivityText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/2026年/g, '')
      .replace(/pay\s*day/g, 'payday')
      .replace(/俄语区/g, 'jv')
      .replace(/活动/g, '')
      .replace(/pop/g, '')
      .replace(/半托管可报/g, '')
      .replace(/[\s【】\[\]（）()，,、:_：\-—&/&]/g, '');
  }

  function bigramScore(left, right) {
    const a = normalizeActivityText(left);
    const b = normalizeActivityText(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const counts = new Map();
    for (let index = 0; index < a.length - 1; index += 1) {
      const pair = a.slice(index, index + 2);
      counts.set(pair, (counts.get(pair) || 0) + 1);
    }
    let overlap = 0;
    for (let index = 0; index < b.length - 1; index += 1) {
      const pair = b.slice(index, index + 2);
      const count = counts.get(pair) || 0;
      if (count > 0) {
        overlap += 1;
        counts.set(pair, count - 1);
      }
    }
    return (2 * overlap) / Math.max(1, a.length + b.length - 2);
  }

  function catalogMatchesSale(activity, saleActivity) {
    const fullName = `${activity.campaignName || ''} ${activity.activityName || ''}`;
    const saleCampaign = campaignKey(saleActivity.name);
    const catalogCampaign = campaignKey(activity.campaignName || activity.activityName);
    if (saleCampaign && catalogCampaign && saleCampaign !== catalogCampaign && !normalizeCampaignKey(fullName).includes(saleCampaign)) return false;
    const saleKind = activityKind(saleActivity.name);
    const catalogKind = activityKind(activity.activityName);
    if (catalogKind === '非入围') return false;
    const isUnifiedInboundEntry = saleActivity.source === '平台活动' && saleKind === '入围' && catalogKind === '外围';
    if (saleKind && catalogKind && saleKind !== catalogKind && !isUnifiedInboundEntry) return false;
    const ranges = [{
      showStartTime: activity.showStartTime,
      activityStartTime: activity.activityStartTime,
      activityEndTime: activity.activityEndTime
    }, ...(activity.localizedTimeRanges || [])];
    return ranges.some((range) => {
      const starts = [formatTimeKey(range.showStartTime), formatTimeKey(range.activityStartTime)].filter(Boolean);
      return starts.includes(saleActivity.start) && formatTimeKey(range.activityEndTime) === saleActivity.end;
    });
  }

  async function matchSaleActivities(saleActivities, catalog, productId) {
    const matched = [];
    const unresolved = [];
    const used = new Set();
    let verifiedCandidateCount = 0;
    let verifiedMatchCount = 0;
    for (const saleActivity of saleActivities) {
      const usedPrefix = `${saleActivity.source || '未知来源'}:`;
      const candidates = catalog
        .filter((activity) => !used.has(`${usedPrefix}${activity.campaignId}:${activity.activityId}`) && catalogMatchesSale(activity, saleActivity))
        .map((activity) => ({ activity, score: bigramScore(saleActivity.name, `${activity.campaignName || ''} ${activity.activityName || ''}`) }))
        .sort((left, right) => right.score - left.score);
      if (!candidates.length) {
        unresolved.push(saleActivity);
        continue;
      }

      const closeCandidates = candidates.filter((candidate) => candidates[0].score - candidate.score < 0.08);
      if (closeCandidates.length === 1) {
        const winner = closeCandidates[0].activity;
        used.add(`${usedPrefix}${winner.campaignId}:${winner.activityId}`);
        matched.push({ saleActivity, activity: winner });
        continue;
      }

      verifiedCandidateCount += closeCandidates.length;
      const verified = [];
      for (const candidate of closeCandidates) {
        const signedItem = await querySignedItem(candidate.activity, productId);
        if (signedItem) verified.push(candidate.activity);
      }
      if (!verified.length) {
        unresolved.push(saleActivity);
        continue;
      }
      for (const activity of verified) {
        used.add(`${usedPrefix}${activity.campaignId}:${activity.activityId}`);
        matched.push({ saleActivity, activity });
      }
      verifiedMatchCount += verified.length;
    }
    return { matched, unresolved, verifiedCandidateCount, verifiedMatchCount };
  }

  function isEnded(activity) {
    const end = Number(activity.activityEndTime || 0);
    return end > 0 && end < Date.now();
  }

  function formatTime(msText) {
    const ms = Number(msText || 0);
    if (!ms) return '';
    return new Date(ms).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function querySignedItem(activity, productId) {
    const response = await guardPlatformRequest(mtopRequest({
      api: 'mtop.global.campaign.merchants.activity.items.query',
      type: 'GET',
      data: {
        campaignId: activity.campaignId,
        activityId: activity.activityId,
        channelId: activity.channelId || getChannelId(),
        currentPage: 1,
        pageSize: 10,
        nameOrId: productId
      }
    }));
    const data = unwrapMtopData(response);
    const list = (data && data.dataList) || [];
    return list.find((item) => String(item.itemId) === String(productId)) || null;
  }

  async function buildPlan() {
    const productIds = validatedProductIds();
    if (!productIds.length) return false;
    state.productId = productIds.join('\n');
    state.plan = [];
    state.scanProductIds = productIds.slice();
    state.scanResults = [];
    save();
    render();

    setBusy(true);
    const plan = [];
    const scanResults = [];
    let catalog = null;
    try {
      for (let index = 0; index < productIds.length; index += 1) {
        const productId = productIds[index];
        log('ok', `正在扫描第 ${index + 1}/${productIds.length} 个商品：${productId}`);
        try {
          const saleActivities = await queryProductSaleActivities(productId);
          if (!saleActivities.length) {
            scanResults.push({
              productId,
              status: 'no_activity',
              activityCount: 0,
              platformCount: 0,
              shopCount: 0,
              message: '没有 SALE 活动标志'
            });
            state.scanResults = scanResults.slice();
            save();
            log('warn', `商品 ${productId} 没有 SALE 活动标志，已跳过。`);
            continue;
          }

          const activeEntries = saleActivities.filter((item) => {
            const end = new Date(item.end.replace(/-/g, '/')).getTime();
            return !end || end >= Date.now();
          });
          const newProductFlashEntries = activeEntries.filter(isNewProductFlashActivity);
          const exitEntries = activeEntries.filter((item) => !isNewProductFlashActivity(item));
          const ignoredNewProductFlashCount = newProductFlashEntries.length;
          const platformCount = exitEntries.filter((item) => item.source === '平台活动').length;
          const shopCount = exitEntries.filter((item) => item.source === '店铺活动').length;
          const ignoredText = ignoredNewProductFlashCount
            ? `；已忽略 ${ignoredNewProductFlashCount} 条新品闪电推`
            : '';
          log('ok', `商品 ${productId} 的 SALE 显示 ${saleActivities.length} 条活动；保留 ${exitEntries.length} 条可退出活动（平台 ${platformCount}，店铺 ${shopCount}）${ignoredText}。`);

          if (!exitEntries.length) {
            const onlyNewProductFlash = ignoredNewProductFlashCount > 0;
            scanResults.push({
              productId,
              status: onlyNewProductFlash ? 'ignored' : 'no_activity',
              activityCount: 0,
              platformCount,
              shopCount,
              ignoredNewProductFlashCount,
              message: onlyNewProductFlash
                ? `仅有 ${ignoredNewProductFlashCount} 条新品闪电推；该类活动不支持退出，已自动忽略。`
                : '没有未结束活动'
            });
            state.scanResults = scanResults.slice();
            save();
            log('warn', onlyNewProductFlash
              ? `商品 ${productId} 只有新品闪电推；该类活动不支持退出，已自动忽略。`
              : `商品 ${productId} 的 SALE 中没有未结束活动，已跳过。`);
            continue;
          }

          if (!catalog) catalog = (await resolveActivities()).filter((item) => !isEnded(item));
          const { matched, unresolved, verifiedCandidateCount, verifiedMatchCount } = await matchSaleActivities(exitEntries, catalog, productId);
          if (verifiedCandidateCount) {
            log('ok', `商品 ${productId} 有相近活动名称；已核对 ${verifiedCandidateCount} 个候选，确认 ${verifiedMatchCount} 个活动编号。`);
          }
          if (unresolved.length) {
            const preview = unresolved.slice(0, 3).map((item) => item.name).join('；');
            throw new Error(`有 ${unresolved.length} 个 SALE 活动无法唯一匹配活动编号：${preview}`);
          }

          const rows = matched.map(({ saleActivity, activity }) => ({
            productId,
            itemId: productId,
            itemName: '',
            campaignId: activity.campaignId,
            activityId: activity.activityId,
            activityName: saleActivity.name,
            catalogActivityName: activity.activityName,
            groupName: saleActivity.source,
            saleSource: saleActivity.source,
            activityStartTime: activity.activityStartTime,
            activityEndTime: activity.activityEndTime,
            showStartTime: activity.showStartTime,
            channelId: activity.channelId || getChannelId(),
            juId: '',
            signRecordId: '',
            itemStatus: 'SALE_VISIBLE',
            stock: ''
          }));
          plan.push(...rows);
          scanResults.push({
            productId,
            status: 'ready',
            activityCount: rows.length,
            platformCount,
            shopCount,
            ignoredNewProductFlashCount,
            message: `${rows.length} 个活动待处理${ignoredNewProductFlashCount ? `；已忽略 ${ignoredNewProductFlashCount} 条新品闪电推` : ''}`
          });
          state.plan = plan.slice();
          state.scanResults = scanResults.slice();
          save();
          log('ok', `商品 ${productId} 核对完成：${rows.length} 个活动可处理${ignoredNewProductFlashCount ? `，另有 ${ignoredNewProductFlashCount} 条新品闪电推已忽略` : ''}。`);
        } catch (error) {
          if (error && error.code === 'AE_SECURITY_CHALLENGE') throw error;
          const message = formatError(error);
          scanResults.push({
            productId,
            status: 'error',
            activityCount: 0,
            platformCount: 0,
            shopCount: 0,
            message
          });
          state.plan = plan.slice();
          state.scanResults = scanResults.slice();
          save();
          log('error', `商品 ${productId} 扫描失败，已跳过：${message}`);
        }
      }

      state.plan = plan;
      state.scanProductIds = productIds.slice();
      state.scanResults = scanResults;
      state.lastScanAt = new Date().toLocaleString();
      save();
      const readyCount = scanResults.filter((item) => item.status === 'ready').length;
      const skippedCount = scanResults.length - readyCount;
      log(plan.length ? 'ok' : 'warn', `批量核对完成：${readyCount}/${productIds.length} 个商品有可处理活动，共 ${plan.length} 个活动${skippedCount ? `；${skippedCount} 个商品无普通活动、仅有新品闪电推或扫描失败` : ''}。`);
      return true;
    } catch (error) {
      state.plan = [];
      state.scanProductIds = [];
      state.scanResults = scanResults;
      save();
      log('error', formatError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function exitPlan() {
    const productIds = validatedProductIds();
    if (!productIds.length) return;
    if (!sameProductIds(state.scanProductIds, productIds)) {
      const scanned = await buildPlan();
      if (!scanned) return;
    }
    if (!state.plan.length) {
      const ignoredNewProductFlashCount = state.scanResults.reduce(
        (total, item) => total + (Number(item.ignoredNewProductFlashCount) || 0),
        0
      );
      log(ignoredNewProductFlashCount ? 'warn' : 'error', ignoredNewProductFlashCount
        ? `只检测到 ${ignoredNewProductFlashCount} 条新品闪电推；该类活动不支持退出，已自动忽略，无需继续处理。`
        : '这些商品没有可执行的退出计划，已停止。');
      return;
    }

    const ignoredNewProductFlashCount = state.scanResults.reduce(
      (total, item) => total + (Number(item.ignoredNewProductFlashCount) || 0),
      0
    );
    const summary = productIds.map((productId) => {
      const count = state.plan.filter((row) => String(row.productId) === productId).length;
      const result = state.scanResults.find((item) => String(item.productId) === productId);
      if (count) return `- ${productId}：${count} 个活动`;
      if (result && result.status === 'ignored') return `- ${productId}：仅有新品闪电推，已忽略`;
      return `- ${productId}：${result && result.status === 'error' ? '扫描失败，将跳过' : '没有未结束活动'}`;
    }).join('\n');
    const queuedProductIds = [...new Set(state.plan.map((row) => String(row.productId || '')))].filter(Boolean);
    const ignoredNewProductFlashProductIds = productIds.filter((productId) => {
      const result = state.scanResults.find((item) => String(item.productId) === productId);
      return result && result.status === 'ignored';
    });
    const skippedProductIds = productIds.filter((productId) => (
      !queuedProductIds.includes(productId) && !ignoredNewProductFlashProductIds.includes(productId)
    ));
    const ok = window.confirm(
      `确认普通退出 ${queuedProductIds.length} 个商品的 ${state.plan.length} 个活动吗？\n\n` +
      `${summary}\n\n` +
      `${ignoredNewProductFlashCount ? `新品闪电推已自动忽略 ${ignoredNewProductFlashCount} 条，不会退出。\n` : ''}` +
      '退出原因：库存不足\n' +
      '单个活动失败会自动暂停并停留在当前页面，检查后可继续。\n' +
      '遇到处罚提示或安全验证也会暂停，不会强行提交。\n' +
      '本脚本不会设置为“不参加活动商品”。'
    );
    if (!ok) {
      log('warn', '已取消退出。');
      return;
    }

    state.exitQueue = state.plan.slice();
    state.exitBatch = {
      productId: productIds[0] || '',
      productIds,
      productCount: productIds.length,
      queuedProductCount: queuedProductIds.length,
      skippedProductIds,
      ignoredNewProductFlashProductIds,
      ignoredNewProductFlashCount,
      total: state.exitQueue.length,
      successCount: 0,
      alreadyExitedCount: 0,
      failedCount: 0,
      failedRows: [],
      startedAt: new Date().toISOString()
    };
    state.exitFlow = null;
    state.completionNotice = null;
    state.autoExit = true;
    state.paused = false;
    state.pauseReason = '';
    save();
    log('ok', `已创建批量退出队列：${queuedProductIds.length} 个商品，共 ${state.exitQueue.length} 个活动。`);
    processExitQueue();
  }

  function visible(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function textOfElement(element) {
    return String(element && (element.innerText || element.textContent || element.value) || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function setNativeInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitForMtop(timeout = 15000) {
    const start = Date.now();
    while (!getMtop()) {
      ensureExitQueueRunning();
      if (Date.now() - start > timeout) throw new Error('页面 MTop 客户端加载超时。');
      await wait(500);
    }
  }

  function activityUrl(row) {
    const channelId = row.channelId || getChannelId();
    return `https://csp.aliexpress.com/m_apps/campaigns/peripheral-activity?campaignId=${encodeURIComponent(row.campaignId)}&activityId=${encodeURIComponent(row.activityId)}&channelId=${encodeURIComponent(channelId)}`;
  }

  function isCurrentActivity(row) {
    const query = getQuery();
    return String(query.campaignId || '') === String(row.campaignId) &&
      String(query.activityId || '') === String(row.activityId);
  }

  function exitRowKey(row) {
    return [row && row.productId, row && row.campaignId, row && row.activityId, row && row.saleSource]
      .map((value) => String(value || ''))
      .join('|');
  }

  function exitFlowMatches(row) {
    return Boolean(state.exitFlow && state.exitFlow.rowKey === exitRowKey(row));
  }

  function ensureUnifiedExitFlow(row) {
    if (!exitFlowMatches(row)) {
      const now = new Date().toISOString();
      state.exitFlow = {
        rowKey: exitRowKey(row),
        stage: 'peripheral',
        targetCampaignId: '',
        targetActivityId: '',
        startedAt: now,
        updatedAt: now
      };
      save();
    }
    return state.exitFlow;
  }

  function updateUnifiedExitFlow(row, values) {
    const flow = ensureUnifiedExitFlow(row);
    state.exitFlow = {
      ...flow,
      ...values,
      updatedAt: new Date().toISOString()
    };
    save();
  }

  function clearExitFlow(row) {
    if (!row || exitFlowMatches(row)) state.exitFlow = null;
  }

  function isUnifiedFlowPage() {
    const path = String(pageWindow.location.pathname || '');
    return path.endsWith('/one-stock-approval') || path.endsWith('/one-stock-goodssign');
  }

  function isUnifiedInboundSignupPage() {
    return String(pageWindow.location.pathname || '').endsWith('/one-stock-goodssign');
  }

  function isCurrentExitPage(row) {
    if (isCurrentActivity(row)) return true;
    if (!usesUnifiedInboundEntry(row) || !exitFlowMatches(row) || !isUnifiedFlowPage()) return false;

    const flow = state.exitFlow || {};
    const updatedAt = Date.parse(flow.updatedAt || flow.startedAt || '');
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt > 30 * 60 * 1000) return false;

    const query = getQuery();
    if (flow.targetCampaignId && String(query.campaignId || '') !== String(flow.targetCampaignId)) return false;
    if (flow.targetActivityId && String(query.activityId || '') !== String(flow.targetActivityId)) return false;
    return true;
  }

  function currentPageActivity(row) {
    const query = getQuery();
    return {
      ...row,
      campaignId: String(query.campaignId || ''),
      activityId: String(query.activityId || ''),
      channelId: getChannelId()
    };
  }

  function clickExactButton(label) {
    const element = [...document.querySelectorAll('button,a,[role="button"]')]
      .find((item) => visible(item) && textOfElement(item) === label);
    if (!element) return false;
    element.click();
    return true;
  }

  function clickExactInteractive(label) {
    const element = [...document.querySelectorAll('button,a,[role="button"],[role="tab"],span,div')]
      .find((item) => visible(item) && textOfElement(item) === label);
    if (!element) return false;
    const target = element.closest && element.closest(
      'button,a,[role="button"],[role="tab"],.ait-tabs-tab,.next-tabs-tab,.ait-steps-item,.next-step-item'
    );
    (target || element).click();
    return true;
  }

  function findButtonStartingWith(label) {
    return [...document.querySelectorAll('button,a,[role="button"]')]
      .find((item) => {
        const className = String(item.className || '');
        return visible(item) &&
          !item.disabled &&
          (!item.getAttribute || item.getAttribute('aria-disabled') !== 'true') &&
          !/(?:^|\s)(?:disabled|loading)(?:\s|$)/i.test(className) &&
          textOfElement(item).startsWith(label);
      });
  }

  function findButtonStartingWithAny(labels) {
    for (const label of labels) {
      const element = findButtonStartingWith(label);
      if (element) return element;
    }
    return null;
  }

  function clickButtonStartingWith(label) {
    const element = findButtonStartingWith(label);
    if (!element) return false;
    element.click();
    return true;
  }

  async function waitForButtonStartingWithAny(labels, timeout = 7000) {
    for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
      ensureExitQueueRunning();
      const button = findButtonStartingWithAny(labels);
      if (button) return button;
      await wait(250);
    }
    return null;
  }

  async function waitForStableButtonStartingWithAny(
    labels,
    timeout = 12000,
    stableMs = UNIFIED_BUTTON_STABLE_MS
  ) {
    let candidate = null;
    let stableFor = 0;
    for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
      ensureExitQueueRunning();
      const current = findButtonStartingWithAny(labels);
      if (current && current === candidate) stableFor += 250;
      else {
        candidate = current;
        stableFor = 0;
      }
      if (candidate && stableFor >= stableMs) return candidate;
      await wait(250);
    }
    return null;
  }

  async function waitForPathChange(pathname, timeout = UNIFIED_NAVIGATION_TIMEOUT) {
    for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
      ensureExitQueueRunning();
      if (String(pageWindow.location.pathname || '') !== pathname) return true;
      await wait(250);
    }
    return false;
  }

  function clickStartsWith(label) {
    const element = [...document.querySelectorAll('button,a,[role="button"],span,div')]
      .find((item) => visible(item) && textOfElement(item).startsWith(`${label}(`));
    if (!element) return false;
    (element.closest('button,a,[role="button"],.ait-tabs-tab,.next-tabs-tab') || element).click();
    return true;
  }

  function dismissMarketingPlanPopup() {
    const dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.ait-dialog,.next-dialog,.next-overlay-wrapper')]
      .filter((element) => visible(element) && textOfElement(element).includes('营销智投计划'));
    for (const dialog of dialogs) {
      const okButton = [...dialog.querySelectorAll('button,a,[role="button"]')]
        .find((element) => visible(element) && textOfElement(element) === '我知道了');
      if (okButton) {
        okButton.click();
        return true;
      }
    }
    return false;
  }

  async function dismissBlockingPopups() {
    for (let index = 0; index < 3; index += 1) {
      if (!dismissMarketingPlanPopup()) return;
      log('ok', '已关闭“营销智投计划”提示弹窗。');
      await wait(800);
    }
  }

  function findActivityProductSearchInput() {
    return [...document.querySelectorAll('input')]
      .find((item) => {
        const placeholder = String(item.placeholder || '');
        return visible(item) && placeholder.startsWith('支持商品ID') && placeholder.includes('搜索');
      }) || null;
  }

  async function waitForActivityProductSearchInput(timeout = 7000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      ensureExitQueueRunning();
      const input = findActivityProductSearchInput();
      if (input) return input;
      await wait(250);
    }
    return null;
  }

  function activitySearchInputHelp(row) {
    const step = row && row.saleSource === '平台活动'
      ? '第 4 步“入围活动报名”'
      : '第 2 步“外围活动报名”';
    return `没有找到商品 ID 搜索框。请确认已进入正确活动页面，并手动点击${step}，再进入“商品报名 > 已报名”后重试。`;
  }

  function usesUnifiedInboundEntry(row) {
    return Boolean(
      row &&
      row.saleSource === '平台活动' &&
      activityKind(row.activityName) === '入围' &&
      activityKind(row.catalogActivityName) === '外围'
    );
  }

  async function ensureUnifiedInboundActivity(row) {
    ensureExitQueueRunning();
    ensureUnifiedExitFlow(row);
    const path = String(pageWindow.location.pathname || '');

    if (path.endsWith('/one-stock-goodssign')) {
      const target = currentPageActivity(row);
      if (!target.campaignId || !target.activityId) {
        throw new Error('入围活动页面缺少活动编号，无法继续。');
      }
      updateUnifiedExitFlow(row, {
        stage: 'inbound',
        targetCampaignId: target.campaignId,
        targetActivityId: target.activityId
      });
      return target;
    }

    if (path.endsWith('/one-stock-approval')) {
      const labels = ['下一步，报名入围活动', '下一步,报名入围活动'];
      const nextButton = await waitForStableButtonStartingWithAny(labels, 15000);
      if (!nextButton) throw new Error('店铺资质审核页没有找到“下一步，报名入围活动”按钮。');
      const target = currentPageActivity(row);
      updateUnifiedExitFlow(row, {
        stage: 'opening-inbound',
        targetCampaignId: target.campaignId,
        targetActivityId: target.activityId
      });
      log('ok', '店铺资质审核已通过，正在进入第 4 步“入围活动报名”。');
      ensureExitQueueRunning();
      nextButton.click();
      await waitForPathChange(path);
      return null;
    }

    if (!path.endsWith('/peripheral-activity')) {
      throw new Error('当前不在统一活动报名入口，无法进入平台入围活动。');
    }

    const labels = ['下一步，开始报名入围活动', '下一步,开始报名入围活动'];
    let nextButton = findButtonStartingWithAny(labels);
    if (!nextButton) {
      ensureExitQueueRunning();
      const opened = clickExactButton('开始报名活动商品') || clickExactInteractive('商品报名');
      if (!opened) throw new Error('外围活动页没有找到“开始报名活动商品”入口。');
      log('ok', '正在打开第 2 步“外围活动报名”的商品列表。');
      await wait(1800);
      await dismissBlockingPopups();
      nextButton = await waitForButtonStartingWithAny(labels, 10000);
    }
    if (!nextButton) throw new Error('外围商品报名页没有找到“下一步，开始报名入围活动”按钮。');

    updateUnifiedExitFlow(row, {
      stage: 'qualification',
      targetCampaignId: '',
      targetActivityId: ''
    });
    log('ok', '正在从外围报名进入第 3 步“店铺资质审核”。');
    ensureExitQueueRunning();
    nextButton.click();
    await waitForPathChange(path);
    return null;
  }

  async function enterActivitySignupStep(row) {
    const unifiedInboundEntry = usesUnifiedInboundEntry(row);
    let input = findActivityProductSearchInput();
    if (input && (!unifiedInboundEntry || isUnifiedInboundSignupPage())) return input;
    if (unifiedInboundEntry && !isUnifiedInboundSignupPage()) {
      throw new Error('尚未进入第 4 步“入围活动报名”，无法搜索平台活动商品。');
    }
    const preferredStep = row && row.saleSource === '平台活动' ? '入围活动报名' : '外围活动报名';
    const productAction = { label: '商品报名', click: () => clickExactInteractive('商品报名') };
    const startAction = { label: '开始报名活动商品', click: () => clickExactButton('开始报名活动商品') };
    const preferredAction = {
      label: preferredStep,
      click: () => clickExactInteractive(preferredStep)
    };
    const standardActions = [
      productAction,
      startAction,
      { label: '同意并下一步', click: () => clickButtonStartingWith('同意并下一步') },
      preferredAction
    ];
    const actions = unifiedInboundEntry
      ? [startAction, productAction]
      : standardActions;
    for (const action of actions) {
      ensureExitQueueRunning();
      if (!action.click()) continue;
      log('ok', `正在进入“${action.label}”页面。`);
      await wait(1200);
      await dismissBlockingPopups();
      input = await waitForActivityProductSearchInput(7000);
      if (input) return input;
    }
    throw new Error(activitySearchInputHelp(row));
  }

  async function openSignedListAndSearch(row, productId) {
    ensureExitQueueRunning();
    await dismissBlockingPopups();
    ensureExitQueueRunning();
    let input = await enterActivitySignupStep(row);
    await dismissBlockingPopups();
    ensureExitQueueRunning();
    if (clickStartsWith('已报名')) await wait(3500);
    await dismissBlockingPopups();
    ensureExitQueueRunning();

    input = findActivityProductSearchInput() || await waitForActivityProductSearchInput(7000);
    if (!input) throw new Error(activitySearchInputHelp(row));

    ensureExitQueueRunning();
    input.focus();
    setNativeInputValue(input, productId);
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true
    }));
    await wait(5500);
    ensureExitQueueRunning();
  }

  function findQuitButton(productId) {
    const containers = [...document.querySelectorAll('tr,.next-table-row,.ait-table-row,div')]
      .filter((element) => visible(element) && textOfElement(element).includes(productId));
    for (const row of containers) {
      const button = [...row.querySelectorAll('button,a,[role="button"],span')]
        .find((element) => visible(element) && textOfElement(element) === '申请退出活动');
      if (button) return button.closest('button,a,[role="button"]') || button;
    }
    return [...document.querySelectorAll('button,a,[role="button"]')]
      .find((element) => visible(element) && textOfElement(element) === '申请退出活动');
  }

  function compactUiText(value) {
    return String(value || '').replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
  }

  function findExitDialog() {
    const matchesExitDialog = (element) => {
      if (!visible(element)) return false;
      const text = textOfElement(element);
      return text.includes('确认申请退出本次活动') || text.includes('请选择退出活动原因');
    };
    const primary = [...document.querySelectorAll(
      '[role="dialog"],[aria-modal="true"],.ait-dialog,.next-dialog,.next-overlay-wrapper,.ant-modal,.arco-modal,.semi-modal'
    )].filter(matchesExitDialog);
    const dialogs = (primary.length ? primary : [...document.querySelectorAll(
      '[class*="dialog"],[class*="Dialog"],[class*="modal"],[class*="Modal"]'
    )].filter(matchesExitDialog))
      .sort((left, right) => textOfElement(left).length - textOfElement(right).length);
    return dialogs[0] || null;
  }

  function exitPenaltyWarning(dialog = findExitDialog()) {
    if (!dialog) return '';
    const text = textOfElement(dialog);
    let warningText = text;
    for (const safePhrase of ['不触发处罚', '不会触发处罚', '不产生处罚', '不受处罚', '无需承担处罚']) {
      warningText = warningText.replaceAll(safePhrase, '');
    }
    const hasRisk = /触发(?:平台)?处罚|处罚生效|退出[^。；]{0,30}(?:扣分|违约|处罚|限制)|(?:扣分|违约金|账号处罚|活动处罚|限制后续报名)/.test(warningText);
    return hasRisk ? text.slice(0, 220) : '';
  }

  function findExitReasonOption(dialog, reasonLabel) {
    if (!dialog) return null;
    const expected = compactUiText(reasonLabel);
    const candidates = [...dialog.querySelectorAll(
      'label,[role="radio"],input[type="radio"],.ait-radio-wrapper,.next-radio-wrapper,.ant-radio-wrapper,.arco-radio,.semi-radio,[class*="radio"],[class*="Radio"],span,div'
    )]
      .map((element) => {
        const text = compactUiText(textOfElement(element) || (element.getAttribute && element.getAttribute('aria-label')));
        return { element, text };
      })
      .filter((item) => item.text === expected || (item.text.startsWith(expected) && item.text.length <= expected.length + 40))
      .sort((left, right) => left.text.length - right.text.length);

    for (const { element } of candidates) {
      const target = element.closest && element.closest(
        'label,[role="radio"],.ait-radio-wrapper,.next-radio-wrapper,.ant-radio-wrapper,.arco-radio,.semi-radio,[class*="radio"],[class*="Radio"]'
      );
      const clickable = target || element;
      if (visible(clickable)) return clickable;
    }
    return null;
  }

  async function waitForExitReason(reasonLabel, timeout = 10000) {
    let sawDialog = false;
    for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
      ensureExitQueueRunning();
      const dialog = findExitDialog();
      if (dialog) {
        sawDialog = true;
        const warning = exitPenaltyWarning(dialog);
        if (warning) {
          throw scriptError('AE_EXIT_REVIEW_REQUIRED', `退出弹窗提示可能存在处罚或限制，请人工确认：${warning}`);
        }
        const reason = findExitReasonOption(dialog, reasonLabel);
        if (reason) return { dialog, reason };
      }
      await wait(250);
    }
    if (!sawDialog) {
      throw new Error('点击“申请退出活动”后没有检测到退出弹窗，请人工查看当前页面。');
    }
    throw new Error(`退出弹窗里没有找到“${reasonLabel}”。`);
  }

  async function waitForEnabledExitButton(dialog, timeout = 5000) {
    let button = null;
    for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
      ensureExitQueueRunning();
      button = [...dialog.querySelectorAll('button')]
        .find((element) => visible(element) && textOfElement(element) === '退出活动') || null;
      if (button && !button.disabled && (!button.getAttribute || button.getAttribute('aria-disabled') !== 'true')) {
        return button;
      }
      await wait(250);
    }
    if (!button) throw new Error('退出弹窗里没有找到普通“退出活动”按钮。');
    throw new Error('普通“退出活动”按钮当前不可用，请人工查看平台提示。');
  }

  async function submitQuitByPage(productId) {
    ensureExitQueueRunning();
    const quitButton = findQuitButton(productId);
    if (!quitButton) throw new Error(`没有找到商品 ${productId} 的“申请退出活动”按钮。`);
    quitButton.click();
    const { dialog, reason } = await waitForExitReason(STOCKOUT_REASON);
    ensureExitQueueRunning();
    reason.click();
    ensureExitQueueRunning();

    const warningBeforeSubmit = exitPenaltyWarning(dialog);
    if (warningBeforeSubmit) {
      throw scriptError('AE_EXIT_REVIEW_REQUIRED', `退出弹窗提示可能存在处罚或限制，请人工确认：${warningBeforeSubmit}`);
    }

    const submitButton = await waitForEnabledExitButton(dialog);
    ensureExitQueueRunning();
    submitButton.click();
    await wait(7000);
    ensureExitQueueRunning();
  }

  function createBatchCompletionNotice(batch, extra = {}) {
    const productIds = Array.isArray(batch.productIds) && batch.productIds.length
      ? batch.productIds.map(String)
      : parseProductIds(batch.productId || state.productId);
    const successCount = Number(batch.successCount) || 0;
    const alreadyExitedCount = Number(batch.alreadyExitedCount) || 0;
    const failedCount = Number(batch.failedCount) || 0;
    return {
      productId: productIds[0] || '',
      productIds,
      productCount: Number(batch.productCount) || productIds.length,
      queuedProductCount: Number(batch.queuedProductCount) || productIds.length,
      skippedProductIds: Array.isArray(batch.skippedProductIds) ? batch.skippedProductIds.map(String) : [],
      ignoredNewProductFlashProductIds: Array.isArray(batch.ignoredNewProductFlashProductIds)
        ? batch.ignoredNewProductFlashProductIds.map(String)
        : [],
      ignoredNewProductFlashCount: Number(batch.ignoredNewProductFlashCount) || 0,
      total: Number(batch.total) || successCount + alreadyExitedCount + failedCount,
      successCount,
      alreadyExitedCount,
      failedCount,
      failedRows: Array.isArray(batch.failedRows) ? batch.failedRows.slice() : [],
      completedAt: new Date().toISOString(),
      ...extra
    };
  }

  async function processExitQueue() {
    if (!state.autoExit || state.paused || state.busy) return;
    if (!state.exitQueue.length) {
      const batch = state.exitBatch && typeof state.exitBatch === 'object' ? state.exitBatch : {};
      state.autoExit = false;
      state.paused = false;
      state.pauseReason = '';
      state.completionNotice = createBatchCompletionNotice(batch);
      state.exitBatch = null;
      state.exitFlow = null;
      state.plan = [];
      state.scanProductIds = [];
      state.scanResults = [];
      log('ok', `批量退出队列已完成：${state.completionNotice.productCount} 个商品，共 ${state.completionNotice.total} 个活动。请刷新商品管理页复查。`);
      return;
    }

    const row = state.exitQueue[0];
    const productId = String(row.productId || state.productId || '').trim();
    if (!productId) {
      state.autoExit = false;
      state.paused = false;
      state.pauseReason = '';
      state.exitFlow = null;
      save();
      log('error', '退出队列缺少商品 ID，已停止。');
      return;
    }

    if (isNewProductFlashActivity(row)) {
      state.exitQueue.shift();
      state.plan = state.plan.filter((item) => exitRowKey(item) !== exitRowKey(row));
      if (state.exitBatch) {
        state.exitBatch.ignoredNewProductFlashCount = (Number(state.exitBatch.ignoredNewProductFlashCount) || 0) + 1;
      }
      save();
      log('warn', `已忽略新品闪电推：${row.activityName || row.activityId}。该类活动不支持退出。`);
      setTimeout(processExitQueue, 500);
      return;
    }

    const unifiedInboundEntry = usesUnifiedInboundEntry(row);
    if (!isCurrentExitPage(row)) {
      if (unifiedInboundEntry) ensureUnifiedExitFlow(row);
      else clearExitFlow();
      save();
      log('ok', `跳转活动：${row.activityName || row.activityId}`);
      pageWindow.location.href = activityUrl(row);
      return;
    }

    setBusy(true);
    try {
      ensureExitQueueRunning();
      await waitForMtop();
      await dismissBlockingPopups();
      ensureExitQueueRunning();
      let verificationActivity = row;
      if (unifiedInboundEntry) {
        log('ok', '检测到外围与入围共用报名入口；将依次进入外围报名、店铺资质审核和入围报名。');
        verificationActivity = await ensureUnifiedInboundActivity(row);
        if (!verificationActivity) return;
      }

      const before = await querySignedItem(verificationActivity, productId);
      ensureExitQueueRunning();
      if (before && before.itemStatus === 'OPERATOR_EXIT') {
        state.exitQueue.shift();
        if (state.exitBatch) {
          state.exitBatch.alreadyExitedCount = (Number(state.exitBatch.alreadyExitedCount) || 0) + 1;
        }
        state.plan = state.plan.filter((item) => exitRowKey(item) !== exitRowKey(row));
        clearExitFlow(row);
        save();
        log('ok', `已是退出状态：${row.activityName || row.activityId}`);
        return;
      }

      await openSignedListAndSearch(row, productId);
      await submitQuitByPage(productId);

      const after = await querySignedItem(verificationActivity, productId);
      ensureExitQueueRunning();
      if (after && after.itemStatus === 'OPERATOR_EXIT') {
        state.exitQueue.shift();
        if (state.exitBatch) {
          state.exitBatch.successCount = (Number(state.exitBatch.successCount) || 0) + 1;
        }
        state.plan = state.plan.filter((item) => exitRowKey(item) !== exitRowKey(row));
        clearExitFlow(row);
        save();
        log('ok', `退出成功：${row.activityName || row.activityId}`);
      } else {
        throw new Error(`提交后没有查到退出状态：${row.activityName || row.activityId}`);
      }
    } catch (error) {
      const message = formatError(error);
      if (error && error.code === 'AE_USER_PAUSED') {
        log('warn', `退出队列已暂停：${state.pauseReason || message}。请查看当前页面，确认后点击“继续处理”。`);
      } else if (error && error.code === 'AE_SECURITY_CHALLENGE') {
        state.paused = true;
        state.pauseReason = message;
        log('error', `检测到平台安全验证，退出队列已暂停并保留当前任务：${message}`);
      } else {
        state.exitQueue.shift();
        if (state.exitBatch) {
          state.exitBatch.failedCount = (Number(state.exitBatch.failedCount) || 0) + 1;
          if (!Array.isArray(state.exitBatch.failedRows)) state.exitBatch.failedRows = [];
          state.exitBatch.failedRows.push({
            productId,
            activityName: String(row.activityName || row.activityId || ''),
            message
          });
        }
        state.plan = state.plan.filter((item) => exitRowKey(item) !== exitRowKey(row));
        clearExitFlow(row);
        state.paused = true;
        state.pauseReason = `${row.activityName || row.activityId || '当前活动'}：${message}`;
        log('error', `商品 ${productId} 的活动处理失败，队列已自动暂停并停留在当前页面：${message}`);
      }
    } finally {
      setBusy(false);
      if (state.autoExit && !state.paused) setTimeout(processExitQueue, 1200);
    }
  }

  function css() {
    return `
      #aeaa-root { position: fixed; right: 18px; bottom: 18px; width: min(470px, calc(100vw - 24px)); z-index: 2147483647; color: #17231f; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
      #aeaa-root * { box-sizing: border-box; letter-spacing: 0; }
      .aeaa-box { border: 1px solid #2b3b36; background: #fbfaf6; box-shadow: 0 18px 50px rgba(0,0,0,.24); border-radius: 8px; overflow: hidden; }
      .aeaa-head { min-height: 42px; background: #20352f; color: #f7f4ea; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; font-weight: 700; }
      .aeaa-head small { color: #a8d7bd; font-weight: 500; }
      .aeaa-body { padding: 12px; }
      .aeaa-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
      .aeaa-input { width: 100%; min-width: 0; min-height: 68px; max-height: 150px; resize: vertical; border: 1px solid #a9b4aa; border-radius: 6px; background: #fff; padding: 8px 10px; font: 13px/1.45 "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
      .aeaa-actions .aeaa-btn { flex: 1; }
      .aeaa-btn { height: 34px; border: 1px solid #243b34; border-radius: 6px; background: #273d36; color: white; font-weight: 700; cursor: pointer; white-space: nowrap; padding: 0 12px; }
      .aeaa-btn.secondary { background: #fff; color: #1c2d28; border-color: #a9b4aa; }
      .aeaa-btn.danger { background: #b42318; border-color: #9b1c13; }
      .aeaa-btn.warning { background: #a15c08; border-color: #824906; }
      .aeaa-btn:disabled { opacity: .55; cursor: not-allowed; }
      .aeaa-note { margin: 0 0 8px; color: #56645d; font-size: 12px; line-height: 1.45; }
      .aeaa-pause-note { margin: 0 0 8px; padding: 9px 10px; border: 1px solid #e2a84a; border-radius: 6px; background: #fff8e8; color: #604813; font-size: 12px; line-height: 1.5; }
      .aeaa-pause-note strong { display: block; margin-bottom: 2px; color: #7b4300; }
      .aeaa-plan { max-height: 230px; overflow: auto; border: 1px solid #d0c8ba; border-radius: 6px; background: #fff; font-size: 12px; margin-top: 8px; }
      .aeaa-product-head { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; background: #edf3ef; color: #17231f; font-weight: 800; border-bottom: 1px solid #d8ded9; }
      .aeaa-product-head span:last-child { color: #56645d; font-weight: 600; white-space: nowrap; }
      .aeaa-product-status { padding: 9px 10px; color: #7a4b16; background: #fff8e8; border-bottom: 1px solid #ece7da; line-height: 1.45; }
      .aeaa-item { padding: 8px 10px; border-bottom: 1px solid #ece7da; }
      .aeaa-item:last-child { border-bottom: 0; }
      .aeaa-name { color: #17231f; font-weight: 700; line-height: 1.35; }
      .aeaa-meta { color: #6b766e; margin-top: 3px; line-height: 1.35; }
      .aeaa-empty { padding: 10px; color: #6b766e; }
      .aeaa-log { margin-top: 8px; max-height: 140px; overflow: auto; background: #151d1a; color: #d7e3d9; border: 1px solid #d0c8ba; border-radius: 6px; font: 11px Consolas, "Cascadia Mono", monospace; }
      .aeaa-log div { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.06); line-height: 1.4; }
      .aeaa-log .ok { color:#9de0b1; } .aeaa-log .warn { color:#ffd17d; } .aeaa-log .error { color:#ff9b8f; }
      .aeaa-completion-backdrop { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(12, 24, 20, .58); }
      .aeaa-completion-dialog { width: min(420px, calc(100vw - 32px)); border: 1px solid #2b3b36; border-radius: 8px; background: #fff; box-shadow: 0 24px 70px rgba(0,0,0,.35); padding: 24px; text-align: center; }
      .aeaa-completion-icon { width: 52px; height: 52px; margin: 0 auto 12px; border-radius: 50%; display: grid; place-items: center; background: #dff5e6; color: #176b3a; font-size: 30px; font-weight: 800; }
      .aeaa-completion-title { margin: 0; color: #17231f; font-size: 21px; line-height: 1.3; }
      .aeaa-completion-copy { margin: 8px 0 16px; color: #56645d; font-size: 13px; line-height: 1.55; }
      .aeaa-completion-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #d8ded9; border-radius: 6px; overflow: hidden; background: #f7faf8; }
      .aeaa-completion-stat { min-width: 0; padding: 11px 6px; border-right: 1px solid #d8ded9; }
      .aeaa-completion-stat:last-child { border-right: 0; }
      .aeaa-completion-value { display: block; color: #17231f; font-size: 20px; font-weight: 800; }
      .aeaa-completion-label { display: block; margin-top: 2px; color: #6b766e; font-size: 11px; }
      .aeaa-completion-reminder { margin: 14px 0; padding: 10px; border-left: 4px solid #d99b24; background: #fff8e8; color: #604813; text-align: left; font-size: 12px; line-height: 1.55; }
      .aeaa-completion-dialog .aeaa-btn { min-width: 120px; }
    `;
  }

  function renderCompletionNotice() {
    const notice = state.completionNotice;
    if (!notice || typeof notice !== 'object') return '';
    const productIds = Array.isArray(notice.productIds) && notice.productIds.length
      ? notice.productIds.map(String)
      : parseProductIds(notice.productId || '');
    const productCount = Number(notice.productCount) || productIds.length || 1;
    const failedCount = Number(notice.failedCount) || 0;
    const skippedProductIds = Array.isArray(notice.skippedProductIds) ? notice.skippedProductIds.map(String) : [];
    const failedRows = Array.isArray(notice.failedRows) ? notice.failedRows : [];
    const ignoredNewProductFlashCount = Number(notice.ignoredNewProductFlashCount) || 0;
    const reviewProductIds = [...new Set([
      ...skippedProductIds,
      ...failedRows.map((item) => String(item.productId || '')).filter(Boolean)
    ])];
    const reviewCount = failedCount + skippedProductIds.length;
    const reviewText = reviewProductIds.length
      ? `需复查商品：${reviewProductIds.slice(0, 6).join('、')}${reviewProductIds.length > 6 ? ` 等 ${reviewProductIds.length} 个` : ''}。`
      : '';
    const title = notice.stopped ? '批量退出已暂停' : '批量退出完成';
    const copy = notice.stopped
      ? `${productCount} 个商品的任务因平台安全验证而暂停。`
      : `${productCount} 个商品的退出队列已全部处理。`;
    const reminder = notice.stopped
      ? `${escapeHtml(notice.stoppedReason || '请先完成平台安全验证。')} ${escapeHtml(reviewText)}`
      : `${ignoredNewProductFlashCount ? `新品闪电推已自动忽略 ${escapeHtml(ignoredNewProductFlashCount)} 条，不计入失败。` : ''}${escapeHtml(reviewText)}请刷新商品管理页，把鼠标移到 SALE 标签上复查。商品优化完成后，记得重新报名需要参加的活动。`;
    return `
      <div class="aeaa-completion-backdrop" role="dialog" aria-modal="true" aria-labelledby="aeaa-completion-title">
        <div class="aeaa-completion-dialog">
          <div class="aeaa-completion-icon" aria-hidden="true">${notice.stopped ? '!' : '✓'}</div>
          <h2 class="aeaa-completion-title" id="aeaa-completion-title">${title}</h2>
          <p class="aeaa-completion-copy">${copy}</p>
          <div class="aeaa-completion-stats">
            <div class="aeaa-completion-stat"><span class="aeaa-completion-value">${escapeHtml(productCount)}</span><span class="aeaa-completion-label">商品</span></div>
            <div class="aeaa-completion-stat"><span class="aeaa-completion-value">${escapeHtml(notice.total || 0)}</span><span class="aeaa-completion-label">活动</span></div>
            <div class="aeaa-completion-stat"><span class="aeaa-completion-value">${escapeHtml(notice.successCount || 0)}</span><span class="aeaa-completion-label">退出成功</span></div>
            <div class="aeaa-completion-stat"><span class="aeaa-completion-value">${escapeHtml(reviewCount)}</span><span class="aeaa-completion-label">需复查</span></div>
          </div>
          <p class="aeaa-completion-copy">退出成功 ${escapeHtml(notice.successCount || 0)}，原本已退出 ${escapeHtml(notice.alreadyExitedCount || 0)}，处理失败 ${escapeHtml(failedCount)}。</p>
          <div class="aeaa-completion-reminder">${reminder}</div>
          <button class="aeaa-btn" data-act="dismiss-completion">知道了</button>
        </div>
      </div>`;
  }

  function renderPlan() {
    if (!state.plan.length && !state.scanResults.length) {
      return '<div class="aeaa-empty">还没有计划。输入 1-10 个商品 ID 后点击“查报名活动”。</div>';
    }
    const productIds = state.scanProductIds.length
      ? state.scanProductIds.map(String)
      : [...new Set(state.plan.map((row) => String(row.productId || '')))].filter(Boolean);
    return productIds.map((productId) => {
      const rows = state.plan.filter((row) => String(row.productId || '') === productId);
      const result = state.scanResults.find((item) => String(item.productId || '') === productId);
      const status = result && (result.status !== 'ready' || Number(result.ignoredNewProductFlashCount) > 0)
        ? `<div class="aeaa-product-status">${escapeHtml(result.message || '没有可处理活动')}</div>`
        : '';
      return `
        <div class="aeaa-product-group">
          <div class="aeaa-product-head"><span>${escapeHtml(productId)}</span><span>${rows.length} 个活动</span></div>
          ${status}
          ${rows.map((row) => `
            <div class="aeaa-item">
              <div class="aeaa-name">${escapeHtml(row.activityName || row.activityId)}</div>
              <div class="aeaa-meta">来源: ${escapeHtml(row.saleSource || row.groupName || '-')} / activityId: ${escapeHtml(row.activityId)} / campaignId: ${escapeHtml(row.campaignId)}</div>
              <div class="aeaa-meta">预热: ${escapeHtml(formatTime(row.showStartTime) || '-')}，结束: ${escapeHtml(formatTime(row.activityEndTime) || '-')}</div>
            </div>
          `).join('')}
        </div>`;
    }).join('');
  }

  function render() {
    if (!root) return;
    const controlsDisabled = state.busy || state.autoExit ? 'disabled' : '';
    const pauseDisabled = !state.autoExit || (state.paused && state.busy) ? 'disabled' : '';
    const statusText = state.paused ? '已暂停' : (state.busy ? '处理中...' : (state.autoExit ? '等待处理' : '极速退出'));
    root.innerHTML = `
      <style>${css()}</style>
      ${renderCompletionNotice()}
      <div class="aeaa-box">
        <div class="aeaa-head">
          <span>AE 活动助手 <small>${statusText}</small></span>
          <button class="aeaa-btn secondary" data-act="min">-</button>
        </div>
        <div class="aeaa-body">
          <p class="aeaa-note">每行输入一个商品 ID，最多 10 个；新品闪电推不支持退出，扫描时会自动忽略。</p>
          <div class="aeaa-row">
            <textarea class="aeaa-input" data-field="product" placeholder="商品 ID，每行一个（最多 10 个）" ${controlsDisabled}>${escapeHtml(state.productId || '')}</textarea>
          </div>
          <div class="aeaa-row aeaa-actions">
            <button class="aeaa-btn secondary" data-act="scan" ${controlsDisabled}>查报名活动</button>
            <button class="aeaa-btn danger" data-act="exit" ${controlsDisabled}>普通退出</button>
            <button class="aeaa-btn warning" data-act="pause" ${pauseDisabled}>${state.paused ? (state.busy ? '暂停中...' : '继续处理') : '暂停'}</button>
          </div>
          ${state.paused ? `<div class="aeaa-pause-note"><strong>队列已暂停</strong>${escapeHtml(state.pauseReason || '请查看当前活动页面。')}<br>当前页面不会再自动操作；检查后点击“继续处理”进入下一步。</div>` : ''}
          <div class="aeaa-plan">${renderPlan()}</div>
          <div class="aeaa-log">${state.logs.length ? state.logs.map((item) => `<div class="${escapeHtml(item.level)}">[${escapeHtml(item.time)}] ${escapeHtml(item.message)}</div>`).join('') : '<div>等待操作</div>'}</div>
        </div>
      </div>`;
  }

  function bind() {
    root.addEventListener('input', (event) => {
      if (event.target.dataset.field === 'product') {
        state.productId = event.target.value.trim();
        save();
      }
    });
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      const action = button.dataset.act;
      if (action === 'dismiss-completion') {
        state.completionNotice = null;
        save();
        render();
        return;
      }
      if (action === 'pause') {
        toggleExitQueuePause();
        return;
      }
      if (action === 'min') {
        const body = root.querySelector('.aeaa-body');
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
        root.style.width = body.style.display === 'none' ? '168px' : '';
        return;
      }
      if (state.busy || state.autoExit) return;
      if (action === 'scan') buildPlan();
      if (action === 'exit') exitPlan();
    });
  }

  function mount() {
    if (document.getElementById('aeaa-root')) return;
    root = document.createElement('div');
    root.id = 'aeaa-root';
    document.documentElement.appendChild(root);
    bind();
    render();
    log('ok', upgradedFromOldVersion
      ? `面板已升级到 ${SCRIPT_VERSION}，旧版扫描队列已清空。新品闪电推不支持退出，扫描时会自动忽略。`
      : '面板已加载。');
    setTimeout(dismissBlockingPopups, 1200);
  }

  const readyTimer = setInterval(() => {
    if (getMtop() && !mtopReadyLogged) {
      mtopReadyLogged = true;
      log('ok', '已连接页面 MTop 接口。');
      clearInterval(readyTimer);
      if (state.autoExit) {
        setTimeout(processExitQueue, 1000);
      }
    }
  }, 1000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
