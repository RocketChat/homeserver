# Configuração do Monorepo TypeScript

Este monorepo está configurado para resolver tipos corretamente tanto durante desenvolvimento quanto em produção.

## Como funciona

### Durante o Desenvolvimento
- Os tipos são resolvidos diretamente das pastas `src/` de cada pacote
- O `tsconfig.json` da raiz usa `paths` para mapear os pacotes para suas pastas `src`
- Isso garante melhor experiência na IDE com navegação direta para o código fonte

### Em Produção (quando consumido externamente)
- Os tipos são resolvidos das pastas `dist/` compiladas
- Cada `package.json` usa o campo `exports` para apontar para os arquivos compilados
- O campo `types` aponta para `./dist/index.d.ts`

## Estrutura dos Pacotes

Cada pacote segue esta estrutura:
```
packages/[nome]/
├── src/
│   └── index.ts
├── dist/          # Gerado pelo build
├── package.json
└── tsconfig.json
```

## Configurações

### tsconfig.json da Raiz
- Define `paths` para mapear pacotes para `src/` durante desenvolvimento
- Inclui `references` para TypeScript Project References
- Configura `baseUrl` para resolução de módulos

### package.json de cada Pacote
- `main`: `./dist/index.js` (CommonJS)
- `module`: `./dist/index.js` (ESM)
- `types`: `./dist/index.d.ts`
- `exports`: Configuração moderna para diferentes formatos
- `files`: Apenas `./dist` (não inclui `src` no pacote)

### tsconfig.json de cada Pacote
- `composite: true` para TypeScript Project References
- `declaration: true` para gerar arquivos `.d.ts`
- `outDir: "./dist"` para output compilado
- `rootDir: "./src"` para source files

## Scripts

- `bun run build`: Compila todos os pacotes usando Turbo
- `bun run dev`: Executa em modo de desenvolvimento
- `bun run tsc`: Verifica tipos sem emitir arquivos

## TypeScript Project References

O monorepo usa TypeScript Project References para:
- Compilação incremental mais rápida
- Verificação de tipos entre pacotes
- Melhor performance do TypeScript

## Exemplo de Uso

```typescript
// Durante desenvolvimento - resolve para src/
import { something } from '@hs/core';

// Em produção - resolve para dist/
import { something } from '@hs/core';
```

Ambos os casos funcionam corretamente, mas durante desenvolvimento você tem acesso direto ao código fonte.

## Build Process

O build usa o TypeScript compiler (`tsc`) padrão:
- Gera arquivos `.js` e `.d.ts` na pasta `dist/`
- Mantém source maps para debugging
- Usa configurações específicas de cada pacote
- Turbo gerencia a ordem de compilação e cache 