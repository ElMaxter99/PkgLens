import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const mockPackage = (name: string, version: string, deps: Record<string, string> = {}) => ({
  name,
  versions: {
    [version]: {
      name,
      version,
      dependencies: deps,
    },
  },
  'dist-tags': {
    latest: version,
  },
});

describe('App', () => {
  beforeEach(() => {
    const registry: Record<string, unknown> = {
      react: mockPackage('react', '19.2.0', { scheduler: '^0.25.0' }),
      'react-dom': mockPackage('react-dom', '19.2.0', { react: '^19.2.0' }),
      lodash: mockPackage('lodash', '4.17.21'),
      typescript: mockPackage('typescript', '5.6.3'),
      jest: mockPackage('jest', '29.7.0'),
      scheduler: mockPackage('scheduler', '0.25.0'),
      zod: mockPackage('zod', '3.23.8'),
      vitest: mockPackage('vitest', '2.1.4'),
    };

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const pkgName = url.replace('https://registry.npmjs.org/', '');
      const payload = registry[pkgName];
      if (!payload) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renderiza el título principal y el selector de vista', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: /pkglens/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Incluir devDependencies/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Analizar dependencias/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(await screen.findByRole('navigation', { name: /Vista activa del grafo/i })).toBeInTheDocument();
  });
});
