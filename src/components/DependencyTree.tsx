import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DependencyGraphResult, DependencyNode } from './VersionResolver';
import {
  formatVersionLabel,
  summarizeIssues,
  VersionIssue,
  VersionIssueType,
} from '../utils/semverUtils';

import './DependencyTree.css';

export interface DependencyTreeProps {
  data: DependencyGraphResult | null;
  loading?: boolean;
  error?: string | null;
  hasPendingChanges?: boolean;
}

type ViewMode = 'tree' | 'graph';

const ISSUE_TYPES = ['vulnerable', 'conflict', 'outdated', 'duplicate'] as const;

type IssueFilterType = typeof ISSUE_TYPES[number];

type FlattenedNode = { node: DependencyNode; path: string };

interface IssuePanelEntry {
  node: DependencyNode;
  issue: VersionIssue & { type: IssueFilterType };
  nodeKey: string;
  priority: number;
  treePath: string;
}

const ISSUE_LABELS: Record<IssueFilterType, string> = {
  vulnerable: 'Vulnerabilidades',
  conflict: 'Conflictos',
  outdated: 'Desactualizadas',
  duplicate: 'Duplicadas',
};

const ISSUE_PRIORITY: Record<IssueFilterType, number> = {
  vulnerable: 0,
  conflict: 1,
  outdated: 2,
  duplicate: 3,
};

const createNodeKey = (nodeId: string): string => nodeId.replace(/[^a-zA-Z0-9_-]/g, '_');

const isPanelIssueType = (type: VersionIssueType): type is IssueFilterType =>
  ISSUE_TYPES.includes(type as IssueFilterType);

type GraphViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

interface GraphNodePosition {
  id: string;
  label: string;
  level: number;
  index: number;
  x: number;
  y: number;
  issues: VersionIssue[];
  declaredRange: string;
  resolvedVersion: string | null;
  latestVersion: string | null;
  rangeDescription: string;
}

interface GraphLayout {
  nodes: GraphNodePosition[];
  width: number;
  height: number;
}

interface TooltipState {
  node: GraphNodePosition;
  position: {
    x: number;
    y: number;
  };
}

interface GraphTheme {
  nodeFill: string;
  nodeWarningFill: string;
  textPrimary: string;
  textMuted: string;
  edge: string;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const getTooltipIssueClass = (type: VersionIssue['type']): string => {
  if (type === 'outdated') {
    return 'graph-tooltip__issue--warning';
  }
  if (type === 'duplicate') {
    return 'graph-tooltip__issue--success';
  }
  if (type === 'vulnerable' || type === 'conflict' || type === 'error') {
    return 'graph-tooltip__issue--danger';
  }
  return '';
};

const concatenateUint8Arrays = (arrays: Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((total, array) => total + array.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
};

const createPdfFromJpeg = (jpegBytes: Uint8Array, width: number, height: number): Blob => {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let position = 0;

  const pushChunk = (chunk: Uint8Array) => {
    chunks.push(chunk);
    position += chunk.length;
  };

  const pushString = (value: string) => {
    pushChunk(encoder.encode(value));
  };

  const registerObject = (index: number, content: string) => {
    offsets[index] = position;
    pushString(`${index} 0 obj\n${content}\nendobj\n`);
  };

  const registerStreamObject = (index: number, dictionary: string, stream: Uint8Array) => {
    offsets[index] = position;
    pushString(`${index} 0 obj\n${dictionary}\nstream\n`);
    pushChunk(stream);
    pushString('\nendstream\nendobj\n');
  };

  pushString('%PDF-1.4\n');

  const pdfWidth = Math.max(Math.round(width), 1);
  const pdfHeight = Math.max(Math.round(height), 1);

  registerObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  registerObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  registerObject(
    3,
    `<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /MediaBox [0 0 ${pdfWidth} ${pdfHeight}] /Contents 5 0 R >>`,
  );

  registerStreamObject(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${pdfWidth} /Height ${pdfHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`,
    jpegBytes,
  );

  const contentStream = encoder.encode(`q ${pdfWidth} 0 0 ${pdfHeight} 0 0 cm /Im0 Do Q\n`);
  registerStreamObject(5, `<< /Length ${contentStream.length} >>`, contentStream);

  const xrefOffset = position;
  pushString('xref\n');
  pushString('0 6\n');
  pushString('0000000000 65535 f \n');
  for (let index = 1; index <= 5; index += 1) {
    const offset = offsets[index] ?? 0;
    const paddedOffset = offset.toString().padStart(10, '0');
    pushString(`${paddedOffset} 00000 n \n`);
  }
  pushString('trailer\n');
  pushString('<< /Size 6 /Root 1 0 R >>\n');
  pushString('startxref\n');
  pushString(`${xrefOffset}\n`);
  pushString('%%EOF');

  const pdfBytes = concatenateUint8Arrays(chunks);
  return new Blob([pdfBytes], { type: 'application/pdf' });
};

const dataUrlToUint8Array = (dataUrl: string): Uint8Array => {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binaryString = typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
};

export const DependencyTree: React.FC<DependencyTreeProps> = ({
  data,
  loading,
  error,
  hasPendingChanges = false,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [exportingFormat, setExportingFormat] = useState<'png' | 'pdf' | null>(null);
  const [graphTheme, setGraphTheme] = useState<GraphTheme>({
    nodeFill: '#3e6bff',
    nodeWarningFill: '#f97316',
    textPrimary: '#0f172a',
    textMuted: '#475569',
    edge: '#94a3b8',
  });
  const [activeIssueFilters, setActiveIssueFilters] = useState<IssueFilterType[]>([]);
  const [viewBox, setViewBox] = useState<GraphViewBox>({ x: 0, y: 0, width: 960, height: 520 });

  const activeFilterSet = useMemo(() => new Set(activeIssueFilters), [activeIssueFilters]);
  const hasActiveFilters = activeIssueFilters.length > 0;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panStateRef = useRef<{ pointerId: number | null; origin: { x: number; y: number } | null }>({
    pointerId: null,
    origin: null,
  });
  const isPanningRef = useRef(false);

  const composeClassName = (base: string, states: Record<string, boolean> = {}): string => {
    const dynamicClasses = Object.entries(states)
      .filter(([, active]) => Boolean(active))
      .map(([className]) => className);
    return [base, ...dynamicClasses].join(' ');
  };

  const filteredTree = useMemo<DependencyNode[]>(() => {
    if (!data?.tree) {
      return [];
    }
    if (!hasActiveFilters) {
      return data.tree;
    }
    const filterSet = new Set(activeIssueFilters);

    const filterNode = (node: DependencyNode): DependencyNode | null => {
      const filteredChildren = node.children
        .map(filterNode)
        .filter(Boolean) as DependencyNode[];

      const matchesNode = node.issues.some(
        (issue) => isPanelIssueType(issue.type) && filterSet.has(issue.type),
      );

      if (matchesNode || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }

      return null;
    };

    return data.tree.map(filterNode).filter(Boolean) as DependencyNode[];
  }, [activeIssueFilters, data, hasActiveFilters]);

  const hasAnyNodes = Boolean(data?.tree?.length);
  const hasVisibleNodes = filteredTree.length > 0;

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const visit = (nodes: DependencyNode[]) => {
      nodes.forEach((node) => {
        ids.add(node.nodeId);
        if (node.children.length) {
          visit(node.children);
        }
      });
    };
    visit(filteredTree);
    return ids;
  }, [filteredTree]);

  const layout = useMemo<GraphLayout>(() => {
    if (!filteredTree.length) {
      return { nodes: [], width: 960, height: 520 };
    }

    const rawNodes: GraphNodePosition[] = [];
    const levelCounters = new Map<number, number>();

    const visit = (node: DependencyNode, level: number) => {
      const index = levelCounters.get(level) ?? 0;
      levelCounters.set(level, index + 1);

      rawNodes.push({
        id: node.nodeId,
        label: node.name,
        level,
        index,
        x: level,
        y: index,
        issues: node.issues,
        declaredRange: node.declaredRange,
        resolvedVersion: node.resolvedVersion,
        latestVersion: node.latestVersion,
        rangeDescription: node.rangeDescription,
      });

      node.children.forEach((child) => visit(child, level + 1));
    };

    filteredTree.forEach((node) => visit(node, 0));

    if (!rawNodes.length) {
      return { nodes: [], width: 960, height: 520 };
    }

    const columnWidth = 260;
    const rowHeight = 120;

    const positioned = rawNodes.map((node) => ({
      ...node,
      x: node.level * columnWidth,
      y: node.index * rowHeight,
    }));

    const minX = Math.min(...positioned.map((node) => node.x));
    const maxX = Math.max(...positioned.map((node) => node.x));
    const minY = Math.min(...positioned.map((node) => node.y));
    const maxY = Math.max(...positioned.map((node) => node.y));

    const paddingX = 220;
    const paddingY = 160;

    const layoutWidth = maxX - minX;
    const layoutHeight = maxY - minY;

    const baseWidth = layoutWidth + paddingX * 2;
    const baseHeight = layoutHeight + paddingY * 2;

    const width = Math.max(baseWidth, 960);
    const height = Math.max(baseHeight, 520);

    const extraX = (width - baseWidth) / 2;
    const extraY = (height - baseHeight) / 2;

    const normalizedNodes = positioned.map((node) => ({
      ...node,
      x: node.x - minX + paddingX + extraX,
      y: node.y - minY + paddingY + extraY,
    }));

    return {
      nodes: normalizedNodes,
      width,
      height,
    };
  }, [filteredTree]);

  const nodePositionMap = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const edges = useMemo(
    () =>
      (data?.edges ?? []).filter(
        (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
      ),
    [data?.edges, visibleNodeIds],
  );
  const graphReady = layout.nodes.length > 0 && !loading && !error;

  const flattenedNodes = useMemo<Array<FlattenedNode>>(() => {
    if (!data?.tree) {
      return [] as Array<FlattenedNode>;
    }
    const nodes: Array<FlattenedNode> = [];
    const visit = (items: DependencyNode[], parentPath: string) => {
      items.forEach((node, index) => {
        const currentPath = parentPath ? `${parentPath}.${index}` : `${index}`;
        nodes.push({ node, path: currentPath });
        if (node.children.length) {
          visit(node.children, currentPath);
        }
      });
    };
    visit(data.tree, '');
    return nodes;
  }, [data]);

  const issueCounts = useMemo(() => {
    const counts = ISSUE_TYPES.reduce<Record<IssueFilterType, number>>((acc, type) => {
      acc[type] = 0;
      return acc;
    }, {} as Record<IssueFilterType, number>);

    flattenedNodes.forEach(({ node }) => {
      node.issues.forEach((issue) => {
        if (isPanelIssueType(issue.type)) {
          counts[issue.type] += 1;
        }
      });
    });

    return counts;
  }, [flattenedNodes]);

  const issuePanelItems = useMemo(() => {
    const items: IssuePanelEntry[] = [];
    if (!flattenedNodes.length) {
      return items;
    }
    const filterSet = new Set<IssueFilterType>(activeIssueFilters);

    flattenedNodes.forEach(({ node, path }) => {
      node.issues.forEach((issue) => {
        if (!isPanelIssueType(issue.type)) {
          return;
        }
        if (filterSet.size > 0 && !filterSet.has(issue.type)) {
          return;
        }

        items.push({
          node,
          issue: { ...issue, type: issue.type as IssueFilterType },
          nodeKey: createNodeKey(node.nodeId),
          priority: ISSUE_PRIORITY[issue.type],
          treePath: path,
        });
      });
    });

    items.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      if (a.node.name !== b.node.name) {
        return a.node.name.localeCompare(b.node.name);
      }
      return a.issue.message.localeCompare(b.issue.message);
    });

    return items;
  }, [activeIssueFilters, flattenedNodes]);

  const toggleIssueFilter = useCallback((type: IssueFilterType) => {
    setActiveIssueFilters((previous) =>
      previous.includes(type)
        ? previous.filter((item) => item !== type)
        : [...previous, type],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setActiveIssueFilters([]);
  }, []);

  const focusNode = useCallback(
    (targetView: ViewMode, nodeId: string) => {
      if (typeof window === 'undefined') {
        return;
      }
      const nodeKey = createNodeKey(nodeId);
      setViewMode(targetView);

      window.requestAnimationFrame(() => {
        const attemptFocus = (iteration: number) => {
          const selector = `[data-view="${targetView}"][data-node-key="${nodeKey}"]`;
          const element = document.querySelector<HTMLElement | SVGElement>(selector);
          if (element) {
            if (targetView === 'tree' && 'scrollIntoView' in element) {
              (element as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if ('focus' in element && typeof element.focus === 'function') {
              if (element instanceof HTMLElement) {
                element.focus({ preventScroll: targetView === 'tree' });
              } else {
                element.focus();
              }
            }
            if (targetView === 'graph') {
              setTooltip(null);
            }
            return;
          }
          if (iteration < 5) {
            window.setTimeout(() => attemptFocus(iteration + 1), 90);
          }
        };

        attemptFocus(0);
      });
    },
    [setTooltip, setViewMode],
  );

  const handleIssueNavigation = useCallback(
    (targetView: ViewMode, nodeId: string) => () => focusNode(targetView, nodeId),
    [focusNode],
  );

  useEffect(() => {
    if (viewMode !== 'graph') {
      return;
    }
    setViewBox({ x: 0, y: 0, width: layout.width, height: layout.height });
  }, [layout.height, layout.width, viewMode]);

  useEffect(() => {
    setTooltip(null);
  }, [viewMode]);

  useEffect(() => {
    isPanningRef.current = isPanning;
  }, [isPanning]);

  useEffect(() => {
    setTooltip(null);
  }, [layout.nodes]);

  const readThemeTokens = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const styles = getComputedStyle(document.documentElement);
    setGraphTheme({
      nodeFill: styles.getPropertyValue('--color-graph-node').trim() || '#3e6bff',
      nodeWarningFill: styles.getPropertyValue('--color-graph-node-warning').trim() || '#f97316',
      textPrimary: styles.getPropertyValue('--color-text-primary').trim() || '#0f172a',
      textMuted: styles.getPropertyValue('--color-text-muted').trim() || '#475569',
      edge: styles.getPropertyValue('--color-graph-edge').trim() || '#94a3b8',
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    readThemeTokens();

    const handleMediaChange = () => readThemeTokens();
    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    mediaQuery?.addEventListener('change', handleMediaChange);

    const observer = new MutationObserver(readThemeTokens);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      mediaQuery?.removeEventListener('change', handleMediaChange);
      observer.disconnect();
    };
  }, [readThemeTokens]);

  const updateTooltipPosition = useCallback(
    (clientX: number, clientY: number, node: GraphNodePosition) => {
      if (!containerRef.current) {
        return;
      }
      const bounds = containerRef.current.getBoundingClientRect();
      const rawX = clientX - bounds.left;
      const rawY = clientY - bounds.top;
      const tooltipWidth = Math.min(300, bounds.width * 0.85);
      const tooltipHeight = 190;
      const x = clamp(rawX, tooltipWidth * 0.5 + 8, bounds.width - tooltipWidth * 0.5 - 8);
      const y = clamp(rawY, tooltipHeight + 24, bounds.height - 24);
      setTooltip({
        node,
        position: { x, y },
      });
    },
    [],
  );

  const handleNodePointerEnter = (node: GraphNodePosition) => (event: React.PointerEvent<SVGGElement>) => {
    if (isPanningRef.current) {
      return;
    }
    updateTooltipPosition(event.clientX, event.clientY, node);
  };

  const handleNodePointerMove = (node: GraphNodePosition) => (event: React.PointerEvent<SVGGElement>) => {
    if (isPanningRef.current) {
      return;
    }
    updateTooltipPosition(event.clientX, event.clientY, node);
  };

  const handleNodePointerLeave = () => {
    setTooltip(null);
  };

  const handleNodeFocus = (node: GraphNodePosition) => () => {
    if (!svgRef.current) {
      return;
    }
    const point = svgRef.current.createSVGPoint();
    point.x = node.x;
    point.y = node.y;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) {
      return;
    }
    const transformed = point.matrixTransform(ctm);
    updateTooltipPosition(transformed.x, transformed.y, node);
  };

  const handleNodeBlur = () => {
    setTooltip(null);
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current || !graphReady) {
      return;
    }
    event.preventDefault();
    setViewBox((previous) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        return previous;
      }

      const pointerX = previous.x + ((event.clientX - rect.left) / rect.width) * previous.width;
      const pointerY = previous.y + ((event.clientY - rect.top) / rect.height) * previous.height;

      const zoomStep = 0.15;
      const zoomIn = event.deltaY < 0;
      const factor = zoomIn ? 1 - zoomStep : 1 + zoomStep;

      const minWidth = Math.max(layout.width / 3, 320);
      const minHeight = Math.max(layout.height / 3, 220);
      const maxWidth = layout.width;
      const maxHeight = layout.height;

      const targetWidth = clamp(previous.width * factor, minWidth, maxWidth);
      const targetHeight = clamp(previous.height * factor, minHeight, maxHeight);

      const ratioX = previous.width === 0 ? 0 : (pointerX - previous.x) / previous.width;
      const ratioY = previous.height === 0 ? 0 : (pointerY - previous.y) / previous.height;

      const maxX = Math.max(layout.width - targetWidth, 0);
      const maxY = Math.max(layout.height - targetHeight, 0);

      const nextX = clamp(pointerX - ratioX * targetWidth, 0, maxX);
      const nextY = clamp(pointerY - ratioY * targetHeight, 0, maxY);

      return {
        x: Number.isFinite(nextX) ? nextX : previous.x,
        y: Number.isFinite(nextY) ? nextY : previous.y,
        width: targetWidth,
        height: targetHeight,
      };
    });
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || event.button !== 0 || !graphReady) {
      return;
    }
    event.preventDefault();
    svgRef.current.setPointerCapture(event.pointerId);
    panStateRef.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY } };
    setIsPanning(true);
    setTooltip(null);
  };

  const endPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (panStateRef.current.pointerId !== event.pointerId) {
      return;
    }
    if (svgRef.current) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
    panStateRef.current = { pointerId: null, origin: null };
    setIsPanning(false);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) {
      return;
    }
    if (panStateRef.current.pointerId !== event.pointerId || !panStateRef.current.origin) {
      return;
    }
    event.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const deltaX = event.clientX - panStateRef.current.origin.x;
    const deltaY = event.clientY - panStateRef.current.origin.y;
    panStateRef.current.origin = { x: event.clientX, y: event.clientY };

    setViewBox((previous) => {
      const nextX = clamp(
        previous.x - (deltaX / rect.width) * previous.width,
        0,
        Math.max(layout.width - previous.width, 0),
      );
      const nextY = clamp(
        previous.y - (deltaY / rect.height) * previous.height,
        0,
        Math.max(layout.height - previous.height, 0),
      );
      return { ...previous, x: nextX, y: nextY };
    });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    endPan(event);
  };

  const handlePointerLeave = (event: React.PointerEvent<SVGSVGElement>) => {
    if (panStateRef.current.pointerId === event.pointerId) {
      endPan(event);
    }
  };

  const exportGraph = async (format: 'png' | 'pdf') => {
    if (!svgRef.current || !graphReady) {
      return;
    }

    let objectUrl: string | null = null;
    try {
      setExportingFormat(format);
      const svg = svgRef.current;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', `${layout.width}`);
      clone.setAttribute('height', `${layout.height}`);
      clone.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      objectUrl = URL.createObjectURL(svgBlob);

      const image = new Image();
      const background = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-app-background')
        .trim() || '#ffffff';
      const pixelRatio = window.devicePixelRatio || 1;
      const exportWidth = Math.max(Math.round(layout.width), 1);
      const exportHeight = Math.max(Math.round(layout.height), 1);

      await new Promise<void>((resolve, reject) => {
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(Math.round(exportWidth * pixelRatio), 1);
          canvas.height = Math.max(Math.round(exportHeight * pixelRatio), 1);

          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('No se pudo crear el contexto de dibujo.'));
            return;
          }

          context.fillStyle = background;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
          context.drawImage(image, 0, 0, exportWidth, exportHeight);

          if (format === 'png') {
            canvas.toBlob((blob) => {
              if (!blob) {
                reject(new Error('No se pudo generar la imagen PNG.'));
                return;
              }
              const blobUrl = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = blobUrl;
              link.download = 'pkg-lens-graph.png';
              link.click();
              URL.revokeObjectURL(blobUrl);
              resolve();
            });
          } else {
            const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
            const jpegBytes = dataUrlToUint8Array(jpegDataUrl);
            const pdfBlob = createPdfFromJpeg(jpegBytes, exportWidth, exportHeight);
            const pdfUrl = URL.createObjectURL(pdfBlob);
            const link = document.createElement('a');
            link.href = pdfUrl;
            link.download = 'pkg-lens-graph.pdf';
            link.click();
            URL.revokeObjectURL(pdfUrl);
            resolve();
          }
        };

        image.onerror = () => {
          reject(new Error('No se pudo cargar la imagen generada.'));
        };

        if (objectUrl) {
          image.src = objectUrl;
        }
      });
    } catch (exportError) {
      console.error('No se pudo exportar el grafo.', exportError);
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setExportingFormat(null);
    }
  };

  const renderIssues = (issues: VersionIssue[]) => {
    if (!issues.length) {
      return null;
    }
    return (
      <ul className="issues">
        {issues.map((issue) => {
          const highlight = hasActiveFilters && isPanelIssueType(issue.type) && activeFilterSet.has(issue.type);
          const itemClassName = composeClassName(`issues__item issues__item--${issue.type}`, {
            'issues__item--highlight': highlight,
          });
          return (
            <li key={`${issue.type}-${issue.message}`} className={itemClassName}>
              {issue.message}
            </li>
          );
        })}
      </ul>
    );
  };

  const renderNode = (node: DependencyNode, path: string) => {
    const hasChildren = node.children.length > 0;
    const hasIssues = node.issues.length > 0;
    const isOutdated = node.issues.some((issue) => issue.type === 'outdated');
    const isDuplicate = node.issues.some((issue) => issue.type === 'duplicate');
    const isConflict = node.issues.some((issue) => issue.type === 'conflict');
    const isVulnerable = node.issues.some((issue) => issue.type === 'vulnerable');
    const nodeKey = createNodeKey(node.nodeId);
    const matchesActiveFilter =
      hasActiveFilters && node.issues.some((issue) => isPanelIssueType(issue.type) && activeFilterSet.has(issue.type));
    const isContextNode = hasActiveFilters && !matchesActiveFilter;

    return (
      <li key={path} className="tree-node">
        <div
          className={composeClassName('tree-node__card', {
            'tree-node__card--outdated': isOutdated,
            'tree-node__card--duplicate': isDuplicate,
            'tree-node__card--conflict': isConflict,
            'tree-node__card--vulnerable': isVulnerable,
            'tree-node__card--highlight': matchesActiveFilter,
            'tree-node__card--context': isContextNode,
          })}
          title={summarizeIssues(node.issues)}
          data-node-key={nodeKey}
          data-view="tree"
          tabIndex={-1}
        >
          <div className="tree-node__header">
            <span className="tree-node__name" title={node.name}>
              {node.name}
            </span>
            {hasIssues && <span className="tree-node__badge">⚠️</span>}
          </div>
          <div
            className="tree-node__version"
            title={`Declarada: ${node.declaredRange}\n${formatVersionLabel(node.resolvedVersion, node.latestVersion)}`}
          >
            <strong>{node.declaredRange}</strong>
            <span className="tree-node__resolved">{formatVersionLabel(node.resolvedVersion, node.latestVersion)}</span>
          </div>
          <p className="tree-node__description" title={node.rangeDescription}>
            {node.rangeDescription}
          </p>
          {renderIssues(node.issues)}
        </div>
        {hasChildren && (
          <ul className="tree-node__children">
            {node.children.map((child, index) => renderNode(child, `${path}.${child.nodeId}-${index}`))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section className="dependency-tree">
      <header className="dependency-tree__header">
        <div>
          <h2>Explora los resultados del análisis</h2>
          <p>Alterna entre el árbol y el grafo para revisar versiones, incidencias y exportar reportes.</p>
        </div>
        <div className="dependency-tree__controls">
          <div className="dependency-tree__view-toggle" role="group" aria-label="Cambiar vista">
            <button
              className={composeClassName('dependency-tree__toggle', {
                'dependency-tree__toggle--active': viewMode === 'tree',
              })}
              type="button"
              onClick={() => setViewMode('tree')}
            >
              Vista árbol
            </button>
            <button
              className={composeClassName('dependency-tree__toggle', {
                'dependency-tree__toggle--active': viewMode === 'graph',
              })}
              type="button"
              onClick={() => setViewMode('graph')}
            >
              Vista grafo
            </button>
          </div>
          <div className="dependency-tree__exports">
            <button
              type="button"
              className="dependency-tree__action"
              onClick={() => exportGraph('png')}
              disabled={!graphReady || exportingFormat !== null}
            >
              Exportar PNG
            </button>
            <button
              type="button"
              className="dependency-tree__action"
              onClick={() => exportGraph('pdf')}
              disabled={!graphReady || exportingFormat !== null}
            >
              Exportar PDF
            </button>
            {exportingFormat && (
              <div className="dependency-tree__export-loader" role="status" aria-live="polite">
                <span className="dependency-tree__spinner" aria-hidden="true" />
                Generando {exportingFormat === 'png' ? 'PNG' : 'PDF'}...
              </div>
            )}
          </div>
          <div className="dependency-tree__filters" role="group" aria-label="Filtrar incidencias">
            {ISSUE_TYPES.map((type) => {
              const isActive = activeFilterSet.has(type);
              const count = issueCounts[type];
              const chipClassName = composeClassName('dependency-tree__filter-chip', {
                'dependency-tree__filter-chip--active': isActive,
                'dependency-tree__filter-chip--disabled': count === 0 && !isActive,
              });
              return (
                <button
                  key={type}
                  type="button"
                  className={chipClassName}
                  onClick={() => toggleIssueFilter(type)}
                  aria-pressed={isActive}
                  aria-label={`${ISSUE_LABELS[type]} (${count})`}
                  disabled={count === 0 && !isActive}
                >
                  <span className={`dependency-tree__filter-dot dependency-tree__filter-dot--${type}`} aria-hidden="true" />
                  <span className="dependency-tree__filter-label">{ISSUE_LABELS[type]}</span>
                  <span className="dependency-tree__filter-count">{count}</span>
                </button>
              );
            })}
            {hasActiveFilters && (
              <button type="button" className="dependency-tree__filter-reset" onClick={clearFilters}>
                Limpiar filtros
              </button>
            )}
          </div>
        </div>
      </header>

      {loading && (
        <div className="dependency-tree__loader" role="status" aria-live="polite">
          <p className="dependency-tree__loader-text">Resolviendo dependencias...</p>
          <div
            className="dependency-tree__progress"
            role="progressbar"
            aria-label="Resolviendo dependencias"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext="Analizando dependencias"
          >
            <span className="dependency-tree__progress-bar" aria-hidden="true" />
          </div>
        </div>
      )}
      {error && !loading && <p className="dependency-tree__status dependency-tree__status--error">{error}</p>}

      {!loading && !error && !data && (
        <p className="dependency-tree__status dependency-tree__status--info">
          Ejecuta un análisis para visualizar tus dependencias.
        </p>
      )}

      {!loading && !error && data && hasPendingChanges && (
        <p className="dependency-tree__status dependency-tree__status--pending">
          Los datos mostrados provienen de un análisis anterior. Ejecuta el análisis nuevamente para actualizarlos.
        </p>
      )}

      {!loading && !error && data && (
        <div className="dependency-tree__content">
          <div className="dependency-tree__visualization">
            {viewMode === 'tree' && (
              hasAnyNodes ? (
                hasVisibleNodes ? (
                  <ol className="tree-root">
                    {filteredTree.map((node, index) => renderNode(node, `${node.nodeId}-${index}`))}
                  </ol>
                ) : (
                  <p className="dependency-tree__status dependency-tree__status--info">
                    {hasActiveFilters
                      ? 'No hay nodos que coincidan con los filtros seleccionados.'
                      : 'Añade dependencias para visualizar el grafo.'}
                  </p>
                )
              ) : (
                <p className="dependency-tree__status">Añade dependencias para visualizar el grafo.</p>
              )
            )}

            <div
              className={composeClassName('graph-view', {
                'graph-view--panning': isPanning,
                'graph-view--hidden': viewMode !== 'graph',
              })}
              role="img"
              aria-label="Grafo de dependencias"
              aria-hidden={viewMode !== 'graph'}
              ref={containerRef}
            >
              <svg
                ref={svgRef}
                width="100%"
                height="100%"
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                preserveAspectRatio="xMidYMid meet"
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerLeave}
              >
                <defs>
                  <marker id="graph-arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L9,3 z" fill={graphTheme.edge} />
                  </marker>
                </defs>
                {edges.map((edge, index) => {
                  const from = nodePositionMap.get(edge.from);
                  const to = nodePositionMap.get(edge.to);
                  if (!from || !to) {
                    return null;
                  }
                  return (
                    <line
                      key={`${edge.from}-${edge.to}-${index}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={graphTheme.edge}
                      strokeWidth={1.6}
                      markerEnd="url(#graph-arrow)"
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{`${edge.fromLabel} → ${edge.toLabel}`}</title>
                    </line>
                  );
                })}
                {layout.nodes.map((node, index) => {
                  const nodeKey = createNodeKey(node.id);
                  const hasIssues = node.issues.length > 0;
                  const matchesFilter =
                    hasActiveFilters &&
                    node.issues.some((issue) => isPanelIssueType(issue.type) && activeFilterSet.has(issue.type));
                  const isContextNode = hasActiveFilters && !matchesFilter;
                  const fillColor = hasIssues ? graphTheme.nodeWarningFill : graphTheme.nodeFill;
                  const nodeClassName = composeClassName('graph-node', {
                    'graph-node--highlight': matchesFilter,
                    'graph-node--context': isContextNode,
                  });
                  return (
                    <g
                      key={`${node.id}-${index}`}
                      className={nodeClassName}
                      tabIndex={0}
                      role="group"
                      data-node-key={nodeKey}
                      data-view="graph"
                      aria-label={`${node.label}. ${summarizeIssues(node.issues) || 'Sin incidencias detectadas.'}`}
                      onPointerEnter={handleNodePointerEnter(node)}
                      onPointerMove={handleNodePointerMove(node)}
                      onPointerLeave={handleNodePointerLeave}
                      onFocus={handleNodeFocus(node)}
                      onBlur={handleNodeBlur}
                    >
                      <circle cx={node.x} cy={node.y} r={32} fill={fillColor} fillOpacity={0.9} />
                      <text x={node.x} y={node.y - 44} fill={graphTheme.textPrimary} className="graph-node__title">
                        {node.label}
                      </text>
                      <text x={node.x} y={node.y - 18} fill={graphTheme.textMuted} className="graph-node__version">
                        {node.declaredRange}
                      </text>
                      <text x={node.x} y={node.y + 8} fill={graphTheme.textPrimary} className="graph-node__version">
                        {formatVersionLabel(node.resolvedVersion, node.latestVersion)}
                      </text>
                      <title>{`Declarado: ${node.declaredRange}\n${formatVersionLabel(node.resolvedVersion, node.latestVersion)}`}</title>
                    </g>
                  );
                })}
              </svg>
              {layout.nodes.length === 0 && (
                <div className="graph-view__empty" role="status">
                  {hasAnyNodes
                    ? 'No hay nodos que coincidan con los filtros seleccionados.'
                    : 'Añade dependencias para visualizar el grafo.'}
                </div>
              )}
              {viewMode === 'graph' && tooltip && (
                <div
                  className="graph-tooltip"
                  style={{ left: `${tooltip.position.x}px`, top: `${tooltip.position.y}px` }}
                  role="status"
                  aria-live="polite"
                >
                  <h3>{tooltip.node.label}</h3>
                  <div className="graph-tooltip__meta">
                    <span>
                      <strong>Declarado:</strong> {tooltip.node.declaredRange}
                    </span>
                    <span>
                      <strong>Instalado:</strong> {formatVersionLabel(tooltip.node.resolvedVersion, tooltip.node.latestVersion)}
                    </span>
                    {tooltip.node.latestVersion && (
                      <span>
                        <strong>Última:</strong> {tooltip.node.latestVersion}
                      </span>
                    )}
                    <span>{tooltip.node.rangeDescription}</span>
                  </div>
                  {!!tooltip.node.issues.length && (
                    <div className="graph-tooltip__issues">
                      {tooltip.node.issues.map((issue) => (
                        <span
                          key={`${issue.type}-${issue.message}`}
                          className={`graph-tooltip__issue ${getTooltipIssueClass(issue.type)}`}
                        >
                          {issue.message}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <aside className="dependency-tree__panel">
            <div className="dependency-tree__panel-header">
              <h3>Incidencias detectadas</h3>
              <p>Ordenadas por criticidad: vulnerables, conflictos, desactualizadas y duplicadas.</p>
            </div>
            <div className="dependency-tree__panel-filters" role="status" aria-live="polite">
              <span>Total incidencias: {issuePanelItems.length}</span>
            </div>
            <div className="dependency-tree__issue-list">
              {issuePanelItems.length > 0 ? (
                issuePanelItems.map((item) => (
                  <article
                    key={`${item.node.nodeId}-${item.issue.type}-${item.issue.message}-${item.treePath}`}
                    className="dependency-tree__issue-card"
                    data-issue-type={item.issue.type}
                    title={summarizeIssues(item.node.issues)}
                  >
                    <header className="dependency-tree__issue-header">
                      <h4 title={item.node.name}>{item.node.name}</h4>
                      <span className="dependency-tree__issue-type">{ISSUE_LABELS[item.issue.type]}</span>
                    </header>
                    <p className="dependency-tree__issue-message">{item.issue.message}</p>
                    <dl className="dependency-tree__issue-meta">
                      <div>
                        <dt>Declarado</dt>
                        <dd>{item.node.declaredRange}</dd>
                      </div>
                      <div>
                        <dt>Instalado</dt>
                        <dd>{formatVersionLabel(item.node.resolvedVersion, item.node.latestVersion)}</dd>
                      </div>
                    </dl>
                    <div className="dependency-tree__issue-actions">
                      <button
                        type="button"
                        className="dependency-tree__issue-link"
                        onClick={handleIssueNavigation('tree', item.node.nodeId)}
                        title="Ir al nodo en la vista árbol"
                        aria-label={`Ver ${item.node.name} en la vista árbol. ${summarizeIssues(item.node.issues)}`}
                      >
                        Ver en árbol
                      </button>
                      <button
                        type="button"
                        className="dependency-tree__issue-link dependency-tree__issue-link--graph"
                        onClick={handleIssueNavigation('graph', item.node.nodeId)}
                        title="Ir al nodo en la vista grafo"
                        aria-label={`Ver ${item.node.name} en la vista grafo. ${summarizeIssues(item.node.issues)}`}
                      >
                        Ver en grafo
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="dependency-tree__panel-empty">
                  {hasActiveFilters
                    ? 'Sin incidencias para los filtros seleccionados.'
                    : 'No se encontraron incidencias en el análisis actual.'}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
};
