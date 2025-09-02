import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { FluentTreeView, FluentTreeItem, FluentButton, FluentCard } from '../fluent';

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  path: string;
  filePath: string;
  isDirectory: boolean;
  url?: string;
  children: FileItem[];
}

interface FileExplorerProps {
  onFileSelect?: (filePath: string) => void;
  onWebsiteConfigSelect?: () => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, onWebsiteConfigSelect }) => {
  const { state, setSelectedFile } = useAppContext();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const loadFiles = async () => {
    if (!state.websiteName) return;

    try {
      setLoading(true);
      setError(null);

      // Use Electron IPC to get website files
      const websiteFiles = (await window.electronAPI?.invoke('get-website-files', state.websiteName)) as
        | any[]
        | undefined;

      if (websiteFiles && Array.isArray(websiteFiles) && websiteFiles.length > 0) {
        const fileTree = await buildFileTree(websiteFiles);
        setFiles(fileTree);
      } else {
        setFiles([]);
      }
    } catch (err) {
      console.error('Error loading files:', err);
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const buildFileTree = async (rawFiles: any[]): Promise<FileItem[]> => {
    const tree: FileItem[] = [];
    const websitePath = `/path/to/${state.websiteName}`; // This would come from context in real implementation

    // Filter out files/folders that start with . or _
    const filteredFiles = rawFiles.filter((file) => {
      const fileName = file.name || file.filePath.split('/').pop() || '';
      return !fileName.startsWith('.') && !fileName.startsWith('_');
    });

    filteredFiles.forEach((file) => {
      const relativePath = file.filePath.replace(websitePath + '/src/', '');
      const pathParts = relativePath.split('/');

      // Skip if any part of the path starts with . or _
      const hasHiddenPath = pathParts.some((part: string) => part.startsWith('.') || part.startsWith('_'));
      if (hasHiddenPath) {
        return;
      }

      if (pathParts.length === 1) {
        // Root level file or directory
        tree.push({
          name: pathParts[0],
          type: file.isDirectory ? 'directory' : 'file',
          path: file.filePath,
          filePath: file.filePath,
          isDirectory: file.isDirectory,
          url: file.url,
          children: [],
        });
      }
    });

    // Add children to directories
    filteredFiles.forEach((file) => {
      const relativePath = file.filePath.replace(websitePath + '/src/', '');
      const pathParts = relativePath.split('/');

      // Skip if any part of the path starts with . or _
      const hasHiddenPath = pathParts.some((part: string) => part.startsWith('.') || part.startsWith('_'));
      if (hasHiddenPath) {
        return;
      }

      if (pathParts.length > 1) {
        const parentDirName = pathParts[0];
        const parentDir = tree.find((item) => item.name === parentDirName && item.isDirectory);

        if (parentDir) {
          parentDir.children.push({
            name: pathParts[pathParts.length - 1],
            type: file.isDirectory ? 'directory' : 'file',
            path: file.filePath,
            filePath: file.filePath,
            isDirectory: file.isDirectory,
            url: file.url,
            children: [],
          });
        }
      }
    });

    // Sort tree: directories first, then alphabetically
    const sortItems = (items: FileItem[]) => {
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      items.forEach((item) => {
        if (item.children.length > 0) {
          sortItems(item.children);
        }
      });
    };

    sortItems(tree);
    return tree;
  };

  const getFileIcon = (fileName: string, isDirectory: boolean) => {
    if (isDirectory) {
      return '📁';
    }

    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'md':
      case 'markdown':
        return '📄';
      case 'html':
      case 'htm':
        return '🌐';
      case 'css':
        return '🎨';
      case 'js':
      case 'ts':
        return '⚡';
      case 'json':
      case 'yml':
      case 'yaml':
        return '⚙️';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return '🖼️';
      default:
        return '📄';
    }
  };

  // Convert FileItem to FluentTreeItem format
  const convertToTreeItems = (items: FileItem[]): FluentTreeItem[] => {
    return items.map((item) => ({
      id: item.path,
      label: item.name,
      icon: getFileIcon(item.name, item.isDirectory),
      expanded: expandedDirs.has(item.path),
      selected: state.selectedFile === item.filePath,
      children: item.children.length > 0 ? convertToTreeItems(item.children) : undefined,
    }));
  };

  const handleTreeItemClick = (treeItem: FluentTreeItem) => {
    // Find the original file item
    const findFileItem = (items: FileItem[], id: string): FileItem | undefined => {
      for (const item of items) {
        if (item.path === id) return item;
        if (item.children) {
          const found = findFileItem(item.children, id);
          if (found) return found;
        }
      }
    };

    const fileItem = findFileItem(files, treeItem.id);
    if (fileItem) {
      if (fileItem.isDirectory) {
        const newExpanded = new Set(expandedDirs);
        if (newExpanded.has(fileItem.path)) {
          newExpanded.delete(fileItem.path);
        } else {
          newExpanded.add(fileItem.path);
        }
        setExpandedDirs(newExpanded);
      } else {
        setSelectedFile(fileItem.filePath);
        onFileSelect?.(fileItem.filePath);
      }
    }
  };

  const handleWebsiteConfigClick = () => {
    setSelectedFile(null);
    onWebsiteConfigSelect?.();
  };

  useEffect(() => {
    loadFiles();
  }, [state.websiteName]);

  if (loading) {
    return (
      <div style={{ padding: '16px' }}>
        <h3
          style={{
            margin: '0 0 12px 0',
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          File Explorer
        </h3>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Loading files...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '16px' }}>
        <h3
          style={{
            margin: '0 0 12px 0',
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          File Explorer
        </h3>
        <div style={{ color: 'var(--error-color)', fontSize: '12px', marginBottom: '8px' }}>Error: {error}</div>
        <FluentButton onClick={loadFiles} appearance="outline" size="small">
          Retry
        </FluentButton>
      </div>
    );
  }

  const treeItems = convertToTreeItems(files);

  return (
    <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3
        style={{
          margin: '0 0 12px 0',
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        File Explorer
      </h3>

      {/* Virtual website configuration entry */}
      <FluentCard
        appearance="filled"
        size="small"
        selectable
        onClick={handleWebsiteConfigClick}
        style={{
          marginBottom: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '16px' }}>🌐</span>
        <span style={{ fontWeight: 500, fontSize: '13px' }}>{state.websiteName}</span>
      </FluentCard>

      {/* File tree */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {treeItems.length > 0 ? (
          <FluentTreeView
            items={treeItems}
            selectionMode="single"
            onItemClick={handleTreeItemClick}
            style={{ border: 'none' }}
          />
        ) : (
          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: '12px',
              fontStyle: 'italic',
              textAlign: 'center',
              marginTop: '20px',
            }}
          >
            No files found
          </div>
        )}
      </div>
    </div>
  );
};
