import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Alert, Breadcrumb, Button, Dropdown, Empty, Menu, Select, Space, Spin, Tree } from 'antd';
import {
  BookOutlined,
  ClockCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  DatabaseOutlined,
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
import { pageTitles, statusOf, type TreeNode } from './model';
import { Status } from './components/shared';
import { ConnectionsPage, ImportPage, TemplatesPage, WorkspacesPage } from './pages/Management';
import { DiffPage, RollbackPage, ScopePage } from './pages/Sync';
import { HistoryPage, RecordDrawers, RecordPage, TablePage } from './pages/Records';
import { ExportPage, SettingsPage } from './pages/SettingsExport';
import appLogo from '../build/icon.png';
import { CompareConfirmation } from './components/CompareConfirmation';
import { CompareProgressPanel } from './components/CompareProgress';

function Shell() {
  const [sidebarWidth, setSidebarWidth] = useState(() => (window.innerWidth <= 1300 ? 256 : 280));
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  const resizeSidebar = (width: number) =>
    setSidebarWidth(Math.max(240, Math.min(640, window.innerWidth * 0.45, width)));
  const c = useController();
  const { m } = c;
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
    return [...new Set(connections.map((conn) => conn.group || '数据库连接'))].map((group) =>
      withChildren({
        key: `group:${encodeURIComponent(group)}`,
        title: group,
        type: 'group',
        children: connections
          .filter((conn) => (conn.group || '数据库连接') === group)
          .map((conn) => ({
            key: conn.id,
            title: conn.name,
            type: 'connection',
            connectionId: conn.id,
            isLeaf: false,
          })),
      }),
    );
  }, [m.state.connections, m.workspaceId, m.treeChildren]);
  function nodeMenu(node: TreeNode) {
    if (node.type === 'group')
      return {
        items: [
          { key: 'new', label: '新建连接', icon: <PlusOutlined /> },
          { key: 'import', label: '导入连接', icon: <FileOutlined /> },
        ],
        onClick: ({ key }: { key: string }) => {
          if (key === 'new') c.editConnection();
          else c.navigate('import');
        },
      };
    if (node.type === 'connection') {
      const test = m.connectionTests[node.connectionId || ''];
      return {
        items: [
          { key: 'edit', label: '编辑连接' },
          {
            key: 'test',
            disabled: test?.status === 'testing',
            label: (
              <Space>
                测试连接
                {test?.status === 'success' ? (
                  <CheckOutlined style={{ color: 'var(--success-text)' }} />
                ) : test?.status === 'error' ? (
                  <CloseOutlined style={{ color: 'var(--danger-text)' }} />
                ) : test?.status === 'testing' ? (
                  <LoadingOutlined />
                ) : null}
              </Space>
            ),
          },
          { key: 'refresh', label: '刷新数据库', icon: <ReloadOutlined /> },
          { key: 'delete', label: '删除连接', danger: true },
        ],
        onClick: ({ key }: { key: string }) => {
          const connection = connections.find((item) => item.id === node.connectionId);
          if (!connection) return;
          if (key === 'edit') c.editConnection(connection);
          if (key === 'test') void c.testConnection(connection);
          if (key === 'refresh') void c.refreshConnection(connection.id);
          if (key === 'delete') void c.removeConnections([connection.id]);
        },
      };
    }
    const items = [
      ...(node.type === 'table'
        ? [
            { key: 'view', label: '查看表结构', icon: <TableOutlined /> },
            { type: 'divider' as const },
          ]
        : []),
      { key: 'structure', label: '同步表结构…', icon: <DatabaseOutlined /> },
      { key: 'data', label: '同步表数据…', icon: <TableOutlined /> },
      { type: 'divider' as const },
      { key: 'export', label: '导出表结构…', icon: <FileOutlined /> },
    ];
    return {
      items,
      onClick: ({ key }: { key: string }) => {
        if (key === 'view') void c.openTable(node);
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
            { key: 'scope', icon: <PlusOutlined />, label: '新建同步' },
            { key: 'templates', icon: <BookOutlined />, label: '同步模板' },
            { key: 'history', icon: <ClockCircleOutlined />, label: '同步历史' },
          ]}
          onClick={({ key }) => {
            if (key === 'templates')
              c.editTemplate(m.state.templates.find((t) => t.workspaceId === m.workspaceId));
            else if (key === 'scope') void c.beginSync();
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
              onClick={() => c.editWorkspace(workspace)}
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
          <div className="tree-scroll">
            {connections.length ? (
              <Tree<TreeNode>
                style={{ background: 'transparent' }}
                key={
                  m.workspaceId +
                  connections.map((conn) => `${conn.id}:${conn.name}:${conn.group}`).join(',')
                }
                treeData={tree}
                blockNode
                expandAction="doubleClick"
                onDoubleClick={(_, node) => {
                  if (node.type === 'table') void c.openTable(node);
                }}
                showIcon
                loadedKeys={Object.keys(m.treeChildren)}
                loadData={c.loadTree}
                icon={(props) => {
                  const node = props as unknown as TreeNode;
                  return node.type === 'group' ? (
                    <FolderOutlined />
                  ) : node.type === 'table' ? (
                    <TableOutlined />
                  ) : (
                    <DatabaseOutlined />
                  );
                }}
                titleRender={(node) => {
                  const label = (
                    <span className="tree-label" title={node.title}>
                      {node.title}
                    </span>
                  );
                  return (
                    <Dropdown trigger={['contextMenu']} menu={nodeMenu(node)}>
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
              <Button size="small" onClick={() => void c.loadState()}>
                重试连接引擎
              </Button>
            }
          />
        )}
        <div className={`page-scroll${m.page === 'export' ? ' export-page-scroll' : ''}`}>
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
                  <Button icon={<ReloadOutlined />} onClick={() => void c.refreshTable()}>
                    刷新
                  </Button>
                  <Button
                    onClick={() =>
                      void c.beginExport({
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
                    loading={!!m.busy}
                    onClick={() => void c.auditRecord()}
                  >
                    核验当前状态
                  </Button>
                  <Button
                    type="primary"
                    onClick={() => void c.exportRecords([m.detail!.record.id])}
                  >
                    导出完整脚本包
                  </Button>
                </>
              )}
              {m.page === 'rollback' && m.rollback && (
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => void c.beginRollback(m.rollback!.recordId)}
                >
                  重新校验
                </Button>
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
      <RecordDrawers />
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
