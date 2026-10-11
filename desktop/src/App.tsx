import { AsyncButton as Button, RefreshButton } from './components/AsyncButton';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type Key } from 'react';
import { Alert, Breadcrumb, Dropdown, Empty, Menu, Select, Space, Spin, Tree } from 'antd';
import {
  BookOutlined,
  ApiOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileOutlined,
  FolderOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { BusinessProvider, useController } from './controller';
import { preview } from './api';
import {
  pageTitles,
  statusOf,
  tableRefreshKey,
  rollbackRefreshKey,
  type ConnectionTestResult,
  type TreeNode,
} from './model';
import { Status } from './components/shared';
import {
  ConnectionEditor,
  ConnectionsPage,
  ImportPage,
  TemplatesPage,
  WorkspacesPage,
} from './pages/Management';
import { DiffPage, RollbackPage, ScopePage } from './pages/Sync';
import { HistoryPage, RecordDrawers, RecordPage, TablePage } from './pages/Records';
import { ExportPage, SettingsPage } from './pages/SettingsExport';
import appLogo from '../build/icon.png';
import { CompareConfirmation } from './components/CompareConfirmation';
import { CompareProgressPanel } from './components/CompareProgress';
import { ConnectionOrganizationDialogs } from './components/ConnectionOrganization';
import { useTreeDragGesture } from './components/useTreeDragGesture';
import { useTreeViewport } from './components/useTreeViewport';
import { MenuOperationFeedback } from './components/MenuOperationFeedback';
import { collapseTreeBranch } from './connection-tree';
import {
  connectionGroupName,
  dropPlacement,
  groupDropPlacement,
  orderedConnections,
} from './connection-organization';

function Shell() {
  const [sidebarWidth, setSidebarWidth] = useState(() => (window.innerWidth <= 1300 ? 256 : 280));
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<Key[]>([]);
  const [expandedTreeKeys, setExpandedTreeKeys] = useState<Key[]>([]);
  const [loadingTreeKeys, setLoadingTreeKeys] = useState<Key[]>([]);
  const treeLoads = useRef(new Map<Key, object>());
  const menuSerial = useRef(0);
  const activeMenu = useRef<{ key: string; serial: number } | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{
    key: string;
    serial: number;
    results: Record<string, ConnectionTestResult>;
  }>();
  function closeMenu() {
    activeMenu.current = undefined;
    setContextMenu(undefined);
  }
  function openMenu(key: string) {
    const session = { key, serial: ++menuSerial.current };
    activeMenu.current = session;
    setContextMenu({ ...session, results: {} });
  }
  async function menuOperation(key: string, work: () => Promise<ConnectionTestResult | undefined>) {
    const session = activeMenu.current;
    if (!session) return;
    setContextMenu(
      (menu) =>
        menu && {
          ...menu,
          results: Object.fromEntries(Object.entries(menu.results).filter(([id]) => id !== key)),
        },
    );
    const result = await work();
    if (result && activeMenu.current === session)
      setContextMenu((menu) => menu && { ...menu, results: { ...menu.results, [key]: result } });
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', escape, true);
    return () => {
      activeMenu.current = undefined;
      window.removeEventListener('keydown', escape, true);
    };
  }, []);

  const resizeSidebar = (width: number) =>
    setSidebarWidth(Math.max(240, Math.min(640, window.innerWidth * 0.45, width)));
  const c = useController();
  const { m } = c;
  const treeGesture = useTreeDragGesture(m.organizationSaving, m.workspaceId);
  const treeViewport = useTreeViewport();
  // 拖拽状态完全由 antd/rc-tree 内部管理：不在 capture 层拦截或 preventDefault，
  // 否则 dragend 永远不会触发，rc-tree 的拖拽高亮会永久残留（看起来像无法取消的选中）。
  useEffect(() => {
    closeMenu();
    setSelectedTreeKeys([]);
    setExpandedTreeKeys([]);
    setLoadingTreeKeys([]);
    treeLoads.current.clear();
    return () => treeLoads.current.clear();
  }, [m.workspaceId]);
  function reloadExpandedNode(node: TreeNode) {
    if (!['connection', 'database'].includes(node.type)) return;
    const token = {};
    const startedAt = Date.now();
    treeLoads.current.set(node.key, token);
    setLoadingTreeKeys((keys) => [...keys.filter((key) => key !== node.key), node.key]);
    void c.loadTree(node, true).finally(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 300 - (Date.now() - startedAt))),
      );
      if (treeLoads.current.get(node.key) !== token) return;
      treeLoads.current.delete(node.key);
      setLoadingTreeKeys((keys) => keys.filter((key) => key !== node.key));
    });
  }
  const comparing = !!m.compareTask && ['RUNNING', 'CANCELLING'].includes(m.compareTask.status);
  const workspace = m.state.workspaces.find((w) => w.id === m.workspaceId);
  const connections = m.state.connections.filter((conn) =>
    conn.workspaceIds.includes(m.workspaceId),
  );
  const tab = m.currentTable;
  const title =
    m.page === 'table'
      ? tab?.table || pageTitles.table
      : m.page === 'diff' && m.diffTab === 'data'
        ? '基础数据差异'
        : pageTitles[m.page];
  const tree = useMemo(() => {
    function withChildren(node: TreeNode): TreeNode {
      const children = m.treeChildren[node.key] || node.children;
      return { ...node, ...(children ? { children: children.map(withChildren) } : {}) };
    }
    return m.state.connectionGroups.map((group) =>
      withChildren({
        key: `group:${group.id}`,
        title: group.name,
        groupId: group.id,
        type: 'group',
        children: orderedConnections(connections)
          .filter((conn) => connectionGroupName(conn) === group.name)
          .map((conn) => ({
            key: conn.id,
            title: conn.name,
            type: 'connection',
            connectionId: conn.id,
            groupId: group.id,
            isLeaf: false,
          })),
      }),
    );
  }, [m.state.connections, m.state.connectionGroups, m.workspaceId, m.treeChildren]);
  function nodeMenu(node: TreeNode) {
    if (node.type === 'group')
      return {
        items: [
          { key: 'new', label: '新建连接', icon: <PlusOutlined aria-hidden /> },
          { key: 'import', label: '导入连接', icon: <FileOutlined aria-hidden /> },
          { key: 'group-edit', label: '编辑分组', icon: <EditOutlined aria-hidden /> },
          { key: 'group-new', label: '新增分组', icon: <PlusOutlined aria-hidden /> },
        ],
        onClick: ({ key }: { key: string }) => {
          closeMenu();
          if (key === 'group-edit')
            c.editGroup(m.state.connectionGroups.find((group) => group.id === node.groupId));
          else if (key === 'group-new') c.editGroup();
          else if (key === 'new') c.editConnection(undefined, node.title);
          else {
            c.set('importGroup', node.title);
            c.navigate('import');
          }
        },
      };
    if (node.type === 'connection') {
      const testPending = m.connectionTests['tree:' + node.connectionId]?.status === 'testing';
      const refreshPending = !!m.refreshing['connection:' + node.connectionId];
      const result = (key: string, pending: boolean, message: string) =>
        pending
          ? { status: 'testing' as const, message }
          : contextMenu?.key === node.key
            ? contextMenu.results[key]
            : undefined;
      return {
        items: [
          { key: 'edit', label: '编辑连接', icon: <EditOutlined aria-hidden /> },
          { key: 'group', label: '更换分组', icon: <FolderOutlined aria-hidden /> },
          {
            key: 'test',
            icon: testPending ? <LoadingOutlined aria-hidden /> : <ApiOutlined aria-hidden />,
            disabled: testPending,
            label: (
              <MenuOperationFeedback
                label="测试连接"
                retry="点击再次测试"
                result={result('test', testPending, '正在测试连接')}
              />
            ),
          },
          {
            key: 'refresh',
            icon: refreshPending ? <LoadingOutlined aria-hidden /> : <ReloadOutlined aria-hidden />,
            disabled: refreshPending,
            label: (
              <MenuOperationFeedback
                label="刷新数据库"
                retry="点击再次刷新"
                result={result('refresh', refreshPending, '正在刷新数据库')}
              />
            ),
          },
          { key: 'delete', label: '删除连接', icon: <DeleteOutlined aria-hidden />, danger: true },
        ],
        onClick: ({ key }: { key: string }) => {
          const connection = connections.find((item) => item.id === node.connectionId);
          if (!connection) return;
          if (!['test', 'refresh'].includes(key)) closeMenu();
          if (key === 'edit') c.editConnection(connection, undefined, true);
          if (key === 'group') c.chooseConnectionGroup(connection);
          if (key === 'test')
            void menuOperation('test', () => c.testConnection(connection, 'tree'));
          if (key === 'refresh')
            void menuOperation('refresh', () => c.refreshConnection(connection.id));
          if (key === 'delete') void c.removeConnections([connection.id]);
        },
      };
    }
    const refreshKey = 'database:' + node.key;
    const refresh = m.refreshing[refreshKey]
      ? { status: 'testing' as const, message: '正在刷新数据表' }
      : contextMenu?.key === node.key
        ? contextMenu.results.refresh
        : undefined;
    const items = [
      ...(node.type === 'database'
        ? [
            {
              key: 'refresh',
              icon: m.refreshing[refreshKey] ? (
                <LoadingOutlined aria-hidden />
              ) : (
                <ReloadOutlined aria-hidden />
              ),
              disabled: !!m.refreshing[refreshKey] || loadingTreeKeys.includes(node.key),
              label: (
                <MenuOperationFeedback label="刷新数据表" retry="点击再次刷新" result={refresh} />
              ),
            },
            { type: 'divider' as const },
          ]
        : []),
      ...(node.type === 'table'
        ? [
            { key: 'view', label: '查看表结构', icon: <TableOutlined aria-hidden /> },
            { type: 'divider' as const },
          ]
        : []),
      {
        key: 'structure',
        label: '同步表结构…',
        icon: <DatabaseOutlined aria-hidden />,
        disabled: comparing,
      },
      {
        key: 'data',
        label: '同步表数据…',
        icon: <TableOutlined aria-hidden />,
        disabled: comparing,
      },
      { type: 'divider' as const },
      { key: 'export', label: '导出表结构…', icon: <FileOutlined aria-hidden /> },
    ];
    return {
      items,
      onClick: ({ key }: { key: string }) => {
        if (key !== 'refresh') closeMenu();
        if (key === 'refresh') void menuOperation('refresh', () => c.refreshDatabase(node));
        else if (key === 'view') void c.openTable(node);
        else if (key === 'export') void c.beginExport(node);
        else void c.beginSync(node, key === 'data' ? 'data' : 'structure');
      },
    };
  }
  let content;
  switch (m.page) {
    case 'scope':
      content = <ScopePage />;
      break;
    case 'diff':
      content = <DiffPage />;
      break;
    case 'workspaces':
      content = <WorkspacesPage />;
      break;
    case 'connections':
      content = <ConnectionsPage />;
      break;
    case 'import':
      content = <ImportPage />;
      break;
    case 'table':
      content = <TablePage />;
      break;
    case 'templates':
      content = <TemplatesPage />;
      break;
    case 'history':
      content = <HistoryPage />;
      break;
    case 'record':
      content = <RecordPage />;
      break;
    case 'rollback':
      content = <RollbackPage />;
      break;
    case 'export':
      content = <ExportPage />;
      break;
    case 'settings':
      content = <SettingsPage />;
      break;
  }
  return (
    <div className="app-shell" style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <header className={`titlebar ${preview ? 'preview-titlebar' : ''}`}>
        <div className="titlebar-content">
          <img className="brand-icon" src={appLogo} alt="" />
          <span>Data Sync</span>
          {preview && (
            <span className="preview-label">浏览器设计预览 · 执行操作请使用桌面客户端</span>
          )}
        </div>
      </header>
      <nav className="activity-rail" aria-label="功能导航">
        <Menu
          className="activity-menu"
          selectedKeys={[
            m.page === 'diff'
              ? 'scope'
              : ['record', 'rollback'].includes(m.page)
                ? 'history'
                : m.page,
          ]}
          items={[
            {
              key: 'scope',
              icon: <PlusOutlined />,
              label: '新建同步',
              title: comparing ? '返回当前比较，可查看进度或停止比较' : undefined,
            },
            { key: 'templates', icon: <BookOutlined />, label: '同步模板' },
            { key: 'history', icon: <ClockCircleOutlined />, label: '同步历史' },
          ]}
          onClick={({ key }) => {
            if (key === 'templates') c.navigate('templates');
            else if (key === 'scope') c.navigate('scope');
            else c.navigate('history');
          }}
        />
        <Menu
          className="activity-menu activity-menu-bottom"
          selectedKeys={[m.page]}
          items={[{ key: 'settings', icon: <SettingOutlined />, label: '设置' }]}
          onClick={() => c.navigate('settings')}
        />
      </nav>
      <aside className="sidebar">
        <div className="workspace-picker">
          <div className="sidebar-label">
            <span>工作空间</span>
            <Button
              type="text"
              size="small"
              icon={<SettingOutlined />}
              aria-label="管理工作区"
              onClick={() => c.navigate('workspaces')}
            />
          </div>
          <Select
            aria-label="当前工作区"
            disabled={!!m.compareTask && ['RUNNING', 'CANCELLING'].includes(m.compareTask.status)}
            value={m.workspaceId}
            options={m.state.workspaces.map((w) => ({ value: w.id, label: w.name }))}
            onChange={c.switchWorkspace}
            style={{ width: '100%' }}
          />
        </div>
        <section className="connection-browser" aria-label="数据库连接导航">
          <div className="connection-heading">
            <div className="sidebar-label">
              <span>数据库连接</span>
              <Button
                size="small"
                aria-label="数据库连接"
                onClick={() => c.navigate('connections')}
              >
                管理
              </Button>
            </div>
            <div className="connection-actions">
              <Button onClick={() => c.editConnection()}>新建连接</Button>
              <Button onClick={() => c.navigate('import')}>导入连接</Button>
            </div>
          </div>
          <div
            className="tree-scroll"
            ref={treeViewport.ref}
            onPointerDownCapture={treeGesture.onPointerDown}
            onPointerMoveCapture={treeGesture.onPointerMove}
            onPointerCancel={treeGesture.onPointerCancel}
            onDragStartCapture={treeGesture.onDragStartCapture}
            onClick={(event) => {
              if (!(event.target as Element).closest('.ant-tree-treenode')) setSelectedTreeKeys([]);
            }}
          >
            {tree.length ? (
              <Tree<TreeNode>
                style={{ background: 'transparent' }}
                height={treeViewport.height}
                virtual
                key={m.workspaceId}
                treeData={tree}
                selectedKeys={selectedTreeKeys}
                expandedKeys={expandedTreeKeys}
                autoExpandParent={false}
                onExpand={(keys, { node, expanded }) => {
                  setExpandedTreeKeys(expanded ? keys : collapseTreeBranch(keys, node));
                  if (expanded && !expandedTreeKeys.includes(node.key)) reloadExpandedNode(node);
                }}
                onSelect={(keys) => setSelectedTreeKeys(keys.slice(0, 1))}
                blockNode
                draggable={
                  m.organizationSaving
                    ? false
                    : {
                        icon: false,
                        nodeDraggable: (node) =>
                          ['connection', 'group'].includes((node as unknown as TreeNode).type),
                      }
                }
                onDragStart={({ node }) => {
                  setSelectedTreeKeys([]);
                  setExpandedTreeKeys((keys) => collapseTreeBranch(keys, node));
                }}
                onDragEnd={() => {
                  treeGesture.release();
                  setSelectedTreeKeys([]);
                }}
                allowDrop={({ dragNode, dropNode, dropPosition }) =>
                  !m.organizationSaving &&
                  dragNode.key !== dropNode.key &&
                  (dragNode.type === 'group'
                    ? dropNode.type === 'group' && dropPosition !== 0
                    : dragNode.type === 'connection' &&
                      (dropNode.type === 'group'
                        ? dropPosition === 0
                        : dropNode.type === 'connection' && dropPosition !== 0))
                }
                onDrop={(info) => {
                  treeGesture.release();
                  setSelectedTreeKeys([]);
                  if (info.dragNode.type === 'group') {
                    const move = groupDropPlacement({
                      organizationSaving: m.organizationSaving,
                      dragNode: info.dragNode,
                      dropNode: info.node,
                      dropToGap: info.dropToGap,
                      dropPosition: info.dropPosition,
                    });
                    if (move) void c.moveGroup(move.groupId, move.anchorGroupId, move.placement);
                    return;
                  }
                  // The tree maps the upper half of a group's first child to its parent.
                  // Use the actual hovered row so that this gap inserts before the first connection.
                  const hoveredRow = (info.event.target as Element).closest('.ant-tree-treenode');
                  const hoveredLabel = hoveredRow?.querySelector<HTMLElement>('.tree-label');
                  const bounds = hoveredRow?.getBoundingClientRect();
                  const move = dropPlacement({
                    organizationSaving: m.organizationSaving,
                    dragNode: {
                      type: info.dragNode.type,
                      connectionId: info.dragNode.connectionId,
                    },
                    hovered: {
                      connectionId: hoveredLabel?.dataset.connectionId,
                      groupId: hoveredLabel?.dataset.groupId,
                    },
                    hoveredBeforeMiddle: bounds
                      ? info.event.clientY < bounds.top + bounds.height / 2
                      : true,
                    dropNode: {
                      type: info.node.type,
                      groupId: info.node.groupId,
                      connectionId: info.node.connectionId,
                      pos: info.node.pos,
                    },
                    dropToGap: info.dropToGap,
                    dropPosition: info.dropPosition,
                  });
                  if (move)
                    void c.moveConnection(
                      move.connectionId,
                      move.groupId,
                      move.placement,
                      move.anchorConnectionId,
                      true,
                    );
                }}
                expandAction="doubleClick"
                onDoubleClick={(_, node) => {
                  if (node.type === 'table') void c.openTable(node);
                }}
                showIcon
                icon={(props) => {
                  const node = { ...props, key: props.eventKey } as unknown as TreeNode;
                  return loadingTreeKeys.includes(node.key) ? (
                    <LoadingOutlined aria-label="正在加载最新清单" />
                  ) : node.type === 'group' ? (
                    <FolderOutlined />
                  ) : node.type === 'table' ? (
                    <TableOutlined />
                  ) : node.type === 'connection' ? (
                    m.refreshing['connection:' + node.connectionId] ? (
                      <LoadingOutlined aria-label="正在刷新数据库" />
                    ) : (
                      <ApiOutlined />
                    )
                  ) : m.refreshing['database:' + node.key] ? (
                    <LoadingOutlined aria-label="正在刷新表结构" />
                  ) : (
                    <DatabaseOutlined />
                  );
                }}
                titleRender={(node) => {
                  const label = (
                    <span
                      onContextMenu={() => openMenu(node.key)}
                      className="tree-label"
                      data-node-key={node.key}
                      data-drag-ready={treeGesture.readyKey === node.key ? 'true' : undefined}
                      data-node-type={node.type}
                      aria-busy={loadingTreeKeys.includes(node.key)}
                      title={node.title}
                      data-connection-id={
                        node.type === 'connection' ? node.connectionId : undefined
                      }
                      data-group-id={node.groupId}
                    >
                      {node.title}
                    </span>
                  );
                  return (
                    <Dropdown
                      trigger={['contextMenu']}
                      menu={nodeMenu(node)}
                      open={contextMenu?.key === node.key}
                      onOpenChange={(open, info) => {
                        if (!open && info.source === 'trigger') closeMenu();
                      }}
                    >
                      {label}
                    </Dropdown>
                  );
                }}
              />
            ) : (
              <div className="tree-empty">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未添加数据库连接" />
              </div>
            )}
          </div>
        </section>
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整数据库导航区域宽度"
          aria-valuemin={240}
          aria-valuemax={Math.min(640, window.innerWidth * 0.45)}
          aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            sidebarDrag.current = {
              x: event.clientX,
              width: event.currentTarget.parentElement!.getBoundingClientRect().width,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (sidebarDrag.current)
              resizeSidebar(sidebarDrag.current.width + event.clientX - sidebarDrag.current.x);
          }}
          onPointerUp={(event) => {
            sidebarDrag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            sidebarDrag.current = null;
          }}
          onLostPointerCapture={() => {
            sidebarDrag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              resizeSidebar(sidebarWidth + (event.key === 'ArrowRight' ? 16 : -16));
            }
          }}
        />
      </aside>
      <main className="main-area">
        <CompareProgressPanel />
        <CompareConfirmation />
        {m.engineError && (
          <Alert
            type="error"
            showIcon
            title={m.engineError}
            action={
              <RefreshButton
                size="small"
                loading={!!m.refreshing.engine}
                result={m.refreshResults.engine}
                onClick={() => c.refreshEngine()}
              >
                重试连接引擎
              </RefreshButton>
            }
          />
        )}
        <div
          className={`page-scroll${m.page === 'export' ? ' export-page-scroll' : (m.page === 'diff' && m.plan) || (m.page === 'rollback' && m.rollback) ? ' diff-page-scroll' : ''}`}
        >
          <Breadcrumb
            items={
              m.page === 'scope' || m.page === 'diff'
                ? [
                    { title: workspace?.name || '工作区' },
                    {
                      title: (
                        <span aria-current={m.page === 'scope' ? 'page' : undefined}>新建同步</span>
                      ),
                    },
                    ...(m.page === 'diff'
                      ? [{ title: <span aria-current="page">差异预览</span> }]
                      : []),
                  ]
                : [
                    { title: workspace?.name || '工作区' },
                    {
                      title:
                        m.page === 'table'
                          ? tab?.ref.database
                          : m.page === 'record'
                            ? m.detail?.record.id
                            : m.page === 'rollback'
                              ? m.rollback?.recordId
                              : title,
                    },
                  ]
            }
          />
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              {m.page === 'settings' && <p className="hint">本地保存配置、同步记录与恢复资料。</p>}
              {m.page === 'templates' && <p className="hint">保存常用范围，每次使用时重新比较。</p>}
              {m.page === 'export' && (
                <p className="hint">选择需要导出的表，预览后保存为 SQL 文件。</p>
              )}
              {m.page === 'table' && <p className="hint">{tab?.model.comment}</p>}
            </div>
            <Space wrap>
              {m.page === 'table' && tab && (
                <>
                  <RefreshButton
                    key={tableRefreshKey(m)}
                    icon={<ReloadOutlined />}
                    result={m.refreshResults[tableRefreshKey(m)]}
                    loading={!!m.refreshing[tableRefreshKey(m)]}
                    onClick={() => c.refreshTable()}
                  >
                    刷新
                  </RefreshButton>
                  <Button
                    onClick={() =>
                      c.beginExport({
                        key: tab.id,
                        title: tab.table,
                        type: 'table',
                        table: tab.table,
                        ref: tab.ref,
                      })
                    }
                  >
                    导出表结构
                  </Button>
                </>
              )}
              {m.page === 'record' && m.detail && (
                <>
                  <Status value={statusOf(m, m.detail.record)} />
                  {m.detail.record.mode === 'SAVE_ONLY' && (
                    <Button onClick={c.declareExternal}>登记外部执行</Button>
                  )}
                  <Button
                    disabled={['RUNNING', 'QUEUED'].includes(m.detail.record.status)}
                    onClick={() => c.auditRecord()}
                  >
                    核验当前状态
                  </Button>
                  <Button type="primary" onClick={() => c.exportRecords([m.detail!.record.id])}>
                    导出完整脚本包
                  </Button>
                </>
              )}
              {m.page === 'rollback' && m.rollback && (
                <RefreshButton
                  key={rollbackRefreshKey(m)}
                  icon={<ReloadOutlined />}
                  result={m.refreshResults[rollbackRefreshKey(m)]}
                  loading={!!m.refreshing[rollbackRefreshKey(m)]}
                  onClick={() => c.beginRollback(m.rollback!.recordId, true)}
                >
                  重新校验
                </RefreshButton>
              )}
            </Space>
          </div>
          <Spin spinning={m.loading}>
            <div className="page-body" key={m.page}>
              {content}
            </div>
          </Spin>
        </div>
        <div id="page-footer" />
      </main>
      <ConnectionEditor />
      <RecordDrawers />
      <ConnectionOrganizationDialogs />
    </div>
  );
}
export default function App() {
  return (
    <BusinessProvider>
      <Shell />
    </BusinessProvider>
  );
}
