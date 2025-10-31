import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

import { FileUploader } from './components/FileUploader';
import { DependencyTree } from './components/DependencyTree';
import {
  DependencyGraphResult,
  PackageDefinition,
  resolvePackageGraph,
  ResolveOptions,
} from './components/VersionResolver';

import './App.css';

type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'pkgLensTheme';

const readStoredTheme = (): ThemeMode | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
};

const detectSystemTheme = (): ThemeMode => {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const DEFAULT_PACKAGE: PackageDefinition = {
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
  const [packageDefinition, setPackageDefinition] = useState<PackageDefinition>(DEFAULT_PACKAGE);
  const [analysisResult, setAnalysisResult] = useState<DependencyGraphResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [includeDevDependencies, setIncludeDevDependencies] = useState<boolean>(false);
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(true);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = readStoredTheme();
    return stored ?? detectSystemTheme();
  });
  const [hasManualTheme, setHasManualTheme] = useState<boolean>(() => readStoredTheme() !== null);

  const serializedDefault = useMemo(() => JSON.stringify(DEFAULT_PACKAGE, null, 2), []);

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
    if (typeof window === 'undefined') {
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

  const handlePackageChange = useCallback(
    (data: Record<string, unknown>) => {
      try {
        const normalized = normalizePackageDefinition(data);
        setPackageDefinition(normalized);
        setErrorMessage(null);
        setHasPendingChanges(true);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Ocurrió un problema al interpretar el package.json proporcionado.';
        setErrorMessage(message);
        setHasPendingChanges(true);
      }
    },
    [setPackageDefinition],
  );

  const handleError = useCallback((message: string) => {
    setErrorMessage(message);
  }, []);

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
    setHasPendingChanges(false);
    setLoading(true);
    setErrorMessage(null);
    try {
      const options: ResolveOptions = {
        includeDev: includeDevDependencies,
      };
      const result = await resolvePackageGraph(packageDefinition, options);
      setAnalysisResult(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudieron resolver las dependencias. Verifica tu conexión y vuelve a intentarlo.';
      setErrorMessage(message);
      setAnalysisResult(null);
      setHasPendingChanges(true);
    } finally {
      setLoading(false);
    }
  }, [includeDevDependencies, loading, packageDefinition]);

  const dependenciesCount = useMemo(() => Object.keys(packageDefinition.dependencies ?? {}).length, [packageDefinition]);
  const devDependenciesCount = useMemo(
    () => Object.keys(packageDefinition.devDependencies ?? {}).length,
    [packageDefinition],
  );

  return (
    <main className="app">
      <header className="app__header">
        <div className="app__headline">
          <h1>PkgLens</h1>
          <p className="app__subtitle">
            Analiza el árbol de dependencias de tu proyecto, detecta versiones duplicadas, conflictos y oportunidades de actualización.
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
          <button
            type="button"
            className="app__theme-system"
            onClick={handleFollowSystemTheme}
            disabled={!hasManualTheme}
          >
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
              {analysisResult
                ? 'Tienes cambios sin analizar. Ejecuta el análisis para actualizar el reporte.'
                : 'Ejecuta el análisis para generar el grafo de dependencias.'}
            </span>
          )}
          {loading && (
            <span className="app__pending app__pending--active" role="status" aria-live="polite">
              <span className="app__pending-spinner" aria-hidden="true" />
              Resolviendo dependencias...
            </span>
          )}
        </div>
        <div className="app__stats">
          <span className="app__stat">Dependencias: {dependenciesCount}</span>
          <span className="app__stat">Dev: {devDependenciesCount}</span>
        </div>
      </section>

      <FileUploader onPackageChange={handlePackageChange} onError={handleError} defaultValue={serializedDefault} />

      <DependencyTree
        data={analysisResult}
        loading={loading}
        error={errorMessage}
        hasPendingChanges={hasPendingChanges}
      />
    </main>
  );
}

export default App;
