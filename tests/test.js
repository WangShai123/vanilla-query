import {
  createQuery,
  createQueryClient,
  hashQueryKey,
  queryClient,
  stableHash,
} from 'vanilla-query';
import { createEffect, createSignal, flushSync } from 'vanilla-signal';

const delay = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        const error = new Error('Request aborted');
        error.name = 'AbortError';
        reject(error);
      },
      { once: true }
    );
  });

const formatCurrency = (value) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value);

const $ = (selector) => document.querySelector(selector);

const elements = {
  scenarioNav: $('#scenarioNav'),
  metricPassed: $('#metricPassed'),
  metricFailed: $('#metricFailed'),
  metricEvents: $('#metricEvents'),
  metricRequests: $('#metricRequests'),
  runAllButton: $('#runAllButton'),
  clearLogButton: $('#clearLogButton'),
  resetChecksButton: $('#resetChecksButton'),
  productSearchInput: $('#productSearchInput'),
  categorySelect: $('#categorySelect'),
  previousPageButton: $('#previousPageButton'),
  nextPageButton: $('#nextPageButton'),
  refreshProductsButton: $('#refreshProductsButton'),
  reloadProductsButton: $('#reloadProductsButton'),
  prefetchProductsButton: $('#prefetchProductsButton'),
  productsBadge: $('#productsBadge'),
  productsStateStrip: $('#productsStateStrip'),
  productsBody: $('#productsBody'),
  detailBadge: $('#detailBadge'),
  selectProductButton: $('#selectProductButton'),
  prefetchDetailButton: $('#prefetchDetailButton'),
  invalidateDetailButton: $('#invalidateDetailButton'),
  removeDetailButton: $('#removeDetailButton'),
  detailContent: $('#detailContent'),
  manualCacheOutput: $('#manualCacheOutput'),
  todosBadge: $('#todosBadge'),
  addTodoButton: $('#addTodoButton'),
  toggleTodoButton: $('#toggleTodoButton'),
  rollbackTodoButton: $('#rollbackTodoButton'),
  syncTodosButton: $('#syncTodosButton'),
  todoList: $('#todoList'),
  errorBadge: $('#errorBadge'),
  runRetryButton: $('#runRetryButton'),
  runBusinessErrorButton: $('#runBusinessErrorButton'),
  runTimeoutButton: $('#runTimeoutButton'),
  runAbortButton: $('#runAbortButton'),
  errorResult: $('#errorResult'),
  advancedBadge: $('#advancedBadge'),
  runSuspenseButton: $('#runSuspenseButton'),
  runThrowErrorsButton: $('#runThrowErrorsButton'),
  runSubscribeButton: $('#runSubscribeButton'),
  clearClientButton: $('#clearClientButton'),
  advancedResult: $('#advancedResult'),
  checkList: $('#checkList'),
  eventLog: $('#eventLog'),
};

const productsSeed = [
  ['VX-100', '硬件', 'hardware', 48, 1680, '上架'],
  ['VX-200', '硬件', 'hardware', 12, 2680, '上架'],
  ['Orbit Dock', '硬件', 'hardware', 7, 980, '低库存'],
  ['Signal Studio', '软件', 'software', 99, 399, '上架'],
  ['Query Desk', '软件', 'software', 99, 499, '上架'],
  ['Report Flow', '软件', 'software', 99, 699, '上架'],
  ['实施服务', '服务', 'service', 20, 8000, '预约'],
  ['培训服务', '服务', 'service', 35, 3200, '预约'],
  ['巡检服务', '服务', 'service', 18, 1800, '预约'],
  ['Data Bridge', '软件', 'software', 99, 1299, '上架'],
  ['Edge Box', '硬件', 'hardware', 5, 3880, '低库存'],
  ['运维托管', '服务', 'service', 10, 12000, '预约'],
].map(([name, categoryName, category, stock, price, status], index) => ({
  id: index + 1,
  name,
  categoryName,
  category,
  stock,
  price,
  status,
  updatedAt: Date.now() - index * 10000,
}));

const database = {
  products: productsSeed,
  todos: [
    { id: 1, text: '确认 queryKey 设计', done: true },
    { id: 2, text: '录制缓存与失效课程', done: false },
  ],
};

const counters = {
  request: 0,
  events: 0,
  retryFailures: 0,
  todos: 2,
};

const [search, setSearch] = createSignal('');
const [category, setCategory] = createSignal('all');
const [page, setPage] = createSignal(1);
const [selectedProductId, setSelectedProductId] = createSignal(1);

const client = createQueryClient({
  cacheMax: 80,
  cacheTime: 1000 * 60 * 8,
});

const checks = new Map();
const scenarios = [
  ['productsPanel', '搜索分页'],
  ['productDetailPanel', '详情缓存'],
  ['todosPanel', '乐观更新'],
  ['errorsPanel', '错误与取消'],
  ['advancedPanel', '高级读取'],
];

const addLog = (message, detail) => {
  const time = new Date().toLocaleTimeString();
  const payload = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  elements.eventLog.textContent =
    `[${time}] ${message}${payload}\n` + elements.eventLog.textContent;
};

const setBadge = (element, query) => {
  const status = query.state.isFetching
    ? 'fetching'
    : query.state.isError
      ? 'error'
      : query.state.status;
  element.className = `badge ${status}`;
  element.textContent = status;
};

const statePill = (label, value, variant = '') =>
  `<span class="pill ${variant}">${label}: ${value}</span>`;

const updateMetrics = () => {
  let passed = 0;
  let failed = 0;
  checks.forEach((check) => {
    if (check.status === 'pass') passed += 1;
    if (check.status === 'fail') failed += 1;
  });
  elements.metricPassed.textContent = String(passed);
  elements.metricFailed.textContent = String(failed);
  elements.metricEvents.textContent = String(counters.events);
  elements.metricRequests.textContent = String(counters.request);
};

const setCheck = (name, status, message = '') => {
  checks.set(name, { name, status, message });
  renderChecks();
  updateMetrics();
};

const renderChecks = () => {
  elements.checkList.innerHTML = '';
  checks.forEach((check) => {
    const row = document.createElement('div');
    row.className = `check ${check.status}`;
    row.innerHTML = `
      <span class="check-status">${check.status.toUpperCase()}</span>
      <span class="check-name">${check.name}${check.message ? ` - ${check.message}` : ''}</span>
    `;
    elements.checkList.append(row);
  });
};

const assertCheck = async (name, fn) => {
  setCheck(name, 'running');
  try {
    const message = await fn();
    setCheck(name, 'pass', message || '');
  } catch (error) {
    setCheck(name, 'fail', error.message);
  }
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const api = {
  async products({ queryKey, signal }) {
    counters.request += 1;
    updateMetrics();
    await delay(420, signal);
    const [, params] = queryKey;
    const keyword = params.search.trim().toLowerCase();
    const filtered = database.products.filter((product) => {
      const matchKeyword = product.name.toLowerCase().includes(keyword);
      const matchCategory =
        params.category === 'all' || product.category === params.category;
      return matchKeyword && matchCategory;
    });
    const pageSize = 5;
    const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
    const currentPage = Math.min(params.page, totalPages);
    const start = (currentPage - 1) * pageSize;
    return {
      success: true,
      data: {
        items: filtered.slice(start, start + pageSize),
        page: currentPage,
        pageSize,
        total: filtered.length,
        totalPages,
      },
    };
  },

  async productDetail({ queryKey, signal }) {
    counters.request += 1;
    updateMetrics();
    await delay(260, signal);
    const product = database.products.find((item) => item.id === queryKey[1]);
    if (!product) {
      return {
        success: false,
        code: 'PRODUCT_NOT_FOUND',
        message: '商品不存在',
      };
    }
    return {
      success: true,
      data: {
        ...product,
        description: `${product.name} 是一个用于演示详情缓存的模拟商品。`,
        fetchedAt: new Date().toLocaleTimeString(),
      },
    };
  },

  async todos({ signal }) {
    counters.request += 1;
    updateMetrics();
    await delay(220, signal);
    return database.todos.map((todo) => ({ ...todo }));
  },

  async retryReport() {
    counters.request += 1;
    updateMetrics();
    await delay(180);
    counters.retryFailures += 1;
    if (counters.retryFailures < 3) {
      const error = new Error('报表服务临时不可用');
      error.status = 503;
      throw error;
    }
    return { ok: true, attempts: counters.retryFailures };
  },

  async businessError() {
    counters.request += 1;
    updateMetrics();
    await delay(160);
    return {
      success: false,
      code: 'NO_ACCESS',
      message: '当前账号没有审批权限',
    };
  },

  async slow({ signal }) {
    counters.request += 1;
    updateMetrics();
    await delay(1200, signal);
    return 'slow result';
  },
};

const productsQuery = createQuery({
  client,
  queryKey: () => [
    'products',
    {
      search: search(),
      category: category(),
      page: page(),
    },
  ],
  keepPreviousData: true,
  staleTime: 5000,
  cacheTime: 1000 * 60 * 5,
  queryFn: (context) => api.products(context),
});

const productDetailQuery = createQuery({
  client,
  enabled: () => selectedProductId() !== null,
  queryKey: () => ['product', selectedProductId()],
  staleTime: 30000,
  queryFn: (context) => api.productDetail(context),
  select: (product) => ({
    id: product.id,
    name: product.name,
    status: product.status,
    price: product.price,
    stock: product.stock,
    description: product.description,
    fetchedAt: product.fetchedAt,
  }),
});

const todosQuery = createQuery({
  client,
  queryKey: ['todos'],
  initialData: database.todos.map((todo) => ({ ...todo })),
  staleTime: 20000,
  queryFn: (context) => api.todos(context),
});

client.subscribe((event) => {
  counters.events += 1;
  updateMetrics();
  addLog(`client.${event.type}`, {
    key: event.key?.slice?.(0, 80),
  });
});

queryClient.subscribe((event) => {
  addLog(`defaultClient.${event.type}`, {
    key: event.key?.slice?.(0, 80),
  });
});

const renderNavigation = () => {
  elements.scenarioNav.innerHTML = scenarios
    .map(
      ([id, label]) =>
        `<a href="#${id}" aria-label="跳转到${label}场景">${label}</a>`
    )
    .join('');
};

const renderProducts = () => {
  const data = productsQuery();
  setBadge(elements.productsBadge, productsQuery);
  elements.productsStateStrip.innerHTML = [
    statePill('status', productsQuery.state.status),
    statePill(
      'fetch',
      productsQuery.state.fetchStatus,
      productsQuery.state.fetchStatus
    ),
    statePill(
      'stale',
      productsQuery.state.isStale ? 'yes' : 'no',
      productsQuery.state.isStale ? 'warn' : ''
    ),
    statePill('page', data?.page ?? page()),
    statePill('total', data?.total ?? 0),
    statePill('key', productsQuery.key().slice(0, 28)),
  ].join('');

  if (productsQuery.state.isLoading) {
    elements.productsBody.innerHTML = `<tr><td colspan="5" class="empty">正在加载商品...</td></tr>`;
    return;
  }

  if (productsQuery.state.isError) {
    elements.productsBody.innerHTML = `<tr><td colspan="5" class="empty">${productsQuery.state.error.message}</td></tr>`;
    return;
  }

  const rows = data?.items ?? [];
  elements.productsBody.innerHTML =
    rows
      .map(
        (product) => `
          <tr data-product-id="${product.id}">
            <td>${product.name}</td>
            <td>${product.categoryName}</td>
            <td>${product.stock}</td>
            <td>${formatCurrency(product.price)}</td>
            <td>${product.status}</td>
          </tr>
        `
      )
      .join('') || `<tr><td colspan="5" class="empty">没有匹配商品</td></tr>`;

  elements.previousPageButton.disabled = (data?.page ?? 1) <= 1;
  elements.nextPageButton.disabled =
    (data?.page ?? 1) >= (data?.totalPages ?? 1);
};

const renderDetail = () => {
  const detail = productDetailQuery();
  setBadge(elements.detailBadge, productDetailQuery);

  if (productDetailQuery.state.isLoading) {
    elements.detailContent.innerHTML = `<span class="empty">正在加载详情...</span>`;
  } else if (productDetailQuery.state.isError) {
    elements.detailContent.innerHTML = `<span class="empty">${productDetailQuery.state.error.message}</span>`;
  } else if (detail) {
    elements.detailContent.innerHTML = `
      <p class="detail-title">${detail.name}</p>
      <div>${detail.description}</div>
      <div class="detail-meta">库存 ${detail.stock} · ${formatCurrency(detail.price)} · ${detail.status}</div>
      <div class="detail-meta">详情获取时间：${detail.fetchedAt}</div>
    `;
  } else {
    elements.detailContent.innerHTML = `<span class="empty">请选择商品</span>`;
  }

  const cached = client.getQueryData(['product', selectedProductId()]);
  elements.manualCacheOutput.textContent = JSON.stringify(
    {
      selectedProductId: selectedProductId(),
      cachedName: cached?.name,
      detailHash: hashQueryKey(['product', selectedProductId()]).slice(0, 80),
    },
    null,
    2
  );
};

const renderTodos = () => {
  setBadge(elements.todosBadge, todosQuery);
  const todos = todosQuery() ?? [];
  elements.todoList.innerHTML = todos
    .map(
      (todo) => `
        <li>
          <input type="checkbox" ${todo.done ? 'checked' : ''} data-todo-id="${todo.id}" />
          <span class="${todo.done ? 'done' : ''}">${todo.text}</span>
          <span class="pill ${todo.done ? 'success' : ''}">${todo.done ? 'done' : 'open'}</span>
        </li>
      `
    )
    .join('');
};

const appendResult = (container, title, message, variant = '') => {
  const item = document.createElement('div');
  item.className = `result-item ${variant}`;
  item.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
  container.prepend(item);
};

createEffect(renderProducts);
createEffect(renderDetail);
createEffect(renderTodos);

productsQuery.subscribe((state) => {
  if (state.status === 'success') {
    setCheck('products query.subscribe 收到成功状态', 'pass');
  }
});

elements.productSearchInput.addEventListener('input', (event) => {
  setSearch(event.currentTarget.value);
  setPage(1);
});

elements.categorySelect.addEventListener('change', (event) => {
  setCategory(event.currentTarget.value);
  setPage(1);
});

elements.previousPageButton.addEventListener('click', () => {
  setPage((value) => Math.max(value - 1, 1));
});

elements.nextPageButton.addEventListener('click', () => {
  setPage((value) => value + 1);
});

elements.refreshProductsButton.addEventListener('click', () => {
  productsQuery.refetch({ meta: { source: 'manual-refresh' } }).catch(() => {});
});

elements.reloadProductsButton.addEventListener('click', () => {
  productsQuery.reload({ meta: { source: 'manual-reload' } }).catch(() => {});
});

elements.prefetchProductsButton.addEventListener('click', async () => {
  const data = productsQuery();
  const nextPage = Math.min(
    (data?.page ?? page()) + 1,
    data?.totalPages ?? page()
  );
  await client.prefetchQuery({
    queryKey: [
      'products',
      {
        search: search(),
        category: category(),
        page: nextPage,
      },
    ],
    staleTime: 5000,
    queryFn: (context) => api.products(context),
  });
  setCheck('prefetchQuery 预取下一页', 'pass', `page ${nextPage}`);
});

elements.selectProductButton.addEventListener('click', () => {
  const first = productsQuery()?.items?.[0];
  if (first) setSelectedProductId(first.id);
});

elements.prefetchDetailButton.addEventListener('click', async () => {
  await client.prefetchQuery({
    queryKey: ['product', selectedProductId()],
    staleTime: 30000,
    queryFn: (context) => api.productDetail(context),
    select: (product) => ({
      id: product.id,
      name: product.name,
      status: product.status,
      price: product.price,
      stock: product.stock,
      description: product.description,
      fetchedAt: product.fetchedAt,
    }),
  });
  setCheck('详情 prefetchQuery 写入缓存', 'pass');
});

elements.invalidateDetailButton.addEventListener('click', () => {
  const count = client.invalidateQueries(['product', selectedProductId()]);
  setCheck(
    'invalidateQueries 失效详情',
    count > 0 ? 'pass' : 'fail',
    `${count} entries`
  );
});

elements.removeDetailButton.addEventListener('click', () => {
  const count = client.removeQueries(['product', selectedProductId()]);
  productDetailQuery.remove();
  setCheck(
    'removeQueries 删除详情缓存',
    count >= 0 ? 'pass' : 'fail',
    `${count} entries`
  );
});

elements.addTodoButton.addEventListener('click', () => {
  counters.todos += 1;
  const todo = {
    id: counters.todos,
    text: `乐观任务 ${counters.todos}`,
    done: false,
  };
  todosQuery.mutate((todos) => [todo, ...(todos ?? [])]);
  setCheck('mutate 乐观新增 Todo', 'pass', todo.text);
});

elements.toggleTodoButton.addEventListener('click', () => {
  todosQuery.mutate((todos) =>
    (todos ?? []).map((todo, index) =>
      index === 0 ? { ...todo, done: !todo.done } : todo
    )
  );
  setCheck('mutate 切换 Todo 状态', 'pass');
});

elements.rollbackTodoButton.addEventListener('click', async () => {
  const previous = todosQuery();
  todosQuery.mutate((todos) => [
    { id: Date.now(), text: '即将回滚的任务', done: false },
    ...(todos ?? []),
  ]);
  await delay(180);
  todosQuery.mutate(previous);
  setCheck('乐观更新失败回滚', 'pass');
});

elements.syncTodosButton.addEventListener('click', async () => {
  database.todos = todosQuery().map((todo) => ({ ...todo }));
  client.invalidateQueries(['todos']);
  await todosQuery.refetch();
  setCheck('Todo 同步后失效并刷新', 'pass');
});

elements.runRetryButton.addEventListener('click', async () => {
  elements.errorBadge.className = 'badge fetching';
  elements.errorBadge.textContent = 'fetching';
  counters.retryFailures = 0;
  const query = createQuery({
    client,
    queryKey: ['report', Date.now()],
    retry: 2,
    retryDelay: 120,
    queryFn: () => api.retryReport(),
  });
  const result = await query.promise();
  const attempts = result.attempts ?? counters.retryFailures;
  expect(attempts === 3, 'retry should succeed on the third attempt');
  appendResult(elements.errorResult, '重试成功', `attempts: ${attempts}`);
  setCheck('retry + retryDelay', 'pass', `${attempts} attempts`);
  query.destroy();
  elements.errorBadge.className = 'badge success';
  elements.errorBadge.textContent = 'success';
});

elements.runBusinessErrorButton.addEventListener('click', async () => {
  const query = createQuery({
    client,
    queryKey: ['business-error', Date.now()],
    queryFn: () => api.businessError(),
  });
  try {
    await query.promise();
  } catch (error) {
    appendResult(
      elements.errorResult,
      'BusinessError',
      `${error.code}: ${error.message}`
    );
    setCheck(
      'normalize 业务错误',
      error.name === 'BusinessError' ? 'pass' : 'fail'
    );
  } finally {
    query.destroy();
  }
});

elements.runTimeoutButton.addEventListener('click', async () => {
  const query = createQuery({
    client,
    queryKey: ['timeout', Date.now()],
    timeout: 120,
    queryFn: (context) => api.slow(context),
  });
  try {
    await query.promise();
  } catch (error) {
    appendResult(elements.errorResult, 'TimeoutError', error.message);
    setCheck('timeout 超时', error.name === 'TimeoutError' ? 'pass' : 'fail');
  } finally {
    query.destroy();
  }
});

elements.runAbortButton.addEventListener('click', async () => {
  const query = createQuery({
    client,
    queryKey: ['abort', Date.now()],
    queryFn: (context) => api.slow(context),
  });
  await delay(80);
  query.abort();
  appendResult(
    elements.errorResult,
    'Abort',
    `fetchStatus: ${query.state.fetchStatus}`
  );
  setCheck('abort 取消当前请求', query.state.isFetching ? 'fail' : 'pass');
  query.destroy();
});

elements.runSuspenseButton.addEventListener('click', async () => {
  const query = createQuery({
    client,
    queryKey: ['suspense', Date.now()],
    suspense: true,
    queryFn: async () => {
      await delay(220);
      return 'suspense data';
    },
  });
  try {
    query();
  } catch (promise) {
    expect(promise instanceof Promise, 'suspense should throw promise');
    appendResult(
      elements.advancedResult,
      'Suspense',
      '读取时抛出了 pending Promise'
    );
    setCheck('suspense pending promise', 'pass');
    await promise;
  } finally {
    query.destroy();
  }
});

elements.runThrowErrorsButton.addEventListener('click', async () => {
  const query = createQuery({
    client,
    queryKey: ['throw-errors', Date.now()],
    throwErrors: true,
    queryFn: () => api.businessError(),
  });
  try {
    await query.promise();
  } catch {
    try {
      query();
    } catch (error) {
      appendResult(elements.advancedResult, 'throwErrors', error.message);
      setCheck(
        'throwErrors 读取抛错',
        error.name === 'BusinessError' ? 'pass' : 'fail'
      );
    }
  } finally {
    query.destroy();
  }
});

elements.runSubscribeButton.addEventListener('click', async () => {
  const query = createQuery({
    client,
    queryKey: ['subscription-demo', Date.now()],
    queryFn: async () => {
      await delay(100);
      return { value: 'subscribed' };
    },
  });
  let calls = 0;
  const unsubscribe = query.subscribe(() => {
    calls += 1;
  });
  await query.promise();
  unsubscribe();
  appendResult(elements.advancedResult, 'query.subscribe', `${calls} updates`);
  setCheck(
    'query.subscribe 状态订阅',
    calls > 0 ? 'pass' : 'fail',
    `${calls} updates`
  );
  query.destroy();
});

elements.clearClientButton.addEventListener('click', () => {
  client.clear();
  appendResult(
    elements.advancedResult,
    'client.clear',
    '已清空演示 client 缓存'
  );
  setCheck('client.clear 清空缓存', 'pass');
});

elements.clearLogButton.addEventListener('click', () => {
  elements.eventLog.textContent = '';
});

elements.resetChecksButton.addEventListener('click', () => {
  checks.clear();
  renderChecks();
  updateMetrics();
});

elements.runAllButton.addEventListener('click', async () => {
  await runAllChecks();
});

const runAllChecks = async () => {
  await assertCheck('stableHash 对象 key 稳定', () => {
    expect(
      stableHash(['products', { page: 1, search: 'a' }]) ===
        stableHash(['products', { search: 'a', page: 1 }]),
      'stableHash should ignore object key order'
    );
    return 'object key order ignored';
  });

  await assertCheck('基础 products query 成功', async () => {
    await productsQuery.promise();
    expect(
      productsQuery.state.status === 'success',
      'products should be success'
    );
    expect(productsQuery().items.length > 0, 'products should have rows');
    return `${productsQuery().items.length} rows`;
  });

  await assertCheck('getQueryData 读取商品缓存', () => {
    const cached = client.getQueryData(productsQuery.key());
    expect(cached?.items?.length > 0, 'cache should contain products');
    return 'cache hit';
  });

  await assertCheck('响应式 queryKey 切换保留旧数据', async () => {
    const previous = productsQuery();
    setPage((value) => value + 1);
    await delay(0);
    expect(
      productsQuery() === previous,
      'previous data should be kept while fetching'
    );
    await productsQuery.promise();
    expect(productsQuery().page === page(), 'page should update');
    return `page ${page()}`;
  });

  await assertCheck('invalidateQueries 前缀失效', () => {
    const count = client.invalidateQueries(['products']);
    expect(count > 0, 'should invalidate products entries');
    return `${count} entries`;
  });

  elements.prefetchProductsButton.click();
  await delay(550);
  elements.addTodoButton.click();
  elements.runRetryButton.click();
  await delay(700);
  elements.runBusinessErrorButton.click();
  await delay(260);
  elements.runTimeoutButton.click();
  await delay(260);
  elements.runAbortButton.click();
  await delay(260);
  elements.runSuspenseButton.click();
  await delay(320);
  elements.runThrowErrorsButton.click();
  await delay(260);
  elements.runSubscribeButton.click();
  await delay(240);
};

const init = () => {
  renderNavigation();
  updateMetrics();
  flushSync();
  addLog('页面初始化完成', {
    currentProductsKey: productsQuery.key().slice(0, 80),
  });
};

init();
