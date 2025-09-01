import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';

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

  const toggleDirectory = (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  const handleFileClick = (file: FileItem) => {
    if (file.isDirectory) {
      toggleDirectory(file.path);
    } else {
      setSelectedFile(file.filePath);
      onFileSelect?.(file.filePath);
    }
  };

  const handleWebsiteConfigClick = () => {
    setSelectedFile(null);
    onWebsiteConfigSelect?.();
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

  const renderFileTree = (items: FileItem[], depth = 0) => {
    return items.map((item) => {
      const isExpanded = expandedDirs.has(item.path);
      const hasChildren = item.isDirectory && item.children.length > 0;
      const isSelected = state.selectedFile === item.filePath;

      return (
        <div key={item.path} style={{ marginLeft: depth * 16 }}>
          <div
            className={`file-item ${isSelected ? 'selected' : ''}`}
            onClick={() => handleFileClick(item)}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 8px',
              cursor: 'pointer',
              borderRadius: '4px',
              backgroundColor: isSelected ? 'var(--button-hover)' : 'transparent',
              fontSize: '13px',
            }}
          >
            {hasChildren && <span style={{ marginRight: '4px', fontSize: '10px' }}>{isExpanded ? '▼' : '▶'}</span>}
            {!hasChildren && <span style={{ width: '14px' }} />}
            <span style={{ marginRight: '6px' }}>{getFileIcon(item.name, item.isDirectory)}</span>
            <span>{item.name}</span>
          </div>
          {hasChildren && isExpanded && <div>{renderFileTree(item.children, depth + 1)}</div>}
        </div>
      );
    });
  };

  useEffect(() => {
    loadFiles();
  }, [state.websiteName]);

  if (loading) {
    return (
      <div className="file-explorer" style={{ padding: '16px' }}>
        <h3>File Explorer</h3>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Loading files...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="file-explorer" style={{ padding: '16px' }}>
        <h3>File Explorer</h3>
        <div style={{ color: 'var(--error-color)', fontSize: '12px' }}>Error: {error}</div>
        <button
          onClick={loadFiles}
          style={{
            marginTop: '8px',
            padding: '4px 8px',
            fontSize: '11px',
            background: 'var(--button-bg)',
            border: '1px solid var(--border-primary)',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="file-explorer" style={{ padding: '16px' }}>
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
      <div
        className="virtual-website-entry"
        onClick={handleWebsiteConfigClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: 500,
          marginBottom: '16px',
          fontSize: '13px',
        }}
      >
        <span style={{ fontSize: '16px' }}>🌐</span>
        <span>{state.websiteName}</span>
      </div>

      {/* File tree */}
      <div className="file-tree">
        {files.length > 0 ? (
          renderFileTree(files)
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontStyle: 'italic' }}>No files found</div>
        )}
      </div>
    </div>
  );
};
