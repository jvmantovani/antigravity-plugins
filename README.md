# antigravity-plugins

Monorepo de extensões VS Code para o [Antigravity](https://idx.google.com/) — editor AI do Google DeepMind.

## Estrutura

```
antigravity-plugins/
├── extensions/          # Extensões VS Code individuais
│   └── ag-notifier/     # Notificações sonoras e visuais
├── packages/            # Bibliotecas compartilhadas
│   └── shared/          # Utils comuns entre extensões
├── pnpm-workspace.yaml  # Configuração de workspaces
├── tsconfig.base.json   # TypeScript base config
└── package.json         # Root: devDeps + scripts globais
```

## Pré-requisitos

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9

## Setup

```bash
pnpm install
```

## Comandos

| Comando | Descrição |
|---------|-----------|
| `pnpm build` | Compila todas as extensões |
| `pnpm watch` | Modo watch para desenvolvimento |
| `pnpm lint` | Linting em todas as extensões |
| `pnpm package` | Gera `.vsix` de todas as extensões |

## Extensões

| Extensão | Descrição | Status |
|----------|-----------|--------|
| [ag-notifier](./extensions/ag-notifier/) | Notificações sonoras e do OS quando o Antigravity requer ação | 🚧 Em desenvolvimento |

## Desenvolvimento

Cada extensão pode ser desenvolvida independentemente:

```bash
# Trabalhar em uma extensão específica
pnpm --filter ag-notifier watch

# Testar: F5 no VS Code abre o Extension Development Host
```

## Licença

[Apache 2.0](./LICENSE)
