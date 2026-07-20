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
assert.match(metadata, /@version\s+0\.8\.11/);
assert.match(metadata, /@updateURL\s+https:\/\/xinhuaya\.github\.io\/aliexpress-activity-helper\/stable\/aliexpress-activity-helper\.meta\.js/);
assert.match(metadata, /@downloadURL\s+https:\/\/xinhuaya\.github\.io\/aliexpress-activity-helper\/stable\/aliexpress-activity-helper\.user\.js/);
assert.match(metadata, /@noframes/);
assert.doesNotMatch(source, /codex/i);
assert.match(metadata, /@match\s+https:\/\/\*\.aliexpress\.com\/\*/);
assert.doesNotMatch(source, /channelId=2350569/);
assert.match(source, /直接读取商品管理中该商品 SALE/);
assert.match(source, /parseSaleTooltip/);
assert.match(source, /localizeActTime/);
assert.match(source, /同意并下一步/);
assert.match(source, /enterActivitySignupStep/);
assert.match(source, /nextButton\.click\(\);\s+await waitForPathChange\(path, 10000\);/);
assert.match(source, /请确认已进入正确活动页面/);
assert.doesNotMatch(source, /包含已结束活动/);
assert.match(source, /mtop\.global\.merchant\.new\.product\.manager\.render\.list/);
assert.doesNotMatch(source, /mapWithRateLimit/);
assert.match(source, /baxia-dialog-mask/);
assert.match(source, /_____tmd_____\/punish/);
assert.match(source, /活动退出完成/);
assert.match(source, /商品优化完成后，记得重新报名需要参加的活动/);

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
  const productId = '1005000000000088';
  const completionStorage = new Map();
  const completionHandlers = {};
  let completionRoot;
  completionStorage.set('ae.activity.assistant.v4', JSON.stringify({
    productId,
    dryRun: false,
    logs: [],
    plan: [],
    exitQueue: [],
    exitBatch: {
      productId,
      total: 4,
      successCount: 3,
      alreadyExitedCount: 1
    },
    completionNotice: null,
    autoExit: true,
    channelId: '9999999',
    scriptVersion: '0.8.11'
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
  assert.match(completionRoot?.innerHTML || '', /活动退出完成/);
  assert.match(completionRoot?.innerHTML || '', new RegExp(productId));
  assert.match(completionRoot?.innerHTML || '', />3<\/span><span class="aeaa-completion-label">退出成功/);
  assert.match(completionRoot?.innerHTML || '', />1<\/span><span class="aeaa-completion-label">原本已退出/);

  completionHandlers.click({
    target: {
      closest() {
        return { dataset: { act: 'dismiss-completion' } };
      }
    }
  });
  assert.doesNotMatch(completionRoot?.innerHTML || '', /活动退出完成/);
  assert.equal(JSON.parse(completionStorage.get('ae.activity.assistant.v4')).completionNotice, null);
}

await runCompletionNoticeScenario();

function createSaleScenario({
  failCatalog = false,
  ambiguousPlatform = false,
  localizedSecondTime = false,
  unifiedOnly = false,
  nonInboundDecoy = false
} = {}) {
  const handlers = {};
  const calls = [];
  const productId = '1005000000000001';
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
  const createParserContainer = () => ({
    html: '',
    set innerHTML(value) {
      this.html = value;
    },
    get innerHTML() {
      return this.html;
    },
    querySelectorAll(selector) {
      return selector === 'dl' && this.html.includes('店铺活动') ? [platformDl, shopDl] : [];
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
            return Promise.resolve({
              ret: ['SUCCESS::调用成功'],
              data: {
                table: {
                  dataSource: [{
                    productId,
                    itemDesc: {
                      iconList: [{
                        uiType: 'hoverTip',
                        type: 'text',
                        text: 'SALE',
                        hoverTip: [{
                          dataSource: [
                            '<dl><dt>平台活动：</dt>',
                            '<dd>【2026年7月A+】入围活动-非俄语区&amp;欧盟地区</dd>',
                            `<dd>${saleStartText} - ${saleEndText}</dd></dl>`,
                            '<dl><dt>店铺活动：</dt>',
                            '<dd>【2026年7月A+】外围活动-非俄语区&amp;欧盟地区</dd>',
                            `<dd>${saleStartText} - ${saleEndText}</dd></dl>`
                          ]
                        }]
                      }]
                    }
                  }]
                }
              }
            });
          }
          if (options.api === 'mtop.global.campaign.merchants.activity.items.query') {
            const isSignedPlatformActivity = String(options.data.activityId) === '30000211727';
            return Promise.resolve({
              ret: ['SUCCESS::调用成功'],
              data: {
                dataList: isSignedPlatformActivity ? [{ itemId: productId, itemStatus: 'AUDIT_PASSED' }] : []
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
      getItem() {
        return null;
      },
      setItem() {}
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

  return { handlers, calls, getRoot: () => root, productId };
}

async function runScan(scenario) {
  scenario.handlers.input({ target: { dataset: { field: 'product' }, value: scenario.productId } });
  scenario.handlers.click({
    target: {
      closest() {
        return { dataset: { act: 'scan' } };
      }
    }
  });
  for (let index = 0; index < 30; index += 1) {
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
assert.match(saleScenario.getRoot()?.innerHTML || '', /保留全部 2 条平台和店铺活动/);
assert.match(saleScenario.getRoot()?.innerHTML || '', /没有遍历全店活动/);

const ambiguousScenario = createSaleScenario({ ambiguousPlatform: true });
await runScan(ambiguousScenario);
const verificationCalls = ambiguousScenario.calls
  .filter((call) => call.api === 'mtop.global.campaign.merchants.activity.items.query');
assert.equal(verificationCalls.length, 2);
assert.match(ambiguousScenario.getRoot()?.innerHTML || '', /30000211726/);
assert.match(ambiguousScenario.getRoot()?.innerHTML || '', /30000211727/);
assert.doesNotMatch(ambiguousScenario.getRoot()?.innerHTML || '', /30000211729/);
assert.match(ambiguousScenario.getRoot()?.innerHTML || '', /按商品实际报名记录确认 1 个活动编号/);

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
  const registered = makeInteractive('已报名(1)', () => {
    registeredClicks += 1;
  });

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
    scriptVersion: '0.8.11'
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
        return includeProductTab ? [productTab, entry, registered] : [entry, registered];
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
    scriptVersion: '0.8.11'
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
        if (stage === 'peripheral-rules') return [startOuter];
        if (stage === 'peripheral-products') return [nextToQualification];
        if (stage === 'qualification') return [nextToInbound];
        if (stage === 'inbound-rules') return [startInbound];
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
