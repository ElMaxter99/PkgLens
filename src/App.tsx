import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { FileUploader } from './components/FileUploader';
import { DependencyTree } from './components/DependencyTree';
import {
  DependencyGraphResult,
  PackageDefinition,
  resolvePackageGraph,
  ResolveOptions,
} from './components/VersionResolver';

import './App.css';

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

  const serializedDefault = useMemo(() => JSON.stringify(DEFAULT_PACKAGE, null, 2), []);

  const handlePackageChange = useCallback(
    (data: Record<string, unknown>) => {
      try {
        const normalized = normalizePackageDefinition(data);
        setPackageDefinition(normalized);
        setErrorMessage(null);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Ocurrió un problema al interpretar el package.json proporcionado.';
        setErrorMessage(message);
      }
    },
    [setPackageDefinition],
  );

  const handleError = useCallback((message: string) => {
    setErrorMessage(message);
  }, []);

  useEffect(() => {
    let isActive = true;
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const options: ResolveOptions = {
          includeDev: includeDevDependencies,
        };
        const result = await resolvePackageGraph(packageDefinition, options);
        if (!isActive) {
          return;
        }
        setAnalysisResult(result);
        setErrorMessage(null);
      } catch (error) {
        if (!isActive) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : 'No se pudieron resolver las dependencias. Verifica tu conexión y vuelve a intentarlo.';
        setErrorMessage(message);
        setAnalysisResult(null);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }, 400);

    return () => {
      isActive = false;
      clearTimeout(timeout);
    };
  }, [packageDefinition, includeDevDependencies]);

  const dependenciesCount = useMemo(() => Object.keys(packageDefinition.dependencies ?? {}).length, [packageDefinition]);
  const devDependenciesCount = useMemo(
    () => Object.keys(packageDefinition.devDependencies ?? {}).length,
    [packageDefinition],
  );

  return (
    <main className="app">
      <header className="app__header">
        <h1>PkgLens</h1>
        <p className="app__subtitle">
          Analiza el árbol de dependencias de tu proyecto, detecta versiones duplicadas, conflictos y oportunidades de actualización.
        </p>
      </header>

      <section className="app__controls">
        <div className="app__switch">
          <label htmlFor="toggle-dev">
            <input
              id="toggle-dev"
              type="checkbox"
              checked={includeDevDependencies}
              onChange={(event) => setIncludeDevDependencies(event.target.checked)}
            />
            Incluir devDependencies ({devDependenciesCount})
          </label>
        </div>
        <div className="app__stats">
          <span className="app__stat">Dependencias: {dependenciesCount}</span>
          <span className="app__stat">Dev: {devDependenciesCount}</span>
        </div>
      </section>

      <FileUploader onPackageChange={handlePackageChange} onError={handleError} defaultValue={serializedDefault} />

      <DependencyTree data={analysisResult} loading={loading} error={errorMessage} />
    </main>
  );
}

export default App;
