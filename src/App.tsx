import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

import { DependencyTree } from './components/DependencyTree';
import { FileUploader } from './components/FileUploader';
import {
  DependencyGraphResult,
  PackageDefinition,
  resolvePackageGraph,
  ResolveOptions,
} from './lib/VersionResolver';
import { diffIssueSummary, diffPackageDependencies } from './utils/diffUtils';
import { normalizePackageDefinition } from './utils/packageDefinition';

import './App.css';

type ThemeMode = 'light' | 'dark';
type WorkspaceZone = 'analysis' | 'comparison';
type ComparisonView = 'current' | 'target';

const THEME_STORAGE_KEY = 'pkgLensTheme';

const ZONE_LABELS: Record<WorkspaceZone, string> = {
  analysis: 'Analizar package.json',
  comparison: 'Comparador de dependencias',
};

const ZONE_DESCRIPTIONS: Record<WorkspaceZone, string> = {
  analysis: 'Carga un manifiesto y obtén un informe completo del árbol, grafo e incidencias detectadas.',
  comparison: 'Compara dos package.json para medir el impacto entre versiones y revisar incidencias.',
};

const DEFAULT_ANALYSIS: PackageDefinition = {
  dependencies: {
    react: '^19.2.0',
    'react-dom': '^19.2.0',
    lodash: '^4.17.21',
  },
  devDependencies: {
    typescript: '^5.6.3',
    jest: '^29.7.0',
  },
};

const DEFAULT_TARGET: PackageDefinition = {
  dependencies: {
    react: '^19.3.0',
    'react-dom': '^19.3.0',
    lodash: '^4.17.21',
    zod: '^3.23.8',
  },
  devDependencies: {
    vitest: '^2.1.4',
    typescript: '^5.6.3',
  },
};

const readStoredTheme = (): ThemeMode | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
};

const detectSystemTheme = (): ThemeMode => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = readStoredTheme();
    return stored ?? detectSystemTheme();
  });
  const [hasManualTheme, setHasManualTheme] = useState<boolean>(() => readStoredTheme() !== null);
  const [activeZone, setActiveZone] = useState<WorkspaceZone>('analysis');

  const [analysisPackage, setAnalysisPackage] = useState<PackageDefinition>(DEFAULT_ANALYSIS);
  const [analysisResult, setAnalysisResult] = useState<DependencyGraphResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false);
  const [analysisPendingChanges, setAnalysisPendingChanges] = useState<boolean>(true);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisIncludeDev, setAnalysisIncludeDev] = useState<boolean>(false);

  const [currentPackage, setCurrentPackage] = useState<PackageDefinition>(DEFAULT_ANALYSIS);
  const [targetPackage, setTargetPackage] = useState<PackageDefinition>(DEFAULT_TARGET);
  const [comparisonResults, setComparisonResults] = useState<Record<ComparisonView, DependencyGraphResult | null>>({
    current: null,
    target: null,
  });
  const [comparisonLoading, setComparisonLoading] = useState<boolean>(false);
  const [comparisonPendingChanges, setComparisonPendingChanges] = useState<boolean>(true);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonIncludeDev, setComparisonIncludeDev] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<ComparisonView>('current');

  const serializedAnalysis = useMemo(() => JSON.stringify(analysisPackage, null, 2), [analysisPackage]);
  const serializedCurrent = useMemo(() => JSON.stringify(currentPackage, null, 2), [currentPackage]);
  const serializedTarget = useMemo(() => JSON.stringify(targetPackage, null, 2), [targetPackage]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty('color-scheme', theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (hasManualTheme) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } else {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    }
  }, [theme, hasManualTheme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (!hasManualTheme) {
        setTheme(event.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [hasManualTheme]);

  const handleAnalyzePackage = useCallback(async () => {
    if (analysisLoading) {
      return;
    }
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const options: ResolveOptions = {
        includeDev: analysisIncludeDev,
      };
      const result = await resolvePackageGraph(analysisPackage, options);
      setAnalysisResult(result);
      setAnalysisPendingChanges(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudieron resolver las dependencias. Verifica tu conexión y vuelve a intentarlo.';
      setAnalysisError(message);
      setAnalysisPendingChanges(true);
    } finally {
      setAnalysisLoading(false);
    }
  }, [analysisIncludeDev, analysisLoading, analysisPackage]);

  const handleAnalysisError = useCallback((message: string) => {
    setAnalysisError(message);
    setAnalysisPendingChanges(true);
  }, []);

  const handleAnalysisPackageChange = useCallback((data: Record<string, unknown>) => {
    try {
      const normalized = normalizePackageDefinition(data);
      setAnalysisPackage(normalized);
      setAnalysisPendingChanges(true);
      setAnalysisError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ocurrió un problema al interpretar el package.json proporcionado.';
      handleAnalysisError(message);
    }
  }, [handleAnalysisError]);

  const handleComparisonError = useCallback((message: string) => {
    setComparisonError(message);
    setComparisonPendingChanges(true);
  }, []);

  const handleCurrentPackageChange = useCallback((data: Record<string, unknown>) => {
    try {
      const normalized = normalizePackageDefinition(data);
      setCurrentPackage(normalized);
      setComparisonPendingChanges(true);
      setComparisonError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ocurrió un problema al interpretar el package.json proporcionado.';
      handleComparisonError(message);
    }
  }, [handleComparisonError]);

  const handleTargetPackageChange = useCallback((data: Record<string, unknown>) => {
    try {
      const normalized = normalizePackageDefinition(data);
      setTargetPackage(normalized);
      setComparisonPendingChanges(true);
      setComparisonError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ocurrió un problema al interpretar el package.json proporcionado.';
      handleComparisonError(message);
    }
  }, [handleComparisonError]);

  useEffect(() => {
    if (activeView === 'target' && !targetPackage) {
      setActiveView('current');
    }
  }, [activeView, targetPackage]);

  const handleComparePackages = useCallback(async () => {
    if (comparisonLoading) {
      return;
    }
    setComparisonLoading(true);
    setComparisonError(null);
    try {
      const options: ResolveOptions = {
        includeDev: comparisonIncludeDev,
      };
      const packagesToResolve: Array<[ComparisonView, PackageDefinition]> = [
        ['current', currentPackage],
      ];
      if (targetPackage) {
        packagesToResolve.push(['target', targetPackage]);
      }

      const resolvedEntries = await Promise.all(
        packagesToResolve.map(async ([key, pkg]) => {
          const result = await resolvePackageGraph(pkg, options);
          return [key, result] as const;
        }),
      );

      setComparisonResults((previous) => {
        const next: Record<ComparisonView, DependencyGraphResult | null> = { ...previous };
        (resolvedEntries as Array<readonly [ComparisonView, DependencyGraphResult]>).forEach(([key, value]) => {
          next[key] = value;
        });
        if (!targetPackage) {
          next.target = null;
        }
        return next;
      });
      setComparisonPendingChanges(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudieron resolver las dependencias. Verifica tu conexión y vuelve a intentarlo.';
      setComparisonError(message);
      setComparisonPendingChanges(true);
    } finally {
      setComparisonLoading(false);
    }
  }, [comparisonIncludeDev, comparisonLoading, currentPackage, targetPackage]);

  const analysisDependenciesCount = Object.keys(analysisPackage.dependencies ?? {}).length;
  const analysisDevDependenciesCount = Object.keys(analysisPackage.devDependencies ?? {}).length;

  const activeComparisonPackage = activeView === 'current' ? currentPackage : targetPackage;
  const comparisonDependenciesCount = Object.keys(activeComparisonPackage?.dependencies ?? {}).length;
  const comparisonDevDependenciesCount = Object.keys(activeComparisonPackage?.devDependencies ?? {}).length;

  const dependencyDiff = targetPackage
    ? diffPackageDependencies(currentPackage, targetPackage, comparisonIncludeDev)
    : null;
  const issueDiff =
    targetPackage && comparisonResults.target
      ? diffIssueSummary(comparisonResults.current, comparisonResults.target)
      : null;

  const toggleTheme = useCallback(() => {
    setHasManualTheme(true);
    setTheme((previous) => (previous === 'light' ? 'dark' : 'light'));
  }, []);

  const handleFollowSystemTheme = useCallback(() => {
    setHasManualTheme(false);
    setTheme(detectSystemTheme());
  }, []);

  const analysisMessage = () => {
    if (analysisLoading) {
      return (
        <span className="app__pending app__pending--active">
          <span className="app__button-spinner" aria-hidden="true" /> Resolviendo dependencias...
        </span>
      );
    }
    if (analysisError) {
      return <span className="app__pending app__pending--error">{analysisError}</span>;
    }
    if (analysisPendingChanges) {
      return <span className="app__pending">Carga o edita el manifiesto y ejecuta el análisis para refrescar los resultados.</span>;
    }
    return <span className="app__pending app__pending--success">Último análisis actualizado.</span>;
  };

  const comparisonMessage = () => {
    if (comparisonLoading) {
      return (
        <span className="app__pending app__pending--active">
          <span className="app__button-spinner" aria-hidden="true" /> Calculando comparativa...
        </span>
      );
    }
    if (comparisonError) {
      return <span className="app__pending app__pending--error">{comparisonError}</span>;
    }
    if (comparisonPendingChanges) {
      return <span className="app__pending">Actualiza los manifiestos y vuelve a ejecutar la comparación.</span>;
    }
    return <span className="app__pending app__pending--success">Comparación al día.</span>;
  };

  return (
    <main className="app">
      <header className="app__header">
        <div className="app__headline">
          <h1>PkgLens</h1>
          <p className="app__subtitle">
            Analiza, compara y proyecta el árbol de dependencias de tus proyectos antes de aplicar una migración real.
          </p>
        </div>
        <div className="app__header-actions">
          <button
            type="button"
            className="app__theme-toggle"
            aria-label={`Cambiar a modo ${theme === 'light' ? 'oscuro' : 'claro'}`}
            aria-pressed={theme === 'dark'}
            onClick={toggleTheme}
          >
            <span className="app__theme-icon" aria-hidden="true">
              {theme === 'dark' ? '🌙' : '☀️'}
            </span>
            <span className="app__theme-label">Modo {theme === 'dark' ? 'oscuro' : 'claro'}</span>
          </button>
          <button type="button" className="app__theme-system" onClick={handleFollowSystemTheme} disabled={!hasManualTheme}>
            Seguir sistema
          </button>
        </div>
      </header>

      <section className="app__zones" aria-label="Áreas de trabajo">
        {(['analysis', 'comparison'] as WorkspaceZone[]).map((zone) => (
          <button
            key={zone}
            type="button"
            className={`app__zone ${activeZone === zone ? 'app__zone--active' : ''}`}
            onClick={() => setActiveZone(zone)}
            aria-pressed={activeZone === zone}
          >
            <span className="app__zone-title">{ZONE_LABELS[zone]}</span>
            <span className="app__zone-description">{ZONE_DESCRIPTIONS[zone]}</span>
          </button>
        ))}
      </section>

      <section className="app__canvas">
        {activeZone === 'analysis' && (
          <div className="app__panel app__panel--analysis">
            <div className="app__panel-header">
              <h2>Análisis de package.json</h2>
              <p>Introduce un manifiesto y genera automáticamente árbol, grafo e incidencias priorizadas.</p>
            </div>
            <div className="app__panel-actions">
              <div className="app__analysis-settings">
                <div className="app__switch">
                  <label htmlFor="analysis-dev-toggle">
                    <input
                      id="analysis-dev-toggle"
                      type="checkbox"
                      checked={analysisIncludeDev}
                      onChange={(event) => {
                        setAnalysisIncludeDev(event.target.checked);
                        setAnalysisPendingChanges(true);
                      }}
                    />
                    Incluir devDependencies ({analysisDevDependenciesCount})
                  </label>
                </div>
                <div className="app__stats" aria-live="polite">
                  <span className="app__stat">Dependencias: {analysisDependenciesCount}</span>
                  <span className="app__stat">Dev: {analysisDevDependenciesCount}</span>
                </div>
              </div>
              <button
                type="button"
                className="app__analyze"
                onClick={handleAnalyzePackage}
                disabled={analysisLoading}
              >
                {analysisLoading && <span className="app__button-spinner" aria-hidden="true" />}
                <span>{analysisLoading ? 'Analizando...' : 'Analizar package.json'}</span>
              </button>
            </div>
            <div className="app__analysis-feedback" role="status" aria-live="polite">
              {analysisMessage()}
            </div>
            <div className="app__inputs">
              <FileUploader
                id="analysis-package"
                title="Package.json a analizar"
                description="Sube o pega el manifiesto que quieres inspeccionar. Puedes editarlo directamente antes de ejecutar el análisis."
                onPackageChange={handleAnalysisPackageChange}
                onError={handleAnalysisError}
                defaultValue={serializedAnalysis}
                actionLabel="Seleccionar package.json"
              />
            </div>
            <DependencyTree
              data={analysisResult}
              loading={analysisLoading}
              error={analysisError}
              hasPendingChanges={analysisPendingChanges}
              reportOptions={{
                includeDev: analysisIncludeDev,
                includePeer: true,
                maxDepth: 6,
                source: 'Análisis de package.json',
                packageName: 'analisis',
              }}
            />
          </div>
        )}

        {activeZone === 'comparison' && (
          <div className="app__panel app__panel--comparison">
            <div className="app__panel-header">
              <h2>Comparador de dependencias</h2>
              <p>Explora el árbol y grafo generados para cada manifiesto y revisa diferencias clave.</p>
            </div>
            <div className="app__panel-actions">
              <div className="app__analysis-settings">
                <div className="app__switch">
                  <label htmlFor="comparison-dev-toggle">
                    <input
                      id="comparison-dev-toggle"
                      type="checkbox"
                      checked={comparisonIncludeDev}
                      onChange={(event) => {
                        setComparisonIncludeDev(event.target.checked);
                        setComparisonPendingChanges(true);
                      }}
                    />
                    Incluir devDependencies
                  </label>
                </div>
                <div className="app__stats" aria-live="polite">
                  <span className="app__stat">Dependencias: {comparisonDependenciesCount}</span>
                  <span className="app__stat">Dev: {comparisonDevDependenciesCount}</span>
                  {dependencyDiff && (
                    <span className="app__stat app__stat--accent">
                      Δ deps: +{dependencyDiff.added} / −{dependencyDiff.removed} / ⚙︎ {dependencyDiff.changed}
                    </span>
                  )}
                  {issueDiff && (
                    <span className="app__stat app__stat--accent">
                      Δ incidencias: −{issueDiff.resolved} / +{issueDiff.introduced}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="app__analyze"
                onClick={handleComparePackages}
                disabled={comparisonLoading}
              >
                {comparisonLoading && <span className="app__button-spinner" aria-hidden="true" />}
                <span>{comparisonLoading ? 'Comparando...' : 'Analizar manifiestos'}</span>
              </button>
            </div>
            <div className="app__analysis-feedback" role="status" aria-live="polite">
              {comparisonMessage()}
            </div>
            <div className="app__inputs">
              <FileUploader
                id="current-package"
                title="1. Paquete base"
                description="Sube o pega el package.json instalado en tu entorno actual."
                onPackageChange={handleCurrentPackageChange}
                onError={handleComparisonError}
                defaultValue={serializedCurrent}
                actionLabel="Seleccionar package.json base"
              />
              <FileUploader
                id="target-package"
                title="2. Paquete objetivo"
                description="Carga la versión candidata para comparar su árbol de dependencias contra el paquete base."
                onPackageChange={handleTargetPackageChange}
                onError={handleComparisonError}
                defaultValue={serializedTarget}
                actionLabel="Seleccionar package.json objetivo"
              />
            </div>
            <div className="app__comparison-toolbar">
              <nav className="app__view-selector" aria-label="Vista activa del comparador">
                <button
                  type="button"
                  className={`app__view ${activeView === 'current' ? 'app__view--active' : ''}`}
                  onClick={() => setActiveView('current')}
                >
                  Paquete base
                </button>
                <button
                  type="button"
                  className={`app__view ${activeView === 'target' ? 'app__view--active' : ''}`}
                  onClick={() => setActiveView('target')}
                  disabled={!targetPackage}
                >
                  Paquete objetivo
                </button>
              </nav>
            </div>
            <DependencyTree
              data={activeView === 'current' ? comparisonResults.current : comparisonResults.target}
              loading={comparisonLoading}
              error={comparisonError}
              hasPendingChanges={comparisonPendingChanges}
              reportOptions={{
                includeDev: comparisonIncludeDev,
                includePeer: true,
                maxDepth: 6,
                source:
                  activeView === 'current'
                    ? 'Comparador · Paquete base'
                    : 'Comparador · Paquete objetivo',
                packageName: activeView === 'current' ? 'base' : 'objetivo',
              }}
            />
          </div>
        )}
      </section>
    </main>
  );
}

export default App;

