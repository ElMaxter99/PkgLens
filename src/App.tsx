import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

import { DependencyTree } from './components/DependencyTree';
import { FileUploader } from './components/FileUploader';
import { ScenarioEditor } from './components/ScenarioEditor';
import {
  DependencyGraphResult,
  PackageDefinition,
  resolvePackageGraph,
  ResolveOptions,
} from './components/VersionResolver';
import { diffIssueSummary, diffPackageDependencies } from './utils/diffUtils';

import './App.css';

type ThemeMode = 'light' | 'dark';
type ViewMode = 'current' | 'target' | 'scenario';

const THEME_STORAGE_KEY = 'pkgLensTheme';

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

const DEFAULT_CURRENT: PackageDefinition = {
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

function clonePackageDefinition(pkg: PackageDefinition | null): PackageDefinition | null {
  if (!pkg) {
    return null;
  }
  const cloned: PackageDefinition = {};
  if (pkg.dependencies) {
    cloned.dependencies = { ...pkg.dependencies };
  }
  if (pkg.devDependencies) {
    cloned.devDependencies = { ...pkg.devDependencies };
  }
  return cloned;
}

function normalizePackageDefinition(input: Record<string, unknown>): PackageDefinition {
  const dependencies = extractDependencies(input, 'dependencies');
  const devDependencies = extractDependencies(input, 'devDependencies');
  return { dependencies, devDependencies };
}

function extractDependencies(source: Record<string, unknown>, key: keyof PackageDefinition): Record<string, string> {
  const value = source[key];
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function App(): JSX.Element {
  const [currentPackage, setCurrentPackage] = useState<PackageDefinition>(DEFAULT_CURRENT);
  const [targetPackage, setTargetPackage] = useState<PackageDefinition>(DEFAULT_TARGET);
  const [scenarioPackage, setScenarioPackage] = useState<PackageDefinition | null>(clonePackageDefinition(DEFAULT_TARGET));
  const [analysisResults, setAnalysisResults] = useState<Record<ViewMode, DependencyGraphResult | null>>({
    current: null,
    target: null,
    scenario: null,
  });
  const [activeView, setActiveView] = useState<ViewMode>('current');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [includeDevDependencies, setIncludeDevDependencies] = useState<boolean>(false);
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(true);
  const [scenarioDirty, setScenarioDirty] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = readStoredTheme();
    return stored ?? detectSystemTheme();
  });
  const [hasManualTheme, setHasManualTheme] = useState<boolean>(() => readStoredTheme() !== null);

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

  useEffect(() => {
    if (!scenarioDirty) {
      setScenarioPackage(clonePackageDefinition(targetPackage));
    }
  }, [targetPackage, scenarioDirty]);

  const handleError = useCallback((message: string) => {
    setErrorMessage(message);
  }, []);

  const handleCurrentPackageChange = useCallback((data: Record<string, unknown>) => {
    try {
      const normalized = normalizePackageDefinition(data);
      setCurrentPackage(normalized);
      setErrorMessage(null);
      setHasPendingChanges(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ocurrió un problema al interpretar el package.json proporcionado.';
      setErrorMessage(message);
      setHasPendingChanges(true);
    }
  }, []);

  const handleTargetPackageChange = useCallback((data: Record<string, unknown>) => {
    try {
      const normalized = normalizePackageDefinition(data);
      setTargetPackage(normalized);
      setScenarioDirty(false);
      setErrorMessage(null);
      setHasPendingChanges(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ocurrió un problema al interpretar el package.json proporcionado.';
      setErrorMessage(message);
      setHasPendingChanges(true);
    }
  }, []);

  const handleScenarioChange = useCallback((pkg: PackageDefinition | null) => {
    setScenarioDirty(true);
    setScenarioPackage(pkg ? clonePackageDefinition(pkg) : null);
    setHasPendingChanges(true);
  }, []);

  const handleScenarioReset = useCallback(() => {
    setScenarioDirty(false);
    setScenarioPackage(clonePackageDefinition(targetPackage));
    setHasPendingChanges(true);
  }, [targetPackage]);

  const toggleTheme = useCallback(() => {
    setHasManualTheme(true);
    setTheme((previous) => (previous === 'light' ? 'dark' : 'light'));
  }, []);

  const handleFollowSystemTheme = useCallback(() => {
    setHasManualTheme(false);
    setTheme(detectSystemTheme());
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const options: ResolveOptions = {
        includeDev: includeDevDependencies,
      };
      const packagesToResolve: Array<[ViewMode, PackageDefinition]> = [
        ['current', currentPackage],
      ];
      if (targetPackage) {
        packagesToResolve.push(['target', targetPackage]);
      }
      if (scenarioPackage) {
        packagesToResolve.push(['scenario', scenarioPackage]);
      }

      const resolvedEntries = await Promise.all(
        packagesToResolve.map(async ([key, pkg]) => {
          const result = await resolvePackageGraph(pkg, options);
          return [key, result] as const;
        }),
      );

      const resolvedKeys = new Set(packagesToResolve.map(([key]) => key));
      setAnalysisResults((previous) => {
        const next: Record<ViewMode, DependencyGraphResult | null> = { ...previous };
        (resolvedEntries as Array<readonly [ViewMode, DependencyGraphResult]>).forEach(([key, value]) => {
          next[key] = value;
        });
        if (!resolvedKeys.has('target')) {
          next.target = null;
        }
        if (!resolvedKeys.has('scenario')) {
          next.scenario = null;
        }
        return next;
      });
      setHasPendingChanges(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudieron resolver las dependencias. Verifica tu conexión y vuelve a intentarlo.';
      setErrorMessage(message);
      setHasPendingChanges(true);
    } finally {
      setLoading(false);
    }
  }, [currentPackage, includeDevDependencies, loading, scenarioPackage, targetPackage]);

  const resolvePackageForView = (view: ViewMode): PackageDefinition | null => {
    if (view === 'current') {
      return currentPackage;
    }
    if (view === 'target') {
      return targetPackage;
    }
    return scenarioPackage;
  };

  const activePackage = resolvePackageForView(activeView) ?? currentPackage;
  const dependenciesCount = Object.keys(activePackage?.dependencies ?? {}).length;
  const devDependenciesCount = Object.keys(activePackage?.devDependencies ?? {}).length;

  const comparisonPackage = activeView === 'current' ? null : resolvePackageForView(activeView);
  const dependencyDiff =
    activeView === 'current' || !comparisonPackage
      ? null
      : diffPackageDependencies(currentPackage, comparisonPackage, includeDevDependencies);

  const comparisonResult = activeView === 'current' ? null : analysisResults[activeView];
  const issueDiff = activeView === 'current' ? null : diffIssueSummary(analysisResults.current, comparisonResult);

  const activeResult = analysisResults[activeView];

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

      <section className="app__controls">
        <div className="app__switch">
          <label htmlFor="toggle-dev">
            <input
              id="toggle-dev"
              type="checkbox"
              checked={includeDevDependencies}
              onChange={(event) => {
                setIncludeDevDependencies(event.target.checked);
                setHasPendingChanges(true);
              }}
            />
            Incluir devDependencies ({devDependenciesCount})
          </label>
        </div>
        <div className="app__actions">
          <button type="button" className="app__analyze" onClick={handleAnalyze} disabled={loading}>
            {loading ? 'Analizando...' : 'Analizar dependencias'}
          </button>
          {!loading && hasPendingChanges && (
            <span className="app__pending" role="status">
              {activeResult
                ? 'Tienes cambios sin analizar. Ejecuta el análisis para actualizar el reporte.'
                : 'Ejecuta el análisis para generar o refrescar el grafo de dependencias.'}
            </span>
          )}
          {loading && (
            <span className="app__pending app__pending--active" role="status" aria-live="polite">
              <span className="app__pending-spinner" aria-hidden="true" />
              Resolviendo dependencias...
            </span>
          )}
        </div>
        <div className="app__stats" aria-live="polite">
          <span className="app__stat">Dependencias: {dependenciesCount}</span>
          <span className="app__stat">Dev: {devDependenciesCount}</span>
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
      </section>

      <nav className="app__view-selector" aria-label="Vista activa del grafo">
        <button
          type="button"
          className={`app__view ${activeView === 'current' ? 'app__view--active' : ''}`}
          onClick={() => setActiveView('current')}
        >
          Proyecto actual
        </button>
        <button
          type="button"
          className={`app__view ${activeView === 'target' ? 'app__view--active' : ''}`}
          onClick={() => setActiveView('target')}
          disabled={!targetPackage}
        >
          Migración objetivo
        </button>
        <button
          type="button"
          className={`app__view ${activeView === 'scenario' ? 'app__view--active' : ''}`}
          onClick={() => setActiveView('scenario')}
          disabled={!scenarioPackage}
        >
          Escenario what-if
        </button>
      </nav>

      <div className="app__inputs">
        <FileUploader
          id="current-package"
          title="1. Paquete actual"
          description="Sube o pega el package.json instalado en tu entorno actual. Usa este punto de partida como base para cualquier comparación."
          onPackageChange={handleCurrentPackageChange}
          onError={handleError}
          defaultValue={serializedCurrent}
          actionLabel="Seleccionar package.json actual"
        />
        <FileUploader
          id="target-package"
          title="2. Paquete objetivo"
          description="Carga la versión candidata a producción para comparar su árbol de dependencias con el proyecto actual."
          onPackageChange={handleTargetPackageChange}
          onError={handleError}
          defaultValue={serializedTarget}
          actionLabel="Seleccionar package.json objetivo"
        />
      </div>

      <ScenarioEditor
        basePackage={targetPackage}
        value={scenarioPackage}
        onChange={handleScenarioChange}
        onReset={handleScenarioReset}
        disabled={!targetPackage}
      />

      <DependencyTree
        data={activeResult}
        loading={loading}
        error={errorMessage}
        hasPendingChanges={hasPendingChanges}
      />
    </main>
  );
}

export default App;

