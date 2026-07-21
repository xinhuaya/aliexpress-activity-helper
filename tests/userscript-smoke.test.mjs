import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptPath = new URL('../aliexpress-activity-helper.user.js', import.meta.url);
const source = fs.readFileSync(scriptPath, 'utf8');
const TEST_NOW = new Date(2026, 6, 10, 12, 0).getTime();
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [TEST_NOW]));
  }

  static now() {
    return TEST_NOW;
  }
}

const metadata = source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0] || '';
assert.match(metadata, /@version\s+0\.9\.7/);
assert.match(metadata, /@grant\s+GM_notification/);
assert.match(metadata, /@updateURL\s+https:\/\/xinhuaya\.github\.io\/aliexpress-activity-helper\/stable\/aliexpress-activity-helper\.meta\.js/);
assert.match(metadata, /@downloadURL\s+https:\/\/xinhuaya\.github\.io\/aliexpress-activity-helper\/stable\/aliexpress-activity-helper\.user\.js/);
assert.match(metadata, /@noframes/);
assert.doesNotMatch(source, /codex/i);
assert.match(metadata, /@match\s+https:\/\/\*\.aliexpress\.com\/\*/);
assert.doesNotMatch(source, /channelId=2350569/);
assert.match(metadata, /批量读取商品管理 SALE/);
assert.match(source, /parseSaleTooltip/);
assert.match(source, /localizeActTime/);
assert.match(source, /同意并下一步/);
assert.match(source, /enterActivitySignupStep/);
assert.match(source, /function activateActivityTab/);
assert.match(source, /已进入“商品报名 > 已报名”，正在搜索商品/);
assert.match(source, /没有成功切换到“已报名”标签/);
assert.match(source, /const UNIFIED_NAVIGATION_TIMEOUT = 45000;/);
assert.match(source, /const UNIFIED_BUTTON_STABLE_MS = 4000;/);
assert.match(source, /waitForStableButtonStartingWithAny\(labels, 15000\)/);
assert.match(source, /nextButton\.click\(\);\s+await waitForPathChange\(path\);/);
assert.match(source, /请确认已进入正确活动页面/);
assert.doesNotMatch(source, /包含已结束活动/);
assert.match(source, /mtop\.global\.merchant\.new\.product\.manager\.render\.list/);
assert.doesNotMatch(source, /mapWithRateLimit/);
assert.match(source, /baxia-dialog-mask/);
assert.match(source, /_____tmd_____\/punish/);
assert.match(source, /批量退出完成/);
assert.match(source, /商品优化完成后，记得重新报名需要参加的活动/);
assert.match(source, /const MAX_BATCH_PRODUCTS = 10;/);
assert.match(source, /function parseProductIds/);
assert.match(source, /<textarea class="aeaa-input"/);
assert.match(source, /exitRowKey\(item\) !== exitRowKey\(row\)/);
assert.match(source, /failedRows/);
assert.doesNotMatch(source, /预演，不提交/);
assert.doesNotMatch(source, /data-field="dry"/);
assert.match(source, /data-act="pause"/);
assert.match(source, /继续处理/);
assert.match(source, /AE_USER_PAUSED/);
assert.match(source, /exitPenaltyWarning/);
assert.match(source, /队列已自动暂停并停留在当前页面/);
assert.match(source, /function isNewProductFlashActivity/);
assert.match(source, /新品闪电推不支持退出/);

const frameWindow = { location: { search: '', pathname: '/', href: 'https://csp.aliexpress.com/' } };
frameWindow.self = frameWindow;
frameWindow.top = {};
assert.doesNotThrow(() => vm.runInNewContext(source, { window: frameWindow }));

function matchPattern(pattern, target) {
  const parts = pattern.match(/^(https?):\/\/([^/]+)(\/.*)$/);
  assert.ok(parts, `Unsupported pattern: ${pattern}`);
  const [, protocol, hostPattern, pathPattern] = parts;
  const url = new URL(target);
  const baseHost = hostPattern.startsWith('*.') ? hostPattern.slice(2) : hostPattern;
  const hostMatches = hostPattern.startsWith('*')
    ? url.hostname === baseHost || url.hostname.endsWith(`.${baseHost}`)
    : url.hostname === hostPattern;
  const pathRegex = new RegExp(`^${pathPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return url.protocol === `${protocol}:` && hostMatches && pathRegex.test(url.pathname);
}

assert.equal(matchPattern('https://*.aliexpress.com/*', 'https://eu.seller.aliexpress.com/apps/product/list'), true);
assert.equal(matchPattern('https://*.aliexpress.com/*', 'https://seller.example.com/apps/product/list'), false);

function createRoot(onMount, handlers) {
  return {
    id: '',
    innerHTML: '',
    style: {},
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    querySelector() {
      return null;
    },
    mount() {
      onMount(this);
    }
  };
}

let mountedRoot;
const storage = new Map();
const mountHandlers = {};
const mountDocument = {
  readyState: 'complete',
  documentElement: {
    appendChild(node) {
      mountedRoot = node;
    }
  },
  getElementById() {
    return null;
  },
  createElement() {
    return createRoot((node) => { mountedRoot = node; }, mountHandlers);
  },
  addEventListener() {},
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  }
};
const mountWindow = { location: { search: '', pathname: '/', href: 'https://eu.seller.aliexpress.com/' } };
mountWindow.self = mountWindow;
mountWindow.top = mountWindow;

vm.runInNewContext(source, {
  console,
  Date: FixedDate,
  JSON,
  URLSearchParams,
  document: mountDocument,
  window: mountWindow,
  localStorage: {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, value);
    }
  },
  setInterval() {
    return 1;
  },
  clearInterval() {},
  setTimeout() {
    return 1;
  }
});

assert.equal(mountedRoot?.id, 'aeaa-root');
assert.match(mountedRoot?.innerHTML || '', /AE 活动助手/);

async function runCompletionNoticeScenario() {
  const productIds = ['1005000000000088', '1005000000000089'];
  const completionStorage = new Map();
  const completionHandlers = {};
  const completionNotifications = [];
  const completionTitleHistory = [];
  let completionRoot;
  let completionTitle = '活动报名';
  completionStorage.set('ae.activity.assistant.v4', JSON.stringify({
    productId: productIds.join('\n'),
    dryRun: false,
    logs: [],
    plan: [],
    exitQueue: [],
    exitBatch: {
      productId: productIds[0],
      productIds,
      productCount: 2,
      queuedProductCount: 2,
      skippedProductIds: [],
      total: 4,
      successCount: 3,
      alreadyExitedCount: 1,
      failedCount: 0,
      failedRows: []
    },
    completionNotice: null,
    autoExit: true,
    channelId: '9999999',
    scriptVersion: '0.9.7'
  }));

  const completionDocument = {
    readyState: 'complete',
    documentElement: {
      appendChild(node) {
        completionRoot = node;
      }
    },
    getElementById() {
      return null;
    },
    createElement() {
      return createRoot((node) => { completionRoot = node; }, completionHandlers);
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  Object.defineProperty(completionDocument, 'title', {
    get() {
      return completionTitle;
    },
    set(value) {
      completionTitle = String(value);
      completionTitleHistory.push(completionTitle);
    }
  });
  const completionWindow = {
    location: {
      search: '?channelId=9999999',
      pathname: '/m_apps/campaigns/home-page',
      href: 'https://csp.aliexpress.com/m_apps/campaigns/home-page?channelId=9999999'
    },
    lib: { mtop: { request() {} } }
  };
  completionWindow.self = completionWindow;
  completionWindow.top = completionWindow;

  vm.runInNewContext(source, {
    console,
    Date: FixedDate,
    Error,
    JSON,
    Promise,
    URLSearchParams,
    document: completionDocument,
    window: completionWindow,
    GM_notification(options) {
      completionNotifications.push(options);
    },
    localStorage: {
      getItem(key) {
        return completionStorage.get(key) ?? null;
      },
      setItem(key, value) {
        completionStorage.set(key, value);
      }
    },
    setInterval(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearInterval() {},
    clearTimeout() {},
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    }
  });

  for (let index = 0; index < 10; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.match(completionRoot?.innerHTML || '', /批量退出完成/);
  assert.match(completionRoot?.innerHTML || '', /2 个商品的退出队列已全部处理/);
  assert.match(completionRoot?.innerHTML || '', />3<\/span><span class="aeaa-completion-label">退出成功/);
  assert.match(completionRoot?.innerHTML || '', /原本已退出 1/);
  assert.equal(completionNotifications.length, 1, 'batch completion should send one desktop notification');
  assert.equal(completionNotifications[0].title, 'AE 活动助手：退出完成');
  assert.match(completionNotifications[0].text, /2 个商品，共 4 个活动/);
  assert.equal(
    completionTitleHistory.some((title) => title.includes('【退出完成】')),
    true,
    'batch completion should flash the page title'
  );

  completionHandlers.click({
    target: {
      closest() {
        return { dataset: { act: 'dismiss-completion' } };
      }
    }
  });
  assert.doesNotMatch(completionRoot?.innerHTML || '', /批量退出完成/);
  assert.equal(JSON.parse(completionStorage.get('ae.activity.assistant.v4')).completionNotice, null);
}

await runCompletionNoticeScenario();

function createSaleScenario({
  failCatalog = false,
  ambiguousPlatform = false,
  localizedSecondTime = false,
  unifiedOnly = false,
  nonInboundDecoy = false,
  includeNewProductFlash = false,
  newProductFlashOnly = false,
  productIds: suppliedProductIds = []
} = {}) {
  const handlers = {};
  const calls = [];
  const storage = new Map();
  const productIds = suppliedProductIds.length
    ? suppliedProductIds.map(String)
    : ['1005000000000001'];
  const productId = productIds[0];
  const startTime = new Date(2026, 6, 15, 23, 0).getTime();
  const endTime = new Date(2026, 6, 20, 14, 59).getTime();
  const saleStartText = localizedSecondTime ? '2026-07-16 00:00' : '2026-07-15 23:00';
  const saleEndText = localizedSecondTime ? '2026-07-20 13:59' : '2026-07-20 14:59';
  let root;
  const makeDl = (source, name) => ({
    querySelector(selector) {
      return selector === 'dt' ? { innerText: `${source}：`, textContent: `${source}：` } : null;
    },
    querySelectorAll(selector) {
      return selector === 'dd' ? [
        { innerText: name, textContent: name },
        { innerText: `${saleStartText} - ${saleEndText}`, textContent: `${saleStartText} - ${saleEndText}` }
      ] : [];
    }
  });
  const platformDl = makeDl('平台活动', '【2026年7月A+】入围活动-非俄语区&欧盟地区');
  const shopDl = makeDl('店铺活动', '【2026年7月A+】外围活动-非俄语区&欧盟地区');
  const newProductFlashName = '新品闪电推-早鸟价85折(俄向不生效)-共享限购-67月S级';
  const newProductFlashDl = makeDl('平台活动', newProductFlashName);
  const saleDls = newProductFlashOnly
    ? [newProductFlashDl]
    : [platformDl, shopDl, ...(includeNewProductFlash ? [newProductFlashDl] : [])];
  const standardSaleHtml = [
    '<dl><dt>平台活动：</dt>',
    '<dd>【2026年7月A+】入围活动-非俄语区&amp;欧盟地区</dd>',
    `<dd>${saleStartText} - ${saleEndText}</dd></dl>`,
    '<dl><dt>店铺活动：</dt>',
    '<dd>【2026年7月A+】外围活动-非俄语区&amp;欧盟地区</dd>',
    `<dd>${saleStartText} - ${saleEndText}</dd></dl>`
  ];
  const newProductFlashHtml = [
    '<dl><dt>平台活动：</dt>',
    `<dd>${newProductFlashName}</dd>`,
    `<dd>${saleStartText} - ${saleEndText}</dd></dl>`
  ];
  const saleHtml = newProductFlashOnly
    ? newProductFlashHtml
    : [...standardSaleHtml, ...(includeNewProductFlash ? newProductFlashHtml : [])];
  const createParserContainer = () => ({
    html: '',
    set innerHTML(value) {
      this.html = value;
    },
    get innerHTML() {
      return this.html;
    },
    querySelectorAll(selector) {
      return selector === 'dl' && this.html ? saleDls : [];
    }
  });

  const document = {
    readyState: 'complete',
    title: '商品管理',
    body: { innerText: '商品管理' },
    documentElement: {
      appendChild(node) {
        root = node;
      }
    },
    getElementById() {
      return null;
    },
    createElement() {
      return root ? createParserContainer() : createRoot((node) => { root = node; }, handlers);
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  const window = {
    location: {
      search: '?channelId=9999999',
      pathname: '/m_apps/home',
      href: 'https://csp.aliexpress.com/m_apps/home?channelId=9999999'
    },
    lib: {
      mtop: {
        request(options) {
          calls.push(options);
          if (options.api === 'mtop.global.merchant.new.product.manager.render.list') {
            const requestedProductId = String(
              JSON.parse(options.data.jsonBody).filter.querySelectInput.value || ''
            );
            const matchedProductId = productIds.includes(requestedProductId) ? requestedProductId : '';
            return Promise.resolve({
              ret: ['SUCCESS::调用成功'],
              data: {
                table: {
                  dataSource: matchedProductId ? [{
                    productId: matchedProductId,
                    itemDesc: {
                      iconList: [{
                        uiType: 'hoverTip',
                        type: 'text',
                        text: 'SALE',
                        hoverTip: [{
                          dataSource: saleHtml
                        }]
                      }]
                    }
                  }] : []
                }
              }
            });
          }
          if (options.api === 'mtop.global.campaign.merchants.activity.items.query') {
            const isSignedPlatformActivity = String(options.data.activityId) === '30000211727';
            return Promise.resolve({
              ret: ['SUCCESS::调用成功'],
              data: {
                dataList: isSignedPlatformActivity ? [{
                  itemId: String(options.data.nameOrId || productId),
                  itemStatus: 'AUDIT_PASSED'
                }] : []
              }
            });
          }
          if (options.api !== 'mtop.global.campaign.merchants.activity.list.nodada.data') {
            return Promise.reject({ ret: ['FAIL::unexpected api'] });
          }
          if (failCatalog) return Promise.reject({ ret: ['FAIL_CHANNEL::渠道编号错误'] });
          return Promise.resolve({
            ret: ['SUCCESS::调用成功'],
            data: {
              data: {
                currentPage: 1,
                pageSize: 50,
                totalCount: 1,
                campaignList: [{
                  campaignId: '64630',
                  campaignName: '2026年7月A+',
                  activityList: [{
                    campaignId: '64630',
                    activityId: '30000211726',
                    activityName: '外围活动-非JV&欧盟地区（可点击下一步报名入围）',
                    localizeActTime: JSON.stringify([{
                      showStartTime: startTime + 60 * 60 * 1000,
                      startTime: startTime + 24 * 60 * 60 * 1000,
                      endTime: endTime - 60 * 60 * 1000
                    }, {
                      showStartTime: startTime,
                      startTime: startTime + 23 * 60 * 60 * 1000,
                      endTime
                    }]),
                    onlineStartTime: startTime + 23 * 60 * 60 * 1000,
                    onlineEndTime: endTime
                  }, ...(unifiedOnly ? [] : [{
                    campaignId: '64630',
                    activityId: '30000211727',
                    activityName: '入围活动-非JV&欧盟地区',
                    localizeActTime: JSON.stringify([{
                      showStartTime: startTime,
                      startTime: startTime + 23 * 60 * 60 * 1000,
                      endTime
                    }, ...(localizedSecondTime ? [{
                      showStartTime: startTime + 60 * 60 * 1000,
                      startTime: startTime + 24 * 60 * 60 * 1000,
                      endTime: endTime - 60 * 60 * 1000
                    }] : [])]),
                    onlineStartTime: startTime + 23 * 60 * 60 * 1000,
                    onlineEndTime: endTime
                  }, ...(ambiguousPlatform ? [{
                    campaignId: '64630',
                    activityId: '30000211729',
                    activityName: '入围活动-非JV&欧盟地区',
                    localizeActTime: JSON.stringify([{
                      showStartTime: startTime,
                      startTime: startTime + 23 * 60 * 60 * 1000,
                      endTime
                    }]),
                    onlineStartTime: startTime + 23 * 60 * 60 * 1000,
                    onlineEndTime: endTime
                  }] : [])]), ...(nonInboundDecoy ? [{
                    campaignId: '64630',
                    activityId: '30000215638',
                    activityName: '非欧盟地区-邀约降价榜单-非入围品可被邀约',
                    localizeActTime: JSON.stringify([{
                      showStartTime: startTime,
                      startTime: startTime + 23 * 60 * 60 * 1000,
                      endTime
                    }]),
                    onlineStartTime: startTime + 23 * 60 * 60 * 1000,
                    onlineEndTime: endTime
                  }] : [])]
                }]
              }
            }
          });
        }
      }
    }
  };
  window.self = window;
  window.top = window;

  vm.runInNewContext(source, {
    console,
    Date: FixedDate,
    Error,
    JSON,
    Map,
    Promise,
    URLSearchParams,
    document,
    window,
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible' };
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    clearTimeout() {},
    setTimeout(callback, ms) {
      if (ms <= 500) queueMicrotask(callback);
      return 1;
    }
  });

  return {
    handlers,
    calls,
    getRoot: () => root,
    getState: () => JSON.parse(storage.get('ae.activity.assistant.v4') || '{}'),
    productId,
    productIds
  };
}

async function runScan(scenario, inputValue = scenario.productId) {
  scenario.handlers.input({ target: { dataset: { field: 'product' }, value: inputValue } });
  scenario.handlers.click({
    target: {
      closest() {
        return { dataset: { act: 'scan' } };
      }
    }
  });
  for (let index = 0; index < 80; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const saleScenario = createSaleScenario();
await runScan(saleScenario);
assert.equal(saleScenario.calls.filter((call) => call.api === 'mtop.global.merchant.new.product.manager.render.list').length, 1);
assert.equal(saleScenario.calls.filter((call) => call.api === 'mtop.global.campaign.merchants.activity.list.nodada.data').length, 3);
assert.equal(saleScenario.calls.some((call) => call.api === 'mtop.global.campaign.merchants.activity.items.query'), false);
assert.equal(saleScenario.calls.every((call) => call.data?.channelId === '9999999'), true);
const productQuery = saleScenario.calls.find((call) => call.api === 'mtop.global.merchant.new.product.manager.render.list');
assert.deepEqual(JSON.parse(productQuery.data.jsonBody).filter.querySelectInput, { key: 1, value: saleScenario.productId });
assert.match(saleScenario.getRoot()?.innerHTML || '', /外围活动-非俄语区&amp;欧盟地区/);
assert.match(saleScenario.getRoot()?.innerHTML || '', /30000211726/);
assert.match(saleScenario.getRoot()?.innerHTML || '', /入围活动-非俄语区&amp;欧盟地区/);
assert.match(saleScenario.getRoot()?.innerHTML || '', /30000211727/);
assert.match(saleScenario.getRoot()?.innerHTML || '', /保留 2 条可退出活动（平台 1，店铺 1）/);
assert.match(saleScenario.getRoot()?.innerHTML || '', /批量核对完成：1\/1 个商品有可处理活动，共 2 个活动/);

const mixedNewProductFlashScenario = createSaleScenario({ includeNewProductFlash: true });
await runScan(mixedNewProductFlashScenario);
const mixedNewProductFlashState = mixedNewProductFlashScenario.getState();
assert.equal(mixedNewProductFlashState.plan.length, 2);
assert.equal(mixedNewProductFlashState.scanResults[0].ignoredNewProductFlashCount, 1);
assert.match(mixedNewProductFlashScenario.getRoot()?.innerHTML || '', /2 个活动待处理；已忽略 1 条新品闪电推/);
assert.match(mixedNewProductFlashScenario.getRoot()?.innerHTML || '', /保留 2 条可退出活动（平台 1，店铺 1）；已忽略 1 条新品闪电推/);

const newProductFlashOnlyScenario = createSaleScenario({ newProductFlashOnly: true });
await runScan(newProductFlashOnlyScenario);
const newProductFlashOnlyState = newProductFlashOnlyScenario.getState();
assert.equal(newProductFlashOnlyState.plan.length, 0);
assert.equal(newProductFlashOnlyState.scanResults[0].status, 'ignored');
assert.equal(newProductFlashOnlyState.scanResults[0].ignoredNewProductFlashCount, 1);
assert.equal(
  newProductFlashOnlyScenario.calls.filter((call) => call.api === 'mtop.global.campaign.merchants.activity.list.nodada.data').length,
  0
);
assert.match(newProductFlashOnlyScenario.getRoot()?.innerHTML || '', /该类活动不支持退出，已自动忽略/);

const batchProductIds = ['1005000000000001', '1005000000000002'];
const batchScenario = createSaleScenario({ productIds: batchProductIds });
await runScan(batchScenario, `${batchProductIds[0]}\n${batchProductIds[1]}，${batchProductIds[0]}`);
const batchProductQueries = batchScenario.calls
  .filter((call) => call.api === 'mtop.global.merchant.new.product.manager.render.list');
assert.equal(batchProductQueries.length, 2);
assert.deepEqual(
  batchProductQueries.map((call) => JSON.parse(call.data.jsonBody).filter.querySelectInput.value),
  batchProductIds
);
assert.equal(
  batchScenario.calls.filter((call) => call.api === 'mtop.global.campaign.merchants.activity.list.nodada.data').length,
  3
);
assert.match(batchScenario.getRoot()?.innerHTML || '', new RegExp(batchProductIds[0]));
assert.match(batchScenario.getRoot()?.innerHTML || '', new RegExp(batchProductIds[1]));
assert.match(batchScenario.getRoot()?.innerHTML || '', /批量核对完成：2\/2 个商品有可处理活动，共 4 个活动/);

const tooManyScenario = createSaleScenario();
const tooManyProductIds = Array.from({ length: 11 }, (_, index) => `100500000000${String(index).padStart(4, '0')}`);
await runScan(tooManyScenario, tooManyProductIds.join('\n'));
assert.equal(
  tooManyScenario.calls.filter((call) => call.api === 'mtop.global.merchant.new.product.manager.render.list').length,
  0
);
assert.match(tooManyScenario.getRoot()?.innerHTML || '', /一次最多处理 10 个商品 ID/);

const ambiguousScenario = createSaleScenario({ ambiguousPlatform: true });
await runScan(ambiguousScenario);
const verificationCalls = ambiguousScenario.calls
  .filter((call) => call.api === 'mtop.global.campaign.merchants.activity.items.query');
assert.equal(verificationCalls.length, 2);
assert.match(ambiguousScenario.getRoot()?.innerHTML || '', /30000211726/);
assert.match(ambiguousScenario.getRoot()?.innerHTML || '', /30000211727/);
assert.doesNotMatch(ambiguousScenario.getRoot()?.innerHTML || '', /30000211729/);
assert.match(ambiguousScenario.getRoot()?.innerHTML || '', /已核对 2 个候选，确认 1 个活动编号/);

const localizedScenario = createSaleScenario({ localizedSecondTime: true });
await runScan(localizedScenario);
assert.match(localizedScenario.getRoot()?.innerHTML || '', /30000211726/);
assert.match(localizedScenario.getRoot()?.innerHTML || '', /30000211727/);
assert.doesNotMatch(localizedScenario.getRoot()?.innerHTML || '', /无法唯一匹配活动编号/);

const unifiedEntryScenario = createSaleScenario({ unifiedOnly: true, nonInboundDecoy: true });
await runScan(unifiedEntryScenario);
const unifiedEntryHtml = unifiedEntryScenario.getRoot()?.innerHTML || '';
assert.equal((unifiedEntryHtml.match(/30000211726/g) || []).length, 2);
assert.doesNotMatch(unifiedEntryHtml, /30000215638/);
assert.doesNotMatch(unifiedEntryHtml, /无法唯一匹配活动编号/);
assert.equal(
  unifiedEntryScenario.calls.some((call) => call.api === 'mtop.global.campaign.merchants.activity.items.query'),
  false
);

const errorScenario = createSaleScenario({ failCatalog: true });
await runScan(errorScenario);
assert.doesNotMatch(errorScenario.getRoot()?.innerHTML || '', /\[object Object\]/);
assert.match(errorScenario.getRoot()?.innerHTML || '', /渠道编号错误/);

async function runExitEntryScenario(
  entryLabel,
  expectNavigation = true,
  saleSource = '店铺活动',
  signedItemStatus = '',
  catalogActivityName = '',
  includeProductTab = false,
  initialSearchInput = false
) {
  const productId = '1005000000000002';
  const campaignId = '64600';
  const activityId = '30000211756';
  const storage = new Map();
  const handlers = {};
  let root;
  let signupVisible = initialSearchInput;
  let entryClicks = 0;
  let productTabClicks = 0;
  let registeredClicks = 0;
  let registeredOuterClicks = 0;
  let registeredTabActive = false;
  let searchedWhileRegistered = false;
  const clickOrder = [];

  class FakeInput {
    constructor() {
      this.placeholder = '支持商品ID搜索';
      this.currentValue = '';
    }
    focus() {}
    dispatchEvent() {
      return true;
    }
    getBoundingClientRect() {
      return { width: 240, height: 32 };
    }
  }
  Object.defineProperty(FakeInput.prototype, 'value', {
    get() {
      return this.currentValue;
    },
    set(value) {
      this.currentValue = value;
      searchedWhileRegistered = registeredTabActive;
    }
  });
  const input = new FakeInput();
  const makeInteractive = (text, onClick) => ({
    innerText: text,
    textContent: text,
    click: onClick,
    closest() {
      return this;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { width: 180, height: 32 };
    }
  });
  const entry = makeInteractive(entryLabel, () => {
    entryClicks += 1;
    clickOrder.push(entryLabel);
    if (!includeProductTab) signupVisible = true;
  });
  const productTab = makeInteractive('商品报名', () => {
    productTabClicks += 1;
    clickOrder.push('商品报名');
    signupVisible = true;
  });
  const registeredOuter = makeInteractive('已报名(1)', () => {
    registeredOuterClicks += 1;
  });
  registeredOuter.className = 'ait-tabs-tab';
  const registered = makeInteractive('已报名(1)', () => {
    registeredClicks += 1;
    registeredTabActive = true;
    registeredOuter.className = 'ait-tabs-tab ait-tabs-tab-active';
  });
  registered.className = 'ait-tabs-tab-btn';
  registered.getAttribute = (name) => {
    if (name === 'role') return 'tab';
    if (name === 'aria-selected') return registeredTabActive ? 'true' : 'false';
    return null;
  };
  registered.closest = (selector) => selector.includes('.ait-tabs-tab') ? registeredOuter : registered;

  const row = {
    productId,
    itemId: productId,
    campaignId,
    activityId,
    activityName: saleSource === '平台活动' ? '测试入围活动' : '测试外围活动',
    catalogActivityName,
    saleSource,
    channelId: '9999999'
  };
  storage.set('ae.activity.assistant.v4', JSON.stringify({
    productId,
    dryRun: false,
    logs: [],
    plan: [row],
    exitQueue: [row],
    autoExit: true,
    channelId: '9999999',
    scriptVersion: '0.9.7'
  }));

  const document = {
    readyState: 'complete',
    title: '活动报名',
    body: { innerText: '大促活动指南 外围活动报名' },
    documentElement: {
      appendChild(node) {
        root = node;
      }
    },
    getElementById() {
      return null;
    },
    createElement() {
      return createRoot((node) => { root = node; }, handlers);
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input') return signupVisible ? [input] : [];
      if (selector === 'tr,.next-table-row,.ait-table-row,div') return [];
      if (selector.includes('[role="dialog"]') || selector.includes('[aria-modal="true"]')) return [];
      if (selector.includes('button') || selector.includes('[role="tab"]') || selector.includes('span,div')) {
        return includeProductTab
          ? [productTab, entry, registeredOuter, registered]
          : [entry, registeredOuter, registered];
      }
      return [];
    }
  };
  const window = {
    location: {
      search: `?campaignId=${campaignId}&activityId=${activityId}&channelId=9999999`,
      pathname: '/m_apps/campaigns/peripheral-activity',
      href: `https://csp.aliexpress.com/m_apps/campaigns/peripheral-activity?campaignId=${campaignId}&activityId=${activityId}&channelId=9999999`
    },
    lib: {
      mtop: {
        request(options) {
          if (options.api === 'mtop.global.campaign.merchants.activity.items.query') {
            const dataList = signedItemStatus ? [{ itemId: productId, itemStatus: signedItemStatus }] : [];
            return Promise.resolve({ ret: ['SUCCESS::调用成功'], data: { dataList } });
          }
          return Promise.reject({ ret: ['FAIL::unexpected api'] });
        }
      }
    }
  };
  window.self = window;
  window.top = window;

  class FakeEvent {
    constructor(type, options) {
      this.type = type;
      this.options = options;
    }
  }

  vm.runInNewContext(source, {
    console,
    Date: FixedDate,
    Error,
    JSON,
    Map,
    Promise,
    URLSearchParams,
    document,
    window,
    HTMLInputElement: FakeInput,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible' };
    },
    setInterval(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearInterval() {},
    clearTimeout() {},
    setTimeout(callback, ms) {
      if (ms < 20000) queueMicrotask(callback);
      return 1;
    }
  });

  for (let index = 0; index < 80; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const html = root?.innerHTML || '';
  if (expectNavigation) {
    assert.equal(entryClicks, 1, `${entryLabel} should be clicked once`);
    if (includeProductTab) {
      assert.equal(productTabClicks, 1, 'product signup tab should be clicked after selecting the inbound step');
      assert.deepEqual(clickOrder.slice(0, 2), [entryLabel, '商品报名']);
    }
    assert.equal(registeredClicks, 1, 'registered tab should be opened');
    assert.equal(registeredOuterClicks, 0, 'the non-interactive registered tab wrapper must not be clicked');
    assert.equal(searchedWhileRegistered, true, 'product search must wait until the registered tab is active');
    assert.equal(input.value, productId, 'product ID should reach the activity search input');
    assert.match(html, /没有找到商品 1005000000000002 的“申请退出活动”按钮/);
  } else {
    assert.equal(entryClicks, 0);
    assert.equal(registeredClicks, 0);
    assert.match(html, /请确认已进入正确活动页面/);
    assert.match(html, /第 2 步“外围活动报名”/);
    assert.match(html, /商品报名 &gt; 已报名/);
  }
}

await runExitEntryScenario('商品报名');
await runExitEntryScenario('同意并下一步');
await runExitEntryScenario('入围活动报名', true, '平台活动');
await runExitEntryScenario('无关按钮', false);

async function runSaleResidueScenario(mode) {
  const productId = '1005012544334149';
  const campaignId = '64664';
  const activityId = '30000211734';
  const storage = new Map();
  const handlers = {};
  const desktopNotifications = [];
  const titleHistory = [];
  let root;
  let unrelatedQuitClicks = 0;
  let currentTitle = '活动报名';

  class FakeInput {
    constructor() {
      this.placeholder = '支持商品ID搜索';
      this.currentValue = '';
    }
    focus() {}
    dispatchEvent() {
      return true;
    }
    getBoundingClientRect() {
      return { width: 240, height: 32 };
    }
  }
  Object.defineProperty(FakeInput.prototype, 'value', {
    get() {
      return this.currentValue;
    },
    set(value) {
      this.currentValue = value;
    }
  });

  const makeElement = (text, onClick = () => {}) => ({
    innerText: text,
    textContent: text,
    click: onClick,
    closest() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { width: 180, height: 32 };
    }
  });
  const input = new FakeInput();
  const registered = makeElement('已报名(1)');
  const emptyState = makeElement('暂无数据');
  const productRow = makeElement(
    mode === 'explicit-exit'
      ? `商品 ID: ${productId} 审核未通过 退出活动成功`
      : `商品 ID: ${productId} 审核通过`
  );
  const unrelatedQuitButton = makeElement('申请退出活动', () => {
    unrelatedQuitClicks += 1;
  });
  const row = {
    productId,
    itemId: productId,
    campaignId,
    activityId,
    activityName: '【2026年8月Choice Day】外围活动-欧盟地区',
    catalogActivityName: '【2026年8月Choice Day】外围活动-欧盟地区',
    saleSource: '店铺活动',
    channelId: '9999999'
  };
  storage.set('ae.activity.assistant.v4', JSON.stringify({
    productId,
    logs: [],
    plan: [row],
    scanProductIds: [productId],
    scanResults: [{ productId, status: 'ready', activityCount: 1 }],
    exitQueue: [row],
    exitBatch: {
      productId,
      productIds: [productId],
      productCount: 1,
      queuedProductCount: 1,
      total: 1,
      successCount: 0,
      alreadyExitedCount: 0,
      failedCount: 0,
      failedRows: []
    },
    autoExit: true,
    channelId: '9999999',
    scriptVersion: '0.9.7'
  }));

  const document = {
    readyState: 'complete',
    body: { innerText: '大促活动指南 外围活动报名 商品报名' },
    documentElement: {
      appendChild(node) {
        root = node;
      }
    },
    getElementById() {
      return null;
    },
    createElement() {
      return createRoot((node) => { root = node; }, handlers);
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input') return [input];
      if (selector === 'tr,.next-table-row,.ait-table-row,div') {
        return mode === 'empty-result' ? [] : [productRow];
      }
      if (selector === 'div,span,p,td') return mode === 'empty-result' ? [emptyState] : [];
      if (selector.includes('[role="dialog"]') || selector.includes('[aria-modal="true"]')) return [];
      if (selector.includes('button') || selector.includes('[role="tab"]') || selector.includes('span,div')) {
        return [registered, unrelatedQuitButton];
      }
      return [];
    }
  };
  Object.defineProperty(document, 'title', {
    get() {
      return currentTitle;
    },
    set(value) {
      currentTitle = String(value);
      titleHistory.push(currentTitle);
    }
  });
  const window = {
    location: {
      search: `?campaignId=${campaignId}&activityId=${activityId}&channelId=9999999`,
      pathname: '/m_apps/campaigns/peripheral-activity',
      href: `https://csp.aliexpress.com/m_apps/campaigns/peripheral-activity?campaignId=${campaignId}&activityId=${activityId}&channelId=9999999`
    },
    lib: {
      mtop: {
        request(options) {
          if (options.api === 'mtop.global.campaign.merchants.activity.items.query') {
            const dataList = mode === 'empty-result'
              ? []
              : [{ itemId: productId, itemStatus: 'PASS' }];
            return Promise.resolve({ ret: ['SUCCESS::调用成功'], data: { dataList } });
          }
          return Promise.reject({ ret: ['FAIL::unexpected api'] });
        }
      }
    }
  };
  window.self = window;
  window.top = window;

  class FakeEvent {
    constructor(type, options) {
      this.type = type;
      this.options = options;
    }
  }

  vm.runInNewContext(source, {
    console,
    Date: FixedDate,
    Error,
    JSON,
    Map,
    Promise,
    URLSearchParams,
    document,
    window,
    HTMLInputElement: FakeInput,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    GM_notification(options) {
      desktopNotifications.push(options);
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible' };
    },
    setInterval(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearInterval() {},
    clearTimeout() {},
    setTimeout(callback, ms) {
      if (ms < 20000) queueMicrotask(callback);
      return 1;
    }
  });

  for (let index = 0; index < 160; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const savedState = JSON.parse(storage.get('ae.activity.assistant.v4'));
  assert.equal(unrelatedQuitClicks, 0, 'a quit button outside the matching product row must never be clicked');
  if (mode === 'missing-button') {
    assert.equal(savedState.paused, true);
    assert.equal(savedState.exitBatch.failedCount, 1);
    assert.match(savedState.pauseReason, /没有找到商品 1005012544334149 的“申请退出活动”按钮/);
    assert.equal(desktopNotifications.length, 1, 'automatic pause should send one desktop notification');
    assert.equal(desktopNotifications[0].title, 'AE 活动助手：队列已暂停');
    assert.match(desktopNotifications[0].text, /1005012544334149/);
    assert.equal(
      titleHistory.some((title) => title.includes('【需要处理】')),
      true,
      'automatic pause should flash the page title'
    );
  } else {
    assert.equal(savedState.autoExit, false);
    assert.equal(savedState.completionNotice.alreadyExitedCount, 1);
    assert.equal(savedState.completionNotice.failedCount, 0);
    assert.equal(
      savedState.logs.some((item) => item.message.includes('原本已退出或已不在报名列表')),
      true
    );
  }
}

await runSaleResidueScenario('empty-result');
await runSaleResidueScenario('explicit-exit');
await runSaleResidueScenario('missing-button');

async function runBatchFailurePauseScenario() {
  const productIds = ['1005000000000011', '1005000000000012'];
  const campaignId = '64600';
  const activityId = '30000211756';
  const storage = new Map();
  const handlers = {};
  const searchedProductIds = [];
  let root;
  let registeredClicks = 0;

  class FakeInput {
    constructor() {
      this.placeholder = '支持商品ID搜索';
      this.currentValue = '';
    }
    focus() {}
    dispatchEvent() {
      return true;
    }
    getBoundingClientRect() {
      return { width: 240, height: 32 };
    }
  }
  Object.defineProperty(FakeInput.prototype, 'value', {
    get() {
      return this.currentValue;
    },
    set(value) {
      this.currentValue = value;
      searchedProductIds.push(value);
    }
  });
  const input = new FakeInput();
  const registered = {
    innerText: '已报名(2)',
    textContent: '已报名(2)',
    click() {
      registeredClicks += 1;
    },
    closest() {
      return this;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { width: 120, height: 32 };
    }
  };
  const rows = productIds.map((productId) => ({
    productId,
    itemId: productId,
    campaignId,
    activityId,
    activityName: '测试批量外围活动',
    catalogActivityName: '测试批量外围活动',
    saleSource: '店铺活动',
    channelId: '9999999'
  }));
  storage.set('ae.activity.assistant.v4', JSON.stringify({
    productId: productIds.join('\n'),
    dryRun: false,
    logs: [],
    plan: rows,
    scanProductIds: productIds,
    scanResults: productIds.map((productId) => ({ productId, status: 'ready', activityCount: 1 })),
    exitQueue: rows,
    exitBatch: {
      productId: productIds[0],
      productIds,
      productCount: 2,
      queuedProductCount: 2,
      skippedProductIds: [],
      total: 2,
      successCount: 0,
      alreadyExitedCount: 0,
      failedCount: 0,
      failedRows: []
    },
    autoExit: true,
    channelId: '9999999',
    scriptVersion: '0.9.7'
  }));

  const document = {
    readyState: 'complete',
    title: '活动报名',
    body: { innerText: '大促活动指南 外围活动报名' },
    documentElement: {
      appendChild(node) {
        root = node;
      }
    },
    getElementById() {
      return null;
    },
    createElement() {
      return createRoot((node) => { root = node; }, handlers);
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input') return [input];
      if (selector === 'tr,.next-table-row,.ait-table-row,div') return [];
      if (selector.includes('[role="dialog"]') || selector.includes('[aria-modal="true"]')) return [];
      if (selector.includes('button') || selector.includes('[role="tab"]') || selector.includes('span,div')) {
        return [registered];
      }
      return [];
    }
  };
  const window = {
    location: {
      search: `?campaignId=${campaignId}&activityId=${activityId}&channelId=9999999`,
      pathname: '/m_apps/campaigns/peripheral-activity',
      href: `https://csp.aliexpress.com/m_apps/campaigns/peripheral-activity?campaignId=${campaignId}&activityId=${activityId}&channelId=9999999`
    },
    lib: {
      mtop: {
        request(options) {
          if (options.api === 'mtop.global.campaign.merchants.activity.items.query') {
            return Promise.resolve({ ret: ['SUCCESS::调用成功'], data: { dataList: [] } });
          }
          return Promise.reject({ ret: ['FAIL::unexpected api'] });
        }
      }
    }
  };
  window.self = window;
  window.top = window;

  class FakeEvent {
    constructor(type, options) {
      this.type = type;
      this.options = options;
    }
  }

  vm.runInNewContext(source, {
    console,
    Date: FixedDate,
    Error,
    JSON,
    Map,
    Promise,
    URLSearchParams,
    document,
    window,
    HTMLInputElement: FakeInput,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible' };
    },
    setInterval(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearInterval() {},
    clearTimeout() {},
    setTimeout(callback, ms) {
      if (ms < 20000) queueMicrotask(callback);
      return 1;
    }
  });

  handlers.click({
    target: {
      closest() {
        return { dataset: { act: 'pause' } };
      }
    }
  });
  for (let index = 0; index < 10; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  let savedState = JSON.parse(storage.get('ae.activity.assistant.v4'));
  assert.deepEqual(searchedProductIds, []);
  assert.equal(registeredClicks, 0);
  assert.equal(savedState.paused, true);
  assert.equal(savedState.exitQueue.length, 2);
  assert.match(root?.innerHTML || '', /用户手动暂停/);

  handlers.click({
    target: {
      closest() {
        return { dataset: { act: 'pause' } };
      }
    }
  });
  for (let index = 0; index < 160; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  savedState = JSON.parse(storage.get('ae.activity.assistant.v4'));
  assert.deepEqual(searchedProductIds, [productIds[0]]);
  assert.equal(registeredClicks, 1);
  assert.equal(savedState.autoExit, true);
  assert.equal(savedState.paused, true);
  assert.equal(savedState.exitQueue.length, 1);
  assert.equal(savedState.exitQueue[0].productId, productIds[1]);
  assert.equal(savedState.exitBatch.failedCount, 1);
  assert.equal(savedState.completionNotice, null);
  assert.match(root?.innerHTML || '', /队列已暂停/);
  assert.match(root?.innerHTML || '', /继续处理/);
  assert.match(root?.innerHTML || '', new RegExp(productIds[0]));

  handlers.click({
    target: {
      closest() {
        return { dataset: { act: 'pause' } };
      }
    }
  });
  for (let index = 0; index < 160; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  savedState = JSON.parse(storage.get('ae.activity.assistant.v4'));
  assert.deepEqual(searchedProductIds, productIds);
  assert.equal(registeredClicks, 2);
  assert.equal(savedState.autoExit, true);
  assert.equal(savedState.paused, true);
  assert.equal(savedState.exitQueue.length, 0);
  assert.equal(savedState.exitBatch.failedCount, 2);
  assert.equal(savedState.completionNotice, null);

  handlers.click({
    target: {
      closest() {
        return { dataset: { act: 'pause' } };
      }
    }
  });
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  savedState = JSON.parse(storage.get('ae.activity.assistant.v4'));
  assert.equal(savedState.autoExit, false);
  assert.equal(savedState.paused, false);
  assert.equal(savedState.completionNotice.failedCount, 2);
  assert.deepEqual(savedState.completionNotice.failedRows.map((row) => row.productId), productIds);
  assert.match(root?.innerHTML || '', /批量退出完成/);
  assert.match(root?.innerHTML || '', /处理失败 2/);
  assert.match(root?.innerHTML || '', new RegExp(productIds[0]));
  assert.match(root?.innerHTML || '', new RegExp(productIds[1]));
}

await runBatchFailurePauseScenario();

async function runDelayedStockoutReasonScenario({ penalty = false } = {}) {
  const productId = '1005012719389785';
  const campaignId = '63969';
  const activityId = '30000209924';
  const storage = new Map();
  const handlers = {};
  let root;
  let dialogOpen = false;
  let reasonLookupCount = 0;
  let reasonClicks = 0;
  let submitted = false;

  const rect = () => ({ width: 180, height: 32 });
  const makeElement = (text, onClick = () => {}) => ({
    innerText: text,
    textContent: text,
    click: onClick,
    closest() {
      return this;
    },
    querySelectorAll() {
      return [];
    },
    getAttribute() {
      return null;
    },
    getBoundingClientRect: rect
  });

  class FakeInput {
    constructor() {
      this.placeholder = '支持商品ID/商品名称搜索';
      this.currentValue = '';
    }
    focus() {}
    dispatchEvent() {
      return true;
    }
    getBoundingClientRect() {
      return { width: 240, height: 32 };
    }
  }
  Object.defineProperty(FakeInput.prototype, 'value', {
    get() {
      return this.currentValue;
    },
    set(value) {
      this.currentValue = value;
    }
  });
  const input = new FakeInput();
  const registered = makeElement('已报名(355/10027)');
  const quitButton = makeElement('申请退出活动', () => {
    dialogOpen = true;
  });
  const productRow = makeElement(`商品 ${productId} 申请退出活动`);
  productRow.querySelectorAll = (selector) => selector.includes('button') ? [quitButton] : [];

  const reasonWrapper = makeElement('库\u200B存不足', () => {
    reasonClicks += 1;
  });
  const reasonText = makeElement('库\u200B存不足');
  reasonText.closest = () => reasonWrapper;
  const submitButton = makeElement('退出活动', () => {
    if (!submitButton.disabled) submitted = true;
  });
  Object.defineProperty(submitButton, 'disabled', {
    get() {
      return reasonClicks === 0;
    }
  });
  submitButton.getAttribute = (name) => name === 'aria-disabled' && submitButton.disabled ? 'true' : null;

  const reasonCandidates = () => {
    reasonLookupCount += 1;
    return reasonLookupCount >= 2 ? [reasonText] : [];
  };
  const dialog = makeElement(
    `确认申请退出本次活动？ ${penalty ? '本次退出将触发平台处罚并限制后续报名。' : '由于活动未开始，本次申请退出活动不触发处罚。'}请选择退出活动原因 修改报名的商品信息 库\u200B存不足 其他`
  );
  dialog.querySelectorAll = (selector) => {
    if (selector === 'button') return [submitButton];
    if (selector.includes('label') || selector.includes('[role="radio"]') || selector.includes('span,div')) {
      return reasonCandidates();
    }
    return [];
  };

  const row = {
    productId,
    itemId: productId,
    campaignId,
    activityId,
    activityName: '普通平台活动-早鸟价85折(俄向不生效)-共享限购-67月S级',
    catalogActivityName: '普通平台活动-早鸟价85折(俄向不生效)-共享限购-67月S级',
    saleSource: '平台活动',
    channelId: '1882016'
  };
  storage.set('ae.activity.assistant.v4', JSON.stringify({
    productId,
    logs: [],
    plan: [row],
    scanProductIds: [productId],
    scanResults: [{ productId, status: 'ready', activityCount: 1 }],
    exitQueue: [row],
    exitBatch: {
      productId,
      productIds: [productId],
      productCount: 1,
      queuedProductCount: 1,
      skippedProductIds: [],
      total: 1,
      successCount: 0,
      alreadyExitedCount: 0,
      failedCount: 0,
      failedRows: []
    },
    autoExit: true,
    channelId: '1882016',
    scriptVersion: '0.9.7'
  }));

  const document = {
    readyState: 'complete',
    title: '活动报名',
    body: { innerText: '已报名 商品报名' },
    documentElement: {
      appendChild(node) {
        root = node;
      }
    },
    getElementById() {
      return null;
    },
    createElement() {
      return createRoot((node) => { root = node; }, handlers);
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input') return [input];
      if (selector === 'tr,.next-table-row,.ait-table-row,div') return [productRow];
      if (selector.includes('[role="dialog"]') || selector.includes('[aria-modal="true"]')) {
        return dialogOpen ? [dialog] : [];
      }
      if (selector === 'label,.ait-radio-wrapper,.next-radio-wrapper,span,div') {
        return dialogOpen ? reasonCandidates() : [];
      }
      if (selector === 'button') return dialogOpen ? [submitButton] : [];
      if (selector.includes('button') || selector.includes('[role="tab"]') || selector.includes('span,div')) {
        return [registered, quitButton];
      }
      return [];
    }
  };
  const window = {
    location: {
      search: `?campaignId=${campaignId}&activityId=${activityId}&channelId=1882016`,
      pathname: '/m_apps/campaigns/peripheral-activity',
      href: `https://csp.aliexpress.com/m_apps/campaigns/peripheral-activity?campaignId=${campaignId}&activityId=${activityId}&channelId=1882016`
    },
    lib: {
      mtop: {
        request(options) {
          if (options.api === 'mtop.global.campaign.merchants.activity.items.query') {
            return Promise.resolve({
              ret: ['SUCCESS::调用成功'],
              data: { dataList: [{ itemId: productId, itemStatus: submitted ? 'OPERATOR_EXIT' : 'PASS' }] }
            });
          }
          return Promise.reject({ ret: ['FAIL::unexpected api'] });
        }
      }
    }
  };
  window.self = window;
  window.top = window;

  class FakeEvent {
    constructor(type, options) {
      this.type = type;
      this.options = options;
    }
  }

  vm.runInNewContext(source, {
    console,
    Date: FixedDate,
    Error,
    JSON,
    Map,
    Promise,
    URLSearchParams,
    document,
    window,
    HTMLInputElement: FakeInput,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible' };
    },
    setInterval(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearInterval() {},
    clearTimeout() {},
    setTimeout(callback, ms) {
      if (ms < 20000) queueMicrotask(callback);
      return 1;
    }
  });

  for (let index = 0; index < 180; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const savedState = JSON.parse(storage.get('ae.activity.assistant.v4'));
  if (penalty) {
    assert.equal(reasonClicks, 0, 'a penalty warning must pause before selecting a reason');
    assert.equal(submitted, false, 'a penalty warning must never submit the exit');
    assert.equal(savedState.autoExit, true);
    assert.equal(savedState.paused, true);
    assert.equal(savedState.exitBatch.failedCount, 1);
    assert.match(root?.innerHTML || '', /可能存在处罚或限制/);
  } else {
    assert.equal(reasonClicks, 1, 'the delayed stockout reason should be selected once');
    assert.equal(submitted, true, 'the ordinary exit button should be submitted after selecting stockout');
    assert.equal(savedState.autoExit, false);
    assert.equal(savedState.paused, false);
    assert.equal(savedState.completionNotice.successCount, 1);
    assert.doesNotMatch(root?.innerHTML || '', /没有找到“库存不足”/);
  }
}

await runDelayedStockoutReasonScenario();
await runDelayedStockoutReasonScenario({ penalty: true });

async function runUnifiedSequentialEntryScenario() {
  const productId = '1005000000000099';
  const sourceCampaignId = '64662';
  const sourceActivityId = '30000211732';
  const inboundCampaignId = '64640';
  const inboundActivityId = '30000211744';
  const storage = new Map();
  const handlers = {};
  const calls = [];
  const clickOrder = [];
  let root;
  let stage = 'peripheral-rules';
  let delayedOuterEntryChecks = 0;
  let delayedInboundEntryChecks = 0;

  class FakeInput {
    constructor(placeholder) {
      this.placeholder = placeholder;
      this.currentValue = '';
    }
    focus() {}
    dispatchEvent() {
      return true;
    }
    getBoundingClientRect() {
      return { width: 260, height: 32 };
    }
  }
  Object.defineProperty(FakeInput.prototype, 'value', {
    get() {
      return this.currentValue;
    },
    set(value) {
      this.currentValue = value;
    }
  });

  const outerInput = new FakeInput('支持商品ID搜索');
  const inboundInput = new FakeInput('支持商品ID/商品名称搜索');
  const makeInteractive = (text, onClick) => ({
    innerText: text,
    textContent: text,
    click: onClick,
    closest() {
      return this;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { width: 220, height: 32 };
    }
  });

  const window = {
    location: {
      search: `?campaignId=${sourceCampaignId}&activityId=${sourceActivityId}&channelId=9999999`,
      pathname: '/m_apps/campaigns/peripheral-activity',
      href: `https://csp.aliexpress.com/m_apps/campaigns/peripheral-activity?campaignId=${sourceCampaignId}&activityId=${sourceActivityId}&channelId=9999999`
    },
    lib: {
      mtop: {
        request(options) {
          calls.push(options);
          if (options.api !== 'mtop.global.campaign.merchants.activity.items.query') {
            return Promise.reject({ ret: ['FAIL::unexpected api'] });
          }
          const isInbound = String(options.data.campaignId) === inboundCampaignId &&
            String(options.data.activityId) === inboundActivityId;
          return Promise.resolve({
            ret: ['SUCCESS::调用成功'],
            data: {
              dataList: [{
                itemId: productId,
                itemStatus: isInbound ? 'PASS' : 'OPERATOR_EXIT'
              }]
            }
          });
        }
      }
    }
  };
  window.self = window;
  window.top = window;

  const navigate = (pathname, campaignId, activityId) => {
    window.location.pathname = pathname;
    window.location.search = `?campaignId=${campaignId}&activityId=${activityId}&channelId=9999999`;
    window.location.href = `https://csp.aliexpress.com${pathname}${window.location.search}`;
  };
  const startOuter = makeInteractive('开始报名活动商品', () => {
    clickOrder.push('开始报名活动商品-外围');
    stage = 'peripheral-products';
  });
  const nextToQualification = makeInteractive('下一步，开始报名入围活动', () => {
    clickOrder.push('下一步，开始报名入围活动');
    stage = 'qualification';
    navigate('/m_apps/campaigns/one-stock-approval', inboundCampaignId, inboundActivityId);
  });
  const nextToInbound = makeInteractive('下一步，报名入围活动', () => {
    clickOrder.push('下一步，报名入围活动');
    stage = 'inbound-rules';
    navigate('/m_apps/campaigns/one-stock-goodssign', inboundCampaignId, inboundActivityId);
  });
  const startInbound = makeInteractive('开始报名活动商品', () => {
    clickOrder.push('开始报名活动商品-入围');
    stage = 'inbound-products';
  });
  const registered = makeInteractive('已报名(1)', () => {
    clickOrder.push('已报名');
  });

  const row = {
    productId,
    itemId: productId,
    campaignId: sourceCampaignId,
    activityId: sourceActivityId,
    activityName: '【2026年8月Choice Day】入围活动-排JV&欧盟地区',
    catalogActivityName: '【2026年8月Choice Day】外围活动-排JV&欧盟地区',
    saleSource: '平台活动',
    channelId: '9999999'
  };
  storage.set('ae.activity.assistant.v4', JSON.stringify({
    productId,
    dryRun: false,
    logs: [],
    plan: [row],
    exitQueue: [row],
    exitBatch: { productId, total: 1, successCount: 0, alreadyExitedCount: 0 },
    exitFlow: null,
    autoExit: true,
    channelId: '9999999',
    scriptVersion: '0.9.7'
  }));

  const document = {
    readyState: 'complete',
    title: '活动报名',
    body: { innerText: '大促活动指南 外围活动报名 店铺资质审核 入围活动报名' },
    documentElement: {
      appendChild(node) {
        root = node;
      }
    },
    getElementById() {
      return null;
    },
    createElement() {
      return createRoot((node) => { root = node; }, handlers);
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input') {
        if (stage === 'peripheral-products') return [outerInput];
        if (stage === 'inbound-products') return [inboundInput];
        return [];
      }
      if (selector === 'tr,.next-table-row,.ait-table-row,div') return [];
      if (selector.includes('[role="dialog"]') || selector.includes('[aria-modal="true"]')) return [];
      if (selector.includes('button') || selector.includes('[role="tab"]') || selector.includes('span,div')) {
        if (stage === 'peripheral-rules') {
          delayedOuterEntryChecks += 1;
          return delayedOuterEntryChecks >= 7 ? [startOuter] : [];
        }
        if (stage === 'peripheral-products') return [nextToQualification];
        if (stage === 'qualification') return [nextToInbound];
        if (stage === 'inbound-rules') {
          delayedInboundEntryChecks += 1;
          return delayedInboundEntryChecks >= 7 ? [startInbound] : [];
        }
        if (stage === 'inbound-products') return [registered];
      }
      return [];
    }
  };

  class FakeEvent {
    constructor(type, options) {
      this.type = type;
      this.options = options;
    }
  }

  vm.runInNewContext(source, {
    console,
    Date: FixedDate,
    Error,
    JSON,
    Map,
    Promise,
    URLSearchParams,
    document,
    window,
    HTMLInputElement: FakeInput,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible' };
    },
    setInterval(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearInterval() {},
    clearTimeout() {},
    setTimeout(callback, ms) {
      if (ms < 20000) queueMicrotask(callback);
      return 1;
    }
  });

  for (let index = 0; index < 160; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(clickOrder, [
    '开始报名活动商品-外围',
    '下一步，开始报名入围活动',
    '下一步，报名入围活动',
    '开始报名活动商品-入围',
    '已报名'
  ]);
  assert.equal(delayedOuterEntryChecks >= 7, true, 'the activity entry should wait for delayed page rendering');
  assert.equal(delayedInboundEntryChecks >= 7, true, 'the inbound activity entry should wait for delayed page rendering');
  assert.equal(outerInput.value, '', 'the outer activity search input must not be used for an inbound exit');
  assert.equal(inboundInput.value, productId, 'the inbound activity search input should receive the product ID');
  assert.equal(window.location.pathname, '/m_apps/campaigns/one-stock-goodssign');
  assert.equal(
    calls.some((call) => String(call.data?.campaignId) === inboundCampaignId && String(call.data?.activityId) === inboundActivityId),
    true,
    'the unified inbound parent record should be used for status verification'
  );
  assert.match(root?.innerHTML || '', /没有找到商品 1005000000000099 的“申请退出活动”按钮/);
}

await runUnifiedSequentialEntryScenario();

console.log('userscript smoke test passed');
