import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // shadcn generated
    'components/ui/**',
  ]),
  {
    rules: {
      // Regras experimentais do react-hooks (React 19 compiler-oriented):
      // purity: Date.now/Math.random em RSC são OK (novo render por request)
      // set-state-in-effect: útil pra client, mas gera muito falso positivo
      // em padrões válidos (sync com props externas, restauração de rascunho)
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);

export default eslintConfig;
