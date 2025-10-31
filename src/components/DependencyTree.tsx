import React, { useMemo, useState } from 'react';

import { DependencyGraphResult, DependencyNode } from './VersionResolver';
import { formatVersionLabel, summarizeIssues, VersionIssue } from '../utils/semverUtils';

import './DependencyTree.css';

export interface DependencyTreeProps {
  data: DependencyGraphResult | null;
  loading?: boolean;
  error?: string | null;
}

type ViewMode = 'tree' | 'graph';

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
}

export const DependencyTree: React.FC<DependencyTreeProps> = ({ data, loading, error }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('tree');

  const composeClassName = (base: string, states: Record<string, boolean> = {}): string => {
    const dynamicClasses = Object.entries(states)
      .filter(([, active]) => Boolean(active))
      .map(([className]) => className);
    return [base, ...dynamicClasses].join(' ');
  };

  const flattenedNodes = useMemo(() => {
    if (!data?.tree) {
      return [];
    }
    const nodes: GraphNodePosition[] = [];
    const levelCounters = new Map<number, number>();

    const visit = (node: DependencyNode, level: number) => {
      const index = levelCounters.get(level) ?? 0;
      levelCounters.set(level, index + 1);

      nodes.push({
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
      });

      node.children.forEach((child) => visit(child, level + 1));
    };

    data.tree.forEach((node) => visit(node, 0));

    const columnWidth = 220;
    const rowHeight = 110;

    return nodes.map((node) => ({
      ...node,
      x: 140 + node.level * columnWidth,
      y: 100 + node.index * rowHeight,
    }));
  }, [data]);

  const edges = useMemo(() => data?.edges ?? [], [data]);

  const renderIssues = (issues: VersionIssue[]) => {
    if (!issues.length) {
      return null;
    }
    return (
      <ul className="issues">
        {issues.map((issue) => (
          <li key={`${issue.type}-${issue.message}`} className={`issues__item issues__item--${issue.type}`}>
            {issue.message}
          </li>
        ))}
      </ul>
    );
  };

  const renderNode = (node: DependencyNode) => {
    const hasChildren = node.children.length > 0;
    const hasIssues = node.issues.length > 0;
    const isOutdated = node.issues.some((issue) => issue.type === 'outdated');
    const isDuplicate = node.issues.some((issue) => issue.type === 'duplicate');
    const isConflict = node.issues.some((issue) => issue.type === 'conflict');
    const isVulnerable = node.issues.some((issue) => issue.type === 'vulnerable');

    return (
      <li key={node.nodeId} className="tree-node">
        <div
          className={composeClassName('tree-node__card', {
            'tree-node__card--outdated': isOutdated,
            'tree-node__card--duplicate': isDuplicate,
            'tree-node__card--conflict': isConflict,
            'tree-node__card--vulnerable': isVulnerable,
          })}
          title={summarizeIssues(node.issues)}
        >
          <div className="tree-node__header">
            <span className="tree-node__name" title={node.name}>
              {node.name}
            </span>
            {hasIssues && <span className="tree-node__badge">⚠️</span>}
          </div>
          <div className="tree-node__version" title={`Declarada: ${node.declaredRange}\n${formatVersionLabel(node.resolvedVersion, node.latestVersion)}`}>
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
            {node.children.map((child) => renderNode(child))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section className="dependency-tree">
      <header className="dependency-tree__header">
        <div>
          <h2>2. Visualiza y audita tus dependencias</h2>
          <p>Compara rangos declarados, versiones instaladas y posibles incidencias.</p>
        </div>
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
      </header>

      {loading && <p className="dependency-tree__status">Resolviendo dependencias...</p>}
      {error && !loading && <p className="dependency-tree__status dependency-tree__status--error">{error}</p>}

      {!loading && !error && data && data.tree.length === 0 && (
        <p className="dependency-tree__status">Añade dependencias para visualizar el grafo.</p>
      )}

      {!loading && !error && data && data.tree.length > 0 && viewMode === 'tree' && (
        <ol className="tree-root">{data.tree.map((node) => renderNode(node))}</ol>
      )}

      {!loading && !error && data && data.tree.length > 0 && viewMode === 'graph' && (
        <div className="graph-view" role="img" aria-label="Grafo de dependencias">
          <svg width="100%" height="500" viewBox="0 0 1200 500">
            {edges.map((edge) => {
              const from = flattenedNodes.find((node) => node.id === edge.from);
              const to = flattenedNodes.find((node) => node.id === edge.to);
              if (!from || !to) {
                return null;
              }
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="#9ca3af"
                  strokeWidth={1.5}
                  markerEnd="url(#arrow)"
                >
                  <title>{`${edge.fromLabel} → ${edge.toLabel}`}</title>
                </line>
              );
            })}
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#9ca3af" />
              </marker>
            </defs>
            {flattenedNodes.map((node) => {
              const hasIssues = node.issues.length > 0;
              const nodeClass = hasIssues ? 'graph-node graph-node--warning' : 'graph-node';
              return (
                <g key={node.id} className={nodeClass}>
                  <circle cx={node.x} cy={node.y} r={32} />
                  <text x={node.x} y={node.y - 42} className="graph-node__title">
                    {node.label}
                  </text>
                  <text x={node.x} y={node.y} className="graph-node__version">
                    {formatVersionLabel(node.resolvedVersion, node.latestVersion)}
                  </text>
                  <title>{`Declarado: ${node.declaredRange}\n${summarizeIssues(node.issues)}`}</title>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
};
