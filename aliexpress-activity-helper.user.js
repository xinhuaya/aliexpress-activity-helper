// ==UserScript==
// @name         AliExpress Activity Helper
// @namespace    local.ae.activity.helper
// @version      0.8.7
// @description  速卖通活动助手：按商品 ID 读取商品管理 SALE 数据中的报名活动，并按页面按钮流程一键普通退出。
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
  const SCRIPT_VERSION = '0.8.7';
  const STOCKOUT_REASON = '库存不足';
  const REQUEST_TIMEOUT_MS = 20000;
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const pageChannelId = new URLSearchParams(pageWindow.location.search).get('channelId') || '';

  const state = {
    productId: '',
    dryRun: true,
    busy: false,
    logs: [],
    plan: [],
    exitQueue: [],
    autoExit: false,
    lastScanAt: '',
    channelId: '',
    scriptVersion: '',
    ...safeJson(localStorage.getItem(STORE_KEY), {})
  };
  delete state.includeEnded;
  const upgradedFromOldVersion = state.scriptVersion !== SCRIPT_VERSION;
  if (upgradedFromOldVersion) {
    state.logs = [];
    state.plan = [];
    state.exitQueue = [];
    state.autoExit = false;
    state.scriptVersion = SCRIPT_VERSION;
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
      dryRun: state.dryRun,
      logs: state.logs.slice(0, 40),
      plan: state.plan,
      exitQueue: state.exitQueue,
      autoExit: state.autoExit,
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
    const productId = String(state.productId || '').trim();
    if (!productId) {
      log('warn', '请先输入商品 ID。');
      return;
    }
    state.plan = [];
    save();
    render();

    setBusy(true);
    try {
      log('ok', `正在按商品 ID ${productId} 读取商品管理 SALE 数据。`);
      const saleActivities = await queryProductSaleActivities(productId);
      if (!saleActivities.length) {
        state.plan = [];
        save();
        log('warn', `商品 ${productId} 没有 SALE 活动标志，当前没有可生成的退出计划。`);
        return;
      }
      const activeSaleActivities = saleActivities.filter((item) => {
        const end = new Date(item.end.replace(/-/g, '/')).getTime();
        return !end || end >= Date.now();
      });
      const exitEntries = activeSaleActivities;
      const platformCount = exitEntries.filter((item) => item.source === '平台活动').length;
      const shopCount = exitEntries.filter((item) => item.source === '店铺活动').length;
      log('ok', `SALE 显示 ${saleActivities.length} 条活动记录；未结束记录中保留全部 ${exitEntries.length} 条平台和店铺活动（平台 ${platformCount}，店铺 ${shopCount}），正在分别匹配活动编号。`);

      const catalog = (await resolveActivities()).filter((item) => !isEnded(item));
      const { matched, unresolved, verifiedCandidateCount, verifiedMatchCount } = await matchSaleActivities(exitEntries, catalog, productId);
      if (verifiedCandidateCount) {
        log('ok', `活动名称存在相近候选；已核对 ${verifiedCandidateCount} 个候选，并按商品实际报名记录确认 ${verifiedMatchCount} 个活动编号。`);
      }
      if (unresolved.length) {
        const preview = unresolved.slice(0, 3).map((item) => item.name).join('；');
        throw new Error(`SALE 中有 ${unresolved.length} 个活动无法唯一匹配活动编号，已停止以避免漏退或错退：${preview}`);
      }

      const plan = matched.map(({ saleActivity, activity }) => ({
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

      state.plan = plan;
      state.lastScanAt = new Date().toLocaleString();
      save();
      if (plan.length) {
        log('ok', `SALE 核对完成：商品 ${productId} 有 ${plan.length} 个可处理报名活动；没有遍历全店活动。当前是${state.dryRun ? '预演' : '执行'}模式。`);
      } else {
        log('warn', `商品 ${productId} 的 SALE 中没有未结束活动。`);
      }
    } catch (error) {
      log('error', formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function exitPlan() {
    const productId = String(state.productId || '').trim();
    if (!productId) {
      log('warn', '请先输入商品 ID。');
      return;
    }
    if (!state.plan.length || state.plan.some((row) => row.productId !== productId)) {
      await buildPlan();
    }
    if (!state.plan.length || state.plan.some((row) => row.productId !== productId)) {
      log('error', `没有为商品 ${productId} 生成可执行的退出计划，已停止。`);
      return;
    }

    if (state.dryRun) {
      log('warn', '当前是预演模式，不会提交退出。确认列表正确后，取消勾选“预演”，再点“普通退出”。');
      return;
    }

    const names = state.plan.map((row) => `- ${row.activityName}`).join('\n');
    const ok = window.confirm(
      `确认普通退出商品 ${productId} 的 ${state.plan.length} 个活动吗？\n\n` +
      `${names}\n\n` +
      '退出原因：库存不足\n' +
      '本脚本不会设置为“不参加活动商品”。'
    );
    if (!ok) {
      log('warn', '已取消退出。');
      return;
    }

    state.exitQueue = state.plan.slice();
    state.autoExit = true;
    save();
    log('ok', `已创建退出队列：${state.exitQueue.length} 个活动。`);
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

  function clickButtonStartingWith(label) {
    const element = [...document.querySelectorAll('button,a,[role="button"]')]
      .find((item) => visible(item) && textOfElement(item).startsWith(label));
    if (!element) return false;
    element.click();
    return true;
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
      .find((item) => visible(item) && String(item.placeholder || '').includes('支持商品ID搜索')) || null;
  }

  async function waitForActivityProductSearchInput(timeout = 7000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
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
    return `没有找到“支持商品ID搜索”输入框。请确认已进入正确活动页面，并手动点击${step}，再进入“商品报名 > 已报名”后重试。`;
  }

  async function enterActivitySignupStep(row) {
    let input = findActivityProductSearchInput();
    if (input) return input;
    const preferredStep = row && row.saleSource === '平台活动' ? '入围活动报名' : '外围活动报名';
    const actions = [
      { label: '商品报名', click: () => clickExactInteractive('商品报名') },
      { label: '开始报名活动商品', click: () => clickExactButton('开始报名活动商品') },
      { label: '同意并下一步', click: () => clickButtonStartingWith('同意并下一步') },
      { label: preferredStep, click: () => clickExactInteractive(preferredStep) }
    ];
    for (const action of actions) {
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
    await dismissBlockingPopups();
    let input = await enterActivitySignupStep(row);
    await dismissBlockingPopups();
    if (clickStartsWith('已报名')) await wait(3500);
    await dismissBlockingPopups();

    input = findActivityProductSearchInput() || await waitForActivityProductSearchInput(7000);
    if (!input) throw new Error(activitySearchInputHelp(row));

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

  async function submitQuitByPage(productId) {
    const quitButton = findQuitButton(productId);
    if (!quitButton) throw new Error(`没有找到商品 ${productId} 的“申请退出活动”按钮。`);
    quitButton.click();
    await wait(2500);

    const reason = [...document.querySelectorAll('label,.ait-radio-wrapper,.next-radio-wrapper,span,div')]
      .find((element) => visible(element) && textOfElement(element) === STOCKOUT_REASON);
    if (!reason) throw new Error('退出弹窗里没有找到“库存不足”。');
    (reason.closest('label,.ait-radio-wrapper,.next-radio-wrapper') || reason).click();
    await wait(800);

    const submitButton = [...document.querySelectorAll('button')]
      .find((element) => visible(element) && textOfElement(element) === '退出活动');
    if (!submitButton) throw new Error('退出弹窗里没有找到普通“退出活动”按钮。');
    submitButton.click();
    await wait(7000);
  }

  async function processExitQueue() {
    if (!state.autoExit || state.busy) return;
    if (!state.exitQueue.length) {
      state.autoExit = false;
      save();
      log('ok', '退出队列已完成。建议刷新活动页复查。');
      return;
    }

    const row = state.exitQueue[0];
    const productId = String(row.productId || state.productId || '').trim();
    if (!productId) {
      state.autoExit = false;
      save();
      log('error', '退出队列缺少商品 ID，已停止。');
      return;
    }

    if (!isCurrentActivity(row)) {
      log('ok', `跳转活动：${row.activityName || row.activityId}`);
      pageWindow.location.href = activityUrl(row);
      return;
    }

    setBusy(true);
    try {
      await waitForMtop();
      await dismissBlockingPopups();
      const before = await querySignedItem(row, productId);
      if (before && before.itemStatus === 'OPERATOR_EXIT') {
        state.exitQueue.shift();
        save();
        log('ok', `已是退出状态：${row.activityName || row.activityId}`);
        return;
      }

      await openSignedListAndSearch(row, productId);
      await submitQuitByPage(productId);

      const after = await querySignedItem(row, productId);
      if (after && after.itemStatus === 'OPERATOR_EXIT') {
        state.exitQueue.shift();
        state.plan = state.plan.filter((item) => item.activityId !== row.activityId);
        save();
        log('ok', `退出成功：${row.activityName || row.activityId}`);
      } else {
        state.autoExit = false;
        save();
        log('error', `提交后没有查到退出状态：${row.activityName || row.activityId}`);
      }
    } catch (error) {
      state.autoExit = false;
      save();
      log('error', `退出队列停止：${formatError(error)}`);
    } finally {
      setBusy(false);
      if (state.autoExit) setTimeout(processExitQueue, 1200);
    }
  }

  function css() {
    return `
      #aeaa-root { position: fixed; right: 18px; bottom: 18px; width: 430px; z-index: 2147483647; color: #17231f; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
      #aeaa-root * { box-sizing: border-box; letter-spacing: 0; }
      .aeaa-box { border: 1px solid #2b3b36; background: #fbfaf6; box-shadow: 0 18px 50px rgba(0,0,0,.24); border-radius: 8px; overflow: hidden; }
      .aeaa-head { min-height: 42px; background: #20352f; color: #f7f4ea; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; font-weight: 700; }
      .aeaa-head small { color: #a8d7bd; font-weight: 500; }
      .aeaa-body { padding: 12px; }
      .aeaa-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
      .aeaa-input { flex: 1; min-width: 0; height: 34px; border: 1px solid #a9b4aa; border-radius: 6px; background: #fff; padding: 0 10px; font-size: 13px; }
      .aeaa-btn { height: 34px; border: 1px solid #243b34; border-radius: 6px; background: #273d36; color: white; font-weight: 700; cursor: pointer; white-space: nowrap; padding: 0 12px; }
      .aeaa-btn.secondary { background: #fff; color: #1c2d28; border-color: #a9b4aa; }
      .aeaa-btn.danger { background: #b42318; border-color: #9b1c13; }
      .aeaa-btn:disabled { opacity: .55; cursor: not-allowed; }
      .aeaa-options { display: flex; margin-bottom: 8px; }
      .aeaa-toggle { flex: 1; height: 30px; border: 1px solid #d0c8ba; border-radius: 6px; background: #fff; display:flex; align-items:center; justify-content:center; gap:6px; font-size:12px; font-weight:700; }
      .aeaa-note { margin: 0 0 8px; color: #56645d; font-size: 12px; line-height: 1.45; }
      .aeaa-plan { max-height: 172px; overflow: auto; border: 1px solid #d0c8ba; border-radius: 6px; background: #fff; font-size: 12px; margin-top: 8px; }
      .aeaa-item { padding: 8px 10px; border-bottom: 1px solid #ece7da; }
      .aeaa-item:last-child { border-bottom: 0; }
      .aeaa-name { color: #17231f; font-weight: 700; line-height: 1.35; }
      .aeaa-meta { color: #6b766e; margin-top: 3px; line-height: 1.35; }
      .aeaa-empty { padding: 10px; color: #6b766e; }
      .aeaa-log { margin-top: 8px; max-height: 140px; overflow: auto; background: #151d1a; color: #d7e3d9; border: 1px solid #d0c8ba; border-radius: 6px; font: 11px Consolas, "Cascadia Mono", monospace; }
      .aeaa-log div { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.06); line-height: 1.4; }
      .aeaa-log .ok { color:#9de0b1; } .aeaa-log .warn { color:#ffd17d; } .aeaa-log .error { color:#ff9b8f; }
    `;
  }

  function renderPlan() {
    if (!state.plan.length) {
      return '<div class="aeaa-empty">还没有计划。在任意速卖通卖家后台页面输入商品 ID，点击“查报名活动”。</div>';
    }
    return state.plan.map((row) => `
      <div class="aeaa-item">
        <div class="aeaa-name">${escapeHtml(row.activityName || row.activityId)}</div>
        <div class="aeaa-meta">来源: ${escapeHtml(row.saleSource || row.groupName || '-')} / activityId: ${escapeHtml(row.activityId)} / campaignId: ${escapeHtml(row.campaignId)}</div>
        <div class="aeaa-meta">预热: ${escapeHtml(formatTime(row.showStartTime) || '-')}，结束: ${escapeHtml(formatTime(row.activityEndTime) || '-')}</div>
      </div>
    `).join('');
  }

  function render() {
    if (!root) return;
    const disabled = state.busy ? 'disabled' : '';
    root.innerHTML = `
      <style>${css()}</style>
      <div class="aeaa-box">
        <div class="aeaa-head">
          <span>AE 活动助手 <small>${state.busy ? '处理中...' : '极速退出'}</small></span>
          <button class="aeaa-btn secondary" data-act="min" ${disabled}>-</button>
        </div>
        <div class="aeaa-body">
          <p class="aeaa-note">输入商品 ID 后，脚本会直接读取商品管理中该商品 SALE 标签背后的数据，只处理其中显示的平台活动和店铺活动。</p>
          <div class="aeaa-row">
            <input class="aeaa-input" data-field="product" placeholder="商品 ID" value="${escapeHtml(state.productId || '')}" ${disabled}>
            <button class="aeaa-btn secondary" data-act="scan" ${disabled}>查报名活动</button>
            <button class="aeaa-btn danger" data-act="exit" ${disabled}>普通退出</button>
          </div>
          <div class="aeaa-options">
            <label class="aeaa-toggle"><input type="checkbox" data-field="dry" ${state.dryRun ? 'checked' : ''} ${disabled}>预演，不提交</label>
          </div>
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
    root.addEventListener('change', (event) => {
      if (event.target.dataset.field === 'dry') state.dryRun = event.target.checked;
      save();
      render();
    });
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      const action = button.dataset.act;
      if (state.busy) return;
      if (action === 'scan') buildPlan();
      if (action === 'exit') exitPlan();
      if (action === 'min') {
        const body = root.querySelector('.aeaa-body');
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
        root.style.width = body.style.display === 'none' ? '168px' : '430px';
      }
    });
  }

  function mount() {
    if (document.getElementById('aeaa-root')) return;
    root = document.createElement('div');
    root.id = 'aeaa-root';
    document.documentElement.appendChild(root);
    bind();
    render();
    log('ok', upgradedFromOldVersion ? `面板已升级到 ${SCRIPT_VERSION}，旧版扫描队列已清空。` : '面板已加载。');
    setTimeout(dismissBlockingPopups, 1200);
  }

  const readyTimer = setInterval(() => {
    if (getMtop() && !mtopReadyLogged) {
      mtopReadyLogged = true;
      log('ok', '已连接页面 MTop 接口。');
      clearInterval(readyTimer);
      if (state.autoExit && state.exitQueue.length) {
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
