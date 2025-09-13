import React, { useState, useEffect } from 'react';
import { Tree, NodeApi } from 'react-arborist';
import { useAppContext } from '../context/AppContext';
import { FluentButton, FluentCard } from '../fluent';

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'directory';
  path: string;
  filePath: string;
  isDirectory: boolean;
  url?: string;
  children?: FileItem[] | null;
}

interface RawFileData {
  name: string;
  filePath: string;
  isDirectory: boolean;
  relativePath: string;
  url?: string;
}

interface FileExplorerProps {
  onFileSelect?: (filePath: string) => void;
  onWebsiteConfigSelect?: () => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, onWebsiteConfigSelect }) => {
  console.log('🌐 FileExplorer: Component initialized with onWebsiteConfigSelect:', !!onWebsiteConfigSelect);
  const { state, setSelectedFile } = useAppContext();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = async () => {
    if (!state.websiteName) return;

    try {
      setLoading(true);
      setError(null);

      // Use Electron IPC to get website files
      const websiteFiles = (await window.electronAPI?.invoke('get-website-files', state.websiteName)) as
        | RawFileData[]
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

  const buildFileTree = async (rawFiles: RawFileData[]): Promise<FileItem[]> => {
    const tree: FileItem[] = [];
    const nodeMap = new Map<string, FileItem>();

    // Create nodes for all files and directories
    rawFiles.forEach((file) => {
      // Skip files with invalid relativePath
      if (!file.relativePath || typeof file.relativePath !== 'string') {
        console.warn('Skipping file with invalid relativePath:', file);
        return;
      }

      const node: FileItem = {
        id: file.filePath,
        name: file.name,
        type: file.isDirectory ? 'directory' : 'file',
        path: file.relativePath,
        filePath: file.filePath,
        isDirectory: file.isDirectory,
        url: file.url,
        children: file.isDirectory ? [] : null,
      };
      nodeMap.set(file.relativePath, node);
    });

    // Build the tree structure
    rawFiles.forEach((file) => {
      // Ensure relativePath exists and is a string
      if (!file.relativePath || typeof file.relativePath !== 'string') {
        console.warn('Invalid relativePath for file:', file);
        return;
      }

      const pathParts = file.relativePath.split('/');

      if (pathParts.length === 1) {
        // Root level item
        const node = nodeMap.get(file.relativePath);
        if (node) {
          tree.push(node);
        }
      } else {
        // Find the parent directory
        const parentPath = pathParts.slice(0, -1).join('/');
        const parentNode = nodeMap.get(parentPath);
        const currentNode = nodeMap.get(file.relativePath);

        if (parentNode && currentNode && parentNode.children) {
          parentNode.children.push(currentNode);
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
        if (item.children && item.children.length > 0) {
          sortItems(item.children);
        }
        // Clean up empty children arrays for files
        if (!item.isDirectory && item.children && item.children.length === 0) {
          item.children = null;
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

  const Node: React.FC<{ node: NodeApi<FileItem> }> = React.memo(({ node }) => {
    const fileItem = node.data;
    const icon = getFileIcon(fileItem.name, fileItem.isDirectory);

    const handleClick = React.useCallback(
      async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (fileItem.isDirectory) {
          node.toggle();
        } else {
          node.select();
          // Trigger file selection callback
          if (onFileSelect) {
            console.log('Selected file path:', fileItem.path);
            console.log('Selected file filePath:', fileItem.filePath);
            onFileSelect(fileItem.path);
          }
          // Update app context with selected file (use relative path for display)
          console.log('Updating selectedFile in context to:', fileItem.path);
          setSelectedFile(fileItem.path);

          // Load file preview in WebContentsView if file has a URL
          if (fileItem.url && state.websiteName) {
            // Get the website server URL and construct full URL
            try {
              const baseUrl = await window.electronAPI?.invoke('get-website-server-url', state.websiteName);
              if (baseUrl && window.electronAPI?.send) {
                const fullUrl = (baseUrl as string).replace(/\/$/, '') + fileItem.url; // Remove trailing slash and add file URL
                window.electronAPI.send('load-file-preview', state.websiteName, fullUrl);
              } else {
              }
            } catch (error) {
              console.error('Error getting website server URL:', error);
            }
          } else {
          }
        }
      },
      [fileItem.isDirectory, fileItem.path, node]
    );

    // Use Fluent UI accent color for selection (matches system accent on macOS)
    const selectedStyle = node.isSelected
      ? {
          backgroundColor: 'var(--accent-fill-rest)',
          color: 'var(--accent-foreground-rest, white)',
        }
      : {};

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: '13px',
          borderRadius: '4px',
          minHeight: '28px',
          userSelect: 'none',
          ...selectedStyle,
        }}
        onClick={handleClick}
      >
        {fileItem.isDirectory && (
          <span
            style={{
              fontSize: '12px',
              transition: 'transform 0.15s',
              transform: node.isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              width: '12px',
              textAlign: 'center',
            }}
          >
            ▶
          </span>
        )}
        <span style={{ fontSize: '16px' }}>{icon}</span>
        <span>{fileItem.name}</span>
      </div>
    );
  });

  Node.displayName = 'FileExplorerNode';

  const handleWebsiteConfigClick = async () => {
    console.log('🌐 FileExplorer: handleWebsiteConfigClick called');
    console.log('🌐 FileExplorer: onWebsiteConfigSelect callback exists:', !!onWebsiteConfigSelect);

    // Hide the preview WebContentsView to show the React editor
    if (state.websiteName && window.electronAPI?.invoke) {
      try {
        const success = await window.electronAPI.invoke('set-edit-mode', state.websiteName);
        console.log('🌐 FileExplorer: Set edit mode result:', success);
      } catch (error) {
        console.error('🌐 FileExplorer: Failed to set edit mode:', error);
      }
    }

    setSelectedFile(null);
    if (onWebsiteConfigSelect) {
      console.log('🌐 FileExplorer: Calling onWebsiteConfigSelect callback');
      onWebsiteConfigSelect();
      console.log('🌐 FileExplorer: onWebsiteConfigSelect callback completed');
    } else {
      console.warn('🌐 FileExplorer: onWebsiteConfigSelect callback is not provided!');
    }
  };

  useEffect(() => {
    loadFiles();
  }, [state.websiteName]);

  // Debug logging for website config card rendering
  useEffect(() => {
    console.log('🌐 FileExplorer: Rendering website config card with onClick handler:', !!handleWebsiteConfigClick);
  }, [handleWebsiteConfigClick]);

  // Listen for refresh events from the main process
  useEffect(() => {
    const handleRefresh = () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('File explorer refresh requested');
      }
      loadFiles();
    };

    if (window.electronAPI) {
      window.electronAPI.on('refresh-file-explorer', handleRefresh);

      // Cleanup
      return () => {
        if (window.electronAPI?.off) {
          window.electronAPI.off('refresh-file-explorer', handleRefresh);
        }
      };
    }
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

      {/* Virtual website configuration entry - DEBUGGING VERSION */}
      <div
        style={{
          marginBottom: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minHeight: '32px',
          maxHeight: '40px',
          flex: '0 0 auto',
          padding: '8px 12px',
          backgroundColor: 'var(--fill-color)',
          borderRadius: '4px',
          border: '1px solid var(--stroke-color)',
        }}
        onClick={() => {
          console.log('🔧 DIRECT DIV CLICK: Globe clicked at', new Date().toISOString());
          console.log('🔧 DIRECT DIV CLICK: About to call handleWebsiteConfigClick');
          handleWebsiteConfigClick();
        }}
        onMouseDown={() => console.log('🔧 DIRECT DIV: Mouse down')}
        onMouseUp={() => console.log('🔧 DIRECT DIV: Mouse up')}
        onPointerDown={() => console.log('🔧 DIRECT DIV: Pointer down')}
        onPointerUp={() => console.log('🔧 DIRECT DIV: Pointer up')}
      >
        <span style={{ fontSize: '16px' }}>🌐</span>
        <span style={{ fontWeight: 500, fontSize: '13px' }}>{state.websiteName}</span>
      </div>

      {/* BACKUP: FluentCard version commented out for debugging
      <FluentCard
        appearance="filled"
        size="small"
        selectable
        onClick={handleWebsiteConfigClick}
        onMouseDown={() => console.log('🌐 FileExplorer: Mouse down on website card')}
        onMouseUp={() => console.log('🌐 FileExplorer: Mouse up on website card')}
        style={{
          marginBottom: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minHeight: '32px',
          maxHeight: '40px',
          flex: '0 0 auto',
          padding: '8px 12px',
        }}
      >
        <span style={{ fontSize: '16px' }}>🌐</span>
        <span style={{ fontWeight: 500, fontSize: '13px' }}>{state.websiteName}</span>
      </FluentCard>
      */}

      {/* File tree */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: '200px' }}>
        {files.length > 0 ? (
          <Tree
            data={files}
            openByDefault={false}
            width="100%"
            height={300}
            indent={16}
            rowHeight={28}
            disableDrop
            disableDrag
            selection={state.selectedFile}
            onSelect={(nodes) => {
              if (nodes.length > 0) {
                const selectedNode = nodes[0];
                if (!selectedNode.data.isDirectory) {
                  setSelectedFile(selectedNode.data.filePath);
                  onFileSelect?.(selectedNode.data.filePath);
                }
              }
            }}
          >
            {Node}
          </Tree>
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
