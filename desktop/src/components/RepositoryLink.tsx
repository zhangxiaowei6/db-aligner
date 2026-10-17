import { GithubOutlined } from '@ant-design/icons';
import { App } from 'antd';
import { api } from '../api';

export const repositoryUrl = 'https://github.com/zhangxiaowei6/db-aligner';

export function RepositoryLink() {
  const { message } = App.useApp();
  return (
    <a
      className="repository-link"
      href={repositoryUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="打开 GitHub 仓库"
      onClick={(event) => {
        if (!('__TAURI_INTERNALS__' in window)) return;
        event.preventDefault();
        void api('app.openRepository').catch(() =>
          message.error('无法打开 GitHub 仓库，请稍后重试'),
        );
      }}
    >
      <GithubOutlined aria-hidden />
      <span>{repositoryUrl}</span>
    </a>
  );
}
